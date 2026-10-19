/* =========================================================================
 * fiscal.js — ماه‌های مالی و خلاصه‌ی ماهانه‌ی آماده (بند ۲ و ۸)
 *
 * ماه‌های مالی در تب `Fiscal_Months` شیت نوشته می‌شوند:
 *   name  نام ماه مالی (مثلاً «مهر ۱۴۰۵» یا «دوره ۰۷»)
 *   from  تاریخ شروع (جلالی، مثل 1405/07/01)
 *   to    تاریخ پایان (جلالی)
 * چون منبع داده خودِ شیت است، تاریخ‌ها را می‌توان مستقیم روی شیت ویرایش کرد؛
 * سامانه در هر بار خواندن آن‌ها را به «بازه آماده» تبدیل می‌کند.
 *
 * خلاصه‌ی ماهانه (تب `Monthly_Summary`) همان اعدادی است که گزارش‌ها می‌سازند،
 * اما از قبل محاسبه و روی شیت نوشته شده‌اند تا بررسی/خروجی گرفتن سریع باشد.
 * ========================================================================= */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./calc'));
  else root.QCFiscal = factory(root.QCCalc);
})(typeof self !== 'undefined' ? self : this, function (C) {
'use strict';

const text = (v) => (v == null ? '' : String(v).trim());
const avg = (nums) => {
  const list = (nums || []).map(Number).filter((n) => !isNaN(n));
  return list.length ? Math.round((list.reduce((a, b) => a + b, 0) / list.length) * 100) / 100 : '';
};

function monthOf(value) {
  const j = C.parseDate(value);
  if (!j) return null;
  return { jy: j.jy, jm: j.jm, key: j.jy + '/' + ('0' + j.jm).slice(-2), label: C.jalaliMonthLabel(j.jy, j.jm) };
}

/* ------------------------------------------------------------- ماه مالی */
function normalizeMonths(rows) {
  const out = [];
  (rows || []).forEach((row, i) => {
    const from = C.parseDate(row && row.from), to = C.parseDate(row && row.to);
    if (!from || !to) return;
    if (C.jalaliCmp(from, to) > 0) return; // بازه‌ی وارونه نادیده گرفته می‌شود
    const name = text(row.name) || C.jalaliMonthLabel(from.jy, from.jm);
    out.push({
      id: text(row.id) || 'fm' + (i + 1),
      name: name,
      from: C.formatJalali(from),
      to: C.formatJalali(to),
      note: text(row.note)
    });
  });
  out.sort((a, b) => C.jalaliCmp(C.parseDate(a.from), C.parseDate(b.from)) || C.jalaliCmp(C.parseDate(a.to), C.parseDate(b.to)));
  return out;
}

function monthById(months, id) {
  return (months || []).find((m) => m.id === text(id)) || null;
}

function monthOfDate(months, date) {
  const j = C.parseDate(date || C.todayJalali());
  if (!j) return null;
  return (months || []).find((m) => C.jalaliInRange(j, C.parseDate(m.from), C.parseDate(m.to))) || null;
}

function currentIndex(months, today) {
  const list = months || [];
  const hit = monthOfDate(list, today);
  if (hit) return list.indexOf(hit);
  const t = C.parseDate(today || C.todayJalali());
  let idx = -1;
  list.forEach((m, i) => { if (t && C.jalaliCmp(C.parseDate(m.from), t) <= 0) idx = i; });
  return idx >= 0 ? idx : (list.length ? 0 : -1);
}

function currentMonth(months, today) {
  const i = currentIndex(months, today);
  return i < 0 ? null : months[i];
}

function previousMonth(months, today) {
  const i = currentIndex(months, today);
  if (i < 0) return null;
  return months[i - 1] || null;
}

/* مقدار «بازه آماده» → بازه‌ی واقعی. کلیدها: fm:cur | fm:prev | fm:<id> */
function presetRange(months, preset, today) {
  const list = months || [];
  if (!list.length || !/^fm:/.test(text(preset))) return null;
  const id = text(preset).slice(3);
  const month = id === 'cur' ? currentMonth(list, today) : id === 'prev' ? previousMonth(list, today) : monthById(list, id);
  return month ? { from: month.from, to: month.to, preset: preset } : null;
}

function isFiscalPreset(preset) { return /^fm:/.test(text(preset)); }

/* گزینه‌های dropdown (با برچسب فارسی و بازه‌ی readable). */
function presetOptions(months, today) {
  const list = normalizeMonths(months);
  if (!list.length) return [];
  const cur = currentMonth(list, today), prev = previousMonth(list, today);
  const span = (m) => m ? m.from + ' تا ' + m.to : '';
  const options = [];
  if (cur) options.push({ value: 'fm:cur', label: 'ماه مالی جاری — ' + cur.name, group: 'ماه مالی', hint: span(cur) });
  if (prev) options.push({ value: 'fm:prev', label: 'ماه مالی قبل — ' + prev.name, group: 'ماه مالی', hint: span(prev) });
  list.slice().reverse().forEach((m) => {
    options.push({ value: 'fm:' + m.id, label: m.name, group: 'همه ماه‌های مالی', hint: span(m) });
  });
  return options;
}

function labelFor(months, date) {
  const m = monthOfDate(months, date);
  return m ? m.name : '';
}

/* ------------------------------------------------------- خلاصه‌ی ماهانه */
function redlineOf(row, kind) {
  if (kind === 'call') return !!(row && row.redline);
  if (kind === 'social') return false;
  return !!(row && row.redline);
}

function monthlySummary(db, opts) {
  const o = opts || {};
  const from = o.from ? C.parseDate(o.from) : null;
  const to = o.to ? C.parseDate(o.to) : null;
  const months = normalizeMonths(db && db.fiscalMonths);
  const agents = (db && db.agents) || [];
  const groups = new Map();

  function ensure(month, name, team) {
    const key = month.key + '|' + name;
    if (!groups.has(key)) {
      const agent = agents.find((a) => a.name === name) || null;
      groups.set(key, {
        month: month.key, monthLabel: month.label, fiscal: labelFor(months, month.key + '/01'),
        agent: name, ext: agent ? text(agent.ext) : '', team: text(team || (agent && agent.team) || ''),
        ticketScores: [], socialScores: [], callScores: [],
        ticketRedline: 0, socialRedline: 0, callRedline: 0,
        qc: new Set(), actions: 0
      });
    }
    return groups.get(key);
  }

  function inRange(row) {
    const j = C.parseDate(row && row.reviewDate);
    if (!j) return null;
    if (from && C.jalaliCmp(j, from) < 0) return null;
    if (to && C.jalaliCmp(j, to) > 0) return null;
    return monthOf(row.reviewDate);
  }

  ((db && db.tickets) || []).forEach((r) => {
    const m = inRange(r); const name = text(r.agentName);
    if (!m || !name) return;
    const g = ensure(m, name, r.team);
    if (r.score !== '' && r.score != null) g.ticketScores.push(Number(r.score));
    if (redlineOf(r, 'ticket')) g.ticketRedline++;
    if (text(r.qcAgent)) g.qc.add(text(r.qcAgent));
  });
  ((db && db.socials) || []).forEach((r) => {
    const m = inRange(r); const name = text(r.agentName);
    if (!m || !name) return;
    const g = ensure(m, name, r.team);
    if (r.score !== '' && r.score != null) g.socialScores.push(Number(r.score));
    if (text(r.qcAgent)) g.qc.add(text(r.qcAgent));
  });
  ((db && db.callFeedbacks) || []).forEach((r) => {
    const m = inRange(r); const name = text(r.expertName);
    if (!m || !name) return;
    const g = ensure(m, name, r.team);
    if (r.score !== '' && r.score != null) g.callScores.push(Number(r.score));
    if (redlineOf(r, 'call')) g.callRedline++;
    if (text(r.qcAgent)) g.qc.add(text(r.qcAgent));
  });
  Object.keys((db && db.agentActions) || {}).forEach((name) => {
    (((db && db.agentActions) || {})[name] || []).forEach((a) => {
      const m = monthOf(a && a.date);
      if (!m) return;
      if (from && C.jalaliCmp(C.parseDate(a.date), from) < 0) return;
      if (to && C.jalaliCmp(C.parseDate(a.date), to) > 0) return;
      ensure(m, text(name), '').actions++;
    });
  });

  const rows = Array.from(groups.values()).map((g) => {
    const all = g.ticketScores.concat(g.socialScores, g.callScores);
    return {
      month: g.month, monthLabel: g.monthLabel, fiscal: g.fiscal,
      agent: g.agent, ext: g.ext, team: g.team,
      qcAgents: Array.from(g.qc).join('، '),
      tickets: g.ticketScores.length, ticketAvg: avg(g.ticketScores), ticketRedline: g.ticketRedline,
      socials: g.socialScores.length, socialAvg: avg(g.socialScores), socialRedline: g.socialRedline,
      calls: g.callScores.length, callAvg: avg(g.callScores), callRedline: g.callRedline,
      totalCount: all.length, combinedAvg: avg(all),
      redlines: g.ticketRedline + g.callRedline, actions: g.actions
    };
  }).sort((a, b) => (a.month < b.month ? 1 : a.month > b.month ? -1 : a.agent.localeCompare(b.agent, 'fa')));

  return {
    generatedAt: new Date().toISOString(),
    range: { from: from ? C.formatJalali(from) : '', to: to ? C.formatJalali(to) : '' },
    months: Array.from(new Set(rows.map((r) => r.month))).sort().reverse(),
    count: rows.length,
    rows: rows
  };
}

return {
  monthOf: monthOf, normalizeMonths: normalizeMonths, monthById: monthById, monthOfDate: monthOfDate,
  currentMonth: currentMonth, previousMonth: previousMonth, currentIndex: currentIndex,
  presetRange: presetRange, presetOptions: presetOptions, isFiscalPreset: isFiscalPreset,
  labelFor: labelFor, monthlySummary: monthlySummary
};
});
