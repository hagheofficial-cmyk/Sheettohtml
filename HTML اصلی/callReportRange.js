/* اتصال محدود گزارش تماس مستقل به بازه‌ی سراسری؛ دیتای ابزار با دیتای QC ادغام نمی‌شود. */
(function () {
'use strict';
const C = window.QCCalc;
let range = { from: null, to: null };
let sourceRange = { from: '', to: '' }, blocked = false, previousDisplay = '';

function matches(value) {
  if (!range.from && !range.to) return true;
  // «عمومی» تاریخ فرضیِ ابزار قدیمی است، نه تاریخ واقعی تماس.
  if (String(value).includes('(عمومی)')) return false;
  const date = C.parseDate(value);
  return !!date && C.jalaliInRange(date, range.from, range.to);
}
function checkLegacySummary() {
  const section = document.getElementById('resultSection');
  if (!section) return;
  const cannotFilter = !!(range.from || range.to) && !allRawCallLogs.length && allResults.length > 0;
  let notice = document.getElementById('qcRangeWarning');
  if (cannotFilter) {
    if (!notice) {
      notice = document.createElement('div'); notice.id = 'qcRangeWarning'; notice.setAttribute('role', 'status');
      notice.style.cssText = 'padding:16px;margin:16px;border:1px solid #fbbf24;border-radius:10px;color:#fbbf24;';
      notice.textContent = 'این فایل فقط آمار تجمیعی دارد و تاریخ تک‌تک تماس‌ها موجود نیست. برای گزارش بازه‌ی تاریخ، فایل ریز تماس‌ها را دوباره وارد کنید.';
      section.before(notice);
    }
    if (!blocked) previousDisplay = section.style.display;
    section.style.display = 'none'; notice.hidden = false; blocked = true;
  } else if (blocked) {
    section.style.display = allRawCallLogs.length ? 'block' : previousDisplay;
    if (notice) notice.hidden = true;
    blocked = false;
  }
  return cannotFilter;
}
function apply(value) {
  const from = value.from ? C.parseDate(value.from) : null;
  const to = value.to ? C.parseDate(value.to) : null;
  if ((value.from && !from) || (value.to && !to) || (from && to && C.jalaliCmp(from, to) > 0)) return;
  range = { from, to }; sourceRange = value;
  if (allRawCallLogs.length) {
    const dates = [...new Set(allRawCallLogs.map((row) => row.dateStr).filter(Boolean))].sort();
    selectedDatesSet = new Set(dates.filter(matches));
    buildDateCheckboxes(dates);
    recomputeResultsFromRawLogs();
  } else if (!checkLegacySummary() && allResults.length && typeof applyFilters === 'function') {
    applyFilters();
  }
  checkLegacySummary();
}
window.QCReportRange = { matches, afterRecompute: checkLegacySummary };
window.addEventListener('message', (event) => {
  if (event.source !== window.parent || !event.data) return;
  if (location.protocol !== 'file:' && event.origin !== location.origin) return;
  if(event.data.type === 'crmqc:theme') { document.documentElement.dataset.theme = event.data.theme === 'light' ? 'light' : 'dark'; if(typeof avgDurationChart !== 'undefined' && avgDurationChart && avgDurationChart.update) avgDurationChart.update('none'); return; }
  if(event.data.type === 'crmqc:date-range') apply(event.data.range || {});
});
window.addEventListener('DOMContentLoaded', () => apply(sourceRange));
const query = new URLSearchParams(location.search);
document.documentElement.dataset.theme=query.get('qcTheme') === 'light' ? 'light' : 'dark';
apply({ from: query.get('qcFrom') || '', to: query.get('qcTo') || '' });
})();
