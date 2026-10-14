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
function fa(x, def) { if (x == null || x === '') return def != null ? def : '—'; return esc(C.toFaDigits(x)); }
function el(html) { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; }
function debounce(fn, ms) { let t; return function (...a) { clearTimeout(t); t = setTimeout(() => fn.apply(this, a), ms); }; }

/* ------------------------------------------------------------------- API */
const api = {
  /* اگر سرور در دسترس نباشد (محیط پیش‌نمایش بیرون از نوبت کاری خاموش می‌شود)،
   * به‌طور خودکار روی لایه‌ی لوكال مرورگر (LocalApi) کار می‌کنیم — برنامه هرگز
   * با خطای «عدم اتصال به سرور» متوقف نمی‌شود و به محض برگشتن سرور
   * به‌صورت خودکار آنلاین برمی‌گردیم. */
  offline: false,
  _lastProbe: 0,
  browserPinned: false,
  _writes: new Set(),
  async waitForWrites(){ await Promise.all([...this._writes]); },
  async req(method,url,body){
    if(method!=='GET'&&window.BrowserSession&&BrowserSession.saving){const error=new Error('تأیید اطلاعات در حال انجام است؛ پس از آن ذخیره کنید');error.status=409;throw error;}
    const work=this._request(method,url,body);if(method!=='GET')this._writes.add(work);
    try{const result=await work;if(method!=='GET'&&window.BrowserSession)BrowserSession.markChanged();return result;}finally{this._writes.delete(work);}
  },
  async _request(method, url, body) {
    url = App.withDateRange(url, method);
    if(api.browserPinned){ const methodName=method==='GET'?'get':method==='POST'?'post':method==='PUT'?'put':'del';return window.LocalApi[methodName](url,body); }
    if (!api.offline) {
      try {
        const res = await fetch(url, {
          method,
          headers: body ? { 'Content-Type': 'application/json' } : undefined,
          body: body ? JSON.stringify(body) : undefined
        });
        let data = null;
        try { data = await res.json(); } catch (e) { /* پاسخ خالی */ }
        if (!res.ok) { const err = new Error((data && data.error) || 'خطای ارتباط با سرور (' + res.status + ')'); err.status = res.status; throw err; }
        return data;
      } catch (e) {
        /* خطاهای واقعی (۴xx/۵xx) سرور جزو فallback نیستند؛ فقط شبکه‌ی قطع */
        if (!(e instanceof TypeError) || !window.LocalApi) throw e;
        api.offline = true; api._lastProbe = Date.now(); api._showOfflineTag();
        toast.error('اتصال به سرور قطع شد — حالت آفلاین فعال است (داده در مرورگر ذخیره می‌شود)');
      }
    }
    /* حالت آفلاین: هر ۸ ثانیه یک‌بار سرور را چک کن تا به‌تنهایی آنلاین برگردیم */
    if (Date.now() - api._lastProbe > 8000) {
      api._lastProbe = Date.now();
      try {
        const res = await fetch('/api/bootstrap');
        if (res.ok) {
          api.offline = false; api._lastProbe = 0; api._hideOfflineTag();
          toast.success('اتصال به سرور برقرار شد — حالت آنلاین فعال است');
          return api.req(method, url, body);
        }
      } catch (e) { /* هنوز آفلاین */ }
    }
    const m = method === 'GET' ? 'get' : method === 'POST' ? 'post' : method === 'PUT' ? 'put' : 'del';
    try {
      return await window.LocalApi[m](url, body);
    } catch (err) {
      const e2 = new Error(err && err.message ? err.message : 'خطای حالت آفلاین');
      e2.status = err && err.status;
      throw e2;
    }
  },
  get: (url) => api.req('GET', url),
  post: (url, b) => api.req('POST', url, b || {}),
  put: (url, b) => api.req('PUT', url, b || {}),
  del: (url, body) => api.req('DELETE', url, body),
  _showOfflineTag() {
    if (document.getElementById('offlineBadge')) return;
    document.body.appendChild(el(`<div id="offlineBadge"><i class="fa-solid fa-plug-circle-xmark"></i> حالت آفلاین — داده‌های این دستگاه ذخیره می‌شوند</div>`));
  },
  _hideOfflineTag() { const b = document.getElementById('offlineBadge'); if (b) b.remove(); }
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
  const focused = document.activeElement;
  const back = el(`<div class="modal-back"><div class="modal ${opts.lg ? 'lg' : ''} ${opts.className || ''}" role="dialog" aria-modal="true" tabindex="-1">${html}</div></div>`);
  $('#modalRoot').appendChild(back); document.body.classList.add('modal-open');
  let closed = false; const removeNode = back.remove.bind(back);
  const close = () => {
    if (closed) return; closed = true; removeNode(); document.removeEventListener('keydown', keyboard);
    if (!$('#modalRoot .modal-back')) document.body.classList.remove('modal-open');
    if (opts.onClose) opts.onClose();
    if (focused && focused.isConnected) focused.focus();
  };
  const keyboard = e => {
    if ($('#modalRoot').lastElementChild !== back) return;
    if (e.key === 'Escape' && !opts.sticky) { e.preventDefault(); close(); }
    if (e.key === 'Tab') {
      const controls = $$('button:not([disabled]),input:not([disabled]),select:not([disabled]),a[href]',back).filter(n => !n.hidden && n.getAttribute('type') !== 'hidden');
      if (!controls.length) return;
      const first = controls[0], last = controls[controls.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  };
  document.addEventListener('keydown', keyboard);
  back.close = close; back.remove = close;
  back.addEventListener('mousedown', e => { if (e.target === back && !opts.sticky) close(); });
  $$('.x,[data-close]', back).forEach(b => b.addEventListener('click', close));
  const focusable = $('input:not([type="file"]),button,.modal',back); if (focusable) focusable.focus();
  return back;
}

function confirmImport(title, summary, replacementScope) {
  return new Promise(resolve => {
    let settled = false;
    const m = modal(`${modalHead(title,'fa-file-import')}<div class="modal-body">
      <div class="import-preview">${esc(summary)}</div>
      <div class="import-choice">
        <label class="import-option"><input type="radio" name="importMode" value="append" checked><strong><i class="fa-solid fa-layer-group"></i> افزودن به دیتای موجود</strong><small>دیتای قبلی و تنظیمات فعلی حفظ می‌شوند. ریت‌های تکراری دوباره شمرده نمی‌شوند؛ مناسب آرشیو ماهانه.</small></label>
        <label class="import-option"><input type="radio" name="importMode" value="replace"><strong><i class="fa-solid fa-arrows-rotate"></i> جایگزینی</strong><small>${esc(replacementScope)}</small></label>
      </div><label id="importReplaceWarning" class="import-warning" hidden><input type="checkbox" id="importReplaceAcknowledge"> می‌دانم داده‌های فعلیِ شرح‌داده‌شده جایگزین می‌شوند و بک‌اپ لازم را گرفته‌ام.</label>
      <div class="note">هیچ داده‌ای قبل از زدن دکمه‌ی تأیید تغییر نمی‌کند.</div>
      </div><div class="modal-foot"><button class="btn ghost" data-close>انصراف</button><button class="btn primary" id="importConfirm"><i class="fa-solid fa-check"></i> تأیید افزودن داده</button></div>`, { lg:true, onClose(){ if(!settled) resolve(null); } });
    const change=()=>{const replacing=$('input[name="importMode"]:checked',m).value==='replace';$('#importReplaceWarning',m).hidden=!replacing;$('#importConfirm',m).disabled=replacing&&!$('#importReplaceAcknowledge',m).checked;$('#importConfirm',m).textContent=replacing?'تأیید جایگزینی داده':'تأیید افزودن داده';};
    $$('input',m).forEach(input=>input.addEventListener('change',change));
    $('#importConfirm',m).addEventListener('click',()=>{const mode=$('input[name="importMode"]:checked',m).value;if(mode==='replace'&&!$('#importReplaceAcknowledge',m).checked)return;settled=true;m.close();resolve(mode);});
  });
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

let openMs = null; // منوی چندانتخابی بازِ فعلی (فقط یکی همزمان)
/** چندانتخابی جستجوپذیر (چک‌باکسی) — برای فیلترها */
function multiSelect(opts) {
  // opts: {label, items:[{value,label,sub}], allLabel, placeholder, onChange, width}
  const allLabel = opts.allLabel || 'همه';
  const wrap = el(`<div class="field grow-0">
    <label>${esc(opts.label)}</label>
    <div class="mselect">
      <button type="button" class="input ms-btn"${opts.width ? ` style="width:${opts.width}px"` : ''}>
        <span class="ms-label">${esc(allLabel)}</span><i class="fa-solid fa-caret-down"></i>
      </button>
      <div class="ms-menu">
        <div class="ms-search"><input class="input sm" placeholder="${esc(opts.placeholder || 'جستجو…')}"></div>
        <label class="ms-item ms-all"><input type="checkbox" checked><span>${esc(allLabel)}</span></label>
        <div class="ms-list"></div>
      </div>
    </div>
  </div>`);
  const box = $('.mselect', wrap), btn = $('.ms-btn', wrap), lbl = $('.ms-label', wrap),
    menu = $('.ms-menu', wrap), search = $('.ms-search input', wrap),
    allCb = $('.ms-all input', wrap), list = $('.ms-list', wrap);
  let items = opts.items || [];

  function renderList(f) {
    const q = (f || '').trim();
    const shown = items.filter((it) => !q || it.label.includes(q) || (it.sub || '').includes(q));
    if (!shown.length) { list.innerHTML = '<div class="menu-empty">موردی یافت نشد</div>'; return; }
    list.innerHTML = shown.map((it) =>
      `<label class="ms-item"><input type="checkbox" data-v="${esc(it.value)}" ${it._sel ? 'checked' : ''}><span>${esc(it.label)}</span>${it.sub ? `<span class="tm">${esc(it.sub)}</span>` : ''}</label>`).join('');
    $$('input[type=checkbox]', list).forEach((cb) => cb.addEventListener('change', onItem));
  }
  function onItem() {
    items.forEach((it) => {
      const cb = list.querySelector(`input[data-v="${CSS.escape(String(it.value))}"]`);
      if (cb) it._sel = cb.checked;
    });
    const selN = items.filter((x) => x._sel).length;
    allCb.checked = selN === 0;
    syncLabel();
    if (opts.onChange) opts.onChange(getValues());
  }
  function syncLabel() {
    const sel = items.filter((x) => x._sel);
    allCb.checked = sel.length === 0;
    if (!sel.length) { lbl.textContent = allLabel; return; }
    if (sel.length === 1) { lbl.textContent = sel[0].label; return; }
    lbl.textContent = C.toFaDigits(sel.length) + ' مورد انتخاب شد';
  }
  function getValues() { return items.filter((x) => x._sel).map((x) => x.value); }

  // منوی شناور: هنگام باز شدن به body منتقل و با position:fixed کنار دکمه قرار می‌گیرد (بالای همه‌ی UI)
  const portal = document.createElement('div');
  portal.className = 'mselect ms-portal';
  function placeMenu() {
    const r = btn.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight;
    const width = Math.max(235, r.width);
    const spaceBelow = vh - r.bottom - 10, spaceAbove = r.top - 10;
    const left = Math.max(8, Math.min(r.right - width, vw - width - 8));
    portal.style.left = left + 'px';
    portal.style.minWidth = width + 'px';
    if (spaceBelow >= 200 || spaceBelow >= spaceAbove) {
      portal.style.top = (r.bottom + 5) + 'px'; portal.style.bottom = 'auto';
      menu.style.maxHeight = Math.max(120, Math.min(290, spaceBelow)) + 'px';
    } else {
      portal.style.bottom = (vh - r.top + 5) + 'px'; portal.style.top = 'auto';
      menu.style.maxHeight = Math.max(120, Math.min(290, spaceAbove)) + 'px';
    }
  }
  function closeMenu() {
    if (!portal.classList.contains('open')) return;
    portal.classList.remove('open'); portal.remove();
    box.classList.remove('open'); box.appendChild(menu);
    menu.style.maxHeight = '';
    if (openMs === closeMenu) openMs = null;
  }
  function openMenu() {
    if (openMs && openMs !== closeMenu) openMs();
    portal.appendChild(menu); document.body.appendChild(portal);
    portal.classList.add('open'); box.classList.add('open');
    placeMenu(); openMs = closeMenu;
    search.value = ''; renderList(''); search.focus({ preventScroll: true });
  }
  btn.addEventListener('click', (e) => { e.stopPropagation(); if (portal.classList.contains('open')) closeMenu(); else openMenu(); });
  menu.addEventListener('click', (e) => e.stopPropagation());
  search.addEventListener('input', () => renderList(search.value));
  allCb.addEventListener('change', () => {
    if (allCb.checked) { items.forEach((it) => { it._sel = false; }); renderList(search.value); syncLabel(); if (opts.onChange) opts.onChange([]); }
  });
  document.addEventListener('click', closeMenu);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });
  window.addEventListener('resize', closeMenu);
  window.addEventListener('hashchange', closeMenu);
  window.addEventListener('scroll', closeMenu, { passive: true });
  wrap.addEventListener('destroy', () => {});

  wrap.getValues = getValues;
  wrap.notifyChange = () => { if(opts.onChange)opts.onChange(getValues()); };
  wrap.setValues = (vals) => {
    const set = new Set(vals || []);
    items.forEach((it) => { it._sel = set.has(it.value); });
    syncLabel();
  };
  wrap.setItems = (arr, keepSel) => {
    const prev = keepSel ? new Set(getValues()) : new Set();
    items = (arr || []).map((it) => ({ value: it.value, label: it.label, sub: it.sub, _sel: prev.has(it.value) }));
    if (box.classList.contains('open')) renderList(search.value);
    syncLabel();
  };
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
/* آستانه‌بندی قابل تنظیم نمره از مدیریت پایه — پیش‌فرض [90,75,50] */
function scoreBands() {
  const b = (App.state && App.state.settings && App.state.settings.scoreBands);
  return (Array.isArray(b) && b.length === 3) ? b : [90, 75, 50];
}
function scoreColorHex(v) {
  const B = scoreBands();
  return v >= B[0] ? '#34d399' : v >= B[1] ? '#38bdf8' : v >= B[2] ? '#fbbf24' : '#f87171';
}
function scoreColorRgba(v) {
  const B = scoreBands();
  return v >= B[0] ? 'rgba(52,211,153,.8)' : v >= B[1] ? 'rgba(56,189,248,.8)' : v >= B[2] ? 'rgba(251,191,36,.8)' : 'rgba(248,113,113,.8)';
}
function scorePill(score) {
  score = C.normalizeScore(score);
  if (score == null) return '<span class="pill-score s-na">—</span>';
  const B = scoreBands();
  const cls = score >= B[0] ? 's-good' : score >= B[1] ? 's-mid' : score >= B[2] ? 's-warn' : 's-bad';
  return `<span class="pill-score ${cls}">${fa(C.round2(score))}</span>`;
}
function markBadge(v) {
  if (String(v) === '1') return '<span class="mark m1"><i class="fa-solid fa-circle-check"></i></span>';
  if (String(v) === '0') return '<span class="mark m0"><i class="fa-solid fa-circle-xmark"></i></span>';
  if (String(v) === '-') return '<span class="mark mna">−</span>';
  return '<span style="color:var(--muted)">؟</span>';
}
/** مقدار واقعی سلول فرم؛ «ثبت‌نشده» هرگز صفر یا موضوعیت‌نداشته تلقی نمی‌شود. */
function triValue(v) {
  const n = C.normalizeTri(v);
  if (n === 1) return '<span class="tri-value ok" title="رعایت شده">1</span>';
  if (n === 0) return '<span class="tri-value bad" title="عدم رعایت">0</span>';
  if (n === '-') return '<span class="tri-value na" title="موضوعیت نداشته">-</span>';
  return '<span class="tri-value na" title="نمره این المان ثبت نشده">—</span>';
}
function callRedlineBadge(row, index) {
  return window.QCReports.hasRedline(row, 'call')
    ? `<button type="button" class="badge bad redline-link" data-call-redline="${index}" title="نمایش توضیحات ردلاین">${fa(1)}</button>` : '-';
}
function showCallRedline(row) {
  modal(`${modalHead('توضیحات ردلاین تماس', 'fa-ban')}<div class="modal-body">
    <div class="detail-rows"><div class="detail-row"><div class="k">کارشناس</div><div class="v">${esc(row.expertName)}</div></div>
      <div class="detail-row"><div class="k">نام شریک</div><div class="v">${esc(row.leadName || '—')}</div></div>
      <div class="detail-row"><div class="k">تاریخ بررسی</div><div class="v">${fa(row.reviewDate)}</div></div>
      <div class="detail-row wide"><div class="k">علت ردلاین</div><div class="v" style="white-space:pre-wrap">${esc(row.redlineReason || 'علت ردلاین در فرم ثبت نشده است')}</div></div>
      ${row.qcComment ? `<div class="detail-row wide"><div class="k">کامنت QC</div><div class="v" style="white-space:pre-wrap">${esc(row.qcComment)}</div></div>` : ''}</div>
    </div><div class="modal-foot"><button class="btn ghost" data-close>بستن</button></div>`);
}
function bindCallRedlines(root, rows) {
  $$('[data-call-redline]', root).forEach((b) => b.addEventListener('click', () => {
    const row = rows[Number(b.dataset.callRedline)];
    if (row) showCallRedline(row);
  }));
}
function callTimeCell(row) {
  const format = (v) => /^\d+(?:\.\d+)?$/.test(C.faToEn(String(v))) ? fa(v) + ' ثانیه' : esc(v);
  if (row.callDuration != null && row.callDuration !== '' && row.callDuration !== '-') return format(row.callDuration);
  // فرم فعلی فقط زمان شنود دارد؛ آن را به‌جای مدت واقعی مکالمه جا نزنیم.
  return '—' + (row.listeningTime && row.listeningTime !== '-' ? `<div class="cell-sub">زمان شنود: ${format(row.listeningTime)}</div>` : '');
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
  const B = scoreBands();
  const c = rate >= B[0] ? 'var(--good)' : rate >= B[1] ? 'var(--brand)' : rate >= B[2] ? 'var(--warn)' : 'var(--bad)';
  return `<span style="font-weight:800;color:${c}">${fa(rate)}٪</span> <span class="mini-bar"><div style="width:${rate}%;background:${c}"></div></span>`;
}

function errorRateCell(rate) {
  if (rate === '' || rate == null) return '<span style="color:var(--muted)">—</span>';
  const color = scoreColorHex(100 - rate);
  return `<span style="font-weight:800;color:${color}">${fa(rate)}٪</span> <span class="mini-bar"><div style="width:${rate}%;background:${color}"></div></span>`;
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
  dateRange: { from: '', to: '', preset: 'all' },
  _rangeReady: false,
  _dateRefresh: null,
  _countsRequest: 0,
  _rangeRequest: 0,
  _routeRequest: 0,
  _dateTimer: null,

  withDateRange(url, method) {
    if (method !== 'GET') return url; // ثبت، حذف و بک‌اپ کامل به‌صورت پنهان محدود نشوند.
    const [pathname, query] = url.split('?');
    if (!['/api/dashboard', '/api/reports', '/api/portfolio', '/api/portfolio/agents', '/api/tickets',
      '/api/socials', '/api/data/status', '/api/calls/analysis', '/api/expert-ref'].includes(pathname) && !pathname.startsWith('/api/portfolio/') && !pathname.startsWith('/api/expert-ref/')) return url;
    const p = new URLSearchParams(query || '');
    p.delete('from'); p.delete('to');
    if (this.dateRange.from) p.set('from', this.dateRange.from);
    if (this.dateRange.to) p.set('to', this.dateRange.to);
    const qs = p.toString();
    return pathname + (qs ? '?' + qs : '');
  },
  onDateRangeChange(refresh) { this._dateRefresh = refresh; },
  dateRangeLabel() {
    const r = this.dateRange;
    return r.from || r.to ? 'از ' + fa(r.from || 'ابتدا') + ' تا ' + fa(r.to || 'انتها') : 'همه تاریخ‌ها';
  },
  presetRange(preset) {
    if (preset === 'all') return { from: '', to: '', preset };
    const t = C.todayJalali();
    if (preset === 'today') return { from: C.formatJalali(t), to: C.formatJalali(t), preset };
    const month = preset === 'prev' ? C.jalaliMonthAdd(t.jy, t.jm, -1) : t;
    const r = C.jalaliMonthRange(month.jy, month.jm);
    return { from: C.formatJalali(r.from), to: C.formatJalali(r.to), preset };
  },
  initDateRange() {
    if (this._rangeReady) return;
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem('crmqc.dateRange.v1')); } catch (e) {}
    if (saved && !window.QCReports.validateRange(saved)) {
      this.dateRange = { from: saved.from ? C.formatJalali(C.parseDate(saved.from)) : '',
        to: saved.to ? C.formatJalali(C.parseDate(saved.to)) : '', preset: saved.preset || 'custom' };
    } else this.dateRange = this.presetRange(this.state.settings.defaultPreset || 'cur');
    this._rangeReady = true;
    this.syncDateRangeUI();
  },
  syncDateRangeUI() {
    const r = this.dateRange;
    $('#gFrom').value = r.from; $('#gTo').value = r.to;
    $('#gFrom').dataset.value = r.from; $('#gTo').dataset.value = r.to;
    $('#gFrom').classList.remove('invalid'); $('#gTo').classList.remove('invalid');
    $('#gPreset').value = r.preset || 'custom';
    $('#gRangeNote').className = 'range-note';
    $('#globalRange').classList.remove('draft');
    $('#gRangeState').textContent = 'اعمال‌شده';
    $('#gRangeNote').textContent = this.dateRangeLabel() + ' · مبنا: تاریخ بررسی فرم؛ اطلاعات کارشناسان و عملیات بک‌اپ/پاک‌سازی مستقل‌اند.';
  },
  async setDateRange(range) {
    const error = window.QCReports.validateRange(range);
    if (error) { toast.error(error); return false; }
    clearTimeout(this._dateTimer);
    const request = ++this._rangeRequest;
    this.dateRange = { from: range.from ? C.formatJalali(C.parseDate(range.from)) : '',
      to: range.to ? C.formatJalali(C.parseDate(range.to)) : '', preset: range.preset || 'custom' };
    try { localStorage.setItem('crmqc.dateRange.v1', JSON.stringify(this.dateRange)); } catch(e) {}
    this.syncDateRangeUI();
    $('#globalRange').classList.add('updating'); $('#gRangeState').textContent = 'در حال بروزرسانی گزارش‌ها…';
    const refresh = this._dateRefresh;
    try { await Promise.all([this.refreshCounts(), refresh ? refresh() : Promise.resolve()]); }
    finally { if (request === this._rangeRequest) {
      $('#globalRange').classList.remove('updating');
      if (!$('#globalRange').classList.contains('draft')) $('#gRangeState').textContent = 'روی همه گزارش‌ها اعمال شد';
      if(window.BrowserSession)BrowserSession.markChanged();
    } }
    return true;
  },

  async refreshCounts() {
    const request = ++this._countsRequest;
    try {
      const counts = await api.get('/api/data/status');
      if (request !== this._countsRequest) return;
      $('#footCounts').textContent = `${fa(counts.tickets)} تیکت · ${fa(counts.socials)} سوشال · ${fa(counts.calls)} تماس`;
    } catch (e) { /* خطای صفحه‌ی فعلی جداگانه نمایش داده می‌شود. */ }
  },
  bindDateRangeUI() {
    const apply = (showError = true) => {
      clearTimeout(this._dateTimer);
      const range = { from: $('#gFrom').value.trim(), to: $('#gTo').value.trim(), preset: 'custom' };
      const error = window.QCReports.validateRange(range);
      if (error) {
        const reversed = C.parseDate(range.from) && C.parseDate(range.to) && C.jalaliCmp(C.parseDate(range.from),C.parseDate(range.to)) > 0;
        $('#gFrom').classList.toggle('invalid', !!reversed || !!range.from && !C.parseDate(range.from));
        $('#gTo').classList.toggle('invalid', !!reversed || !!range.to && !C.parseDate(range.to));
        $('#gRangeState').textContent = 'هنوز اعمال نشده';
        $('#gRangeNote').className = 'range-note bad'; $('#gRangeNote').textContent = error;
        if (showError) toast.error(error); return;
      }
      $('#globalRange').classList.remove('draft');
      return this.setDateRange(range);
    };
    $('#globalRange').addEventListener('submit', e => { e.preventDefault(); apply(); });
    ['gFrom','gTo'].forEach(id => {
      const input = $('#' + id);
      input.addEventListener('input', () => {
        $('#globalRange').classList.add('draft'); $('#gPreset').value = 'custom';
        $('#gRangeState').textContent = 'در انتظار تاریخ معتبر…';
        clearTimeout(this._dateTimer); this._dateTimer = setTimeout(() => apply(false), 550);
      });
      input.addEventListener('change', () => apply(false));
    });
    JCal.attach($('#gFromBtn'), { input: $('#gFrom'), onPick: () => apply() });
    JCal.attach($('#gToBtn'), { input: $('#gTo'), onPick: () => apply() });
    $('#gPreset').addEventListener('change', () => {
      clearTimeout(this._dateTimer); $('#globalRange').classList.remove('draft');
      if ($('#gPreset').value !== 'custom') this.setDateRange(this.presetRange($('#gPreset').value));
    });
    $('#gReset').addEventListener('click', () => { $('#globalRange').classList.remove('draft'); this.setDateRange(this.presetRange('all')); });
  },
  theme: 'dark',
  applyTheme(theme) {
    this.theme = theme === 'light' ? 'light' : 'dark'; document.documentElement.dataset.theme = this.theme;
    try { localStorage.setItem('crmqc.theme.v1', this.theme); } catch(e) {}
    const button = $('#themeToggle');
    if (button) { button.innerHTML = `<i class="fa-solid ${this.theme === 'dark' ? 'fa-sun' : 'fa-moon'}"></i><span>${this.theme === 'dark' ? 'حالت روشن' : 'حالت تاریک'}</span>`; button.setAttribute('aria-pressed',String(this.theme === 'light')); }
    this.charts.forEach(chart => { if (!chart.config || !chart.config.options) return; this.styleChart(chart.config.options); if (chart.update) chart.update('none'); });
    const frame = $('#crFrame'); if (frame && frame.contentWindow) frame.contentWindow.postMessage({ type:'crmqc:theme', theme:this.theme }, location.origin === 'null' ? '*' : location.origin);
  },
  styleChart(options) {
    const css = getComputedStyle(document.documentElement), color = css.getPropertyValue('--muted').trim(), grid = css.getPropertyValue('--line-soft').trim();
    if (options.scales) Object.values(options.scales).forEach(scale => { scale.ticks = Object.assign({},scale.ticks,{ color }); scale.grid = Object.assign({},scale.grid,{ color:grid }); });
    options.plugins = options.plugins || {}; options.plugins.legend = options.plugins.legend || {};
    options.plugins.legend.labels = Object.assign({}, options.plugins.legend.labels, { color });
  },

  register(name, spec) { this.routes[name] = spec; },

  async boot() {
    this.state = await api.get('/api/bootstrap');
    const st = this.state;
    $('#orgName').textContent = st.settings.orgName || 'سامانه کنترل کیفیت';
    const t = C.todayJalali();
    $('#todayChip span').textContent = `${C.weekdayFa(t)} ${C.toFaDigits(t.jd)} ${['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'][t.jm - 1]} ${C.toFaDigits(t.jy)}`;
    if (window.QCParse) window.QCParse.setConfig(st.settings.callCriteria);
    this.applyTheme(document.documentElement.dataset.theme || 'dark');
    this.initDateRange();
    await this.refreshCounts();
    $('#dataSourceBadge').textContent=api.browserPinned?'نسخه مرورگر':api.offline?'آفلاین':'سرور';
    if(api.browserPinned){const badge=$('#dataSourceBadge');badge.title='نسخه ذخیره‌شده در این مرورگر؛ تغییرات محلی خودکار به سرور ارسال نمی‌شوند.';}
    if(window.BrowserSession)BrowserSession.status();
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
    const routeRequest = ++this._routeRequest;
    $$('#modalRoot .modal-back').forEach(m => m.close ? m.close() : m.remove());
    clearTimeout(this._dateTimer);
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

    // رفرش تاریخ متعلق به روت قبلی است؛ فرم ثبت/ویرایش را دوباره نسازیم.
    this._dateRefresh = null;
    JCal.closePopup();
    this.clearCharts();

    const content = $('#content');
    let spec = this.routes[name] || this.routes.dashboard;
    if (spec.title) this.setTitle(typeof spec.title === 'function' ? spec.title(arg, arg2) : spec.title);
    const view = document.createElement('section'); view.className = 'route-view'; content.replaceChildren(view);
    window.scrollTo(0, 0);
    try {
      await spec.render(view, arg, arg2);
    } catch (e) {
      if (routeRequest !== this._routeRequest) return;
      console.error(e);
      view.innerHTML = `<div class="card">${emptyState('fa-triangle-exclamation', 'خطا در بارگذاری بخش', e.message, `<button class="btn ghost" onclick="App.route()">تلاش دوباره</button>`)}</div>`;
    }
    if (routeRequest === this._routeRequest) this.closeSidebar();
  },

  chart(canvas, cfg) {
    if (!canvas) { console.warn('[chart] canvas موجود نیست — رندر این نمودار رد شد', cfg && cfg.type); return null; }
    Chart.defaults.font.family = 'Vazirmatn';
    Chart.defaults.color = getComputedStyle(document.documentElement).getPropertyValue('--muted').trim();
    cfg.options = cfg.options || {}; this.styleChart(cfg.options);
    const ch = new Chart(canvas, cfg);
    this.charts.push(ch);
    return ch;
  },

  clearCharts() { this.charts.forEach((ch) => { try { ch.destroy(); } catch (e) {} }); this.charts = []; },

  closeSidebar() { $('#sidebar').classList.remove('open'); $('#sidebarBackdrop').classList.remove('show'); },

  async init() {
    try { if(window.BrowserSession)await BrowserSession.initialize();await this.boot(); }
    catch (e) { $('#content').innerHTML = `<div class="card">${emptyState('fa-plug-circle-xmark', 'عدم اتصال به سرور', e.message)}</div>`; return; }

    this.bindDateRangeUI();
    $('#themeToggle').addEventListener('click', () => {this.applyTheme(this.theme === 'dark' ? 'light' : 'dark');if(window.BrowserSession)BrowserSession.markChanged();});
    if(window.BrowserSession)BrowserSession.bind();
    // همبرگر: در موبایل دراور را باز می‌کند؛ در دسکتاپ فهرست کناری را جمع/باز می‌کند (انتخاب کاربر ذخیره می‌شود)
    const narrowMQ = window.matchMedia ? window.matchMedia('(max-width: 1024px)') : { get matches() { return window.innerWidth <= 1024; } };
    try { if (localStorage.getItem('crmqc.sidebar.v1') === 'collapsed') $('#app').classList.add('sidebar-collapsed'); } catch (e) { /* بی‌اثر */ }
    $('#hamburger').addEventListener('click', () => {
      if (narrowMQ.matches) { $('#sidebar').classList.add('open'); $('#sidebarBackdrop').classList.add('show'); return; }
      const collapsed = $('#app').classList.toggle('sidebar-collapsed');
      $('#hamburger').setAttribute('aria-expanded', String(!collapsed));
      try { localStorage.setItem('crmqc.sidebar.v1', collapsed ? 'collapsed' : 'open'); } catch (e) { /* بی‌اثر */ }
    });
    $('#hamburger').setAttribute('aria-expanded', String(!$('#app').classList.contains('sidebar-collapsed')));
    $('#sidebarClose').addEventListener('click', () => this.closeSidebar());
    $('#sidebarBackdrop').addEventListener('click', () => this.closeSidebar());
    $$('.nav-group-title').forEach((g) => g.addEventListener('click', () => g.parentElement.classList.toggle('open')));

    window.addEventListener('hashchange', () => {this.route();if(window.BrowserSession)BrowserSession.markChanged();});
    /* fix: قبلاً hash هم از اینجا ست می‌شد (رویداد) و هم await route() — دو رندر هم‌زمان
     * می‌ساخت که چارت‌ها را خراب می‌کرد؛ حالا فقط یک مسیر واحد اجرا می‌شود. */
    if (location.hash && location.hash.length > 1) {
      await this.route();
      if(window.BrowserSession)await BrowserSession.restorePage();
    } else {
      location.hash = '#/dashboard'; // رویداد hashchange خودش route را اجرا می‌کند
    }
  }
};

// اکسپورت سراسری
window.App = App;
window.UI = { C, $, $$, esc, fa, el, api, toast, modal, modalHead, confirmDlg, confirmImport, dateField, combo, multiSelect, triSwitch, redlineSwitch, selectField, scorePill, markBadge, triValue, callRedlineBadge, bindCallRedlines, callTimeCell, slaBadge, durText, rateCell, errorRateCell, pager, emptyState, debounce, scoreBands, scoreColorHex, scoreColorRgba };
})();
