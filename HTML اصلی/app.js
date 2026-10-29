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

/* Cache only read-only data, per authenticated token and browser tab. Never
 * cache auth/revision/config endpoints. Session storage survives reloads but
 * is not shared between tabs; every restored session is validated by /auth/me. */
const readCache = {
  ttl: 120000,
  key: 'crmqc.readCache.v1',
  signal: 'crmqc.readCache.invalidate.v1',
  entries: {}, pending: {}, token: '', epoch: 0,
  allowed(url) {
    const path = url.split('?')[0];
    return /^\/api\/(bootstrap|dashboard|reports|portfolio(?:\/.*)?|tickets(?:\/.*)?|socials(?:\/.*)?|agents(?:\/.*)?|data\/status|calls\/analysis|expert-ref(?:\/.*)?|criteria|elements|fiscal-months(?:\/.*)?|monthly-summary|action-types|actions(?:\/.*)?|reminders(?:\/.*)?)$/.test(path);
  },
  scope(token) {
    if (this.token === token) return;
    this.epoch++; this.entries = {}; this.pending = {}; this.token = token;
    if (!token) return;
    try {
      const data = JSON.parse(sessionStorage.getItem(this.key) || 'null');
      if (data && data.token === token && data.entries && typeof data.entries === 'object') this.entries = data.entries;
    } catch (e) { /* storage may be unavailable */ }
  },
  save() {
    try {
      const now = Date.now();
      const keys = Object.keys(this.entries).filter(k => now - this.entries[k].at < this.ttl).sort((a, b) => this.entries[b].at - this.entries[a].at);
      const limited = {};
      keys.slice(0, 60).forEach(k => { limited[k] = this.entries[k]; });
      this.entries = limited;
      const json = JSON.stringify({ token: this.token, entries: limited });
      if (json.length <= 2000000) sessionStorage.setItem(this.key, json);
      else sessionStorage.removeItem(this.key);
    } catch (e) { try { sessionStorage.removeItem(this.key); } catch (_) {} }
  },
  clear(broadcast) {
    this.epoch++; this.entries = {}; this.pending = {};
    try { sessionStorage.removeItem(this.key); } catch (e) {}
    if (broadcast) try { localStorage.setItem(this.signal, Date.now() + ':' + Math.random()); } catch (e) {}
  },
  async get(url, load) {
    const token = window.QCAuth && window.QCAuth.token || '';
    this.scope(token);
    if (!token || api.offline || !this.allowed(url) || api._writes.size) return load();
    const hit = this.entries[url];
    if (hit && Date.now() >= hit.at && Date.now() - hit.at < this.ttl) return JSON.parse(JSON.stringify(hit.data));
    if (this.pending[url]) return JSON.parse(JSON.stringify(await this.pending[url]));
    const epoch = this.epoch;
    const request = load().then(data => {
      if (epoch === this.epoch && this.token === token && !api.offline && !api._writes.size && data != null) {
        this.entries[url] = { at: Date.now(), data: JSON.parse(JSON.stringify(data)) };
        this.save();
      }
      return data;
    });
    this.pending[url] = request;
    try { return JSON.parse(JSON.stringify(await request)); }
    finally { if (this.pending[url] === request) delete this.pending[url]; }
  }
};
window.addEventListener('storage', e => { if (e.key === readCache.signal) readCache.clear(false); });

/* ------------------------------------------------------------------- API */
const api = {
  /* اگر سرور در دسترس نباشد (محیط پیش‌نمایش بیرون از نوبت کاری خاموش می‌شود)،
   * به‌طور خودکار روی لایه‌ی لوكال مرورگر (LocalApi) کار می‌کنیم — برنامه هرگز
   * با خطای «عدم اتصال به سرور» متوقف نمی‌شود و به محض برگشتن سرور
   * به‌صورت خودکار آنلاین برمی‌گردیم. */
  offline: false,
  _lastProbe: 0,
  _writes: new Set(),
  _unauthorized: false,
  async waitForWrites(){ await Promise.all([...this._writes]); },
  /* توکن نشست با هر درخواست فرستاده می‌شود (هدر در Node، آرگومان در Apps Script). */
  headers(body) {
    const h = {};
    if (body) h['Content-Type'] = 'application/json';
    const token = window.QCAuth && window.QCAuth.token;
    if (token) h['x-qc-token'] = token;
    return Object.keys(h).length ? h : undefined;
  },
  async req(method,url,body){
    url = App.withDateRange(url, method);
    const write = method !== 'GET';
    const token = window.QCAuth && window.QCAuth.token;
    if (!write && token && !api.offline && readCache.allowed(url) && !this._writes.size)
      return readCache.get(url, () => this._request(method, url, body));
    if (write) { api._revNoted = false; readCache.clear(true); }
    const work = this._request(method, url, body);
    if (write) this._writes.add(work);
    try {
      const result = await work;
      if (write && window.App && !api._revNoted) window.App.syncAfterWrite();
      return result;
    } finally {
      if (write) { this._writes.delete(work); readCache.clear(true); }
    }
  },
  unauthorized(message) {
    if (api._unauthorized || !window.QCAuth || !window.QCAuth.required) return;
    api._unauthorized = true;
    window.QCAuth.clear();
    window.QCAuth.showGate(message || 'نشست شما پایان یافته است؛ دوباره وارد شوید.');
  },
  async _request(method, url, body) {
    url = App.withDateRange(url, method);
    if (!api.offline) {
      try {
        const res = await fetch(url, {
          method,
          headers: api.headers(body),
          body: body ? JSON.stringify(body) : undefined
        });
        /* سرور شماره‌ی نسخه‌ی تازه را در همان پاسخ نوشتن می‌فرستد؛ این کار یک
         * رفت‌وبرگشت کامل به /api/revision را بعد از هر ثبت حذف می‌کند. */
        try {
          const rev = (res.headers && typeof res.headers.get === 'function' ? res.headers.get('x-qc-revision') : '') || res.revision || '';
          if (rev && method !== 'GET' && window.App) { window.App.noteRevision(rev); api._revNoted = true; }
        } catch (e) {}
        let data = null;
        try { data = await res.json(); } catch (e) { /* پاسخ خالی */ }
        if (!res.ok) {
          const err = new Error((data && data.error) || 'خطای ارتباط با سرور (' + res.status + ')');
          err.status = res.status;
          if (data && data.conflict) err.conflict = data.conflict;
          if (res.status === 401) api.unauthorized((data && data.error) || '');
          throw err;
        }
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
  clearCache: (broadcast) => readCache.clear(!!broadcast),
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
/* تطبیق فازی فارسی: یکدست‌سازی نویسه‌ها (ی/ک/نیم‌فاصله/ارقام فارسی) + امتیازدهی
 * تا «علی رضا» با «علیرضا» و «101» با «۱۰۱» هم پیدا شود. */
function normChar(v) {
  return C.faToEn(String(v == null ? '' : v))
    .replace(/[يى]/g, 'ی').replace(/ك/g, 'ک').replace(/[\u200c\u200d]/g, ' ').toLowerCase();
}
function normKey(v) { return normChar(v).replace(/\s+/g, ' ').trim(); }
function fuzzyScore(haystack, needle) {
  const h = normKey(haystack), n = normKey(needle);
  if (!n) return 1000;
  if (!h) return -1;
  if (h === n) return 1000;
  if (h.indexOf(n) === 0) return 900 - h.length;
  const words = h.split(' ');
  if (words.some((w) => w.indexOf(n) === 0)) return 800 - h.length;
  const at = h.indexOf(n);
  if (at > 0) return 700 - at - h.length;
  if (words.some((w) => w.indexOf(n) > 0)) return 620 - h.length;
  /* زیردنباله‌ی فازی: نویسه‌ها به ترتیب، ولی نه لزوماً چسبیده */
  let i = 0, gaps = 0, first = -1;
  for (let k = 0; k < h.length && i < n.length; k++) {
    if (h[k] === n[i]) { if (first < 0) first = k; i++; }
    else if (i > 0) gaps++;
  }
  return i === n.length ? 480 - gaps * 6 - first : -1;
}
function markMatch(label, needle) {
  const text = String(label == null ? '' : label);
  const n = normKey(needle);
  if (!n) return esc(text);
  const at = normChar(text).indexOf(n);
  if (at >= 0) return esc(text.slice(0, at)) + '<mark>' + esc(text.slice(at, at + n.length)) + '</mark>' + esc(text.slice(at + n.length));
  let out = '', i = 0;
  for (let k = 0; k < text.length; k++) {
    const ch = normChar(text[k]);
    if (i < n.length && ch === n[i] && ch !== ' ') { out += '<mark>' + esc(text[k]) + '</mark>'; i++; }
    else out += esc(text[k]);
  }
  return out;
}

/** ورودی تاریخ جلالی با روز هفته و تقویم پاپ‌آپ (بند ۷) */
function dateField(opts) {
  // opts: {label, name, value, required, showWeekday, placeholder, onPick}
  const wrap = el(`<div class="field">
    <label>${esc(opts.label)}${opts.required ? ' <span class="req">*</span>' : ''}</label>
    <div class="date-f">
      <input class="input" dir="ltr" style="text-align:right" inputmode="numeric" name="${opts.name}"
        placeholder="${esc(opts.placeholder || '1405-06-20')}" value="${esc(opts.value || '')}" autocomplete="off">
      <button type="button" class="cal-btn" aria-label="تقویم ${esc(opts.label)}" title="انتخاب از تقویم"><i class="fa-regular fa-calendar"></i></button>
    </div>
    <div class="foot" data-foot></div>
  </div>`);
  const inp = $('input', wrap), foot = $('[data-foot]', wrap), btn = $('.cal-btn', wrap);
  const validate = () => {
    const v = inp.value.trim();
    if (!v) { foot.className = 'foot'; foot.innerHTML = ''; inp.classList.remove('invalid'); wrap._j = null; return; }
    const j = C.parseJalali(v);
    if (!j) { inp.classList.add('invalid'); foot.className = 'foot bad'; foot.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> تاریخ نامعتبر است'; wrap._j = null; }
    else {
      inp.classList.remove('invalid');
      const norm = C.formatJalali(j);
      if (inp.value.trim() !== norm) inp.value = norm;
      inp.dataset.value = norm;
      wrap._j = j;
      if (opts.showWeekday !== false) { foot.className = 'foot good'; foot.innerHTML = `<i class="fa-regular fa-calendar-check"></i> ${C.weekdayFa(j)} — معتبر`; }
    }
  };
  // ماسک خودکار: فقط اعداد و اسلش؛ تبدیل 14050620 → 1405-06-20
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
  /* تقویم پاپ‌آپ کنار فیلد */
  JCal.attach(btn, { input: inp, onPick: () => {
    validate();
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    inp.dispatchEvent(new Event('change', { bubbles: true }));
    if (opts.onPick) opts.onPick(wrap.getValue());
  } });
  if (opts.value) validate();
  wrap.getValue = () => (C.parseJalali(inp.value) ? C.formatJalali(C.parseJalali(inp.value)) : '');
  wrap.setToday = () => { inp.value = C.formatJalali(C.todayJalali()); validate(); };
  return wrap;
}

/** کمبوباکس جستجوپذیر با تطبیق فازی و ناوبری با کلیدهای بالا/پایین (بند ۷) */
let comboSeq = 0;
function combo(opts) {
  // opts: {label, name, items: [{value,label,sub,keys[]}], value, required, placeholder, onPick}
  const uid = 'cmb' + (++comboSeq);
  const wrap = el(`<div class="field">
    <label id="${uid}-label">${esc(opts.label)}${opts.required ? ' <span class="req">*</span>' : ''}</label>
    <div class="combo">
      <input class="input" placeholder="${esc(opts.placeholder || 'جستجو…')}" value="" autocomplete="off"
        role="combobox" aria-expanded="false" aria-controls="${uid}-list" aria-autocomplete="list" aria-labelledby="${uid}-label">
      <div class="menu" id="${uid}-list" role="listbox" aria-label="${esc(opts.label)}"></div>
    </div>
    <div class="foot" data-foot></div>
  </div>`);
  const box = $('.combo', wrap), inp = $('input', wrap), menu = $('.menu', wrap), foot = $('[data-foot]', wrap);
  let items = opts.items || [], shown = [], active = -1;
  wrap._value = '';

  function scoreOf(it, filter) {
    let best = -1;
    [it.label, it.value, it.sub].concat(it.keys || []).forEach((cand, i) => {
      if (cand == null || cand === '') return;
      const sc = fuzzyScore(cand, filter) - i * 90;
      if (sc > best) best = sc;
    });
    return best;
  }
  function renderMenu(filter) {
    const f = (filter || '').trim();
    shown = items.map((it) => ({ it: it, score: scoreOf(it, f) }))
      .filter((x) => x.score >= 0)
      .sort((a, b) => b.score - a.score || String(a.it.label).localeCompare(String(b.it.label), 'fa'))
      .slice(0, 60).map((x) => x.it);
    if (!shown.length) { menu.innerHTML = '<div class="menu-empty">موردی یافت نشد</div>'; active = -1; updateActive(); return; }
    menu.innerHTML = shown.map((it, i) =>
      `<div class="menu-item" role="option" id="${uid}-opt-${i}" data-v="${esc(it.value)}" data-i="${i}">` +
      `<span>${markMatch(it.label, f)}</span>${it.sub ? `<span class="tm">${markMatch(it.sub, f)}</span>` : ''}</div>`).join('');
    $$('.menu-item', menu).forEach((mi) => {
      mi.addEventListener('mousedown', (e) => { e.preventDefault(); pick(mi.dataset.v); });
      mi.addEventListener('mouseenter', () => { active = Number(mi.dataset.i); updateActive(); });
    });
    active = 0;
    updateActive();
  }
  function updateActive() {
    const nodes = $$('.menu-item', menu);
    nodes.forEach((mi, i) => {
      mi.classList.toggle('hl', i === active);
      if (i === active) mi.setAttribute('aria-selected', 'true'); else mi.removeAttribute('aria-selected');
    });
    const cur = nodes[active];
    if (cur) { if (cur.scrollIntoView) cur.scrollIntoView({ block: 'nearest' }); inp.setAttribute('aria-activedescendant', cur.id); }
    else inp.removeAttribute('aria-activedescendant');
    inp.setAttribute('aria-expanded', String(box.classList.contains('open')));
  }
  function openMenu(filter) { box.classList.add('open'); renderMenu(filter || ''); }
  function closeMenu() { box.classList.remove('open'); active = -1; updateActive(); }
  function pick(v) {
    const it = items.find((x) => x.value === v);
    wrap._value = it ? it.value : '';
    inp.value = it ? it.label : v;
    closeMenu();
    foot.className = 'foot'; foot.innerHTML = '';
    if (opts.onPick) opts.onPick(it || null);
    if (it && it.foot) { foot.className = 'foot good'; foot.innerHTML = `<i class="fa-solid fa-check"></i> ${esc(it.foot)}`; }
  }
  function resolveTyped() {
    const typed = normKey(inp.value);
    if (!typed) return null;
    const exact = items.find((x) => normKey(x.label) === typed) || items.find((x) => normKey(x.value) === typed);
    if (exact) return exact;
    const near = items.map((it) => ({ it: it, score: scoreOf(it, typed) })).filter((x) => x.score >= 700)
      .sort((a, b) => b.score - a.score);
    return near.length === 1 ? near[0].it : null;
  }

  inp.addEventListener('focus', () => { inp.select(); openMenu(''); });
  inp.addEventListener('input', () => {
    wrap._value = '';
    const resolved = resolveTyped();
    if (resolved) { wrap._value = resolved.value; foot.className = 'foot'; foot.innerHTML = ''; }
    else if (inp.value.trim()) { foot.className = 'foot warn'; foot.innerHTML = '<i class="fa-solid fa-hand-pointer"></i> نام را از فهرست انتخاب کنید (بالا/پایین و Enter)'; }
    else { foot.className = 'foot'; foot.innerHTML = ''; }
    openMenu(inp.value);
  });
  inp.addEventListener('blur', () => {
    setTimeout(() => closeMenu(), 160);
    const resolved = resolveTyped();
    if (resolved) { wrap._value = resolved.value; if (normKey(resolved.label) !== normKey(inp.value)) inp.value = resolved.label; }
  });
  inp.addEventListener('keydown', (e) => {
    const isOpen = box.classList.contains('open');
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!isOpen) { openMenu(inp.value); return; }
      if (!shown.length) return;
      active = e.key === 'ArrowDown' ? (active + 1) % shown.length : (active <= 0 ? shown.length - 1 : active - 1);
      updateActive();
      return;
    }
    if (e.key === 'Home' && isOpen && shown.length) { e.preventDefault(); active = 0; updateActive(); return; }
    if (e.key === 'End' && isOpen && shown.length) { e.preventDefault(); active = shown.length - 1; updateActive(); return; }
    if (e.key === 'Enter') {
      if (isOpen && active >= 0 && shown[active]) { e.preventDefault(); e.stopPropagation(); pick(shown[active].value); return; }
      const resolved = resolveTyped();
      if (resolved) { e.preventDefault(); pick(resolved.value); }
      return;
    }
    if (e.key === 'Escape' || e.key === 'Tab') closeMenu();
  });
  wrap.setItems = (list) => { items = list || []; };
  wrap.setValue = (v) => { if (v) pick(v); };
  wrap.getValue = () => {
    if (wrap._value) return wrap._value;
    const resolved = resolveTyped();
    return resolved ? resolved.value : '';
  };
  wrap.focus = () => inp.focus();
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

/* نام کارشناس QC واردشده پیش‌فرض می‌شود؛ برای نقش QC قفل است تا ارزیابی
 * به نام شخص دیگری ثبت نشود (بند ۵). */
function applyQcIdentity(field, current) {
  const me = window.QCAuth ? window.QCAuth.user : null;
  const sel = $('select', field);
  if (!me || !me.name || !sel) return;
  const value = current || me.name;
  if (!Array.prototype.some.call(sel.options, (o) => o.value === value)) sel.add(new Option(value, value));
  sel.value = value;
  if (current || (window.QCAuth && window.QCAuth.isAdmin)) return;
  sel.disabled = true;
  field.appendChild(el(`<div class="foot good"><i class="fa-solid fa-user-check"></i> به‌عنوان «${esc(me.name)}» ثبت می‌شود</div>`));
}

/* همزمانی چند کارشناس (بند ۱۰): رکورد پس از بازکردن فرم عوض شده است */
function conflictDlg(current, onOverwrite) {
  const when = current && current.updatedAt ? new Date(current.updatedAt) : null;
  const m = modal(`${modalHead('تغییر همزمان توسط کاربر دیگر', 'fa-people-arrows')}
    <div class="modal-body">
      <p class="conflict-note">این رکورد بعد از بازکردن فرمِ شما ویرایش شده است — احتمالاً توسط یک کارشناس QC دیگر.
        برای اینکه زحمت کسی پاک نشود، انتخاب کنید کدام نسخه بماند.</p>
      <div class="detail-rows">
        <div class="detail-row"><div class="k">آخرین ویرایش</div><div class="v">${when && !isNaN(when) ? esc(when.toLocaleString('fa-IR')) : '—'}</div></div>
        <div class="detail-row"><div class="k">کارشناس QC</div><div class="v">${esc((current && current.qcAgent) || '—')}</div></div>
        <div class="detail-row"><div class="k">کارشناس ارزیابی‌شده</div><div class="v">${esc((current && (current.agentName || current.expertName)) || '—')}</div></div>
        <div class="detail-row"><div class="k">نمره‌ی ذخیره‌شده</div><div class="v">${fa(current && current.score)}</div></div>
      </div>
    </div>
    <div class="modal-foot">
      <button class="btn ghost" data-close>انصراف</button>
      <button class="btn soft" id="cfOverwrite"><i class="fa-solid fa-pen-nib"></i> تغییرات من جایگزین شود</button>
      <button class="btn primary" id="cfReload"><i class="fa-solid fa-arrows-rotate"></i> بارگذاری نسخه‌ی تازه</button>
    </div>`);
  $('#cfReload', m).addEventListener('click', () => { m.close(); App.route(); });
  $('#cfOverwrite', m).addEventListener('click', () => { m.close(); onOverwrite(); });
  return m;
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
  fiscalMonths: [],   // از تب Fiscal_Months شیت
  auth: { required: false, user: null },
  revision: 0,
  _syncTimer: null,
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
    if (pathname === '/api/expert-ref/review') return url; // داشبورد بررسی بازه‌ی اختصاصی خودش را دارد (aFrom/aTo)
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
    const t = C.todayJalali(), today = C.formatJalali(t);
    if (preset === 'today') return { from: today, to: today, preset };
    /* بازه‌های ماه مالی از تب Fiscal_Months شیت خوانده می‌شوند (بند ۲) */
    const fiscal = window.QCFiscal ? window.QCFiscal.presetRange(this.fiscalMonths, preset, today) : null;
    if (fiscal) return fiscal;
    const month = preset === 'prev' ? C.jalaliMonthAdd(t.jy, t.jm, -1) : t;
    const r = C.jalaliMonthRange(month.jy, month.jm);
    return { from: C.formatJalali(r.from), to: C.formatJalali(r.to), preset };
  },
  /* گزینه‌های ماه مالی داخل dropdown بازه آماده */
  buildFiscalOptions() {
    const months = this.fiscalMonths || [];
    const group = $('#gFiscalGroup'), all = $('#gFiscalAll');
    if (!group || !all) return;
    const options = window.QCFiscal ? window.QCFiscal.presetOptions(months, C.formatJalali(C.todayJalali())) : [];
    const cur = options.filter((o) => o.group === 'ماه مالی');
    const rest = options.filter((o) => o.group !== 'ماه مالی');
    group.innerHTML = cur.map((o) => `<option value="${esc(o.value)}">${esc(o.label)}</option>`).join('');
    all.innerHTML = rest.map((o) => `<option value="${esc(o.value)}" title="${esc(o.hint || '')}">${esc(o.label)}</option>`).join('');
    group.hidden = !cur.length; all.hidden = !rest.length;
  },
  rangeStorageKey() {
    /* تنظیمات هر کارشناس QC جدا نگه داشته می‌شود تا محیط کارها قاطی نشود (بند ۱۰) */
    const base = 'crmqc.dateRange.v1';
    return window.QCAuth && window.QCAuth.user ? window.QCAuth.scopeKey(base) : base;
  },
  initDateRange() {
    if (this._rangeReady) return;
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(this.rangeStorageKey())); } catch (e) {}
    const presetKnown = (p) => !window.QCFiscal || !window.QCFiscal.isFiscalPreset(p) ||
      !!(window.QCFiscal.presetRange(this.fiscalMonths, p, C.formatJalali(C.todayJalali())));
    if (saved && !presetKnown(saved.preset)) saved = null;
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
    const wanted = r.preset || 'custom';
    const select = $('#gPreset');
    select.value = wanted;
    if (select.value !== wanted) select.value = 'custom'; // بازه‌ی ماه مالی حذف‌شده
    $('#gRangeNote').className = 'range-note';
    $('#globalRange').classList.remove('draft');
    $('#gRangeState').textContent = 'اعمال‌شده';
    /* نام ماه مالی در یادداشت بازه تا معلوم باشد کدام «بازه‌ی آماده» فعال است (بند ۲) */
    const fiscalName = window.QCFiscal && r.from && window.QCFiscal.isFiscalPreset(r.preset)
      ? window.QCFiscal.labelFor(this.fiscalMonths, r.from) : '';
    $('#gRangeNote').textContent = (fiscalName ? 'ماه مالی «' + fiscalName + '» · ' : '') +
      this.dateRangeLabel() + ' · مبنا: تاریخ بررسی فرم؛ اطلاعات کارشناسان و عملیات بک‌اپ/پاک‌سازی مستقل‌اند.';
  },
  async setDateRange(range) {
    const error = window.QCReports.validateRange(range);
    if (error) { toast.error(error); return false; }
    clearTimeout(this._dateTimer);
    const request = ++this._rangeRequest;
    this.dateRange = { from: range.from ? C.formatJalali(C.parseDate(range.from)) : '',
      to: range.to ? C.formatJalali(C.parseDate(range.to)) : '', preset: range.preset || 'custom' };
    try { localStorage.setItem(this.rangeStorageKey(), JSON.stringify(this.dateRange)); } catch(e) {}
    this.syncDateRangeUI();
    $('#globalRange').classList.add('updating'); $('#gRangeState').textContent = 'در حال بروزرسانی گزارش‌ها…';
    const refresh = this._dateRefresh;
    /* اعمال بازه می‌تواند بعد از تغییر داده (بدون boot) باشد، پس شمارش تازه پرسیده می‌شود */
    try { await Promise.all([this.refreshCounts(true), refresh ? refresh() : Promise.resolve()]); }
    finally { if (request === this._rangeRequest) {
      $('#globalRange').classList.remove('updating');
      if (!$('#globalRange').classList.contains('draft')) $('#gRangeState').textContent = 'روی همه گزارش‌ها اعمال شد';
    } }
    return true;
  },

  paintCounts(counts) {
    const el = $('#footCounts');
    if (el) el.textContent = `${fa(counts.tickets)} تیکت · ${fa(counts.socials)} سوشال · ${fa(counts.calls)} تماس`;
  },

  /* شمارش پاورقی در خودِ پاسخ bootstrap هست؛ پس درخواست جداگانه به
   * /api/data/status (که هر بار کل تیکت/سوشال/تماس را جارو می‌کند) حذف شد.
   * این یعنی بعد از هر ثبت ریت، یک جاروی کامل داده کمتر انجام می‌شود. */
  async refreshCounts(force) {
    const request = ++this._countsRequest;
    const st = this.state || {};
    /* counts.partial یعنی شمارشِ سبک (بدون خواندن تب‌های سنگین) آمده و برای
     * کارشناس محدود، عدد درست نیست؛ در آن حالت یک‌بار از منبع محدودشده خوانده می‌شود. */
    if (!force && st.counts && !st.counts.partial) { this.paintCounts(st.counts); return; }
    try {
      const counts = await api.get('/api/data/status');
      if (request !== this._countsRequest) return;
      this.paintCounts(counts);
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
    const st = await api.get('/api/bootstrap');
    await this.applyBootstrap(st);
  },

  /* اعمال پاسخ bootstrap (چه از مسیر عادی، چه همراه پاسخ ورود) */
  async applyBootstrap(st) {
    this.state = st;
    this.fiscalMonths = Array.isArray(st.fiscalMonths) ? st.fiscalMonths : [];
    this.auth = st.auth || { required: false, user: null };
    this.revision = Number(st.revision || 0);
    this._syncRevision = this.revision;
    if (window.QCAuth && this.auth.user) window.QCAuth.user = this.auth.user;
    $('#orgName').textContent = st.settings.orgName || 'سامانه کنترل کیفیت';
    const t = C.todayJalali();
    $('#todayChip span').textContent = `${C.weekdayFa(t)} ${C.toFaDigits(t.jd)} ${['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'][t.jm - 1]} ${C.toFaDigits(t.jy)}`;
    if (window.QCParse) window.QCParse.setConfig(st.settings.callCriteria);
    this.applyTheme(document.documentElement.dataset.theme || 'dark');
    this.buildFiscalOptions();
    this.initDateRange();
    this.renderUserChip();
    if (window.QCAuth) window.QCAuth.applyNav();
    await this.refreshCounts();
    $('#dataSourceBadge').textContent = window.APP_SCRIPT_MODE ? 'Google Sheets' : api.offline ? 'آفلاین' : 'سرور';
    this.startSyncWatch();
  },

  /* نام/نقش کاربر واردشده در نوار بالا + دکمه خروج (بند ۵) */
  renderUserChip() {
    const chip = $('#userChip');
    if (!chip) return;
    const user = window.QCAuth ? window.QCAuth.user : null;
    if (!user || !this.auth.required) { chip.hidden = true; return; }
    chip.hidden = false;
    chip.classList.toggle('admin', user.role === 'admin');
    $('#userName').textContent = user.name;
    $('#userRole').textContent = user.role === 'admin' ? 'مدیر سیستم — دسترسی کامل' :
      (user.unrestricted ? 'کارشناس QC — همه کارشناسان' : 'کارشناس QC — داده‌ی محدود');
    const avatar = $('.user-avatar', chip);
    if (avatar) avatar.innerHTML = `<i class="fa-solid ${user.role === 'admin' ? 'fa-user-shield' : 'fa-user-check'}"></i>`;
  },

  /* چند کاربر همزمان: هر ~۴۵ ثانیه نسخه‌ی داده‌ی شیت را می‌پرسیم (بند ۱۰).
   * اگر شخص دیگری چیزی نوشته باشد، فقط یک دکمه‌ی کوچک ظاهر می‌شود تا خودِ
   * کاربر تصمیم بگیرد کی صفحه را تازه کند — کار کسی قطع نمی‌شود. */
  startSyncWatch() {
    clearInterval(this._syncTimer);
    this._syncTimer = setInterval(async () => {
      if (document.hidden) return;
      try {
        const res = await api.get('/api/revision');
        const rev = Number((res && res.revision) || 0);
        if (!rev) return;
        if (this._syncRevision && rev !== this._syncRevision) this.markStale(rev);
        else this._syncRevision = rev;
      } catch (e) { /* سرور قدیمی یا آفلاین: بی‌صدا رد می‌شویم */ }
    }, 45000);
  },
  markStale(rev) {
    readCache.clear(false);
    this._pendingRevision = rev;
    const chip = $('#syncChip');
    if (chip) { chip.hidden = false; chip.classList.add('pulse'); }
  },
  /* نسخه‌ی تازه از همان پاسخ نوشتن می‌آید (هدر x-qc-revision یا فیلد revision
   * در Apps Script) — بدون درخواست اضافه. */
  noteRevision(rev) {
    const n = Number(String(rev).split('-')[0]);
    if (!n) return;
    this.revision = n;
    this._syncRevision = n;
    const chip = $('#syncChip');
    if (chip) { chip.hidden = true; chip.classList.remove('pulse'); }
  },

  /* بعد از ثبت/حذف یک ریت، فقط شمارش پاورقی اصلاح می‌شود؛ خواندن دوباره‌ی کل
   * bootstrap (که در Apps Script یک رفت‌وبرگشت گران است) لازم نیست. */
  applyWrite(kind, delta) {
    const counts = this.state && this.state.counts;
    if (!counts || counts[kind] == null) { this.refreshCounts(true); return; }
    counts[kind] = Math.max(0, Number(counts[kind]) + (delta || 0));
    this.paintCounts(counts);
  },

  async syncAfterWrite() {
    if (!this._syncTimer) return;
    try {
      const res = await api.get('/api/revision');
      const rev = Number((res && res.revision) || 0);
      if (rev) { this._syncRevision = rev; this.revision = rev; }
    } catch (e) { /* بی‌اثر */ }
  },
  async applyServerData() {
    const chip = $('#syncChip');
    if (chip) { chip.disabled = true; }
    try {
      this._rangeReady = false;
      readCache.clear(false);
      await this.boot();
      await this.route();
      this._pendingRevision = 0;
      if (chip) chip.hidden = true;
      toast.success('داده‌ها از شیت تازه شد');
    } catch (e) { toast.error(e.message || 'تازه‌سازی ناموفق بود'); }
    finally { if (chip) chip.disabled = false; }
  },

  agentComboItems() {
    /* داخلی و زیرگروه هم قابل جستجو باشند تا با تایپ «101» کارشناس پیدا شود */
    return this.state.agents.map((a) => ({ value: a.name, label: a.name, sub: a.team,
      keys: [a.ext, a.subgroup].filter((x) => x != null && x !== ''),
      foot: 'تیم: ' + a.team + (a.ext ? ' · داخلی ' + C.toFaDigits(a.ext) : '') }));
  },
  teamOf(name) { const a = this.state.agents.find((x) => x.name === name); return a ? a.team : ''; },

  setTitle(t) { $('#pageTitle').textContent = t; document.title = t + ' — سامانه کنترل کیفیت CRM'; },

  parseHash() {
    const h = location.hash.replace(/^#\/?/, '');
    const parts = h.split('/');
    return { name: parts[0] || 'dashboard', arg: parts[1], arg2: parts[2] };
  },

  async route() {
    if (!this.state) return; // پیش از ورود/بارگذاری داده‌ها رندر نکن
    const routeRequest = ++this._routeRequest;
    $$('#modalRoot .modal-back').forEach(m => m.close ? m.close() : m.remove());
    clearTimeout(this._dateTimer);
    const { name, arg, arg2 } = this.parseHash();
    if (window.QCAuth && window.QCAuth.required && !window.QCAuth.can(name)) return this.renderForbidden(name);
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

  renderForbidden(name) {
    this.setTitle('دسترسی محدود');
    const view = document.createElement('section'); view.className = 'route-view';
    $('#content').replaceChildren(view);
    view.innerHTML = `<div class="card">${emptyState('fa-lock', 'به این بخش دسترسی ندارید',
      'این صفحه فقط برای مدیر سیستم باز است. اگر فکر می‌کنید اشتباه شده، از مدیر بخواهید نقش یا دسترسی حساب شما را در صفحه‌ی «مدیریت QC» تغییر دهد.',
      `<a class="btn primary" href="#/dashboard"><i class="fa-solid fa-gauge-high"></i> بازگشت به داشبورد</a>`)}</div>`;
    this.closeSidebar();
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

  closeSidebar() {
    $('#sidebar').classList.remove('open');
    $('#sidebarBackdrop').classList.remove('show');
    $('#hamburger').setAttribute('aria-expanded', 'false');
  },
  openSidebar() {
    $('#sidebar').classList.add('open');
    $('#sidebarBackdrop').classList.add('show');
    $('#hamburger').setAttribute('aria-expanded', 'true');
  },
  toggleSidebar() {
    if ($('#sidebar').classList.contains('open')) this.closeSidebar(); else this.openSidebar();
  },

  async init() {
    this.bindChrome();
    /* احراز هویت: اگر کاربری تعریف نشده باشد، مثل قبل بدون ورود باز می‌شود. */
    let ready = true;
    if (window.QCAuth) {
      try { ready = await window.QCAuth.ensure(); }
      catch (e) { ready = true; }
    }
    if (!ready) return; // دروازه‌ی ورود نمایش داده شده؛ بعد از ورود onAuthReady اجرا می‌شود
    await this.start();
  },

  async onAuthReady() {
    api._unauthorized = false;
    this._rangeReady = false;
    this._started = false;
    const prefetched = window.QCAuth && window.QCAuth.takeBootstrap ? window.QCAuth.takeBootstrap() : null;
    if (window.QCAuth) window.QCAuth.hideGate();
    await this.start(prefetched);
  },

  async start(prefetched) {
    try { await (prefetched ? this.applyBootstrap(prefetched) : this.boot()); }
    catch (e) {
      $('#content').innerHTML = `<div class="card">${emptyState('fa-plug-circle-xmark', 'عدم اتصال به سرور', e.message,
        `<button class="btn ghost" onclick="location.reload()"><i class="fa-solid fa-rotate-right"></i> تلاش دوباره</button>`)}</div>`;
      return;
    }
    if (!this._started) { this.bindDateRangeUI(); this._started = true; }
    const target = this.parseHash().name;
    if (window.QCAuth && window.QCAuth.required && !window.QCAuth.can(target)) location.hash = '#/dashboard';
    if (location.hash && location.hash.length > 1) await this.route();
    else location.hash = '#/dashboard'; // رویداد hashchange خودش route را اجرا می‌کند
  },

  /* رویدادهای ثابت پوسته (پیش از ورود هم فعال‌اند) */
  bindChrome() {
    $('#themeToggle').addEventListener('click', () => this.applyTheme(this.theme === 'dark' ? 'light' : 'dark'));
    const logout = $('#logoutBtn');
    if (logout) logout.addEventListener('click', () => { if (window.QCAuth) window.QCAuth.logout(); });
    const syncChip = $('#syncChip');
    if (syncChip) syncChip.addEventListener('click', () => this.applyServerData());

    /* منوی همبرگری: در همه‌ی اندازه‌ها یک دراور است که پیش‌فرض بسته است (بند ۳) */
    $('#app').classList.remove('sidebar-collapsed');
    this.closeSidebar();
    $('#hamburger').addEventListener('click', () => this.toggleSidebar());
    $('#sidebarClose').addEventListener('click', () => this.closeSidebar());
    $('#sidebarBackdrop').addEventListener('click', () => this.closeSidebar());
    $$('.nav-group-title').forEach((g) => g.addEventListener('click', () => g.parentElement.classList.toggle('open')));
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && $('#sidebar').classList.contains('open')) this.closeSidebar();
    });
    window.addEventListener('hashchange', () => this.route());
  }
};

// اکسپورت سراسری
window.App = App;
window.UI = { C, $, $$, esc, fa, el, api, toast, modal, modalHead, confirmDlg, confirmImport, conflictDlg, applyQcIdentity, dateField, combo, multiSelect, triSwitch, redlineSwitch, selectField, scorePill, markBadge, triValue, callRedlineBadge, bindCallRedlines, callTimeCell, slaBadge, durText, rateCell, errorRateCell, pager, emptyState, debounce, scoreBands, scoreColorHex, scoreColorRgba };
})();
