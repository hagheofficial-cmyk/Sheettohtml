/* =========================================================================
 * parseQc.js — پارسر مشترک فرم‌های QC تماس (tele/account/mlm)
 * منطق دقیقاً منطبق بر parseRows پنل دستیار ریت QC است؛
 * کوتیشن‌های اضافی پاک می‌شوند، تاریخ‌های Excel/ISO/شمسی همه به شمسی تبدیل می‌شوند.
 * UMD: مرورگر (window.QCParse) و Node (require) هر دو.
 * ========================================================================= */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./calc.js'));
  else root.QCParse = factory(root.QCCalc);
})(typeof self !== 'undefined' ? self : this, function (C) {
'use strict';

/* ---------- دیکشنری مفصل (هم‌نام پنل — استخراج مستقیم از پنل دستیار ریت QC) ---------- */
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
/* redline به شکل‌های مختلف: 1 | '1' | '\"1\"' | '1.0' | true */
function isRedline(v) { return C.normalizeTri(v) === 1; }
function cleanText(val) {
  if (val === undefined || val === null) return '';
  return String(val).replace(/["']/g, '').trim();
}

/* ---------- تبدیل هر نوع تاریخ به اجزای جلالی ---------- */
/* ورودی: عدد اکسل (میلادی، مثل 46259.49)، رشته ISO/میلادی، رشته شمسی '1405/06/03'
 * خروجی: {jy,jm,jd} یا null */
function anyToJalali(v) { return C.parseDate(v); }
function cleanQcDate(v) { const j = anyToJalali(v); return j ? C.formatJalali(j) : ''; }

/* ---------- تشخیص کلیدها (case-insensitive, بدون فاصله) ---------- */
function findKey(row, candidates) {
  const keys = Object.keys(row);
  const norm = (k) => k.trim().toLowerCase();
  // ترتیب candidates مهم است؛ ترتیب ستون‌های فایل نباید تاریخ بررسی را عوض کند.
  for (const candidate of candidates) {
    const key = keys.find((k) => norm(k) === candidate);
    if (key != null) return key;
  }
  return null;
}

/* ---------- پارس ردیف‌های یک فرم (دقیقاً منطق پنل به‌علاوه‌ی تبدیل تاریخ) ---------- */
/* rows: آرایه‌ی آبجکت‌های JSON از SheetJS (sheet_to_json)
 * type: 'tele' | 'account' | 'mlm'
 * خروجی: [{expertName, score, redline, redlineReason, leadName, leadPhone,
 *          listeningTime, qcComment, reviewDate, formType, elements}] */
function parseRows(rows, type, options) {
  options = options || {};
  const mappingRef = type === 'tele' ? TELE_CRITERIA : (type === 'mlm' ? MLM_CRITERIA : ACCOUNT_CRITERIA);
  const dt = ['review_date', 'reviewdate', 'تاریخ بررسی', 'form_created_date', 'form created date', 'action_date', 'action date'];
  const list = [];
  for (const [index, r] of (rows || []).entries()) {
    const nameKey = findKey(r, ['tele_expert_name', 'expert_name', 'expertname']);
    const rawName = nameKey ? normName(String(r[nameKey] == null ? '' : r[nameKey]).trim().replace(/^(["'])(.*)\1$/, '$2')) : '';
    const resolved = resolveExpert(options.agents || [], rawName);
    const expertName = resolved.agent ? resolved.agent.name : rawName;
    if (!expertName) continue;

    const scoreKey = findKey(r, ['score']);
    const redlineKey = findKey(r, ['red_line', 'red line']);
    const redlineReasonKey = findKey(r, ['red_line_reason', 'red line reason', 'علت ردلاین', 'علت خط قرمز']);
    const lsKey = findKey(r, ['listening time (second)', 'listening_time_(second)', 'listening_time_second', 'listening_time']);
    // تاریخ بررسیِ غیرخالی ولی نامعتبر را با تاریخ تماس جایگزین نکنیم.
    const reviewKey = dt.slice(0, -2).map((key) => findKey(r, [key])).find((key) => key != null && cleanText(r[key]) !== '');
    const dateKey = reviewKey != null ? reviewKey : findKey(r, ['action_date', 'action date']);
    const actionDateKey = findKey(r, ['action_date', 'action date']);
    const qcKey = findKey(r, ['qc_expert_name', 'qc_agent', 'qcagent']);
    const leadKey = findKey(r, ['lead_name', 'lead name']);
    const phoneKey = findKey(r, ['lead_phone', 'lead phone']);
    const commentKey = findKey(r, ['qc comment', 'qc_comment', 'کامنت']);
    const durationKey = findKey(r, ['call_duration', 'call duration', 'call_duration_second', 'call_duration (second)', 'conversation_time', 'talk_time', 'مدت مکالمه', 'تایم مکالمه']);
    const idKey = findKey(r, ['evaluation_id', 'form_id', 'call_id']);

    const score = C.normalizeScore(scoreKey ? r[scoreKey] : null);
    const redline = isRedline(redlineKey ? r[redlineKey] : null) ? 1 : 0;
    const redlineReason = redlineReasonKey ? cleanText(r[redlineReasonKey]) : '';

    const teamColumn = findKey(r, ['team', 'team_name', 'تیم']);
    const team = resolved.agent ? resolved.agent.team : (teamColumn ? cleanText(r[teamColumn]) : options.team || '');
    const defs = definitionsFor(type, team, options.criteria);
    const configured = hasConfiguration(type, team, options.criteria);
    const elements = {};
    for (const definition of defs) {
      const elKey = definition.key;
      let cell = undefined;
      for (const column of [definition.excelKey].concat(definition.aliases || [])) {
        const actual = Object.keys(r).find(k => columnKey(k) === columnKey(column));
        if (actual != null) { cell = r[actual]; break; }
      }
      // ستون غایب را به فرم اضافه نکن؛ سلول خالی با «-» صریح فرق دارد.
      if (cell !== undefined) elements[elKey] = C.normalizeTri(cell);
    }

    const parsed = {
      expertName,
      score,
      redline: (redline === 1 || redline === 0) ? redline : 0,
      redlineReason,
      leadName: leadKey ? cleanText(r[leadKey]) : '',
      leadPhone: phoneKey ? cleanText(r[phoneKey]) : '',
      listeningTime: lsKey ? cleanText(r[lsKey]) || '-' : '-',
      callDuration: durationKey ? cleanText(r[durationKey]) : '',
      qcAgent: qcKey ? normName(cleanText(r[qcKey])) : '',
      qcComment: commentKey ? cleanText(r[commentKey]) : '',
      reviewDate: dateKey ? cleanQcDate(r[dateKey]) : '',
      callDate: actionDateKey ? cleanQcDate(r[actionDateKey]) : '',
      sourceRow: index + 2,
      evaluationId: idKey ? cleanText(r[idKey]) : '',
      formType: type,
      elements
    };
    if (team) parsed.team = team;
    if (rawName !== expertName) parsed.sourceExpertName = rawName;
    if (configured) { parsed.criteriaVersion = Number((options.criteria || {}).version) || 1; parsed.criteriaSnapshot = defs.map(d => ({ key: d.key, label: d.label, excelKey: d.excelKey, active: d.active !== false })); }
    list.push(parsed);
  }
  return list;
}

/* هویت ردیف از فایل، نه ترکیب کارشناس/تلفن/روز: دو تماس یک روز حذف نشوند.
 * رکورد قدیمی بدون شناسه را نمی‌توان با اطمینان تکراری اعلام کرد. */
function callRowKey(row) {
  if (!row.sourceFile) return null;
  const identity = row.sourceRow != null ? 'row:' + row.sourceRow : (row.evaluationId ? 'id:' + row.evaluationId : '');
  return identity ? JSON.stringify([row.sourceFile, row.formType, identity, cleanQcDate(row.reviewDate) || String(row.reviewDate || ''), nameKeyOf(row.expertName), String(row.leadPhone || ''), cleanQcDate(row.callDate) || String(row.callDate || '')]) : null;
}

/* ---------- تشخیص نوع فایل اکسل از روی نام ---------- */
function formTypeOfFileName(name) {
  const n = String(name || '').toLowerCase();
  if (n.includes('mlm') || n.includes('bnpl')) return 'mlm';
  if (n.includes('account') || n.includes('acc') || n.includes('اکانت')) return 'account';
  if (n.includes('tele') || n.includes('telesales') || n.includes('تلفن')) return 'tele';
  return null;
}

/* ---------- تشخیص نوع فرم از روی محتوای ستون‌ها (وقتی نام فایل گویا نیست) ---------- */
/* rows: خروجی sheet_to_json. با شمردن تطابق ستون‌های معیار هر تیم، بهترین نوع برگردانده می‌شود.
 * حداقل ۲ تطابق لازم است تا نتیجه معتبر باشد. */
function sniffFormType(rows, config) {
  if (!Array.isArray(rows) || !rows.length) return null;
  const keys = new Set();
  for (const r of rows.slice(0, 12)) {
    if (r && typeof r === 'object') Object.keys(r).forEach((k) => keys.add(String(k).trim().toLowerCase()));
  }
  function columns(type) {
    let definitions = defaults(type);
    if (config && config.forms && config.forms[type]) definitions = definitions.concat(config.forms[type]);
    Object.values(config && config.teams || {}).filter(e => e.form === type).forEach(e => { definitions = definitions.concat(e.elements); });
    return [...new Set(definitions.flatMap(d => [d.excelKey].concat(d.aliases || [])).map(k => columnKey(k)))];
  }
  const cnt = list => list.filter(k => keys.has(columnKey(k))).length;
  const scores = [
    ['tele', cnt(columns('tele'))],
    ['account', cnt(columns('account'))],
    ['mlm', cnt(columns('mlm'))]
  ].sort((a, b) => b[1] - a[1]);
  return scores[0][1] >= 2 && scores[0][1] > scores[1][1] ? scores[0][0] : null;
}

/* ---------- نرمال‌سازی نام برای تطبیق کارشناس (فاصله‌ها یکدست) ---------- */
function normName(s) { return String(s == null ? '' : s).normalize('NFKC').replace(/[يى]/g, 'ی').replace(/ك/g, 'ک').replace(/[\u064B-\u065F\u0670]/g, '').replace(/[\s‌‍]+/g, ' ').trim(); }

/* تعریف المان‌ها با شناسه‌ی پایدار: تغییر نام/ستون هیچ نمره‌ی تاریخی را بازنویسی نمی‌کند. */
let browserConfig = null;
function nameKeyOf(s) { return normName(s).toLowerCase().replace(/\s/g, ''); }
function teamKey(s) { return normName(s).toLowerCase().replace(/[\s_/-]/g, ''); }
function columnKey(s) { return normName(s).toLowerCase(); }
function teamForm(s) {
  const t = teamKey(s);
  if (/^tele(?:sales)?$|تلهسلز|تلفن|تلفنی/.test(t)) return 'tele';
  if (/^(?:account|acc|اکانت)$/.test(t)) return 'account';
  if (/^(?:mlm|امالام|bnpl|mlmbnpl)$/.test(t)) return 'mlm';
  return null;
}
function displayTeam(s) { return teamForm(s) === 'tele' ? 'Telesales' : String(s || ''); }
/* تطبیق نام کارشناس با کش: گزارش‌ها برای هر ردیف نام را resolve می‌کنند و
 * بدون کش، فیلتر یک کارشناس روی چند هزار ردیف × ده‌ها نام، چند ثانیه طول می‌کشید.
 * کش به «همان آرایه‌ی agents» گره خورده و با تغییر تعداد عضو یا صریحاً با
 * clearResolveCache() پاک می‌شود. */
let resolveCacheAgents = null, resolveCacheSize = -1, resolveCache = new Map();
function clearResolveCache() { resolveCacheAgents = null; resolveCacheSize = -1; resolveCache = new Map(); }
function resolveExpert(agents, rawName) {
  const name = normName(rawName);
  if (!name) return { agent: null, ambiguous: false };
  const list = agents || [];
  if (resolveCacheAgents !== list || resolveCacheSize !== list.length) {
    resolveCacheAgents = list; resolveCacheSize = list.length; resolveCache = new Map();
  }
  const key = nameKeyOf(name);
  const hit = resolveCache.get(key);
  if (hit) return hit;
  const exact = list.filter(a => a.name === String(rawName).trim());
  let result;
  if (exact.length === 1) {
    result = { agent: exact[0], ambiguous: false };
  } else {
    const matches = list.filter(a => [a.name].concat(a.aliases || []).some(n => nameKeyOf(n) === key));
    result = { agent: matches.length === 1 ? matches[0] : null, ambiguous: matches.length > 1 };
  }
  resolveCache.set(key, result);
  return result;
}
function defaults(type) {
  const keys = type === 'tele' ? TELE_CRITERIA : type === 'mlm' ? MLM_CRITERIA : ACCOUNT_CRITERIA;
  return keys.map(key => ({ key, label: (CRITERIA_LABELS[type] || {})[key] || key, excelKey: key, active: true }));
}
function hasConfiguration(type, team, cfg) {
  cfg = cfg === undefined ? browserConfig : cfg;
  const entry = cfg && cfg.teams && cfg.teams[teamKey(team)];
  return !!(entry && entry.form === type || cfg && cfg.forms && Array.isArray(cfg.forms[type]));
}
function definitionsFor(type, team, cfg) {
  cfg = cfg === undefined ? browserConfig : cfg;
  const entry = cfg && cfg.teams && cfg.teams[teamKey(team)];
  if (entry && entry.form === type && Array.isArray(entry.elements)) return entry.elements;
  if (cfg && cfg.forms && Array.isArray(cfg.forms[type])) return cfg.forms[type];
  return defaults(type);
}
function criteriaFor(type, team, cfg) { return definitionsFor(type, team, cfg).filter(d => d.active !== false).map(d => d.key); }
function criteriaLabelsFor(type, team, cfg) { return Object.fromEntries(definitionsFor(type, team, cfg).map(d => [d.key, d.label])); }
function labelOf(type, key, team, cfg) { const def = definitionsFor(type, team, cfg).find(d => d.key === key); return def ? def.label : (CRITERIA_LABELS[type] || {})[key] || key; }
function validateConfig(cfg) {
  function invalid(m) { const e = new Error(m); e.status = 400; throw e; }
  if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) invalid('تنظیمات المان‌ها نامعتبر است');
  function check(defs) {
    if (!Array.isArray(defs) || defs.length > 100) invalid('هر تیم حداکثر ۱۰۰ المان دارد');
    const ids = new Set(), columns = new Set();
    defs.forEach(d => {
      if (!d || !/^[A-Za-z0-9_-]{1,96}$/.test(d.key || '') || ['__proto__','constructor','prototype'].includes(d.key)) invalid('شناسه‌ی المان نامعتبر است');
      if (ids.has(d.key)) invalid('شناسه‌ی المان تکراری است'); ids.add(d.key);
      if (!String(d.label || '').trim() || !String(d.excelKey || '').trim() || String(d.label).length > 180 || String(d.excelKey).length > 180) invalid('نام المان و ستون اکسل را کامل وارد کنید');
      if (d.active !== false) {
        const field = columnKey(d.excelKey);
        if (columns.has(field)) invalid('نام ستون اکسل تکراری است'); columns.add(field);
      }
      if (d.aliases && (!Array.isArray(d.aliases) || d.aliases.some(a => typeof a !== 'string'))) invalid('نام قبلی ستون نامعتبر است');
    });

  }
  Object.keys(cfg.forms || {}).forEach(form => { if (!['tele','account','mlm'].includes(form)) invalid('نوع فرم نامعتبر است'); check(cfg.forms[form]); });
  if (Object.keys(cfg.teams || {}).length > 200) invalid('تعداد تیم‌ها بیش از حد است');
  Object.keys(cfg.teams || {}).forEach(key => {
    if (['__proto__','constructor','prototype'].includes(key)) invalid('کلید تیم نامعتبر است');
    const entry = cfg.teams[key];
    if (!entry || !['tele','account','mlm'].includes(entry.form)) invalid('نوع فرم تیم را مشخص کنید'); check(entry.elements);
  });
  return cfg;
}
function saveTeamConfig(current, body) {
  const cfg = JSON.parse(JSON.stringify(current || { version: 0, forms: {}, teams: {} }));
  if (body.version !== undefined && Number(body.version) !== Number(cfg.version || 0)) { const e = new Error('تنظیمات هم‌زمان تغییر کرده است؛ تازه‌سازی کنید'); e.status = 409; throw e; }
  const isForm = !body.team;
  const old = definitionsFor(body.form, body.team, cfg);
  if(!Array.isArray(body.elements)){const e=new Error('لیست المان‌ها نامعتبر است');e.status=400;throw e;}
  const incoming = body.elements.map(d => {
    const previous = old.find(x => x.key === d.key);
    const aliases = new Set((previous && previous.aliases || []).concat(d.aliases || []));
    if (previous && previous.excelKey !== d.excelKey) aliases.add(previous.excelKey);
    aliases.delete(d.excelKey);
    return { key: String(d.key || ''), label: String(d.label || '').trim(), excelKey: String(d.excelKey || '').trim(), active: d.active !== false, aliases: Array.from(aliases) };
  });
  const nextIds = new Set(incoming.map(d => d.key));
  old.filter(d => !nextIds.has(d.key)).forEach(d => incoming.push(Object.assign({}, d, { active: false })));
  cfg.forms = cfg.forms || {}; cfg.teams = cfg.teams || {};
  if (isForm) cfg.forms[body.form] = incoming;
  else cfg.teams[teamKey(body.team)] = { team: String(body.team).trim(), form: body.form, elements: incoming };
  validateConfig(cfg); cfg.version = Number(cfg.version || 0) + 1;
  return cfg;
}
function resolver(config) {
  return { config: config || null,
    criteriaFor: (type, team) => criteriaFor(type, team, config || null),
    definitionsFor: (type, team) => definitionsFor(type, team, config || null),
    configured: (type, team) => hasConfiguration(type, team, config || null),
    elementValue: (row,key) => elementValue(row,key,config || null),
    labelOf: (type, key, team) => labelOf(type, key, team, config || null) };
}
function elementValue(row, key, cfg) {
  const elements = row.elements || {};
  if (Object.prototype.hasOwnProperty.call(elements, key)) return C.normalizeTri(elements[key]);
  const def = definitionsFor(row.formType, row.criteriaTeam || row.team, cfg).find(d => d.key === key);
  if (!def) return '';
  for (const column of [def.excelKey].concat(def.aliases || [])) {
    const found = Object.keys(elements).find(k => columnKey(k) === columnKey(column));
    if (found != null) return C.normalizeTri(elements[found]);
  }
  return '';
}
function importDiagnostics(rows, agents) {
  const missing = new Map(), conflicts = new Map(); let ambiguous = 0;
  (rows || []).forEach(row => {
    const found = resolveExpert(agents, row.expertName);
    if (found.ambiguous) ambiguous++;
    if (!found.agent) {
      const entry = missing.get(row.expertName) || { name: row.expertName, count: 0, forms: [] };
      entry.count++; if (!entry.forms.includes(row.formType)) entry.forms.push(row.formType); missing.set(row.expertName, entry);
    } else if (teamForm(found.agent.team) && teamForm(found.agent.team) !== row.formType) {
      const key = found.agent.name + ':' + row.formType;
      const entry = conflicts.get(key) || { name: found.agent.name, team: found.agent.team, form: row.formType, count: 0 };
      entry.count++; conflicts.set(key, entry);
    }
  });
  return { unknownExperts: Array.from(missing.values()), teamConflicts: Array.from(conflicts.values()), ambiguous };
}

return {
  clearResolveCache: clearResolveCache,
  PARSER_VERSION: 3, anyToJalali, parseRows, formTypeOfFileName, sniffFormType, normName, isRedline, callRowKey,
  criteriaFor, criteriaLabelsFor, labelOf, definitionsFor, defaults, resolver, validateConfig, saveTeamConfig, hasConfiguration,
  elementValue, teamKey, teamForm, displayTeam, nameKey: nameKeyOf, resolveExpert, importDiagnostics, setConfig: cfg => { browserConfig = cfg || null; },
  TELE_CRITERIA, ACCOUNT_CRITERIA, MLM_CRITERIA, CRITERIA_LABELS
};
});
