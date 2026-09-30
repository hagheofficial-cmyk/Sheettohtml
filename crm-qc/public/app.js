/* =========================================================================
 * app.js — هسته SPA: وضعیت، API، روتر، کامپوننت‌های مشترک
 * صفحه‌ها در pages/*.js روی App.pageX سوار می‌شوند.
 * ========================================================================= */
(function () {
'use strict';

const C = window.QCCalc;
const $ = (sel, root) => (root || document).querySelector(sel);
const $$ = (sel, root) => [...(root || document).querySelectorAll(sel)];

function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m])); }
function fa(x, def) { if (x == null || x === '') return def != null ? def : '—'; return C.toFaDigits(x); }
function el(html) { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; }
function debounce(fn, ms) { let t; return function (...a) { clearTimeout(t); t = setTimeout(() => fn.apply(this, a), ms); }; }

/* ------------------------------------------------------------------- API */
const api = {
  async req(method, url, body) {
    const res = await fetch(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined
    });
    let data = null;
    try { data = await res.json(); } catch (e) { /* پاسخ خالی */ }
    if (!res.ok) { const err = new Error((data && data.error) || 'خطای ارتباط با سرور (' + res.status + ')'); err.status = res.status; throw err; }
    return data;
  },
  get: (url) => api.req('GET', url),
  post: (url, b) => api.req('POST', url, b || {}),
  put: (url, b) => api.req('PUT', url, b || {}),
  del: (url) => api.req('DELETE', url)
};

/* ----------------------------------------------------------------- توست */
function toast(msg, type, ms) {
  type = type || 'info';
  const icons = { success: 'fa-circle-check', error: 'fa-circle-exclamation', info: 'fa-circle-info' };
  const t = el(`<div class="toast ${type}"><div class="t-ic"><i class="fa-solid ${icons[type]}"></i></div><div>${esc(msg)}</div></div>`);
  $('#toastZone').appendChild(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 320); }, ms || 3400);
}
toast.success = (m, ms) => toast(m, 'success', ms);
toast.error = (m, ms) => toast(m, 'error', ms);
toast.info = (m, ms) => toast(m, 'info', ms);

/* ----------------------------------------------------------------- مودال */
function modal(html, opts) {
  opts = opts || {};
  const back = el(`<div class="modal-back"><div class="modal ${opts.lg ? 'lg' : ''}">${html}</div></div>`);
  $('#modalRoot').appendChild(back);
  back.addEventListener('mousedown', (e) => { if (e.target === back && !opts.sticky) back.remove(); });
  $$('.x,[data-close]', back).forEach((b) => b.addEventListener('click', () => back.remove()));
  return back;
}
function modalHead(title, icon) {
  return `<div class="modal-head"><i class="fa-solid ${icon}" style="color:var(--brand)"></i><h3>${esc(title)}</h3><button class="x"><i class="fa-solid fa-xmark"></i></button></div>`;
}
function confirmDlg(title, text, onYes, yesLabel) {
  const m = modal(`
    <div class="modal-body" style="text-align:center;padding-top:26px">
      <div class="e-ic" style="width:56px;height:56px;border-radius:17px;background:var(--bad-soft);color:var(--bad);display:grid;place-items:center;font-size:22px;margin:0 auto 13px"><i class="fa-solid fa-trash-can"></i></div>
      <h3 style="font-size:15px;font-weight:800;margin-bottom:7px">${esc(title)}</h3>
      <p style="color:var(--muted);font-size:12.8px">${esc(text)}</p>
    </div>
    <div class="modal-foot" style="justify-content:center">
      <button class="btn ghost" data-close>انصراف</button>
      <button class="btn danger-soft" id="cfYes"><i class="fa-solid fa-trash"></i>${esc(yesLabel || 'بله، حذف شود')}</button>
    </div>`);
  $('#cfYes', m).addEventListener('click', () => { m.remove(); onYes(); });
}

/* ------------------------------------------------------------ کامپوننت‌ها */
/** ورودی تاریخ جلالی با نمایش خودکار روز هفته */
function dateField(opts) {
  // opts: {label, name, value, required, showWeekday, placeholder}
  const wrap = el(`<div class="field">
    <label>${esc(opts.label)}${opts.required ? ' <span class="req">*</span>' : ''}</label>
    <input class="input" dir="ltr" style="text-align:right" inputmode="numeric" name="${opts.name}"
      placeholder="${esc(opts.placeholder || '1405/06/20')}" value="${esc(opts.value || '')}" autocomplete="off">
    <div class="foot" data-foot></div>
  </div>`);
  const inp = $('input', wrap), foot = $('[data-foot]', wrap);
  const validate = () => {
    const v = inp.value.trim();
    if (!v) { foot.innerHTML = ''; inp.classList.remove('invalid'); wrap._j = null; return; }
    const j = C.parseJalali(v);
    if (!j) { inp.classList.add('invalid'); foot.className = 'foot bad'; foot.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> تاریخ نامعتبر است'; wrap._j = null; }
    else {
      inp.classList.remove('invalid');
      const norm = C.formatJalali(j);
      if (inp.value.trim() !== norm) inp.value = norm;
      wrap._j = j;
      if (opts.showWeekday !== false) { foot.className = 'foot good'; foot.innerHTML = `<i class="fa-regular fa-calendar-check"></i> ${C.weekdayFa(j)} — معتبر`; }
    }
  };
  // ماسک خودکار: فقط اعداد و اسلش؛ تبدیل 14050620 → 1405/06/20
  inp.addEventListener('input', () => {
    let v = C.faToEn(inp.value).replace(/[^\d/]/g, '');
    if (/^\d{9,}$/.test(v.replace(/\//g, ''))) v = v.slice(0, 8);
    inp.value = v;
  });
  inp.addEventListener('blur', () => {
    const raw = C.faToEn(inp.value).replace(/[^\d]/g, '');
    if (/^\d{8}$/.test(raw) && inp.value.indexOf('/') === -1) inp.value = raw.slice(0, 4) + '/' + raw.slice(4, 6) + '/' + raw.slice(6, 8);
    validate();
  });
  if (opts.value) validate();
  wrap.getValue = () => (C.parseJalali(inp.value) ? C.formatJalali(C.parseJalali(inp.value)) : '');
  return wrap;
}

/** کمبوباکس جستجوپذیر */
function combo(opts) {
  // opts: {label, name, items: [{value,label,sub}], value, required, placeholder, onPick}
  const wrap = el(`<div class="field">
    <label>${esc(opts.label)}${opts.required ? ' <span class="req">*</span>' : ''}</label>
    <div class="combo">
      <input class="input" placeholder="${esc(opts.placeholder || 'جستجو…')}" value="" autocomplete="off">
      <div class="menu"></div>
    </div>
    <div class="foot" data-foot></div>
  </div>`);
  const box = $('.combo', wrap), inp = $('input', wrap), menu = $('.menu', wrap);
  let items = opts.items || [];
  wrap._value = '';

  function renderMenu(filter) {
    const f = (filter || '').trim();
    const shown = items.filter((it) => !f || it.label.includes(f) || (it.sub || '').includes(f)).slice(0, 60);
    if (!shown.length) { menu.innerHTML = '<div class="menu-empty">موردی یافت نشد</div>'; return; }
    menu.innerHTML = shown.map((it) =>
      `<div class="menu-item" data-v="${esc(it.value)}"><span>${esc(it.label)}</span>${it.sub ? `<span class="tm">${esc(it.sub)}</span>` : ''}</div>`).join('');
    $$('.menu-item', menu).forEach((mi) => mi.addEventListener('mousedown', (e) => {
      e.preventDefault(); pick(mi.dataset.v);
    }));
  }
  function pick(v) {
    const it = items.find((x) => x.value === v);
    wrap._value = it ? it.value : '';
    inp.value = it ? it.label : v;
    box.classList.remove('open');
    if (opts.onPick) opts.onPick(it || null);
    const foot = $('[data-foot]', wrap);
    if (it && it.foot) { foot.className = 'foot good'; foot.innerHTML = `<i class="fa-solid fa-check"></i> ${esc(it.foot)}`; }
  }
  inp.addEventListener('focus', () => { inp.select(); box.classList.add('open'); renderMenu(''); });
  inp.addEventListener('input', () => { box.classList.add('open'); renderMenu(inp.value); wrap._value = ''; });
  inp.addEventListener('blur', () => {
    setTimeout(() => box.classList.remove('open'), 160);
    const jt = items.find((x) => x.label === inp.value);
    if (jt) wrap._value = jt.value;
  });
  wrap.setItems = (list) => { items = list; };
  wrap.setValue = (v) => { if (v) pick(v); };
  wrap.getValue = () => {
    const exact = items.find((x) => x.label === inp.value.trim());
    return wrap._value || (exact ? exact.value : '');
  };
  if (opts.value) wrap.setValue(opts.value);
  return wrap;
}

/** سوییچ سه‌حالته المان */
function triSwitch(opts) {
  // opts: {name, value}
  const wrap = el(`<div class="tri" data-name="${opts.name}">
    <button type="button" data-v="1"><i class="fa-solid fa-check"></i> رعایت شده</button>
    <button type="button" data-v="0"><i class="fa-solid fa-xmark"></i> عدم رعایت</button>
    <button type="button" data-v="-" title="معیار در این ارزیابی قابل سنجش نبود"><i class="fa-solid fa-minus"></i> نامرتبط</button>
  </div>`);
  wrap._value = '';
  const sync = () => $$('button', wrap).forEach((b) => {
    b.className = '';
    if (b.dataset.v === wrap._value) b.className = 'on-' + (wrap._value === '1' ? '1' : wrap._value === '0' ? '0' : 'na');
  });
  $$('button', wrap).forEach((b) => b.addEventListener('click', () => {
    wrap._value = b.dataset.v; sync();
    if (opts.onChange) opts.onChange(wrap._value);
  }));
  wrap.setValue = (v) => { wrap._value = v; sync(); };
  wrap.getValue = () => wrap._value;
  if (opts.value) wrap.setValue(opts.value);
  return wrap;
}

/** سوییچ ردلاین (عدم تماس با شریک) */
function redlineSwitch(opts) {
  const wrap = el(`<div>
    <div class="redline ok" tabindex="0">
      <div class="txt"><i class="fa-solid fa-phone-slash"></i><span>${esc(opts.label || 'عدم تماس با شریک (ردلاین)')}</span></div>
      <div class="sw"></div>
    </div>
    <div class="foot" data-foot style="margin-top:5px"></div>
  </div>`);
  const rl = $('.redline', wrap), foot = $('[data-foot]', wrap);
  wrap._value = '1';
  const sync = () => {
    rl.classList.toggle('danger', wrap._value === '0');
    rl.classList.toggle('ok', wrap._value === '1');
    if (wrap._value === '0') { foot.className = 'foot bad'; foot.innerHTML = '<i class="fa-solid fa-ban"></i> تماس با شریک = نمره این ارزیابی <b>صفر</b> خواهد شد'; }
    else { foot.className = 'foot'; foot.innerHTML = 'بدون تماس با شریک — وضعیت سالم'; }
  };
  rl.addEventListener('click', () => { wrap._value = wrap._value === '1' ? '0' : '1'; sync(); if (opts.onChange) opts.onChange(wrap._value); });
  wrap.setValue = (v) => { wrap._value = v === '' ? '' : String(v); sync(); };
  wrap.getValue = () => wrap._value;
  if (opts.value) wrap.setValue(opts.value); else sync();
  return wrap;
}

function selectField(opts) {
  const wrap = el(`<div class="field">
    <label>${esc(opts.label)}${opts.required ? ' <span class="req">*</span>' : ''}</label>
    <select class="input" name="${opts.name || ''}"></select>
  </div>`);
  const sel = $('select', wrap);
  const setOpts = (items, placeholder) => {
    sel.innerHTML = (placeholder !== false ? `<option value="">— انتخاب کنید —</option>` : '') +
      items.map((it) => `<option value="${esc(it.value != null ? it.value : it)}">${esc(it.label != null ? it.label : it)}</option>`).join('');
  };
  setOpts(opts.items || [], opts.placeholder);
  wrap.setItems = setOpts;
  wrap.getValue = () => sel.value;
  wrap.setValue = (v) => { sel.value = v; };
  return wrap;
}

/* ---------------------------------------------------------- رندر مشترک */
function scorePill(score) {
  if (score == null || score === '') return '<span class="pill-score s-na">—</span>';
  const cls = score >= 90 ? 's-good' : score >= 75 ? 's-mid' : score >= 50 ? 's-warn' : 's-bad';
  return `<span class="pill-score ${cls}">${fa(C.round2(score))}</span>`;
}
function markBadge(v) {
  if (String(v) === '1') return '<span class="mark m1"><i class="fa-solid fa-circle-check"></i></span>';
  if (String(v) === '0') return '<span class="mark m0"><i class="fa-solid fa-circle-xmark"></i></span>';
  if (String(v) === '-') return '<span class="mark mna">−</span>';
  return '<span style="color:var(--muted)">؟</span>';
}
function slaBadge(s) {
  const map = {
    'رعایت شده': 'good', 'رعایت نشده': 'bad', 'بدون پاسخ': 'warn', 'اطلاعات ناقص': 'gray'
  };
  const icons = { 'رعایت شده': 'fa-circle-check', 'رعایت نشده': 'fa-circle-xmark', 'بدون پاسخ': 'fa-phone-slash', 'اطلاعات ناقص': 'fa-circle-question' };
  if (!s) return '—';
  return `<span class="badge ${map[s] || 'gray'}"><i class="fa-solid ${icons[s] || 'fa-circle'}"></i>${esc(s)}</span>`;
}
function durText(mins, err) {
  if (err) return '<span class="badge bad"><i class="fa-solid fa-triangle-exclamation"></i>خطای تاریخ</span>';
  if (mins == null) return '<span class="badge gray">—</span>';
  if (mins < 60) return fa(mins) + ' دقیقه';
  const h = Math.floor(mins / 60), m = mins % 60;
  return fa(h) + ' ساعت' + (m ? ' و ' + fa(m) + ' دقیقه' : '');
}
function rateCell(rate) {
  if (rate === '' || rate == null) return '<span style="color:var(--muted)">—</span>';
  const c = rate >= 90 ? 'var(--good)' : rate >= 70 ? 'var(--brand)' : rate >= 50 ? 'var(--warn)' : 'var(--bad)';
  return `<span style="font-weight:800;color:${c}">${fa(rate)}٪</span> <span class="mini-bar"><div style="width:${rate}%;background:${c}"></div></span>`;
}

function pager(container, info, onGo) {
  // info: {total, page, per}
  const pages = Math.max(1, Math.ceil(info.total / info.per));
  const items = [];
  items.push(`<button data-p="${info.page - 1}" ${info.page <= 1 ? 'disabled' : ''}><i class="fa-solid fa-angle-right"></i></button>`);
  const around = 2;
  let last = 0;
  for (let p = 1; p <= pages; p++) {
    if (p === 1 || p === pages || Math.abs(p - info.page) <= around) {
      if (last && p - last > 1) items.push('<span style="color:var(--muted)">…</span>');
      items.push(`<button data-p="${p}" class="${p === info.page ? 'cur' : ''}">${fa(p)}</button>`);
      last = p;
    }
  }
  items.push(`<button data-p="${info.page + 1}" ${info.page >= pages ? 'disabled' : ''}><i class="fa-solid fa-angle-left"></i></button>`);
  container.innerHTML = items.join('') + `<span class="info">${fa(info.total)} رکورد — صفحه ${fa(info.page)} از ${fa(pages)}</span>`;
  $$('button[data-p]', container).forEach((b) => b.addEventListener('click', () => onGo(+b.dataset.p)));
}

function emptyState(icon, title, text, cta) {
  return `<div class="empty"><div class="e-ic"><i class="fa-solid ${icon}"></i></div><h4>${esc(title)}</h4><p>${esc(text)}</p>${cta || ''}</div>`;
}

/* ------------------------------------------------------------------- روتر */
const App = {
  state: null, // bootstrap
  routes: {},
  charts: [],

  register(name, spec) { this.routes[name] = spec; },

  async boot() {
    this.state = await api.get('/api/bootstrap');
    const st = this.state;
    $('#orgName').textContent = st.settings.orgName || 'سامانه کنترل کیفیت';
    const t = C.todayJalali();
    $('#todayChip span').textContent = `${C.weekdayFa(t)} ${C.toFaDigits(t.jd)} ${['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'][t.jm - 1]} ${C.toFaDigits(t.jy)}`;
    $('#footCounts').textContent = `${C.toFaDigits(st.counts.tickets)} تیکت · ${C.toFaDigits(st.counts.socials)} سوشال`;
  },

  agentComboItems() {
    return this.state.agents.map((a) => ({ value: a.name, label: a.name, sub: a.team, foot: 'تیم: ' + a.team }));
  },
  teamOf(name) { const a = this.state.agents.find((x) => x.name === name); return a ? a.team : ''; },

  setTitle(t) { $('#pageTitle').textContent = t; document.title = t + ' — سامانه کنترل کیفیت CRM'; },

  parseHash() {
    const h = location.hash.replace(/^#\/?/, '');
    const parts = h.split('/');
    return { name: parts[0] || 'dashboard', arg: parts[1], arg2: parts[2] };
  },

  async route() {
    const { name, arg, arg2 } = this.parseHash();
    // ناوبری فعال
    $$('.nav-item, .nav-subitem').forEach((a) => {
      const r = a.dataset.route;
      let key = name;
      if (arg === 'new' || arg === 'edit') key = name + '-new';
      a.classList.toggle('active', r === key);
    });
    // گروه بازکردن
    $$('.nav-group').forEach((g) => g.classList.toggle('open',
      (name === 'tickets' && g.querySelector('[data-toggle="tickets"]')) ||
      (name === 'socials' && g.querySelector('[data-toggle="socials"]')) ? true : g.classList.contains('open') && !!g.querySelector('.active')
    ));

    // نابودسازی نمودارهای قبلی
    this.charts.forEach((ch) => { try { ch.destroy(); } catch (e) {} });
    this.charts = [];

    const content = $('#content');
    let spec = this.routes[name] || this.routes.dashboard;
    if (spec.title) this.setTitle(typeof spec.title === 'function' ? spec.title(arg, arg2) : spec.title);
    content.innerHTML = '';
    window.scrollTo(0, 0);
    try {
      await spec.render(content, arg, arg2);
    } catch (e) {
      console.error(e);
      content.innerHTML = `<div class="card">${emptyState('fa-triangle-exclamation', 'خطا در بارگذاری بخش', e.message, `<button class="btn ghost" onclick="App.route()">تلاش دوباره</button>`)}</div>`;
    }
    this.closeSidebar();
  },

  chart(canvas, cfg) {
    Chart.defaults.font.family = 'Vazirmatn';
    Chart.defaults.color = '#8ea0bd';
    const ch = new Chart(canvas, cfg);
    this.charts.push(ch);
    return ch;
  },

  closeSidebar() { $('#sidebar').classList.remove('open'); $('#sidebarBackdrop').classList.remove('show'); },

  async init() {
    try { await this.boot(); }
    catch (e) { $('#content').innerHTML = `<div class="card">${emptyState('fa-plug-circle-xmark', 'عدم اتصال به سرور', e.message)}</div>`; return; }

    $('#hamburger').addEventListener('click', () => { $('#sidebar').classList.add('open'); $('#sidebarBackdrop').classList.add('show'); });
    $('#sidebarClose').addEventListener('click', () => this.closeSidebar());
    $('#sidebarBackdrop').addEventListener('click', () => this.closeSidebar());
    $$('.nav-group-title').forEach((g) => g.addEventListener('click', () => g.parentElement.classList.toggle('open')));

    window.addEventListener('hashchange', () => this.route());
    if (!location.hash) location.hash = '#/dashboard';
    await this.route();
  }
};

// اکسپورت سراسری
window.App = App;
window.UI = { C, $, $$, esc, fa, el, api, toast, modal, modalHead, confirmDlg, dateField, combo, triSwitch, redlineSwitch, selectField, scorePill, markBadge, slaBadge, durText, rateCell, pager, emptyState, debounce };
})();
