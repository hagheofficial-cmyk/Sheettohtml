/* =========================================================================
 * elements.js — نگاشت المان‌ها بین پیکربندی JSON و تب تخت `Elements` (بند ۹)
 *
 * تب Elements روی شیت یک ردیف برای هر المان دارد تا مستقیم قابل ویرایش باشد:
 *   scope   form | team     (form = تعریف پیش‌فرض کل فرم، team = فقط همان تیم)
 *   team    نام تیم (برای scope=team)
 *   form    نوع فرم: tele | account | mlm
 *   key     شناسه‌ی پایدار المان (هرگز تغییر نکند؛ تاریخچه به آن وابسته است)
 *   label   نام فارسی المان (در سامانه دیده می‌شود)
 *   excelKey نام ستون در فایل اکسل دریافتی (برای نگاشت خودکار هنگام import)
 *   active  1/0
 *   aliases ستون‌های قدیمی/جایگزین، جداشده با «|»
 *   order   ترتیب نمایش
 *
 * قاعده‌ی ادغام: هر scope که در تب ردیف دارد، کاملاً با ردیف‌های همان scope
 * تعریف می‌شود؛ scope‌های بدون ردیف از پیکربندی قبلی دست‌نخورده می‌مانند.
 * اگر excelKey روی شیت عوض شود، مقدار قبلی خودکار به aliases اضافه می‌شود تا
 * نمره‌های تاریخی از دست نروند.
 * ========================================================================= */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./parseQc'));
  else root.QCElements = factory(root.QCParse);
})(typeof self !== 'undefined' ? self : this, function (P) {
'use strict';

const text = (v) => (v == null ? '' : String(v).trim());
const clone = (o) => (o == null ? o : JSON.parse(JSON.stringify(o)));
const truthy = (v) => v === undefined || v === null || v === '' ? true : /^(1|true|yes|y|on|فعال|بله)$/i.test(text(v));

function aliasesOf(value) {
  return text(value).split(/[|،,;؛\n\r\t]+/).map(text).filter(Boolean);
}

function emptyConfig() { return { version: 0, forms: {}, teams: {} }; }

/* پیکربندی → ردیف‌های تخت (برای نوشتن روی تب). */
function criteriaToRows(cfg) {
  const config = cfg || emptyConfig();
  const rows = [];
  let order = 0;
  Object.keys(config.forms || {}).forEach((form) => {
    (config.forms[form] || []).forEach((d) => {
      rows.push({ scope: 'form', team: '', form: form, key: text(d.key), label: text(d.label),
        excelKey: text(d.excelKey), active: d.active !== false ? 1 : 0,
        aliases: (d.aliases || []).join('|'), order: ++order });
    });
  });
  Object.keys(config.teams || {}).forEach((id) => {
    const entry = config.teams[id] || {};
    (entry.elements || []).forEach((d) => {
      rows.push({ scope: 'team', team: text(entry.team), form: text(entry.form), key: text(d.key),
        label: text(d.label), excelKey: text(d.excelKey), active: d.active !== false ? 1 : 0,
        aliases: (d.aliases || []).join('|'), order: ++order });
    });
  });
  return rows;
}

function teamId(team) { return P && P.teamKey ? P.teamKey(team) : text(team).toLowerCase().replace(/[\s_/-]/g, ''); }

function definitionsFrom(rows) {
  return rows.map((r) => ({
    key: text(r.key),
    label: text(r.label),
    excelKey: text(r.excelKey),
    active: truthy(r.active),
    aliases: aliasesOf(r.aliases)
  })).filter((d) => d.key);
}

/* ردیف‌های تخت → پیکربندی (برای خواندن از تب؛ base پیکربندی قبلی است). */
function rowsToCriteria(rows, base) {
  const cfg = clone(base) || emptyConfig();
  cfg.forms = cfg.forms || {}; cfg.teams = cfg.teams || {};
  const list = (rows || []).filter((r) => text(r.key));
  if (!list.length) return cfg;

  const previousElement = (scopeTeam, form, key) => {
    const source = scopeTeam ? (cfg.teams[teamId(scopeTeam)] || {}).elements : cfg.forms[form];
    return (source || []).find((d) => d.key === key) || null;
  };

  const merged = (r) => {
    const before = previousElement(text(r.team), text(r.form), text(r.key));
    const aliases = new Set(aliasesOf(r.aliases).concat((before && before.aliases) || []));
    const excelKey = text(r.excelKey);
    if (before && text(before.excelKey) && text(before.excelKey) !== excelKey) aliases.add(text(before.excelKey));
    aliases.delete(excelKey);
    return { key: text(r.key), label: text(r.label) || (before && before.label) || text(r.key),
      excelKey: excelKey || (before && before.excelKey) || '', active: truthy(r.active), aliases: Array.from(aliases) };
  };

  const formRows = new Map(), teamRows = new Map();
  list.slice().sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0)).forEach((r) => {
    const scope = /^team/i.test(text(r.scope)) ? 'team' : 'form';
    if (scope === 'team') {
      const id = teamId(r.team);
      if (!id) return;
      if (!teamRows.has(id)) teamRows.set(id, { team: text(r.team), form: text(r.form), elements: [] });
      const entry = teamRows.get(id);
      if (!entry.form) entry.form = text(r.form);
      entry.elements.push(merged(r));
    } else {
      const form = text(r.form);
      if (!form) return;
      if (!formRows.has(form)) formRows.set(form, []);
      formRows.get(form).push(merged(r));
    }
  });

  formRows.forEach((elements, form) => { if (elements.length) cfg.forms[form] = elements; });
  teamRows.forEach((entry, id) => { if (entry.elements.length) cfg.teams[id] = entry; });
  return cfg;
}

/* جدول تخت برای نمایش در سامانه (هر ردیف = یک المان). */
function table(cfg, teams) {
  const rows = criteriaToRows(cfg);
  return { rows: rows, teams: (teams || []).slice(), version: Number((cfg || {}).version || 0) };
}

return {
  criteriaToRows: criteriaToRows, rowsToCriteria: rowsToCriteria, table: table,
  aliasesOf: aliasesOf, emptyConfig: emptyConfig, teamId: teamId
};
});
