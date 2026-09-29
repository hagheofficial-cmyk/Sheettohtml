/* feedbackPage.js — پنل فیدبک تماس: فایل HTML اصلی پروژه، بدون هیچ تغییری، داخل سیستم */
(function () {
'use strict';
const { $ } = UI;

async function render(root) {
  root.innerHTML = `
    <div class="page-head">
      <div class="ph-ic"><i class="fa-solid fa-headset"></i></div>
      <div>
        <h2>فیدبک تماس — پنل دستیار فیدبک QC</h2>
        <p>همان پنل اصلی پروژه (تحلیل تماس‌های ریت‌شده) که بدون هیچ تغییری درون سامانه سرو می‌شود.</p>
      </div>
      <div class="spacer"></div>
      <a class="btn ghost" href="/feedback-panel" target="_blank" rel="noopener"><i class="fa-solid fa-up-right-from-square"></i> باز کردن در تب جدید</a>
      <button class="btn soft" id="reloadF"><i class="fa-solid fa-rotate"></i> بارگذاری مجدد</button>
    </div>
    <div class="iframe-shell">
      <div class="iframe-wrap">
        <iframe id="fbFrame" src="/feedback-panel" title="پنل دستیار فیدبک QC" allow="clipboard-read; clipboard-write"></iframe>
      </div>
    </div>`;
  $('#reloadF').addEventListener('click', () => { $('#fbFrame').contentWindow.location.reload(); });
}

App.register('feedback', { title: 'فیدبک تماس', render });
})();
