/* =========================================================================
 * server.js — بک‌اند سامانه یکپارچه کنترل کیفیت CRM (بدون وابستگی خارجی)
 *   سرو فایل‌های استاتیک + REST API + ذخیره‌سازی JSON اتمیک
 *   اجرا:  node crm-qc/server.js   (پورت پیش‌فرض 8000)
 * ========================================================================= */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const C = require('./shared/calc.js');
const QCReports = require('./shared/reports.js');
const P = require('./shared/parseQc.js');
const CallWatcher = require('./callWatcher.js');
const Registry = require('./shared/registry.js');
const ImportData = require('./shared/importData.js');
const ExpertRef = require('./shared/expertRef.js');
const Sheets = require('./googleSheets.js');
const Access = require('./shared/access.js');
const Fiscal = require('./shared/fiscal.js');
const Elements = require('./shared/elements.js');
const crypto = require('crypto');

const ROOT = __dirname;
const REPO_ROOT = path.resolve(ROOT, '..');
const PUBLIC = path.join(ROOT, 'public');
const SHARED = path.join(ROOT, 'shared');
const DATA_DIR = path.join(ROOT, 'data');
const STORE_FILE = path.join(DATA_DIR, 'store.json');
const SEED_FILE = path.join(DATA_DIR, 'seed.json');
const PORT = +(process.env.PORT || 8000);

/* ------------------------------------------------------------------ store */
let db = null;
let saveTimer = null;

function clone(o) { return JSON.parse(JSON.stringify(o)); }

function loadStore() {
  try {
    const raw = fs.readFileSync(STORE_FILE, 'utf8');
    db = JSON.parse(raw);
    console.log('[store] loaded:', db.tickets.length, 'تیکت،', db.socials.length, 'سوشال');
  } catch (e) {
    const seed = JSON.parse(fs.readFileSync(SEED_FILE, 'utf8'));
    db = Object.assign({}, seed, {
      tickets: [], socials: [], callFeedbacks: [], callImport: null,
      seq: { ticket: 1, social: 1, agent: (seed.agents[seed.agents.length - 1] || { id: 0 }).id + 1 },
      createdAt: new Date().toISOString()
    });
    saveStore(true);
    console.log('[store] seeded از data/seed.json —', db.agents.length, 'کارشناس');
  }
  if (!db.datasetId) db.datasetId = crypto.randomUUID();
  /* میگریشن‌های ساختاری بدون ریسک */
  if (!db.agentActions) db.agentActions = {};
  if (!db.settings.scoreBands) db.settings.scoreBands = [90, 75, 50];
  if (!db.settings.defaultPreset) db.settings.defaultPreset = 'cur';
  /* ماه‌های مالی، کاربران QC و حالت احراز هویت (مشترک با نسخه‌ی Apps Script) */
  if (!Array.isArray(db.fiscalMonths)) db.fiscalMonths = [];
  db.fiscalMonths = Fiscal.normalizeMonths(db.fiscalMonths);
  if (!Array.isArray(db.qcUsers)) db.qcUsers = [];
  if (!db.settings.authMode) db.settings.authMode = 'auto';
  if (!db.revision) db.revision = 1;
  if (!db.seq) db.seq = { ticket: 1, social: 1, agent: 1, action: 1 };
  if (!db.seq.action) db.seq.action = 1;
  if (!Array.isArray(db.callFeedbacks)) db.callFeedbacks = [];
  const hadSheetIds = Sheets.ensureSyncIds(db);
  ExpertRef.ensure(db); // نوع اقدام‌ها، یادآورها و شمارنده‌ها
  if (hadSheetIds) saveStore(true); // شناسه‌ی تماس‌ها برای همگام‌سازی پایدار بین سرور و شیت
}

let scopedRead = false;
/* شماره‌ی نسل داده: با هر نوشتن یکی زیاد می‌شود و کلید حافظه‌ی نتیجه‌ی گزارش‌هاست.
 * گزارش‌گیری تکراری (داشبورد/گزارش‌ها/خلاصه‌ی ماهانه/وضعیت داده) به‌جای محاسبه‌ی
 * دوباره روی هزاران رکورد، پاسخ آماده را برمی‌گرداند. */
let dataEpoch = 0;
const computeMemo = new Map();
const COMPUTE_MEMO_LIMIT = 80;
function memoized(key, compute) {
  if (computeMemo.has(key)) return computeMemo.get(key);
  const value = compute();
  if (computeMemo.size >= COMPUTE_MEMO_LIMIT) computeMemo.clear();
  computeMemo.set(key, value);
  return value;
}
function qkey(query) {
  const q = query || {};
  return Object.keys(q).sort().map((k) => k + '=' + q[k]).join('&');
}
function scopeKeyOf(session) {
  try {
    if (!Access.authRequired(db)) return 'open';
    if (!session) return 'anon';
    return Access.isAdmin(session) ? 'admin' : 'u:' + (session.name || '');
  } catch (e) { return 'u:' + (session && session.name || ''); }
}
/* کپی محدودشده‌ی داده برای هر کارشناس QC هم حافظه دارد (هر GET آن را می‌ساخت) */
const scopeMemo = new Map();
function scopedDb(full, session) {
  const key = dataEpoch + '|' + (session && session.name || '');
  if (scopeMemo.has(key)) return scopeMemo.get(key);
  const value = Access.scopeDb(full, session);
  if (scopeMemo.size >= 40) scopeMemo.clear();
  scopeMemo.set(key, value);
  return value;
}

function saveStore(sync) {
  if (scopedRead) { console.warn('[auth] تلاش برای ذخیره در حالت خواندن محدودشده — نادیده گرفته شد'); return; }
  db.revision = Number(db.revision || 0) + 1; // برای اطلاع کاربران همزمان از تغییر داده
  dataEpoch++; // حافظه‌ی گزارش‌ها و داده‌ی محدودشده باطل شود
  computeMemo.clear();
  scopeMemo.clear();
  const write = () => {
    const tmp = STORE_FILE + '.tmp';
    /* JSON فشرده: روی داده‌ی بزرگ، قالب‌بندی تورفتگی‌دار تا دو برابر زمان و حجم می‌گیرد */
    fs.writeFileSync(tmp, JSON.stringify(db));
    fs.renameSync(tmp, STORE_FILE); // اتمیک
  };
  if (sync) return write();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { write(); maybePushToSheets(); }, 400);
}

// پوش خودکار به گوگل شیت بعد هر ذخیره (debounced)
let sheetsPushTimer = null;
let sheetsPushRunning = false;
let sheetsPushAgain = false;
async function runSheetsPush() {
  if (sheetsPushRunning) { sheetsPushAgain = true; return; }
  sheetsPushRunning = true;
  try {
    const cfg = Sheets.loadConfig();
    if (!cfg.enabled || !cfg.initialized || !cfg.pushOnWrite || cfg.mode === 'apikey') return;
    if (Sheets.ensureSyncIds(db)) saveStore(true);
    await Sheets.push(cfg, db);
    Sheets.markPushed();
    saveStore(true); // شناسه‌های تماس، حتی پس از اولین push، در مخزن محلی هم بمانند
    console.log('[sheets] push خودکار موفق');
  } catch(e) { Sheets.markPullError(e); console.warn('[sheets] push خودکار خطا:', e.message); }
  finally {
    sheetsPushRunning = false;
    if (sheetsPushAgain) { sheetsPushAgain = false; maybePushToSheets(); }
  }
}
function maybePushToSheets() {
  try {
    const cfg = Sheets.loadConfig();
    if (!cfg.enabled || !cfg.initialized || !cfg.pushOnWrite || cfg.mode === 'apikey') return;
    clearTimeout(sheetsPushTimer);
    sheetsPushTimer = setTimeout(() => { sheetsPushTimer = null; runSheetsPush(); }, 2000);
  } catch(e) {}
}

/* --------------------------------------------------------------- helpers */
function send(res, code, body, type) {
  const data = type === 'raw' ? body : JSON.stringify(body);
  /* شماره‌ی نسخه‌ی داده در هدر: کلاینت بعد از هر نوشتن بدون درخواست اضافه
   * (/api/revision) می‌فهمد داده‌اش تازه است. */
  const headers = {
    'Content-Type': type === 'raw' ? 'text/html; charset=utf-8' : 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, x-qc-token',
    'Access-Control-Expose-Headers': 'x-qc-revision'
  };
  if (db) headers['x-qc-revision'] = String(Number(db.revision) || 0);
  res.writeHead(code, headers);
  res.end(data);
}
const ok = (res, body) => send(res, 200, body);
const bad = (res, msg, code) => send(res, code || 400, { error: msg });
const notFound = (res) => send(res, 404, { error: 'یافت نشد' });

function readBody(req, limit) {
  const MAX = limit || 5e6;
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > MAX) { reject(new Error('بدنه درخواست بزرگ است')); req.destroy(); }
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); } catch (e) { reject(new Error('JSON نامعتبر')); }
    });
    req.on('error', reject);
  });
}

function teamOf(name) {
  const a = db.agents.find((x) => x.name === name);
  return a ? a.team : '';
}

const str = (v) => (v == null ? '' : String(v)).trim();
function jalaliStr(v) {
  const j = C.parseJalali(v);
  return j ? C.formatJalali(j) : null;
}

/* همزمانی چند کارشناس: اگر رکورد پس از بازکردن فرم عوض شده باشد ۴۰۹ می‌دهیم. */
function conflictWith(row, body) {
  const base = body && body.baseUpdatedAt;
  if (!base || !row || !row.updatedAt) return null;
  if (String(base) === String(row.updatedAt) || body.overwrite) return null;
  return { error: 'این رکورد بعد از بازکردن فرم توسط شخص دیگری ویرایش شده است', conflict: { current: clone(row) } };
}

/* -------------------------------------------------- نرمال‌سازی رکورد تیکت */
function normalizeTicket(b, existing) {
  const t = existing ? Object.assign({}, existing) : {};
  const now = new Date().toISOString();

  t.qcAgent = str(b.qcAgent);
  t.reviewDate = jalaliStr(b.reviewDate);
  t.ticketDate = jalaliStr(b.ticketDate);
  t.agentName = str(b.agentName);
  t.team = teamOf(t.agentName) || str(b.team);
  t.ticketCode = str(b.ticketCode);
  t.q1 = str(b.q1); t.q2 = str(b.q2); t.q3 = str(b.q3); t.q4 = str(b.q4);
  t.redline = str(b.redline);
  t.comment = str(b.comment);

  // اعتبارسنجی اجباری‌ها
  const errs = [];
  if (!t.qcAgent) errs.push('کارشناس کنترل کیفیت');
  if (!t.reviewDate) errs.push('تاریخ بررسی (معتبر، مثل 1405/06/20)');
  if (!t.ticketDate) errs.push('تاریخ ایجاد تیکت');
  if (!t.agentName) errs.push('نام کارشناس');
  if (!t.ticketCode) errs.push('کد یکتای تیکت');
  ['q1', 'q2', 'q3', 'q4'].forEach((k) => { if (!['1', '0', '-'].includes(t[k])) errs.push('المان ' + k); });
  if (!['1', '0'].includes(t.redline)) errs.push('ردلاین (عدم تماس با شریک)');
  if (errs.length) return { error: 'این موارد نیاز به اصلاح دارند: ' + errs.join('، ') };

  // نمره نهایی — معادل فرمول ستون L اکسل
  const score = C.ticketScore(t.q1, t.q2, t.q3, t.q4, t.redline, db.settings.ticketWeights);
  t.score = score === '' ? null : score;
  if (!existing) { t.id = db.seq.ticket++; t.createdAt = now; }
  t.updatedAt = now;
  return { value: t };
}

/* -------------------------------------------------- نرمال‌سازی رکورد سوشال */
function normalizeSocial(b, existing) {
  const s = existing ? Object.assign({}, existing) : {};
  const now = new Date().toISOString();

  s.reviewDate = jalaliStr(b.reviewDate);
  s.qcAgent = str(b.qcAgent);
  s.receiveDate = jalaliStr(b.receiveDate);
  s.replyDate = jalaliStr(b.replyDate);
  s.agentName = str(b.agentName);
  s.team = teamOf(s.agentName) || str(b.team);
  s.messenger = str(b.messenger);
  s.receiveTime = str(b.receiveTime);
  s.replyTime = str(b.replyTime);
  s.responseStatus = str(b.responseStatus);
  s.delayReason = str(b.delayReason);
  s.reasonVerdict = str(b.reasonVerdict);
  s.qSla = str(b.qSla); s.qFollow = str(b.qFollow); s.qClosing = str(b.qClosing); s.qTone = str(b.qTone);
  s.comment = str(b.comment);

  const errs = [];
  if (!s.reviewDate) errs.push('تاریخ بررسی');
  if (!s.qcAgent) errs.push('کارشناس QC');
  if (!s.receiveDate) errs.push('تاریخ دریافت پیام');
  if (!s.replyDate) errs.push('تاریخ پاسخدهی');
  if (!s.agentName) errs.push('نام کارشناس');
  if (!s.messenger) errs.push('پیامرسان');
  if (!s.receiveTime || !C.parseTime(s.receiveTime)) errs.push('ساعت دریافت (HH:MM)');
  if (!s.replyTime || !C.parseTime(s.replyTime)) errs.push('ساعت پاسخ (HH:MM)');
  if (!s.responseStatus) errs.push('وضعیت پاسخ');
  if (!s.reasonVerdict) errs.push('وضعیت تأیید دلیل');
  if (s.responseStatus === 'عدم پاسخ' && !s.delayReason) errs.push('دلیل تأخیر یا عدم پاسخ');
  ['qSla', 'qFollow', 'qClosing', 'qTone'].forEach((k) => { if (!['1', '0', '-'].includes(s[k])) errs.push('المان ' + k); });
  if (errs.length) return { error: 'این موارد نیاز به اصلاح دارند: ' + errs.join('، ') };

  // روز هفته خودکار (ستون‌های C/E اکسل)
  s.receiveWeekday = C.weekdayFa(C.parseJalali(s.receiveDate));
  s.replyWeekday = C.weekdayFa(C.parseJalali(s.replyDate));

  // مدت زمان پاسخگویی در ساعات کاری — معادل فرمول LET/MAP ستون L
  let duration = null, durError = null;
  if (s.responseStatus === 'پاسخ داده شده') {
    const start = C.combineJalaliTime(C.parseJalali(s.receiveDate), s.receiveTime);
    const end = C.combineJalaliTime(C.parseJalali(s.replyDate), s.replyTime);
    const mins = C.businessMinutes(start, end, db.settings);
    if (mins === 'خطای تاریخ') durError = 'خطای تاریخ';
    else if (typeof mins === 'number') duration = mins;
  }
  s.durationMin = duration;          // null = اطلاعات ناقص
  s.durationError = durError;

  // وضعیت SLA — معادل ستون O اکسل
  s.slaStatus = C.slaStatus(s.responseStatus, durError ? '' : duration, db.settings.slaMinutes);

  // نمره نهایی — معادل الگوی ستون U با وزن‌های Q1:T1
  const score = C.socialScore(s.qSla, s.qFollow, s.qClosing, s.qTone, db.settings.socialWeights);
  s.score = score === '' ? null : score;
  if (!existing) { s.id = db.seq.social++; s.createdAt = now; }
  s.updatedAt = now;
  return { value: s };
}

/* -------------------------------------------------------------- گزارش‌ها */
/* منطق گزارش‌سازی در shared/reports.js مشترک است (سرور و نسخه standalone) */
const filterRows = (rows, q) => QCReports.filterRows(rows, q, db);

/* ------------------------------------------------------------- فایل HTML اصلی */
function findFeedbackHtml() {
  const files = fs.readdirSync(REPO_ROOT).filter((f) => f.toLowerCase().endsWith('.html'));
  // فایل اصلی پروژه (دستیار ریت) — بدون هیچ تغییری سرو می‌شود
  const main = files.find((f) => f.includes('دستیار')) || files[0];
  return main ? path.join(REPO_ROOT, main) : null;
}

/* ------------------------------------------------------------ استاتیک سرور */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.ico': 'image/x-icon'
};

function serveStatic(res, base, rel) {
  const safe = path.normalize(rel).replace(/^(\.\.[/\\])+/, '');
  const file = path.join(base, safe);
  if (!file.startsWith(base)) return notFound(res);
  fs.readFile(file, (err, data) => {
    if (err) return notFound(res);
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache'
    });
    res.end(data);
  });
}

/* ------------------------------------------------ نشست‌ها (توکن در حافظه) */
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const sessions = new Map();

function issueToken(user) {
  const token = crypto.randomBytes(24).toString('hex');
  sessions.set(token, { user: user, exp: Date.now() + SESSION_TTL_MS });
  return token;
}
function tokenOf(req) {
  const header = req.headers['x-qc-token'] || req.headers.authorization || '';
  return str(header).replace(/^Bearer\s+/i, '');
}
function resolveSession(req) {
  const token = tokenOf(req);
  if (!token) return null;
  const hit = sessions.get(token);
  if (!hit) return null;
  if (hit.exp < Date.now()) { sessions.delete(token); return null; }
  hit.exp = Date.now() + SESSION_TTL_MS; // انقضای لغزان
  /* نقش/دسترسی از منبع حقیقت (db) تازه می‌شود تا تغییرات مدیر فوراً اعمال گردد. */
  const fresh = Access.findUser(Access.normalizeUsers(db), hit.user.name);
  return fresh ? fresh : hit.user;
}
function dropToken(token) { if (token) sessions.delete(token); }
function dropSessionsOf(name) {
  const key = Access.normalizeUser({ name: name }).key;
  sessions.forEach((hit, token) => { if (Access.normalizeUser({ name: hit.user.name }).key === key) sessions.delete(token); });
}

/* -------------------------------------------------------------------- API */
async function handleApi(req, res, pathname, query) {
  const method = req.method;
  const body = method === 'POST' || method === 'PUT' || method === 'DELETE'
    ? await readBody(req, ['/api/calls/files', '/api/backup'].includes(pathname) ? 64e6 : 5e6)
    : {};
  const authPath = pathname.indexOf('/api/auth/') === 0;
  /* این مسیرها بدون نشست هم پاسخ می‌دهند: صفحه‌ی ورود، شماره‌ی نسخه و bootstrap
   * (که پیش از ورود فقط پوسته‌ی خالی را برمی‌گرداند). */
  const publicPath = authPath || pathname === '/api/revision' || pathname === '/api/bootstrap';
  const session = resolveSession(req);
  if (!publicPath && Access.authRequired(db)) {
    const allowed = Access.canAccessApi(db, session, method, pathname);
    if (!allowed.ok) return send(res, allowed.status || 403, { error: allowed.error });
    if (method !== 'GET') {
      const guard = Access.writeGuard(db, session, method, pathname, body);
      if (!guard.ok) return send(res, guard.status || 403, { error: guard.error });
    }
  }
  /* خواندن‌ها برای کارشناس QC روی کپی محدودشده‌ی داده اجرا می‌شوند (بند ۵). */
  const scopeable = !authPath && pathname !== '/api/revision';
  if (method === 'GET' && session && scopeable && Access.authRequired(db) && !Access.isAdmin(session)) {
    const full = db;
    db = scopedDb(full, session);
    scopedRead = true;
    try { return await dispatchApi(req, res, pathname, query, body, session); }
    finally { scopedRead = false; db = full; }
  }
  return await dispatchApi(req, res, pathname, query, body, session);
}

/* یک شکل واحد برای bootstrap: صفحه‌ی ورود، ورود موفق و بارگذاری اولیه همه از
 * همین استفاده می‌کنند تا رفت‌وبرگشت تکراری حذف شود. */
function bootstrapPayload(db, session) {
  const auth = { required: Access.authRequired(db), mode: Access.authMode(db), accounts: Access.accounts(db),
    user: session ? Access.publicUser(session) : null, admin: Access.isAdmin(session) };
  if (auth.required && !session) {
    /* پیش از ورود هیچ داده‌ای برنمی‌گردد؛ فقط آنچه صفحه‌ی ورود لازم دارد. */
    return { auth: auth, agents: [], teams: [], qcAgents: [], lists: db.lists,
      fiscalMonths: [], revision: Number(db.revision || 0),
      settings: { orgName: db.settings.orgName || 'سامانه کنترل کیفیت', scoreBands: db.settings.scoreBands,
        defaultPreset: db.settings.defaultPreset, authMode: db.settings.authMode },
      counts: { tickets: 0, socials: 0, calls: 0, callMeta: null } };
  }
  return {
    auth: auth,
    fiscalMonths: db.fiscalMonths || [],
    revision: Number(db.revision || 0),
    qcUsers: Access.isAdmin(session) ? Access.userMask(Access.normalizeUsers(db)) : undefined,
    agents: db.agents.filter((a) => a.active),
    teams: [...new Set(db.agents.filter((a) => a.active).map((a) => a.team))],
    qcAgents: db.qcAgents,
    lists: db.lists,
    settings: db.settings,
    counts: { tickets: db.tickets.length, socials: db.socials.length, calls: (db.callFeedbacks || []).length, callMeta: db.callImport || null }
  };
}

async function dispatchApi(req, res, pathname, query, body, session) {
  const parts = pathname.split('/').filter(Boolean); // ['api', ...]
  const method = req.method;

  // تاریخ اشتباه نباید به‌صورت بی‌صدا گزارش خالی یا پاک‌سازی/بک‌اپ کامل بسازد.
  const datedPath = ['/api/dashboard', '/api/reports', '/api/portfolio', '/api/portfolio/agents',
    '/api/tickets', '/api/socials', '/api/data/status', '/api/calls/analysis', '/api/backup', '/api/calls', '/api/expert-ref'].includes(pathname) || parts[1] === 'portfolio' || parts[1] === 'expert-ref';
  if (datedPath && (method === 'GET' || method === 'DELETE')) {
    const error = QCReports.validateRange(query);
    if (error) return bad(res, error);
  }

  if (pathname === '/api/data/status' && method === 'GET') {
    return ok(res, memoized(dataEpoch + '|' + scopeKeyOf(session) + '|status|' + qkey(query), () => QCReports.dataStatus(db, query)));
  }
  if (pathname === '/api/portfolio/agents' && method === 'GET') {
    return ok(res, memoized(dataEpoch + '|' + scopeKeyOf(session) + '|portfolio-agents|' + qkey(query), () => ({ rows: QCReports.portfolioAgents(db, query) })));
  }

  // نسخه کامل تأیید مرورگر مستقل از هر فیلتر؛ شامل seq، لیست‌ها و داده خام.
  if(pathname === '/api/session-snapshot' && method === 'GET')return ok(res, clone(db));

  /* ---- Google Sheets (شیت به‌عنوان بستر داده) ---- */
  if (pathname.startsWith('/api/sheets')) {
    if (pathname === '/api/sheets/status' && method === 'GET') return ok(res, Sheets.status());
    if (pathname === '/api/sheets/config' && method === 'GET') return ok(res, Sheets.safeConfig());

    if (pathname === '/api/sheets/config' && method === 'PUT') {
      try {
        const cur = Sheets.loadConfig();
        const next = Object.assign({}, cur, body, { sheets: Object.assign({}, cur.sheets, body.sheets || {}) });
        // secrets خالی یعنی «همان قبلی»؛ مقدارهای واقعی هیچ‌وقت از GET بازگردانده نمی‌شوند.
        if (!body.webAppToken) next.webAppToken = cur.webAppToken;
        if (!body.apiKey) next.apiKey = cur.apiKey;
        // اتصال به Spreadsheet یا endpoint تازه به معنی شروع همگام‌سازی از نو است.
        const targetChanged = cur.mode !== next.mode || cur.spreadsheetId !== next.spreadsheetId || cur.webAppUrl !== next.webAppUrl;
        if (targetChanged) next.initialized = false;
        clearTimeout(sheetsPushTimer); sheetsPushTimer = null;
        const saved = Sheets.saveConfig(next);
        Sheets.stopPolling();
        if (saved.enabled && saved.initialized) Sheets.startPolling(db, () => saveStore());
        return ok(res, { ok: true, config: Sheets.safeConfig(), status: Sheets.status() });
      } catch (e) { return bad(res, e.message); }
    }

    if (pathname === '/api/sheets/pull' && method === 'POST') {
      try {
        const cfg = Sheets.loadConfig();
        const pulled = await Sheets.pull(cfg);
        // اولین Pull فقط پس از انتخاب صریح «ادغام» یا «شیت مرجع» همگام‌سازی را فعال می‌کند.
        const initialPolicy = body.initialPolicy === 'sheet' ? 'sheet' : 'merge';
        const policy = body.initialize === true ? initialPolicy : (cfg.initialized ? cfg.syncPolicy : 'merge');
        const result = Sheets.mergePullIntoDb(db, pulled, policy);
        if (result.changed) saveStore();
        let initialized = cfg.initialized;
        if (body.initialize === true && !initialized) {
          const saved = Sheets.saveConfig(Object.assign({}, cfg, { initialized: true, syncPolicy: policy }));
          initialized = saved.initialized;
          Sheets.stopPolling(); Sheets.startPolling(db, () => saveStore());
        }
        Sheets.markPullError(null);
        return ok(res, {
          ok: true, changed: result.changed, initialized, policy, counts: result.counts,
          pulled: { agents: (pulled.agents || []).length, tickets: (pulled.tickets || []).length,
            socials: (pulled.socials || []).length, calls: (pulled.calls || []).length }
        });
      } catch (e) { Sheets.markPullError(e); return bad(res, 'خطا در خواندن شیت: ' + e.message); }
    }

    if (pathname === '/api/sheets/push' && method === 'POST') {
      try {
        const cfg = Sheets.loadConfig();
        if (Sheets.ensureSyncIds(db)) saveStore(true);
        const result = await Sheets.push(cfg, db);
        Sheets.markPushed();
        saveStore(true);
        if (!cfg.initialized) {
          const saved = Sheets.saveConfig(Object.assign({}, cfg, { initialized: true }));
          Sheets.stopPolling(); Sheets.startPolling(db, () => saveStore());
          return ok(res, Object.assign({}, result, { initialized: saved.initialized, pushed: result.pushed || {} }));
        }
        return ok(res, Object.assign({}, result, { initialized: true }));
      } catch (e) { Sheets.markPullError(e); return bad(res, 'خطا در نوشتن شیت: ' + e.message); }
    }

    if (pathname === '/api/sheets/report' && method === 'POST') {
      try {
        const cfg = Sheets.loadConfig();
        let reportData = body;
        if (!Array.isArray(body.rows)) {
          const q = Object.assign({ from: '', to: '', team: '', agent: '', qc: '', form: '' }, body.filters || {});
          const type = body.type || 'combined';
          const level = body.level === 'team' ? 'team' : 'agent';
          let rows;
          if (type === 'ticket') rows = QCReports.ticketReport(db, level, q);
          else if (type === 'social') rows = QCReports.socialReport(db, level, q);
          else if (type === 'call') rows = QCReports.callReport(db, level, q, P.resolver(db.settings.callCriteria)).rows;
          else rows = QCReports.combinedAgentReport(db, q);
          if (!rows.length) rows = [{ پیام: 'در بازه انتخاب‌شده داده‌ای برای گزارش وجود ندارد' }];
          reportData = {
            title: body.title || ('QC_Report_' + new Date().toISOString().slice(0, 10)),
            headers: Object.keys(rows[0]), rows
          };
        }
        const result = await Sheets.pushReport(cfg, reportData);
        Sheets.markPushed();
        return ok(res, result);
      } catch (e) { Sheets.markPullError(e); return bad(res, 'خطا در ارسال گزارش: ' + e.message); }
    }

    if (pathname === '/api/sheets/preview' && method === 'GET') {
      try {
        const pulled = await Sheets.pull(Sheets.loadConfig());
        return ok(res, { ok: true, preview: {
          agents: (pulled.agents || []).slice(0, 5), tickets: (pulled.tickets || []).slice(0, 5),
          socials: (pulled.socials || []).slice(0, 5), calls: (pulled.calls || []).slice(0, 5),
          totals: { agents: (pulled.agents || []).length, tickets: (pulled.tickets || []).length,
            socials: (pulled.socials || []).length, calls: (pulled.calls || []).length }
        } });
      } catch (e) { Sheets.markPullError(e); return bad(res, 'پیش‌نمایش ناموفق: ' + e.message); }
    }
    return notFound(res);
  }

  /* bootstrap: همه داده‌های مرجع */
  if (pathname === '/api/bootstrap' && method === 'GET') return ok(res, bootstrapPayload(db, session));

  /* ---- بک‌اپ کامل / بازیابی ---- */
  if (pathname === '/api/backup' && method === 'GET') {
    /* ?from=1405/01/01&to=1405/12/29  → در صورت داشتن از/تا، فقط رکوردهای در آن بازه (تاریخ بررسی) برمی‌گردد */
    const from = str(query.from), to = str(query.to);
    const inRange = (d) => QCReports.inRange(d, from, to);
    const out = {
      schema: 'crm-qc-backup', version: 3, datasetId: db.datasetId, exportedAt: new Date().toISOString(),
      range: { from: from || null, to: to || null },
      settings: db.settings,
      agents: db.agents,
      qcAgents: db.qcAgents,
      agentActions: db.agentActions || {},
      actionTypes: ExpertRef.actionTypes(db),
      reminders: ExpertRef.reminderList(db),
      tickets: db.tickets.filter((r) => inRange(r.reviewDate)),
      socials: db.socials.filter((r) => inRange(r.reviewDate)),
      callFeedbacks: (db.callFeedbacks || []).filter((r) => inRange(r.reviewDate)),
      callImport: db.callImport || null
    };
    return ok(res, out);
  }
  if (pathname === '/api/backup' && method === 'POST') {
    const result = ImportData.restore(db, body.backup || body, body.mode);
    ExpertRef.ensure(db);
    saveStore(); return ok(res, result);
  }

  /* دیتای نمونه — برای تست سریع UI */
  if (pathname === '/api/demo' && method === 'POST') {
    const agents = db.agents.filter((a) => a.active);
    const qcs = db.qcAgents && db.qcAgents.length ? db.qcAgents : ['کارشناس ۱'];
    if (!agents.length) return bad(res, 'ابتدا حداقل یک کارشناس فعال اضافه کنید');

    const now = new Date().toISOString();
    const rnd = (arr) => arr[Math.floor(Math.random() * arr.length)];
    const months = [4, 5, 6]; // تیر مرداد شهریور ۱۴۰۵
    let addedT = 0, addedS = 0, addedC = 0;

    function mkDate(jy, jm, jd) { return `${jy}/${String(jm).padStart(2, '0')}/${String(jd).padStart(2, '0')}`; }

    // ---- تیکت (۱۲ رکورد پراکنده در ۳ ماه) ----
    for (let i = 0; i < 12; i++) {
      const am = rnd(months), ad = 1 + Math.floor(Math.random() * 28);
      const ag = rnd(agents), qc = rnd(qcs);
      const q1 = Math.random() < 0.75 ? '1' : '0';
      const q2 = Math.random() < 0.7 ? '1' : '0';
      const q3 = Math.random() < 0.8 ? '1' : '0';
      const q4 = Math.random() < 0.85 ? '1' : '0';
      const rd = Math.random() < 0.12 ? '1' : '0';  // ردلاین در تیکت: 0=نبه و 1=بله
      const n = normalizeTicket({
        qcAgent: qc,
        reviewDate: mkDate(1405, am, Math.min(ad, 30)),
        ticketDate: mkDate(1405, am, Math.max(1, ad - 1)),
        agentName: ag.name,
        ticketCode: 'DEMO-T-' + (1000 + i),
        q1, q2, q3, q4, redline: rd,
        comment: 'رکورد نمایشی برای تست (قابل حذف یک‌جا)'
      });
      if (!n.error) { n.value.demo = true; db.tickets.push(n.value); addedT++; }
    }

    // ---- سوشال (۱۲ رکورد) — همه «پاسخ داده شده» تا فرمول SLA معتبر بماند ----
    for (let i = 0; i < 12; i++) {
      const am = rnd(months), ad = 1 + Math.floor(Math.random() * 28);
      const ag = rnd(agents), qc = rnd(qcs);
      const mode = Math.random();
      const win = mode < 0.6 ? 30 : mode < 0.85 ? 180 : 600; // دقیقه کاری تا پاسخ: خوب/متوسط/ردSLA
      const recH = 8 + Math.floor(Math.random() * 8);
      const recM = Math.floor(Math.random() * 60);
      const repH = recH + Math.ceil((recM + win) / 60);
      const repM = (recM + win) % 60;
      const n = normalizeSocial({
        reviewDate: mkDate(1405, am, Math.min(ad, 30)),
        qcAgent: qc,
        receiveDate: mkDate(1405, am, ad),
        replyDate: mkDate(1405, am, ad) === mkDate(1405, am, Math.min(ad, 30)) && repH > 21
          ? mkDate(1405, am, Math.min(ad, 30))
          : (repH > 21 ? mkDate(1405, am, Math.min(ad + 1, 30)) : mkDate(1405, am, ad)),
        agentName: ag.name,
        messenger: rnd(['واتساپ', 'ایتا', 'رویکا', 'تلگرام']),
        responseStatus: 'پاسخ داده شده',
        receiveTime: `${String(recH).padStart(2, '0')}:${String(recM).padStart(2, '0')}`,
        replyTime: `${String(Math.min(repH, 23)).padStart(2, '0')}:${String(repM).padStart(2, '0')}`,
        reasonVerdict: win <= 60 ? 'کافی' : 'نامبر',
        delayReason: win > 120 ? 'حجم بالای پیام‌ها' : '',
        qSla: Math.random() < 0.7 ? '1' : '0',
        qFollow: Math.random() < 0.7 ? '1' : '0',
        qClosing: Math.random() < 0.8 ? '1' : '0',
        qTone: Math.random() < 0.85 ? '1' : '0',
        messageLink: '',
        comment: 'رکورد نمایشی برای تست (قابل حذف یک‌جا)'
      });
      if (!n.error) { n.value.demo = true; db.socials.push(n.value); addedS++; }
    }

    // ---- ریت تماس (۱۰ رکورد ترکیبی) ----
    const calls = [];
    const forms = ['tele', 'account', 'mlm'];
    for (let i = 0; i < 10; i++) {
      const am = rnd(months), ad = 1 + Math.floor(Math.random() * 28);
      const ag = rnd(agents);
      const ft = forms[i % 3];
      const sc = 55 + Math.round(Math.random() * 45);
      calls.push({
        expertName: ag.name,
        score: sc,
        redline: Math.random() < 0.1 ? 1 : 0,
        redlineReason: Math.random() < 0.1 ? 'بدرفتاری با مشتری' : '',
        leadName: 'مشتری نمایشی ' + (100 + i),
        leadPhone: '0912' + String(1000000 + Math.floor(Math.random() * 8999999)),
        listeningTime: '00:' + String(30 + Math.floor(Math.random() * 60)) + ':00',
        qcComment: 'رکورد نمایشی برای تست (قابل حذف یک‌جا)',
        reviewDate: mkDate(1405, am, Math.min(ad, 30)),
        formType: ft,
        demo: true
      });
    }
    if (!db.callFeedbacks) db.callFeedbacks = [];
    calls.forEach((c) => db.callFeedbacks.push(c));
    addedC = calls.length;
    if (!db.callImport) db.callImport = {};
    db.callImport.demo = true;
    db.callImport.importedAt = now;

    saveStore();
    return ok(res, { ok: true, added: { tickets: addedT, socials: addedS, calls: addedC } });
  }
  if (pathname === '/api/demo' && method === 'DELETE') {
    const t0 = db.tickets.length, s0 = db.socials.length, c0 = (db.callFeedbacks || []).length;
    db.tickets = db.tickets.filter((r) => !r.demo);
    db.socials = db.socials.filter((r) => !r.demo);
    if (db.callFeedbacks) db.callFeedbacks = db.callFeedbacks.filter((r) => !r.demo);
    if (db.callImport && db.callImport.demo) db.callImport = null;
    saveStore();
    return ok(res, { ok: true, removed: { tickets: t0 - db.tickets.length, socials: s0 - db.socials.length, calls: c0 - (db.callFeedbacks || []).length } });
  }

  /* داشبورد */
  if (pathname === '/api/dashboard' && method === 'GET') {
    return ok(res, memoized(dataEpoch + '|' + scopeKeyOf(session) + '|dashboard|' + qkey(query),
      () => QCReports.dashboard(db, { from: query.from, to: query.to, team: query.team })));
  }

  /* ارزیابی تیکت */
  if (parts[1] === 'tickets') {
    if (parts.length === 2 && method === 'GET') {
      let rows = filterRows(db.tickets, query);
      if (query.search) {
        const s = str(query.search);
        rows = rows.filter((r) => (r.agentName + ' ' + r.ticketCode + ' ' + r.qcAgent + ' ' + (r.comment || '')).includes(s));
      }
      rows = rows.slice().sort((a, b) => (b.id - a.id));
      const total = rows.length, page = +query.page || 1, per = Math.min(+(query.per) || 15, 200);
      return ok(res, { rows: rows.slice((page - 1) * per, page * per), total, page, per });
    }
    if (parts.length === 2 && method === 'POST') {
      const n = normalizeTicket(body);
      if (n.error) return bad(res, n.error);
      db.tickets.push(n.value);
      saveStore();
      return ok(res, n.value);
    }
    if (parts.length === 3 && method === 'GET') {
      const row = db.tickets.find((r) => r.id === +parts[2]);
      if (!row) return notFound(res);
      return ok(res, row);
    }
    if (parts.length === 3 && method === 'PUT') {
      const row = db.tickets.find((r) => r.id === +parts[2]);
      if (!row) return notFound(res);
      const clash = conflictWith(row, body);
      if (clash) return send(res, 409, clash);
      const n = normalizeTicket(body, row);
      if (n.error) return bad(res, n.error);
      Object.assign(row, n.value);
      saveStore();
      return ok(res, row);
    }
    if (parts.length === 3 && method === 'DELETE') {
      const i = db.tickets.findIndex((r) => r.id === +parts[2]);
      if (i < 0) return notFound(res);
      db.tickets.splice(i, 1);
      saveStore();
      return ok(res, { deleted: true });
    }
  }

  /* ارزیابی سوشال */
  if (parts[1] === 'socials') {
    if (parts.length === 2 && method === 'GET') {
      let rows = filterRows(db.socials, query);
      if (query.sla) rows = rows.filter((r) => r.slaStatus === query.sla);
      if (query.status) rows = rows.filter((r) => r.responseStatus === query.status);
      if (query.search) {
        const s = str(query.search);
        rows = rows.filter((r) => (r.agentName + ' ' + r.messenger + ' ' + r.qcAgent + ' ' + (r.comment || '')).includes(s));
      }
      rows = rows.slice().sort((a, b) => (b.id - a.id));
      const total = rows.length, page = +query.page || 1, per = Math.min(+(query.per) || 15, 200);
      return ok(res, { rows: rows.slice((page - 1) * per, page * per), total, page, per });
    }
    if (parts.length === 2 && method === 'POST') {
      const n = normalizeSocial(body);
      if (n.error) return bad(res, n.error);
      db.socials.push(n.value);
      saveStore();
      return ok(res, n.value);
    }
    if (parts.length === 3 && method === 'GET') {
      const row = db.socials.find((r) => r.id === +parts[2]);
      if (!row) return notFound(res);
      return ok(res, row);
    }
    if (parts.length === 3 && method === 'PUT') {
      const row = db.socials.find((r) => r.id === +parts[2]);
      if (!row) return notFound(res);
      const clash = conflictWith(row, body);
      if (clash) return send(res, 409, clash);
      const n = normalizeSocial(body, row);
      if (n.error) return bad(res, n.error);
      Object.assign(row, n.value);
      saveStore();
      return ok(res, row);
    }
    if (parts.length === 3 && method === 'DELETE') {
      const i = db.socials.findIndex((r) => r.id === +parts[2]);
      if (i < 0) return notFound(res);
      db.socials.splice(i, 1);
      saveStore();
      return ok(res, { deleted: true });
    }
  }

  /* پیش‌نمایش زنده محاسبات سمت سرور (SlA/نمره) — برای تست/اطمینان */
  if (pathname === '/api/preview' && method === 'POST') {
    if (body.kind === 'ticket') return ok(res, { score: C.ticketScore(body.q1, body.q2, body.q3, body.q4, body.redline, db.settings.ticketWeights) });
    if (body.kind === 'social') {
      const start = C.combineJalaliTime(C.parseJalali(body.receiveDate), body.receiveTime);
      const end = C.combineJalaliTime(C.parseJalali(body.replyDate), body.replyTime);
      const mins = body.responseStatus === 'عدم پاسخ' ? '' : C.businessMinutes(start, end, db.settings);
      return ok(res, {
        durationMin: typeof mins === 'number' ? mins : null,
        durationError: mins === 'خطای تاریخ' ? 'خطای تاریخ' : null,
        slaStatus: C.slaStatus(body.responseStatus, mins === 'خطای تاریخ' ? '' : mins, db.settings.slaMinutes),
        score: C.socialScore(body.qSla, body.qFollow, body.qClosing, body.qTone, db.settings.socialWeights),
        receiveWeekday: C.weekdayFa(C.parseJalali(body.receiveDate)),
        replyWeekday: C.weekdayFa(C.parseJalali(body.replyDate))
      });
    }
    return bad(res, 'kind نامعتبر');
  }

  /* گزارش‌ها */
  if (parts[1] === 'reports' && method === 'GET') {
    /* گزارش‌گیری سنگین‌ترین مسیر خواندنی است؛ نتیجه با کلید «نسل داده + کاربر +
     * فیلترها» حافظه می‌شود و با هر نوشتن کل حافظه پاک می‌شود. */
    return ok(res, memoized(dataEpoch + '|' + scopeKeyOf(session) + '|reports|' + qkey(query), () => {
      const type = query.type || 'social';
      const level = query.level === 'team' ? 'team' : 'agent';
      const q = { from: query.from, to: query.to, team: query.team, agent: query.agent, qc: query.qc, form: query.form };
      /* نرخ اقلام نسبت به کل دیتای فیلترشده — برای همه‌ی تب‌ها */
      const elements = QCReports.elementRates(db, q);
      if (type === 'combined') return { type, level, rows: QCReports.combinedAgentReport(db, q), elements };
      if (type === 'call') {
        const rep = QCReports.callReport(db, level, q, P.resolver(db.settings.callCriteria));
        return { type: 'call', level, rows: rep.rows, calls: rep.calls, redlineRows: rep.redlineRows, elements: Object.assign({}, elements, { call: rep.elements }) };
      }
      const tt = type === 'ticket' ? 'ticket' : 'social';
      const rows = tt === 'ticket' ? QCReports.ticketReport(db, level, q) : QCReports.socialReport(db, level, q);
      return { type: tt, level, rows, elements };
    }));
  }

  /* پرونده کارشناس (نام یا داخلی) */
  if (parts[1] === 'portfolio' && method === 'GET') {
    const prof = QCReports.agentProfile(db, query.ident || '', { from: query.from, to: query.to });
    if (!prof) return bad(res, 'کارشناس با این نام یا داخلی یافت نشد', 404);
    return ok(res, prof);
  }

  /* دیتای ریت تماس (ایمپورت از qc_recovery.json پنل) */
  if (parts[1] === 'calls') {
    if (parts.length === 2 && method === 'POST') {
      const obj = body.recovery || body;
      const tele = Array.isArray(obj.teleRawData) ? obj.teleRawData : [];
      const acc = Array.isArray(obj.accRawData) ? obj.accRawData : [];
      const mlm = Array.isArray(obj.mlmRawData) ? obj.mlmRawData : [];
      const norm = (r, formType) => {
        const dj = P.anyToJalali(r.reviewDate || r.registrationDateRaw || r.dateRaw);
        return {
          expertName: P.normName(r.expertName),
          score: C.normalizeScore(r.score),
          redline: P.isRedline(r.redline) ? 1 : 0,
          redlineReason: str(r.redlineReason),
          leadName: str(r.leadName), leadPhone: str(r.leadPhone),
          listeningTime: str(r.listeningTime), callDuration: str(r.callDuration), qcAgent: str(r.qcAgent), qcComment: str(r.qcComment),
          reviewDate: dj ? (dj.jy + '/' + String(dj.jm).padStart(2, '0') + '/' + String(dj.jd).padStart(2, '0')) : '',
          formType, elements: r.elements || {},
          sourceFile: 'qc_recovery.json'
        };
      };
      const all = [...tele.map((r) => norm(r, 'tele')), ...acc.map((r) => norm(r, 'account')), ...mlm.map((r) => norm(r, 'mlm'))].filter((r) => r.expertName);
      if (!db.callFeedbacks) db.callFeedbacks = [];
      const changes = ImportData.calls(db, all, body.mode || 'append', 'qc_recovery.json');
      db.callRaw = obj; // اسناد خام برای بازگردانی به پنل
      db.callImport = {
        importedAt: new Date().toISOString(),
        counts: { tele: tele.length, account: acc.length, mlm: mlm.length, total: all.length },
        storedActions: obj.storedActions && typeof obj.storedActions === 'object' ? obj.storedActions : {},
        voiceMeta: Object.fromEntries(Object.entries(obj.voiceMeta || {}).map(([k, v]) => [k, Array.isArray(v) ? { count: v.length } : v]))
      };
      saveStore();
      return ok(res, { ok: true, counts: db.callImport.counts, changes });
    }
    if (parts.length === 2 && method === 'GET') {
      const freshRaw = db.callRaw || null;
      return ok(res, { meta: db.callImport || null, count: (db.callFeedbacks || []).length, raw: (query.full === '1' && freshRaw) ? freshRaw : undefined });
    }
    if (parts.length === 2 && method === 'DELETE') {
      /* ?from=...&to=... → فقط رکوردهای آن بازه (تاریخ بررسی) پاک می‌شود؛ بدون پارامتر همه */
      const from = str(query.from), to = str(query.to);
      const before = (db.callFeedbacks || []).length;
      if (from || to) {
        db.callFeedbacks = (db.callFeedbacks || []).filter((r) => !QCReports.inRange(r.reviewDate, from, to));
      } else {
        db.callFeedbacks = [];
      }
      const removed = before - db.callFeedbacks.length;
      if (!db.callFeedbacks.length) { db.callImport = null; db.callRaw = null; db.callSync = { files: {}, syncedAt: null }; }
      saveStore(); return ok(res, { ok: true, removed });
    }
    /* تحلیل بومی تماس — معادل داشبورد پنل روی دیتای ادغام‌شده‌ی همه منابع */
    if (parts[2] === 'analysis' && method === 'GET') {
      return ok(res, QCReports.callAnalysis(db, {
        from: query.from, to: query.to, team: query.team, agent: query.agent, form: query.form
      }, P.resolver(db.settings.callCriteria)));
    }
    /* کارت «وضعیت پوشه»: فایل‌های داخل data/calls + ردیف‌های تزریق‌شده از هر کدام */
    if (parts[2] === 'dirstatus' && method === 'GET') {
      return ok(res, CallWatcher.dirStatus(db));
    }
    /* بازخوانی فوری پوشه از روی دکمه‌ی UI */
    if (parts[2] === 'rescan' && method === 'POST') {
      const r = CallWatcher.rescanNow(db, saveStore);
      return ok(res, { ok: true, changed: r.changed, delta: r.delta, status: CallWatcher.dirStatus(db) });
    }
    /* آپلود دستی اکسل‌ها از مرورگر — بدنه: { files: [{ name, rows }] }
     * rows خروجی sheet_to_json با همان هدرهای فرم QC است. نوع هر فایل از نام،
     * وگرنه از محتوای ستون‌ها تشخیص داده می‌شود. ردیف‌ها با تگ sourceFile وارد
     * شده و ردیف‌های قبلی همان فایل پاک می‌شوند (سینک نیمه‌دوطرفه به‌ازای فایل). */
    if (parts[2] === 'files' && method === 'POST') {
      const files = Array.isArray(body.files) ? body.files : (body.name && Array.isArray(body.rows) ? [body] : []);
      if (!files.length) return bad(res, 'فایلی دریافت نشد');
      if (!db.callFeedbacks) db.callFeedbacks = [];
      const results = [];
      for (const f of files.slice(0, 200)) {
        const name = str(f.name) || 'unnamed.xlsx';
        const rows = Array.isArray(f.rows) ? f.rows : [];
        /* ترتیب تشخیص: نام فایل ← فرم تیم انتخاب‌شده در «تیم مقصد» ← محتوای ستون‌ها */
        const ftype = P.formTypeOfFileName(name) || P.teamForm(str(body.team)) || P.sniffFormType(rows, db.settings.callCriteria);
        if (!ftype) { results.push({ name, ok: false, reason: 'نوع فرم تشخیص داده نشد' }); continue; }
        const parsed = P.parseRows(rows, ftype, { agents: db.agents, criteria: db.settings.callCriteria, team: str(body.team) });
        if (!parsed.length) { results.push({ name, ok: false, reason: 'ردیفی یافت نشد', type: ftype }); continue; }
        const changes = ImportData.calls(db, parsed.map(r => Object.assign({ sourceFile: name }, r)), body.mode || 'append', name);
        results.push({ name, ok: true, type: ftype, count: parsed.length, changes, diagnostics: P.importDiagnostics(parsed, db.agents) });
      }
      /* فقط هویت واقعی ردیف فایل تکراری است؛ تماس‌های یک روز با یک شماره مستقل‌اند. */
      const seen = new Map(); const out = [];
      for (const r of db.callFeedbacks) {
        const key = P.callRowKey(r);
        if (key && seen.has(key)) continue;
        if (key) seen.set(key, 1);
        out.push(r);
      }
      db.callFeedbacks = out;
      db.callImport = db.callImport || {};
      db.callImport.importedAt = new Date().toISOString();
      db.callImport.counts = {
        total: db.callFeedbacks.length,
        tele: db.callFeedbacks.filter((r) => r.formType === 'tele').length,
        account: db.callFeedbacks.filter((r) => r.formType === 'account').length,
        mlm: db.callFeedbacks.filter((r) => r.formType === 'mlm').length
      };
      saveStore();
      return ok(res, { ok: true, results, counts: db.callImport.counts });
    }
    return notFound(res);
  }

  /* مرجع کارشناسان: کارت‌ها، جزئیات/ماتریس/تاریخچه هر کارشناس (منطق در shared/expertRef.js) */
  if (pathname === '/api/expert-ref' && method === 'GET') return ok(res, ExpertRef.overview(db, query));
  /* داشبورد بررسی: همه‌ی اقدام‌ها (قبل از مسیر جزئیات کارشناس تا «review» به‌عنوان نام کارشناس خوانده نشود) */
  if (pathname === '/api/expert-ref/review' && method === 'GET') return ok(res, ExpertRef.reviewDashboard(db, query));
  if (parts[1] === 'expert-ref' && parts.length === 3 && method === 'GET') {
    return ok(res, ExpertRef.detail(db, parts[2], query));
  }

  /* نوع اقدام‌ها (مدیریت از پاپ‌آپ «ثبت اکشن») */
  if (pathname === '/api/action-types') {
    if (method === 'GET') return ok(res, { items: ExpertRef.actionTypes(db) });
    if (method === 'POST') { const items = ExpertRef.addActionType(db, body.label); saveStore(); return ok(res, { items }); }
    if (method === 'DELETE') { const items = ExpertRef.deleteActionType(db, body.label); saveStore(); return ok(res, { items }); }
  }

  /* اقدامات اصلاحی — ثبت/لیست/وضعیت/نتیجه */
  if (parts[1] === 'actions') {
    ExpertRef.ensure(db);
    if (parts.length === 2 && method === 'GET') {
      const name = query.agent || null;
      if (name) return ok(res, db.agentActions[name] || []);
      return ok(res, db.agentActions);
    }
    if (parts.length === 2 && method === 'POST') {
      const it = ExpertRef.saveAction(db, body); saveStore(); return ok(res, it);
    }
    if (parts.length === 3 && method === 'PUT') {
      const it = ExpertRef.updateAction(db, +parts[2], body); saveStore(); return ok(res, it);
    }
    if (parts.length === 3 && method === 'DELETE') {
      const result = ExpertRef.deleteAction(db, +parts[2]); saveStore(); return ok(res, result);
    }
    return notFound(res);
  }

  /* یادآورهای کارشناس (با تاریخ جلالی از پاپ‌آپ تقویم) */
  if (parts[1] === 'reminders') {
    ExpertRef.ensure(db);
    if (parts.length === 2 && method === 'GET') return ok(res, ExpertRef.reminderList(db, query.agent || null));
    if (parts.length === 2 && method === 'POST') { const r = ExpertRef.saveReminder(db, body); saveStore(); return ok(res, r); }
    if (parts.length === 3 && method === 'PUT') { const r = ExpertRef.updateReminder(db, +parts[2], body); saveStore(); return ok(res, r); }
    if (parts.length === 3 && method === 'DELETE') { const result = ExpertRef.deleteReminder(db, +parts[2]); saveStore(); return ok(res, result); }
    return notFound(res);
  }
  if (parts[1] === 'agents') {
    if (parts.length === 2 && method === 'GET') return ok(res, db.agents);
    if (parts.length === 2 && method === 'DELETE') { const result = Registry.removeAll(db, body); saveStore(); return ok(res, result); }
    if (parts[2] === 'bulk' && method === 'POST') { const result = Registry.bulk(db, body.rows); saveStore(); return ok(res, result); }
    if (parts.length === 2 && method === 'POST') { const row = Registry.save(db, body); saveStore(); return ok(res, row); }
    if (parts.length === 3 && method === 'PUT') { const row = Registry.save(db, body, +parts[2]); saveStore(); return ok(res, row); }
    if (parts.length === 3 && method === 'DELETE') {
      const a = db.agents.find(a => a.id === +parts[2]); if (!a) return notFound(res);
      a.active = false; saveStore(); return ok(res, { ok: true, archived: true });
    }
  }
  if (pathname === '/api/criteria') {
    if (method === 'GET') return ok(res, { config: db.settings.callCriteria || { version: 0, forms: {}, teams: {} }, teams: [...new Set(db.agents.map(a => a.team))] });
    if (method === 'PUT') {
      const config = P.saveTeamConfig(db.settings.callCriteria, body);
      db.settings.callCriteria = config; saveStore(); return ok(res, { config });
    }
  }

  /* کارشناسان QC */
  if (parts[1] === 'qc-agents') {
    if (parts.length === 2 && method === 'GET') return ok(res, db.qcAgents);
    if (parts.length === 2 && method === 'POST') {
      const name = str(body.name);
      if (!name) return bad(res, 'نام الزامی است');
      if (db.qcAgents.includes(name)) return bad(res, 'تکراری است');
      db.qcAgents.push(name);
      saveStore();
      return ok(res, db.qcAgents);
    }
    if (parts.length === 3 && method === 'DELETE') {
      const i = db.qcAgents.indexOf(decodeURIComponent(parts[2]));
      if (i < 0) return notFound(res);
      db.qcAgents.splice(i, 1);
      saveStore();
      return ok(res, db.qcAgents);
    }
  }

  /* تنظیمات (وزن‌ها، SLA، ساعت کاری، تعطیلات، نام سازمان) */
  if (pathname === '/api/settings') {
    if (method === 'GET') return ok(res, db.settings);
    if (method === 'PUT') {
      const s = db.settings;
      if (Array.isArray(body.ticketWeights) && body.ticketWeights.length === 4) s.ticketWeights = body.ticketWeights.map((x) => Math.max(0, +x || 0));
      if (Array.isArray(body.socialWeights) && body.socialWeights.length === 4) s.socialWeights = body.socialWeights.map((x) => Math.max(0, +x || 0));
      if (body.slaMinutes != null) s.slaMinutes = Math.max(1, +body.slaMinutes || 60);
      if (body.workStart && C.parseTime(body.workStart)) s.workStart = body.workStart;
      if (body.workEnd && C.parseTime(body.workEnd)) s.workEnd = body.workEnd;
      if (Array.isArray(body.weekendDays)) s.weekendDays = body.weekendDays.map((x) => +x).filter((x) => x >= 0 && x <= 6);
      if (body.orgName) s.orgName = str(body.orgName);
      if (Array.isArray(body.scoreBands) && body.scoreBands.length === 3) {
        s.scoreBands = body.scoreBands.map((x) => Math.min(100, Math.max(0, +x || 0))).sort((a, b) => b - a);
      }
      if (['cur', 'prev', 'all', 'today'].indexOf(body.defaultPreset) !== -1 || Fiscal.isFiscalPreset(body.defaultPreset)) s.defaultPreset = body.defaultPreset;
      if (['auto', 'on', 'off'].indexOf(str(body.authMode)) !== -1) s.authMode = str(body.authMode);
      saveStore();
      return ok(res, s);
    }
  }

  /* ---- احراز هویت (بند ۵) ---- */
  if (parts[1] === 'auth') {
    if (parts[2] === 'accounts' && method === 'GET') {
      return ok(res, { required: Access.authRequired(db), mode: Access.authMode(db),
        accounts: Access.accounts(db), firstRun: !Access.normalizeUsers(db).length,
        orgName: db.settings.orgName || '' });
    }
    if (parts[2] === 'login' && method === 'POST') {
      const result = Access.login(db, body.name, body.password);
      if (!result.ok) return send(res, 401, { error: result.error });
      /* پاسخ ورود، خودِ داده‌ی اولیه را هم دارد تا کلاینت یک bootstrap کامل
       * جداگانه نگیرد (در هر ورود یک رفت‌وبرگشت کمتر). */
      const full = Access.normalizeUser(result.user, 0);
      const view = Access.isAdmin(full) ? db : Access.scopeDb(db, full);
      return ok(res, { ok: true, user: result.user, token: issueToken(result.user), bootstrap: bootstrapPayload(view, full) });
    }
    if (parts[2] === 'logout' && method === 'POST') {
      dropToken(str(body.token) || tokenOf(req));
      return ok(res, { ok: true });
    }
    if (parts[2] === 'me' && method === 'GET') {
      return ok(res, { required: Access.authRequired(db), user: session ? Access.publicUser(session) : null,
        admin: Access.isAdmin(session), accounts: Access.accounts(db) });
    }
    if (parts[2] === 'setup' && method === 'POST') {
      /* راه‌اندازی اولیه فقط وقتی هیچ کاربری وجود ندارد (جلوگیری از بن‌بست مدیر) */
      if (Access.normalizeUsers(db).length) return bad(res, 'قبلاً کاربری تعریف شده است؛ از بخش مدیریت QC استفاده کنید');
      if (!str(body.name) || !str(body.password)) return bad(res, 'نام و رمز مدیر الزامی است');
      db.qcUsers = [];
      const row = Access.saveUser(db, { name: body.name, password: body.password, role: 'admin', active: true, exts: '*' });
      saveStore();
      const admin = Access.normalizeUser(row, 0);
      return ok(res, { ok: true, user: Access.publicUser(admin), token: issueToken(admin),
        bootstrap: bootstrapPayload(db, admin) });
    }
    return notFound(res);
  }

  /* ---- کاربران QC و دسترسی‌ها (تب QC_Users) ---- */
  if (parts[1] === 'qc-users') {
    const users = Access.normalizeUsers(db);
    if (parts.length === 2 && method === 'GET') {
      return ok(res, { users: Access.userMask(users), required: Access.authRequired(db), mode: Access.authMode(db),
        teams: [...new Set(db.agents.map((a) => a.team))].sort(),
        agents: db.agents.map((a) => ({ id: a.id, name: a.name, ext: a.ext, team: a.team, subgroup: a.subgroup || '', active: a.active !== false,
          qcAgents: Access.splitList(a.qcAgents) })) });
    }
    /* شناسه‌ی کاربر هم در بدنه و هم در مسیر (/api/qc-users/u2) پذیرفته می‌شود —
     * تا رفتار Node و Apps Script (که از همان LocalApi استفاده می‌کند) یکی بماند. */
    const pathId = parts.length === 3 ? decodeURIComponent(parts[2]) : '';
    if ((method === 'POST' && parts.length === 2) || (method === 'PUT' && (parts.length === 2 || parts.length === 3))) {
      const wantedId = str(body.id) || pathId;
      const existing = wantedId ? (db.qcUsers || []).find((u) => String(u.id) === wantedId) : null;
      if (method === 'PUT' && !existing) return notFound(res);
      const before = existing ? existing.name : '';
      const row = Access.saveUser(db, body, existing);
      /* تیک‌ها روی ستون qcAgents تب Agents هم می‌نشینند تا از شیت/اکسل هم ویرایش‌پذیر باشند. */
      Access.syncAgentQcColumn(db, Access.normalizeUser(row, 0), (body && body.syncColumn && (body.exts !== undefined || body.agents !== undefined || body.teams !== undefined)) ? 'sync' : 'keep');
      saveStore();
      if (before && before !== row.name) dropSessionsOf(before);
      return ok(res, { ok: true, user: Access.userMask([Access.normalizeUser(row, 0)])[0],
        users: Access.userMask(Access.normalizeUsers(db)),
        agents: db.agents.map((a) => ({ id: a.id, name: a.name, ext: a.ext, team: a.team, subgroup: a.subgroup || '', active: a.active !== false,
          qcAgents: Access.splitList(a.qcAgents) })) });
    }
    if (parts.length === 3 && method === 'DELETE') {
      const target = users.find((u) => String(u.id) === String(parts[2]));
      if (!target) return notFound(res);
      if (session && target.key === session.key) return bad(res, 'نمی‌توانید حساب کاربری خودتان را حذف کنید');
      if (target.role === 'admin' && users.filter((u) => u.role === 'admin' && u.active).length <= 1) {
        return bad(res, 'حداقل یک مدیر فعال باید باقی بماند');
      }
      Access.deleteUser(db, target.name);
      dropSessionsOf(target.name);
      saveStore();
      return ok(res, { ok: true, users: Access.userMask(Access.normalizeUsers(db)) });
    }
    return notFound(res);
  }

  /* ---- ماه‌های مالی (تب Fiscal_Months) ---- */
  if (parts[1] === 'fiscal-months') {
    const months = Fiscal.normalizeMonths(db.fiscalMonths);
    if (method === 'GET') {
      const today = C.formatJalali(C.todayJalali());
      return ok(res, { months: months, options: Fiscal.presetOptions(months, today),
        current: Fiscal.currentMonth(months, today), previous: Fiscal.previousMonth(months, today) });
    }
    if (method === 'PUT') {
      const rows = Array.isArray(body.months) ? body.months : [];
      const clean = rows.map((m) => ({ id: str(m.id), name: str(m.name), from: str(m.from), to: str(m.to), note: str(m.note) }))
        .filter((m) => m.name || m.from || m.to);
      for (const m of clean) {
        if (!m.name) return bad(res, 'نام ماه مالی الزامی است');
        if (!C.parseDate(m.from) || !C.parseDate(m.to)) return bad(res, 'تاریخ «' + m.name + '» نامعتبر است');
      }
      db.fiscalMonths = Fiscal.normalizeMonths(clean);
      saveStore();
      return ok(res, { ok: true, months: db.fiscalMonths });
    }
    if (method === 'DELETE' && parts.length === 3) {
      db.fiscalMonths = Fiscal.normalizeMonths((db.fiscalMonths || []).filter((m) => m.id !== parts[2]));
      saveStore();
      return ok(res, { ok: true, months: db.fiscalMonths });
    }
    return notFound(res);
  }

  /* ---- المان‌ها به‌صورت تخت (تب Elements) و خلاصه‌ی ماهانه (تب Monthly_Summary) ---- */
  if (parts[1] === 'elements' && method === 'GET') {
    return ok(res, Elements.table(db.settings.callCriteria, [...new Set(db.agents.map((a) => a.team))]));
  }
  if (parts[1] === 'monthly-summary' && method === 'GET') {
    return ok(res, memoized(dataEpoch + '|' + scopeKeyOf(session) + '|monthly|' + qkey(query), () => Fiscal.monthlySummary(db, query)));
  }
  if (parts[1] === 'revision' && method === 'GET') return ok(res, { revision: Number(db.revision || 0), at: Date.now() });

  notFound(res);
}

/* ----------------------------------------------------------------- سرور */
loadStore();

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = decodeURIComponent(parsed.pathname);

  try {
    if (req.method === 'OPTIONS') return send(res, 204, {});
    if (pathname.startsWith('/api/')) return await handleApi(req, res, pathname, parsed.query);

    // پنل اصلی ریت — فایل HTML موجود در ریشه ریپو، بدون هیچ تغییری
    if (pathname === '/feedback-panel') {
      const f = findFeedbackHtml();
      if (!f) return notFound(res);
      return send(res, 200, fs.readFileSync(f, 'utf8'), 'raw');
    }
    if (pathname === '/shared/' + (pathname.split('/shared/')[1] || '')) {
      return serveStatic(res, SHARED, pathname.split('/shared/')[1] || '');
    }
    if (pathname === '/' || pathname === '/index.html') return serveStatic(res, PUBLIC, 'index.html');
    return serveStatic(res, PUBLIC, pathname.replace(/^\/+/, ''));
  } catch (e) {
    console.error(e);
    return bad(res, e.status ? e.message : 'خطای داخلی سرور: ' + e.message, e.status || 500);
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('سامانه کنترل کیفیت CRM اجرا شد  →  http://0.0.0.0:' + server.address().port);
  // راه‌اندازی اتصال پوشه‌ی دیتای تماس (بازبینی هر ۱۵ ثانیه data/calls)
  loadStore();
  /* بازیابی خودکار دیتای نمونه‌ی تماس: محیط پیش‌نمایش فایل‌های gitignore را
   * بین نوبت‌ها نگه نمی‌دارد؛ نسخه‌ی ترک‌شده در data/seed-calls به data/calls برمی‌گردد. */
  try {
    const callsDir = path.join(DATA_DIR, 'calls');
    const seedCalls = path.join(DATA_DIR, 'seed-calls');
    if (fs.existsSync(seedCalls)) {
      fs.mkdirSync(callsDir, { recursive: true });
      const hasXlsx = fs.readdirSync(callsDir).some((f) => /\.xlsx?$/i.test(f));
      if (!hasXlsx) {
        fs.readdirSync(seedCalls).filter((f) => /\.xlsx?$/i.test(f)).forEach((f) => {
          fs.copyFileSync(path.join(seedCalls, f), path.join(callsDir, f));
        });
        console.log('[calls] فایل‌های نمونه از seed-calls برگردانده شدند');
      }
    }
  } catch (e) { console.warn('[calls] seed-calls:', e.message); }
  CallWatcher.start(db, () => saveStore());
  // راه‌اندازی همگام‌سازی گوگل شیت (اگر فعال باشد)
  try { Sheets.startPolling(db, () => saveStore()); } catch(e) { console.warn('[sheets] start:', e.message); }
});

process.on('SIGINT', () => { saveStore(true); process.exit(0); });
process.on('SIGTERM', () => { saveStore(true); process.exit(0); });
