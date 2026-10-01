/* callReport.js — برگه‌ی «گزارش تماس»: ابزار مستقل گزارش تماس روزانه‌ی تیم‌ها
 * (فایل call-admin-report.html — همان «گزارش تماس ادمین نهایی.html») داخل همین سامانه
 * به‌صورت فریم تمام‌صفحه سِرو می‌شود؛ دیتای خودش را جدا مدیریت می‌کند (لوکال‌استوریج خود ابزار).
 */
(function () {
'use strict';
const { $, esc } = UI;

const SRC = 'call-admin-report.html';

function render(root) {
  root.innerHTML = `
    <div class="page-head">
      <div class="ph-ic"><i class="fa-solid fa-phone"></i></div>
      <div>
        <h2>گزارش تماس</h2>
        <p>گزارش روزانه‌ی تماس تیم‌ها / شرکای بیمه بازار — ابزار کامل مستقل، داخل همین سامانه</p>
      </div>
      <div class="spacer"></div>
      <button class="btn ghost" id="crReload"><i class="fa-solid fa-rotate"></i> تازه‌سازی</button>
      <a class="btn soft" href="${esc(SRC)}" target="_blank" rel="noopener"><i class="fa-solid fa-up-right-from-square"></i> باز کردن در تب جدید</a>
    </div>
    <div class="card" style="padding:0;overflow:hidden">
      <div id="crWrap" style="position:relative;background:#0f172a;height:calc(100vh - 178px);min-height:560px">
        <iframe src="${esc(SRC)}" title="گزارش تماس روزانه تیم‌ها" style="width:100%;height:100%;border:0;display:block"></iframe>
      </div>
    </div>`;

  $('#crReload').addEventListener('click', () => {
    const f = $('#crWrap iframe');
    if (f) { f.src = 'about:blank'; setTimeout(() => { f.src = SRC; }, 60); }
  });
}

App.register('callreport', { title: 'گزارش تماس', render });
})();
