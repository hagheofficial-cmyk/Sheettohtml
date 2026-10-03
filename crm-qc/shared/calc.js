/* =========================================================================
 * calc.js — موتور محاسبات مشترک سامانه کنترل کیفیت CRM
 * دقیقاً معادل فرمول‌های فایل‌های اکسل:
 *   QC _ Ticket Evaluation.xlsx  (وزن‌ها: ۴۰/۲۰/۲۰/۲۰ + ردلاین)
 *   QC _ Social Evaluation.xlsx  (وزن‌ها: ۳۰/۳۰/۲۵/۱۵ + محاسبه SLA ساعات کاری)
 * هم در Node (سرور) و هم در مرورگر (کلاینت) قابل استفاده است.
 * ========================================================================= */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.QCCalc = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ------------------------- تبدیل تاریخ جلالی ↔ میلادی -------------------------
   * پیاده‌سازی استاندارد الگوریتم jalaali (مبتنی بر jalaali-js)
   */
  function div(a, b) { return Math.floor(a / b); }
  function mod(a, b) { return a - Math.floor(a / b) * b; }

  var JALALI_BREAKS = [-61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210,
    1635, 2060, 2097, 2192, 2262, 2324, 2394, 2456, 3178];

  function jalCal(jy) {
    var bl = JALALI_BREAKS.length, gy = jy + 621, leapJ = -14,
        jp = JALALI_BREAKS[0], jm, jump, leap, leapG, march, n, i;
    if (jy < jp || jy >= JALALI_BREAKS[bl - 1]) throw new Error('سال جلالی نامعتبر: ' + jy);
    for (i = 1; i < bl; i += 1) {
      jm = JALALI_BREAKS[i];
      jump = jm - jp;
      if (jy < jm) break;
      leapJ = leapJ + div(jump, 33) * 8 + div(mod(jump, 33), 4);
      jp = jm;
    }
    n = jy - jp;
    leapJ = leapJ + div(n, 33) * 8 + div(mod(n, 33) + 3, 4);
    if (mod(jump, 33) === 4 && jump - n === 4) leapJ += 1;
    leapG = div(gy, 4) - div((div(gy, 100) + 1) * 3, 4) - 150;
    march = 20 + leapJ - leapG;
    if (jump - n < 6) n = n - jump + div(jump + 4, 33) * 33;
    leap = mod(mod(n + 1, 33) - 1, 4);
    if (leap === -1) leap = 4;
    return { leap: leap, gy: gy, march: march };
  }

  /* جفت g2d/d2g بر پایه الگوریتم Fliegel–Van Flandern (fourmilab calendar.js) —
     رفت‌وبرگشت کامل در صدها نقطه تست‌شده (اخطار سال-کبیسه). */
  var GREGORIAN_EPOCH = 1721425.5;

  function leapGregorian(y) { return (y % 4 === 0) && !((y % 100 === 0) && (y % 400 !== 0)); }

  function gregorianToJd(year, month, day) {
    return (GREGORIAN_EPOCH - 1) + 365 * (year - 1) + div(year - 1, 4)
      - div(year - 1, 100) + div(year - 1, 400)
      + div(367 * month - 362, 12)
      + (month <= 2 ? 0 : (leapGregorian(year) ? -1 : -2)) + day;
  }

  function g2d(gy, gm, gd) { return gregorianToJd(gy, gm, gd) + 0.5; }

  function d2g(jdn) {
    var wjd = Math.floor(jdn - 0.5) + 0.5;
    var depoch = wjd - GREGORIAN_EPOCH;
    var quadricent = div(depoch, 146097);
    var dqc = mod(depoch, 146097);
    var cent = div(dqc, 36524);
    var dcent = mod(dqc, 36524);
    var quad = div(dcent, 1461);
    var dquad = mod(dcent, 1461);
    var yindex = div(dquad, 365);
    var year = quadricent * 400 + cent * 100 + quad * 4 + yindex;
    if (!(cent === 4 || yindex === 4)) year++;
    var yearday = wjd - gregorianToJd(year, 1, 1);
    var leapadj = wjd < gregorianToJd(year, 3, 1) ? 0 : (leapGregorian(year) ? 1 : 2);
    var month = div((yearday + leapadj) * 12 + 373, 367);
    var day = (wjd - gregorianToJd(year, month, 1)) + 1;
    return { gy: year, gm: month, gd: day };
  }

  function j2d(jy, jm, jd) {
    var r = jalCal(jy);
    return g2d(r.gy, 3, r.march) + (jm - 1) * 31 - div(jm, 7) * (jm - 7) + jd - 1;
  }

  function d2j(jdn) {
    var gy = d2g(jdn).gy, jy = gy - 621, r = jalCal(jy),
        jdn1f = g2d(gy, 3, r.march), jd1, jm, k;
    k = jdn - jdn1f;
    if (k >= 0) {
      if (k <= 185) return { jy: jy, jm: 1 + div(k, 31), jd: mod(k, 31) + 1 };
      k -= 186;
    } else {
      jy -= 1;
      k += 179;
      if (r.leap === 1) k += 1;
    }
    return { jy: jy, jm: 7 + div(k, 30), jd: mod(k, 30) + 1 };
  }

  function toGregorian(jy, jm, jd) { return d2g(j2d(jy, jm, jd)); }
  function toJalaali(gy, gm, gd) { return d2j(g2d(gy, gm, gd)); }
  function isLeapJalaaliYear(jy) { return jalCal(jy).leap === 0; }
  function jalaaliMonthLength(jy, jm) {
    if (jm <= 6) return 31;
    if (jm <= 11) return 30;
    return isLeapJalaaliYear(jy) ? 30 : 29;
  }
  function isValidJalaali(jy, jm, jd) {
    return jy >= -61 && jy <= 3177 && jm >= 1 && jm <= 12 && jd >= 1 && jd <= jalaaliMonthLength(jy, jm);
  }

  /* --------------------------- نمایش/پارس تاریخ فارسی --------------------------- */
  var FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
  var EN_DIGITS = { '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4', '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9', '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9' };
  var WEEKDAYS_FA = ['یکشنبه', 'دوشنبه', 'سه شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه', 'شنبه']; // index = JS getDay()
  var MONTHS_FA = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند']; // index = jm-1

  function toFaDigits(x) {
    return String(x == null ? '' : x).replace(/\d/g, function (d) { return FA_DIGITS[+d]; });
  }
  function faToEn(s) {
    return String(s == null ? '' : s).replace(/[۰-۹٠-٩]/g, function (ch) { return EN_DIGITS[ch] || ch; });
  }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  /** ورودی مثل «1405/06/20» یا «14050620» یا عدد 14050620 → {jy,jm,jd} یا null */
  function parseJalali(input) {
    if (input == null) return null;
    if (typeof input === 'object' && input.jy) return isValidJalaali(input.jy, input.jm, input.jd) ? { jy: input.jy, jm: input.jm, jd: input.jd } : null;
    var s = faToEn(String(input).trim()).replace(/[.\-_\s]/g, '/').replace(/\/+/g, '/');
    var jy, jm, jd;
    if (/^\d{8}$/.test(s)) { jy = +s.slice(0, 4); jm = +s.slice(4, 6); jd = +s.slice(6, 8); }
    else {
      var m = s.match(/^(\d{3,4})\/(\d{1,2})\/(\d{1,2})$/);
      if (!m) return null;
      jy = +m[1]; jm = +m[2]; jd = +m[3];
    }
    if (!isValidJalaali(jy, jm, jd)) return null;
    return { jy: jy, jm: jm, jd: jd };
  }

  function formatJalali(j, sep) {
    if (!j) return '';
    sep = sep || '/';
    return j.jy + sep + pad2(j.jm) + sep + pad2(j.jd);
  }

  /** تاریخ جلالی → Date میلادی (ساعت ۰۰:۰۰ محلی) */
  function jalaliToDate(j) {
    if (!j) return null;
    var g = toGregorian(j.jy, j.jm, j.jd);
    return new Date(g.gy, g.gm - 1, g.gd);
  }

  function weekdayFa(j) {
    var d = jalaliToDate(j);
    return d ? WEEKDAYS_FA[d.getDay()] : '';
  }

  function todayJalali() {
    var n = new Date();
    return toJalaali(n.getFullYear(), n.getMonth() + 1, n.getDate());
  }

  /* ---------- محاسبه مدت پاسخگویی در ساعات کاری (معادل فرمول LET/MAP اکسل) ----------
   * فرمول اکسل (ستون L سوشال):
   *   روزهای تعطیل: پنجشنبه و جمعه  (WEEKDAY(d,2)=4 یا 5)
   *   پنجره کاری: ۹:۰۰ تا ۱۸:۰۰
   *   دقیقه‌های کاری بین دریافت و پاسخ می‌شود مدت پاسخگویی.
   * @param {Date|...} startDt  تاریخ+ساعت دریافت
   * @param {Date|...} endDt    تاریخ+ساعت پاسخ
   * @param {Object} cfg  {workStart:'09:00', workEnd:'18:00', weekendDays:[4,5]} (getDay)
   * @returns {number|'خطای تاریخ'} دقیقه‌های کاری (گردشده)
   */
  function businessMinutes(startDt, endDt, cfg) {
    cfg = cfg || {};
    var wStart = parseTime(cfg.workStart || '09:00') || { h: 9, m: 0 };
    var wEnd = parseTime(cfg.workEnd || '18:00') || { h: 18, m: 0 };
    var weekend = cfg.weekendDays || [4, 5]; // پنجشنبه/جمعه
    if (!(startDt instanceof Date) || !(endDt instanceof Date) || isNaN(startDt) || isNaN(endDt)) return '';
    if (endDt < startDt) return 'خطای تاریخ';
    var total = 0;
    var day = new Date(startDt.getFullYear(), startDt.getMonth(), startDt.getDate());
    var last = new Date(endDt.getFullYear(), endDt.getMonth(), endDt.getDate());
    while (day <= last) {
      if (weekend.indexOf(day.getDay()) === -1) {
        var ws = new Date(day); ws.setHours(wStart.h, wStart.m, 0, 0);
        var we = new Date(day); we.setHours(wEnd.h, wEnd.m, 0, 0);
        var s = startDt > ws ? startDt : ws;
        var e = endDt < we ? endDt : we;
        var d = e - s;
        if (d > 0) total += d;
      }
      day = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1);
    }
    return Math.round(total / 60000);
  }

  function parseTime(t) {
    if (t instanceof Date) return { h: t.getHours(), m: t.getMinutes() };
    var m = faToEn(String(t == null ? '' : t)).trim().match(/^(\d{1,2}):(\d{2})/);
    if (!m) return null;
    var h = +m[1], mi = +m[2];
    if (h > 23 || mi > 59) return null;
    return { h: h, m: mi };
  }

  function combineJalaliTime(j, timeStr) {
    if (!j) return null;
    var t = parseTime(timeStr);
    if (!t) return null;
    var d = jalaliToDate(j);
    d.setHours(t.h, t.m, 0, 0);
    return d;
  }

  /* ------------------------- وضعیت SLA (معادل ستون O اکسل) -------------------------
   * IF(M="","", IF(M="عدم پاسخ","بدون پاسخ", IF(L="","اطلاعات ناقص",
   *    IF(L<=DATA!$M$1,"رعایت شده","رعایت نشده"))))   — DATA!M1 = ۶۰ دقیقه
   */
  function slaStatus(responseStatus, durationMin, slaMinutes) {
    if (!responseStatus) return '';
    if (responseStatus === 'عدم پاسخ') return 'بدون پاسخ';
    if (durationMin === '' || durationMin == null || typeof durationMin === 'string') return typeof durationMin === 'string' ? 'اطلاعات ناقص' : 'اطلاعات ناقص';
    return durationMin <= (slaMinutes == null ? 60 : slaMinutes) ? 'رعایت شده' : 'رعایت نشده';
  }

  function normalizeTri(v) {
    // مقادیر مجاز المان‌ها: ۱ ، ۰ ، «-» و تهی (تکمیل‌نشده)
    if (v === 1 || v === '1' || v === true) return 1;
    if (v === 0 || v === '0' || v === false) return 0;
    if (v === '-' || v === '−' || v === '—') return '-';
    return '';
  }

  /* ---------- نمره نهایی وزنی (معادل SUMPRODUCT اکسل) ----------
   * =IF(COUNTBLANK(محدوده)>0,"", IFERROR(SUMPRODUCT((المعان=1)*وزن‌ها)/SUMPRODUCT((المعان<>"-")*وزن‌ها)*100,""))
   * @param {Array} elems  آرایه‌ای از ۱/۰/'-'/''
   * @param {Array} weights وزن هر المان
   * @returns {number|''} نمره ۰ تا ۱۰۰ یا '' اگر ناقص باشد
   */
  function weightedScore(elems, weights) {
    for (var i = 0; i < elems.length; i++) if (elems[i] === '' || elems[i] == null) return '';
    var num = 0, den = 0;
    for (i = 0; i < elems.length; i++) {
      if (elems[i] !== '-') {
        den += weights[i];
        if (elems[i] === 1) num += weights[i];
      }
    }
    if (den === 0) return '';
    return Math.round((num / den) * 10000) / 100; // دو رقم اعشار
  }

  /* ---------- نمره تیکت (معادل ستون L فایل تیکت: ردلاین K اگر ۰ → صفر کامل) ---------- */
  function ticketScore(q1, q2, q3, q4, redline, weights) {
    var elems = [q1, q2, q3, q4].map(normalizeTri);
    var rl = redline === '' || redline == null ? '' : (normalizeTri(redline) === '-' ? '-' : +redline);
    // COUNTBLANK(G:K)>0 → ""
    if (elems.indexOf('') !== -1 || rl === '' || rl === '-') {
      if (elems.indexOf('') !== -1 || rl === '') return '';
    }
    if (rl === 0) return 0; // ردلاین: تماس با شریک → نمره صفر
    return weightedScore(elems, weights || [40, 20, 20, 20]);
  }

  /** نمره سوشال — بدون ردلاین (وزن‌ها: ۳۰/۳۰/۲۵/۱۵) */
  function socialScore(qSla, qFollow, qClosing, qTone, weights) {
    return weightedScore([qSla, qFollow, qClosing, qTone].map(normalizeTri), weights || [30, 30, 25, 15]);
  }

  /* ------------------------- گزارش‌سازی (معادل Agent/Team Report) -------------------------
   * نرخ هر المان = ۱۰۰ × تعداد(۱) / (تعداد(۱)+تعداد(۰))  — «-» نادیده گرفته می‌شود
   */
  function elementRate(values) {
    var ones = 0, zeros = 0;
    values.forEach(function (v) {
      v = normalizeTri(v);
      if (v === 1) ones++; else if (v === 0) zeros++;
    });
    if (ones + zeros === 0) return '';
    return Math.round(10000 * ones / (ones + zeros)) / 100;
  }

  function round2(x) { return x === '' || x == null || isNaN(x) ? '' : Math.round(x * 100) / 100; }

  function avg(nums) {
    if (!nums.length) return '';
    var s = 0;
    nums.forEach(function (n) { s += n; });
    return round2(s / nums.length);
  }

  /* --------------------------- مقایسه تاریخ‌های جلالی --------------------------- */
  function jalaliCmp(a, b) {
    if (!a || !b) return 0;
    return (a.jy - b.jy) || (a.jm - b.jm) || (a.jd - b.jd);
  }
  function jalaliInRange(j, from, to) {
    if (from && jalaliCmp(j, from) < 0) return false;
    if (to && jalaliCmp(j, to) > 0) return false;
    return true;
  }

  /** بازه اول تا آخر یک ماه شمسی: از ۱ تا آخرین روز ماه */
  function jalaliMonthRange(jy, jm) {
    if (!isValidJalaali(jy, jm, 1)) return null;
    return { from: { jy: jy, jm: jm, jd: 1 }, to: { jy: jy, jm: jm, jd: jalaaliMonthLength(jy, jm) } };
  }
  /** ماه بعدی/قبلی به شمسی: delta ماه‌های مثبت/منفی */
  function jalaliMonthAdd(jy, jm, delta) {
    var total = (jy * 12 + (jm - 1)) + delta;
    var y = Math.floor(total / 12), m = (total % 12) + 1;
    return { jy: y, jm: m };
  }
  /** برچسب ماه مثل «مهر ۱۴۰۵» */
  function jalaliMonthLabel(jy, jm) {
    return toFaDigits(String(jy)) + ' ' + (MONTHS_FA[jm - 1] || '');
  }

  return {
    // تاریخ
    toGregorian: toGregorian, toJalaali: toJalaali, isLeapJalaaliYear: isLeapJalaaliYear,
    jalaaliMonthLength: jalaaliMonthLength, isValidJalaali: isValidJalaali,
    parseJalali: parseJalali, formatJalali: formatJalali, jalaliToDate: jalaliToDate,
    weekdayFa: weekdayFa, todayJalali: todayJalali, jalaliCmp: jalaliCmp, jalaliInRange: jalaliInRange,
    toFaDigits: toFaDigits, faToEn: faToEn, WEEKDAYS_FA: WEEKDAYS_FA, MONTHS_FA: MONTHS_FA,
    jalaliMonthRange: jalaliMonthRange, jalaliMonthAdd: jalaliMonthAdd, jalaliMonthLabel: jalaliMonthLabel,
    // محاسبات QC
    parseTime: parseTime, combineJalaliTime: combineJalaliTime,
    businessMinutes: businessMinutes, slaStatus: slaStatus,
    normalizeTri: normalizeTri, weightedScore: weightedScore,
    ticketScore: ticketScore, socialScore: socialScore,
    elementRate: elementRate, avg: avg, round2: round2
  };
});
