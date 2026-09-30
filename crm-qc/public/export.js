/* =========================================================================
 * export.js — تولید خروجی اکسل (SheetJS) با ساختار دقیق فایل‌های مرجع
 * ========================================================================= */
(function () {
'use strict';
const C = window.QCCalc;

const MONTHS_FA = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'];

function stamp() {
  const t = C.todayJalali();
  return C.formatJalali(t, '');
}
function num(v) { // ذخیره تاریخ به شکل عددی مثل اکسل مرجع: 14050620
  const j = C.parseJalali(v);
  return j ? j.jy * 10000 + j.jm * 100 + j.jd : '';
}
function tri(v) { return v === '' || v == null ? '' : (String(v) === '-' ? '-' : +v); }

function download(wb, name) {
  XLSX.writeFile(wb, name);
}

/* ------------------------------------------------------------- تیکت‌ها */
function ticketsWorkbook(rows, settings) {
  const W = settings.ticketWeights;
  const header = [
    'کارشناس کنترل کیفیت', 'تاریخ بررسی', 'تاریخ ایجاد تیکت', 'نام کارشناس', 'تیم کارشناس', 'کد یکتای تیکت',
    'پیگیری صحیح و رسیدگی تا مشخص‌شدن نتیجه', 'ثبت کامل یادداشت در پارس‌لاجیک', 'انتخاب صحیح دلیل بستن تیکت',
    'ثبت صحیح اکشن در CRM', 'عدم تماس با شریک - ردلاین - صفر', 'نمره نهایی', 'کامنت کنترل کیفیت'
  ];
  // سطر اول: وزن‌ها (مثل فایل اصلی G1=40, H1=20, I1=20, J1=20)
  const weightsRow = ['', '', '', '', '', '', W[0], W[1], W[2], W[3], '', '', ''];
  const data = rows.map((t) => [
    t.qcAgent, num(t.reviewDate), num(t.ticketDate), t.agentName, t.team, t.ticketCode,
    tri(t.q1), tri(t.q2), tri(t.q3), tri(t.q4),
    t.redline === '' ? '' : +t.redline,
    t.score == null ? '' : t.score,
    t.comment || ''
  ]);
  const ws = XLSX.utils.aoa_to_sheet([weightsRow, header, ...data]);
  ws['!cols'] = [{ wch: 14 }, { wch: 10 }, { wch: 12 }, { wch: 22 }, { wch: 11 }, { wch: 12 },
    { wch: 22 }, { wch: 20 }, { wch: 18 }, { wch: 16 }, { wch: 18 }, { wch: 10 }, { wch: 30 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Evaluations');
  return wb;
}

/* ------------------------------------------------------------- سوشال‌ها */
function socialsWorkbook(rows, settings) {
  const W = settings.socialWeights;
  const header = [
    'تاریخ بررسی', 'کارشناس QC', 'روز دریافت', 'تاریخ دریافت پیام', 'روز پاسخ', 'تاریخ پاسخدهی',
    'نام کارشناس', 'تیم کارشناس', 'پیامرسان', 'ساعت دریافت', 'ساعت پاسخ', 'مدت زمان پاسخگویی (دقیقه کاری)',
    'وضعیت پاسخ', 'دلیل تاخیر یا عدم پاسخ', 'وضعیت رعایت یا عدم رعایت SLA', 'وضعیت تایید دلیل',
    'رعایت زمان پاسخ‌گویی (SLA)', 'پیگیری و رسیدگی تا مشخص‌شدن نتیجه', 'پایان‌بندی صحیح مکالمه', 'لحن و نگارش حرفه‌ای',
    'نمره نهایی', 'توضیحات کنترل کیفیت'
  ];
  const weightsRow = new Array(16).fill('').concat([W[0], W[1], W[2], W[3], '', '']);
  const data = rows.map((s) => [
    num(s.reviewDate), s.qcAgent, s.receiveWeekday || C.weekdayFa(C.parseJalali(s.receiveDate)), num(s.receiveDate),
    s.replyWeekday || C.weekdayFa(C.parseJalali(s.replyDate)), num(s.replyDate),
    s.agentName, s.team, s.messenger, s.receiveTime, s.replyTime,
    s.durationError ? 'خطای تاریخ' : (s.durationMin == null ? '' : s.durationMin),
    s.responseStatus, s.delayReason || '', s.slaStatus || '', s.reasonVerdict || '',
    tri(s.qSla), tri(s.qFollow), tri(s.qClosing), tri(s.qTone),
    s.score == null ? '' : s.score, s.comment || ''
  ]);
  const ws = XLSX.utils.aoa_to_sheet([weightsRow, header, ...data]);
  ws['!cols'] = [{ wch: 10 }, { wch: 11 }, { wch: 9 }, { wch: 11 }, { wch: 9 }, { wch: 11 },
    { wch: 22 }, { wch: 11 }, { wch: 9 }, { wch: 8 }, { wch: 8 }, { wch: 13 },
    { wch: 12 }, { wch: 20 }, { wch: 16 }, { wch: 14 },
    { wch: 13 }, { wch: 18 }, { wch: 13 }, { wch: 13 }, { wch: 10 }, { wch: 26 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Evaluations');
  return wb;
}

/* -------------------------------------------------------------- گزارش‌ها */
const SOCIAL_AGENT_HEADER = ['نام کارشناس', 'تیم', 'تعداد ارزیابی نمره‌دار', 'میانگین نمره نهایی / 100',
  'تعداد پیام پاسخ‌داده‌شده', 'درصد رعایت SLA واقعی', 'میانگین المان SLA / 100', 'میانگین پیگیری / 100',
  'میانگین پایان‌بندی / 100', 'میانگین لحن / 100', 'تعداد عدم پاسخ', 'تعداد SLA رعایت‌نشده', 'میانگین مدت پاسخ (دقیقه)'];
const SOCIAL_TEAM_HEADER = ['نام تیم', 'تعداد ارزیابی نمره‌دار', 'تعداد کارشناسان ارزیابی‌شده', 'میانگین نمره نهایی / 100',
  'تعداد پیام پاسخ‌داده‌شده', 'درصد رعایت SLA واقعی', 'میانگین المان SLA / 100', 'میانگین پیگیری / 100',
  'میانگین پایان‌بندی / 100', 'میانگین لحن / 100', 'تعداد عدم پاسخ', 'تعداد SLA رعایت‌نشده', 'میانگین مدت پاسخ (دقیقه)'];
const TICKET_AGENT_HEADER = ['نام کارشناس', 'تیم', 'تعداد ارزیابی نمره‌دار', 'میانگین نمره نهایی / 100',
  'میانگین پیگیری / 100', 'میانگین یادداشت / 100', 'میانگین دلیل بستن / 100', 'میانگین اکشن CRM / 100', 'تعداد ردلاین (صفر)'];
const TICKET_TEAM_HEADER = ['نام تیم', 'تعداد ارزیابی نمره‌دار', 'تعداد کارشناسان ارزیابی‌شده', 'میانگین نمره نهایی / 100',
  'میانگین پیگیری / 100', 'میانگین یادداشت / 100', 'میانگین دلیل بستن / 100', 'میانگین اکشن CRM / 100', 'تعداد ردلاین (صفر)'];

function reportsWorkbook(type, agentRows, teamRows) {
  const wb = XLSX.utils.book_new();
  let aoaA, aoaT;
  if (type === 'social') {
    aoaA = [SOCIAL_AGENT_HEADER, ...agentRows.map((x) => [x.name, x.team, x.count, x.avgScore, x.answered, x.slaReal, x.qSlaRate, x.qFollowRate, x.qClosingRate, x.qToneRate, x.unanswered, x.slaMissed, x.avgDurationMin])];
    aoaT = [SOCIAL_TEAM_HEADER, ...teamRows.map((x) => [x.name, x.count, x.agentsEvaluated, x.avgScore, x.answered, x.slaReal, x.qSlaRate, x.qFollowRate, x.qClosingRate, x.qToneRate, x.unanswered, x.slaMissed, x.avgDurationMin])];
  } else {
    aoaA = [TICKET_AGENT_HEADER, ...agentRows.map((x) => [x.name, x.team, x.count, x.avgScore, x.q1Rate, x.q2Rate, x.q3Rate, x.q4Rate, x.redlineZero])];
    aoaT = [TICKET_TEAM_HEADER, ...teamRows.map((x) => [x.name, x.count, x.agentsEvaluated, x.avgScore, x.q1Rate, x.q2Rate, x.q3Rate, x.q4Rate, x.redlineZero])];
  }
  const mk = (aoa) => {
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = aoa[0].map((h) => ({ wch: Math.max(14, String(h).length * 1.1) }));
    return ws;
  };
  XLSX.utils.book_append_sheet(wb, mk(aoaA), 'Agent Report');
  XLSX.utils.book_append_sheet(wb, mk(aoaT), 'Team Report');
  return wb;
}

window.QCExport = {
  tickets(rows, settings) { download(ticketsWorkbook(rows, settings), `QC_Ticket_Evaluation_${stamp()}.xlsx`); },
  socials(rows, settings) { download(socialsWorkbook(rows, settings), `QC_Social_Evaluation_${stamp()}.xlsx`); },
  reports(type, agentRows, teamRows) { download(reportsWorkbook(type, agentRows, teamRows), `QC_${type === 'social' ? 'Social' : 'Ticket'}_Report_${stamp()}.xlsx`); },
  calls(agentRows, teamRows, elements) {
    const wb = XLSX.utils.book_new();
    const mk = (aoa) => {
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      ws['!cols'] = aoa[0].map((h) => ({ wch: Math.max(14, String(h).length * 1.1) }));
      return ws;
    };
    const hA = ['نام کارشناس', 'تیم', 'تعداد نمره‌دار', 'میانگین نمره / 100', 'ردلاین',
      'تلفنی (ت)', 'میانگین تلفنی', 'اکانت (ت)', 'میانگین اکانت', 'MLM (ت)', 'میانگین MLM', 'مجموع ریت'];
    const hT = ['نام تیم', 'تعداد نمره‌دار', 'میانگین نمره / 100', 'ردلاین',
      'تلفنی (ت)', 'میانگین تلفنی', 'اکانت (ت)', 'میانگین اکانت', 'MLM (ت)', 'میانگین MLM', 'مجموع ریت'];
    XLSX.utils.book_append_sheet(wb, mk([hA, ...agentRows.map((r) => [r.name, r.team, r.count, r.avgScore, r.redlines, r.teleCount, r.teleAvg, r.accCount, r.accAvg, r.mlmCount, r.mlmAvg, r.total])]), 'Agent Report');
    XLSX.utils.book_append_sheet(wb, mk([hT, ...teamRows.map((r) => [r.name, r.count, r.avgScore, r.redlines, r.teleCount, r.teleAvg, r.accCount, r.accAvg, r.mlmCount, r.mlmAvg, r.total])]), 'Team Report');
    if (elements && elements.length) {
      const FORM_FA = { tele: 'تلفنی', account: 'اکانت', mlm: 'MLM' };
      const hE = ['المان', 'فرم', 'رعایت‌شده', 'عدم رعایت', 'مجموع', 'نرخ رعایت ٪', 'نرخ عدم رعایت ٪'];
      XLSX.utils.book_append_sheet(wb, mk([hE, ...elements.map((x) => [x.label, FORM_FA[x.form] || x.form, x.ok, x.bad, x.total, x.successRate, x.errorRate])]), 'المان‌های کلی');
    }
    download(wb, `QC_Call_Report_${stamp()}.xlsx`);
  },
  combined(rows) {
    const wb = XLSX.utils.book_new();
    const h = ['کارشناس', 'تیم', 'تیکت (ت)', 'میانگین تیکت', 'ردلاین صفر تیکت', 'سوشال (ت)', 'میانگین سوشال', 'SLA سوشال', 'عدم پاسخ سوشال', 'تماس (ت)', 'میانگین تماس', 'ردلاین تماس', 'مجموع', 'میانگین کل'];
    const aoa = [h, ...rows.map((r) => [
      r.name, r.team, r.ticketCount, r.ticketAvg === '' ? '' : r.ticketAvg, r.ticketRedline,
      r.socialCount, r.socialAvg === '' ? '' : r.socialAvg, r.socialSlaReal === '' ? '' : r.socialSlaReal, r.socialUnanswered,
      r.callCount, r.callAvg === '' ? '' : r.callAvg, r.callRedline, r.totalCount, r.avgScore === '' ? '' : r.avgScore
    ])];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = h.map(() => ({ wch: 16 }));
    XLSX.utils.book_append_sheet(wb, ws, 'Combined');
    download(wb, `QC_Combined_Report_${stamp()}.xlsx`);
  },
  sheets(title, sheets) {
    const wb = XLSX.utils.book_new();
    (sheets || []).forEach(({ name, rows }) => {
      const ws = XLSX.utils.aoa_to_sheet(rows);
      const maxLen = Math.max(...rows[0].map((h0) => String(h0).length));
      ws['!cols'] = rows[0].map(() => ({ wch: Math.max(12, maxLen + 4) }));
      XLSX.utils.book_append_sheet(wb, ws, name);
    });
    download(wb, `${String(title || 'QC_Export').replace(/[\s\/:*?"<>|]/g, '_')}_${stamp()}.xlsx`);
  }
};
})();
