/* callReport.js — برگه‌ی «گزارش تماس»: ابزار مستقل گزارش تماس روزانه‌ی تیم‌ها
 * (فایل call-admin-report.html — همان «گزارش تماس ادمین نهایی.html») داخل همین سامانه
 * به‌صورت فریم تمام‌صفحه سِرو می‌شود؛ دیتای خودش را جدا مدیریت می‌کند (لوکال‌استوریج خود ابزار).
 */
(function () {
'use strict';
const { $, esc } = UI;

const SRC = 'call-admin-report.html';

function rangeSource() {
  const params = new URLSearchParams();
  if (App.dateRange.from) params.set('qcFrom', App.dateRange.from);
  if (App.dateRange.to) params.set('qcTo', App.dateRange.to);
  params.set('qcTheme',App.theme);
  const qs = params.toString();
  return SRC + (qs ? '?' + qs : '');
}
function render(root) {
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
    <div class="card" style="padding:0;overflow:hidden">
      <div id="crWrap" style="position:relative;background:var(--bg-2,#0f172a);height:calc(100vh - 178px);min-height:560px">
        <iframe id="crFrame" src="${esc(src)}" title="گزارش تماس روزانه تیم‌ها" style="width:100%;height:100%;border:0;display:block"></iframe>
      </div>
    </div>`;

  const frame = $('#crFrame', root);
  const syncRange = () => {
    if (!frame.isConnected || !frame.contentWindow) return;
    $('#crNewTab', root).href = rangeSource();
    frame.contentWindow.postMessage({ type:'crmqc:theme', theme:App.theme }, location.origin === 'null' ? '*' : location.origin);
    frame.contentWindow.postMessage({ type: 'crmqc:date-range', range: App.dateRange }, location.origin === 'null' ? '*' : location.origin);
  };
  frame.addEventListener('load', syncRange);
  App.onDateRangeChange(syncRange);
  $('#crReload').addEventListener('click', () => { frame.src = rangeSource(); });

}

App.register('callreport', { title: 'گزارش تماس', render });
})();
