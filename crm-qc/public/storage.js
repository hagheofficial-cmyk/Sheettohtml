/* storage.js — لایه داده مرورگر (localStorage) با همان رابط API نسخه سروری.
 * بدون سرور؛ فقط این فایل را با fetch به API واقعی CRM عوض کنید — بقیه UI دست نمی‌خورد. */
(function () {
'use strict';
const C = window.QCCalc, R = window.QCReports, KEY = 'crmqc.db.v1';
const Registry = window.QCRegistry, ImportData = window.QCImport, X = window.QCExpertRef;
const A = window.QCAccess, F = window.QCFiscal, E = window.QCElements;
let db = null, saveTimer = null;
/* نشست فعلی (کاربر واردشده). در Apps Script سمت سرور با هر درخواست ست می‌شود. */
let session = null;

function loadDb() {
  let raw = null;
  try { raw = localStorage.getItem(KEY); } catch (e) {}
  if (raw) { try { db = JSON.parse(raw); } catch (e) { db = null; } }
  if (!db || !db.agents) {
    db = JSON.parse(JSON.stringify(window.QC_SEED));
    db.tickets = Array.isArray(db.tickets) ? db.tickets : [];
    db.socials = Array.isArray(db.socials) ? db.socials : [];
    db.callFeedbacks = Array.isArray(db.callFeedbacks) ? db.callFeedbacks : [];
    db.callRaw = db.callRaw || null;
    if (db.callImport === undefined) db.callImport = null;
    db.seq = { ticket: Math.max(0, ...db.tickets.map((t) => t.id || 0)) + 1,
               social: Math.max(0, ...db.socials.map((x) => x.id || 0)) + 1,
               agent: Math.max(0,...db.agents.map(a=>Number(a.id)||0)) + 1 };
    db.createdAt = new Date().toISOString();
    saveDb(true);
  }
  if (!db.datasetId) db.datasetId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : 'browser-' + Date.now() + '-' + Math.random().toString(36).slice(2);
  /* میگریشن ساختاری */
  if (!db.agentActions) db.agentActions = {};
  if (!db.seq.action) db.seq.action = 1;
  if (!Array.isArray(db.callFeedbacks)) db.callFeedbacks = [];
  X.ensure(db);
  if (!db.settings.scoreBands) db.settings.scoreBands = [90, 75, 50];
  if (!db.settings.defaultPreset) db.settings.defaultPreset = 'cur';
  /* ماه‌های مالی و کاربران QC: هر دو مستقیم روی شیت هم قابل ویرایش‌اند. */
  if (!Array.isArray(db.fiscalMonths)) db.fiscalMonths = [];
  db.fiscalMonths = F.normalizeMonths(db.fiscalMonths);
  if (!Array.isArray(db.qcUsers)) db.qcUsers = [];
  if (!db.settings.authMode) db.settings.authMode = 'auto';
}
function saveDb(sync) {
  const w = () => { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) {} };
  if (window.APP_SCRIPT_SERVER) {
    if (sync) return w();
    window.__GAS_DB_DIRTY__ = true;
    return;
  }
  if (sync) return w();
  clearTimeout(saveTimer); saveTimer = setTimeout(w, 300);
}
if (typeof window.addEventListener === 'function') window.addEventListener('pagehide', () => saveDb(true));

const str = (v) => (v == null ? '' : String(v)).trim();
const text = str; /* نام دیگر str؛ در لایه‌ی دسترسی/ماه مالی استفاده می‌شود */
const clone = (o) => (o == null ? o : JSON.parse(JSON.stringify(o)));
function jstr(v) { const j = C.parseJalali(v); return j ? C.formatJalali(j) : null; }
function teamOf(name) { const a = db.agents.find((x) => x.name === name); return a ? a.team : ''; }
function bad(msg, st) { const e = new Error(msg); e.status = st || 400; throw e; }

function normalizeTicket(b, ex) {
  const t = ex ? Object.assign({}, ex) : {};
  const now = new Date().toISOString();
  t.qcAgent = str(b.qcAgent); t.reviewDate = jstr(b.reviewDate); t.ticketDate = jstr(b.ticketDate);
  t.agentName = str(b.agentName); t.team = teamOf(t.agentName) || str(b.team);
  t.ticketCode = str(b.ticketCode);
  ['q1', 'q2', 'q3', 'q4'].forEach((k) => t[k] = str(b[k]));
  t.redline = str(b.redline); t.comment = str(b.comment);
  const errs = [];
  if (!t.qcAgent) errs.push('کارشناس کنترل کیفیت');
  if (!t.reviewDate) errs.push('تاریخ بررسی');
  if (!t.ticketDate) errs.push('تاریخ ایجاد تیکت');
  if (!t.agentName) errs.push('نام کارشناس');
  if (!t.ticketCode) errs.push('کد یکتای تیکت');
  ['q1','q2','q3','q4'].forEach((k) => { if (!['1','0','-'].includes(t[k])) errs.push('المان ' + k); });
  if (!['1','0'].includes(t.redline)) errs.push('ردلاین');
  if (errs.length) return 'این موارد نیاز به اصلاح دارند: ' + errs.join('، ');
  const s = C.ticketScore(t.q1, t.q2, t.q3, t.q4, t.redline, db.settings.ticketWeights);
  t.score = s === '' ? null : s;
  if (!ex) { t.id = db.seq.ticket++; t.createdAt = now; }
  t.updatedAt = now;
  return t;
}

function normalizeSocial(b, ex) {
  const s = ex ? Object.assign({}, ex) : {};
  const now = new Date().toISOString();
  s.reviewDate = jstr(b.reviewDate); s.qcAgent = str(b.qcAgent);
  s.receiveDate = jstr(b.receiveDate); s.replyDate = jstr(b.replyDate);
  s.agentName = str(b.agentName); s.team = teamOf(s.agentName) || str(b.team);
  s.messenger = str(b.messenger); s.receiveTime = str(b.receiveTime); s.replyTime = str(b.replyTime);
  s.responseStatus = str(b.responseStatus); s.delayReason = str(b.delayReason); s.reasonVerdict = str(b.reasonVerdict);
  ['qSla','qFollow','qClosing','qTone'].forEach((k) => s[k] = str(b[k]));
  s.comment = str(b.comment);
  const errs = [];
  if (!s.reviewDate) errs.push('تاریخ بررسی');
  if (!s.qcAgent) errs.push('کارشناس QC');
  if (!s.receiveDate) errs.push('تاریخ دریافت پیام');
  if (!s.replyDate) errs.push('تاریخ پاسخدهی');
  if (!s.agentName) errs.push('نام کارشناس');
  if (!s.messenger) errs.push('پیامرسان');
  if (!s.receiveTime || !C.parseTime(s.receiveTime)) errs.push('ساعت دریافت');
  if (!s.replyTime || !C.parseTime(s.replyTime)) errs.push('ساعت پاسخ');
  if (!s.responseStatus) errs.push('وضعیت پاسخ');
  if (!s.reasonVerdict) errs.push('وضعیت تأیید دلیل');
  if (s.responseStatus === 'عدم پاسخ' && !s.delayReason) errs.push('دلیل تأخیر یا عدم پاسخ');
  ['qSla','qFollow','qClosing','qTone'].forEach((k) => { if (!['1','0','-'].includes(s[k])) errs.push('المان ' + k); });
  if (errs.length) return 'این موارد نیاز به اصلاح دارند: ' + errs.join('، ');
  s.receiveWeekday = C.weekdayFa(C.parseJalali(s.receiveDate));
  s.replyWeekday = C.weekdayFa(C.parseJalali(s.replyDate));
  let dur = null, durErr = null;
  if (s.responseStatus === 'پاسخ داده شده') {
    const st = C.combineJalaliTime(C.parseJalali(s.receiveDate), s.receiveTime);
    const en = C.combineJalaliTime(C.parseJalali(s.replyDate), s.replyTime);
    const m = C.businessMinutes(st, en, db.settings);
    if (m === 'خطای تاریخ') durErr = 'خطای تاریخ'; else if (typeof m === 'number') dur = m;
  }
  s.durationMin = dur; s.durationError = durErr;
  s.slaStatus = C.slaStatus(s.responseStatus, durErr ? '' : dur, db.settings.slaMinutes);
  const sc = C.socialScore(s.qSla, s.qFollow, s.qClosing, s.qTone, db.settings.socialWeights);
  s.score = sc === '' ? null : sc;
  if (!ex) { s.id = db.seq.social++; s.createdAt = now; }
  s.updatedAt = now;
  return s;
}

function list(kind, q) {
  let rows = R.filterRows(db[kind], q, db);
  if (kind === 'socials' && q.sla) rows = rows.filter((r) => r.slaStatus === q.sla);
  if (q.search) {
    const t = str(q.search);
    rows = rows.filter((r) => ((r.agentName||'')+' '+(r.ticketCode||'')+' '+(r.messenger||'')+' '+(r.qcAgent||'')+' '+(r.comment||'')).includes(t));
  }
  rows = rows.slice().sort((a, b) => b.id - a.id);
  const total = rows.length, page = +q.page || 1, per = Math.min(+q.per || 15, 500);
  return { rows: clone(rows.slice((page-1)*per, page*per)), total, page, per };
}

/* لایه‌ی احراز هویت + محدوده‌ی داده؛ منطق اصلی در dispatch() است. */
function route(method, url, body) {
  const pathPart = '/' + String(url || '/').replace(/^\/+/, '').split('?')[0];
  if (pathPart.indexOf('/api/auth') === 0) return dispatch(method, url, body);
  /* bootstrap و revision بدون نشست هم پاسخ می‌دهند (دقیقاً مثل server.js):
   * اولی پوسته‌ی خالی + فهرست حساب‌ها را برای صفحه‌ی ورود می‌فرستد و دومی برای
   * همگام‌سازی خودکار مرورگرهاست. */
  const publicPath = pathPart === '/api/bootstrap' || pathPart === '/api/revision';
  const required = A.authRequired(db);
  if (required && !publicPath) {
    const allowed = A.canAccessApi(db, session, method, pathPart);
    if (!allowed.ok) bad(allowed.error, allowed.status || 403);
    if (method !== 'GET') {
      const guard = A.writeGuard(db, session, method, pathPart, body);
      if (!guard.ok) bad(guard.error, guard.status || 403);
    }
  }
  if (method === 'GET' && required && session && !A.isAdmin(session)) {
    /* خواندن‌ها روی کپی محدودشده اجرا می‌شوند؛ نوشتن در این مسیر ممنوع است. */
    const full = db;
    db = A.scopeDb(full, session);
    try { return dispatch(method, url, body); } finally { db = full; }
  }
  return dispatch(method, url, body);
}

/* یک شکل واحد برای bootstrap — ورود موفق هم همین را برمی‌گرداند تا کلاینت
 * بلافاصله بعد از رمز، یک درخواست کامل دیگر نگیرد. */
function bootstrapPayload() {
  const auth = { required: A.authRequired(db), mode: A.authMode(db), accounts: A.accounts(db),
    user: session ? A.publicUser(session) : null, admin: A.isAdmin(session) };
  if (auth.required && !session) {
    return clone({ auth: auth, agents: [], teams: [], qcAgents: [], lists: db.lists,
      fiscalMonths: [], revision: db.revision || 0,
      settings: { orgName: db.settings.orgName || 'سامانه کنترل کیفیت', scoreBands: db.settings.scoreBands,
        defaultPreset: db.settings.defaultPreset, authMode: db.settings.authMode },
      counts: { tickets: 0, socials: 0, calls: 0, callMeta: null } });
  }
  return clone({
    auth: auth,
    fiscalMonths: db.fiscalMonths || [],
    revision: db.revision || 0,
    qcUsers: A.isAdmin(session) ? A.userMask(A.normalizeUsers(db)) : undefined,
    agents: db.agents.filter((a) => a.active),
    teams: [...new Set(db.agents.filter((a) => a.active).map((a) => a.team))],
    qcAgents: db.qcAgents,
    lists: db.lists,
    settings: db.settings,
    counts: { tickets: db.tickets.length, socials: db.socials.length, calls: (db.callFeedbacks || []).length, callMeta: db.callImport || null }
  });
}

function dispatch(method, url, body) {
  // کوئری را اول جدا کن — تاریخ‌ها شامل «/» هستند و نباید در مسیر شکسته شوند
  const [pathPart, qsAll] = url.slice(1).split('?');
  const parts = pathPart.split('/');
  if (parts[0] !== 'api') bad('not found', 404);
  const name = parts[1];
  const q = {};
  if (qsAll) new URLSearchParams(qsAll).forEach((v, k) => { q[k] = v; });
  let id = null;
  if (parts[2] != null) id = decodeURIComponent(parts[2]);

  const datedPath = ['dashboard', 'reports', 'portfolio', 'tickets', 'socials', 'backup', 'expert-ref'].includes(name)
    || (name === 'data' && id === 'status') || (name === 'calls' && (id == null || id === 'analysis'));
  if (datedPath && (method === 'GET' || method === 'DELETE')) {
    const error = R.validateRange(q);
    if (error) bad(error);
  }
  if (name === 'data' && id === 'status' && method === 'GET') return clone(R.dataStatus(db, q));
  if (name === 'portfolio' && id === 'agents' && method === 'GET') return clone({ rows: R.portfolioAgents(db, q) });

  if(name === 'session-snapshot' && method === 'GET')return clone(db);

  if (name === 'auth') return authRoute(method, id, body);

  if (name === 'bootstrap' && method === 'GET') return bootstrapPayload();

  if (name === 'tickets' && method === 'GET' && id == null) return list('tickets', q);
  if (name === 'tickets' && method === 'POST') {
    const n = normalizeTicket(body); if (typeof n === 'string') bad(n);
    db.tickets.push(n); saveDb(); return clone(n);
  }
  if (name === 'tickets' && method === 'GET') { const r = db.tickets.find((x) => x.id === +id); return r ? clone(r) : bad('یافت نشد', 404); }
  if (name === 'tickets' && method === 'PUT') { const r = db.tickets.find((x) => x.id === +id); if (!r) bad('یافت نشد', 404); conflict(r, body); const n = normalizeTicket(body, r); if (typeof n === 'string') bad(n); db.tickets = db.tickets.map((x) => x.id === r.id ? n : x); saveDb(); return clone(n); }
  if (name === 'tickets' && method === 'DELETE') { db.tickets = db.tickets.filter((x) => x.id !== +id); saveDb(); return { ok: true }; }

  if (name === 'socials' && method === 'GET' && id == null) return list('socials', q);
  if (name === 'socials' && method === 'POST') {
    const n = normalizeSocial(body); if (typeof n === 'string') bad(n);
    db.socials.push(n); saveDb(); return clone(n);
  }
  if (name === 'socials' && method === 'GET') { const r = db.socials.find((x) => x.id === +id); return r ? clone(r) : bad('یافت نشد', 404); }
  if (name === 'socials' && method === 'PUT') { const r = db.socials.find((x) => x.id === +id); if (!r) bad('یافت نشد', 404); conflict(r, body); const n = normalizeSocial(body, r); if (typeof n === 'string') bad(n); db.socials = db.socials.map((x) => x.id === r.id ? n : x); saveDb(); return clone(n); }
  if (name === 'socials' && method === 'DELETE') { db.socials = db.socials.filter((x) => x.id !== +id); saveDb(); return { ok: true }; }

  if (name === 'reports' && method === 'GET') {
    const type = q.type || 'social';
    const level = q.level === 'team' ? 'team' : 'agent';
    const elements = R.elementRates ? R.elementRates(db, q) : undefined;
    if (type === 'combined') return { type, level, rows: R.combinedAgentReport(db, q), elements };
    if (type === 'call' && R.callReport) {
      const crit = window.QCParse ? window.QCParse.resolver(db.settings.callCriteria) : {};
      const rep = R.callReport(db, level, q, crit);
      return { type: 'call', level, rows: rep.rows, calls: rep.calls, redlineRows: rep.redlineRows, elements: Object.assign({}, elements, { call: rep.elements }) };
    }
    const tt = type === 'ticket' ? 'ticket' : 'social';
    return { type: tt, level, rows: tt === 'ticket' ? R.ticketReport(db, level, q) : R.socialReport(db, level, q), elements };
  }

  /* پرونده تلفنی کارشناس: نام یا داخلی */
  if (name === 'portfolio' && method === 'GET') {
    const ident = q.ident || '';
    const prof = R.agentProfile(db, C.faToEn(ident), { from: q.from, to: q.to });
    if (!prof) bad('کارشناس با این نام یا داخلی یافت نشد', 404);
    return prof;
  }

  /* ایمپورت دیتای ریت تماس (qc_recovery.json پنل) */
  /* دیتای نمونه — منعکس روت‌های سرور */
  if (name === 'demo' && method === 'POST') {
    const agents = db.agents.filter((a) => a.active);
    const qcs = db.qcAgents && db.qcAgents.length ? db.qcAgents : ['کارشناس ۱'];
    if (!agents.length) bad('ابتدا حداقل یک کارشناس فعال اضافه کنید');
    const now0 = new Date().toISOString();
    const rnd = (arr) => arr[Math.floor(Math.random() * arr.length)];
    const months = [4, 5, 6];
    let addedT = 0, addedS = 0, addedC = 0;
    const mkDate = (jy, jm, jd) => `${jy}/${String(jm).padStart(2, '0')}/${String(jd).padStart(2, '0')}`;

    for (let i = 0; i < 12; i++) {
      const am = rnd(months), ad = 1 + Math.floor(Math.random() * 28);
      const ag = rnd(agents), qc = rnd(qcs);
      const q1 = Math.random() < 0.75 ? '1' : '0', q2 = Math.random() < 0.7 ? '1' : '0',
        q3 = Math.random() < 0.8 ? '1' : '0', q4 = Math.random() < 0.85 ? '1' : '0';
      const rd = Math.random() < 0.12 ? '1' : '0';
      const n = normalizeTicket({
        qcAgent: qc, reviewDate: mkDate(1405, am, Math.min(ad, 30)),
        ticketDate: mkDate(1405, am, Math.max(1, ad - 1)),
        agentName: ag.name, ticketCode: 'DEMO-T-' + (1000 + i),
        q1, q2, q3, q4, redline: rd,
        comment: 'رکورد نمایشی برای تست (قابل حذف یک‌جا)'
      });
      if (typeof n !== 'string') { n.demo = true; db.tickets.push(n); addedT++; }
    }

    for (let i = 0; i < 12; i++) {
      const am = rnd(months), ad = 1 + Math.floor(Math.random() * 28);
      const ag = rnd(agents), qc = rnd(qcs);
      const mode = Math.random();
      const win = mode < 0.6 ? 30 : mode < 0.85 ? 180 : 600;
      const recH = 8 + Math.floor(Math.random() * 8);
      const recM = Math.floor(Math.random() * 60);
      const repH = recH + Math.ceil((recM + win) / 60);
      const repM = (recM + win) % 60;
      const n = normalizeSocial({
        reviewDate: mkDate(1405, am, Math.min(ad, 30)), qcAgent: qc,
        receiveDate: mkDate(1405, am, ad),
        replyDate: repH > 21 ? mkDate(1405, am, Math.min(ad + 1, 30)) : mkDate(1405, am, ad),
        agentName: ag.name,
        messenger: rnd(['واتساپ', 'ایتا', 'رویکا', 'تلگرام']),
        responseStatus: 'پاسخ داده شده',
        receiveTime: `${String(recH).padStart(2, '0')}:${String(recM).padStart(2, '0')}`,
        replyTime: `${String(Math.min(repH, 23)).padStart(2, '0')}:${String(repM).padStart(2, '0')}`,
        reasonVerdict: win <= 60 ? 'کافی' : 'نامبر',
        delayReason: win > 120 ? 'حجم بالای پیام‌ها' : '',
        qSla: Math.random() < 0.7 ? '1' : '0', qFollow: Math.random() < 0.7 ? '1' : '0',
        qClosing: Math.random() < 0.8 ? '1' : '0', qTone: Math.random() < 0.85 ? '1' : '0',
        messageLink: '',
        comment: 'رکورد نمایشی برای تست (قابل حذف یک‌جا)'
      });
      if (typeof n !== 'string') { n.demo = true; db.socials.push(n); addedS++; }
    }

    const calls = [];
    const forms = ['tele', 'account', 'mlm'];
    for (let i = 0; i < 10; i++) {
      const am = rnd(months), ad = 1 + Math.floor(Math.random() * 28);
      const ag = rnd(agents);
      calls.push({
        expertName: ag.name, score: 55 + Math.round(Math.random() * 45),
        redline: Math.random() < 0.1 ? 1 : 0,
        redlineReason: Math.random() < 0.1 ? 'بدرفتاری با مشتری' : '',
        leadName: 'مشتری نمایشی ' + (100 + i),
        leadPhone: '0912' + String(1000000 + Math.floor(Math.random() * 8999999)),
        listeningTime: '00:' + String(30 + Math.floor(Math.random() * 60)) + ':00',
        qcComment: 'رکورد نمایشی برای تست (قابل حذف یک‌جا)',
        reviewDate: mkDate(1405, am, Math.min(ad, 30)),
        formType: forms[i % 3], demo: true
      });
    }
    if (!db.callFeedbacks) db.callFeedbacks = [];
    calls.forEach((c) => db.callFeedbacks.push(c));
    addedC = calls.length;
    if (!db.callImport) db.callImport = {};
    db.callImport.demo = true; db.callImport.importedAt = now0;
    saveDb();
    return { ok: true, added: { tickets: addedT, socials: addedS, calls: addedC } };
  }
  if (name === 'demo' && method === 'DELETE') {
    const t0 = db.tickets.length, s0 = db.socials.length, c0 = (db.callFeedbacks || []).length;
    db.tickets = db.tickets.filter((r) => !r.demo);
    db.socials = db.socials.filter((r) => !r.demo);
    if (db.callFeedbacks) db.callFeedbacks = db.callFeedbacks.filter((r) => !r.demo);
    if (db.callImport && db.callImport.demo) db.callImport = null;
    saveDb();
    return { ok: true, removed: { tickets: t0 - db.tickets.length, socials: s0 - db.socials.length, calls: c0 - (db.callFeedbacks || []).length } };
  }

  if (name === 'calls' && method === 'POST' && id == null) {
    const obj = body.recovery || body;
    const tele = Array.isArray(obj.teleRawData) ? obj.teleRawData : [];
    const acc = Array.isArray(obj.accRawData) ? obj.accRawData : [];
    const mlm = Array.isArray(obj.mlmRawData) ? obj.mlmRawData : [];
    const norm = (r, formType) => {
      const dj = window.QCParse ? window.QCParse.anyToJalali(r.reviewDate || r.registrationDateRaw || r.dateRaw) : null;
      return {
        expertName: window.QCParse ? window.QCParse.normName(r.expertName) : str(r.expertName),
        score: C.normalizeScore(r.score),
        redline: (window.QCParse && window.QCParse.isRedline(r.redline)) ? 1 : 0,
        redlineReason: r.redlineReason || '',
        leadName: r.leadName || '', leadPhone: r.leadPhone || '',
        listeningTime: str(r.listeningTime), callDuration: str(r.callDuration), qcAgent: str(r.qcAgent), qcComment: str(r.qcComment),
        reviewDate: dj ? (dj.jy + '/' + String(dj.jm).padStart(2, '0') + '/' + String(dj.jd).padStart(2, '0')) : '',
        formType: formType, elements: r.elements || {}, sourceFile: 'qc_recovery.json'
      };
    };
    const all = [...tele.map((r) => norm(r, 'tele')), ...acc.map((r) => norm(r, 'account')), ...mlm.map((r) => norm(r, 'mlm'))].filter((r) => r.expertName);
    const changes = ImportData.calls(db, all, body.mode || 'append', 'qc_recovery.json');
    db.callRaw = obj; // اسناد خام برای بازگردانی به پنل
    db.callImport = {
      importedAt: new Date().toISOString(),
      counts: { tele: tele.length, account: acc.length, mlm: mlm.length, total: all.length },
      storedActions: obj.storedActions && typeof obj.storedActions === 'object' ? obj.storedActions : {},
      voiceMeta: Object.fromEntries(Object.entries(obj.voiceMeta || {}).map(([k, v]) => [k, Array.isArray(v) ? { count: v.length } : v]))
    };
    saveDb();
    return { ok: true, counts: db.callImport.counts, changes };
  }
  if (name === 'calls' && method === 'GET' && id == null) {
    const meta = db.callImport || null;
    const freshRaw = db.callRaw || null;
    return { meta, count: (db.callFeedbacks || []).length, raw: (q.full === '1' && freshRaw) ? freshRaw : undefined };
  }
  if (name === 'calls' && method === 'DELETE') {
    const from = q.from || '';
    const to = q.to || '';
    const before = (db.callFeedbacks || []).length;
    if (from || to) {
      db.callFeedbacks = (db.callFeedbacks || []).filter((r) => !R.inRange(r.reviewDate, from, to));
    } else {
      db.callFeedbacks = [];
    }
    const removed = before - db.callFeedbacks.length;
    if (!db.callFeedbacks.length) { db.callImport = null; db.callRaw = null; }
    saveDb();
    return { ok: true, removed };
  }

  /* بک‌اپ کامل / بازیابی در نسخه تک‌فایل */
  if (name === 'backup' && method === 'GET') {
    const from = q.from || '';
    const to = q.to || '';
    const inRange = (d) => R.inRange(d, from, to);
    return clone({
      schema: 'crm-qc-backup', version: 3, datasetId: db.datasetId, exportedAt: new Date().toISOString(),
      range: { from: from || null, to: to || null },
      settings: db.settings, agents: db.agents, qcAgents: db.qcAgents,
      agentActions: db.agentActions || {},
      actionTypes: X.actionTypes(db),
      reminders: X.reminderList(db),
      tickets: db.tickets.filter((r) => inRange(r.reviewDate)),
      socials: db.socials.filter((r) => inRange(r.reviewDate)),
      callFeedbacks: (db.callFeedbacks || []).filter((r) => inRange(r.reviewDate)),
      callImport: db.callImport || null
    });
  }
  if (name === 'backup' && method === 'POST') {
    const result = ImportData.restore(db, body.backup || body, body.mode);
    X.ensure(db);
    saveDb(); return clone(result);
  }
  /* APIManager calls subrouts — standlone mirror of server:
   * POST /api/calls/files  { files: [{name, rows}] } — ردیف‌های پارس‌شده ورودی اکسل */
  /* تحلیل بومی تماس — معادل داشبورد پنل روی دیتای مرورگر */
  if (name === 'calls' && id === 'analysis' && method === 'GET') {
    const crit = window.QCParse ? window.QCParse.resolver(db.settings.callCriteria) : null;
    return R.callAnalysis(db, q, crit || {});
  }
  if (name === 'calls' && (id === 'files' || id === 'rescan' || id === 'dirstatus')) {
    if (id === 'files' && method === 'POST') {
      const QP = window.QCParse;
      const files = Array.isArray(body.files) ? body.files : (body.name && Array.isArray(body.rows) ? [body] : []);
      if (!files.length) throw new Error('فایلی دریافت نشد');
      if (!db.callFeedbacks) db.callFeedbacks = [];
      const results = [];
      for (const f of files.slice(0, 200)) {
        const fname = str(f.name) || 'unnamed.xlsx';
        const rows = Array.isArray(f.rows) ? f.rows : [];
        const ftype = QP ? (QP.formTypeOfFileName(fname) || QP.teamForm(str(body.team)) || QP.sniffFormType(rows, db.settings.callCriteria)) : null;
        if (!ftype) { results.push({ name: fname, ok: false, reason: 'نوع فرم تشخیص داده نشد' }); continue; }
        const parsed = QP.parseRows(rows, ftype, { agents: db.agents, criteria: db.settings.callCriteria, team: str(body.team) });
        if (!parsed.length) { results.push({ name: fname, ok: false, reason: 'ردیفی یافت نشد', type: ftype }); continue; }
        const changes = ImportData.calls(db, parsed.map(r => Object.assign({ sourceFile: fname }, r)), body.mode || 'append', fname);
        results.push({ name: fname, ok: true, type: ftype, count: parsed.length, changes, diagnostics: QP.importDiagnostics(parsed, db.agents) });
      }
      const seen = new Map(); const out = [];
      for (const r of db.callFeedbacks) {
        const key = QP.callRowKey(r);
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
      saveDb();
      return { ok: true, results, counts: db.callImport.counts };
    }
    /* در نسخه تک‌فایل پوشه‌ی سروری وجود ندارد — برای سازگاری UI خروجی سازگار می‌دهیم */
    if (id === 'rescan' && method === 'POST') return { ok: true, changed: false, delta: {}, status: dirstatusLocal() };
    if (id === 'dirstatus' && method === 'GET') return dirstatusLocal();
  }
  /* مرجع کارشناسان — همان منطق سرور (shared/expertRef.js) */
  if (name === 'expert-ref' && method === 'GET') {
    if (id == null) return clone(X.overview(db, q));
    if (id === 'review') return clone(X.reviewDashboard(db, q));
    return clone(X.detail(db, id, q));
  }
  if (name === 'action-types') {
    if (method === 'GET') return { items: X.actionTypes(db) };
    if (method === 'POST') { const items = X.addActionType(db, body.label); saveDb(); return { items }; }
    if (method === 'DELETE') { const items = X.deleteActionType(db, body.label); saveDb(); return { items }; }
  }
  /* اقدامات اصلاحی (native) — ثبت/لیست/وضعیت/نتیجه */
  if (name === 'actions') {
    X.ensure(db);
    if (id == null && method === 'GET') {
      const agent = q.agent || null;
      return agent ? clone(db.agentActions[agent] || []) : clone(db.agentActions);
    }
    if (id == null && method === 'POST') { const it = X.saveAction(db, body); saveDb(); return clone(it); }
    if (id != null && method === 'PUT') { const it = X.updateAction(db, +id, body); saveDb(); return clone(it); }
    if (id != null && method === 'DELETE') { const result = X.deleteAction(db, +id); saveDb(); return result; }
  }
  /* یادآورهای کارشناس */
  if (name === 'reminders') {
    X.ensure(db);
    if (id == null && method === 'GET') return clone(X.reminderList(db, q.agent || null));
    if (id == null && method === 'POST') { const r = X.saveReminder(db, body); saveDb(); return clone(r); }
    if (id != null && method === 'PUT') { const r = X.updateReminder(db, +id, body); saveDb(); return clone(r); }
    if (id != null && method === 'DELETE') { const result = X.deleteReminder(db, +id); saveDb(); return result; }
  }
  function dirstatusLocal() {
    const countsByFile = {};
    for (const r of (db.callFeedbacks || [])) {
      if (!r.sourceFile) continue;
      countsByFile[r.sourceFile] = (countsByFile[r.sourceFile] || 0) + 1;
    }
    const list = Object.entries(countsByFile).map(([fname, rows]) => ({
      name: fname,
      kind: fname === 'qc_recovery.json' ? 'recovery' : (/\.(xlsx|xls|csv)$/i.test(fname) ? 'form' : 'other'),
      type: window.QCParse ? (QP => QP.formTypeOfFileName(fname))(window.QCParse) : null,
      detected: fname === 'qc_recovery.json' ? 'tele+account+mlm' : 'form',
      size: null, mtime: null, rows, state: 'synced', skipped: false
    }));
    /* شمارش زنده از دیتا — در معرض هر تغییری از هر مسیر (فایل، recovery، دمو) */
    const fbx = db.callFeedbacks || [];
    const liveCounts = {
      total: fbx.length,
      tele: fbx.filter((r) => r.formType === 'tele').length,
      account: fbx.filter((r) => r.formType === 'account').length,
      mlm: fbx.filter((r) => r.formType === 'mlm').length,
      demo: fbx.filter((r) => r.demo).length
    };
    return {
      dir: '(حافظه مرورگر — نسخه تک‌فایل)', intervalSec: null,
      syncedAt: (db.callImport && db.callImport.importedAt) || null,
      counts: liveCounts,
      files: list
    };
  }
  if (name === 'dashboard' && method === 'GET') return R.dashboard(db, q);

  if (name === 'agents') {
    if (method === 'GET' && id == null) return clone(db.agents);
    if (method === 'DELETE' && id == null) { const result = Registry.removeAll(db, body); saveDb(); return result; }
    if (method === 'POST' && id === 'bulk') { const result = Registry.bulk(db, body.rows); saveDb(); return result; }
    if (method === 'POST' && id == null) { const row = Registry.save(db, body); saveDb(); return clone(row); }
    if (method === 'PUT' && id != null) { const row = Registry.save(db, body, +id); saveDb(); return clone(row); }
    if (method === 'DELETE' && id != null) { const a = db.agents.find(a => a.id === +id); if (!a) bad('یافت نشد', 404); a.active = false; saveDb(); return { ok: true, archived: true }; }
  }
  if (name === 'criteria') {
    if (method === 'GET') return clone({ config: db.settings.callCriteria || { version: 0, forms: {}, teams: {} }, teams: [...new Set(db.agents.map(a => a.team))] });
    if (method === 'PUT') { const config = window.QCParse.saveTeamConfig(db.settings.callCriteria, body); db.settings.callCriteria = config; saveDb(); return clone({ config }); }
  }

  if (name === 'qc-agents' && method === 'GET' && id == null) return clone(db.qcAgents);
  if (name === 'qc-agents' && method === 'POST') {
    const nm = str(body.name);
    if (!nm) bad('نام الزامی است');
    if (db.qcAgents.includes(nm)) bad('این نام تکراری است');
    db.qcAgents.push(nm); saveDb(); return { ok: true, qcAgents: clone(db.qcAgents) };
  }
  if (name === 'qc-agents' && method === 'DELETE' && id != null) {
    if (db.tickets.some((t) => t.qcAgent === id) || db.socials.some((s) => s.qcAgent === id)) bad('این کارشناس در ارزیابی‌ها استفاده شده و قابل حذف نیست');
    db.qcAgents = db.qcAgents.filter((x) => x !== id); saveDb(); return { ok: true };
  }

  if (name === 'settings' && method === 'GET') return clone(db.settings);
  if (name === 'settings' && method === 'PUT') {
    const b = body;
    ['ticketWeights','socialWeights'].forEach((k) => { if (Array.isArray(b[k]) && b[k].length === 4 && b[k].every((x) => +x >= 0)) { db.settings[k] = b[k].map(Number); } });
    if (b.slaMinutes > 0) db.settings.slaMinutes = +b.slaMinutes;
    if (b.workStart && /^([01]\d|2[0-3]):[0-5]\d$/.test(b.workStart)) db.settings.workStart = b.workStart;
    if (b.workEnd && /^([01]\d|2[0-3]):[0-5]\d$/.test(b.workEnd)) db.settings.workEnd = b.workEnd;
    if (Array.isArray(b.weekendDays) && b.weekendDays.length) db.settings.weekendDays = b.weekendDays;
    if (typeof b.orgName === 'string' && b.orgName.trim()) db.settings.orgName = str(b.orgName);
    if (Array.isArray(b.scoreBands) && b.scoreBands.length === 3) {
      db.settings.scoreBands = b.scoreBands.map((x) => Math.min(100, Math.max(0, +x || 0))).sort((a, b) => b - a);
    }
    if (['cur', 'prev', 'all', 'today'].indexOf(b.defaultPreset) !== -1 || F.isFiscalPreset(b.defaultPreset)) db.settings.defaultPreset = b.defaultPreset;
    if (['auto', 'on', 'off'].indexOf(text(b.authMode)) !== -1) db.settings.authMode = text(b.authMode);
    saveDb(); return clone(db.settings);
  }

  const extended = extendedRoute(method, url, body, name, id, q);
  if (extended !== null) return extended;
  bad('not found', 404);
}

/* ------------------------------------------------------- احراز هویت و دسترسی */
function conflict(row, body) {
  /* همزمانی چند کارشناس: اگر رکورد بعد از بازکردن فرم تغییر کرده باشد،
   * به‌جای بازنویسی بی‌صدا خطای ۴۰۹ می‌دهیم تا کاربر انتخاب کند. */
  const base = body && body.baseUpdatedAt;
  if (base && row && row.updatedAt && String(base) !== String(row.updatedAt) && !body.overwrite) {
    const e = new Error('این رکورد بعد از بازکردن فرم توسط شخص دیگری ویرایش شده است');
    e.status = 409; e.conflict = { current: clone(row) };
    throw e;
  }
}

function authRoute(method, id, body) {
  if (id === 'accounts' && method === 'GET') {
    return { required: A.authRequired(db), mode: A.authMode(db), accounts: A.accounts(db),
      firstRun: !A.normalizeUsers(db).length, orgName: db.settings.orgName || '' };
  }
  if (id === 'login' && method === 'POST') {
    const result = A.login(db, (body || {}).name, (body || {}).password);
    if (!result.ok) bad(result.error, 401);
    /* داده‌ی اولیه‌ی همان کاربر همراه پاسخ ورود برمی‌گردد — با همان محدودیتی
     * که مسیر عادی GET /api/bootstrap اعمال می‌کند. */
    const full = A.normalizeUser(result.user, 0);
    const previousSession = session, previousDb = db;
    session = full;
    try {
      if (!A.isAdmin(full)) db = A.scopeDb(db, full);
      return { ok: true, user: result.user, bootstrap: bootstrapPayload() };
    } finally { session = previousSession; db = previousDb; }
  }
  if (id === 'logout' && method === 'POST') {
    /* خروج: نشست همین لایه پاک می‌شود؛ باطل‌کردن خودِ توکن در لایه‌ی میزبان است
     * (server.js نشست in-memory و Server.gs کلید qctok@… را حذف می‌کند). */
    session = null;
    return { ok: true };
  }
  if (id === 'me' && method === 'GET') {
    return { required: A.authRequired(db), user: session ? A.publicUser(session) : null,
      admin: A.isAdmin(session), accounts: A.accounts(db) };
  }
  if (id === 'setup' && method === 'POST') {
    /* راه‌اندازی اولیه: فقط وقتی هیچ کاربری تعریف نشده مجاز است (بن‌بست مدیر). */
    if (A.normalizeUsers(db).length) bad('قبلاً کاربری تعریف شده است؛ از بخش مدیریت QC استفاده کنید');
    const b = body || {};
    if (!text(b.name)) bad('نام مدیر الزامی است');
    if (!text(b.password)) bad('رمز مدیر الزامی است');
    db.qcUsers = [];
    const row = A.saveUser(db, { name: b.name, password: b.password, role: 'admin', active: true, exts: '*', agents: '', teams: '' });
    saveDb();
    const admin = A.normalizeUser(row, 0);
    const previous = session;
    session = admin;
    try { return { ok: true, user: A.publicUser(admin), bootstrap: bootstrapPayload() }; }
    finally { session = previous; }
  }
  bad('not found', 404);
}

/* کاربران QC (تب QC_Users) — فقط مدیر */
function qcUsersRoute(method, id, body) {
  const users = A.normalizeUsers(db);
  if (method === 'GET' && id == null) {
    return { users: clone(A.userMask(users)), required: A.authRequired(db), mode: A.authMode(db),
      teams: [...new Set(db.agents.map((a) => a.team))].sort(),
      agents: clone(db.agents.map((a) => ({ id: a.id, name: a.name, ext: a.ext, team: a.team, subgroup: a.subgroup || '', active: a.active !== false,
        qcAgents: A.splitList(a.qcAgents) }))) };
  }
  if (method === 'GET' && id != null) {
    const u = users.find((x) => String(x.id) === String(id) || x.key === A.normalizeUser({ name: id }).key);
    if (!u) bad('کاربر یافت نشد', 404);
    return clone(A.userMask([u])[0]);
  }
  if (method === 'POST' || method === 'PUT') {
    const existing = body && body.id != null && body.id !== ''
      ? (db.qcUsers || []).find((u) => String(u.id) === String(body.id)) : null;
    if (method === 'PUT' && !existing) bad('کاربر یافت نشد', 404);
    const row = A.saveUser(db, body || {}, existing);
    if (session && A.normalizeUser({ name: session.name }).key === row.name.toLowerCase().replace(/\s/g, '')) {
      session = A.normalizeUser(row, 0); // تغییر نقش/دسترسی مدیر بلافاصله اعمال شود
    }
    /* تیک‌ها → ستون qcAgents ردیف کارشناسان (تا از شیت/اکسل هم قابل ویرایش باشد) */
    A.syncAgentQcColumn(db, A.normalizeUser(row, 0), (body && body.syncColumn && (body.exts !== undefined || body.agents !== undefined || body.teams !== undefined)) ? 'sync' : 'keep');
    saveDb();
    return { ok: true, user: clone(A.userMask([A.normalizeUser(row, 0)])[0]), users: clone(A.userMask(A.normalizeUsers(db))),
      agents: clone(db.agents.map((a) => ({ id: a.id, name: a.name, ext: a.ext, team: a.team, subgroup: a.subgroup || '', active: a.active !== false,
        qcAgents: A.splitList(a.qcAgents) }))) };
  }
  if (method === 'DELETE' && id != null) {
    const target = users.find((x) => String(x.id) === String(id));
    if (!target) bad('کاربر یافت نشد', 404);
    if (session && target.key === session.key) bad('نمی‌توانید حساب کاربری خودتان را حذف کنید');
    if (target.role === 'admin' && users.filter((u) => u.role === 'admin' && u.active).length <= 1) {
      bad('حداقل یک مدیر فعال باید باقی بماند');
    }
    A.deleteUser(db, target.name); saveDb();
    return { ok: true, users: clone(A.userMask(A.normalizeUsers(db))) };
  }
  bad('not found', 404);
}

/* ماه‌های مالی (تب Fiscal_Months) */
function fiscalRoute(method, id, body) {
  if (method === 'GET') {
    const months = F.normalizeMonths(db.fiscalMonths);
    const today = C.todayJalali();
    return { months: clone(months), options: F.presetOptions(months, C.formatJalali(today)),
      current: F.currentMonth(months, C.formatJalali(today)), previous: F.previousMonth(months, C.formatJalali(today)) };
  }
  if (method === 'PUT') {
    const rows = Array.isArray(body && body.months) ? body.months : [];
    const clean = rows.map((m) => ({ id: text(m.id), name: text(m.name), from: text(m.from), to: text(m.to), note: text(m.note) }))
      .filter((m) => m.name || m.from || m.to);
    clean.forEach((m) => {
      if (!m.name) bad('نام ماه مالی الزامی است');
      if (!C.parseDate(m.from) || !C.parseDate(m.to)) bad('تاریخ «' + m.name + '» نامعتبر است');
    });
    db.fiscalMonths = F.normalizeMonths(clean); saveDb();
    return { ok: true, months: clone(db.fiscalMonths) };
  }
  if (method === 'DELETE' && id != null) {
    db.fiscalMonths = F.normalizeMonths((db.fiscalMonths || []).filter((m) => m.id !== id));
    saveDb(); return { ok: true, months: clone(db.fiscalMonths) };
  }
  bad('not found', 404);
}

/* --------------------------------------------------------------- مسیرهای جدید */
function extendedRoute(method, url, body, name, id, q) {
  if (name === 'qc-users') return qcUsersRoute(method, id, body);
  if (name === 'fiscal-months') return fiscalRoute(method, id, body);
  if (name === 'elements' && method === 'GET') {
    return E.table(db.settings.callCriteria, [...new Set(db.agents.map((a) => a.team))]);
  }
  if (name === 'monthly-summary' && method === 'GET') return F.monthlySummary(db, q);
  if (name === 'revision' && method === 'GET') return { revision: db.revision || 0, at: Date.now() };
  return null;
}

window.LocalApi = {
  // Apps Script uses the same tested route logic on its server-side bundle.
  run(method, url, body) { return route(method, url, body); },
  /* کاربر واردشده؛ null یعنی بدون احراز هویت (همه‌چیز باز). */
  setSession(user) { session = user && user.name ? A.normalizeUser(user, 0) : null; return session; },
  getSession() { return session ? A.publicUser(session) : null; },
  authRequired() { return A.authRequired(db); },
  setRevision(value) { db.revision = Number(value) || 0; },
  get(url) { return Promise.resolve().then(() => route('GET', url)); },
  post(url, b) { return Promise.resolve().then(() => route('POST', url, b)); },
  put(url, b) { return Promise.resolve().then(() => route('PUT', url, b)); },
  del(url, body) { return Promise.resolve().then(() => route('DELETE', url, body)); },
  backup() { return clone(db); },
  /* خودِ آبجکت زنده‌ی داده (بدون کپی عمیق). فقط سمت سرور Apps Script استفاده می‌شود:
   * پیش از نوشتن، پاسخ ساخته شده و before هم کپیِ مستقل است، پس کپی سوم بیهوده است. */
  liveDb() { return db; },
  flush() { clearTimeout(saveTimer); saveTimer=null;localStorage.setItem(KEY,JSON.stringify(db)); },
  replaceSnapshot(value) {
    const next=clone(value);
    if(!next||!Array.isArray(next.agents)||!Array.isArray(next.tickets)||!Array.isArray(next.socials)||!Array.isArray(next.callFeedbacks)||!next.settings||!next.seq||!next.lists)bad('نسخه مرورگر ناقص است');
    if(!window.APP_SCRIPT_SERVER)clearTimeout(saveTimer);saveTimer=null;db=next;
  },
  /* پذیرفتن داده بدون کپی عمیق: برای درخواست‌های خواندنی (GET) که هر چیزی را
   * روی شیت ذخیره نمی‌کنند. روی دادهٔ چند هزار رکوردی، همین یک کپی حذف‌شده
   * چند صد میلی‌ثانیه از هر گزارش می‌گیرد. */
  adoptSnapshot(value) {
    if(!value||!Array.isArray(value.agents)||!Array.isArray(value.tickets)||!Array.isArray(value.socials)||!Array.isArray(value.callFeedbacks)||!value.settings||!value.seq||!value.lists)bad('نسخه مرورگر ناقص است');
    db=value; return db;
  },
  backupSize() { try { return (localStorage.getItem(KEY) || '').length; } catch (e) { return 0; } },
  importBackup(b) {
    if (!b || !b.agents || !b.settings) bad('فایل بک‌اپ نامعتبر است');
    db = clone(b);
    for (const k of ['tickets','socials','callFeedbacks']) if (!Array.isArray(db[k])) db[k] = [];
    if (db.callImport === undefined) db.callImport = null;
    if (!Array.isArray(db.qcAgents)) db.qcAgents = clone(window.QC_SEED.qcAgents);
    if (!db.lists) db.lists = clone(window.QC_SEED.lists);
    if (!db.seq || typeof db.seq !== 'object') db.seq = { ticket: 1, social: 1, agent: 1000 };
    db.seq.ticket = Math.max(db.seq.ticket || 1, 0, ...db.tickets.map((t) => (t.id || 0))) + 1;
    db.seq.social = Math.max(db.seq.social || 1, 0, ...db.socials.map((s) => (s.id || 0))) + 1;
    db.seq.agent = Math.max(db.seq.agent || 1, 0, ...db.agents.map((a) => (a.id || 0))) + 1;
    saveDb(true);
  },
  resetAll() { try { localStorage.removeItem(KEY); } catch (e) {} db = null; loadDb(); }
};
loadDb();
})();
