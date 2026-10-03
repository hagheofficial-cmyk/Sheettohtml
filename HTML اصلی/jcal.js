/* =========================================================================
 * jcal.js — تقویم جلالی (انتخاب روز با کلیک) برای همه صفحه‌ها
 * استفاده: JCal.attach(inputEl, { onPick(jalali) { ... } })
 * - inputEl می‌تواند <input> یا <button> باشد (برای دکمه متن روز در data-value ذخیره می‌شود)
 * - کلیک روی input → پاپ‌آپ ماهانه جلالی؛ کلیک روی روز → ثبت؛ کلید‌های هه/بم برای جابه‌جایی ماه
 * ========================================================================= */
(function () {
'use strict';
const C = window.QCCalc;

/* ------------------------------------------------------------- رندر ساختار */
let popup = null, openFor = null;

function ensurePopup() {
  if (popup) return popup;
  popup = document.createElement('div');
  popup.className = 'jcal-pop';
  document.body.appendChild(popup);
  document.addEventListener('click', (e) => {
    if (!popup.contains(e.target) && e.target !== openFor && (!openFor || !openFor.contains(e.target))) closePopup();
  }, true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && openFor) closePopup(); });
  return popup;
}
function closePopup() { if (popup) popup.classList.remove('show'); openFor = null; }

/* --------------------------------------------------------------- ماهانه */
let viewJ = null; // ماهِ نمایش‌داده‌شده در پاپ‌آپ

function weekdayFirst(jy, jm) {
  // jalaliToDate(jy,jm,1).getDay() → 0=یکشنبه؛ جدول ما از شنبه شروع می‌شود
  const d = C.jalaliToDate({ jy, jm, jd: 1 });
  return (d.getDay() + 1) % 7; // شنبه=0 ... جمعه=6
}

function renderMonth(el, onPick) {
  const { jy, jm } = viewJ;
  const ml = C.jalaaliMonthLength(jy, jm);
  const first = weekdayFirst(jy, jm);
  const today = C.todayJalali();
  const curVal = openFor && openFor.dataset.value ? C.parseJalali(openFor.dataset.value) : null;

  let html = `
    <div class="jcal-head">
      <button class="jcal-nav" data-d="1" title="ماه بعد"><i class="fa-solid fa-chevron-right"></i></button>
      <div class="jcal-title">${C.MONTHS_FA[jm - 1]} <b>${C.toFaDigits(String(jy))}</b></div>
      <button class="jcal-nav" data-d="-1" title="ماه قبل"><i class="fa-solid fa-chevron-left"></i></button>
    </div>
    <div class="jcal-wk">${['ش', 'ی', 'د', 'س', 'چ', 'پ', 'ج'].map(x => `<span>${x}</span>`).join('')}</div>
    <div class="jcal-grid">`;

  // روزهای خالی ابتدای ماه (ماه قبلی)
  const prevMl = C.jalaaliMonthLength(...Object.values(C.jalaliMonthAdd(jy, jm, -1)));
  for (let i = 0; i < first; i++) {
    const day = prevMl - first + 1 + i;
    html += `<div class="jcal-day other" data-m="-1" data-d="${day}">${C.toFaDigits(day)}</div>`;
  }
  for (let d = 1; d <= ml; d++) {
    const isToday = d === today.jd && jm === today.jm && jy === today.jy;
    const isSel = curVal && d === curVal.jd && jm === curVal.jm && jy === curVal.jy;
    html += `<div class="jcal-day ${isToday ? 'today' : ''} ${isSel ? 'sel' : ''}" data-m="0" data-d="${d}">${C.toFaDigits(d)}</div>`;
  }
  const filled = first + ml;
  const nextDays = filled % 7 === 0 ? 0 : 7 - (filled % 7);
  for (let i = 1; i <= nextDays; i++) html += `<div class="jcal-day other" data-m="1" data-d="${i}">${C.toFaDigits(i)}</div>`;
  html += `</div>
    <div class="jcal-foot">
      <button class="jcal-today">امروز</button>
      <button class="jcal-clear">پاک کردن</button>
    </div>`;

  el.innerHTML = html;

  el.querySelector('.jcal-nav[data-d="1"]').onclick = () => { viewJ = C.jalaliMonthAdd(jy, jm, 1); renderMonth(el, onPick); };
  el.querySelector('.jcal-nav[data-d="-1"]').onclick = () => { viewJ = C.jalaliMonthAdd(jy, jm, -1); renderMonth(el, onPick); };
  el.querySelectorAll('.jcal-day').forEach(dEl => {
    dEl.onclick = () => {
      const [mOff, day] = [+dEl.dataset.m, +dEl.dataset.d];
      const vj = mOff === 0 ? { jy, jm } : C.jalaliMonthAdd(jy, jm, mOff);
      const picked = { jy: vj.jy, jm: vj.jm, jd: day };
      const val = C.formatJalali(picked);
      openFor.dataset.value = val;
      if (openFor.tagName === 'INPUT') openFor.value = val;
      else openFor.textContent = C.toFaDigits(val);
      closePopup();
      onPick && onPick(picked);
    };
  });
  el.querySelector('.jcal-today').onclick = () => {
    const val = C.formatJalali(today);
    openFor.dataset.value = val;
    if (openFor.tagName === 'INPUT') openFor.value = val;
    else openFor.textContent = C.toFaDigits(val);
    closePopup();
    onPick && onPick(today);
  };
  el.querySelector('.jcal-clear').onclick = () => {
    openFor.dataset.value = '';
    if (openFor.tagName === 'INPUT') openFor.value = '';
    closePopup();
    onPick && onPick(null);
  };
}

/* ------------------------------------------------------------ اتصال به input */
function attach(el, opts) {
  if (!el) return;
  opts = opts || {};
  el.addEventListener('click', (e) => {
    e.preventDefault();
    if (openFor === el) { closePopup(); return; }
    openFor = el;
    const cur = C.parseJalali(el.dataset.value || el.value);
    const today = C.todayJalali();
    viewJ = cur ? { jy: cur.jy, jm: cur.jm } : { jy: today.jy, jm: today.jm };
    ensurePopup();
    popup.innerHTML = '';
    renderMonth(popup, opts.onPick);
    // جایگذاری
    const rect = el.getBoundingClientRect();
    popup.style.position = 'absolute';
    popup.style.top = (rect.bottom + window.scrollY + 6) + 'px';
    popup.style.left = (rect.left + window.scrollX) + 'px';
    popup.classList.add('show');
    e.stopPropagation();
  });
  // نمایش اولیه
  const cur = el.dataset.value || el.value;
  if (cur && el.tagName !== 'INPUT') el.textContent = C.toFaDigits(cur);
}
function closeOnScroll() { window.addEventListener('scroll', closePopup, true); window.addEventListener('resize', closePopup); }
closeOnScroll();

window.JCal = { attach, closePopup };
})();
