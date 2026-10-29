/* =========================================================================
 * auth.js — دروازه‌ی ورود، نگهداری نشست و فیلتر دسترسی صفحه‌ها
 *
 * جریان کار:
 *   ۱) App.init() → QCAuth.ensure()
 *   ۲) اگر هیچ کاربر فعالی تعریف نشده باشد (firstRun) یا احراز هویت خاموش باشد،
 *      سامانه مثل قبل بدون ورود باز می‌شود.
 *   ۳) در غیر این صورت دروازه‌ی ورود نمایش داده می‌شود؛ بعد از ورود موفق
 *      QCAuth.start() اپ را بالا می‌آورد.
 * نشست فقط در حافظه + localStorage همان مرورگر نگه داشته می‌شود (توکن سمت
 * سرور در CacheService/حافظه‌ی سرور اعتبارسنجی می‌شود).
 * ========================================================================= */
(function () {
'use strict';

const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => [...(r || document).querySelectorAll(s)];
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));

const TOKEN_KEY = 'crmqc.auth.v1';

// Apps Script sessions end with the browser tab; do not persist bearer tokens in localStorage.
function tokenStorage() { return window.APP_SCRIPT_MODE ? window.sessionStorage : window.localStorage; }
function safeGet(key) { try { return tokenStorage().getItem(key); } catch (e) { return null; } }
function safeSet(key, value) { try { tokenStorage().setItem(key, value); } catch (e) { /* سندباکس بدون storage */ } }
function safeRemove(key) { try { tokenStorage().removeItem(key); } catch (e) {} }
if (window.APP_SCRIPT_MODE) { try { window.localStorage.removeItem(TOKEN_KEY); } catch (e) {} }

const QCAuth = {
  user: null,
  token: '',
  required: false,
  firstRun: false,
  accounts: [],
  orgName: '',
  mode: 'auto',
  _started: false,

  get isAdmin() { return !this.required || !!(this.user && this.user.role === 'admin'); },
  get name() { return this.user ? this.user.name : ''; },

  /* کلید اختصاصی هر کاربر برای تنظیمات محلی (بند ۱۰: جداسازی محیط کار) */
  scopeKey(key) { return this.user && this.user.name ? key + '@' + this.user.name : key; },

  persist() {
    if (!this.user) { safeRemove(TOKEN_KEY); return; }
    safeSet(TOKEN_KEY, JSON.stringify({ token: this.token, user: this.user, at: Date.now() }));
  },
  restore() {
    if (window.APP_SCRIPT_MODE) { try { window.localStorage.removeItem(TOKEN_KEY); } catch (e) {} }
    const raw = safeGet(TOKEN_KEY);
    if (!raw) return null;
    try {
      const saved = JSON.parse(raw);
      if (!saved || !saved.user || !saved.user.name) return null;
      this.token = saved.token || ''; this.user = saved.user;
      return saved.user;
    } catch (e) { return null; }
  },
  clear() {
    if (window.UI && window.UI.api.clearCache) window.UI.api.clearCache(true);
    this.user = null; this.token = ''; this._bootstrap = null; safeRemove(TOKEN_KEY);
  },

  /* صفحه‌هایی که این کاربر اجازه‌ی دیدنشان را دارد */
  can(route) {
    if (!this.required) return true;
    if (!this.user) return false;
    if (window.QCAccess) return window.QCAccess.canAccessRoute(this.user, String(route || ''), true);
    return true;
  },
  applyNav() {
    $$('.nav-item, .nav-subitem').forEach((a) => {
      const allowed = this.can(a.dataset.route);
      a.hidden = !allowed;
      a.setAttribute('aria-hidden', String(!allowed));
    });
    /* گروه‌هایی که هیچ زیرصفحه‌ی مجازی ندارند پنهان شوند */
    $$('.nav-group').forEach((g) => {
      const visible = $$('.nav-subitem', g).some((a) => !a.hidden);
      g.hidden = !visible;
    });
  },

  /* bootstrap آماده‌ی همان ورود؛ App آن را به‌جای درخواست دوباره مصرف می‌کند. */
  takeBootstrap() { const value = this._bootstrap || null; this._bootstrap = null; return value; },

  async ensure() {
    const api = window.UI ? window.UI.api : null;
    /* اگر نشستی ذخیره شده باشد، اول «me» پرسیده می‌شود و فهرست حساب‌ها فقط
     * وقتی گرفته می‌شود که نشست معتبر نباشد — یک درخواست کمتر هنگام باز شدن. */
    const saved = this.restore();
    if (saved) {
      try {
        const me = await api.get('/api/auth/me');
        if (me && me.required && me.user) {
          /* Permissions may have changed while the tab was closed. Never reuse
           * data cached under the previous identity/scope for the same token. */
          if (JSON.stringify(saved) !== JSON.stringify(me.user) && api.clearCache) api.clearCache(true);
          this.required = true; this.accounts = me.accounts || []; this.user = me.user;
          this.mode = 'auto'; this.persist(); this.syncLocalSession(); return true;
        }
        if (me && !me.required) { this.required = false; this.clear(); return true; }
      } catch (e) { /* نشست منقضی شده */ }
      this.clear();
    }
    let info = null;
    try { info = await api.get('/api/auth/accounts'); }
    catch (e) { info = { required: !!window.APP_SCRIPT_MODE, accounts: [], firstRun: false, orgName: '' }; }
    this.required = !!info.required;
    this.firstRun = !!info.firstRun;
    this.accounts = info.accounts || [];
    this.mode = info.mode || 'auto';
    this.orgName = info.orgName || '';
    if (!this.required) { this.user = null; return true; }
    this.showGate();
    return false;
  },

  syncLocalSession() {
    if (window.LocalApi && window.LocalApi.setSession) window.LocalApi.setSession(this.user);
  },

  async login(name, password) {
    const api = window.UI.api;
    const res = await api.post('/api/auth/login', { name: name, password: password });
    this.user = res.user; this.token = res.token || '';
    this._bootstrap = res.bootstrap || null;
    this.persist(); this.syncLocalSession();
    return res.user;
  },

  async setupAdmin(name, password) {
    const api = window.UI.api;
    const res = await api.post('/api/auth/setup', { name: name, password: password });
    this.firstRun = false; this.required = true;
    if (res && res.token && res.user) {
      /* سرور و Apps Script تازه، توکن و داده‌ی اولیه را در همان پاسخ می‌دهند */
      this.user = res.user; this.token = res.token; this._bootstrap = res.bootstrap || null;
      this.persist(); this.syncLocalSession();
      return res.user;
    }
    return this.login(name, password).catch(() => res.user);
  },

  async logout() {
    const api = window.UI.api;
    try { await api.post('/api/auth/logout', { token: this.token }); } catch (e) { /* بی‌اثر */ }
    this.clear();
    if (window.LocalApi && window.LocalApi.setSession) window.LocalApi.setSession(null);
    this.showGate();
  },

  /* ------------------------------------------------------------- دروازه ورود */
  showGate(message) {
    const gate = $('#authGate');
    if (!gate) return;
    gate.hidden = false;
    document.body.classList.add('auth-locked');
    const accounts = this.accounts || [];
    const options = accounts.map((a) => `<option value="${esc(a.name)}">${esc(a.name)}${a.role === 'admin' ? ' (مدیر)' : ''}</option>`).join('');
    gate.innerHTML = `
      <div class="auth-card" role="dialog" aria-modal="true" aria-labelledby="authTitle">
        <div class="auth-logo"><img src="logo.png" alt="" width="56" height="56" data-app-logo></div>
        <h2 id="authTitle">${this.firstRun ? 'راه‌اندازی دسترسی مدیر' : 'ورود به سامانه کنترل کیفیت'}</h2>
        <p class="auth-sub">${esc(this.orgName || 'سامانه کنترل کیفیت')} — ${this.firstRun
          ? 'هیچ کاربری تعریف نشده است. یک حساب مدیر بسازید؛ بعد از آن ورود با رمز اجباری می‌شود.'
          : 'نام کارشناس QC و رمز اختصاصی خود را وارد کنید. داده‌هایی که می‌بینید به دسترسی‌های شما محدود است.'}</p>
        <form id="authForm" class="auth-form" autocomplete="off">
          ${this.firstRun ? '' : `<label class="auth-field"><span>کاربر</span>
            <input class="input" id="authName" list="authAccounts" placeholder="نام کارشناس QC" autocomplete="username" required>
            <datalist id="authAccounts">${options}</datalist></label>`}
          ${this.firstRun ? `<label class="auth-field"><span>نام مدیر</span>
            <input class="input" id="authName" placeholder="مثلاً: مدیر سیستم" autocomplete="username" required></label>` : ''}
          <label class="auth-field"><span>رمز عبور</span>
            <div class="auth-pass">
              <input class="input" id="authPass" type="password" placeholder="••••••" autocomplete="current-password" required>
              <button type="button" class="btn ghost sm" id="authShow" aria-label="نمایش رمز"><i class="fa-regular fa-eye"></i></button>
            </div></label>
          ${this.firstRun ? `<label class="auth-field"><span>تکرار رمز</span>
            <input class="input" id="authPass2" type="password" placeholder="••••••" autocomplete="new-password" required></label>` : ''}
          <div class="auth-error" id="authError" role="alert" ${message ? '' : 'hidden'}>${esc(message || '')}</div>
          <button class="btn primary auth-submit" type="submit" id="authSubmit">
            <i class="fa-solid ${this.firstRun ? 'fa-user-shield' : 'fa-right-to-bracket'}"></i>
            ${this.firstRun ? 'ساخت حساب مدیر و ورود' : 'ورود'}</button>
        </form>
        <div class="auth-note"><i class="fa-solid fa-circle-info"></i>
          ${window.APP_SCRIPT_MODE ? 'مدیر حساب شما را ایجاد می‌کند. اگر هنوز مدیری وجود ندارد، مالک شیت از منوی «سامانه QC مستقل» اولین مدیر را بسازد.' : 'رمزها و دسترسی‌ها از صفحهٔ مدیریت QC تنظیم می‌شوند.'}</div>
      </div>`;
    const nameEl = $('#authName', gate), passEl = $('#authPass', gate);
    $('#authShow', gate).addEventListener('click', () => {
      const showing = passEl.type === 'text';
      passEl.type = showing ? 'password' : 'text';
      $('#authShow', gate).innerHTML = `<i class="fa-regular ${showing ? 'fa-eye' : 'fa-eye-slash'}"></i>`;
    });
    $('#authForm', gate).addEventListener('submit', async (e) => {
      e.preventDefault();
      const errorEl = $('#authError', gate), submit = $('#authSubmit', gate);
      const name = nameEl.value.trim(), pass = passEl.value;
      if (this.firstRun && pass !== $('#authPass2', gate).value) {
        errorEl.hidden = false; errorEl.textContent = 'رمز و تکرار آن یکسان نیستند'; return;
      }
      submit.disabled = true;
      errorEl.hidden = true;
      try {
        if (this.firstRun) await this.setupAdmin(name, pass);
        else await this.login(name, pass);
        gate.hidden = true;
        document.body.classList.remove('auth-locked');
        if (window.App && window.App.onAuthReady) await window.App.onAuthReady();
      } catch (err) {
        errorEl.hidden = false;
        errorEl.textContent = err && err.message ? err.message : 'ورود ناموفق بود';
        passEl.value = ''; passEl.focus();
      } finally { submit.disabled = false; }
    });
    if (window.APP_SCRIPT_LOGO_DATA) $$('.auth-logo img', gate).forEach((img) => { img.src = window.APP_SCRIPT_LOGO_DATA; });
    setTimeout(() => { if (nameEl) nameEl.focus(); }, 60);
  },

  hideGate() {
    const gate = $('#authGate');
    if (gate) { gate.hidden = true; gate.innerHTML = ''; }
    document.body.classList.remove('auth-locked');
  }
};

window.QCAuth = QCAuth;
})();
