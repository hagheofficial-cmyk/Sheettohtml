/* storage.js — لایه داده مرورگر (localStorage) با همان رابط API نسخه سروری.
 * بدون سرور؛ فقط این فایل را با fetch به API واقعی CRM عوض کنید — بقیه UI دست نمی‌خورد. */
(function () {
'use strict';
const C = window.QCCalc, R = window.QCReports, KEY = 'crmqc.db.v1';
let db = null, saveTimer = null;

function loadDb() {
  let raw = null;
  try { raw = localStorage.getItem(KEY); } catch (e) {}
  if (raw) { try { db = JSON.parse(raw); } catch (e) { db = null; } }
  if (!db || !db.agents) {
    db = JSON.parse(JSON.stringify(window.QC_SEED));
    db.tickets = []; db.socials = []; db.callFeedbacks = []; db.callImport = null; db.callRaw = null;
    db.seq = { ticket: 1, social: 1, agent: (db.agents[db.agents.length - 1].id || 0) + 1 };
    db.createdAt = new Date().toISOString();
    saveDb(true);
  }
  /* میگریشن ساختاری */
  if (!db.agentActions) db.agentActions = {};
  if (!db.seq.action) db.seq.action = 1;
  if (!Array.isArray(db.callFeedbacks)) db.callFeedbacks = [];
}
function saveDb(sync) {
  const w = () => { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) {} };
  if (sync) return w();
  clearTimeout(saveTimer); saveTimer = setTimeout(w, 300);
}
if (typeof window.addEventListener === 'function') window.addEventListener('pagehide', () => saveDb(true));

const str = (v) => (v == null ? '' : String(v)).trim();
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
  let rows = R.filterRows(db[kind], q);
  if (kind === 'socials' && q.sla) rows = rows.filter((r) => r.slaStatus === q.sla);
  if (q.search) {
    const t = str(q.search);
    rows = rows.filter((r) => ((r.agentName||'')+' '+(r.ticketCode||'')+' '+(r.messenger||'')+' '+(r.qcAgent||'')+' '+(r.comment||'')).includes(t));
  }
  rows = rows.slice().sort((a, b) => b.id - a.id);
  const total = rows.length, page = +q.page || 1, per = Math.min(+q.per || 15, 500);
  return { rows: clone(rows.slice((page-1)*per, page*per)), total, page, per };
}

function route(method, url, body) {
  // کوئری را اول جدا کن — تاریخ‌ها شامل «/» هستند و نباید در مسیر شکسته شوند
  const [pathPart, qsAll] = url.slice(1).split('?');
  const parts = pathPart.split('/');
  if (parts[0] !== 'api') bad('not found', 404);
  const name = parts[1];
  const q = {};
  if (qsAll) new URLSearchParams(qsAll).forEach((v, k) => { q[k] = v; });
  let id = null;
  if (parts[2] != null) id = decodeURIComponent(parts[2]);

  if (name === 'bootstrap' && method === 'GET') {
    return {
      agents: clone(db.agents.filter((a) => a.active)),
      teams: [...new Set(db.agents.filter((a) => a.active).map((a) => a.team))],
      qcAgents: clone(db.qcAgents),
      lists: clone(db.lists),
      settings: clone(db.settings),
      agentActions: clone(db.agentActions || {}),
      counts: { tickets: db.tickets.length, socials: db.socials.length, calls: (db.callFeedbacks || []).length, callMeta: db.callImport || null }
    };
  }
  if (name === 'tickets' && method === 'GET' && id == null) return list('tickets', q);
  if (name === 'tickets' && method === 'POST') {
    const n = normalizeTicket(body); if (typeof n === 'string') bad(n);
    db.tickets.push(n); saveDb(); return clone(n);
  }
  if (name === 'tickets' && method === 'GET') { const r = db.tickets.find((x) => x.id === +id); return r ? clone(r) : bad('یافت نشد', 404); }
  if (name === 'tickets' && method === 'PUT') { const r = db.tickets.find((x) => x.id === +id); if (!r) bad('یافت نشد', 404); const n = normalizeTicket(body, r); if (typeof n === 'string') bad(n); db.tickets = db.tickets.map((x) => x.id === r.id ? n : x); saveDb(); return clone(n); }
  if (name === 'tickets' && method === 'DELETE') { db.tickets = db.tickets.filter((x) => x.id !== +id); saveDb(); return { ok: true }; }

  if (name === 'socials' && method === 'GET' && id == null) return list('socials', q);
  if (name === 'socials' && method === 'POST') {
    const n = normalizeSocial(body); if (typeof n === 'string') bad(n);
    db.socials.push(n); saveDb(); return clone(n);
  }
  if (name === 'socials' && method === 'GET') { const r = db.socials.find((x) => x.id === +id); return r ? clone(r) : bad('یافت نشد', 404); }
  if (name === 'socials' && method === 'PUT') { const r = db.socials.find((x) => x.id === +id); if (!r) bad('یافت نشد', 404); const n = normalizeSocial(body, r); if (typeof n === 'string') bad(n); db.socials = db.socials.map((x) => x.id === r.id ? n : x); saveDb(); return clone(n); }
  if (name === 'socials' && method === 'DELETE') { db.socials = db.socials.filter((x) => x.id !== +id); saveDb(); return { ok: true }; }

  if (name === 'reports' && method === 'GET') {
    const type = q.type || 'social';
    const level = q.level === 'team' ? 'team' : 'agent';
    if (type === 'combined') return { type, level, rows: R.combinedAgentReport(db, q) };
    const tt = type === 'ticket' ? 'ticket' : 'social';
    return { type: tt, level, rows: tt === 'ticket' ? R.ticketReport(db, tt === 'ticket' ? level : level, q) : R.socialReport(db, level, q) };
  }

  /* پرونده تلفنی کارشناس: نام یا داخلی */
  if (name === 'portfolio' && method === 'GET') {
    const ident = q.ident || '';
    const prof = R.agentProfile(db, C.faToEn(ident), { from: q.from, to: q.to });
    if (!prof) bad('کارشناس با این نام یا داخلی یافت نشد', 404);
    return prof;
  }

  /* ایمپورت دیتای فیدبک تماس (qc_recovery.json پنل) */
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
      const dj = window.QCParse ? window.QCParse.anyToJalali(r.dateRaw || r.registrationDateRaw || r.reviewDate) : null;
      return {
        expertName: window.QCParse ? window.QCParse.normName(r.expertName) : str(r.expertName),
        score: typeof r.score === 'number' ? r.score : (r.score === '' || r.score == null ? null : +r.score),
        redline: (window.QCParse && window.QCParse.isRedline(r.redline)) ? 1 : 0,
        redlineReason: r.redlineReason || '',
        leadName: r.leadName || '', leadPhone: r.leadPhone || '',
        listeningTime: r.listeningTime || '', qcComment: r.qcComment || '',
        reviewDate: dj ? (dj.jy + '/' + String(dj.jm).padStart(2, '0') + '/' + String(dj.jd).padStart(2, '0')) : '',
        formType: formType, elements: r.elements || {}, sourceFile: 'qc_recovery.json'
      };
    };
    const all = [...tele.map((r) => norm(r, 'tele')), ...acc.map((r) => norm(r, 'account')), ...mlm.map((r) => norm(r, 'mlm'))].filter((r) => r.expertName);
    /* recovery فقط ردیف‌های خودش — ردیف‌های اکسل‌های آپلودی و دمو حفظ می‌شوند */
    db.callFeedbacks = (db.callFeedbacks || []).filter((r) =>
      r.demo || (r.sourceFile && r.sourceFile !== 'qc_recovery.json')
    ).concat(all);
    db.callRaw = obj; // اسناد خام برای بازگردانی به پنل
    db.callImport = {
      importedAt: new Date().toISOString(),
      counts: { tele: tele.length, account: acc.length, mlm: mlm.length, total: all.length },
      storedActions: obj.storedActions && typeof obj.storedActions === 'object' ? obj.storedActions : {},
      voiceMeta: Object.fromEntries(Object.entries(obj.voiceMeta || {}).map(([k, v]) => [k, Array.isArray(v) ? { count: v.length } : v]))
    };
    saveDb();
    return { ok: true, counts: db.callImport.counts };
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
      db.callFeedbacks = (db.callFeedbacks || []).filter((r) => {
        const d = String(r.reviewDate || '');
        if (!d) return true;
        if (from && d >= from && (!to || d <= to)) return false;
        return true;
      });
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
    const inRange = (d) => {
      const s = String(d || '');
      if (!s) return !(from || to);
      if (from && s < from) return false;
      if (to && s > to) return false;
      return true;
    };
    return clone({
      schema: 'crm-qc-backup', version: 2, exportedAt: new Date().toISOString(),
      range: { from: from || null, to: to || null },
      settings: db.settings, agents: db.agents, qcAgents: db.qcAgents,
      agentActions: db.agentActions || {},
      tickets: db.tickets.filter((r) => inRange(r.reviewDate) || inRange(r.ticketDate)),
      socials: db.socials.filter((r) => inRange(r.reviewDate) || inRange(r.socialDate)),
      callFeedbacks: (db.callFeedbacks || []).filter((r) => inRange(r.reviewDate)),
      callImport: db.callImport || null
    });
  }
  if (name === 'backup' && method === 'POST') {
    const b = body.backup || body;
    if (!b || b.schema !== 'crm-qc-backup') bad('ساختار فایل بک‌اپ شناسایی نشد');
    if (b.settings) db.settings = Object.assign(db.settings, clone(b.settings));
    if (Array.isArray(b.agents)) db.agents = clone(b.agents);
    if (Array.isArray(b.qcAgents)) db.qcAgents = clone(b.qcAgents);
    if (b.agentActions) db.agentActions = clone(b.agentActions);
    if (Array.isArray(b.tickets)) db.tickets = clone(b.tickets);
    if (Array.isArray(b.socials)) db.socials = clone(b.socials);
    if (Array.isArray(b.callFeedbacks)) { db.callFeedbacks = clone(b.callFeedbacks); db.callRaw = null; }
    if (b.callImport) db.callImport = clone(b.callImport);
    db.seq = {
      ticket: Math.max(0, ...db.tickets.map((t) => t.id || 0)) + 1,
      social: Math.max(0, ...db.socials.map((s) => s.id || 0)) + 1,
      agent: Math.max(0, ...db.agents.map((a) => a.id || 0)) + 1
    };
    saveDb();
    return clone({ ok: true, restored: { agents: db.agents.length, tickets: db.tickets.length, socials: db.socials.length, calls: (db.callFeedbacks || []).length } });
  }
  /* APIManager calls subrouts — standlone mirror of server:
   * POST /api/calls/files  { files: [{name, rows}] } — ردیف‌های پارس‌شده ورودی اکسل */
  /* تحلیل بومی تماس — معادل داشبورد پنل روی دیتای مرورگر */
  if (name === 'calls' && id === 'analysis' && method === 'GET') {
    const crit = window.QCParse ? { criteriaFor: (t) => window.QCParse.criteriaFor(t), labelOf: (t, k) => window.QCParse.labelOf(t, k) } : null;
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
        const ftype = QP ? (QP.formTypeOfFileName(fname) || QP.sniffFormType(rows)) : null;
        if (!ftype) { results.push({ name: fname, ok: false, reason: 'نوع فرم تشخیص داده نشد' }); continue; }
        const parsed = QP.parseRows(rows, ftype);
        if (!parsed.length) { results.push({ name: fname, ok: false, reason: 'ردیفی یافت نشد', type: ftype }); continue; }
        db.callFeedbacks = db.callFeedbacks.filter((r) => r.sourceFile !== fname);
        for (const r of parsed) db.callFeedbacks.push(Object.assign({ sourceFile: fname, actions: '' }, r));
        results.push({ name: fname, ok: true, type: ftype, count: parsed.length });
      }
      const seen = new Map(); const out = [];
      for (const r of db.callFeedbacks) {
        const key = r.sourceFile ? (r.sourceFile + '|' + (r.expertName || '') + '|' + (r.leadPhone || '') + '|' + (r.reviewDate || '')) : null;
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
  /* اقدامات اصلاحی (native) */
  if (name === 'actions') {
    if (!db.agentActions) db.agentActions = {};
    if (!db.seq.action) db.seq.action = 1;
    if (id == null && method === 'GET') {
      const agent = q.agent || null;
      return agent ? clone(db.agentActions[agent] || []) : clone(db.agentActions);
    }
    if (id == null && method === 'POST') {
      const agent = str(body.agent), title = str(body.title);
      if (!agent || !title) throw new Error('عنوان اقدام و نام کارشناس الزامی است');
      const it = {
        id: db.seq.action++, agent,
        title, date: str(body.date) || C.formatJalali(C.todayJalali()),
        status: str(body.status) || 'انجام نشده',
        note: str(body.note), createdAt: new Date().toISOString()
      };
      if (!db.agentActions[agent]) db.agentActions[agent] = [];
      db.agentActions[agent].push(it);
      saveDb();
      return clone(it);
    }
    if (id != null && method === 'PUT') {
      const aid = +id;
      for (const nm of Object.keys(db.agentActions)) {
        const it = (db.agentActions[nm] || []).find((x) => x.id === aid);
        if (it) {
          if (body.title != null) it.title = str(body.title);
          if (body.status != null) it.status = str(body.status);
          if (body.date != null) it.date = str(body.date);
          if (body.note != null) it.note = str(body.note);
          saveDb(); return clone(it);
        }
      }
      throw new Error('اقدام یافت نشد');
    }
    if (id != null && method === 'DELETE') {
      const aid = +id;
      for (const nm of Object.keys(db.agentActions)) {
        const arr = db.agentActions[nm];
        const i = arr.findIndex((x) => x.id === aid);
        if (i >= 0) { arr.splice(i, 1); saveDb(); return { ok: true }; }
      }
      throw new Error('اقدام یافت نشد');
    }
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

  if (name === 'agents' && method === 'GET' && id == null) return clone(db.agents);
  if (name === 'agents' && method === 'POST') {
    const b = body;
    if (!str(b.name) || !str(b.team)) bad('نام و تیم الزامی است');
    if (db.agents.some((a) => a.name === str(b.name))) bad('کارشناسی با این نام وجود دارد');
    let ext = b.ext != null && b.ext !== '' ? b.ext : undefined;
    if (ext != null && db.agents.some((a) => a.ext === ext)) bad('این داخلی تکراری است');
    if (ext == null) { do { ext = 9000 + Math.floor(Math.random() * 999); } while (db.agents.some((a) => a.ext === ext)); }
    const a = { id: db.seq.agent++, name: str(b.name), team: str(b.team), ext, active: true };
    db.agents.push(a); saveDb(); return clone(a);
  }
  if (name === 'agents' && id != null) {
    const a = db.agents.find((x) => x.id === +id); if (!a) bad('یافت نشد', 404);
    if (method === 'PUT') {
      if (body.name != null) { const nm = str(body.name); if (!nm) bad('نام نمی‌تواند خالی باشد'); if (db.agents.some(x => x.name === nm && x.id !== a.id)) bad('این نام تکراری است'); a.name = nm; }
      if (body.team != null) { const tm = str(body.team); if (!tm) bad('تیم نمی‌تواند خالی باشد'); a.team = tm; }
      if (body.ext !== undefined) { const ex = body.ext === '' || body.ext == null ? null : +body.ext; if (ex != null && db.agents.some(x => x.ext === ex && x.id !== a.id)) bad('این داخلی تکراری است'); a.ext = ex; }
      if (typeof body.active === 'boolean') a.active = body.active; saveDb(); return clone(a);
    }
    if (method === 'DELETE') { a.active = false; saveDb(); return { ok: true, archived: true }; }
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
    saveDb(); return clone(db.settings);
  }
  bad('not found', 404);
}

window.LocalApi = {
  get(url) { return Promise.resolve().then(() => route('GET', url)); },
  post(url, b) { return Promise.resolve().then(() => route('POST', url, b)); },
  put(url, b) { return Promise.resolve().then(() => route('PUT', url, b)); },
  del(url) { return Promise.resolve().then(() => route('DELETE', url)); },
  backup() { return clone(db); },
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
