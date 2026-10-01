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
    /* پشتیبانی از چندانتخابی: team و agent می‌تواند لیست (رشته با ',' یا آرایه) باشد */
    var teamSet = null, agentSet = null;
    if (q.team) teamSet = new Set((Array.isArray(q.team) ? q.team : String(q.team).split(',')).map(String).filter(Boolean));
    if (q.agent) agentSet = new Set((Array.isArray(q.agent) ? q.agent : String(q.agent).split(',')).map(String).filter(Boolean));
    return rows.filter(function (r) {
      if (q.from || q.to) { if (!inRange(r.reviewDate, q.from, q.to)) return false; }
      if (teamSet && !teamSet.has(r.team)) return false;
      if (agentSet && !agentSet.has(r.agentName)) return false;
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

  /* ------------------------------------------- تفکیک ماهانه (ماه مالی) */
  /** rows → گروه‌بندی بر اساس سال/ماه شمسیِ ستون تاریخ، خروجی مرتب‌شده از قدیم به جدید */
  /* تفکیک به‌ازای هر تاریخ: تیکت + سوشال + تماس در یک ردیف */
  function dailyBreakdown(tickets, socials, calls) {
    var map = {};
    function mk(k) {
      if (!map[k]) map[k] = { date: k, ticketCount: 0, ticketSum: 0, socialCount: 0, socialSum: 0, callCount: 0, callSum: 0, callTele: 0, callAccount: 0, callMlm: 0, redlines: 0 };
      return map[k];
    }
    (tickets || []).forEach(function (r) {
      var k = r.reviewDate || 'بدون تاریخ'; var d = mk(k); d.ticketCount++;
      if (typeof r.score === 'number') d.ticketSum += r.score;
      if (String(r.redline) === '1') d.redlines++;
    });
    (socials || []).forEach(function (r) {
      var k = r.reviewDate || 'بدون تاریخ'; var d = mk(k); d.socialCount++;
      if (typeof r.score === 'number') d.socialSum += r.score;
    });
    (calls || []).forEach(function (r) {
      var k = r.reviewDate || 'بدون تاریخ'; var d = mk(k); d.callCount++;
      if (typeof r.score === 'number') d.callSum += r.score;
      if (r.formType === 'tele') d.callTele++; else if (r.formType === 'account') d.callAccount++; else if (r.formType === 'mlm') d.callMlm++;
      if (r.redline === 1 || r.redline === '1') d.redlines++;
    });
    var arr = Object.keys(map).map(function (k) {
      var d = map[k];
      return {
        date: k,
        ticketCount: d.ticketCount, ticketAvg: d.ticketCount ? Math.round((d.ticketSum / d.ticketCount) * 100) / 100 : '',
        socialCount: d.socialCount, socialAvg: d.socialCount ? Math.round((d.socialSum / d.socialCount) * 100) / 100 : '',
        callCount: d.callCount, callAvg: d.callCount ? Math.round((d.callSum / d.callCount) * 100) / 100 : '',
        byType: { tele: d.callTele, account: d.callAccount, mlm: d.callMlm },
        redlines: d.redlines
      };
    });
    arr.sort(function (a, b) {
      if (a.date === 'بدون تاریخ') return 1;
      if (b.date === 'بدون تاریخ') return -1;
      return a.date < b.date ? 1 : (a.date > b.date ? -1 : 0);
    });
    return arr;
  }

  function monthlyBreakdown(rows, dateKey) {var byMonth = {};
    rows.forEach(function (r) {
      var j = C.parseJalali(r[dateKey]);
      if (!j) return;
      var key = j.jy + '-' + (j.jm < 10 ? '0' : '') + j.jm;
      if (!byMonth[key]) byMonth[key] = { jy: j.jy, jm: j.jm, rows: [] };
      byMonth[key].rows.push(r);
    });
    return Object.keys(byMonth).sort().map(function (key) {
      var m = byMonth[key];
      return {
        key: key, jy: m.jy, jm: m.jm,
        monthFa: C.MONTHS_FA[m.jm - 1] + ' ' + C.toFaDigits(String(m.jy)),
        count: scoredRows(m.rows).length,
        avgScore: avgScore(m.rows),
        slaReal: m.rows.some(function (x) { return x.slaStatus; }) ? rateSla(m.rows) : '',
        redlineZero: m.rows.filter(function (x) { return x.score === 0 && String(x.redline) === '0'; }).length
      };
    });
  }
  function rateSla(rows) {
    var ok = rows.filter(function (r) { return r.slaStatus === 'رعایت واقعی SLA' || r.slaStatus === 'رعایت شده'; }).length;
    var bad = rows.filter(function (r) { return r.slaStatus === 'رعایت نشده'; }).length;
    return ok + bad === 0 ? '' : C.round2(100 * ok / (ok + bad));
  }

  /* -------------------------------- گزارش تجمیعی کارشناس (تیکت+سوشال+تماس) */
  /** هر کارشناس → { name, team, tickets:{count,avg}, socials:{count,avg}, calls:{count,avg}, total, avgAll } */
  function combinedAgentReport(data, q) {
    q = q || {};
    var map = {};
    var ensure = function (name, team) {
      var key = name || '';
      if (!map[key]) map[key] = { name: key, team: team || '', tickets: [], socials: [], calls: [] };
      return map[key];
    };
    filterRows(data.tickets, q).forEach(function (r) { ensure(r.agentName, r.team).tickets.push(r); });
    filterRows(data.socials, q).forEach(function (r) { ensure(r.agentName, r.team).socials.push(r); });
    (data.callFeedbacks || []).filter(function (r) {
      if (q.from || q.to) { if (!inRange(r.reviewDate || r.dateStr, q.from, q.to)) return false; }
      if (q.team) { var tn = teamOf(data.agents, r.expertName) || r.team; if (tn !== q.team) return false; }
      if (q.agent && r.expertName !== q.agent) return false;
      return true;
    }).forEach(function (r) {
      var a = data.agents.find(function (x) { return x.name === r.expertName; });
      ensure(r.expertName, a ? a.team : (r.team || '')).calls.push(r);
    });

    return Object.keys(map).map(function (key) {
      var m = map[key];
      var T = m.tickets, S = m.socials, Ph = m.calls;
      var allScores = scoredRows(T).map(function (x) { return x.score; })
        .concat(scoredRows(S).map(function (x) { return x.score; }))
        .concat(Ph.map(function (x) { return x.score; }).filter(function (v) { return typeof v === 'number'; }));
      return {
        name: m.name, team: m.team,
        ticketCount: scoredRows(T).length, ticketAvg: avgScore(T), ticketRedline: T.filter(function (x) { return x.score === 0 && String(x.redline) === '0'; }).length,
        socialCount: scoredRows(S).length, socialAvg: avgScore(S), socialSlaReal: rateSla(S),
        socialUnanswered: S.filter(function (x) { return x.responseStatus === 'عدم پاسخ'; }).length,
        callCount: Ph.length,
        callAvg: Ph.length ? C.round2(Ph.reduce(function (a, x) { return a + (typeof x.score === 'number' ? x.score : 0); }, 0) / Ph.length) : '',
        callRedline: Ph.filter(function (x) { return x.redline === 1 || x.redline === '1'; }).length,
        totalCount: scoredRows(T).length + scoredRows(S).length + Ph.length,
        avgScore: allScores.length ? C.round2(allScores.reduce(function (a, b) { return a + b; }, 0) / allScores.length) : ''
      };
    }).filter(function (x) { return x.totalCount > 0; })
      .sort(function (a, b) { return (b.avgScore === '' ? -1 : b.avgScore) - (a.avgScore === '' ? -1 : a.avgScore); });
  }

  /* ----------------------------------------------------- پرونده کارشناس */
  /** کارشناس با نام یا داخلی (ext) → جزئیات کامل */
  /* ---------------------------- گزارش تماس (ردیفی) + نمرهی اقلام کلی ---------------------------- */
  function callReport(data, level, q, crit) {
    q = q || {}; crit = crit || {};
    var criteriaFor = crit.criteriaFor || function () { return []; };
    var labelOf = crit.labelOf || function (t, k) { return k; };
    var teamSet = null, agentSet = null;
    if (q.team) teamSet = new Set((Array.isArray(q.team) ? q.team : String(q.team).split(',')).map(String).filter(Boolean));
    if (q.agent) agentSet = new Set((Array.isArray(q.agent) ? q.agent : String(q.agent).split(',')).map(String).filter(Boolean));
    function teamN(rr) { return teamOf(data.agents, rr.expertName) || rr.team || ''; }
    var rowsFB = (data.callFeedbacks || []).filter(function (r) {
      if ((q.from || q.to) && !inRange(r.reviewDate || '', q.from, q.to)) return false;
      if (teamSet && !teamSet.has(teamN(r))) return false;
      if (agentSet && !agentSet.has(r.expertName)) return false;
      if (q.form && r.formType !== q.form) return false;
      return true;
    });
    var group = level === 'team' ? teamN : function (r) { return r.expertName; };
    var seen = {}, names = [];
    rowsFB.forEach(function (r) { var g = group(r); if (g && !seen[g]) { seen[g] = 1; names.push(g); } });
    function avgOf(rr) { return avgScore(rr); }
    var rows = names.map(function (name) {
      var rs = rowsFB.filter(function (r) { return group(r) === name; });
      var tele = rs.filter(function (r) { return r.formType === 'tele'; });
      var acc = rs.filter(function (r) { return r.formType === 'account'; });
      var mlm = rs.filter(function (r) { return r.formType === 'mlm'; });
      return {
        name: name,
        team: level === 'team' ? name : (teamOf(data.agents, name) || (rs[0] && rs[0].team) || ''),
        count: scoredRows(rs).length,
        avgScore: avgOf(rs),
        redlines: rs.filter(function (r) { return r.redline === 1; }).length,
        teleCount: tele.length, teleAvg: avgOf(tele),
        accCount: acc.length, accAvg: avgOf(acc),
        mlmCount: mlm.length, mlmAvg: avgOf(mlm),
        total: rs.length
      };
    });
    function rates(type) {
      var subset = rowsFB.filter(function (r) { return r.formType === type; });
      return (criteriaFor(type) || []).map(function (k) {
        var ok = 0, bad = 0;
        subset.forEach(function (r) {
          var v = (r.elements || {})[k];
          if (v === 1) ok++; else if (v === 0) bad++;
        });
        var tot = ok + bad;
        return { key: k, label: labelOf(type, k), form: type, ok: ok, bad: bad, total: tot,
                 successRate: tot ? C.round2(100 * ok / tot) : '', errorRate: tot ? C.round2(100 * bad / tot) : '' };
      });
    }
    var elements = [].concat(rates('tele'), rates('account'), rates('mlm'))
      .filter(function (r) { return r.total > 0; })
      .sort(function (a, b) { return (b.errorRate || 0) - (a.errorRate || 0); });
    return { rows: rows, elements: elements };
  }

  function agentByIdent(agents, ident) {
    ident = C.faToEn(String(ident == null ? '' : ident)).trim().toLowerCase();
    if (!ident) return null;
    var exact = agents.find(function (a) { return a.name && String(a.name).toLowerCase().trim() === ident; })
      || agents.find(function (a) { return a.ext != null && String(a.ext).toLowerCase() === ident; });
    if (exact) return exact;
    return agents.filter(function (a) { return a.name && String(a.name).toLowerCase().indexOf(ident) !== -1; })[0]
      || null;
  }
  function agentProfile(data, ident, q) {
    q = q || {};
    var a = agentByIdent(data.agents, ident);
    var name;
    if (a) {
      name = a.name;
    } else {
      // کارشناسی که فقط در دیتای تماس دیده شده (هنوز در رجیستری نیست)
      var nm = String(ident || '').trim();
      var hit = (data.callFeedbacks || []).filter(function (r) { return r.expertName === nm; });
      if (!hit.length) return null;
      a = { id: 0, name: nm, team: '(دیتای تماس)', internal: '', role: 'کارشناس از فایل تماس' };
      name = nm;
    }
    var T = filterRows(data.tickets, q).filter(function (r) { return r.agentName === name; });
    var S = filterRows(data.socials, q).filter(function (r) { return r.agentName === name; });
    var Ph = (data.callFeedbacks || []).filter(function (r) { return r.expertName === name; })
      .filter(function (r) { if (q.from || q.to) return inRange(r.reviewDate, q.from, q.to); return true; });
    var store = data.callImport || {};
    /* اقدامات اصلاحی: آن‌هایی که پنل در recovery ذخیره کرده + ثبت‌های بومی سامانه */
    var panelActions = ((store.storedActions && store.storedActions[name]) || []).map(function (x) {
      return { title: String(x.title || x.titleFa || x.text || ''), date: String(x.date || ''), status: String(x.status || 'انجام نشده'), source: 'panel', note: String(x.note || '') };
    });
    var nativeActions = ((data.agentActions || {})[name] || []).map(function (x) {
      return { id: x.id, title: String(x.title || ''), date: String(x.date || ''), status: String(x.status || 'انجام نشده'), source: 'system', note: String(x.note || '') };
    });
    var actions = nativeActions.concat(panelActions);
    var vRaw = (store.voiceMeta && store.voiceMeta[name]) || [];
    var voices = Array.isArray(vRaw) ? vRaw : (vRaw && typeof vRaw === 'object' && typeof vRaw.count === 'number' ? { count: vRaw.count } : []);

    /* نرخ موفقیت معیارهای تماس برای این کارشناس — طبق نمونه پنل (بازیگر معیارها از روی خود ردیف‌ها، چون دیکشنری نمی‌خواهیم سرور وابسته شود) */
    var byTypeRates = ['tele', 'account', 'mlm'].map(function (ft) {
      var rs = Ph.filter(function (r) { return r.formType === ft; });
      if (!rs.length) return null;
      /* هر کلیدی که در یکی از ردیف‌ها مقدار ۰/۱ دارد */
      var keys = {};
      rs.forEach(function (r) {
        Object.keys(r.elements || {}).forEach(function (k) {
          var v = r.elements[k];
          if (v === 1 || v === 0) keys[k] = 1;
        });
      });
      var list = Object.keys(keys).map(function (k) {
        var ok = 0, bad = 0;
        rs.forEach(function (r) { var v = (r.elements || {})[k]; if (v === 1) ok++; else if (v === 0) bad++; });
        var t = ok + bad;
        return { key: k, ok: ok, bad: bad, total: t, successRate: t ? C.round2(100 * ok / t) : '' };
      }).sort(function (x, y) {
        return (x.successRate === '' ? 101 : x.successRate) - (y.successRate === '' ? 101 : y.successRate);
      });
      var weak = list.filter(function (x) { return x.successRate !== '' && x.successRate < 100; });
      return { form: ft, count: rs.length, rates: list, weak: weak.length };
    }).filter(Boolean);

    /* ردلاین‌های کارشناس با علت */
    var redlineRows = Ph.filter(function (r) { return r.redline === 1; }).map(function (r) {
      return { score: r.score, reason: (r.redlineReason || '').replace(/["']/g, ''), date: r.reviewDate,
               formType: r.formType, leadName: r.leadName, leadPhone: r.leadPhone, qcComment: r.qcComment || '' };
    }).sort(function (x, y) { return (y.date || '').localeCompare(x.date || ''); });

    return {
      agent: a,
      tickets: {
        rows: T, count: scoredRows(T).length, avgScore: avgScore(T),
        q1Rate: rateAll(T, 'q1'), q2Rate: rateAll(T, 'q2'), q3Rate: rateAll(T, 'q3'), q4Rate: rateAll(T, 'q4'),
        redlineZero: T.filter(function (x) { return x.score === 0 && String(x.redline) === '0'; }).length
      },
      socials: {
        rows: S, count: scoredRows(S).length, avgScore: avgScore(S), slaReal: rateSla(S),
        unanswered: S.filter(function (x) { return x.responseStatus === 'عدم پاسخ'; }).length,
        avgDurationMin: C.avg(S.map(function (x) { return x.durationMin; }).filter(function (v) { return typeof v === 'number'; }))
      },
      calls: {
        rows: Ph, count: Ph.length,
        byType: ['tele', 'account', 'mlm'].map(function (t) {
          var rs = Ph.filter(function (x) { return x.formType === t; });
          return { type: t, count: rs.length, avg: rs.length ? C.round2(rs.reduce(function (a, x) { return a + (x.score || 0); }, 0) / rs.length) : '' };
        }).filter(function (x) { return x.count > 0; }),
        redlineCount: Ph.filter(function (x) { return x.redline === 1 || x.redline === '1'; }).length,
        avgScore: Ph.length ? C.round2(Ph.reduce(function (a, x) { return a + (x.score || 0); }, 0) / Ph.length) : '',
        byTypeRates: byTypeRates,
        redlineRows: redlineRows
      },
      actions: actions, voiceCount: Array.isArray(voices) ? voices.length : (voices.count || 0),
      monthly: {
        tickets: monthlyBreakdown(T),
        socials: monthlyBreakdown(S),
        calls: monthlyBreakdown(Ph)
      },
      daily: dailyBreakdown(T, S, Ph)
    };
  }

  /* ================================================= تحلیل بومی تماس (پنل بومی سامانه)
   * همه‌ی خروجی‌های داشبورد پنل دستیار روی دیتای ادغام‌شده‌ی سامانه:
   * KPI، نرخ هر معیار، هیت‌مپ خطای کارشناس×معیار، رتبه‌بندی، ردلاین‌ها، کامنت‌ها، ماهانه.
   * crit: آبجکت تشکیل‌شده از توابع parseQc (criteriaFor/labelOf) — تمرین: از سرور یا window.QCParse.
   */
  function callAnalysis(data, q, crit) {
    q = q || {};
    crit = crit || {};
    var criteriaFor = crit.criteriaFor || function () { return []; };
    var labelOf = crit.labelOf || function (t, k) { return k; };

    /* فیلتر مشترک (تاریخ/تیم/کارشناس/فرم) — با پشتیبانی چندانتخابی */
    var teamSet = null, agentSet = null;
    if (q.team) teamSet = new Set((Array.isArray(q.team) ? q.team : String(q.team).split(',')).map(String).filter(Boolean));
    if (q.agent) agentSet = new Set((Array.isArray(q.agent) ? q.agent : String(q.agent).split(',')).map(String).filter(Boolean));
    var Ph = (data.callFeedbacks || []).filter(function (r) {
      if ((q.from || q.to) && !inRange(r.reviewDate || '', q.from, q.to)) return false;
      if (q.form && r.formType !== q.form) return false;
      if (agentSet && !agentSet.has(r.expertName)) return false;
      if (teamSet) { var tn = teamOf(data.agents, r.expertName) || r.team || ''; if (!teamSet.has(tn)) return false; }
      return true;
    });

    var scored = Ph.filter(function (r) { return typeof r.score === 'number'; });
    var expertSet = {};
    Ph.forEach(function (r) { expertSet[r.expertName] = 1; });

    /* KPI */
    var kpis = {
      totalCalls: Ph.length,
      scoredCalls: scored.length,
      avgScore: avgScore(Ph),
      redlineCount: Ph.filter(function (r) { return r.redline === 1; }).length,
      expertsWithData: Object.keys(expertSet).length,
      withComment: Ph.filter(function (r) { return (r.qcComment || '').trim(); }).length,
      listeningCalls: Ph.filter(function (r) { return (r.listeningTime || '') !== '' && r.listeningTime !== '-'; }).length
    };

    /* تفکیک نوع فرم */
    var byForm = ['tele', 'account', 'mlm'].map(function (ft) {
      var rs = Ph.filter(function (r) { return r.formType === ft; });
      if (!rs.length) return null;
      return { form: ft, count: rs.length, avgScore: avgScore(rs), redlines: rs.filter(function (r) { return r.redline === 1; }).length };
    }).filter(Boolean);

    /* نرخ هر معیار — جدا برای هر نوع فرم به ترتیب پنل */
    function ratesOf(rows, type) {
      var keys = criteriaFor(type);
      return keys.map(function (k) {
        var ok = 0, bad = 0;
        rows.forEach(function (r) {
          var v = (r.elements || {})[k];
          if (v === 1) ok++; else if (v === 0) bad++;
        });
        var tot = ok + bad;
        return {
          key: k, label: labelOf(type, k), ok: ok, bad: bad, total: tot,
          successRate: tot ? C.round2(100 * ok / tot) : '',
          errorRate: tot ? C.round2(100 * bad / tot) : ''
        };
      });
    }
    var elementRates = {
      tele: ratesOf(Ph.filter(function (r) { return r.formType === 'tele'; }), 'tele'),
      account: ratesOf(Ph.filter(function (r) { return r.formType === 'account'; }), 'account'),
      mlm: ratesOf(Ph.filter(function (r) { return r.formType === 'mlm'; }), 'mlm')
    };

    /* هیت‌مپ خطا: کارشناس × معیار (فقط کارشناسان دارای دیتای همان فرم) */
    function heatmapOf(type) {
      var keys = criteriaFor(type);
      var rows = Ph.filter(function (r) { return r.formType === type; });
      var names = Array.from(new Set(rows.map(function (r) { return r.expertName; })));
      var out = names.map(function (name) {
        var ers = rows.filter(function (r) { return r.expertName === name; });
        var cells = keys.map(function (k) {
          var ok = 0, bad = 0;
          ers.forEach(function (r) { var v = (r.elements || {})[k]; if (v === 1) ok++; else if (v === 0) bad++; });
          var tot = ok + bad;
          return tot === 0 ? null : { ok: ok, bad: bad, total: tot, errorRate: C.round2(100 * bad / tot) };
        });
        return { name: name, team: teamOf(data.agents, name) || '', count: ers.length, avg: avgScore(ers), cells: cells };
      });
      /* کم‌دیتاترین خطاها اول؟ نه — بالاترین میانگین خطا در ستون‌ها اول */
      out.sort(function (a, b) {
        var ea = a.cells.filter(Boolean).reduce(function (s, x) { return s + x.errorRate; }, 0) / Math.max(1, a.cells.filter(Boolean).length);
        var eb = b.cells.filter(Boolean).reduce(function (s, x) { return s + x.errorRate; }, 0) / Math.max(1, b.cells.filter(Boolean).length);
        return eb - ea;
      });
      return { labels: keys.map(function (k) { return labelOf(type, k); }), keys: keys, agents: out };
    }
    var heatmaps = { tele: heatmapOf('tele'), account: heatmapOf('account'), mlm: heatmapOf('mlm') };

    /* رتبه‌بندی کارشناسان */
    var leaderboard = Object.keys(expertSet).map(function (name) {
      var rs = Ph.filter(function (r) { return r.expertName === name; });
      return {
        name: name, team: teamOf(data.agents, name) || rs[0].team || '',
        count: rs.length, avgScore: avgScore(rs),
        redlines: rs.filter(function (r) { return r.redline === 1; }).length,
        worst: null /* برای UI: با elementRates قابل کراس است */
      };
    }).sort(function (a, b) { return (b.avgScore === '' ? -1 : b.avgScore) - (a.avgScore === '' ? -1 : a.avgScore); });

    /* ردلاین‌ها */
    var redlines = Ph.filter(function (r) { return r.redline === 1; }).map(function (r) {
      return { expertName: r.expertName, leadName: r.leadName, leadPhone: r.leadPhone, formType: r.formType,
        score: r.score, reason: (r.redlineReason || '').replace(/["']/g, ''), date: r.reviewDate, sourceFile: r.sourceFile };
    }).sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); });

    /* کامنت‌های QC */
    var comments = Ph.filter(function (r) { return (r.qcComment || '').trim(); }).map(function (r) {
      return { expertName: r.expertName, leadName: r.leadName, leadPhone: r.leadPhone, formType: r.formType,
        score: r.score, comment: r.qcComment, date: r.reviewDate };
    }).sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); }).slice(0, 60);

    /* روند ماهانه */
    var byMonth = {};
    Ph.forEach(function (r) {
      var d = (r.reviewDate || '').slice(0, 7); if (!d || d.length < 7) return;
      if (!byMonth[d]) byMonth[d] = { month: d, count: 0, scoreSum: 0, scoreN: 0, redlines: 0, forms: { tele: 0, account: 0, mlm: 0 } };
      byMonth[d].count++;
      if (typeof r.score === 'number') { byMonth[d].scoreSum += r.score; byMonth[d].scoreN++; }
      if (r.redline === 1) byMonth[d].redlines++;
      if (byMonth[d].forms[r.formType] != null) byMonth[d].forms[r.formType]++;
    });
    var monthly = Object.keys(byMonth).sort().map(function (k) {
      var m = byMonth[k];
      return { month: k, count: m.count, avgScore: m.scoreN ? C.round2(m.scoreSum / m.scoreN) : '', redlines: m.redlines, forms: m.forms };
    });

    return { kpis: kpis, byForm: byForm, elementRates: elementRates, heatmaps: heatmaps,
             leaderboard: leaderboard, redlines: redlines, comments: comments, monthly: monthly };
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
    monthlyBreakdown: monthlyBreakdown, combinedAgentReport: combinedAgentReport, agentByIdent: agentByIdent, agentProfile: agentProfile,
    ticketReport: ticketReport, socialReport: socialReport, callReport: callReport, dashboard: dashboard,
    callAnalysis: callAnalysis
  };
});
