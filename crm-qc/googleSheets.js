/* =========================================================================
 * googleSheets.js — همگام‌سازی سامانه QC با Google Sheets
 *   Node → Apps Script Web App (token) یا Google Sheets API (Service Account)
 *   Apps Script فعلی فقط API/گزارش سبک است؛ رابط کامل CRM را جایگزین نمی‌کند.
 * ========================================================================= */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const C = require('./shared/calc.js');
const https = require('https');
const http = require('http');

const CONFIG_FILE = path.join(__dirname, 'data', 'sheets-config.json');
const DATA_DIR = path.join(__dirname, 'data');
const DEFAULT_CONFIG = Object.freeze({
  enabled: false,
  initialized: false, // تا وقتی جهت اولین همگام‌سازی تعیین نشده، پولینگ/پوش خودکار نداریم.
  mode: 'webapp', // 'webapp' | 'service_account' | 'apikey' (فقط خواندن)
  syncPolicy: 'merge', // 'merge' امن و بدون حذف | 'sheet' شیت مرجع است و حذف‌ها هم اعمال می‌شوند
  spreadsheetId: '',
  webAppUrl: '',
  webAppToken: '',
  apiKey: '',
  credentialsFile: 'data/sheets-credentials.json',
  syncIntervalSec: 60,
  pushOnWrite: true,
  sheets: {
    agents: 'Agents', tickets: 'Tickets', socials: 'Socials', calls: 'Calls',
    actions: 'Actions', settings: 'Settings'
  }
});

const HEADERS = Object.freeze({
  agents: ['id','name','team','ext','active','aliases','extra'],
  tickets: ['id','reviewDate','ticketDate','agentName','team','ticketCode','q1','q2','q3','q4','redline','score','comment','qcAgent','extra'],
  socials: ['id','reviewDate','receiveDate','replyDate','agentName','team','messenger','receiveTime','replyTime','responseStatus','delayReason','reasonVerdict','qSla','qFollow','qClosing','qTone','score','durationMin','slaStatus','comment','qcAgent','extra'],
  calls: ['syncId','expertName','score','redline','redlineReason','leadName','leadPhone','listeningTime','callDuration','reviewDate','callDate','formType','team','qcAgent','qcComment','elements','sourceFile','sourceRow','evaluationId','extra'],
  actions: ['id','agent','title','date','status','result','note','type','problem','problemSource','extra'],
  settings: ['key','value']
});
const DATA_KEYS = ['agents','tickets','socials','calls','actions','settings'];
const MODES = new Set(['webapp','service_account','apikey']);
const POLICIES = new Set(['merge','sheet']);

const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
const safeObject = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const asText = value => value == null ? '' : String(value).trim();
const dateText = value => { const j = C.parseDate(value); return j ? C.formatJalali(j) : asText(value); };
const timeText = value => {
  if (typeof value === 'number' && value >= 0 && value < 1) {
    const minutes = Math.round(value * 1440) % 1440;
    return String(Math.floor(minutes / 60)).padStart(2, '0') + ':' + String(minutes % 60).padStart(2, '0');
  }
  return asText(value);
};
const validId = value => Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : null;

function loadConfig() {
  let file = {};
  try { file = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch (e) { /* تنظیمات اولیه */ }
  return Object.assign({}, DEFAULT_CONFIG, file, {
    sheets: Object.assign({}, DEFAULT_CONFIG.sheets, safeObject(file.sheets))
  });
}

function validateConfig(input) {
  const cfg = Object.assign({}, DEFAULT_CONFIG, input, {
    sheets: Object.assign({}, DEFAULT_CONFIG.sheets, safeObject(input && input.sheets))
  });
  if (!MODES.has(cfg.mode)) throw new Error('حالت اتصال گوگل شیت نامعتبر است');
  if (!POLICIES.has(cfg.syncPolicy)) throw new Error('روش همگام‌سازی نامعتبر است');
  cfg.enabled = cfg.enabled === true;
  cfg.initialized = cfg.initialized === true;
  cfg.pushOnWrite = cfg.pushOnWrite !== false;
  cfg.syncIntervalSec = Math.min(3600, Math.max(10, Number(cfg.syncIntervalSec) || 60));

  if (cfg.enabled && cfg.mode === 'webapp') {
    if (!cfg.webAppUrl) throw new Error('آدرس Web App را وارد کنید');
    const u = new URL(cfg.webAppUrl);
    if (u.protocol !== 'https:' || !['script.google.com','script.googleusercontent.com'].includes(u.hostname.toLowerCase()) || u.username || u.password || u.hash) {
      throw new Error('آدرس Web App باید یک URL امن از script.google.com باشد');
    }
    if (!cfg.webAppToken || String(cfg.webAppToken).length < 24) throw new Error('توکن Apps Script باید حداقل ۲۴ نویسه باشد؛ از منوی سامانه QC داخل شیت توکن بسازید');
  }
  if (cfg.enabled && ['service_account','apikey'].includes(cfg.mode) && !String(cfg.spreadsheetId || '').trim()) {
    throw new Error('Spreadsheet ID را وارد کنید');
  }
  if (cfg.enabled && cfg.mode === 'apikey' && !cfg.apiKey) throw new Error('API Key را وارد کنید');
  if (cfg.mode === 'service_account') {
    const cred = path.resolve(__dirname, cfg.credentialsFile || DEFAULT_CONFIG.credentialsFile);
    const rel = path.relative(DATA_DIR, cred);
    if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('فایل Service Account باید داخل پوشه crm-qc/data باشد');
  }
  Object.keys(cfg.sheets).forEach(key => {
    const name = String(cfg.sheets[key] || '').trim();
    if (!name || name.length > 100 || /[\[\]*?:/\\]/.test(name)) throw new Error('نام شیت نامعتبر است: ' + key);
    cfg.sheets[key] = name;
  });
  if (new Set(Object.values(cfg.sheets)).size !== Object.keys(cfg.sheets).length) throw new Error('نام هر تب شیت باید یکتا باشد');
  return cfg;
}

function saveConfig(input) {
  const cfg = validateConfig(input);
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = CONFIG_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2), { mode: 0o600 });
  try { fs.chmodSync(tmp, 0o600); } catch (e) {}
  fs.renameSync(tmp, CONFIG_FILE);
  googleClient = null;
  googleClientKey = '';
  return cfg;
}

function safeConfig() {
  const cfg = loadConfig();
  return Object.assign({}, cfg, {
    webAppToken: '', webAppTokenSet: !!cfg.webAppToken,
    apiKey: '', apiKeySet: !!cfg.apiKey
  });
}

function extraFor(row, known) {
  const extra = {};
  Object.keys(row || {}).forEach(key => { if (!known.has(key)) extra[key] = row[key]; });
  return JSON.stringify(extra);
}
function readExtra(value) {
  if (!value) return {};
  try { return safeObject(typeof value === 'string' ? JSON.parse(value) : value); } catch (e) { return {}; }
}
function cellValue(value) {
  if (value == null) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}
function numberOrNull(value) {
  if (value == null || String(value).trim() === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
function parseJson(value, fallback) {
  if (value == null || value === '') return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(String(value)); } catch (e) { return fallback; }
}
function decodeSetting(key, value) {
  if (typeof value !== 'string') return value;
  if (['slaMinutes'].includes(key)) return numberOrNull(value) ?? value;
  if (['scoreBands','ticketWeights','socialWeights','weekendDays'].includes(key)) {
    const parsed = parseJson(value, null);
    if (Array.isArray(parsed)) return parsed.map(Number).filter(Number.isFinite);
    const list = value.split(',').map(part => Number(part.trim())).filter(Number.isFinite);
    return list.length ? list : value;
  }
  return value;
}
function rowObjects(values) {
  if (!Array.isArray(values) || values.length < 2) return [];
  const headers = values[0].map(h => String(h == null ? '' : h).trim());
  return values.slice(1).map(row => {
    const obj = {};
    headers.forEach((header, i) => { if (header) obj[header] = row[i] == null ? '' : row[i]; });
    return obj;
  }).filter(row => Object.values(row).some(v => v !== '' && v != null));
}

function ensureSyncIds(db) {
  const rows = Array.isArray(db.callFeedbacks) ? db.callFeedbacks : [];
  const seen = new Set();
  let changed = false;
  rows.forEach(row => {
    if (!row.syncId || seen.has(String(row.syncId))) {
      row.syncId = crypto.randomUUID();
      changed = true;
    }
    seen.add(String(row.syncId));
  });
  return changed;
}

function dbToSheetRows(db) {
  ensureSyncIds(db);
  const agents = (db.agents || []).map(row => Object.assign({}, row, {
    id: row.id, name: row.name || '', team: row.team || '', ext: row.ext ?? '', active: row.active === false ? '0' : '1',
    aliases: JSON.stringify(Array.isArray(row.aliases) ? row.aliases : []),
    extra: extraFor(row, new Set(['id','name','team','ext','active','aliases']))
  }));
  const tickets = (db.tickets || []).map(row => Object.assign({}, row, {
    id: row.id, reviewDate: row.reviewDate || '', ticketDate: row.ticketDate || '', agentName: row.agentName || '',
    team: row.team || '', ticketCode: row.ticketCode || '', q1: row.q1 ?? '', q2: row.q2 ?? '', q3: row.q3 ?? '', q4: row.q4 ?? '',
    redline: row.redline ?? '', score: row.score ?? '', comment: row.comment || '', qcAgent: row.qcAgent || '',
    extra: extraFor(row, new Set(HEADERS.tickets.filter(x => x !== 'extra')))
  }));
  const socials = (db.socials || []).map(row => Object.assign({}, row, {
    id: row.id, reviewDate: row.reviewDate || '', receiveDate: row.receiveDate || '', replyDate: row.replyDate || '',
    agentName: row.agentName || '', team: row.team || '', messenger: row.messenger || '', receiveTime: row.receiveTime || '', replyTime: row.replyTime || '',
    responseStatus: row.responseStatus || '', delayReason: row.delayReason || '', reasonVerdict: row.reasonVerdict || '',
    qSla: row.qSla ?? '', qFollow: row.qFollow ?? '', qClosing: row.qClosing ?? '', qTone: row.qTone ?? '', score: row.score ?? '',
    durationMin: row.durationMin ?? '', slaStatus: row.slaStatus || '', comment: row.comment || '', qcAgent: row.qcAgent || '',
    extra: extraFor(row, new Set(HEADERS.socials.filter(x => x !== 'extra')))
  }));
  const calls = (db.callFeedbacks || []).map(row => Object.assign({}, row, {
    syncId: row.syncId, expertName: row.expertName || '', score: row.score ?? '', redline: row.redline ?? 0,
    redlineReason: row.redlineReason || '', leadName: row.leadName || '', leadPhone: row.leadPhone || '',
    listeningTime: row.listeningTime || '', callDuration: row.callDuration || '', reviewDate: row.reviewDate || '', callDate: row.callDate || '',
    formType: row.formType || '', team: row.team || '', qcAgent: row.qcAgent || '', qcComment: row.qcComment || '',
    elements: JSON.stringify(row.elements || {}), sourceFile: row.sourceFile || '', sourceRow: row.sourceRow ?? '', evaluationId: row.evaluationId || '',
    extra: extraFor(row, new Set(HEADERS.calls.filter(x => x !== 'extra')))
  }));
  const actions = [];
  Object.keys(db.agentActions || {}).forEach(agent => {
    (db.agentActions[agent] || []).forEach(row => actions.push(Object.assign({}, row, {
      id: row.id, agent, title: row.title || row.label || '', date: row.date || '', status: row.status || '',
      result: row.result || '', note: row.note || row.comment || '', type: row.type || '',
      problem: row.problem || '', problemSource: row.problemSource || '',
      extra: extraFor(row, new Set(['id','agent','title','date','status','result','note','type','problem','problemSource']))
    })));
  });
  const settings = [
    ['settings', db.settings || {}], ['qcAgents', db.qcAgents || []], ['lists', db.lists || {}],
    ['actionTypes', db.actionTypes || []], ['reminders', db.reminders || []], ['seq', db.seq || {}],
    ['datasetId', db.datasetId || ''], ['registryCleared', !!db.registryCleared], ['callImport', db.callImport || null]
  ].map(([key, value]) => ({ key, value: cellValue(value) }));
  return { agents, tickets, socials, calls, actions, settings };
}

function sheetRowsToDb(rows) {
  const out = {};
  if (Array.isArray(rows.agents)) out.agents = rows.agents.map(r => Object.assign(readExtra(r.extra), {
    id: validId(r.id) || undefined,
    name: asText(r.name || r['نام']), team: asText(r.team || r['تیم']),
    ext: asText(r.ext) === '' && asText(r['داخلی']) === '' ? null : (numberOrNull(r.ext ?? r['داخلی']) ?? asText(r.ext ?? r['داخلی'])),
    active: ['0','false','no','غیرفعال'].includes(asText(r.active || r['فعال']).toLowerCase()) ? false : true,
    aliases: parseJson(r.aliases, [])
  })).filter(a => a.name);
  if (Array.isArray(rows.tickets)) out.tickets = rows.tickets.map(r => Object.assign(readExtra(r.extra), {
    id: validId(r.id) || undefined,
    reviewDate: dateText(r.reviewDate || r['تاریخ بررسی']), ticketDate: dateText(r.ticketDate || r['تاریخ تیکت']),
    agentName: asText(r.agentName || r['کارشناس']), team: asText(r.team || r['تیم']), ticketCode: asText(r.ticketCode || r['کد تیکت']),
    q1: asText(r.q1), q2: asText(r.q2), q3: asText(r.q3), q4: asText(r.q4), redline: asText(r.redline || r['ردلاین']),
    score: numberOrNull(r.score ?? r['نمره']), comment: asText(r.comment || r['توضیحات']), qcAgent: asText(r.qcAgent)
  })).filter(row => row.agentName || row.ticketCode);
  if (Array.isArray(rows.socials)) out.socials = rows.socials.map(r => Object.assign(readExtra(r.extra), {
    id: validId(r.id) || undefined,
    reviewDate: dateText(r.reviewDate), receiveDate: dateText(r.receiveDate), replyDate: dateText(r.replyDate),
    agentName: asText(r.agentName), team: asText(r.team), messenger: asText(r.messenger), receiveTime: timeText(r.receiveTime), replyTime: timeText(r.replyTime),
    responseStatus: asText(r.responseStatus), delayReason: asText(r.delayReason), reasonVerdict: asText(r.reasonVerdict),
    qSla: asText(r.qSla), qFollow: asText(r.qFollow), qClosing: asText(r.qClosing), qTone: asText(r.qTone),
    score: numberOrNull(r.score), durationMin: numberOrNull(r.durationMin), slaStatus: asText(r.slaStatus),
    comment: asText(r.comment), qcAgent: asText(r.qcAgent)
  })).filter(row => row.agentName);
  if (Array.isArray(rows.calls)) out.calls = rows.calls.map(r => {
    const elements = parseJson(r.elements, {});
    return Object.assign(readExtra(r.extra), {
      syncId: asText(r.syncId) || crypto.randomUUID(),
      expertName: asText(r.expertName || r['کارشناس']), score: numberOrNull(r.score),
      redline: ['1','true','yes','بله'].includes(asText(r.redline).toLowerCase()) ? 1 : 0,
      redlineReason: asText(r.redlineReason), leadName: asText(r.leadName), leadPhone: asText(r.leadPhone),
      listeningTime: asText(r.listeningTime), callDuration: asText(r.callDuration), reviewDate: dateText(r.reviewDate || r['تاریخ بررسی']),
      callDate: dateText(r.callDate), formType: asText(r.formType || r['نوع فرم']) || 'tele', team: asText(r.team),
      qcAgent: asText(r.qcAgent), qcComment: asText(r.qcComment), elements: safeObject(elements),
      sourceFile: asText(r.sourceFile), sourceRow: numberOrNull(r.sourceRow), evaluationId: asText(r.evaluationId)
    });
  }).filter(row => row.expertName);
  if (Array.isArray(rows.actions)) {
    out.actions = {};
    rows.actions.forEach(r => {
      const agent = asText(r.agent || r['کارشناس']);
      if (!agent) return;
      const action = Object.assign(readExtra(r.extra), {
        id: validId(r.id) || undefined, agent, title: asText(r.title || r['عنوان']), date: dateText(r.date),
        status: asText(r.status || r['وضعیت']), result: asText(r.result || r['نتیجه']), note: asText(r.note),
        type: asText(r.type), problem: asText(r.problem), problemSource: asText(r.problemSource)
      });
      (out.actions[agent] || (out.actions[agent] = [])).push(action);
    });
  }
  if (Array.isArray(rows.settings)) {
    const meta = {};
    const settings = {};
    rows.settings.forEach(row => {
      const key = asText(row.key); if (!key) return;
      const value = parseJson(row.value, row.value);
      if (key === 'settings') Object.assign(settings, safeObject(value));
      else if (['qcAgents','lists','actionTypes','reminders','seq','datasetId','registryCleared','callImport'].includes(key)) meta[key] = value;
      // سازگاری با نسخه‌های اولیه که تنظیمات ساده key/value بودند
      else settings[key] = decodeSetting(key, value);
    });
    out.settings = settings;
    if (Object.prototype.hasOwnProperty.call(meta,'qcAgents')) out.qcAgents = Array.isArray(meta.qcAgents) ? meta.qcAgents : [];
    if (Object.prototype.hasOwnProperty.call(meta,'lists')) out.lists = safeObject(meta.lists);
    if (Object.prototype.hasOwnProperty.call(meta,'actionTypes')) out.actionTypes = Array.isArray(meta.actionTypes) ? meta.actionTypes : [];
    if (Object.prototype.hasOwnProperty.call(meta,'reminders')) out.reminders = Array.isArray(meta.reminders) ? meta.reminders : [];
    if (Object.prototype.hasOwnProperty.call(meta,'seq')) out.seq = safeObject(meta.seq);
    if (meta.datasetId) out.datasetId = String(meta.datasetId);
    if (Object.prototype.hasOwnProperty.call(meta,'registryCleared')) out.registryCleared = !!meta.registryCleared;
    if (Object.prototype.hasOwnProperty.call(meta,'callImport')) out.callImport = meta.callImport;
  }
  return out;
}

// ---------- HTTP helper با پشتیبانی از redirect پاسخ Apps Script ----------
function fetchJson(urlString, options, redirects) {
  options = options || {};
  redirects = redirects || 0;
  return new Promise((resolve, reject) => {
    let target;
    try { target = new URL(urlString); } catch (e) { reject(new Error('URL نامعتبر است')); return; }
    if (!['https:','http:'].includes(target.protocol)) { reject(new Error('پروتکل HTTP/HTTPS پشتیبانی نمی‌شود')); return; }
    const lib = target.protocol === 'https:' ? https : http;
    const method = options.method || 'GET';
    const req = lib.request({
      hostname: target.hostname, port: target.port || (target.protocol === 'https:' ? 443 : 80),
      path: target.pathname + target.search, method, headers: options.headers || {}
    }, response => {
      const status = response.statusCode || 0;
      const location = response.headers.location;
      if (location && status >= 300 && status < 400) {
        response.resume();
        if (redirects >= 5) { reject(new Error('تعداد redirectهای سرویس گوگل بیش از حد مجاز است')); return; }
        const nextUrl = new URL(location, target);
        if (nextUrl.protocol !== 'https:' && !(nextUrl.protocol === 'http:' && target.protocol === 'http:')) {
          reject(new Error('redirect ناامن رد شد')); return;
        }
        const nextOptions = Object.assign({}, options);
        if (status === 303 || ((status === 301 || status === 302) && method === 'POST')) {
          nextOptions.method = 'GET';
          nextOptions.body = null;
          nextOptions.headers = Object.assign({}, options.headers || {});
          delete nextOptions.headers['Content-Type'];
          delete nextOptions.headers['content-type'];
          delete nextOptions.headers['Content-Length'];
          delete nextOptions.headers['content-length'];
        }
        fetchJson(nextUrl.toString(), nextOptions, redirects + 1).then(resolve, reject);
        return;
      }
      let raw = '';
      response.setEncoding('utf8');
      response.on('data', chunk => {
        raw += chunk;
        if (raw.length > 50 * 1024 * 1024) { req.destroy(new Error('پاسخ گوگل شیت بیش از ۵۰ مگابایت است')); }
      });
      response.on('end', () => {
        let body;
        try { body = JSON.parse(raw); } catch (e) { body = raw; }
        resolve({ status, body, raw });
      });
    });
    req.setTimeout(options.timeoutMs || 30000, () => req.destroy(new Error('مهلت ارتباط با گوگل شیت تمام شد')));
    req.on('error', reject);
    if (options.body != null) req.write(typeof options.body === 'string' ? options.body : JSON.stringify(options.body));
    req.end();
  });
}

function quoteSheet(name) { return "'" + String(name).replace(/'/g, "''") + "'"; }
function googleRange(name) { return quoteSheet(name) + '!A:ZZ'; }

// ---------- Google Sheets API (Service Account) ----------
let googleClient = null;
let googleClientKey = '';
async function getGoogleClient(cfg) {
  const credPath = path.resolve(__dirname, cfg.credentialsFile || DEFAULT_CONFIG.credentialsFile);
  const stat = fs.existsSync(credPath) ? fs.statSync(credPath) : null;
  if (!stat) throw new Error('فایل credentials یافت نشد: ' + credPath);
  const key = credPath + ':' + stat.mtimeMs;
  if (googleClient && googleClientKey === key) return googleClient;
  let google;
  try { google = require('googleapis').google; } catch (e) { throw new Error('googleapis نصب نیست؛ npm install را در crm-qc اجرا کنید'); }
  const credentials = JSON.parse(fs.readFileSync(credPath, 'utf8'));
  const auth = new google.auth.GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
  googleClient = google.sheets({ version: 'v4', auth });
  googleClientKey = key;
  return googleClient;
}

async function ensureGoogleTabs(sheets, spreadsheetId, names) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties.title' });
  const existing = new Set((meta.data.sheets || []).map(s => s.properties && s.properties.title));
  const missing = DATA_KEYS.filter(key => !existing.has(names[key]));
  if (missing.length) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: missing.map(key => ({ addSheet: { properties: { title: names[key] } } })) }
    });
  }
}

async function pullViaServiceAccount(cfg) {
  const sheets = await getGoogleClient(cfg);
  await ensureGoogleTabs(sheets, cfg.spreadsheetId, cfg.sheets);
  const ranges = DATA_KEYS.map(key => googleRange(cfg.sheets[key]));
  const response = await sheets.spreadsheets.values.batchGet({ spreadsheetId: cfg.spreadsheetId, ranges, valueRenderOption: 'UNFORMATTED_VALUE' });
  const result = {};
  (response.data.valueRanges || []).forEach((range, index) => { result[DATA_KEYS[index]] = rowObjects(range.values || []); });
  return sheetRowsToDb(result);
}

async function pushViaServiceAccount(cfg, db) {
  const sheets = await getGoogleClient(cfg);
  await ensureGoogleTabs(sheets, cfg.spreadsheetId, cfg.sheets);
  const data = dbToSheetRows(db);
  const counts = {};
  const valuesData = DATA_KEYS.map(key => {
    const rows = data[key] || [];
    const headers = HEADERS[key];
    const values = [headers].concat(rows.map(row => headers.map(header => cellValue(row[header]))));
    counts[key] = rows.length;
    return { range: quoteSheet(cfg.sheets[key]) + '!A1', values };
  });
  await sheets.spreadsheets.values.batchClear({
    spreadsheetId: cfg.spreadsheetId,
    requestBody: { ranges: DATA_KEYS.map(key => googleRange(cfg.sheets[key])) }
  });
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: cfg.spreadsheetId,
    requestBody: { valueInputOption: 'RAW', data: valuesData }
  });
  return { ok: true, pushed: counts };
}

// ---------- Apps Script Web App ----------
function webAppEndpoint(cfg, action) {
  const base = cfg.webAppUrl;
  if (!base) throw new Error('webAppUrl تنظیم نشده');
  const url = new URL(base);
  url.searchParams.set('action', action);
  return url.toString();
}
function assertWebAppResponse(response, action) {
  if (response.status !== 200) throw new Error('Apps Script ' + action + ' خطا: HTTP ' + response.status + ' ' + String(response.raw || '').slice(0, 300));
  const body = typeof response.body === 'string' ? parseJson(response.body, null) : response.body;
  if (!body || typeof body !== 'object') throw new Error('پاسخ Apps Script JSON معتبر نیست');
  if (body.error) throw new Error('Apps Script: ' + body.error);
  return body;
}
async function pullViaWebApp(cfg) {
  if (!cfg.webAppToken) throw new Error('توکن Apps Script تنظیم نشده');
  const response = await fetchJson(webAppEndpoint(cfg, 'pull'), {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: { action: 'pull', token: cfg.webAppToken }
  });
  const data = assertWebAppResponse(response, 'pull');
  return sheetRowsToDb(data);
}
async function pushViaWebApp(cfg, db) {
  if (!cfg.webAppToken) throw new Error('توکن Apps Script تنظیم نشده');
  const response = await fetchJson(webAppEndpoint(cfg, 'push'), {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: Object.assign({ action: 'push', token: cfg.webAppToken }, dbToSheetRows(db))
  });
  return assertWebAppResponse(response, 'push');
}

// ---------- API Key mode (فقط برای شیت عمومی/فقط خواندن) ----------
async function pullViaApiKey(cfg) {
  if (!cfg.spreadsheetId || !cfg.apiKey) throw new Error('Spreadsheet ID یا API Key تنظیم نشده');
  const result = {};
  for (const key of DATA_KEYS) {
    const url = new URL(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(cfg.spreadsheetId)}/values/${encodeURIComponent(googleRange(cfg.sheets[key]))}`);
    url.searchParams.set('key', cfg.apiKey);
    const response = await fetchJson(url.toString(), { method: 'GET', headers: { Accept: 'application/json' } });
    if (response.status !== 200) throw new Error('خواندن شیت ' + cfg.sheets[key] + ' خطا داد: HTTP ' + response.status);
    result[key] = rowObjects((response.body && response.body.values) || []);
  }
  return sheetRowsToDb(result);
}

async function pull(cfg) {
  cfg = validateConfig(cfg || loadConfig());
  if (!cfg.enabled) throw new Error('همگام‌سازی شیت غیرفعال است');
  if (cfg.mode === 'service_account') return pullViaServiceAccount(cfg);
  if (cfg.mode === 'webapp') return pullViaWebApp(cfg);
  if (cfg.mode === 'apikey') return pullViaApiKey(cfg);
  throw new Error('mode نامعتبر است');
}
async function push(cfg, db) {
  cfg = validateConfig(cfg || loadConfig());
  if (!cfg.enabled) throw new Error('همگام‌سازی شیت غیرفعال است');
  if (cfg.mode === 'apikey') throw new Error('API Key فقط خواندنی است؛ برای نوشتن از Web App یا Service Account استفاده کنید');
  if (cfg.mode === 'service_account') return pushViaServiceAccount(cfg, db);
  if (cfg.mode === 'webapp') return pushViaWebApp(cfg, db);
  throw new Error('mode نامعتبر است');
}

function stable(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
  return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + stable(value[key])).join(',') + '}';
}
function rowKey(row, kind) {
  if (kind === 'calls') return row.sourceFile && row.sourceRow != null
    ? [row.sourceFile,row.formType,row.sourceRow].join('|')
    : (asText(row.syncId) || '');
  if (kind === 'agents') return validId(row.id) ? 'id:' + validId(row.id) : 'name:' + asText(row.name).toLowerCase();
  return validId(row.id) ? 'id:' + validId(row.id) : '';
}
function nextId(rows) { return Math.max(0, ...(rows || []).map(row => Number(row.id) || 0)) + 1; }
function normalizeRows(rows, kind, existing) {
  const out = [];
  const seen = new Set();
  let id = nextId(existing);
  (rows || []).forEach(raw => {
    const row = clone(raw);
    if (kind !== 'calls' && !validId(row.id)) row.id = id++;
    if (kind === 'calls' && !row.syncId) row.syncId = crypto.randomUUID();
    if (kind === 'calls' && !row.expertName) return;
    const key = rowKey(row, kind);
    if (key && seen.has(key)) return;
    if (key) seen.add(key);
    out.push(row);
  });
  return out;
}
function mergeArray(existingRows, incomingRows, kind, replace) {
  const current = Array.isArray(existingRows) ? existingRows : [];
  const incoming = normalizeRows(incomingRows, kind, current);
  if (replace) return { rows: incoming, added: incoming.length, updated: 0, removed: current.length };
  const output = current.slice();
  const byKey = new Map();
  output.forEach((row, index) => { const key = rowKey(row, kind); if (key) byKey.set(key, index); });
  const counts = { added: 0, updated: 0, removed: 0 };
  incoming.forEach(row => {
    const key = rowKey(row, kind);
    const index = key ? byKey.get(key) : undefined;
    if (index !== undefined) {
      const merged = Object.assign({}, output[index], row);
      if (stable(merged) !== stable(output[index])) { output[index] = merged; counts.updated++; }
    } else {
      const newIndex = output.push(row) - 1;
      if (key) byKey.set(key, newIndex);
      counts.added++;
    }
  });
  return { rows: output, ...counts };
}
function maxActionId(actions) { return Math.max(0, ...Object.values(actions || {}).flat().map(row => Number(row.id) || 0)); }

/**
 * Merge incoming sheet data into the running store. "merge" is non-destructive;
 * "sheet" treats each supplied tab as authoritative, including row deletions.
 */
function mergePullIntoDb(db, pulled, policy) {
  pulled = safeObject(pulled);
  const replace = policy === 'sheet';
  let changed = false;
  const counts = {};
  const tables = [
    ['agents','agents','agents'], ['tickets','tickets','tickets'],
    ['socials','socials','socials'], ['calls','callFeedbacks','calls']
  ];
  tables.forEach(([remote, local, kind]) => {
    if (!Array.isArray(pulled[remote])) return;
    const result = mergeArray(db[local] || [], pulled[remote], kind, replace);
    counts[local] = { added: result.added, updated: result.updated, removed: result.removed };
    if (stable(db[local] || []) !== stable(result.rows)) { db[local] = result.rows; changed = true; }
  });

  if (Array.isArray(pulled.actions)) {
    const currentRows = Object.keys(db.agentActions || {}).flatMap(agent => (db.agentActions[agent] || []).map(action => Object.assign({ agent }, action)));
    const result = mergeArray(currentRows, pulled.actions, 'actions', replace);
    const byAgent = {};
    result.rows.forEach(action => {
      const agent = asText(action.agent);
      if (!agent) return;
      const clean = Object.assign({}, action); delete clean.agent;
      (byAgent[agent] || (byAgent[agent] = [])).push(clean);
    });
    if (stable(db.agentActions || {}) !== stable(byAgent)) { db.agentActions = byAgent; changed = true; }
    counts.actions = { added: result.added, updated: result.updated, removed: result.removed };
  }

  const metadataKeys = ['settings','qcAgents','lists','actionTypes','reminders','seq','datasetId','registryCleared','callImport'];
  metadataKeys.forEach(key => {
    if (!Object.prototype.hasOwnProperty.call(pulled, key)) return;
    if (key === 'callImport' && !replace && pulled.callImport == null) return;
    if (key === 'settings' && !replace) {
      const next = Object.assign({}, db.settings || {}, safeObject(pulled.settings));
      if (stable(next) !== stable(db.settings || {})) { db.settings = next; changed = true; }
    } else if (key === 'qcAgents' && !replace) {
      const next = Array.from(new Set([...(db.qcAgents || []), ...(Array.isArray(pulled.qcAgents) ? pulled.qcAgents : [])]));
      if (stable(next) !== stable(db.qcAgents || [])) { db.qcAgents = next; changed = true; }
    } else if (key === 'actionTypes' && !replace) {
      const next = Array.from(new Set([...(db.actionTypes || []), ...(Array.isArray(pulled.actionTypes) ? pulled.actionTypes : [])]));
      if (stable(next) !== stable(db.actionTypes || [])) { db.actionTypes = next; changed = true; }
    } else if (key === 'reminders' && !replace) {
      const next = mergeArray(db.reminders || [], pulled.reminders || [], 'reminders', false).rows;
      if (stable(next) !== stable(db.reminders || [])) { db.reminders = next; changed = true; }
    } else if (key === 'lists' && !replace) {
      const next = Object.assign({}, db.lists || {}, safeObject(pulled.lists));
      if (stable(next) !== stable(db.lists || {})) { db.lists = next; changed = true; }
    } else if (stable(db[key]) !== stable(pulled[key])) { db[key] = clone(pulled[key]); changed = true; }
  });

  // شمارنده‌ها باید بالاتر از آخرین شناسه بمانند تا ثبت بعدی برخورد نکند.
  db.seq = Object.assign({}, db.seq || {});
  for (const [field, seqKey] of [['tickets','ticket'],['socials','social'],['agents','agent']]) {
    db.seq[seqKey] = Math.max(Number(db.seq[seqKey]) || 1, nextId(db[field] || []));
  }
  db.seq.action = Math.max(Number(db.seq.action) || 1, maxActionId(db.agentActions) + 1);
  if (!Array.isArray(db.callFeedbacks)) db.callFeedbacks = [];
  if (ensureSyncIds(db)) changed = true;
  return { changed, counts };
}

// ---------- همگام‌سازی زمان‌بندی‌شده ----------
let pollTimer = null;
let pollGeneration = 0;
let lastPullAt = null;
let lastPushAt = null;
let lastError = null;
let pollingActive = false;

function startPolling(db, saveCallback) {
  stopPolling();
  const cfg = loadConfig();
  if (!cfg.enabled) { lastError = null; return; }
  if (!cfg.initialized) { pollingActive = false; return; }
  if (!MODES.has(cfg.mode)) { lastError = 'mode نامعتبر است'; return; }
  const generation = ++pollGeneration;
  pollingActive = true;
  const interval = Math.max(10, Number(cfg.syncIntervalSec) || 60) * 1000;
  const run = async () => {
    if (generation !== pollGeneration) return;
    try {
      const pulled = await pull(cfg);
      if (generation !== pollGeneration) return;
      const result = mergePullIntoDb(db, pulled, cfg.syncPolicy);
      if (result.changed) {
        if (saveCallback) saveCallback();
        console.log('[sheets] دریافت از شیت:', result.counts);
      }
      lastPullAt = new Date().toISOString();
      lastError = null;
    } catch (error) {
      lastError = error.message;
      console.warn('[sheets] pull خطا:', error.message);
    }
    if (generation === pollGeneration) pollTimer = setTimeout(run, interval);
  };
  pollTimer = setTimeout(run, 5000);
  pollTimer.unref && pollTimer.unref();
}
function stopPolling() {
  pollGeneration++;
  if (pollTimer) clearTimeout(pollTimer);
  pollTimer = null;
  pollingActive = false;
}
function markPushed() { lastPushAt = new Date().toISOString(); lastError = null; }
function markPullError(error) { lastError = error == null ? null : (error.message || String(error)); }
function status() {
  const cfg = loadConfig();
  return {
    enabled: cfg.enabled, initialized: cfg.initialized, needsInitialization: cfg.enabled && !cfg.initialized,
    mode: cfg.mode, syncPolicy: cfg.syncPolicy, spreadsheetId: cfg.spreadsheetId,
    webAppUrl: cfg.webAppUrl ? cfg.webAppUrl.slice(0, 55) + (cfg.webAppUrl.length > 55 ? '…' : '') : '',
    webAppTokenSet: !!cfg.webAppToken, apiKeySet: !!cfg.apiKey, syncIntervalSec: cfg.syncIntervalSec,
    pushOnWrite: cfg.pushOnWrite, sheets: cfg.sheets, lastPullAt, lastPushAt, lastError, polling: pollingActive
  };
}

async function pushReport(cfg, reportData) {
  cfg = validateConfig(cfg || loadConfig());
  const title = String(reportData.title || ('QC_Report_' + new Date().toISOString().slice(0,10))).replace(/[\\/?*:[\]]/g,'_').slice(0,90);
  const rows = Array.isArray(reportData.rows) ? reportData.rows : [];
  const headers = Array.isArray(reportData.headers) && reportData.headers.length ? reportData.headers : Object.keys(rows[0] || {});
  if (!headers.length) throw new Error('گزارش برای ارسال به شیت، ستون ندارد');
  if (Object.values(cfg.sheets).includes(title)) throw new Error('نام گزارش با تب داده‌ها تداخل دارد؛ نام دیگری انتخاب کنید');
  const normalized = { title, headers, rows };
  if (cfg.mode === 'service_account') {
    const sheets = await getGoogleClient(cfg);
    const existing = await sheets.spreadsheets.get({ spreadsheetId: cfg.spreadsheetId, fields: 'sheets.properties.title' });
    const found = (existing.data.sheets || []).some(s => s.properties && s.properties.title === title);
    if (!found) await sheets.spreadsheets.batchUpdate({ spreadsheetId: cfg.spreadsheetId, requestBody: { requests: [{ addSheet: { properties: { title } } }] } });
    const values = [headers].concat(rows.map(row => headers.map(header => cellValue(row[header]))));
    await sheets.spreadsheets.values.clear({ spreadsheetId: cfg.spreadsheetId, range: googleRange(title) });
    await sheets.spreadsheets.values.update({ spreadsheetId: cfg.spreadsheetId, range: quoteSheet(title) + '!A1', valueInputOption: 'RAW', requestBody: { values } });
    return { ok: true, sheet: title, rows: rows.length };
  }
  if (cfg.mode === 'webapp') {
    const response = await fetchJson(webAppEndpoint(cfg, 'pushReport'), {
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: Object.assign({ action: 'pushReport', token: cfg.webAppToken }, normalized)
    });
    return assertWebAppResponse(response, 'pushReport');
  }
  throw new Error('ارسال گزارش در حالت API Key فقط‌خواندنی امکان‌پذیر نیست');
}

module.exports = {
  HEADERS, DEFAULT_CONFIG, DATA_KEYS, CONFIG_FILE,
  loadConfig, saveConfig, safeConfig, validateConfig, status,
  pull, push, pushReport, mergePullIntoDb, dbToSheetRows, sheetRowsToDb, ensureSyncIds,
  startPolling, stopPolling, markPushed, markPullError, fetchJson
};
