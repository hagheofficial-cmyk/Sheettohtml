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
      tickets: [], socials: [],
      seq: { ticket: 1, social: 1, agent: (seed.agents[seed.agents.length - 1] || { id: 0 }).id + 1 },
      createdAt: new Date().toISOString()
    });
    saveStore(true);
    console.log('[store] seeded از data/seed.json —', db.agents.length, 'کارشناس');
  }
}

function saveStore(sync) {
  const write = () => {
    const tmp = STORE_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(db, null, 1));
    fs.renameSync(tmp, STORE_FILE); // اتمیک
  };
  if (sync) return write();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(write, 400);
}

/* --------------------------------------------------------------- helpers */
function send(res, code, body, type) {
  const data = type === 'raw' ? body : JSON.stringify(body);
  res.writeHead(code, {
    'Content-Type': type === 'raw' ? 'text/html; charset=utf-8' : 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(data);
}
const ok = (res, body) => send(res, 200, body);
const bad = (res, msg, code) => send(res, code || 400, { error: msg });
const notFound = (res) => send(res, 404, { error: 'یافت نشد' });

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 5e6) { reject(new Error('بدنه درخواست بزرگ است')); req.destroy(); }
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
function inRange(dateStr, from, to) {
  const j = C.parseJalali(dateStr);
  if (!j) return false;
  return C.jalaliInRange(j, from ? C.parseJalali(from) : null, to ? C.parseJalali(to) : null);
}

function filterRows(rows, q) {
  return rows.filter((r) => {
    if (q.from || q.to) { if (!inRange(r.reviewDate, q.from, q.to)) return false; }
    if (q.team && r.team !== q.team) return false;
    if (q.agent && r.agentName !== q.agent) return false;
    if (q.qc && r.qcAgent !== q.qc) return false;
    return true;
  });
}

function scoredRows(rows) { return rows.filter((r) => r.score != null && r.score >= 0 && r.score <= 100); }

/** میانگین نمره‌های نمره‌دار */
function avgScore(rows) { return C.avg(scoredRows(rows).map((r) => r.score)); }
function rateAll(rows, key) { return C.elementRate(rows.map((r) => r[key])); }

function ticketReport(level, q) {
  const rows = filterRows(db.tickets, q);
  const keys = ['q1', 'q2', 'q3', 'q4'];
  const group = level === 'team' ? (r) => r.team : (r) => r.agentName;
  const names = [...new Set(rows.map(group).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fa'));
  return names.map((name) => {
    const rs = rows.filter((r) => group(r) === name);
    const agents = new Set(rs.map((r) => r.agentName)).size;
    return {
      name,
      team: level === 'team' ? name : teamOf(name),
      count: scoredRows(rs).length,          // تعداد ارزیابی نمره‌دار
      agentsEvaluated: level === 'team' ? agents : undefined,
      avgScore: avgScore(rs),                // میانگین نمره نهایی
      q1Rate: rateAll(rs, 'q1'), q2Rate: rateAll(rs, 'q2'),
      q3Rate: rateAll(rs, 'q3'), q4Rate: rateAll(rs, 'q4'),
      redlineZero: rs.filter((r) => r.score === 0 && String(r.redline) === '0').length, // ردلاین صفر
      total: rs.length
    };
  });
}

function socialReport(level, q) {
  const rows = filterRows(db.socials, q);
  const group = level === 'team' ? (r) => r.team : (r) => r.agentName;
  const names = [...new Set(rows.map(group).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fa'));
  const sla = (rs, v) => rs.filter((r) => r.slaStatus === v).length;
  const answered = (rs) => rs.filter((r) => r.responseStatus === 'پاسخ داده شده').length;
  return names.map((name) => {
    const rs = rows.filter((r) => group(r) === name);
    const okS = sla(rs, 'رعایت شده'), badS = sla(rs, 'رعایت نشده');
    const agents = new Set(rs.map((r) => r.agentName)).size;
    return {
      name,
      team: level === 'team' ? name : teamOf(name),
      count: scoredRows(rs).length,                             // تعداد ارزیابی نمره‌دار
      agentsEvaluated: level === 'team' ? agents : undefined,   // تعداد کارشناسان ارزیابی‌شده
      avgScore: avgScore(rs),                                   // میانگین نمره /۱۰۰
      answered: answered(rs),                                   // پیام پاسخ‌داده‌شده
      slaReal: okS + badS === 0 ? '' : C.round2(100 * okS / (okS + badS)), // درصد رعایت SLA واقعی
      qSlaRate: rateAll(rs, 'qSla'),                            // میانگین المان SLA
      qFollowRate: rateAll(rs, 'qFollow'),                      // پیگیری
      qClosingRate: rateAll(rs, 'qClosing'),                    // پایان‌بندی
      qToneRate: rateAll(rs, 'qTone'),                          // لحن
      unanswered: rs.filter((r) => r.responseStatus === 'عدم پاسخ').length, // عدم پاسخ
      slaMissed: badS,                                          // SLA رعایت‌نشده
      avgDurationMin: C.avg(rs.filter((r) => r.durationMin != null).map((r) => r.durationMin)),
      total: rs.length
    };
  });
}

function dashboard(q) {
  const T = filterRows(db.tickets, q);
  const S = filterRows(db.socials, q);
  const Tsc = scoredRows(T), Ssc = scoredRows(S);
  const all = Tsc.map((r) => r.score).concat(Ssc.map((r) => r.score));
  const okS = S.filter((r) => r.slaStatus === 'رعایت شده').length;
  const badS = S.filter((r) => r.slaStatus === 'رعایت نشده').length;
  const bucket = (arr, lo, hi) => arr.filter((x) => x >= lo && (hi == null || x < hi)).length;
  return {
    ticketCount: T.length, ticketScored: Tsc.length,
    socialCount: S.length, socialScored: Ssc.length,
    avgTicket: C.avg(Tsc.map((r) => r.score)),
    avgSocial: C.avg(Ssc.map((r) => r.score)),
    avgAll: C.avg(all),
    slaOk: okS, slaMissed: badS,
    slaReal: okS + badS === 0 ? '' : C.round2(100 * okS / (okS + badS)),
    unanswered: S.filter((r) => r.responseStatus === 'عدم پاسخ').length,
    redlineZero: T.filter((r) => r.score === 0 && String(r.redline) === '0').length,
    dist: [bucket(all, 0, 50), bucket(all, 50, 75), bucket(all, 75, 90), bucket(all, 90, null)],
    latestTickets: T.slice(-6).reverse(), latestSocials: S.slice(-6).reverse()
  };
}

/* ------------------------------------------------------------- فایل HTML اصلی */
function findFeedbackHtml() {
  const files = fs.readdirSync(REPO_ROOT).filter((f) => f.toLowerCase().endsWith('.html'));
  // فایل اصلی پروژه (دستیار فیدبک) — بدون هیچ تغییری سرو می‌شود
  const main = files.find((f) => f.includes('فیدبک')) || files[0];
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

/* -------------------------------------------------------------------- API */
async function handleApi(req, res, pathname, query) {
  const parts = pathname.split('/').filter(Boolean); // ['api', ...]
  const method = req.method;
  const body = method === 'POST' || method === 'PUT' ? await readBody(req) : {};

  /* bootstrap: همه داده‌های مرجع */
  if (pathname === '/api/bootstrap' && method === 'GET') {
    return ok(res, {
      agents: db.agents.filter((a) => a.active),
      teams: [...new Set(db.agents.filter((a) => a.active).map((a) => a.team))],
      qcAgents: db.qcAgents,
      lists: db.lists,
      settings: db.settings,
      counts: { tickets: db.tickets.length, socials: db.socials.length }
    });
  }

  /* داشبورد */
  if (pathname === '/api/dashboard' && method === 'GET') {
    return ok(res, dashboard({ from: query.from, to: query.to }));
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
    const type = query.type === 'social' ? 'social' : 'ticket';
    const level = query.level === 'team' ? 'team' : 'agent';
    const q = { from: query.from, to: query.to, team: query.team, agent: query.agent, qc: query.qc };
    const rows = type === 'ticket' ? ticketReport(level, q) : socialReport(level, q);
    return ok(res, { type, level, rows });
  }

  /* مدیریت کارشناسان */
  if (parts[1] === 'agents') {
    if (parts.length === 2 && method === 'GET') return ok(res, db.agents);
    if (parts.length === 2 && method === 'POST') {
      const name = str(body.name), team = str(body.team), ext = body.ext === '' || body.ext == null ? null : +body.ext;
      if (!name || !team) return bad(res, 'نام و تیم الزامی است');
      if (db.agents.some((a) => a.name === name)) return bad(res, 'کارشناسی با این نام وجود دارد');
      const a = { id: db.seq.agent++, ext, name, team, active: true };
      db.agents.push(a);
      saveStore();
      return ok(res, a);
    }
    if (parts.length === 3 && method === 'PUT') {
      const a = db.agents.find((x) => x.id === +parts[2]);
      if (!a) return notFound(res);
      if (body.name != null) a.name = str(body.name);
      if (body.team != null) a.team = str(body.team);
      if (body.ext !== undefined) a.ext = body.ext === '' || body.ext == null ? null : +body.ext;
      if (body.active !== undefined) a.active = !!body.active;
      saveStore();
      return ok(res, a);
    }
    if (parts.length === 3 && method === 'DELETE') {
      const a = db.agents.find((x) => x.id === +parts[2]);
      if (!a) return notFound(res);
      a.active = false; // حذف نرم تا سوابق حفظ شود
      saveStore();
      return ok(res, { archived: true });
    }
  }

  /* کارشناسان QC */
  if (parts[1] === 'qc-agents') {
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
      saveStore();
      return ok(res, s);
    }
  }

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

    // پنل اصلی فیدبک — فایل HTML موجود در ریشه ریپو، بدون هیچ تغییری
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
    return bad(res, 'خطای داخلی سرور: ' + e.message, 500);
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('سامانه کنترل کیفیت CRM اجرا شد  →  http://0.0.0.0:' + PORT);
});

process.on('SIGINT', () => { saveStore(true); process.exit(0); });
process.on('SIGTERM', () => { saveStore(true); process.exit(0); });
