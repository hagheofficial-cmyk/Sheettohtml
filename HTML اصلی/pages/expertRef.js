/* expertRef.js — صفحه «مرجع کارشناسان»
 *   کارت هر کارشناس: شماره داخلی، آخرین اقدام انجام‌شده (با انتخاب نتیجه)، شمارش ریت تماس/تیکت/سوشال،
 *   نمره‌ی ماه جاری (جای سبد خرید). از کارت: ثبت اکشن (نوع اکشن + ماتریس مشکلات)، فرم‌ها (تیکت/سوشال و
 *   سوابق)، ریمایندر (با تقویم جلالی) و تاریخچه‌ی کامل. منطق داده در shared/expertRef.js است.
 */
(function () {
'use strict';
const { C, $, $$, api, fa, esc, el, toast, modal, modalHead, confirmDlg, triSwitch, redlineSwitch, scorePill, emptyState, debounce, scoreColorHex, errorRateCell, slaBadge, durText, triValue } = UI;

const TICKET_ITEMS = [
  { key: 'q1', label: 'پیگیری صحیح و رسیدگی تا مشخص‌شدن نتیجه' },
  { key: 'q2', label: 'ثبت کامل یادداشت در پارس‌لاجیک' },
  { key: 'q3', label: 'انتخاب صحیح دلیل بستن تیکت' },
  { key: 'q4', label: 'ثبت صحیح اکشن در CRM' }
];
const SOCIAL_ITEMS = [
  { key: 'qSla', label: 'پاسخ‌دهی در SLA' },
  { key: 'qFollow', label: 'پیگیری تا نتیجه' },
  { key: 'qClosing', label: 'پایان‌بندی محترمانه' },
  { key: 'qTone', label: 'لحن حرفه‌ای' }
];
const KIND_ICON = { action: 'fa-bolt', reminder: 'fa-bell', ticket: 'fa-ticket', social: 'fa-comments' };
const KIND_TONE = { action: 'blue', reminder: 'warn', ticket: 'violet', social: 'good' };
const KIND_LABEL = { action: 'اقدام', reminder: 'یادآور', ticket: 'فرم تیکت', social: 'فرم سوشال' };

/* ---------------------------------------------------------- ابزارها */
const today = () => C.formatJalali(C.todayJalali());
const initialOf = (name) => esc(String(name || '؟').trim().charAt(0));
const hasVal = (v) => v !== '' && v != null;
const scoreText = (v) => (hasVal(v) ? fa(C.round2(v)) : '—');
const scoreColor = (v) => (hasVal(v) ? scoreColorHex(v) : 'var(--muted)');
const teamLabel = (t) => esc(QCParse.displayTeam(t || '—'));
const teamTag = (t) => `<span class="tag-team">${teamLabel(t)}</span>`;
const extChip = (ext) => (ext == null ? '<span class="ext-chip muted"><i class="fa-solid fa-phone-slash"></i> بدون داخلی</span>'
  : `<span class="ext-chip"><i class="fa-solid fa-phone-volume"></i> داخلی ${fa(ext)}</span>`);
const isOverdue = (r) => !r.done && r.date && C.jalaliCmp(C.parseJalali(r.date), C.todayJalali()) < 0;

/* فیلدهای فرم: همه با data-f و تقویم جلالی (data-cal) */
const fieldHtml = (label, inner, o) => `<div class="field${o && o.wide ? ' er-wide' : ''}"><label>${esc(label)}${o && o.req ? ' <span class="req">*</span>' : ''}</label>${inner}</div>`;
const selectHtml = (key, items, value, placeholder) => `<select class="input" data-f="${key}"><option value="">${esc(placeholder || '— انتخاب کنید —')}</option>${items.map((it) => {
  const v = typeof it === 'string' ? it : it.value, l = typeof it === 'string' ? it : it.label;
  return `<option value="${esc(v)}" ${String(v) === String(value || '') ? 'selected' : ''}>${esc(l)}</option>`;
}).join('')}</select>`;
const textHtml = (key, value, o) => `<input class="input" data-f="${key}" value="${esc(value || '')}" autocomplete="off"${o && o.ltr ? ' dir="ltr"' : ''}${o && o.ph ? ` placeholder="${esc(o.ph)}"` : ''}${o && o.readonly ? ' readonly' : ''}>`;
const dateHtml = (key, value) => `<div class="date-f"><input class="input" data-f="${key}" dir="ltr" value="${esc(value || '')}" placeholder="۱۴۰۵/۰۷/۲۲" autocomplete="off"><button type="button" class="cal-btn" data-cal="${key}" aria-label="باز کردن تقویم"><i class="fa-regular fa-calendar"></i></button></div>`;
const timeHtml = (key, value) => `<input class="input" type="time" dir="ltr" data-f="${key}" value="${esc(value || '')}">`;
const readField = (scope, key) => { const n = scope.querySelector(`[data-f="${key}"]`); return n ? n.value.trim() : ''; };
/** تاریخ جلالی معتبر یا '' (ارقام فارسی و تاریخ فشرده هم پذیرفته می‌شود). */
function readDate(scope, key) { const j = C.parseJalali(readField(scope, key)); return j ? C.formatJalali(j) : ''; }
function bindCal(scope) {
  $$('[data-cal]', scope).forEach((b) => {
    const input = scope.querySelector(`[data-f="${b.dataset.cal}"]`);
    if (input) JCal.attach(b, { input });
  });
}
const UI_STATE = { meta: null, cards: [] };
const resultOptions = (selected) => (UI_STATE.meta ? UI_STATE.meta.results : ['در انتظار']).map((r) =>
  `<option value="${esc(r)}" ${r === selected ? 'selected' : ''}>${esc(r)}</option>`).join('');
const isDone = (a) => a.status === (UI_STATE.meta ? UI_STATE.meta.statuses.done : 'انجام شده');
const statusBadge = (a) => (isDone(a) ? '<span class="badge good"><i class="fa-solid fa-circle-check"></i> انجام شد</span>'
  : '<span class="badge warn"><i class="fa-solid fa-hourglass-half"></i> انجام نشده</span>');

/* ----------------------------------------------------- فیلترها و مرتب‌سازی */
const REM_OPTS = [['', 'همه'], ['overdue', 'معوق (گذشته)'], ['d0', 'امروز'], ['d3', 'تا ۳ روز دیگر'], ['d7', 'تا ۷ روز دیگر'], ['d30', 'تا ۳۰ روز دیگر'], ['none', 'بدون یادآور باز']];
const CHG_OPTS = [['', 'همه'], ['today', 'امروز'], ['w', 'در ۷ روز اخیر'], ['m', 'در ۳۰ روز اخیر'], ['old', 'بیش از ۳۰ روز بدون تغییر'], ['never', 'هرگز تغییر نکرده']];
const ACT_OPTS = [['', 'همه'], ['pending', 'دارای اقدام در انتظار'], ['clear', 'همه‌ی اقدام‌ها انجام شده'], ['none', 'بدون اقدام ثبت‌شده']];
const SORT_OPTS = [['name', 'نام (الفبا)'], ['rem', 'نزدیک‌ترین ریماندر'], ['chg', 'آخرین تغییر (جدیدترین)'], ['chgOld', 'آخرین تغییر (قدیمی‌ترین)'], ['score', 'نمره‌ی ماه (بیشترین)'], ['pending', 'اقدام در انتظار (بیشترین)'], ['ext', 'شماره داخلی']];
const opts = (list, id) => `<select class="input" id="${id}">${list.map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join('')}</select>`;

/** روز گذشته از آخرین تغییر (اقدام یا یادآور)؛ null اگر هرگز تغییری نبوده. */
function ageDays(c) {
  if (!c.lastChangeAt) return null;
  const d = new Date(c.lastChangeAt);
  if (isNaN(d)) return null;
  const today = C.jalaliToDate(C.todayJalali());
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return Math.max(0, Math.round((today - start) / 86400000));
}
const chgLabel = (c) => { const a = ageDays(c); return a == null ? 'بدون تغییر' : (a === 0 ? 'امروز' : `${fa(a)} روز پیش`); };

function passes(c, f) {
  if (f.rem) {
    const d = c.reminderDays, lim = { d0: 0, d3: 3, d7: 7, d30: 30 }[f.rem];
    const ok = f.rem === 'none' ? d == null
      : f.rem === 'overdue' ? d != null && d < 0
        : d != null && d <= lim;
    if (!ok) return false;
  }
  if (f.chg) {
    const a = ageDays(c);
    const ok = f.chg === 'never' ? a == null
      : a != null && (f.chg === 'today' ? a === 0 : f.chg === 'w' ? a <= 7 : f.chg === 'm' ? a <= 30 : a > 30);
    if (!ok) return false;
  }
  if (f.act) {
    const ok = f.act === 'pending' ? c.pendingActions > 0
      : f.act === 'clear' ? (!!c.lastAction && c.pendingActions === 0)
        : !c.lastAction;
    if (!ok) return false;
  }
  return true;
}

/** مقایسه‌گر؛ مقدار خالی همیشه آخر می‌ماند مگر در حالت‌هایی که صریحاً برعکس است. */
function cmpVals(a, b, desc) {
  const na = a == null || a === '' || Number.isNaN(a), nb = b == null || b === '' || Number.isNaN(b);
  if (na && nb) return 0;
  if (na) return 1;
  if (nb) return -1;
  return desc ? b - a : a - b;
}
const ms = (c) => (c.lastChangeAt ? Date.parse(c.lastChangeAt) : null);
function sorter(kind) {
  switch (kind) {
    case 'rem': return (x, y) => cmpVals(x.reminderDays, y.reminderDays, false);
    case 'chg': return (x, y) => cmpVals(ms(x), ms(y), true);
    case 'chgOld': return (x, y) => cmpVals(x.lastChangeAt ? ms(x) : -Infinity, y.lastChangeAt ? ms(y) : -Infinity, false);
    case 'score': return (x, y) => cmpVals(hasVal(x.monthly.score) ? +x.monthly.score : null, hasVal(y.monthly.score) ? +y.monthly.score : null, true);
    case 'pending': return (x, y) => cmpVals(x.pendingActions, y.pendingActions, true);
    case 'ext': return (x, y) => cmpVals(x.ext, y.ext, false);
    default: return () => 0;
  }
}

/* ----------------------------------------------------------- صفحه */
async function render(root) {
  root.innerHTML = `
    <div class="page-head">
      <div class="ph-ic"><i class="fa-solid fa-address-book"></i></div>
      <div><h2>مرجع کارشناسان</h2><p>کارت هر کارشناس؛ اقدام و نتیجه، شماره داخلی، شمارش ریت‌ها و نمره‌ی ماه جاری. از همین‌جا اقدام، یادآور و فرم ثبت کنید.</p></div>
      <div class="spacer"></div>
    </div>
    <div class="card" style="margin-bottom:16px">
      <div class="filters" style="border-bottom:none;align-items:flex-end">
        <div class="field" style="flex:1.4;min-width:220px"><label>جستجو (نام یا داخلی)</label>
          <input class="input" id="erSearch" placeholder="مثلاً: مبینا یا ۳۰۷۳" autocomplete="off"></div>
        <div id="erTeamSlot"></div>
        <div class="field"><label>نزدیک‌ترین ریماندر</label>${opts(REM_OPTS, 'erRemF')}</div>
        <div class="field"><label>آخرین تغییر</label>${opts(CHG_OPTS, 'erChgF')}</div>
        <div class="field"><label>وضعیت اقدام</label>${opts(ACT_OPTS, 'erActF')}</div>
        <div class="field"><label>مرتب‌سازی</label>${opts(SORT_OPTS, 'erSort')}</div>
        <div class="field grow-0"><label>&nbsp;</label><button class="btn ghost" id="erReset"><i class="fa-solid fa-rotate-right"></i> بازنشانی</button></div>
      </div>
    </div>
    <div class="er-team-row"><div class="tabs er-team-tabs" id="erTeamTabs"></div></div>
    <div id="erSummary" class="er-summary"></div>
    <div id="erGrid" class="ex-grid"><div class="loading-page"><div class="spinner"></div><p>در حال بارگذاری کارت‌ها…</p></div></div>`;

  let reqId = 0;
  const teams = (App.state.teams || []).slice().sort();
  const msTeam = UI.multiSelect({
    label: 'تیم', allLabel: 'همه تیم‌ها',
    items: teams.map((t) => ({ value: t, label: QCParse.displayTeam(t) })),
    onChange: () => { paintTeamTabs(); load(); }
  });
  $('#erTeamSlot', root).replaceWith(msTeam);
  /* تب‌های سریع تیم؛ با فیلتر چندتیمی همگام‌اند */
  const teamTabs = $('#erTeamTabs', root);
  function paintTeamTabs() {
    const sel = msTeam.getValues();
    const all = [['', 'همه تیم‌ها']].concat(teams.map((t) => [t, QCParse.displayTeam(t)]));
    teamTabs.innerHTML = all.map(([v, l]) => {
      const on = v === '' ? sel.length === 0 : (sel.length === 1 && sel[0] === v);
      return `<button type="button" data-team="${esc(v)}" class="${on ? 'active' : ''}">${esc(l)}</button>`;
    }).join('');
  }
  teamTabs.addEventListener('click', (e) => {
    const b = e.target.closest('[data-team]');
    if (!b) return;
    msTeam.setValues(b.dataset.team ? [b.dataset.team] : []);
    paintTeamTabs(); load();
  });
  paintTeamTabs();
  $('#erSearch', root).addEventListener('input', debounce(() => drawGrid(root), 150));
  ['#erRemF', '#erChgF', '#erActF', '#erSort'].forEach((id) => $(id, root).addEventListener('change', () => drawGrid(root)));
  $('#erReset', root).addEventListener('click', () => {
    msTeam.setValues([]); paintTeamTabs(); $('#erSearch', root).value = '';
    ['#erRemF', '#erChgF', '#erActF', '#erSort'].forEach((id) => { $(id, root).value = ''; });
    $('#erSort', root).value = 'name';
    load();
  });
  const grid = $('#erGrid', root);
  grid.addEventListener('click', (e) => onGridClick(e, root));
  grid.addEventListener('change', (e) => onGridChange(e, root));

  async function load() {
    const sel = msTeam.getValues();
    const req = ++reqId;
    const qs = sel.length ? '?team=' + encodeURIComponent(sel.join(',')) : '';
    try {
      const data = await api.get('/api/expert-ref' + qs);
      if (req !== reqId || !root.isConnected) return;
      UI_STATE.meta = data.meta; UI_STATE.cards = data.cards || [];
      drawGrid(root);
    } catch (e) {
      if (req !== reqId || !root.isConnected) return;
      grid.innerHTML = `<div class="card" style="grid-column:1/-1">${emptyState('fa-triangle-exclamation', 'خطا در بارگذاری', e.message)}</div>`;
    }
  }
  root._reload = load;
  await load();
}

function drawGrid(root) {
  const grid = $('#erGrid', root), sum = $('#erSummary', root);
  if (!grid) return;
  const term = C.faToEn($('#erSearch', root).value).trim().toLowerCase();
  const digits = term.replace(/[^0-9]/g, '');
  const f = { rem: $('#erRemF', root).value, chg: $('#erChgF', root).value, act: $('#erActF', root).value, sort: $('#erSort', root).value || 'name' };
  const list = UI_STATE.cards
    .filter((c) => !term || c.name.toLowerCase().includes(term) || (digits.length >= 2 && c.ext != null && String(c.ext).includes(digits)))
    .filter((c) => passes(c, f))
    .sort((x, y) => sorter(f.sort)(x, y) || x.name.localeCompare(y.name, 'fa'));
  const pending = list.reduce((n, c) => n + (c.pendingActions || 0), 0);
  const overdue = list.filter((c) => c.reminderDays != null && c.reminderDays < 0).length;
  const reminders = list.reduce((n, c) => n + (c.openReminders || 0), 0);
  const month = UI_STATE.meta ? UI_STATE.meta.month.label : '';
  sum.innerHTML = `<span><i class="fa-solid fa-user-group"></i> ${fa(list.length)} کارشناس</span>
    <span><i class="fa-solid fa-hourglass-half"></i> ${fa(pending)} اقدام در انتظار</span>
    <span><i class="fa-regular fa-bell"></i> ${fa(reminders)} یادآور باز</span>
    ${overdue ? `<span class="er-summary-bad"><i class="fa-solid fa-triangle-exclamation"></i> ${fa(overdue)} کارشناس با یادآور معوق</span>` : ''}
    <span class="er-summary-month"><i class="fa-regular fa-calendar"></i> نمره ماه ${fa(month)}</span>`;
  grid.innerHTML = list.length ? list.map(cardHtml).join('')
    : `<div class="card" style="grid-column:1/-1">${emptyState('fa-user-group', 'کارشناسی پیدا نشد', 'جستجو یا فیلترها را تغییر دهید. کارشناسان از «مدیریت کارشناسان» خوانده می‌شوند.')}</div>`;
}

function cardHtml(c) {
  const la = c.lastAction, mo = c.monthly;
  const ext = c.ext == null
    ? '<span class="xc-chip"><i class="fa-solid fa-phone-slash"></i> بدون داخلی</span>'
    : `<span class="xc-chip ext"><i class="fa-solid fa-phone-volume"></i> داخلی ${fa(c.ext)}</span>
       <button type="button" class="xc-icon sm" data-copy="${esc(String(c.ext))}" title="کپی شماره داخلی" aria-label="کپی شماره داخلی"><i class="fa-regular fa-copy"></i></button>`;
  const pill = la
    ? `<span class="xc-pill" title="${esc(la.title)}">${esc(la.title)}</span>`
    : '<span class="xc-pill muted">بدون اقدام</span>';
  const lastRow = la
    ? `<div class="xc-last"><span class="xc-last-l">${c.lastActionDone ? 'آخرین اقدام انجام‌شده' : 'آخرین اقدام'}</span>
         <select class="input xc-result ex-result" data-aid="${la.id}" aria-label="نتیجه آخرین اقدام">${resultOptions(la.result)}</select>
         <span class="xc-date"><i class="fa-regular fa-calendar"></i> ${fa(la.date)}</span></div>`
    : '<div class="xc-last muted">هنوز اقدامی برای این کارشناس ثبت نشده است</div>';
  const chips = [
    `<span class="xc-chip"><i class="fa-solid fa-phone"></i> ${fa(c.counts.calls)} ریت تماس</span>`,
    `<span class="xc-chip"><i class="fa-solid fa-ticket"></i> ${fa(c.counts.tickets)} تیکت</span>`,
    `<span class="xc-chip"><i class="fa-solid fa-comments"></i> ${fa(c.counts.socials)} سوشال</span>`,
    c.pendingActions ? `<span class="xc-chip warn"><i class="fa-solid fa-hourglass-half"></i> ${fa(c.pendingActions)} در انتظار</span>` : '',
    c.nextReminder ? `<span class="xc-chip violet ex-clip" title="${esc(c.nextReminder.text)}"><i class="fa-regular fa-bell"></i> ${fa(c.nextReminder.date)} · ${esc(c.nextReminder.text)}</span>` : '',
    `<span class="xc-chip" title="آخرین تغییر اقدام یا یادآور"><i class="fa-regular fa-clock"></i> ${chgLabel(c)}</span>`
  ].filter(Boolean).join('');
  return `<article class="ex-card" data-name="${esc(c.name)}">
    <header class="xc-top">
      <div class="xc-who">
        <div class="ex-avatar">${initialOf(c.name)}</div>
        <div class="xc-name"><h4 title="${esc(c.name)}">${esc(c.name)}</h4>${teamTag(c.team)}</div>
      </div>
      ${pill}
      <button type="button" class="xc-icon" data-act="history" title="تاریخچه و اقدامات" aria-label="تاریخچه"><i class="fa-solid fa-clock-rotate-left"></i></button>
    </header>
    <div class="xc-contact">${ext}</div>
    ${lastRow}
    <div class="xc-chips">${chips}</div>
    <footer class="xc-foot">
      <div class="xc-cart" title="میانگین نمره‌های ${esc(mo.label)} (${fa(mo.count)} ارزیابی)">
        <i class="fa-solid fa-cart-shopping"></i>
        <b style="color:${scoreColor(mo.score)}">${scoreText(mo.score)}</b>
        <small>نمره ${fa(mo.label)} · ${fa(mo.count)} ارزیابی</small>
      </div>
      <div class="xc-btns">
        <button type="button" class="btn primary sm" data-act="actions"><i class="fa-solid fa-bolt"></i> ثبت اکشن</button>
        <button type="button" class="xc-icon" data-act="forms" title="فرم‌ها" aria-label="فرم‌ها"><i class="fa-solid fa-file-circle-plus"></i></button>
        <button type="button" class="xc-icon" data-act="reminder" title="ریمایندر" aria-label="ریمایندر"><i class="fa-regular fa-bell"></i></button>
      </div>
    </footer>
  </article>`;
}

function onGridClick(e, root) {
  const copy = e.target.closest('[data-copy]');
  if (copy) {
    const v = copy.dataset.copy;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(v).then(() => toast.success('شماره داخلی کپی شد'), () => toast.error('کپی انجام نشد'));
    } else toast.error('کپی در این مرورگر پشتیبانی نمی‌شود');
    return;
  }
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const name = btn.closest('.ex-card').dataset.name;
  const act = btn.dataset.act;
  if (act === 'actions') openActions(name, root);
  else if (act === 'forms') openForms(name, 'ticket', root);
  else if (act === 'reminder') openReminders(name, root);
  else if (act === 'history') openHistory(name, root);
}

async function onGridChange(e, root) {
  const sel = e.target.closest('.ex-result');
  if (!sel) return;
  try {
    await api.put('/api/actions/' + sel.dataset.aid, { result: sel.value });
    toast.success('نتیجه اقدام ثبت شد');
    if (root._reload) root._reload();
  } catch (err) { toast.error(err.message); }
}

/* ------------------------------------------------------ اجزای مشترک */
async function fetchDetail(name) {
  try { return await api.get('/api/expert-ref/' + encodeURIComponent(name)); }
  catch (e) { toast.error(e.message); return null; }
}
function headHtml(D) {
  const a = D.agent, m = D.monthly;
  return `<div class="er-hero">
    <div class="ex-avatar lg">${initialOf(a.name)}</div>
    <div class="er-hero-t"><h4>${esc(a.name)}</h4>
      <div class="ex-meta">${teamTag(a.team)}${extChip(a.ext)}${a.active ? '' : '<span class="badge gray">بایگانی</span>'}</div></div>
    <div class="er-hero-metrics">
      <div><span>ریت تماس</span><b>${fa(D.counts.calls)}</b></div>
      <div><span>تیکت</span><b>${fa(D.counts.tickets)}</b></div>
      <div><span>سوشال</span><b>${fa(D.counts.socials)}</b></div>
      <div class="er-hero-score"><span>نمره ${fa(m.label)}</span><b style="color:${scoreColor(m.score)}">${scoreText(m.score)}</b></div>
    </div></div>`;
}
/** ردیف اقدام با وضعیت و نتیجه‌ی قابل انتخاب (کارت، پاپ‌آپ‌ها) */
function actionRowHtml(a, opts) {
  return `<div class="er-row${isDone(a) ? ' done' : ''}">
    <div class="er-row-main">
      <div class="er-row-t"><b>${esc(a.title)}</b>${statusBadge(a)}</div>
      <small><i class="fa-regular fa-calendar"></i> ${fa(a.date)}${a.problem ? ` · <span class="er-problem-tag"><i class="fa-solid fa-triangle-exclamation"></i> ${esc(a.problem)}</span>` : ''}</small>
      ${a.note ? `<small class="er-note">${esc(a.note)}</small>` : ''}
    </div>
    <div class="er-row-side">
      <select class="input sm ex-result" data-result-id="${a.id}" aria-label="نتیجه اقدام">${resultOptions(a.result)}</select>
      <button type="button" class="btn ghost sm" data-status-id="${a.id}" data-status="${esc(a.status)}" title="تغییر وضعیت">
        <i class="fa-solid ${isDone(a) ? 'fa-rotate-left' : 'fa-check'}"></i> ${isDone(a) ? 'برگردان' : 'انجام شد'}</button>
      ${opts && opts.deletable ? `<button type="button" class="btn danger-soft sm" data-del-action="${a.id}" title="حذف اقدام"><i class="fa-solid fa-trash"></i></button>` : ''}
    </div></div>`;
}
/** رویدادهای مشترک وضعیت/نتیجه/یادآور در هر پاپ‌آپ */
function wireActionRows(scope, onChange) {
  scope.addEventListener('change', async (e) => {
    const sel = e.target.closest('[data-result-id]');
    if (!sel) return;
    try { await api.put('/api/actions/' + sel.dataset.resultId, { result: sel.value }); toast.success('نتیجه ثبت شد'); await onChange(); }
    catch (err) { toast.error(err.message); }
  });
  scope.addEventListener('click', async (e) => {
    const st = e.target.closest('[data-status-id]');
    const del = e.target.closest('[data-del-action]');
    const rem = e.target.closest('[data-rem-toggle]');
    const remDel = e.target.closest('[data-rem-del]');
    try {
      if (st) {
        const next = st.dataset.status === UI_STATE.meta.statuses.done ? UI_STATE.meta.statuses.notDone : UI_STATE.meta.statuses.done;
        await api.put('/api/actions/' + st.dataset.statusId, { status: next });
        toast.success(next === UI_STATE.meta.statuses.done ? 'اقدام انجام شد' : 'وضعیت به «انجام نشده» برگشت');
        await onChange();
      } else if (del) {
        confirmDlg('حذف اقدام', 'این اقدام و نتیجه‌ی آن از سابقه حذف شود؟', async () => {
          try { await api.del('/api/actions/' + del.dataset.delAction); toast.success('اقدام حذف شد'); await onChange(); }
          catch (err) { toast.error(err.message); }
        });
      } else if (rem) {
        await api.put('/api/reminders/' + rem.dataset.remToggle, { done: rem.dataset.done !== 'true' });
        await onChange();
      } else if (remDel) {
        confirmDlg('حذف یادآور', 'این یادآور حذف شود؟', async () => {
          try { await api.del('/api/reminders/' + remDel.dataset.remDel); toast.success('یادآور حذف شد'); await onChange(); }
          catch (err) { toast.error(err.message); }
        });
      }
    } catch (err) { toast.error(err.message); }
  });
}
function refreshGrid(root) { if (root && root._reload) root._reload(); }

/* ---------------------------------------------------- پاپ‌آپ ثبت اکشن */
async function openActions(name, root, startTab) {
  let D = await fetchDetail(name); if (!D) return;
  let tab = startTab || 'actions', lastType = (UI_STATE.meta.actionTypes || [])[0] || '';
  const m = modal(`${modalHead('ثبت اکشن — ' + name, 'fa-bolt')}
    <div class="modal-body">
      <div class="er-hero-slot"></div>
      <div class="tabs er-tabs">
        <button type="button" data-tab="actions"><i class="fa-solid fa-bolt"></i> اکشن‌ها</button>
        <button type="button" data-tab="matrix"><i class="fa-solid fa-table-cells"></i> ماتریس مشکلات <span class="er-count" data-mx-count></span></button>
      </div>
      <div data-pane="actions"></div>
      <div data-pane="matrix" hidden></div>
    </div>
    <div class="modal-foot"><button class="btn ghost" data-close>بستن</button></div>`, { lg: true });
  const paneA = $('[data-pane="actions"]', m), paneM = $('[data-pane="matrix"]', m);

  const paintTabs = () => {
    $$('[data-tab]', m).forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
    paneA.hidden = tab !== 'actions'; paneM.hidden = tab !== 'matrix';
  };
  const paintActions = () => {
    const types = UI_STATE.meta.actionTypes || [];
    const list = D.actions;
    paneA.innerHTML = `
      <section class="er-sec">
        <div class="er-sec-h"><i class="fa-solid fa-tags"></i><div><h4>نوع اکشن‌ها</h4>
          <small>اکشن‌های دلخواه را اضافه یا حذف کنید. حذف نوع، اقدام‌های قبلی را پاک نمی‌کند.</small></div></div>
        <div class="er-chips">${types.length ? types.map((t) => `<span class="chip">${esc(t)}<button type="button" data-del-type="${esc(t)}" title="حذف «${esc(t)}»"><i class="fa-solid fa-xmark"></i></button></span>`).join('') : '<span class="er-muted">هنوز نوع اکشنی تعریف نشده است</span>'}</div>
        <div class="er-add-row"><input class="input sm" data-f="newType" placeholder="نوع اکشن جدید…" autocomplete="off" maxlength="80">
          <button type="button" class="btn soft sm" data-add-type><i class="fa-solid fa-plus"></i> افزودن نوع</button></div>
      </section>
      <section class="er-sec">
        <div class="er-sec-h"><i class="fa-solid fa-bolt"></i><div><h4>ثبت اکشن جدید</h4>
          <small>نوع اکشن و تاریخ را انتخاب کنید؛ نتیجه را بعداً از همین‌جا یا کارت تعیین کنید.</small></div></div>
        ${types.length ? `<div class="form-grid">
          ${fieldHtml('نوع اکشن', selectHtml('type', types, lastType, '— انتخاب نوع اکشن —'), { req: true })}
          ${fieldHtml('تاریخ اکشن', dateHtml('date', today()), { req: true })}
          ${fieldHtml('یادداشت', textHtml('note', '', { ph: 'اختیاری' }), { wide: true })}
        </div>
        <div class="er-foot-row"><button type="button" class="btn primary" data-save-action><i class="fa-solid fa-floppy-disk"></i> ثبت اکشن</button></div>`
          : '<div class="er-muted">ابتدا یک نوع اکشن اضافه کنید.</div>'}
      </section>
      <section class="er-sec">
        <div class="er-sec-h"><i class="fa-solid fa-list-check"></i><div><h4>اقدامات این کارشناس (${fa(list.length)})</h4>
          <small>وضعیت را با دکمه‌ی «انجام شد» تغییر دهید و نتیجه را از فهرست انتخاب کنید.</small></div></div>
        <div class="er-list">${list.length ? list.map((a) => actionRowHtml(a, { deletable: true })).join('') : '<div class="er-muted">هنوز اقدامی ثبت نشده است.</div>'}</div>
      </section>`;
    bindCal(paneA);
  };
  const paintMatrix = () => {
    const mx = D.matrix, items = mx.items;
    paneM.innerHTML = items.length ? `
      <div class="er-mx-head"><div><b>${fa(mx.problems)} مشکل فعال</b> از ${fa(items.length)} المان ارزیابی
        <small>هر المان با نرخ عدم رعایت؛ برای هر مشکل می‌توانید مستقیم اکشن ثبت کنید.</small></div></div>
      <div class="table-wrap er-mx-wrap"><table class="tbl er-mx">
        <thead><tr><th>منبع</th><th>المان ارزیابی</th><th>ارزیابی‌ها</th><th>عدم رعایت</th><th>نرخ خطا</th><th>اقدام‌های ثبت‌شده</th><th>ثبت اکشن</th></tr></thead>
        <tbody>${items.map((it, idx) => {
          const count = D.actions.filter((a) => a.problem === it.problemText).length;
          return `<tr class="${it.bad > 0 ? 'er-problem' : ''}">
            <td><span class="badge blue">${esc(it.sourceLabel)}</span></td>
            <td class="cell-main">${esc(it.label)}</td>
            <td>${fa(it.applicable)}</td>
            <td>${it.bad > 0 ? `<span class="badge bad">${fa(it.bad)}</span>` : '<span class="badge good">۰</span>'}</td>
            <td>${errorRateCell(it.errorRate)}</td>
            <td>${count ? `<span class="badge violet">${fa(count)}</span>` : '<span class="er-muted">—</span>'}</td>
            <td><button type="button" class="btn soft sm" data-mx="${idx}"><i class="fa-solid fa-bolt"></i> ثبت اکشن</button></td>
          </tr>
          <tr class="er-inline-row" data-inline="${idx}" hidden><td colspan="7"><div class="er-inline">
            <div class="er-inline-t"><i class="fa-solid fa-triangle-exclamation"></i> اکشن برای: ${esc(it.problemText)}</div>
            <div class="form-grid">
              ${fieldHtml('نوع اکشن', selectHtml('type', UI_STATE.meta.actionTypes || [], lastType, '— انتخاب نوع اکشن —'), { req: true })}
              ${fieldHtml('تاریخ', dateHtml('date', today()), { req: true })}
              ${fieldHtml('یادداشت', textHtml('note', '', { ph: 'اختیاری' }), { wide: true })}
            </div>
            <div class="er-inline-actions"><button type="button" class="btn ghost sm" data-mx-cancel>انصراف</button>
              <button type="button" class="btn primary sm" data-mx-save="${idx}"><i class="fa-solid fa-check"></i> ثبت اکشن برای این مشکل</button></div>
          </div></td></tr>`;
        }).join('')}</tbody>
      </table></div>` : emptyState('fa-table-cells', 'ارزیابی‌ای برای این کارشناس نیست', 'با تغییر بازه‌ی سراسری یا ثبت فرم تیکت/سوشال، ماتریس مشکلات ساخته می‌شود.');
    bindCal(paneM);
  };
  const paintAll = () => {
    $('.er-hero-slot', m).innerHTML = headHtml(D);
    $('[data-mx-count]', m).textContent = D.matrix.problems ? fa(D.matrix.problems) : '';
    paintActions(); paintMatrix(); paintTabs();
  };
  const refresh = async () => {
    const d = await fetchDetail(name);
    if (!d || !m.isConnected) return;
    D = d; paintAll(); refreshGrid(root);
  };

  $$('[data-tab]', m).forEach((b) => b.addEventListener('click', () => { tab = b.dataset.tab; paintTabs(); }));
  paneA.addEventListener('click', async (e) => {
    const b = e.target.closest('button'); if (!b) return;
    try {
      if (b.matches('[data-add-type]')) {
        const label = readField(paneA, 'newType');
        if (!label) return toast.error('نام نوع اکشن را وارد کنید');
        const res = await api.post('/api/action-types', { label });
        UI_STATE.meta.actionTypes = res.items; lastType = label;
        toast.success('نوع اکشن «' + label + '» اضافه شد');
        paintActions();
      } else if (b.matches('[data-del-type]')) {
        const label = b.dataset.delType;
        confirmDlg('حذف نوع اکشن', `«${label}» از فهرست حذف شود؟ اقدام‌های قبلی با همین عنوان در سابقه می‌مانند.`, async () => {
          try {
            const res = await api.del('/api/action-types', { label });
            UI_STATE.meta.actionTypes = res.items; toast.success('نوع اکشن حذف شد'); paintActions();
          } catch (err) { toast.error(err.message); }
        }, 'بله، حذف شود');
      } else if (b.matches('[data-save-action]')) {
        const type = readField(paneA, 'type'), date = readDate(paneA, 'date');
        if (!type) return toast.error('نوع اکشن را انتخاب کنید');
        if (!date) return toast.error('تاریخ معتبر وارد کنید (مثل 1405/07/22)');
        lastType = type;
        await api.post('/api/actions', { agent: name, title: type, date, note: readField(paneA, 'note') });
        toast.success('اکشن ثبت شد'); await refresh();
      }
    } catch (err) { toast.error(err.message); }
  });
  paneM.addEventListener('click', async (e) => {
    const open = e.target.closest('[data-mx]'), cancel = e.target.closest('[data-mx-cancel]'), save = e.target.closest('[data-mx-save]');
    if (open) {
      const row = paneM.querySelector(`[data-inline="${open.dataset.mx}"]`);
      $$('.er-inline-row', paneM).forEach((r) => { if (r !== row) r.hidden = true; });
      if (row) { row.hidden = !row.hidden; if (!row.hidden) row.querySelector('[data-f="type"]').focus(); }
    } else if (cancel) {
      const row = cancel.closest('.er-inline-row'); if (row) row.hidden = true;
    } else if (save) {
      const idx = Number(save.dataset.mxSave), item = D.matrix.items[idx], row = paneM.querySelector(`[data-inline="${idx}"]`);
      const type = readField(row, 'type'), date = readDate(row, 'date');
      if (!type) return toast.error('نوع اکشن را انتخاب کنید');
      if (!date) return toast.error('تاریخ معتبر وارد کنید');
      try {
        lastType = type;
        await api.post('/api/actions', { agent: name, title: type, date, note: readField(row, 'note'), problem: item.problemText, problemSource: item.sourceLabel });
        toast.success('اکشن برای «' + item.label + '» ثبت شد'); await refresh();
      } catch (err) { toast.error(err.message); }
    }
  });
  wireActionRows(paneA, refresh);
  paintAll();
  return m;
}

/* ---------------------------------------------------- پاپ‌آپ ریمایندر */
async function openReminders(name, root) {
  let D = await fetchDetail(name); if (!D) return;
  const m = modal(`${modalHead('ریمایندر — ' + name, 'fa-bell')}
    <div class="modal-body">
      <div class="er-hero-slot"></div>
      <section class="er-sec">
        <div class="er-sec-h"><i class="fa-regular fa-bell"></i><div><h4>یادآور جدید</h4>
          <small>تاریخ را از تقویم انتخاب کنید. یادآورهای باز روی کارت دیده می‌شوند.</small></div></div>
        <div class="form-grid">
          ${fieldHtml('تاریخ یادآور', dateHtml('date', today()), { req: true })}
          ${fieldHtml('متن یادآور', textHtml('text', '', { ph: 'مثلاً: پیگیری نتیجه‌ی آموزش' }), { req: true, wide: true })}
        </div>
        <div class="er-foot-row"><button type="button" class="btn primary" data-add-rem><i class="fa-solid fa-plus"></i> ثبت یادآور</button></div>
      </section>
      <section class="er-sec">
        <div class="er-sec-h"><i class="fa-solid fa-list"></i><div><h4>یادآورها</h4><small>با تیک، یادآور را انجام‌شده علامت بزنید.</small></div></div>
        <div data-rem-list></div>
      </section>
    </div>
    <div class="modal-foot"><button class="btn ghost" data-close>بستن</button></div>`, {});
  bindCal(m);
  const paintRems = () => {
    $('.er-hero-slot', m).innerHTML = headHtml(D);
    const list = D.reminders;
    $('[data-rem-list]', m).innerHTML = list.length ? `<div class="er-list">${list.map((r) => `
      <div class="er-rem${r.done ? ' done' : ''}">
        <button type="button" class="er-check" data-rem-toggle="${r.id}" data-done="${r.done}" aria-label="${r.done ? 'برگرداندن' : 'انجام شد'}">
          <i class="fa-${r.done ? 'solid fa-circle-check' : 'regular fa-circle'}"></i></button>
        <div class="er-rem-t"><b>${esc(r.text)}</b>
          <small><i class="fa-regular fa-calendar"></i> ${fa(r.date)} ${isOverdue(r) ? '<span class="badge bad">گذشته</span>' : ''} ${r.done ? '<span class="badge good">انجام شد</span>' : ''}</small></div>
        <button type="button" class="btn danger-soft sm" data-rem-del="${r.id}" title="حذف"><i class="fa-solid fa-trash"></i></button>
      </div>`).join('')}</div>` : emptyState('fa-bell-slash', 'یادآوری ثبت نشده', 'یادآور بالا را برای این کارشناس بسازید.');
  };
  const refresh = async () => {
    const d = await fetchDetail(name); if (!d || !m.isConnected) return;
    D = d; paintRems(); refreshGrid(root);
  };
  m.querySelector('[data-add-rem]').addEventListener('click', async () => {
    const date = readDate(m, 'date'), text = readField(m, 'text');
    if (!date) return toast.error('تاریخ معتبر وارد کنید');
    if (!text) return toast.error('متن یادآور را وارد کنید');
    try {
      await api.post('/api/reminders', { agent: name, date, text });
      toast.success('یادآور ثبت شد');
      m.querySelector('[data-f="text"]').value = '';
      await refresh();
    } catch (err) { toast.error(err.message); }
  });
  wireActionRows(m.querySelector('[data-rem-list]'), refresh);
  paintRems();
  return m;
}

/* ---------------------------------------------------- پاپ‌آپ فرم‌ها */
async function openForms(name, tab, root) {
  let D = await fetchDetail(name); if (!D) return;
  const st = App.state;
  let current = tab || 'ticket';
  const m = modal(`${modalHead('فرم‌های ' + name, 'fa-file-circle-plus')}
    <div class="modal-body">
      <div class="er-hero-slot"></div>
      <div class="tabs er-tabs">
        <button type="button" data-ftab="ticket"><i class="fa-solid fa-ticket"></i> فرم تیکت</button>
        <button type="button" data-ftab="social"><i class="fa-solid fa-comments"></i> فرم سوشال</button>
        <button type="button" data-ftab="history"><i class="fa-solid fa-list-check"></i> سوابق فرم‌ها <span class="er-count" data-fcount></span></button>
      </div>
      <div data-fpane="ticket"></div><div data-fpane="social" hidden></div><div data-fpane="history" hidden></div>
    </div>
    <div class="modal-foot"><button class="btn ghost" data-close>بستن</button></div>`, { lg: true });
  const pane = (k) => $(`[data-fpane="${k}"]`, m);
  const qcs = st.qcAgents || [];
  const team = (D.agent && D.agent.team) || '';

  const records = () => D.history.filter((h) => h.kind === 'ticket' || h.kind === 'social');
  const paintHistory = () => {
    const list = records();
    $('[data-fcount]', m).textContent = list.length ? fa(list.length) : '';
    pane('history').innerHTML = list.length ? `<div class="er-list">${list.map((h) => `
      <div class="er-tl-item">
        <span class="er-ic tone-${KIND_TONE[h.kind]}"><i class="fa-solid ${KIND_ICON[h.kind]}"></i></span>
        <div class="er-tl-main"><b>${esc(h.title)}</b>
          <small><i class="fa-regular fa-calendar"></i> ${fa(h.date)} · کارشناس QC: ${esc(h.qcAgent || '—')}</small></div>
        <div class="er-tl-side">${scorePill(h.score)}
          ${h.kind === 'social' ? slaBadge(h.slaStatus) : (h.redline === '0' ? '<span class="badge bad"><i class="fa-solid fa-ban"></i> ردلاین</span>' : '')}
          <button type="button" class="btn ghost sm" data-rec="${h.kind}:${h.id}"><i class="fa-solid fa-circle-info"></i> جزئیات</button></div>
      </div>`).join('')}</div>` : emptyState('fa-folder-open', 'هنوز فرمی برای این کارشناس ثبت نشده', 'از تب «فرم تیکت» یا «فرم سوشال» اولین ارزیابی را ثبت کنید.');
  };

  /* ---- فرم تیکت ---- */
  const paintTicket = () => {
    const W = st.settings.ticketWeights || [40, 20, 20, 20];
    pane('ticket').innerHTML = `
      <div class="form-grid">
        ${fieldHtml('کارشناس کنترل کیفیت', selectHtml('qcAgent', qcs, '', '— انتخاب کنید —'), { req: true })}
        ${fieldHtml('تاریخ بررسی', dateHtml('reviewDate', today()), { req: true })}
        ${fieldHtml('تاریخ ایجاد تیکت', dateHtml('ticketDate', ''), { req: true })}
        ${fieldHtml('کد یکتای تیکت', textHtml('ticketCode', '', { ltr: true, ph: 'مثلاً 52418' }), { req: true })}
        ${fieldHtml('نام کارشناس', textHtml('agentName', name, { readonly: true }))}
        ${fieldHtml('تیم کارشناس', textHtml('team', team, { readonly: true }))}
      </div>
      <div class="er-sec-sub">المان‌های ارزیابی</div>
      <div class="er-crit-grid">${TICKET_ITEMS.map((it, i) => `<div class="criteria-card">
        <div class="c-top"><div class="c-title">${esc(it.label)}</div><span class="c-weight">وزن ${fa(W[i])}</span></div>
        <div data-tri="${it.key}"></div></div>`).join('')}</div>
      <div data-redline style="margin-top:12px"></div>
      <div class="field" style="margin-top:12px"><label>کامنت کنترل کیفیت</label><textarea class="input" data-f="comment" rows="2"></textarea></div>
      <div class="er-live" data-live></div>
      <div class="er-foot-row"><button type="button" class="btn primary" data-submit="ticket"><i class="fa-solid fa-floppy-disk"></i> ثبت فرم تیکت</button></div>`;
    bindCal(pane('ticket'));
    const tris = {};
    const live = () => {
      const v = {}; TICKET_ITEMS.forEach((it) => { v[it.key] = tris[it.key].getValue(); });
      const score = C.ticketScore(v.q1, v.q2, v.q3, v.q4, rl.getValue(), W);
      pane('ticket').querySelector('[data-live]').innerHTML = score === ''
        ? '<span><i class="fa-solid fa-hourglass-half" style="color:var(--warn)"></i> همه المان‌ها و ردلاین را مشخص کنید تا نمره محاسبه شود</span>'
        : `<span>نمره‌ی زنده: <b style="color:${scoreColorHex(score)};font-size:17px">${fa(score)}</b></span>${rl.getValue() === '0' ? ' <span class="badge bad"><i class="fa-solid fa-ban"></i> ردلاین — نمره صفر</span>' : ''}`;
    };
    TICKET_ITEMS.forEach((it) => {
      const t = triSwitch({ name: it.key, value: '', onChange: live });
      pane('ticket').querySelector(`[data-tri="${it.key}"]`).appendChild(t);
      tris[it.key] = t;
    });
    const rl = redlineSwitch({ value: '', onChange: live });
    pane('ticket').querySelector('[data-redline]').appendChild(rl);
    live();
    pane('ticket').querySelector('[data-submit="ticket"]').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      const payload = {
        qcAgent: readField(pane('ticket'), 'qcAgent'), reviewDate: readDate(pane('ticket'), 'reviewDate'),
        ticketDate: readDate(pane('ticket'), 'ticketDate'), agentName: name, ticketCode: readField(pane('ticket'), 'ticketCode'),
        q1: tris.q1.getValue(), q2: tris.q2.getValue(), q3: tris.q3.getValue(), q4: tris.q4.getValue(),
        redline: rl.getValue(), comment: readField(pane('ticket'), 'comment')
      };
      if (!payload.ticketCode) return toast.error('کد یکتای تیکت را وارد کنید');
      btn.disabled = true;
      try {
        const saved = await api.post('/api/tickets', payload);
        toast.success('فرم تیکت ثبت شد — نمره: ' + fa(saved.score == null ? '—' : saved.score));
        pane('ticket').innerHTML = '';
        await afterSave('history');
      } catch (err) { toast.error(err.message); }
      finally { btn.disabled = false; }
    });
  };

  /* ---- فرم سوشال ---- */
  const paintSocial = () => {
    const L = st.lists || {}, W = st.settings.socialWeights || [30, 30, 25, 15];
    pane('social').innerHTML = `
      <div class="form-grid">
        ${fieldHtml('کارشناس کنترل کیفیت', selectHtml('qcAgent', qcs, '', '— انتخاب کنید —'), { req: true })}
        ${fieldHtml('تاریخ بررسی', dateHtml('reviewDate', today()), { req: true })}
        ${fieldHtml('نام کارشناس', textHtml('agentName', name, { readonly: true }))}
        ${fieldHtml('تیم کارشناس', textHtml('team', team, { readonly: true }))}
        ${fieldHtml('پیامرسان', selectHtml('messenger', L.messengers || [], '', '— انتخاب کنید —'), { req: true })}
        ${fieldHtml('تاریخ دریافت پیام', dateHtml('receiveDate', ''), { req: true })}
        ${fieldHtml('ساعت دریافت', timeHtml('receiveTime', ''), { req: true })}
        ${fieldHtml('تاریخ پاسخ‌دهی', dateHtml('replyDate', ''), { req: true })}
        ${fieldHtml('ساعت پاسخ', timeHtml('replyTime', ''), { req: true })}
        ${fieldHtml('وضعیت پاسخ', selectHtml('responseStatus', L.responseStatuses || [], '', '— انتخاب کنید —'), { req: true })}
        ${fieldHtml('دلیل تأخیر یا عدم پاسخ', selectHtml('delayReason', L.delayReasons || [], '', '— ندارد / انتخاب کنید —'))}
        ${fieldHtml('وضعیت تأیید دلیل', selectHtml('reasonVerdict', L.reasonVerdicts || [], '', '— انتخاب کنید —'), { req: true })}
      </div>
      <div class="er-sec-sub">المان‌های ارزیابی</div>
      <div class="er-crit-grid">${SOCIAL_ITEMS.map((it, i) => `<div class="criteria-card">
        <div class="c-top"><div class="c-title">${esc(it.label)}</div><span class="c-weight">وزن ${fa(W[i])}</span></div>
        <div data-tri="${it.key}"></div></div>`).join('')}</div>
      <div class="field" style="margin-top:12px"><label>کامنت کنترل کیفیت</label><textarea class="input" data-f="comment" rows="2"></textarea></div>
      <div class="er-live" data-live></div>
      <div class="er-foot-row"><button type="button" class="btn primary" data-submit="social"><i class="fa-solid fa-floppy-disk"></i> ثبت فرم سوشال</button></div>`;
    bindCal(pane('social'));
    const sp = pane('social');
    const tris = {};
    const live = () => {
      const s = {
        receiveDate: readDate(sp, 'receiveDate'), replyDate: readDate(sp, 'replyDate'),
        receiveTime: readField(sp, 'receiveTime'), replyTime: readField(sp, 'replyTime'),
        responseStatus: readField(sp, 'responseStatus')
      };
      let dur = null, err = false;
      if (s.responseStatus === 'پاسخ داده شده' && s.receiveDate && s.replyDate && C.parseTime(s.receiveTime) && C.parseTime(s.replyTime)) {
        const mins = C.businessMinutes(C.combineJalaliTime(C.parseJalali(s.receiveDate), s.receiveTime),
          C.combineJalaliTime(C.parseJalali(s.replyDate), s.replyTime), st.settings);
        if (mins === 'خطای تاریخ') err = true; else if (typeof mins === 'number') dur = mins;
      }
      const score = C.socialScore(tris.qSla.getValue(), tris.qFollow.getValue(), tris.qClosing.getValue(), tris.qTone.getValue(), st.settings.socialWeights);
      const sla = C.slaStatus(s.responseStatus, err ? '' : dur, st.settings.slaMinutes);
      sp.querySelector('[data-live]').innerHTML = `<span>مدت پاسخ: <b>${durText(dur, err)}</b></span>
        <span>SLA: ${slaBadge(sla)}</span>
        <span>نمره‌ی زنده: <b style="color:${score === '' ? 'var(--muted)' : scoreColorHex(score)};font-size:17px">${score === '' ? '؟' : fa(score)}</b></span>`;
    };
    SOCIAL_ITEMS.forEach((it) => {
      const t = triSwitch({ name: it.key, value: '', onChange: live });
      sp.querySelector(`[data-tri="${it.key}"]`).appendChild(t);
      tris[it.key] = t;
    });
    sp.querySelectorAll('[data-f]').forEach((n) => n.addEventListener('change', live));
    live();
    sp.querySelector('[data-submit="social"]').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      const payload = {
        qcAgent: readField(sp, 'qcAgent'), reviewDate: readDate(sp, 'reviewDate'), agentName: name,
        messenger: readField(sp, 'messenger'), receiveDate: readDate(sp, 'receiveDate'), replyDate: readDate(sp, 'replyDate'),
        receiveTime: readField(sp, 'receiveTime'), replyTime: readField(sp, 'replyTime'),
        responseStatus: readField(sp, 'responseStatus'), delayReason: readField(sp, 'delayReason'),
        reasonVerdict: readField(sp, 'reasonVerdict'), comment: readField(sp, 'comment'),
        qSla: tris.qSla.getValue(), qFollow: tris.qFollow.getValue(), qClosing: tris.qClosing.getValue(), qTone: tris.qTone.getValue()
      };
      btn.disabled = true;
      try {
        const saved = await api.post('/api/socials', payload);
        toast.success('فرم سوشال ثبت شد — نمره: ' + fa(saved.score == null ? '—' : saved.score));
        pane('social').innerHTML = '';
        await afterSave('history');
      } catch (err) { toast.error(err.message); }
      finally { btn.disabled = false; }
    });
  };

  /* ---- جزئیات یک فرم ---- */
  const showRecord = (h) => {
    const r = h.record || {};
    const rows = h.kind === 'ticket'
      ? [['کد تیکت', fa(r.ticketCode)], ['تاریخ بررسی', fa(r.reviewDate)], ['تاریخ ایجاد تیکت', fa(r.ticketDate)], ['کارشناس QC', esc(r.qcAgent || '—')],
         ['نمره', scorePill(r.score)], ['ردلاین', r.redline === '1' ? 'بدون تماس با شریک' : (r.redline === '0' ? '<span class="badge bad">دارد — نمره صفر</span>' : '—')],
         ['پیگیری و رسیدگی', triValue(r.q1)], ['ثبت یادداشت', triValue(r.q2)], ['دلیل بستن تیکت', triValue(r.q3)], ['ثبت اکشن در CRM', triValue(r.q4)],
         ['کامنت QC', esc(r.comment || '—'), true], ['ثبت‌شده در', fa(r.createdAt ? String(r.createdAt).slice(0, 16).replace('T', ' ') : '—')]]
      : [['تاریخ بررسی', fa(r.reviewDate)], ['کارشناس QC', esc(r.qcAgent || '—')], ['پیامرسان', esc(r.messenger || '—')],
         ['دریافت پیام', `${fa(r.receiveDate)} · ${fa(r.receiveTime)}${r.receiveWeekday ? ' (' + esc(r.receiveWeekday) + ')' : ''}`],
         ['پاسخ‌دهی', `${fa(r.replyDate)} · ${fa(r.replyTime)}${r.replyWeekday ? ' (' + esc(r.replyWeekday) + ')' : ''}`],
         ['وضعیت پاسخ', esc(r.responseStatus || '—')], ['دلیل تأخیر', esc(r.delayReason || '—')], ['تأیید دلیل', esc(r.reasonVerdict || '—')],
         ['مدت پاسخ (ساعت کاری)', durText(r.durationMin, r.durationError)], ['SLA', slaBadge(r.slaStatus)],
         ['پاسخ‌دهی و SLA', triValue(r.qSla)], ['پیگیری', triValue(r.qFollow)], ['پایان‌بندی', triValue(r.qClosing)], ['لحن', triValue(r.qTone)],
         ['نمره', scorePill(r.score)], ['کامنت QC', esc(r.comment || '—'), true]];
    modal(`${modalHead(KIND_LABEL[h.kind] + ' — جزئیات ثبت', KIND_ICON[h.kind])}
      <div class="modal-body"><div class="detail-rows">${rows.map((x) => `<div class="detail-row${x[2] ? ' wide' : ''}"><div class="k">${x[0]}</div><div class="v">${x[1]}</div></div>`).join('')}</div></div>
      <div class="modal-foot"><button class="btn ghost" data-close>بستن</button></div>`);
  };

  const afterSave = async (to) => {
    const d = await fetchDetail(name);
    if (d && m.isConnected) { D = d; $('.er-hero-slot', m).innerHTML = headHtml(D); }
    if (to) switchTab(to);
    if (App.refreshCounts) App.refreshCounts();
    refreshGrid(root);
  };
  const switchTab = (k) => {
    current = k;
    $$('[data-ftab]', m).forEach((b) => b.classList.toggle('active', b.dataset.ftab === k));
    ['ticket', 'social', 'history'].forEach((p) => { pane(p).hidden = p !== k; });
    if (k === 'ticket' && !pane('ticket').innerHTML) paintTicket();
    if (k === 'social' && !pane('social').innerHTML) paintSocial();
    if (k === 'history') paintHistory();
  };
  $('.er-hero-slot', m).innerHTML = headHtml(D);
  $('[data-fcount]', m).textContent = records().length ? fa(records().length) : '';
  $$('[data-ftab]', m).forEach((b) => b.addEventListener('click', () => switchTab(b.dataset.ftab)));
  pane('history').addEventListener('click', (e) => {
    const b = e.target.closest('[data-rec]'); if (!b) return;
    const [kind, id] = b.dataset.rec.split(':');
    const h = D.history.find((x) => x.kind === kind && String(x.id) === id);
    if (h) showRecord(h);
  });
  paintHistory();
  switchTab(current);
  return m;
}

/* ---------------------------------------------------- پاپ‌آپ تاریخچه */
async function openHistory(name, root) {
  let D = await fetchDetail(name); if (!D) return;
  let filter = 'all';
  const m = modal(`${modalHead('تاریخچه و اقدامات — ' + name, 'fa-clock-rotate-left')}
    <div class="modal-body">
      <div class="er-hero-slot"></div>
      <div class="er-quick">
        <button type="button" class="btn primary sm" data-go="actions"><i class="fa-solid fa-bolt"></i> ثبت اکشن</button>
        <button type="button" class="btn ghost sm" data-go="forms"><i class="fa-solid fa-file-circle-plus"></i> فرم‌ها</button>
        <button type="button" class="btn ghost sm" data-go="reminder"><i class="fa-regular fa-bell"></i> ریمایندر</button>
      </div>
      <section class="er-sec">
        <div class="er-sec-h"><i class="fa-solid fa-hourglass-half"></i><div><h4>اقدامات و یادآورهای در انتظار</h4>
          <small>اقدام‌هایی که هنوز انجام نشده‌اند و یادآورهای باز.</small></div></div>
        <div data-pending></div>
      </section>
      <section class="er-sec">
        <div class="er-sec-h"><i class="fa-solid fa-timeline"></i><div><h4>تاریخچه‌ی کامل</h4>
          <small>همه‌ی اقدام‌ها، یادآورها و فرم‌های تیکت و سوشال؛ بدون محدودیت بازه.</small></div>
          <div class="spacer"></div>
          <select class="input sm" data-filter aria-label="فیلتر تاریخچه" style="width:auto;min-width:150px">
            <option value="all">همه‌ی موارد</option><option value="action">اقدام‌ها</option><option value="reminder">یادآورها</option>
            <option value="ticket">فرم‌های تیکت</option><option value="social">فرم‌های سوشال</option></select>
        </div>
        <div data-timeline></div>
      </section>
    </div>
    <div class="modal-foot"><button class="btn ghost" data-close>بستن</button></div>`, { lg: true });

  const paint = () => {
    $('.er-hero-slot', m).innerHTML = headHtml(D);
    const pending = D.pending.actions.map((a) => actionRowHtml(a)).join('');
    const rems = D.pending.reminders.map((r) => `<div class="er-rem">
        <button type="button" class="er-check" data-rem-toggle="${r.id}" data-done="false" aria-label="انجام شد"><i class="fa-regular fa-circle"></i></button>
        <div class="er-rem-t"><b>${esc(r.text)}</b><small><i class="fa-regular fa-calendar"></i> ${fa(r.date)} ${isOverdue(r) ? '<span class="badge bad">گذشته</span>' : ''}</small></div></div>`).join('');
    $('[data-pending]', m).innerHTML = (pending || rems)
      ? `<div class="er-list">${pending}${rems}</div>`
      : '<div class="er-muted">مورد باز وجود ندارد؛ همه‌ی اقدام‌ها انجام شده‌اند.</div>';
    const list = D.history.filter((h) => filter === 'all' || h.kind === filter);
    $('[data-timeline]', m).innerHTML = list.length ? `<div class="er-list">${list.map(timelineItem).join('')}</div>`
      : emptyState('fa-timeline', 'موردی برای نمایش نیست', 'با تغییر فیلتر یا ثبت اقدام/فرم، تاریخچه ساخته می‌شود.');
  };
  const refresh = async () => {
    const d = await fetchDetail(name); if (!d || !m.isConnected) return;
    D = d; paint(); refreshGrid(root);
  };
  $('[data-filter]', m).addEventListener('change', (e) => { filter = e.target.value; paint(); });
  m.querySelector('.er-quick').addEventListener('click', (e) => {
    const b = e.target.closest('[data-go]'); if (!b) return;
    m.close();
    const go = b.dataset.go;
    if (go === 'actions') openActions(name, root);
    else if (go === 'forms') openForms(name, 'ticket', root);
    else openReminders(name, root);
  });
  wireActionRows(m, refresh);
  paint();
  return m;
}

function timelineItem(h) {
  const meta = [];
  if (h.kind === 'action') {
    meta.push(`<span class="badge ${h.result === 'موفق' ? 'good' : h.result === 'ناموفق' ? 'bad' : h.result === 'نیاز به پیگیری' ? 'warn' : 'gray'}">${esc(h.result)}</span>`);
    meta.push(h.status === UI_STATE.meta.statuses.done ? '<span class="badge good">انجام شد</span>' : '<span class="badge warn">انجام نشده</span>');
  } else if (h.kind === 'reminder') {
    meta.push(h.done ? '<span class="badge good">انجام شد</span>' : (isOverdue(h) ? '<span class="badge bad">گذشته</span>' : '<span class="badge gray">باز</span>'));
  } else {
    meta.push(scorePill(h.score));
    if (h.kind === 'social') meta.push(slaBadge(h.slaStatus));
  }
  const sub = h.kind === 'action' && h.problem ? `<small class="er-problem-tag"><i class="fa-solid fa-triangle-exclamation"></i> ${esc(h.problem)}</small>`
    : (h.kind === 'action' && h.note ? `<small>${esc(h.note)}</small>` : '');
  return `<div class="er-tl-item">
    <span class="er-ic tone-${KIND_TONE[h.kind]}"><i class="fa-solid ${KIND_ICON[h.kind]}"></i></span>
    <div class="er-tl-main"><b>${esc(h.title)}</b>
      <small><span class="badge ${KIND_TONE[h.kind]}">${KIND_LABEL[h.kind]}</span> <i class="fa-regular fa-calendar"></i> ${fa(h.date)}${h.qcAgent ? ' · QC: ' + esc(h.qcAgent) : ''}</small>${sub}</div>
    <div class="er-tl-side">${meta.join(' ')}</div>
  </div>`;
}

App.register('expert-ref', { title: 'مرجع کارشناسان', render });
})();
