/* =========================================================================
 * expertRef.js — منطق «مرجع کارشناسان»
 *   کارت هر کارشناس (شماره داخلی، آخرین اقدام انجام‌شده + نتیجه، شمارش ریت تماس/تیکت/سوشال،
 *   نمره ماه جاری)، ماتریس مشکلات (هر المان ارزیابی + نرخ عدم رعایت)، اقدامات اصلاحی،
 *   یادآورها، فهرست نوع اقدام‌ها و تاریخچه‌ی کامل (اقدام/یادآور/فرم تیکت و سوشال).
 *
 * مشترک بین سرور (server.js) و نسخه‌ی مرورگر (storage.js — LocalApi).
 * همه‌ی تابع‌های تغییردهنده خطای قابل‌نمایش با status می‌اندازند.
 * ========================================================================= */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./calc.js'), require('./reports.js'), require('./parseQc.js'));
  else root.QCExpertRef = factory(root.QCCalc, root.QCReports, root.QCParse);
})(typeof self !== 'undefined' ? self : this, function (C, R, P) {
  'use strict';

  const DEFAULT_ACTION_TYPES = [
    'تماس پیگیری', 'جلسه بازخورد', 'آموزش مجدد', 'ارسال بازخورد کتبی',
    'هشدار کتبی', 'مشاوره با سرپرست', 'بررسی مجدد نمونه'
  ];
  const RESULTS = ['در انتظار', 'موفق', 'ناموفق', 'نیاز به پیگیری'];
  const DONE = 'انجام شده', NOT_DONE = 'انجام نشده';
  const STATUSES = [NOT_DONE, DONE];
  const FORM_LABEL = { tele: 'Telesales', account: 'اکانت', mlm: 'MLM/BNPL' };
  const TICKET_ITEMS = [['q1', 'پیگیری و رسیدگی'], ['q2', 'ثبت یادداشت'], ['q3', 'دلیل بستن تیکت'], ['q4', 'ثبت اکشن در CRM']];
  const SOCIAL_ITEMS = [['qSla', 'پاسخ‌دهی و SLA'], ['qFollow', 'پیگیری'], ['qClosing', 'پایان‌بندی'], ['qTone', 'لحن']];

  /* ------------------------------------------------------------ ابزار */
  function fail(message, status) { const e = new Error(message); e.status = status || 400; throw e; }
  const str = (v) => (v == null ? '' : String(v)).trim();
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const nowIso = () => new Date().toISOString();
  /** فاصله‌ی روز بین یک تاریخ جلالی و now (منفی = گذشته). */
  function dayDiff(jstr, now) {
    const j = C.parseJalali(jstr);
    if (!j) return null;
    const a = C.jalaliToDate(j), b = C.jalaliToDate(now);
    return Math.round((a - b) / 86400000);
  }
  /** آخرین زمان تغییر (ISO) بین اقدام‌ها و یادآورها؛ null اگر هیچ‌کدام نیست. */
  function latestStamp(list) {
    let best = '';
    list.forEach((x) => { const s = x.updatedAt || x.createdAt || ''; if (s && s > best) best = s; });
    return best || null;
  }
  function dateKey(v) { const j = C.parseJalali(v); return j ? j.jy * 10000 + j.jm * 100 + j.jd : 0; }
  function jalaliOrFail(v, message) {
    const j = C.parseJalali(v);
    if (!j) fail(message || 'تاریخ معتبر نیست؛ مثل 1405/07/22');
    return C.formatJalali(j);
  }
  const todayStr = () => C.formatJalali(C.todayJalali());

  /** مقادیر پیش‌فرض و میگریشن‌های بی‌ریسک؛ هر بار قبل از استفاده صدا زده می‌شود. */
  function ensure(db) {
    if (!Array.isArray(db.actionTypes)) db.actionTypes = DEFAULT_ACTION_TYPES.slice();
    if (!Array.isArray(db.reminders)) db.reminders = [];
    if (!db.agentActions) db.agentActions = {};
    if (!db.seq) db.seq = {};
    if (!db.seq.action) db.seq.action = Math.max(0, ...Object.values(db.agentActions).flat().map((a) => Number(a.id) || 0)) + 1;
    if (!db.seq.reminder) db.seq.reminder = Math.max(0, ...db.reminders.map((r) => Number(r.id) || 0)) + 1;
    return db;
  }

  function findAgent(db, name) {
    const n = str(name);
    if (!n) return null;
    const exact = (db.agents || []).find((a) => a.name === n);
    return exact || P.resolveExpert(db.agents || [], n).agent || null;
  }

  /* ------------------------------------------------- نوع اقدام‌ها (مدیریت) */
  function actionTypes(db) { ensure(db); return db.actionTypes.slice(); }

  function addActionType(db, label) {
    ensure(db);
    const v = str(label).replace(/\s+/g, ' ');
    if (!v) fail('نام نوع اقدام را وارد کنید');
    if (v.length > 80) fail('نام نوع اقدام بیش از ۸۰ نویسه است');
    if (v.indexOf('/') !== -1) fail('نام نوع اقدام نباید شامل «/» باشد');
    if (db.actionTypes.includes(v)) fail('این نوع اقدام قبلاً ثبت شده است');
    db.actionTypes.push(v);
    return db.actionTypes.slice();
  }

  /** حذف نوع اقدام، اقدام‌های ثبت‌شده را پاک نمی‌کند (عنوان آن‌ها در سابقه می‌ماند). */
  function deleteActionType(db, label) {
    ensure(db);
    const v = str(label), i = db.actionTypes.indexOf(v);
    if (i < 0) fail('نوع اقدام یافت نشد', 404);
    db.actionTypes.splice(i, 1);
    return db.actionTypes.slice();
  }

  /* ------------------------------------------------------------ اقدام‌ها */
  const allActions = (db, name) => {
    const map = db.agentActions || {};
    return name ? (map[name] || []) : Object.values(map).flat();
  };
  function sortActions(list) { return list.slice().sort((a, b) => (dateKey(a.date) - dateKey(b.date)) || ((a.id || 0) - (b.id || 0))); }

  function normStatus(v) {
    const s = str(v);
    if (!STATUSES.includes(s)) fail('وضعیت اقدام نامعتبر است');
    return s;
  }
  function normResult(v) {
    const s = str(v);
    if (!RESULTS.includes(s)) fail('نتیجه اقدام نامعتبر است');
    return s;
  }

  /** ثبت اقدام؛ problem/problemSource اختیاری‌اند و وقتی از ماتریس مشکلات آمده باشند پر می‌شوند. */
  function saveAction(db, body) {
    ensure(db);
    const agent = str(body.agent);
    if (!agent) fail('نام کارشناس الزامی است');
    const title = str(body.title);
    if (!title) fail('نوع اقدام را انتخاب کنید');
    if (title.length > 120) fail('عنوان اقدام بیش از ۱۲۰ نویسه است');
    const row = findAgent(db, agent);
    const it = {
      id: db.seq.action++,
      agent: row ? row.name : agent,
      title,
      date: str(body.date) ? jalaliOrFail(body.date, 'تاریخ اقدام معتبر نیست') : todayStr(),
      status: body.status != null && str(body.status) ? normStatus(body.status) : NOT_DONE,
      result: body.result != null && str(body.result) ? normResult(body.result) : 'در انتظار',
      note: str(body.note).slice(0, 1000),
      problem: str(body.problem).slice(0, 200),
      problemSource: str(body.problemSource).slice(0, 40),
      createdAt: nowIso()
    };
    if (!db.agentActions[it.agent]) db.agentActions[it.agent] = [];
    db.agentActions[it.agent].push(it);
    return it;
  }

  function findAction(db, id) {
    const aid = Number(id);
    for (const nm of Object.keys(db.agentActions || {})) {
      const it = (db.agentActions[nm] || []).find((x) => x.id === aid);
      if (it) return it;
    }
    return null;
  }

  function updateAction(db, id, body) {
    ensure(db);
    const it = findAction(db, id);
    if (!it) fail('اقدام یافت نشد', 404);
    if (body.title != null) {
      const t = str(body.title);
      if (!t) fail('عنوان اقدام خالی است');
      it.title = t.slice(0, 120);
    }
    if (body.status != null) it.status = normStatus(body.status);
    if (body.result != null) it.result = normResult(body.result);
    if (body.date != null) it.date = jalaliOrFail(body.date, 'تاریخ اقدام معتبر نیست');
    if (body.note != null) it.note = str(body.note).slice(0, 1000);
    it.updatedAt = nowIso();
    return it;
  }

  function deleteAction(db, id) {
    const aid = Number(id);
    for (const nm of Object.keys(db.agentActions || {})) {
      const arr = db.agentActions[nm] || [];
      const i = arr.findIndex((x) => x.id === aid);
      if (i >= 0) { arr.splice(i, 1); return { ok: true }; }
    }
    fail('اقدام یافت نشد', 404);
  }

  /* ----------------------------------------------------------- یادآورها */
  function reminderList(db, agent) {
    ensure(db);
    const list = agent ? db.reminders.filter((r) => r.agent === agent) : db.reminders.slice();
    return list.slice().sort((a, b) => (dateKey(a.date) - dateKey(b.date)) || ((a.id || 0) - (b.id || 0)));
  }

  function saveReminder(db, body) {
    ensure(db);
    const agent = str(body.agent);
    if (!agent) fail('کارشناس مشخص نیست');
    const text = str(body.text);
    if (!text) fail('متن یادآور را وارد کنید');
    if (text.length > 300) fail('متن یادآور بیش از ۳۰۰ نویسه است');
    const row = findAgent(db, agent);
    const r = {
      id: db.seq.reminder++,
      agent: row ? row.name : agent,
      date: jalaliOrFail(body.date, 'تاریخ یادآور را انتخاب کنید'),
      text,
      done: false,
      createdAt: nowIso()
    };
    db.reminders.push(r);
    return r;
  }

  function updateReminder(db, id, body) {
    ensure(db);
    const r = db.reminders.find((x) => x.id === Number(id));
    if (!r) fail('یادآور یافت نشد', 404);
    if (body.done != null) r.done = body.done === true || body.done === 'true' || body.done === 1;
    if (body.date != null) r.date = jalaliOrFail(body.date, 'تاریخ یادآور معتبر نیست');
    if (body.text != null) {
      const t = str(body.text);
      if (!t) fail('متن یادآور خالی است');
      r.text = t.slice(0, 300);
    }
    r.updatedAt = nowIso();
    return r;
  }

  function deleteReminder(db, id) {
    ensure(db);
    const i = db.reminders.findIndex((x) => x.id === Number(id));
    if (i < 0) fail('یادآور یافت نشد', 404);
    db.reminders.splice(i, 1);
    return { ok: true };
  }

  /* -------------------------------------------- داده‌ی هر کارشناس (فیلتر بازه) */
  /** ردیف‌های یک کارشناس؛ q (از/تا) فقط روی شمارش و ماتریس اعمال می‌شود. */
  function agentRows(db, name, q) {
    q = q || {};
    const T = R.filterRows(db.tickets || [], q, db).filter((r) => r.agentName === name);
    const S = R.filterRows(db.socials || [], q, db).filter((r) => r.agentName === name);
    const Ph = R.filterRows(db.callFeedbacks || [], q, db).filter((r) => r.expertName === name);
    return { tickets: T, socials: S, calls: Ph };
  }

  /** نمره‌ی ماه جاری (مستقل از بازه‌ی سراسری): میانگین نمره‌های دارای نمره، بر اساس تاریخ بررسی. */
  function monthlyScore(db, name, now) {
    const t = now || C.todayJalali();
    const all = agentRows(db, name, {});
    const rows = [].concat(all.tickets, all.socials, all.calls).filter((r) => {
      const j = C.parseJalali(r.reviewDate);
      return !!j && j.jy === t.jy && j.jm === t.jm;
    });
    return {
      score: R.avgScore(rows),
      count: rows.length,
      scoredCount: R.scoredRows(rows).length,
      jy: t.jy, jm: t.jm,
      label: C.MONTHS_FA[t.jm - 1] + ' ' + t.jy
    };
  }

  function pickAction(a) {
    if (!a) return null;
    return { id: a.id, title: a.title, date: a.date, status: a.status, result: a.result || 'در انتظار', problem: a.problem || '', note: a.note || '' };
  }

  function countsOf(rows) {
    return { calls: rows.calls.length, tickets: rows.tickets.length, socials: rows.socials.length, total: rows.calls.length + rows.tickets.length + rows.socials.length };
  }

  /** کارت‌های مرجع: فقط کارشناسان فعال مدیریت کارشناسان؛ فیلتر تیم اختیاری است. */
  /** now (اختیاری): {jy,jm,jd} جلالی؛ پیش‌فرض امروز. */
  function overview(db, q, now) {
    ensure(db);
    q = q || {};
    const teamSet = new Set(String(q.team || '').split(',').map((x) => x.trim()).filter(Boolean));
    const cards = (db.agents || [])
      .filter((a) => a.active !== false && (!teamSet.size || teamSet.has(a.team)))
      .map((a) => {
        const today = now || C.todayJalali();
        const rows = agentRows(db, a.name, q);
        const acts = sortActions(allActions(db, a.name));
        const done = acts.filter((x) => x.status === DONE);
        const pending = acts.filter((x) => x.status !== DONE);
        const rems = reminderList(db, a.name);
        const nextReminder = rems.filter((r) => !r.done)[0] || null;
        const shown = done.length ? done[done.length - 1] : (acts.length ? acts[acts.length - 1] : null);
        return {
          name: a.name, team: a.team || '', ext: a.ext == null || a.ext === '' ? null : a.ext,
          counts: countsOf(rows),
          lastAction: pickAction(shown),
          lastActionDone: !!done.length,
          actionCount: acts.length,
          doneCount: done.length,
          pendingActions: pending.length,
          openReminders: rems.filter((r) => !r.done).length,
          nextReminder: nextReminder ? { id: nextReminder.id, date: nextReminder.date, text: nextReminder.text } : null,
          reminderDays: nextReminder ? dayDiff(nextReminder.date, today) : null,
          lastChangeAt: latestStamp(acts.concat(rems)),
          monthly: monthlyScore(db, a.name, now)
        };
      })
      .sort((x, y) => x.name.localeCompare(y.name, 'fa'));
    const t = now || C.todayJalali();
    return {
      cards,
      meta: {
        actionTypes: actionTypes(db), results: RESULTS.slice(), statuses: { done: DONE, notDone: NOT_DONE },
        month: { jy: t.jy, jm: t.jm, label: C.MONTHS_FA[t.jm - 1] + ' ' + t.jy }
      }
    };
  }

  /* ------------------------------------------------ داشبورد بررسی (همه‌ی اقدام‌ها) */
  const RESULT_OPEN = ['در انتظار', 'نیاز به پیگیری'];
  const listOf = (v) => String(v == null ? '' : v).split(',').map((x) => x.trim()).filter(Boolean);
  const pct = (a, b) => (a + b ? C.round2(100 * a / (a + b)) : '');

  /**
   * همه‌ی اقدام‌های ثبت‌شده (وظیفه‌ها) برای بررسی QC.
   * فیلترها (همه اختیاری، چندمقداری با ویرگول): team, agent, type, status, result؛ بازه‌ی تاریخ اقدام: aFrom/aTo.
   * بازه‌ی سراسری تاریخ بررسی روی این داشبورد اثر ندارد (تا اقدام‌های قدیمی‌تر گم نشوند).
   */
  function reviewDashboard(db, q) {
    ensure(db);
    q = q || {};
    const aFrom = str(q.aFrom), aTo = str(q.aTo);
    const rangeErr = R.validateRange({ from: aFrom, to: aTo });
    if (rangeErr) fail(rangeErr);
    const from = aFrom ? C.parseDate(aFrom) : null, to = aTo ? C.parseDate(aTo) : null;
    const sets = { team: new Set(listOf(q.team)), agent: new Set(listOf(q.agent)), type: new Set(listOf(q.type)),
      status: new Set(listOf(q.status)), result: new Set(listOf(q.result)) };

    const rows = [];
    let undated = 0;
    Object.keys(db.agentActions || {}).forEach((key) => {
      const a = findAgent(db, key);
      const name = a ? a.name : key;
      const team = a ? (a.team || '') : '';
      if (sets.agent.size && !sets.agent.has(name)) return;
      if (sets.team.size && !sets.team.has(team)) return;
      (db.agentActions[key] || []).forEach((it) => {
        const status = it.status === DONE ? DONE : NOT_DONE;
        const result = it.result || 'در انتظار';
        if (sets.type.size && !sets.type.has(it.title)) return;
        if (sets.status.size && !sets.status.has(status)) return;
        if (sets.result.size && !sets.result.has(result)) return;
        const j = C.parseJalali(it.date);
        if (!j) undated++;
        if ((from || to) && (!j || !C.jalaliInRange(j, from, to))) return;
        rows.push({ id: it.id, expert: name, team, title: it.title, date: it.date || '', status, result,
          problem: it.problem || '', problemSource: it.problemSource || '', note: it.note || '',
          createdAt: it.createdAt || '', updatedAt: it.updatedAt || '' });
      });
    });
    rows.sort((x, y) => (dateKey(y.date) - dateKey(x.date)) || ((y.id || 0) - (x.id || 0)));

    const isOpen = (r) => RESULT_OPEN.includes(r.result);
    const done = rows.filter((r) => r.status === DONE).length;
    const success = rows.filter((r) => r.result === 'موفق').length;
    const failed = rows.filter((r) => r.result === 'ناموفق').length;
    const waiting = rows.filter(isOpen).length;

    /* هر کارشناس: جمع‌بندی اقدام‌ها + یادآورهای او */
    const expMap = new Map();
    rows.forEach((r) => {
      if (!expMap.has(r.expert)) expMap.set(r.expert, { name: r.expert, team: r.team, total: 0, done: 0, notDone: 0,
        success: 0, failed: 0, waiting: 0, lastDate: r.date, lastTitle: r.title, lastResult: r.result });
      const e = expMap.get(r.expert);
      e.total++;
      if (r.status === DONE) e.done++; else e.notDone++;
      if (r.result === 'موفق') e.success++;
      if (r.result === 'ناموفق') e.failed++;
      if (isOpen(r)) e.waiting++;
    });
    const byExpert = [...expMap.values()].map((e) => {
      const rems = reminderList(db, e.name);
      return Object.assign(e, { successRate: pct(e.success, e.failed), openReminders: rems.filter((x) => !x.done).length,
        doneReminders: rems.filter((x) => x.done).length });
    }).sort((x, y) => x.name.localeCompare(y.name, 'fa'));

    /* نوع اقدام: تعداد، انجام‌شده/نشده و نتیجه */
    const typeMap = new Map();
    rows.forEach((r) => {
      if (!typeMap.has(r.title)) typeMap.set(r.title, { title: r.title, total: 0, done: 0, notDone: 0, success: 0, failed: 0, waiting: 0 });
      const t = typeMap.get(r.title);
      t.total++;
      if (r.status === DONE) t.done++; else t.notDone++;
      if (r.result === 'موفق') t.success++;
      if (r.result === 'ناموفق') t.failed++;
      if (isOpen(r)) t.waiting++;
    });
    const byType = [...typeMap.values()].sort((x, y) => (y.total - x.total) || x.title.localeCompare(y.title, 'fa'));

    /* نتیجه‌ها به ترتیب ثابت */
    const byResult = RESULTS.map((label) => ({ label, count: rows.filter((r) => r.result === label).length }));

    /* روند ماهانه بر اساس تاریخ اقدام (جلالی) */
    const monthMap = new Map();
    rows.forEach((r) => {
      const j = C.parseJalali(r.date);
      if (!j) return;
      const key = j.jy * 100 + j.jm;
      if (!monthMap.has(key)) monthMap.set(key, { key, label: C.MONTHS_FA[j.jm - 1] + ' ' + j.jy, total: 0, done: 0, notDone: 0, success: 0, failed: 0 });
      const m = monthMap.get(key);
      m.total++;
      if (r.status === DONE) m.done++; else m.notDone++;
      if (r.result === 'موفق') m.success++;
      if (r.result === 'ناموفق') m.failed++;
    });
    const byMonth = [...monthMap.values()].sort((x, y) => x.key - y.key);

    /* مشکل‌ها (ماتریس): کدام مشکل بیشتر اقدام شده و چند تا باز است */
    const probMap = new Map();
    rows.forEach((r) => {
      const label = r.problem || 'بدون مشکل ثبت‌شده';
      if (!probMap.has(label)) probMap.set(label, { problem: label, source: r.problemSource, total: 0, done: 0, failed: 0, open: 0 });
      const p = probMap.get(label);
      p.total++;
      if (r.status === DONE) p.done++;
      if (r.result === 'ناموفق') p.failed++;
      if (r.status !== DONE) p.open++;
    });
    const byProblem = [...probMap.values()].sort((x, y) => (y.total - x.total) || x.problem.localeCompare(y.problem, 'fa')).slice(0, 15);

    const teams = [...new Set((db.agents || []).map((a) => a.team).filter(Boolean))].sort((x, y) => x.localeCompare(y, 'fa'));
    const agents = (db.agents || []).filter((a) => a.active !== false).map((a) => a.name).sort((x, y) => x.localeCompare(y, 'fa'));
    return {
      kpis: { total: rows.length, done, notDone: rows.length - done, success, failed, waiting,
        successRate: pct(success, failed), experts: expMap.size, undated,
        openReminders: byExpert.reduce((n, e) => n + e.openReminders, 0) },
      byExpert, byType, byResult, byMonth, byProblem, rows,
      meta: { teams, agents, actionTypes: actionTypes(db), results: RESULTS.slice(), statuses: { done: DONE, notDone: NOT_DONE } }
    };
  }

  /* ------------------------------------------------------- ماتریس مشکلات */
  function flatStat(rows, key) {
    let ok = 0, bad = 0, na = 0;
    rows.forEach((r) => {
      const v = C.normalizeTri(r[key]);
      if (v === 1) ok++; else if (v === 0) bad++; else if (v === '-') na++;
    });
    const applicable = ok + bad;
    return { ok, bad, na, applicable, errorRate: applicable ? C.round2(100 * bad / applicable) : '' };
  }

  /** هر المان ارزیابی یک ردیف است: تماس (به تفکیک فرم)، تیکت، سوشال. */
  function matrix(db, name, q) {
    const rows = agentRows(db, name, q);
    const items = [];
    const cfg = R.configuredCriteria(db);
    ['tele', 'account', 'mlm'].forEach((ft) => {
      const rs = rows.calls.filter((r) => r.formType === ft);
      if (!rs.length) return;
      R.criteriaKeys(rs, ft, cfg).forEach((k) => {
        const st = R.criterionStats(rs, k, cfg);
        if (!st.applicable) return;
        const team = rs[0].criteriaTeam || rs[0].team || cfg.rowTeam(rs[0]);
        items.push(mkItem('call', 'تماس · ' + (FORM_LABEL[ft] || ft), k, R.criterionLabel(rs, ft, k, cfg) || k,
          { ok: st.ok, bad: st.bad, na: st.na, applicable: st.applicable, errorRate: st.errorRate }, team));
      });
    });
    const T = R.scoredRows(rows.tickets), S = R.scoredRows(rows.socials);
    TICKET_ITEMS.forEach(([k, label]) => items.push(mkItem('ticket', 'تیکت', k, label, flatStat(T, k))));
    SOCIAL_ITEMS.forEach(([k, label]) => items.push(mkItem('social', 'سوشال', k, label, flatStat(S, k))));
    const sorted = items.filter((x) => x.applicable > 0 || x.bad > 0).sort((a, b) =>
      (Number(b.bad > 0) - Number(a.bad > 0)) || ((b.errorRate === '' ? -1 : b.errorRate) - (a.errorRate === '' ? -1 : a.errorRate)) || (b.bad - a.bad));
    const problems = sorted.filter((x) => x.bad > 0).length;
    return { items: sorted, problems };
  }
  function mkItem(source, sourceLabel, key, label, stat, team) {
    const problemText = sourceLabel + ' — ' + label;
    return Object.assign({ key: source + ':' + key, source, sourceLabel, label, problemText, team: team || '' }, stat);
  }

  /* -------------------------------------------------------------- تاریخچه */
  /** تاریخچه‌ی کامل (بدون محدودیت بازه): اقدام، یادآور، فرم تیکت و فرم سوشال. */
  function history(db, name) {
    const all = agentRows(db, name, {});
    const entries = [];
    allActions(db, name).forEach((a) => entries.push({
      kind: 'action', id: a.id, date: a.date, at: a.createdAt || '', title: a.title,
      status: a.status, result: a.result || 'در انتظار', note: a.note || '', problem: a.problem || '', problemSource: a.problemSource || ''
    }));
    reminderList(db, name).forEach((r) => entries.push({
      kind: 'reminder', id: r.id, date: r.date, at: r.createdAt || '', title: r.text, done: !!r.done
    }));
    all.tickets.forEach((r) => entries.push({
      kind: 'ticket', id: r.id, date: r.reviewDate, at: r.createdAt || '', title: 'ارزیابی تیکت ' + (r.ticketCode || ''),
      score: r.score == null ? '' : r.score, redline: r.redline, qcAgent: r.qcAgent || '', record: r
    }));
    all.socials.forEach((r) => entries.push({
      kind: 'social', id: r.id, date: r.reviewDate, at: r.createdAt || '', title: 'ارزیابی سوشال · ' + (r.messenger || ''),
      score: r.score == null ? '' : r.score, slaStatus: r.slaStatus || '', qcAgent: r.qcAgent || '', record: r
    }));
    return entries.sort((a, b) => (dateKey(b.date) - dateKey(a.date)) || String(b.at).localeCompare(String(a.at)) || ((b.id || 0) - (a.id || 0)));
  }

  /** جزئیات کامل یک کارشناس برای پاپ‌آپ‌ها. */
  function detail(db, ident, q, now) {
    ensure(db);
    const agent = findAgent(db, ident);
    if (!agent) fail('کارشناس یافت نشد', 404);
    const name = agent.name;
    const rows = agentRows(db, name, q);
    const acts = sortActions(allActions(db, name));
    const rems = reminderList(db, name);
    const hist = history(db, name);
    return {
      agent: { name, team: agent.team || '', ext: agent.ext == null || agent.ext === '' ? null : agent.ext, active: agent.active !== false },
      scope: { from: str(q && q.from), to: str(q && q.to) },
      counts: countsOf(rows),
      monthly: monthlyScore(db, name, now),
      lastAction: pickAction(acts.filter((x) => x.status === DONE).slice(-1)[0] || null),
      matrix: matrix(db, name, q),
      actions: acts.slice().reverse(),
      reminders: rems,
      pending: {
        actions: acts.filter((x) => x.status !== DONE).reverse(),
        reminders: rems.filter((r) => !r.done)
      },
      history: hist,
      forms: { tickets: rows.tickets.length, socials: rows.socials.length }
    };
  }

  return {
    DEFAULT_ACTION_TYPES, RESULTS, DONE, NOT_DONE, STATUSES,
    ensure, findAgent, actionTypes, addActionType, deleteActionType,
    saveAction, updateAction, deleteAction, findAction,
    reminderList, saveReminder, updateReminder, deleteReminder,
    agentRows, monthlyScore, overview, matrix, history, detail, reviewDashboard, clone
  };
});
