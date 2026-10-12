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
  function validateRange(q) {
    q = q || {};
    var from = q.from ? C.parseDate(q.from) : null, to = q.to ? C.parseDate(q.to) : null;
    if ((q.from && !from) || (q.to && !to)) return 'تاریخ نامعتبر است؛ تاریخ معتبر مثل 1405/06/20 وارد کنید';
    if (from && to && C.jalaliCmp(from, to) > 0) return 'تاریخ شروع نباید بعد از تاریخ پایان باشد';
    return '';
  }

  function inRange(dateStr, from, to) {
    if (!from && !to) return true;
    if (validateRange({ from: from, to: to })) return false;
    var j = C.parseDate(dateStr);
    return !!j && C.jalaliInRange(j, from ? C.parseDate(from) : null, to ? C.parseDate(to) : null);
  }

  function valueSet(value) {
    if (!value) return null;
    var list = (Array.isArray(value) ? value : String(value).split(',')).map(String).filter(Boolean);
    return list.length ? new Set(list) : null;
  }
  function teamOf(agents, name) {
    var a = (agents || []).find(function (x) { return x.name === name; });
    return a ? a.team : '';
  }
  function rowTeam(data, row) { return teamOf(data && data.agents, row.expertName || row.agentName) || row.team || ''; }

  /** یک فیلتر مشترک برای همه‌ی گزارش‌ها؛ انتقال تیم در رجیستری هم منعکس می‌شود. */
  function filterRows(rows, q, data) {
    q = q || {};
    var teamSet = valueSet(q.team), agentSet = valueSet(q.agent);
    return (rows || []).filter(function (r) {
      if ((q.from || q.to) && !inRange(r.reviewDate, q.from, q.to)) return false;
      if (teamSet && !teamSet.has(data ? rowTeam(data, r) : r.team)) return false;
      if (agentSet && !agentSet.has(r.agentName || r.expertName)) return false;
      if (q.qc && r.qcAgent !== q.qc) return false;
      return true;
    });
  }
  function filterCalls(data, q) {
    q = q || {};
    return filterRows(data.callFeedbacks || [], q, data).filter(function (r) { return !q.form || r.formType === q.form; });
  }

  function scoredRows(rows) {
    return (rows || []).filter(function (r) { return C.normalizeScore(r.score) !== null; })
      .map(function (r) { return Object.assign({}, r, { score: C.normalizeScore(r.score) }); });
  }
  function avgScore(rows) { return C.avg(scoredRows(rows).map(function (r) { return r.score; })); }
  function rateAll(rows, key) { return C.elementRate(rows.map(function (r) { return r[key]; })); }
  function hasRedline(row, type) {
    // در فرم تیکت ۰ ردلاین است؛ در تماس (و سوشال دارای پرچم صریح) ۱.
    return C.normalizeTri(row.redline) === (type === 'ticket' ? 0 : 1);
  }
  function redlineCount(rows, type) { return (rows || []).filter(function (r) { return hasRedline(r, type); }).length; }

  function criteriaKeys(rows, type, crit) {
    var present = new Set();
    (rows || []).filter(function (r) { return !type || r.formType === type; })
      .forEach(function (r) { Object.keys(r.elements || {}).forEach(function (k) { present.add(k); }); });
    var ordered = crit && crit.criteriaFor ? crit.criteriaFor(type) : [];
    return (ordered || []).filter(function (k) { return present.has(k); })
      .concat(Array.from(present).filter(function (k) { return (ordered || []).indexOf(k) === -1; }));
  }
  function criterionStats(rows, key) {
    var ok = 0, bad = 0, na = 0, missing = 0;
    rows.forEach(function (r) {
      var value = C.normalizeTri((r.elements || {})[key]);
      if (value === 1) ok++; else if (value === 0) bad++; else if (value === '-') na++; else missing++;
    });
    var applicable = ok + bad;
    return { key: key, ok: ok, bad: bad, na: na, missing: missing, total: ok + bad + na, applicable: applicable,
      successRate: applicable ? C.round2(100 * ok / applicable) : '', errorRate: applicable ? C.round2(100 * bad / applicable) : '' };
  }

  /* --------------------------------------------------- گزارش تیکت‌ها */
  function ticketReport(data, level, q) {
    var rows = filterRows(data.tickets, q, data);
    var group = level === 'team' ? function (r) { return rowTeam(data, r); } : function (r) { return r.agentName; };
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
        redlineZero: redlineCount(rs, 'ticket'),
        total: rs.length
      };
      if (level === 'team') out.agentsEvaluated = agents;
      return out;
    });
  }

  /* --------------------------------------------------- گزارش سوشال‌ها */
  function socialReport(data, level, q) {
    var rows = filterRows(data.socials, q, data);
    var group = level === 'team' ? function (r) { return rowTeam(data, r); } : function (r) { return r.agentName; };
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

  function monthlyBreakdown(rows, dateKey) {
    dateKey = dateKey || 'reviewDate';
    var byMonth = {};
    rows.forEach(function (r) {
      var j = C.parseDate(r[dateKey]);
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
    var map = Object.create(null), teamSet = valueSet(q.team), agentSet = valueSet(q.agent);
    function ensure(name, team) {
      if (!map[name]) map[name] = { name: name, team: teamOf(data.agents, name) || team || '', tickets: [], socials: [], calls: [] };
      return map[name];
    }
    if (q.includeEmpty) (data.agents || []).forEach(function (a) {
      if ((!teamSet || teamSet.has(a.team)) && (!agentSet || agentSet.has(a.name))) ensure(a.name, a.team);
    });
    filterRows(data.tickets, q, data).forEach(function (r) { ensure(r.agentName, r.team).tickets.push(r); });
    filterRows(data.socials, q, data).forEach(function (r) { ensure(r.agentName, r.team).socials.push(r); });
    filterCalls(data, q).forEach(function (r) { ensure(r.expertName, rowTeam(data, r)).calls.push(r); });

    return Object.keys(map).map(function (key) {
      var m = map[key], T = m.tickets, S = m.socials, Ph = m.calls;
      var agent = (data.agents || []).find(function (a) { return a.name === key; });
      return {
        name: m.name, team: m.team, ext: agent ? agent.ext : null, active: agent ? agent.active !== false : true,
        registered: !!agent,
        ticketCount: T.length, ticketAvg: avgScore(T), ticketRedline: redlineCount(T, 'ticket'),
        socialCount: S.length, socialAvg: avgScore(S), socialRedline: redlineCount(S, 'social'), socialSlaReal: rateSla(S),
        socialUnanswered: S.filter(function (x) { return x.responseStatus === 'عدم پاسخ'; }).length,
        callCount: Ph.length, callAvg: avgScore(Ph), callRedline: redlineCount(Ph, 'call'),
        totalCount: T.length + S.length + Ph.length,
        scoredCount: scoredRows(T.concat(S, Ph)).length,
        avgScore: avgScore(T.concat(S, Ph))
      };
    }).filter(function (x) { return q.includeEmpty || x.totalCount > 0; })
      .sort(function (a, b) { return (b.avgScore === '' ? -1 : b.avgScore) - (a.avgScore === '' ? -1 : a.avgScore) || a.name.localeCompare(b.name, 'fa'); });
  }

  function portfolioAgents(data, q) { return combinedAgentReport(data, Object.assign({}, q, { includeEmpty: true })); }

  /* ----------------------------------------------------- پرونده کارشناس */
  /** کارشناس با نام یا داخلی (ext) → جزئیات کامل */
  /* ---------------------------- گزارش تماس (ردیفی) + نمرهی اقلام کلی ---------------------------- */
  function callReport(data, level, q, crit) {
    q = q || {}; crit = crit || {};
    var criteriaFor = crit.criteriaFor || function () { return []; };
    var labelOf = crit.labelOf || function (t, k) { return k; };
    var agentSet = valueSet(q.agent);
    function teamN(rr) { return rowTeam(data, rr) || 'بدون تیم'; }
    var rowsFB = filterCalls(data, q);
    var group = level === 'team' ? teamN : function (r) { return r.expertName; };
    var seen = Object.create(null), names = [];
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
        redlines: redlineCount(rs, 'call'),
        teleCount: tele.length, teleAvg: avgOf(tele),
        accCount: acc.length, accAvg: avgOf(acc),
        mlmCount: mlm.length, mlmAvg: avgOf(mlm),
        total: rs.length
      };
    });
    function rates(type) {
      var subset = rowsFB.filter(function (r) { return r.formType === type; });
      return criteriaKeys(subset, type, crit).map(function (key) {
        return Object.assign(criterionStats(subset, key), { label: labelOf(type, key), form: type });
      });
    }
    var elements = [].concat(rates('tele'), rates('account'), rates('mlm'))
      .filter(function (r) { return r.total > 0; })
      .sort(function (a, b) { return (b.errorRate === '' ? -1 : b.errorRate) - (a.errorRate === '' ? -1 : a.errorRate); });
    // جزئیات تماس فقط برای انتخاب دقیق یک کارشناس؛ فرم‌ها در UI جدا جدول‌بندی می‌شوند.
    var calls = agentSet && agentSet.size === 1 ? rowsFB.slice().sort(function (a, b) {
      var aj = C.parseDate(a.reviewDate), bj = C.parseDate(b.reviewDate);
      return aj && bj ? C.jalaliCmp(bj, aj) : (bj ? 1 : aj ? -1 : 0);
    }) : [];
    var redlineRows = rowsFB.filter(function (r) { return hasRedline(r, 'call'); }).map(function (r) {
      return Object.assign({}, r, { currentTeam: teamN(r) });
    });
    return { rows: rows, elements: elements, calls: calls, redlineRows: redlineRows };
  }

  /* ---------------------------- نرخ اقلام نسبت به کل دیتا (وزن‌دار) ----------------------------
   * به‌جای میانگین نرخ تک‌به‌تک کارشناس‌ها، رعایت/عدم‌رعایت را روی کل ردیف‌های
   * فیلترشده جمع می‌زند — دقیقاً معادل اینکه کل گروه یک شیت واحد باشد. */
  function elementRates(data, q) {
    q = q || {};
    function ratesFor(rows, keys) {
      return keys.map(function (k) {
        var ok = 0, bad = 0;
        rows.forEach(function (r) {
          var v = C.normalizeTri(r[k[0]]);
          if (v === 1) ok++;
          else if (v === 0) bad++;
        });
        var tot = ok + bad;
        return {
          key: k[0], label: k[1], form: k[2], ok: ok, bad: bad, total: tot,
          successRate: tot ? C.round2(100 * ok / tot) : '',
          errorRate: tot ? C.round2(100 * bad / tot) : ''
        };
      });
    }
    var T = scoredRows(filterRows(data.tickets, q, data));
    var S = scoredRows(filterRows(data.socials, q, data));
    return {
      ticket: ratesFor(T, [
        ['q1', 'پیگیری', 'ticket'], ['q2', 'یادداشت', 'ticket'], ['q3', 'دلیل بستن', 'ticket'], ['q4', 'اکشن CRM', 'ticket']
      ]),
      social: ratesFor(S, [
        ['qSla', 'المان SLA', 'social'], ['qFollow', 'پیگیری', 'social'], ['qClosing', 'پایان‌بندی', 'social'], ['qTone', 'لحن', 'social']
      ])
    };
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
      a = { id: 0, name: nm, team: '(دیتای تماس)', active: true, internal: '', role: 'کارشناس از فایل تماس' };
      name = nm;
    }
    var T = filterRows(data.tickets, q, data).filter(function (r) { return r.agentName === name; });
    var S = filterRows(data.socials, q, data).filter(function (r) { return r.agentName === name; });
    var Ph = filterCalls(data, Object.assign({}, q, { agent: name }));
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
          var v = C.normalizeTri(r.elements[k]);
          if (v === 1 || v === 0 || v === '-') keys[k] = 1;
        });
      });
      var list = Object.keys(keys).map(function (k) {
        var stats = criterionStats(rs, k);
        return Object.assign({}, stats, { total: stats.applicable, observations: stats.total });
      }).sort(function (x, y) {
        return (x.successRate === '' ? 101 : x.successRate) - (y.successRate === '' ? 101 : y.successRate);
      });
      var weak = list.filter(function (x) { return x.successRate !== '' && x.successRate < 100; });
      return { form: ft, count: rs.length, rates: list, weak: weak.length };
    }).filter(Boolean);

    /* ردلاین‌های کارشناس با علت */
    var redlineRows = Ph.filter(function (r) { return hasRedline(r, 'call'); }).map(function (r) {
      return { score: r.score, reason: r.redlineReason || '', date: r.reviewDate,
               formType: r.formType, leadName: r.leadName, leadPhone: r.leadPhone, qcComment: r.qcComment || '' };
    }).sort(function (x, y) { return (y.date || '').localeCompare(x.date || ''); });

    return {
      agent: a,
      tickets: {
        rows: T, count: T.length, scoredCount: scoredRows(T).length, avgScore: avgScore(T),
        q1Rate: rateAll(T, 'q1'), q2Rate: rateAll(T, 'q2'), q3Rate: rateAll(T, 'q3'), q4Rate: rateAll(T, 'q4'),
        redlineZero: redlineCount(T, 'ticket')
      },
      socials: {
        rows: S, count: S.length, scoredCount: scoredRows(S).length, avgScore: avgScore(S), slaReal: rateSla(S),
        unanswered: S.filter(function (x) { return x.responseStatus === 'عدم پاسخ'; }).length,
        avgDurationMin: C.avg(S.map(function (x) { return x.durationMin; }).filter(function (v) { return typeof v === 'number'; }))
      },
      calls: {
        rows: Ph, count: Ph.length,
        byType: ['tele', 'account', 'mlm'].map(function (t) {
          var rs = Ph.filter(function (x) { return x.formType === t; });
          return { type: t, count: rs.length, avg: avgScore(rs) };
        }).filter(function (x) { return x.count > 0; }),
        redlineCount: redlineCount(Ph, 'call'), scoredCount: scoredRows(Ph).length,
        avgScore: avgScore(Ph),
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

    var Ph = filterCalls(data, q);
    var scored = scoredRows(Ph);
    var expertSet = Object.create(null);
    Ph.forEach(function (r) { expertSet[r.expertName] = 1; });

    /* KPI */
    var kpis = {
      totalCalls: Ph.length,
      scoredCalls: scored.length,
      avgScore: avgScore(Ph),
      redlineCount: redlineCount(Ph, 'call'),
      expertsWithData: Object.keys(expertSet).length,
      withComment: Ph.filter(function (r) { return (r.qcComment || '').trim(); }).length,
      listeningCalls: Ph.filter(function (r) { return (r.listeningTime || '') !== '' && r.listeningTime !== '-'; }).length
    };

    /* تفکیک نوع فرم */
    var byForm = ['tele', 'account', 'mlm'].map(function (ft) {
      var rs = Ph.filter(function (r) { return r.formType === ft; });
      if (!rs.length) return null;
      return { form: ft, count: rs.length, avgScore: avgScore(rs), redlines: redlineCount(rs, 'call') };
    }).filter(Boolean);

    /* نرخ هر معیار — جدا برای هر نوع فرم به ترتیب پنل */
    function ratesOf(rows, type) {
      return criteriaKeys(rows, type, crit).map(function (key) {
        var stats = criterionStats(rows, key);
        return Object.assign({}, stats, { label: labelOf(type, key), total: stats.applicable, observations: stats.total });
      });
    }
    var elementRates = {
      tele: ratesOf(Ph.filter(function (r) { return r.formType === 'tele'; }), 'tele'),
      account: ratesOf(Ph.filter(function (r) { return r.formType === 'account'; }), 'account'),
      mlm: ratesOf(Ph.filter(function (r) { return r.formType === 'mlm'; }), 'mlm')
    };

    /* هیت‌مپ خطا: کارشناس × معیار (فقط کارشناسان دارای دیتای همان فرم) */
    function heatmapOf(type) {
      var rows = Ph.filter(function (r) { return r.formType === type; });
      var keys = criteriaKeys(rows, type, crit);
      var names = Array.from(new Set(rows.map(function (r) { return r.expertName; })));
      var out = names.map(function (name) {
        var ers = rows.filter(function (r) { return r.expertName === name; });
        var cells = keys.map(function (k) {
          var ok = 0, bad = 0;
          ers.forEach(function (r) { var v = C.normalizeTri((r.elements || {})[k]); if (v === 1) ok++; else if (v === 0) bad++; });
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
        redlines: redlineCount(rs, 'call'),
        worst: null /* برای UI: با elementRates قابل کراس است */
      };
    }).sort(function (a, b) { return (b.avgScore === '' ? -1 : b.avgScore) - (a.avgScore === '' ? -1 : a.avgScore); });

    /* ردلاین‌ها */
    var redlines = Ph.filter(function (r) { return hasRedline(r, 'call'); }).map(function (r) {
      return { expertName: r.expertName, leadName: r.leadName, leadPhone: r.leadPhone, formType: r.formType,
        score: r.score, reason: r.redlineReason || '', date: r.reviewDate, sourceFile: r.sourceFile };
    }).sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); });

    /* کامنت‌های QC */
    var comments = Ph.filter(function (r) { return (r.qcComment || '').trim(); }).map(function (r) {
      return { expertName: r.expertName, leadName: r.leadName, leadPhone: r.leadPhone, formType: r.formType,
        score: r.score, comment: r.qcComment, date: r.reviewDate };
    }).sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); }).slice(0, 60);

    /* روند ماهانه */
    var byMonth = {};
    Ph.forEach(function (r) {
      var j = C.parseDate(r.reviewDate); if (!j) return;
      var d = C.formatJalali(j).slice(0, 7);
      if (!byMonth[d]) byMonth[d] = { month: d, count: 0, scoreSum: 0, scoreN: 0, redlines: 0, forms: { tele: 0, account: 0, mlm: 0 } };
      byMonth[d].count++;
      var score = C.normalizeScore(r.score);
      if (score !== null) { byMonth[d].scoreSum += score; byMonth[d].scoreN++; }
      if (hasRedline(r, 'call')) byMonth[d].redlines++;
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
    var T = filterRows(data.tickets, q, data);
    var S = filterRows(data.socials, q, data);
    var Ph = filterCalls(data, q), Tsc = scoredRows(T), Ssc = scoredRows(S), Psc = scoredRows(Ph);
    var all = Tsc.concat(Ssc, Psc).map(function (r) { return r.score; });
    var okS = S.filter(function (r) { return r.slaStatus === 'رعایت شده'; }).length;
    var badS = S.filter(function (r) { return r.slaStatus === 'رعایت نشده'; }).length;
    var bucket = function (arr, lo, hi) { return arr.filter(function (x) { return x >= lo && (hi == null || x < hi); }).length; };
    return {
      ticketCount: T.length, ticketScored: Tsc.length,
      socialCount: S.length, socialScored: Ssc.length,
      callCount: Ph.length, callScored: Psc.length, avgCall: avgScore(Ph), callRedlines: redlineCount(Ph, 'call'),
      avgTicket: C.avg(Tsc.map(function (r) { return r.score; })),
      avgSocial: C.avg(Ssc.map(function (r) { return r.score; })),
      avgAll: C.avg(all),
      slaOk: okS, slaMissed: badS,
      slaReal: okS + badS === 0 ? '' : C.round2(100 * okS / (okS + badS)),
      unanswered: S.filter(function (r) { return r.responseStatus === 'عدم پاسخ'; }).length,
      redlineZero: redlineCount(T, 'ticket'),
      dist: [bucket(all, 90, null), bucket(all, 75, 90), bucket(all, 50, 75), bucket(all, 0, 50)],
      latestTickets: T.slice(-6).reverse(), latestSocials: S.slice(-6).reverse(), latestCalls: Ph.slice().sort(function (a, b) {
        var aj = C.parseDate(a.reviewDate), bj = C.parseDate(b.reviewDate);
        return aj && bj ? C.jalaliCmp(bj, aj) : (bj ? 1 : aj ? -1 : 0);
      }).slice(0, 6)
    };
  }

  /** شمارش زنده‌ی مرکز داده، مستقل از متای آخرین آپلود و شامل تیم‌های بدون دیتا. */
  function dataStatus(data, q) {
    q = q || {};
    var T = filterRows(data.tickets, q, data), S = filterRows(data.socials, q, data), Ph = filterCalls(data, q);
    var teams = Object.create(null);
    function ensure(team) {
      team = team || 'بدون تیم';
      if (!teams[team]) teams[team] = { team: team, ticketCount: 0, socialCount: 0, callCount: 0, totalCount: 0 };
      return teams[team];
    }
    (data.agents || []).forEach(function (a) { ensure(a.team); });
    [[T, 'ticketCount'], [S, 'socialCount'], [Ph, 'callCount']].forEach(function (entry) {
      entry[0].forEach(function (r) { var team = ensure(rowTeam(data, r)); team[entry[1]]++; team.totalCount++; });
    });
    return {
      tickets: T.length, socials: S.length, calls: Ph.length,
      byForm: { tele: Ph.filter(function (r) { return r.formType === 'tele'; }).length,
        account: Ph.filter(function (r) { return r.formType === 'account'; }).length,
        mlm: Ph.filter(function (r) { return r.formType === 'mlm'; }).length },
      byTeam: Object.keys(teams).sort(function (a, b) { return a.localeCompare(b, 'fa'); }).map(function (t) { return teams[t]; }),
      undated: { tickets: (data.tickets || []).filter(function (r) { return !C.parseDate(r.reviewDate); }).length,
        socials: (data.socials || []).filter(function (r) { return !C.parseDate(r.reviewDate); }).length,
        calls: (data.callFeedbacks || []).filter(function (r) { return !C.parseDate(r.reviewDate); }).length }
    };
  }

  return {
    inRange: inRange, validateRange: validateRange, filterRows: filterRows, filterCalls: filterCalls, scoredRows: scoredRows,
    avgScore: avgScore, hasRedline: hasRedline, criteriaKeys: criteriaKeys, criterionStats: criterionStats, dataStatus: dataStatus, portfolioAgents: portfolioAgents,
    monthlyBreakdown: monthlyBreakdown, combinedAgentReport: combinedAgentReport, agentByIdent: agentByIdent, agentProfile: agentProfile,
    ticketReport: ticketReport, socialReport: socialReport, callReport: callReport, elementRates: elementRates, dashboard: dashboard,
    callAnalysis: callAnalysis
  };
});
