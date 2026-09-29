/* =========================================================================
 * reports.js — موتور گزارش‌سازی مشترک (داشبورد، گزارش کارشناس/تیم)
 * معادل شیت‌های Agent Report و Team Report فایل اکسل.
 * هم در Node (سرور) و هم در مرورگر (نسخه standalone) قابل استفاده است.
 *
 * ورودی توابع: data = { tickets: [], socials: [], agents: [] }
 * ========================================================================= */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./calc.js'));
  else root.QCReports = factory(root.QCCalc);
})(typeof self !== 'undefined' ? self : this, function (C) {
  'use strict';

  /* ----------------------------------------------------------- ابزارها */
  function inRange(dateStr, from, to) {
    var j = C.parseJalali(dateStr);
    if (!j) return false;
    return C.jalaliInRange(j, from ? C.parseJalali(from) : null, to ? C.parseJalali(to) : null);
  }

  /** فیلتر مشترک ردیف‌ها: بازه تاریخ بررسی + تیم + کارشناس + QC */
  function filterRows(rows, q) {
    q = q || {};
    return rows.filter(function (r) {
      if (q.from || q.to) { if (!inRange(r.reviewDate, q.from, q.to)) return false; }
      if (q.team && r.team !== q.team) return false;
      if (q.agent && r.agentName !== q.agent) return false;
      if (q.qc && r.qcAgent !== q.qc) return false;
      return true;
    });
  }

  function scoredRows(rows) {
    return rows.filter(function (r) { return r.score != null && r.score >= 0 && r.score <= 100; });
  }

  function avgScore(rows) { return C.avg(scoredRows(rows).map(function (r) { return r.score; })); }
  function rateAll(rows, key) { return C.elementRate(rows.map(function (r) { return r[key]; })); }

  function teamOf(agents, name) {
    var a = agents.find(function (x) { return x.name === name; });
    return a ? a.team : '';
  }

  /* --------------------------------------------------- گزارش تیکت‌ها */
  function ticketReport(data, level, q) {
    var rows = filterRows(data.tickets, q);
    var group = level === 'team' ? function (r) { return r.team; } : function (r) { return r.agentName; };
    var names = Array.from(new Set(rows.map(group).filter(Boolean))).sort(function (a, b) { return a.localeCompare(b, 'fa'); });
    return names.map(function (name) {
      var rs = rows.filter(function (r) { return group(r) === name; });
      var agents = new Set(rs.map(function (r) { return r.agentName; })).size;
      var out = {
        name: name,
        team: level === 'team' ? name : teamOf(data.agents, name),
        count: scoredRows(rs).length,
        avgScore: avgScore(rs),
        q1Rate: rateAll(rs, 'q1'), q2Rate: rateAll(rs, 'q2'),
        q3Rate: rateAll(rs, 'q3'), q4Rate: rateAll(rs, 'q4'),
        redlineZero: rs.filter(function (r) { return r.score === 0 && String(r.redline) === '0'; }).length,
        total: rs.length
      };
      if (level === 'team') out.agentsEvaluated = agents;
      return out;
    });
  }

  /* --------------------------------------------------- گزارش سوشال‌ها */
  function socialReport(data, level, q) {
    var rows = filterRows(data.socials, q);
    var group = level === 'team' ? function (r) { return r.team; } : function (r) { return r.agentName; };
    var names = Array.from(new Set(rows.map(group).filter(Boolean))).sort(function (a, b) { return a.localeCompare(b, 'fa'); });
    var sla = function (rs, v) { return rs.filter(function (r) { return r.slaStatus === v; }).length; };
    return names.map(function (name) {
      var rs = rows.filter(function (r) { return group(r) === name; });
      var okS = sla(rs, 'رعایت شده'), badS = sla(rs, 'رعایت نشده');
      var agents = new Set(rs.map(function (r) { return r.agentName; })).size;
      var out = {
        name: name,
        team: level === 'team' ? name : teamOf(data.agents, name),
        count: scoredRows(rs).length,
        avgScore: avgScore(rs),
        answered: rs.filter(function (r) { return r.responseStatus === 'پاسخ داده شده'; }).length,
        slaReal: okS + badS === 0 ? '' : C.round2(100 * okS / (okS + badS)),
        qSlaRate: rateAll(rs, 'qSla'), qFollowRate: rateAll(rs, 'qFollow'),
        qClosingRate: rateAll(rs, 'qClosing'), qToneRate: rateAll(rs, 'qTone'),
        unanswered: rs.filter(function (r) { return r.responseStatus === 'عدم پاسخ'; }).length,
        slaMissed: badS,
        avgDurationMin: C.avg(rs.filter(function (r) { return r.durationMin != null; }).map(function (r) { return r.durationMin; })),
        total: rs.length
      };
      if (level === 'team') out.agentsEvaluated = agents;
      return out;
    });
  }

  /* -------------------------------------------------------- داشبورد */
  function dashboard(data, q) {
    q = q || {};
    var T = filterRows(data.tickets, q);
    var S = filterRows(data.socials, q);
    var Tsc = scoredRows(T), Ssc = scoredRows(S);
    var all = Tsc.map(function (r) { return r.score; }).concat(Ssc.map(function (r) { return r.score; }));
    var okS = S.filter(function (r) { return r.slaStatus === 'رعایت شده'; }).length;
    var badS = S.filter(function (r) { return r.slaStatus === 'رعایت نشده'; }).length;
    var bucket = function (arr, lo, hi) { return arr.filter(function (x) { return x >= lo && (hi == null || x < hi); }).length; };
    return {
      ticketCount: T.length, ticketScored: Tsc.length,
      socialCount: S.length, socialScored: Ssc.length,
      avgTicket: C.avg(Tsc.map(function (r) { return r.score; })),
      avgSocial: C.avg(Ssc.map(function (r) { return r.score; })),
      avgAll: C.avg(all),
      slaOk: okS, slaMissed: badS,
      slaReal: okS + badS === 0 ? '' : C.round2(100 * okS / (okS + badS)),
      unanswered: S.filter(function (r) { return r.responseStatus === 'عدم پاسخ'; }).length,
      redlineZero: T.filter(function (r) { return r.score === 0 && String(r.redline) === '0'; }).length,
      dist: [bucket(all, 0, 50), bucket(all, 50, 75), bucket(all, 75, 90), bucket(all, 90, null)],
      latestTickets: T.slice(-6).reverse(), latestSocials: S.slice(-6).reverse()
    };
  }

  return {
    inRange: inRange, filterRows: filterRows, scoredRows: scoredRows,
    ticketReport: ticketReport, socialReport: socialReport, dashboard: dashboard
  };
});
