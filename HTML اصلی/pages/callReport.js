/* callReport.js — برگه‌ی «گزارش تماس»: ابزار مستقل گزارش تماس روزانه‌ی تیم‌ها
 *
 * نسخه‌ی Node/مرورگر: همان فایل داخل یک فریم تمام‌صفحه (هم‌ریشه، بدون مشکل).
 * نسخه‌ی Apps Script: گوگل صفحه‌ی وب‌اپ را داخل یک فریم شنی (sandbox) سرو می‌کند و
 * فریم تو‌در‌تو به /exec با «refused to connect» رد می‌شود؛ پس اینجا فرمی ساخته
 * نمی‌شود و ابزار در یک صفحه‌ی مستقل (تب جدید یا همین صفحه) باز می‌شود (بند ۱۱).
 */
(function () {
'use strict';
const { $, esc } = UI;

const STANDALONE = !!(window.APP_SCRIPT_MODE && window.APP_SCRIPT_URL);
const SRC = STANDALONE ? window.APP_SCRIPT_URL + '?page=call-report' : 'call-admin-report.html';

function rangeSource() {
  const params = new URLSearchParams();
  if (App.dateRange.from) params.set('qcFrom', App.dateRange.from);
  if (App.dateRange.to) params.set('qcTo', App.dateRange.to);
  params.set('qcTheme', App.theme);
  const qs = params.toString();
  return SRC + (qs ? (SRC.includes('?') ? '&' : '?') + qs : '');
}

function render(root) {
  if (STANDALONE) return renderStandalone(root);

  const src = rangeSource();
  root.innerHTML = `
    <div class="page-head">
      <div class="ph-ic"><i class="fa-solid fa-phone"></i></div>
      <div>
        <h2>گزارش تماس</h2>
        <p>گزارش روزانه‌ی تماس تیم‌ها / شرکای بیمه بازار — ابزار کامل مستقل، داخل همین سامانه</p>
      </div>
      <div class="spacer"></div>
      <button class="btn ghost" id="crReload"><i class="fa-solid fa-rotate"></i> تازه‌سازی</button>
      <a id="crNewTab" class="btn soft" href="${esc(src)}" target="_blank" rel="noopener"><i class="fa-solid fa-up-right-from-square"></i> باز کردن در تب جدید</a>
    </div>
    <div class="card cr-frame-card">
      <div id="crWrap">
        <iframe id="crFrame" src="${esc(src)}" title="گزارش تماس روزانه تیم‌ها"></iframe>
      </div>
    </div>`;

  const frame = $('#crFrame', root);
  const syncRange = () => {
    if (!frame.isConnected || !frame.contentWindow) return;
    $('#crNewTab', root).href = rangeSource();
    frame.contentWindow.postMessage({ type: 'crmqc:theme', theme: App.theme }, location.origin === 'null' ? '*' : location.origin);
    frame.contentWindow.postMessage({ type: 'crmqc:date-range', range: App.dateRange }, location.origin === 'null' ? '*' : location.origin);
  };
  frame.addEventListener('load', syncRange);
  App.onDateRangeChange(syncRange);
  $('#crReload').addEventListener('click', () => { frame.src = rangeSource(); });
}

/* ---------------------------------------------------------------------------
 * نسخه‌ی Apps Script: ابزار را از خودِ سامانه می‌گیریم و داخل یک iframe محلی
 * (srcdoc) نشان می‌دهیم. باز کردن آدرس وب‌اپ در تب جدید در بعضی استقرارها به
 * «Sorry, unable to open the file at this time» می‌خورد؛ این مسیر به آن وابسته نیست.
 * ------------------------------------------------------------------------- */
let reportHtmlCache = null;   // HTML ابزار (یک‌بار در هر بارگذاری صفحه)
let reportHtmlPending = false;
let reportTarget = null;      // آخرین #crWrap زنده؛ رندر مجدد مسیر آن را عوض می‌کند

function renderStandalone(root) {
  const params = new URLSearchParams();
  if (App.dateRange.from) params.set('qcFrom', App.dateRange.from);
  if (App.dateRange.to) params.set('qcTo', App.dateRange.to);
  params.set('qcTheme', App.theme === 'light' ? 'light' : 'dark');

  root.innerHTML = `
    <div class="page-head">
      <div class="ph-ic"><i class="fa-solid fa-phone"></i></div>
      <div>
        <h2>گزارش تماس</h2>
        <p>ابزار روزانه‌ی تماس تیم‌ها — داخل خود سامانه باز می‌شود؛ بازه‌ی تاریخ و حالت رنگ همراه آن می‌آیند.</p>
      </div>
      <div class="spacer"></div>
      <button class="btn ghost" id="crReload"><i class="fa-solid fa-rotate"></i> تازه‌سازی</button>
      <a class="btn soft" id="crNewTab" href="${esc(rangeSource())}" target="_blank" rel="noopener" title="اگر در تب جدید باز نشد، همین صفحه را استفاده کنید">
        <i class="fa-solid fa-up-right-from-square"></i> تب جدید</a>
    </div>
    <div class="card cr-frame-card">
      <div class="cr-embed-bar">
        <span class="cr-embed-state" id="crEmbedState"><i class="fa-solid fa-circle-notch spin"></i> در حال آماده‌سازی ابزار…</span>
        <div class="spacer"></div>
        <span class="cr-embed-hint">بازه‌ی فعلی: <b id="crRange">${esc(App.dateRangeLabel())}</b></span>
      </div>
      <div id="crWrap" class="cr-embed-wrap">
        <div class="loading-page"><div class="spinner"></div></div>
      </div>
    </div>`;

  const wrap = $('#crWrap', root);
  reportTarget = wrap;
  let frame = null;

  function setState(html, cls) {
    const el = $('#crEmbedState', root);
    if (!el) return;
    el.className = 'cr-embed-state' + (cls ? ' ' + cls : '');
    el.innerHTML = html;
  }

  function bridgeScript() {
    /* google.script.run داخل srcdoc وجود ندارد؛ ذخیره‌ی تنظیمات به والد پاس داده می‌شود. */
    return `<script>
(function () {
  if (window.google && window.google.script && google.script.run) return;
  window.google = window.google || {};
  window.google.script = window.google.script || {};
  var run = function () {
    var api = { _ok: null, _fail: null };
    api.withSuccessHandler = function (fn) { api._ok = fn; return api; };
    api.withFailureHandler = function (fn) { api._fail = fn; return api; };
    api.saveCallReportSetting = function (key, value) {
      try { window.parent.postMessage({ type: 'qc:callreport-save', key: key, value: value }, '*'); } catch (e) {}
      if (api._ok) setTimeout(function () { api._ok({}); }, 0);
      return api;
    };
    return api;
  };
  window.google.script.run = run();
})();
</script>`;
  }

  function paint(html) {
    const target = reportTarget && reportTarget.isConnected ? reportTarget : wrap;
    if (!target || !target.isConnected) return;
    const doc = String(html || '');
    const withParams = `<script>window.__QC_CALL_REPORT_PARAMS__ = ${JSON.stringify('?' + params.toString())};</script>`;
    const full = doc.indexOf('<head>') >= 0
      ? doc.replace('<head>', '<head>' + bridgeScript() + withParams)
      : bridgeScript() + withParams + doc;
    frame = document.createElement('iframe');
    frame.className = 'cr-embed-frame';
    frame.title = 'گزارش تماس روزانه تیم‌ها';
    frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-popups allow-downloads');
    frame.addEventListener('load', () => {
      setState('<i class="fa-solid fa-circle-check"></i> ابزار آماده است', 'ok');
      try {
        frame.contentWindow.postMessage({ type: 'crmqc:theme', theme: App.theme }, '*');
        frame.contentWindow.postMessage({ type: 'crmqc:date-range', range: App.dateRange }, '*');
      } catch (e) { /* بی‌اثر */ }
    });
    target.innerHTML = '';
    target.appendChild(frame);
    frame.srcdoc = full;
  }

  function fallback(message) {
    const target = reportTarget && reportTarget.isConnected ? reportTarget : wrap;
    if (!target || !target.isConnected) return;
    setState('<i class="fa-solid fa-triangle-exclamation"></i> باز نشد', 'bad');
    target.innerHTML = `<div class="card-pad cr-embed-fallback">
      <div class="note bad"><i class="fa-solid fa-circle-exclamation"></i> ${esc(message || 'بارگذاری ابزار ممکن نشد')}</div>
      <p>اگر باز کردن در تب جدید هم پیام <b>Sorry, unable to open the file at this time</b> داد، یعنی استقرار
        (Deploy) وب‌اپ برای همین حساب در دسترس نیست. یک‌بار از Apps Script گزینه‌ی
        <b>Deploy → New deployment → Web app</b> را با دسترسی مناسب بسازید و دوباره تلاش کنید.</p>
      <button class="btn primary" id="crRetry"><i class="fa-solid fa-rotate-right"></i> تلاش دوباره</button>
    </div>`;
    const retry = $('#crRetry', target);
    if (retry) retry.addEventListener('click', () => load(true));
  }

  function load(force) {
    if (!(window.google && google.script && google.script.run)) { fallback('اتصال به Apps Script برقرار نیست'); return; }
    if (!force && reportHtmlCache) { paint(reportHtmlCache); return; }
    if (!force && reportHtmlPending) return; // پاسخ در راه است؛ همان را می‌کشیم
    reportHtmlPending = true;
    const target = reportTarget;
    target.innerHTML = '<div class="loading-page"><div class="spinner"></div></div>';
    setState('<i class="fa-solid fa-circle-notch spin"></i> در حال آماده‌سازی ابزار…');
    google.script.run
      .withSuccessHandler((html) => {
        reportHtmlPending = false;
        if (!html) { fallback('نسخه‌ی مستقر، تابع گزارش تماس را ندارد؛ Code.gs جدید را جای‌گذاری کنید'); return; }
        reportHtmlCache = html;
        try { paint(html); } catch (e) { fallback(e.message); }
      })
      .withFailureHandler((error) => { reportHtmlPending = false; fallback(error && error.message); })
      .getCallReportHtml();
  }

  /* ذخیره‌ی تنظیمات ابزار (کارشناسان/دسترسی‌ها) از داخل iframe به شیت */
  const onMessage = (event) => {
    /* صفحه که عوض شود، گوش‌دهنده خودش بازنشسته می‌شود */
    if (!root.isConnected) { window.removeEventListener('message', onMessage); return; }
    const data = event.data || {};
    if (data.type !== 'qc:callreport-save') return;
    if (!(window.google && google.script && google.script.run)) return;
    google.script.run
      .withFailureHandler(() => UI.toast('ذخیره تنظیمات گزارش تماس در شیت ناموفق بود', 'error'))
      .saveCallReportSetting(data.key, data.value);
  };

  const refresh = () => {
    const label = $('#crRange', root);
    if (label) label.textContent = App.dateRangeLabel();
    const link = $('#crNewTab', root);
    if (link) link.href = rangeSource();
    params.set('qcTheme', App.theme);
    if (App.dateRange.from) params.set('qcFrom', App.dateRange.from); else params.delete('qcFrom');
    if (App.dateRange.to) params.set('qcTo', App.dateRange.to); else params.delete('qcTo');
    try { if (frame && frame.contentWindow) frame.contentWindow.postMessage({ type: 'crmqc:date-range', range: App.dateRange }, '*'); } catch (e) {}
  };
  App.onDateRangeChange(refresh);
  window.addEventListener('message', onMessage);
  $('#crReload', root).addEventListener('click', () => load(true));
  load();
}

App.register('callreport', { title: 'گزارش تماس', render });
})();
