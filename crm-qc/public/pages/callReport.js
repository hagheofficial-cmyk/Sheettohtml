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
  const src = rangeSource();
  if (STANDALONE) return renderLauncher(root, src);

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

/* حالت Apps Script: لانچر به‌جای فریم تو‌در‌تو */
function renderLauncher(root, src) {
  root.innerHTML = `
    <div class="page-head">
      <div class="ph-ic"><i class="fa-solid fa-phone"></i></div>
      <div>
        <h2>گزارش تماس</h2>
        <p>ابزار مستقل گزارش روزانه‌ی تماس تیم‌ها / شرکای بیمه بازار</p>
      </div>
    </div>

    <div class="card">
      <div class="card-head brand">
        <div class="head-icon"><i class="fa-solid fa-up-right-from-square"></i></div>
        <div><h3>باز کردن ابزار گزارش تماس</h3>
          <div class="sub">در نسخه‌ی گوگل‌شیت این ابزار در صفحه‌ی خودش باز می‌شود — بازه‌ی تاریخ و حالت رنگ همراهش منتقل می‌شود</div></div>
      </div>
      <div class="card-pad cr-launch">
        <div class="cr-launch-actions">
          <a class="btn primary lg" id="crOpenTab" href="${esc(src)}" target="_blank" rel="noopener">
            <i class="fa-solid fa-arrow-up-right-from-square"></i> باز کردن گزارش تماس (تب جدید)</a>
          <a class="btn soft lg" id="crOpenTop" href="${esc(src)}" target="_top" rel="noopener">
            <i class="fa-solid fa-window-restore"></i> باز کردن در همین صفحه</a>
        </div>
        <div class="cr-launch-info">
          <div class="note"><i class="fa-solid fa-circle-info"></i>
            بازه‌ی فعلی سامانه (<b id="crRange">${esc(App.dateRangeLabel())}</b>) و حالت
            <b>${esc(App.theme === 'dark' ? 'تاریک' : 'روشن')}</b> به‌صورت خودکار به ابزار گزارش تماس منتقل می‌شود.</div>
          <div class="note warn"><i class="fa-solid fa-shield-halved"></i>
            گوگل اجازه نمی‌دهد یک وب‌اپ داخل فریمِ همان وب‌اپ باز شود (خطای <code>refused to connect</code>)؛
            به همین دلیل این ابزار در صفحه‌ی مستقل باز می‌شود و داخل خودش دکمه‌ی «بازگشت به سامانه» دارد.</div>
          <div class="note"><i class="fa-solid fa-database"></i>
            داده‌ی این ابزار در تب‌های <code>Call_Report_Experts</code> و <code>Call_Report_Access</code> شیت ذخیره می‌شود،
            پس روی هر دستگاهی که وارد شوید همان فهرست کارشناسان و دسترسی‌ها را می‌بینید.</div>
        </div>
      </div>
    </div>`;

  const refresh = () => {
    const next = rangeSource();
    $('#crOpenTab', root).href = next;
    const top = $('#crOpenTop', root);
    if (top) top.href = next;
    const label = $('#crRange', root);
    if (label) label.textContent = App.dateRangeLabel();
  };
  App.onDateRangeChange(refresh);
}

App.register('callreport', { title: 'گزارش تماس', render });
})();
