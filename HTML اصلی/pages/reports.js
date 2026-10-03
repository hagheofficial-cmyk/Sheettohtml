/* reports.js — گزارش‌های تجمیعی کارشناس/تیم برای تیکت و سوشال + گزارش تجمیعی + ماه مالی */
(function () {
'use strict';
const { C, $, $$, api, fa, esc, el, toast, scorePill, rateCell, emptyState, debounce, scoreColorRgba } = UI;

const SOCIAL_COLS_AGENT = [
  ['name', 'کارشناس'], ['team', 'تیم'], ['count', 'تعداد نمره‌دار'], ['avgScore', 'میانگین نمره'],
  ['answered', 'پاسخ‌داده‌شده'], ['slaReal', 'رعایت واقعی SLA'], ['qSlaRate', 'المان SLA'],
  ['qFollowRate', 'پیگیری'], ['qClosingRate', 'پایان‌بندی'], ['qToneRate', 'لحن'],
  ['unanswered', 'عدم پاسخ'], ['slaMissed', 'SLA رعایت‌نشده'], ['avgDurationMin', 'میانگین مدت پاسخ']
];
const SOCIAL_COLS_TEAM = [
  ['name', 'تیم'], ['count', 'تعداد نمره‌دار'], ['agentsEvaluated', 'کارشناسان ارزیابی‌شده'], ['avgScore', 'میانگین نمره'],
  ['answered', 'پاسخ‌داده‌شده'], ['slaReal', 'رعایت واقعی SLA'], ['qSlaRate', 'المان SLA'],
  ['qFollowRate', 'پیگیری'], ['qClosingRate', 'پایان‌بندی'], ['qToneRate', 'لحن'],
  ['unanswered', 'عدم پاسخ'], ['slaMissed', 'SLA رعایت‌نشده'], ['avgDurationMin', 'میانگین مدت پاسخ']
];
const TICKET_COLS_AGENT = [
  ['name', 'کارشناس'], ['team', 'تیم'], ['count', 'تعداد نمره‌دار'], ['avgScore', 'میانگین نمره'],
  ['q1Rate', 'پیگیری'], ['q2Rate', 'یادداشت'], ['q3Rate', 'دلیل بستن'], ['q4Rate', 'اکشن CRM'], ['redlineZero', 'ردلاین صفر']
];
const TICKET_COLS_TEAM = [
  ['name', 'تیم'], ['count', 'تعداد نمره‌دار'], ['agentsEvaluated', 'کارشناسان ارزیابی‌شده'], ['avgScore', 'میانگین نمره'],
  ['q1Rate', 'پیگیری'], ['q2Rate', 'یادداشت'], ['q3Rate', 'دلیل بستن'], ['q4Rate', 'اکشن CRM'], ['redlineZero', 'ردلاین صفر']
];
const CALL_COLS_AGENT = [
  ['name', 'کارشناس'], ['team', 'تیم'], ['count', 'تعداد نمره‌دار'], ['avgScore', 'میانگین نمره'],
  ['redlines', 'ردلاین'], ['teleCount', 'تلفنی (ت)'], ['teleAvg', 'میانگین تلفنی'],
  ['accCount', 'اکانت (ت)'], ['accAvg', 'میانگین اکانت'], ['mlmCount', 'MLM (ت)'], ['mlmAvg', 'میانگین MLM'], ['total', 'مجموع ریت']
];
const CALL_COLS_TEAM = [
  ['name', 'تیم'], ['count', 'تعداد نمره‌دار'], ['avgScore', 'میانگین نمره'], ['redlines', 'ردلاین'],
  ['teleCount', 'تلفنی (ت)'], ['teleAvg', 'میانگین تلفنی'],
  ['accCount', 'اکانت (ت)'], ['accAvg', 'میانگین اکانت'], ['mlmCount', 'MLM (ت)'], ['mlmAvg', 'میانگین MLM'], ['total', 'مجموع ریت']
];
const COMBINED_COLS = [
  ['name', 'کارشناس'], ['team', 'تیم'],
  ['ticketCount', 'تیکت (ت)'], ['ticketAvg', 'میانگین تیکت'],
  ['socialCount', 'سوشال (ت)'], ['socialAvg', 'میانگین سوشال'], ['socialSlaReal', 'SLA سوشال'],
  ['callCount', 'تماس (ت)'], ['callAvg', 'میانگین تماس'],
  ['totalCount', 'مجموع'], ['avgScore', 'میانگین کل']
];

function cellVal(row, key) {
  const v = row[key];
  if (key === 'name') return `<span class="cell-main">${esc(v)}</span>`;
  if (key === 'team') return `<span class="tag-team">${esc(v)}</span>`;
  if (key === 'avgScore') return scorePill(v === '' ? null : v);
  if (key === 'ticketAvg' || key === 'socialAvg' || key === 'callAvg' || key === 'teleAvg' || key === 'accAvg' || key === 'mlmAvg') return v === '' ? '<span style="color:var(--muted)">—</span>' : scorePill(v);
  if (key === 'redlines') return `<span class="badge ${+v ? 'bad' : 'good'}">${fa(v)}</span>`;
  if (key === 'teleCount' || key === 'accCount' || key === 'mlmCount' || key === 'total') return v === 0 ? '<span style="color:var(--muted)">۰</span>' : `<b>${fa(v)}</b>`;
  if (key === 'slaReal' || key === 'socialSlaReal') return v === '' ? '<span style="color:var(--muted)">—</span>' : rateCell(v);
  if (key.endsWith('Rate')) return rateCell(v);
  if (key === 'avgDurationMin') return v === '' ? '—' : fa(v) + ' دقیقه';
  if (key === 'unanswered' || key === 'slaMissed' || key === 'redlineZero') return `<span class="badge ${+v ? 'bad' : 'gray'}">${fa(v)}</span>`;
  if (key === 'answered' || key === 'count' || key === 'agentsEvaluated') return `<b>${fa(v)}</b>`;
  if (key === 'ticketCount' || key === 'socialCount' || key === 'callCount') return v === 0 ? '<span style="color:var(--muted)">۰</span>' : `<b>${fa(v)}</b>`;
  if (key === 'totalCount') return `<b>${fa(v)}</b>`;
  return v == null || v === '' ? '—' : esc(v);
}

async function render(root) {
  const st = App.state;
  const F = { type: 'social', level: 'agent' };

  root.innerHTML = `
    <div class="page-head">
      <div class="ph-ic"><i class="fa-solid fa-chart-pie"></i></div>
      <div><h2>گزارش‌های کنترل کیفیت</h2><p>معادل شیت‌های Agent Report و Team Report فایل اکسل + گزارش تجمیعی + فیلتر ماه مالی</p></div>
      <div class="spacer"></div>
      <button class="btn success-soft no-print" id="btnXls"><i class="fa-solid fa-file-excel"></i> خروجی اکسل گزارش</button>
    </div>

    <div class="card" style="margin-bottom:16px">
      <div class="filters" style="border-bottom:none">
        <div class="field grow-0"><label>نوع ارزیابی</label>
          <div class="tabs" id="typeTabs">
            <button data-t="social" class="active"><i class="fa-solid fa-comments"></i> سوشال</button>
            <button data-t="ticket"><i class="fa-solid fa-ticket"></i> تیکت</button>
            <button data-t="call"><i class="fa-solid fa-phone"></i> تماس</button>
            <button data-t="combined"><i class="fa-solid fa-layer-group"></i> تجمیعی</button>
          </div>
        </div>
        <div class="field grow-0"><label>سطح گزارش</label>
          <div class="tabs" id="levelTabs">
            <button data-l="agent" class="active"><i class="fa-solid fa-user"></i> کارشناس</button>
            <button data-l="team"><i class="fa-solid fa-users"></i> تیم</button>
          </div>
        </div>
        <div id="fTeamSlot"></div>
        <div id="fAgentSlot"></div>
        <div class="field grow-0"><label>از تاریخ بررسی</label>
          <div class="date-f"><input class="input" id="fFrom" dir="ltr" style="text-align:right;padding-left:34px" placeholder="۱۴۰۵/۰۶/۰۱" inputmode="numeric">
            <button type="button" class="cal-btn" id="fFromBtn" title="انتخاب از تقویم"><i class="fa-regular fa-calendar"></i></button></div>
        </div>
        <div class="field grow-0"><label>تا تاریخ بررسی</label>
          <div class="date-f"><input class="input" id="fTo" dir="ltr" style="text-align:right;padding-left:34px" placeholder="۱۴۰۵/۰۶/۳۱" inputmode="numeric">
            <button type="button" class="cal-btn" id="fToBtn" title="انتخاب از تقویم"><i class="fa-regular fa-calendar"></i></button></div>
        </div>
        <div class="field grow-0"><label>&nbsp;</label><button class="btn ghost" id="fReset"><i class="fa-solid fa-rotate-right"></i> پاک‌سازی</button></div>
      </div>
    </div>

    <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(340px,1fr));margin-bottom:16px" id="chartsRow"></div>
    <div id="elemCardWrap"></div>
    <div class="card">
      <div class="card-head"><div class="head-icon"><i class="fa-solid fa-table"></i></div><div><h3 id="tblTitle">گزارش کارشناسان — سوشال</h3><div class="sub" id="tblSub"></div></div></div>
      <div class="table-wrap" id="tblWrap"><div class="loading-page"><div class="spinner"></div></div></div>
    </div>`;

  /* اتصال تقویم جلالی */
  JCal.attach($('#fFromBtn'), { onPick(j) { $('#fFrom').value = j ? C.formatJalali(j) : ''; load(); } });
  JCal.attach($('#fToBtn'), { onPick(j) { $('#fTo').value = j ? C.formatJalali(j) : ''; load(); } });
  /* بستن فیلد از تایپ دستی (readonly) — فقط همین دو تا، دخالت blur/load تغییری نمی‌کند */

  /* فیلتر چندانتخابی تیم + کارشناس */
  const allAgents = (st.agents || []).filter((a) => a.active !== false);
  function agentItemsFor(teams) {
    const list = teams && teams.length ? allAgents.filter((a) => teams.indexOf(a.team) !== -1) : allAgents;
    return list.slice().sort((a, b) => a.name.localeCompare(b.name, 'fa'))
      .map((a) => ({ value: a.name, label: a.name, sub: a.team || '' }));
  }
  const msAgents = UI.multiSelect({
    label: 'کارشناس', allLabel: 'همه کارشناسان', placeholder: 'جستجوی کارشناس…',
    items: agentItemsFor(), onChange: () => load()
  });
  const msTeams = UI.multiSelect({
    label: 'تیم', allLabel: 'همه تیم‌ها', placeholder: 'جستجوی تیم…',
    items: (st.teams || []).map((t) => ({ value: t, label: t })),
    onChange: (vals) => {
      const keep = msAgents.getValues();
      const items = agentItemsFor(vals);
      const allowed = new Set(items.map((x) => x.value));
      msAgents.setItems(items, false);
      msAgents.setValues(keep.filter((v) => allowed.has(v)));
      load();
    }
  });
  $('#fTeamSlot').replaceWith(msTeams);
  $('#fAgentSlot').replaceWith(msAgents);

  function query(level) {
    const p = new URLSearchParams({ type: F.type, level: level || F.level });
    const tv = msTeams.getValues(); if (tv.length) p.set('team', tv.join(','));
    const av = msAgents.getValues(); if (av.length) p.set('agent', av.join(','));
    const jf = C.parseJalali($('#fFrom').value), jt = C.parseJalali($('#fTo').value);
    if (jf) p.set('from', C.formatJalali(jf));
    if (jt) p.set('to', C.formatJalali(jt));
    return p.toString();
  }

  const scoreColor = scoreColorRgba;

  /* نمودار افقی نرخ اقلام (وزن‌دار روی کل دیتا) — تیکت + سوشال یک‌جا */
  function drawElementsBar(canvas, data) {
    const els = ((data.elements && data.elements.ticket) || []).map((x) => ({ ...x, frm: 'تیکت' }))
      .concat(((data.elements && data.elements.social) || []).map((x) => ({ ...x, frm: 'سوشال' })));
    const valid = els.filter((x) => x.total > 0);
    if (!canvas || !valid.length) return;
    App.chart(canvas, {
      type: 'bar',
      data: {
        labels: valid.map((x) => `${x.label} · ${x.frm}`),
        datasets: [{
          data: valid.map((x) => x.successRate === '' ? 0 : x.successRate),
          backgroundColor: valid.map((x) => x.frm === 'تیکت' ? 'rgba(56,189,248,.8)' : 'rgba(52,211,153,.8)'),
          borderRadius: 6, borderSkipped: false, barPercentage: .68
        }]
      },
      options: {
        indexAxis: 'y', responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (c) => ' نرخ رعایت: ' + fa(valid[c.dataIndex].successRate === '' ? '—' : valid[c.dataIndex].successRate) + '%',
              afterLabel: (c) => {
                const x = valid[c.dataIndex];
                return `رعایت: ${fa(x.ok)} · عدم رعایت: ${fa(x.bad)} · مجموع: ${fa(x.total)}`;
              }
            }
          }
        },
        scales: {
          x: { min: 0, max: 100, grid: { color: 'rgba(34,48,79,.5)' }, ticks: { callback: (v) => v + '٪' } },
          y: { grid: { display: false }, ticks: { font: { size: 11.5 } } }
        }
      }
    });
  }

  function drawBar(canvas, labels, vals, tooltipLabel) {
    App.chart(canvas, {
      type: 'bar',
      data: { labels, datasets: [{ data: vals, backgroundColor: vals.map(scoreColor), borderRadius: 7, borderSkipped: false }] },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => ' ' + tooltipLabel + ': ' + fa(c.parsed.y) } } },
        scales: { y: { min: 0, max: 100, grid: { color: 'rgba(34,48,79,.5)' } }, x: { grid: { display: false }, ticks: { maxRotation: 60, font: { size: 10 } } } }
      }
    });
  }

  async function load() {
    App.clearCharts();
    const wrap = $('#tblWrap'), charts = $('#chartsRow');
    wrap.innerHTML = `<div class="loading-page"><div class="spinner"></div></div>`;
    let data;
    try { data = await api.get('/api/reports?' + query()); }
    catch (e) { wrap.innerHTML = emptyState('fa-triangle-exclamation', 'خطا', e.message); return; }

    const typeFa = F.type === 'combined' ? 'تجمیعی (تیکت + سوشال + تماس)' : (F.type === 'social' ? 'سوشال' : (F.type === 'ticket' ? 'تیکت' : 'تماس (ریت تماس)'));
    $('#tblTitle').textContent = (F.level === 'agent' ? 'گزارش کارشناسان' : 'گزارش تیم‌ها') + ' — ' + typeFa;
    $('#tblSub').textContent = fa(data.rows.length) + (F.level === 'agent' ? ' کارشناس' : ' تیم');

    const cols = F.type === 'combined'
      ? COMBINED_COLS
      : (F.type === 'social'
        ? (F.level === 'agent' ? SOCIAL_COLS_AGENT : SOCIAL_COLS_TEAM)
        : (F.type === 'ticket'
          ? (F.level === 'agent' ? TICKET_COLS_AGENT : TICKET_COLS_TEAM)
          : (F.level === 'agent' ? CALL_COLS_AGENT : CALL_COLS_TEAM)));

    if (!data.rows.length) {
      wrap.innerHTML = emptyState('fa-chart-simple', 'داده‌ای برای این فیلتر نیست', 'ابتدا ارزیابی ثبت کنید یا بازه/فیلترها را تغییر دهید.');
      charts.innerHTML = '';
      $('#elemCardWrap').innerHTML = '';
      return;
    }

    /* کارت «نمره‌ی اقلام نسبت به کل دیتا» — تیکت و سوشال، وزن‌دار روی تمام ردیف‌های فیلترشده */
    function elementsCardHTML(cls) {
      const t = ((data.elements && data.elements.ticket) || []).reduce((n, x) => n + x.total, 0);
      const s = ((data.elements && data.elements.social) || []).reduce((n, x) => n + x.total, 0);
      if (!t && !s) return '';
      return `<div class="card"><div class="card-head ${cls}"><div class="head-icon"><i class="fa-solid fa-square-poll-vertical"></i></div>
          <div><h3>نمره‌ی اقلام نسبت به کل دیتا (تیکت + سوشال)</h3>
          <div class="sub">نرخ رعایت هر المان روی کل دیتای فیلترشده — تیکت: ${fa(t)} سابقه · سوشال: ${fa(s)} سابقه</div></div></div>
        <div class="chart-box" style="height:300px"><canvas id="chEls"></canvas></div></div>`;
    }

    const rows = data.rows;
    const labels = rows.map((r) => r.name.length > 18 ? r.name.slice(0, 18) + '…' : r.name);

    if (F.type === 'combined') {
      $('#elemCardWrap').innerHTML = '';
      charts.innerHTML = `
        <div class="card"><div class="card-head"><div class="head-icon"><i class="fa-solid fa-chart-column"></i></div><h3>میانگین کل نمره</h3></div>
          <div class="chart-box"><canvas id="ch1"></canvas></div></div>
        <div class="card"><div class="card-head violet"><div class="head-icon"><i class="fa-solid fa-chart-column"></i></div><h3>توزیع تعداد ارزیابی (تیکت / سوشال / تماس)</h3></div>
          <div class="chart-box"><canvas id="ch2"></canvas></div></div>
${elementsCardHTML('teal')}`;
      drawBar($('#ch1'), labels, rows.map((r) => r.avgScore === '' ? 0 : r.avgScore), 'میانگین کل');
      drawElementsBar($('#chEls'), data);
      App.chart($('#ch2'), {
        type: 'bar',
        data: {
          labels,
          datasets: [
            { label: 'تیکت', data: rows.map((r) => r.ticketCount || 0), backgroundColor: 'rgba(56,189,248,.8)', stack: 's1', borderRadius: 4, borderSkipped: false },
            { label: 'سوشال', data: rows.map((r) => r.socialCount || 0), backgroundColor: 'rgba(52,211,153,.8)', stack: 's1', borderRadius: 4, borderSkipped: false },
            { label: 'تماس', data: rows.map((r) => r.callCount || 0), backgroundColor: 'rgba(167,139,250,.8)', stack: 's1', borderRadius: 4, borderSkipped: false }
          ]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { position: 'bottom' } },
          scales: { y: { grid: { color: 'rgba(34,48,79,.5)' }, stacked: true }, x: { grid: { display: false }, stacked: true, ticks: { maxRotation: 60, font: { size: 10 } } } }
        }
      });
    } else if (F.type === 'call') {
      charts.innerHTML = `
        <div class="card"><div class="card-head"><div class="head-icon"><i class="fa-solid fa-chart-column"></i></div><h3>میانگین نمره ${F.level === 'agent' ? 'کارشناسان' : 'تیم‌ها'} — تماس</h3></div>
          <div class="chart-box"><canvas id="ch1"></canvas></div></div>
        <div class="card"><div class="card-head violet"><div class="head-icon"><i class="fa-solid fa-phone-volume"></i></div><h3>توزیع ریت بر اساس فرم (تلفنی / اکانت / MLM)</h3></div>
          <div class="chart-box"><canvas id="ch2"></canvas></div></div>`;
      drawBar($('#ch1'), labels, rows.map((r) => r.avgScore === '' ? 0 : r.avgScore), 'میانگین');
      App.chart($('#ch2'), {
        type: 'bar',
        data: {
          labels,
          datasets: [
            { label: 'تلفنی', data: rows.map((r) => r.teleCount || 0), backgroundColor: 'rgba(56,189,248,.8)', stack: 's1', borderRadius: 4, borderSkipped: false },
            { label: 'اکانت', data: rows.map((r) => r.accCount || 0), backgroundColor: 'rgba(167,139,250,.8)', stack: 's1', borderRadius: 4, borderSkipped: false },
            { label: 'MLM', data: rows.map((r) => r.mlmCount || 0), backgroundColor: 'rgba(52,211,153,.8)', stack: 's1', borderRadius: 4, borderSkipped: false }
          ]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { position: 'bottom' } },
          scales: { y: { grid: { color: 'rgba(34,48,79,.5)' }, stacked: true }, x: { grid: { display: false }, stacked: true, ticks: { maxRotation: 60, font: { size: 10 } } } }
        }
      });
      /* کارت نمره‌ی اقلام کلی — «کلا روی کدام المان چه نمره‌ای گرفته‌شده» */
      const FORM_FA = { tele: 'تلفنی', account: 'اکانت', mlm: 'MLM' };
      const FORM_COLOR = { tele: '#38bdf8', account: '#a78bfa', mlm: '#34d399' };
      const els = (data.elements && data.elements.call) || [];
      $('#elemCardWrap').innerHTML = els.length ? `
        <div class="card" style="margin-bottom:16px">
          <div class="card-head"><div class="head-icon"><i class="fa-solid fa-list-check"></i></div>
            <div><h3>نمره‌ی اقلام کلی — تماس</h3><div class="sub">تجمیع همه‌ی فرم‌ها؛ ${fa(els.length)} المان با گزارش نرخ رعایت/عدم رعایت</div></div></div>
          <div class="table-wrap" style="max-height:340px;overflow-y:auto"><table class="tbl" style="font-size:12.5px">
            <thead><tr><th>المان</th><th>فرم</th><th>رعایت‌شده</th><th>عدم رعایت</th><th>مجموع</th><th>نرخ رعایت</th><th>نرخ عدم رعایت</th></tr></thead>
            <tbody>${els.map((x) => `<tr>
              <td class="cell-main">${esc(x.label)}</td>
              <td><span class="tag-team" style="background:${FORM_COLOR[x.form]}18;color:${FORM_COLOR[x.form]};border-color:${FORM_COLOR[x.form]}44">${esc(FORM_FA[x.form] || x.form)}</span></td>
              <td><b>${fa(x.ok)}</b></td>
              <td><span class="badge ${x.bad ? 'bad' : 'gray'}">${fa(x.bad)}</span></td>
              <td>${fa(x.total)}</td>
              <td>${rateCell(x.successRate)}</td>
              <td>${rateCell(x.errorRate === '' ? '' : x.errorRate)}</td>
            </tr>`).join('')}</tbody></table></div>
        </div>` : '';
    } else {
      $('#elemCardWrap').innerHTML = '';
      charts.innerHTML = `
        <div class="card"><div class="card-head"><div class="head-icon"><i class="fa-solid fa-chart-column"></i></div><h3>میانگین نمره ${F.level === 'agent' ? 'کارشناسان' : 'تیم‌ها'} — ${F.type === 'social' ? 'سوشال' : 'تیکت'}</h3></div>
          <div class="chart-box"><canvas id="ch1"></canvas></div></div>
${elementsCardHTML('teal')}`;
      drawBar($('#ch1'), labels, rows.map((r) => r.avgScore === '' ? 0 : r.avgScore), 'میانگین');
      drawElementsBar($('#chEls'), data);
    }

    wrap.innerHTML = `<table class="tbl"><thead><tr>${cols.map((c) => `<th>${c[1]}</th>`).join('')}</tr></thead>
      <tbody>${rows.map((r) => `<tr>${cols.map((c) => `<td>${cellVal(r, c[0])}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  }

  $$('#typeTabs button').forEach((b) => b.addEventListener('click', () => {
    $$('#typeTabs button').forEach((x) => x.classList.remove('active')); b.classList.add('active'); F.type = b.dataset.t; load();
  }));
  $$('#levelTabs button').forEach((b) => b.addEventListener('click', () => {
    $$('#levelTabs button').forEach((x) => x.classList.remove('active')); b.classList.add('active'); F.level = b.dataset.l; load();
  }));
  $('#fFrom').addEventListener('change', load);
  $('#fTo').addEventListener('change', load);
  $('#fReset').addEventListener('click', () => {
    msTeams.setValues([]); msTeams.setItems((st.teams || []).map((t) => ({ value: t, label: t })), false);
    msAgents.setValues([]); msAgents.setItems(agentItemsFor(), false);
    $('#fFrom').value = ''; $('#fTo').value = ''; load();
  });

  $('#btnXls').addEventListener('click', async () => {
    const btn = $('#btnXls'); btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-circle-notch spin"></i> در حال آماده‌سازی…';
    try {
      const agent = await api.get('/api/reports?' + query('agent'));
      const team = await api.get('/api/reports?' + query('team'));
      if (F.type === 'combined') QCExport.combined(agent.rows);
      else if (F.type === 'call') QCExport.calls(agent.rows, team.rows, agent.elements || []);
      else QCExport.reports(F.type, agent.rows, team.rows);
      toast('گزارش اکسل دانلود شد', 'success');
    } catch (e) { toast(e.message, 'error'); }
    btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-file-excel"></i> خروجی اکسل گزارش';
  });

  load();
}

App.register('reports', { title: 'گزارش‌های کنترل کیفیت', render });
})();
