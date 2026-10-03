/* =========================================================================
 * parseQc.js — پارسر مشترک فرم‌های QC تماس (tele/account/mlm)
 * منطق دقیقاً منطبق بر parseRows پنل دستیار فیدبک QC است؛
 * کوتیشن‌های اضافی پاک می‌شوند، تاریخ‌های Excel/ISO/شمسی همه به شمسی تبدیل می‌شوند.
 * UMD: مرورگر (window.QCParse) و Node (require) هر دو.
 * ========================================================================= */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./calc.js'));
  else root.QCParse = factory(root.QCCalc);
})(typeof self !== 'undefined' ? self : this, function (C) {
'use strict';

/* ---------- دیکشنری مفصل (هم‌نام پنل — استخراج مستقیم از پنل دستیار فیدبک QC) ---------- */
/* معیارها + برچسب فارسی دقیقاً همان‌هایی است که پنل در گزارش‌اش نمایش می‌دهد.
 * ترتیب = ترتیب نمایش. در صورت تغییر پنل، این جدول هم باید به‌روز شود. */
const TELE_CRITERIA = [
  'Call_opening_quality', 'outbound_call_targeting', 'customer_language_alignment',
  'applied_product_knowledge', 'active_engagement', 'partner_objection_management',
  'attractive_payout_announcement', 'tone_politeness', 'campaign_reference',
  'final_call_review', 'lead_retention', 'Correctly_record_action', 'mandatory_check',
  'sla_compliance', 'note'
];
const ACCOUNT_CRITERIA = [
  'Call_opening_quality', 'outbound_call_targeting', 'partner_objection_identification',
  'need_based_value_articulation', 'partner_objection_management', 'partner_tailored_presentation',
  'stakeholder_intent_evaluation', 'applied_product_knowledge', 'cta_guidance', 'human_linkage',
  'Correctly_record_action', 'sales_impediment', 'mandatory_check', 'Final_call_analysis'
];
const MLM_CRITERIA = [
  'Call_opening_quality', 'agent_introduction_and_role', 'user_identify_verification',
  'pre_offer_needs_assessment', 'professional_concern_handling', 'effective_negotiation',
  'link_establishment', 'professional_tone', 'courteous_closure', 'call_action_logging', 'note'
];

/* برچسب فارسی هر معیار (برای نمایش در UI و خروجی اکسل) — دقیقاً از پنل */
const CRITERIA_LABELS = {
  tele: {
    Call_opening_quality: 'شروع مناسب مکالمه', outbound_call_targeting: 'هدف گذاری تماس',
    customer_language_alignment: 'زبان مشتری', applied_product_knowledge: 'دانش کاربردی محصول',
    active_engagement: 'تعامل فعال', partner_objection_management: 'مدیریت اعتراض یا مقاومت شریک',
    attractive_payout_announcement: 'اعلام صحیح و جذاب کارمزد', tone_politeness: 'لحن و ادب',
    campaign_reference: 'پرزنت صحیح جشنواره', final_call_review: 'بازبینی نهایی تماس',
    lead_retention: 'حفظ لید', Correctly_record_action: 'ثبت درست اکشن تماس',
    mandatory_check: 'ثبت موارد الزامی در CRM', sla_compliance: 'رعایت SLA', note: 'درج یادداشت'
  },
  account: {
    Call_opening_quality: 'شروع مناسب تماس', outbound_call_targeting: 'هدف گذاری تماس',
    partner_objection_identification: 'شناسایی دغدغه شریک', need_based_value_articulation: 'انتقال ارزش محصول',
    partner_objection_management: 'مدیریت اعتراض شریک', partner_tailored_presentation: 'پرزنت جشنواره متناسب',
    stakeholder_intent_evaluation: 'ارزیابی آمادگی شریک', applied_product_knowledge: 'دانش کاربردی محصول',
    cta_guidance: 'هدایت به CTA مشخص', human_linkage: 'روابط انسانی موثر',
    Correctly_record_action: 'ثبت درست اکشن', sales_impediment: 'ثبت مانع کلیدی فروش',
    mandatory_check: 'ثبت موارد الزامی CRM', Final_call_analysis: 'تحلیل نهایی در CRM'
  },
  mlm: {
    Call_opening_quality: 'شروع مناسب مکالمه', agent_introduction_and_role: 'معرفی خود و اعلام واحد',
    user_identify_verification: 'احراز هویت نماینده', pre_offer_needs_assessment: 'نیازسنجی قبل از ارائه پیشنهاد',
    professional_concern_handling: 'مدیریت حرفه‌ای نگرانی‌ها و اعتراضات', effective_negotiation: 'تعامل و مذاکره مؤثر',
    link_establishment: 'ایجاد یا تثبیت راه ارتباطی', professional_tone: 'ادبیات حرفه‌ای',
    courteous_closure: 'پایان‌بندی محترمانه تماس', call_action_logging: 'ثبت درست اکشن تماس',
    note: 'یادداشت کامل'
  }
};

/* ---------- پاک‌سازی ارزش (معادل cleanAndParseValue پنل) ---------- */
/* ---------------------- اصلاح: ترجمه‌ی هم‌منطق پنل
   مقدار خام با کوتیشن‌های اضافی '"'1'"' را به عدد/رشته درمی‌آورد */
function cleanValue(val, isScore) {
  if (val === undefined || val === null) return isScore ? 0 : '-';
  let clean = String(val).replace(/["']/g, '').trim();
  if (clean === '-') return '-';
  const parsed = parseFloat(clean);
  return isNaN(parsed) ? 0 : parsed;
}
/* redline به شکل‌های مختلف: 1 | '1' | '\"1\"' | '1.0' | true */
function isRedline(v) {
  if (v === true) return true;
  if (typeof v === 'number') return v === 1;
  if (v === undefined || v === null) return false;
  const s = String(v).replace(/["']/g, '').trim();
  const n = parseFloat(s);
  return !isNaN(n) && n === 1;
}
function cleanText(val) {
  if (val === undefined || val === null) return '';
  return String(val).replace(/["']/g, '').trim();
}

/* ---------- تبدیل هر نوع تاریخ به اجزای جلالی ---------- */
/* ورودی: عدد اکسل (میلادی، مثل 46259.49)، رشته ISO/میلادی، رشته شمسی '1405/06/03'
 * خروجی: {jy,jm,jd} یا null */
function anyToJalali(v) {
  if (v === undefined || v === null || v === 'نامشخص' || v === '') return null;
  if (typeof v === 'number') {
    // date serial Excel (گرگوریان) — منطق parseQcDate پنل
    if (v > 30000 && v < 60000) {
      const d = new Date((v - 25569) * 86400 * 1000);
      if (isNaN(d.getTime())) return null;
      return C.toJalaali(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
    }
    // تاریخ عددی شمسی مثل 14050603
    const s = String(Math.floor(v));
    if (s.length === 8) return C.parseJalali(s.slice(0, 4) + '/' + s.slice(4, 6) + '/' + s.slice(6, 8));
    return null;
  }
  const s0 = String(v).trim();
  // شمسی؟
  const j = C.parseJalali(s0);
  if (j) return j;
  // ISO / میلادی
  const d = new Date(s0.replace(/[۰-۹]/g, (ch) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(ch)));
  if (!isNaN(d.getTime())) return C.toJalaali(d.getFullYear(), d.getMonth() + 1, d.getDate());
  return null;
}

function cleanQcDate(v) { const j = anyToJalali(v); return j ? C.formatJalali(j) : null; }

/* ---------- تشخیص کلیدها (case-insensitive, بدون فاصله) ---------- */
function findKey(row, candidates) {
  const keys = Object.keys(row);
  const norm = (k) => k.trim().toLowerCase();
  for (const k of keys) if (candidates.includes(norm(k))) return k;
  return null;
}

/* ---------- پارس ردیف‌های یک فرم (دقیقاً منطق پنل به‌علاوه‌ی تبدیل تاریخ) ---------- */
/* rows: آرایه‌ی آبجکت‌های JSON از SheetJS (sheet_to_json)
 * type: 'tele' | 'account' | 'mlm'
 * خروجی: [{expertName, score, redline, redlineReason, leadName, leadPhone,
 *          listeningTime, qcComment, reviewDate, formType, elements}] */
function parseRows(rows, type) {
  const mappingRef = type === 'tele' ? TELE_CRITERIA : (type === 'mlm' ? MLM_CRITERIA : ACCOUNT_CRITERIA);
  const dt = type === 'mlm'
    ? ['form_created_date', 'form created date', 'action_date', 'action date']
    : ['action_date', 'action date', 'form_created_date', 'form created date'];
  const list = [];
  for (const r of (rows || [])) {
    const nameKey = findKey(r, ['tele_expert_name']);
    const expertName = nameKey ? String(r[nameKey]).trim() : '';
    if (!expertName) continue;

    const scoreKey = findKey(r, ['score']);
    const redlineKey = findKey(r, ['red_line', 'red line']);
    const redlineReasonKey = findKey(r, ['red_line_reason', 'red line reason', 'علت ردلاین', 'علت خط قرمز']);
    const lsKey = findKey(r, ['listening time (second)', 'listening_time_(second)', 'listening_time_second', 'listening_time']);
    const dateKey = findKey(r, dt);

    let score = cleanValue(scoreKey ? r[scoreKey] : undefined, true);
    const redline = cleanValue(redlineKey ? r[redlineKey] : undefined, true);
    const redlineReason = redlineReasonKey ? cleanText(r[redlineReasonKey]) : '';

    const elements = {};
    for (const elKey of mappingRef) {
      let cell = undefined;
      for (const k of Object.keys(r)) if (k.trim().toLowerCase() === elKey.toLowerCase()) { cell = r[k]; break; }
      if (cell === undefined) elements[elKey] = '-';
      else {
        const c = cleanText(cell);
        elements[elKey] = c === '1' ? 1 : (c === '0' ? 0 : '-');
      }
    }

    list.push({
      expertName,
      score: (typeof score === 'number') ? score : null,
      redline: (redline === 1 || redline === 0) ? redline : 0,
      redlineReason,
      leadName: r['lead_name'] || r['Lead Name'] || 'نامشخص',
      leadPhone: r['lead_phone'] || r['Lead Phone'] || 'نامشخص',
      listeningTime: lsKey ? cleanText(r[lsKey]) || '-' : '-',
      qcComment: r['QC comment'] || r['QC_comment'] || r['کامنت'] || '',
      reviewDate: (dateKey ? cleanQcDate(r[dateKey]) : null) || '',
      formType: type,
      elements
    });
  }
  return list;
}

/* ---------- تشخیص نوع فایل اکسل از روی نام ---------- */
function formTypeOfFileName(name) {
  const n = String(name || '').toLowerCase();
  if (n.includes('mlm') || n.includes('bnpl')) return 'mlm';
  if (n.includes('account') || n.includes('acc')) return 'account';
  if (n.includes('tele') || n.includes('telesales') || n.includes('تلفن')) return 'tele';
  return null;
}

/* ---------- تشخیص نوع فرم از روی محتوای ستون‌ها (وقتی نام فایل گویا نیست) ---------- */
/* rows: خروجی sheet_to_json. با شمردن تطابق ستون‌های معیار هر تیم، بهترین نوع برگردانده می‌شود.
 * حداقل ۲ تطابق لازم است تا نتیجه معتبر باشد. */
function sniffFormType(rows) {
  if (!Array.isArray(rows) || !rows.length) return null;
  const keys = new Set();
  for (const r of rows.slice(0, 12)) {
    if (r && typeof r === 'object') Object.keys(r).forEach((k) => keys.add(String(k).trim().toLowerCase()));
  }
  const cnt = (list) => list.filter((k) => keys.has(String(k).toLowerCase())).length;
  const scores = [
    ['tele', cnt(TELE_CRITERIA)],
    ['account', cnt(ACCOUNT_CRITERIA)],
    ['mlm', cnt(MLM_CRITERIA)]
  ].sort((a, b) => b[1] - a[1]);
  return scores[0][1] >= 2 ? scores[0][0] : null;
}

/* ---------- نرمال‌سازی نام برای تطبیق کارشناس (فاصله‌ها یکدست) ---------- */
function normName(s) { return String(s || '').replace(/[\s‌]+/g, ' ').trim(); }

/* دیکشنری برحسب نوع — منبع واحد برای تحلیل‌ها */
function criteriaFor(type) {
  return type === 'tele' ? TELE_CRITERIA : (type === 'mlm' ? MLM_CRITERIA : ACCOUNT_CRITERIA);
}
function criteriaLabelsFor(type) {
  return type === 'tele' ? CRITERIA_LABELS.tele : (type === 'mlm' ? CRITERIA_LABELS.mlm : CRITERIA_LABELS.account);
}
/* برچسب فارسی معیار با fallback به خود کلید */
function labelOf(type, key) {
  return (CRITERIA_LABELS[type] && CRITERIA_LABELS[type][key]) || key;
}

return {
  anyToJalali, parseRows, formTypeOfFileName, sniffFormType, normName, isRedline,
  criteriaFor, criteriaLabelsFor, labelOf,
  TELE_CRITERIA, ACCOUNT_CRITERIA, MLM_CRITERIA, CRITERIA_LABELS
};
});
