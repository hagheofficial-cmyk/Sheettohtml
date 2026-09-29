/* reports.js — گزارش‌های تجمیعی کارشناس/تیم برای تیکت و سوشال */
(function () {
'use strict';
const { C, $, $$, api, fa, esc, el, toast, scorePill, rateCell, emptyState, debounce } = UI;

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

function cellVal(row, key, type) {
  const v = row[key];
  if (key === 'name') return `<span class="cell-main">${esc(v)}</span>`;
  if (key === 'team') return `<span class="tag-team">${esc(v)}</span>`;
  if (key === 'avgScore') return scorePill(v === '' ? null : v);
  if (key === 'slaReal') return v === '' ? '<span style="color:var(--muted)">—</span>' : rateCell(v);
  if (key.endsWith('Rate')) return rateCell(v);
  if (key === 'avgDurationMin') return v === '' ? '—' : fa(v) + ' دقیقه';
  if (key === 'unanswered' || key === 'slaMissed' || key === 'redlineZero') return `<span class="badge ${+v ? 'bad' : 'gray'}">${fa(v)}</span>`;
  if (key === 'answered' || key === 'count' || key === 'agentsEvaluated') return `<b>${fa(v)}</b>`;
  return v == null || v === '' ? '—' : esc(v);
}

async function render(root) {
  const st = App.state;
  const F = { type: 'social', level: 'agent' };

  root.innerHTML = `
    <div class="page-head">
      <div class="ph-ic"><i class="fa-solid fa-chart-pie"></i></div>
      <div><h2>گزارش‌های کنترل کیفیت</h2><p>معادل شیت‌های Agent Report و Team Report فایل اکسل — با فیلتر بازه تاریخ بررسی</p></div>
      <div class="spacer"></div>
      <button class="btn success-soft no-print" id="btnXls"><i class="fa-solid fa-file-excel"></i> خروجی اکسل گزارش</button>
    </div>

    <div class="card" style="margin-bottom:16px">
      <div class="filters" style="border-bottom:none">
        <div class="field grow-0"><label>نوع ارزیابی</label>
          <div class="tabs" id="typeTabs">
            <button data-t="social" class="active"><i class="fa-solid fa-comments"></i> سوشال</button>
            <button data-t="ticket"><i class="fa-solid fa-ticket"></i> تیکت</button>
          </div>
        </div>
        <div class="field grow-0"><label>سطح گزارش</label>
          <div class="tabs" id="levelTabs">
            <button data-l="agent" class="active"><i class="fa-solid fa-user"></i> کارشناس</button>
            <button data-l="team"><i class="fa-solid fa-users"></i> تیم</button>
          </div>
        </div>
        <div class="field"><label>تیم</label><select class="input" id="fTeam"><option value="">همه تیم‌ها</option>${st.teams.map((t) => `<option>${esc(t)}</option>`).join('')}</select></div>
        <div class="field"><label>از تاریخ بررسی</label><input class="input" id="fFrom" dir="ltr" style="text-align:right" placeholder="1405/06/01" inputmode="numeric"></div>
        <div class="field"><label>تا تاریخ بررسی</label><input class="input" id="fTo" dir="ltr" style="text-align:right" placeholder="1405/06/31" inputmode="numeric"></div>
        <div class="field grow-0"><label>&nbsp;</label><button class="btn ghost" id="fReset"><i class="fa-solid fa-rotate-right"></i> پاک‌سازی</button></div>
      </div>
    </div>

    <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(340px,1fr));margin-bottom:16px" id="chartsRow"></div>
    <div class="card">
      <div class="card-head"><div class="head-icon"><i class="fa-solid fa-table"></i></div><div><h3 id="tblTitle">گزارش کارشناسان — سوشال</h3><div class="sub" id="tblSub"></div></div></div>
      <div class="table-wrap" id="tblWrap"><div class="loading-page"><div class="spinner"></div></div></div>
    </div>`;

  function query(level) {
    const p = new URLSearchParams({ type: F.type, level: level || F.level });
    if ($('#fTeam').value) p.set('team', $('#fTeam').value);
    const jf = C.parseJalali($('#fFrom').value), jt = C.parseJalali($('#fTo').value);
    if (jf) p.set('from', C.formatJalali(jf));
    if (jt) p.set('to', C.formatJalali(jt));
    return p.toString();
  }

  async function load() {
    const wrap = $('#tblWrap'), charts = $('#chartsRow');
    wrap.innerHTML = `<div class="loading-page"><div class="spinner"></div></div>`;
    let data;
    try { data = await api.get('/api/reports?' + query()); }
    catch (e) { wrap.innerHTML = emptyState('fa-triangle-exclamation', 'خطا', e.message); return; }

    $('#tblTitle').textContent = (F.level === 'agent' ? 'گزارش کارشناسان' : 'گزارش تیم‌ها') + ' — ' + (F.type === 'social' ? 'سوشال' : 'تیکت');
    $('#tblSub').textContent = fa(data.rows.length) + (F.level === 'agent' ? ' کارشناس' : ' تیم');

    const cols = F.type === 'social'
      ? (F.level === 'agent' ? SOCIAL_COLS_AGENT : SOCIAL_COLS_TEAM)
      : (F.level === 'agent' ? TICKET_COLS_AGENT : TICKET_COLS_TEAM);

    if (!data.rows.length) {
      wrap.innerHTML = emptyState('fa-chart-simple', 'داده‌ای برای این فیلتر نیست', 'ابتدا ارزیابی ثبت کنید یا بازه/فیلترها را تغییر دهید.');
      charts.innerHTML = '';
      return;
    }

    // نمودارها
    App.charts.forEach((c) => { try { c.destroy(); } catch (e) {} });
    App.charts = [];
    charts.innerHTML = `
      <div class="card"><div class="card-head"><div class="head-icon"><i class="fa-solid fa-chart-column"></i></div><h3>میانگین نمره ${F.level === 'agent' ? 'کارشناسان' : 'تیم‌ها'}</h3></div>
        <div class="chart-box"><canvas id="ch1"></canvas></div></div>
      <div class="card"><div class="card-head violet"><div class="head-icon"><i class="fa-solid fa-layer-group"></i></div><h3>نرخ المان‌ها (تجمیعی)</h3></div>
        <div class="chart-box"><canvas id="ch2"></canvas></div></div>`;

    const rows = data.rows;
    const labels = rows.map((r) => r.name.length > 18 ? r.name.slice(0, 18) + '…' : r.name);
    const vals = rows.map((r) => r.avgScore === '' ? 0 : r.avgScore);
    const scoreColor = (v) => v >= 90 ? 'rgba(52,211,153,.8)' : v >= 75 ? 'rgba(56,189,248,.8)' : v >= 50 ? 'rgba(251,191,36,.8)' : 'rgba(248,113,113,.8)';

    App.chart($('#ch1'), {
      type: 'bar',
      data: { labels, datasets: [{ data: vals, backgroundColor: vals.map(scoreColor), borderRadius: 7, borderSkipped: false }] },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => ' میانگین: ' + fa(c.parsed.y) } } },
        scales: { y: { min: 0, max: 100, grid: { color: 'rgba(34,48,79,.5)' } }, x: { grid: { display: false }, ticks: { maxRotation: 60, font: { size: 10 } } } }
      }
    });

    // المان‌ها میانگین کل
    const elemKeys = F.type === 'social'
      ? [['qSlaRate', 'SLA', 'rgba(56,189,248,.85)'], ['qFollowRate', 'پیگیری', 'rgba(167,139,250,.85)'], ['qClosingRate', 'پایان‌بندی', 'rgba(52,211,153,.85)'], ['qToneRate', 'لحن', 'rgba(251,191,36,.85)']]
      : [['q1Rate', 'پیگیری', 'rgba(56,189,248,.85)'], ['q2Rate', 'یادداشت', 'rgba(167,139,250,.85)'], ['q3Rate', 'دلیل بستن', 'rgba(52,211,153,.85)'], ['q4Rate', 'اکشن CRM', 'rgba(251,191,36,.85)']];
    const avgRate = (k) => {
      const arr = rows.map((r) => r[k]).filter((x) => x !== '' && x != null);
      return arr.length ? C.round2(arr.reduce((a, b) => a + b, 0) / arr.length) : 0;
    };
    App.chart($('#ch2'), {
      type: 'polarArea',
      data: {
        labels: elemKeys.map((e) => e[1]),
        datasets: [{ data: elemKeys.map((e) => avgRate(e[0])), backgroundColor: elemKeys.map((e) => e[2].replace('.85', '.55')), borderColor: '#111a2e' }]
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { label: (c) => ' ' + c.label + ': ' + fa(c.parsed.r) + '٪' } } }, scales: { r: { max: 100, ticks: { display: false }, grid: { color: 'rgba(34,48,79,.5)' } } } }
    });

    // جدول
    wrap.innerHTML = `<table class="tbl"><thead><tr>${cols.map((c) => `<th>${c[1]}</th>`).join('')}</tr></thead>
      <tbody>${rows.map((r) => `<tr>${cols.map((c) => `<td>${cellVal(r, c[0], F.type)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  }

  // رویدادها
  $$('#typeTabs button').forEach((b) => b.addEventListener('click', () => {
    $$('#typeTabs button').forEach((x) => x.classList.remove('active')); b.classList.add('active'); F.type = b.dataset.t; load();
  }));
  $$('#levelTabs button').forEach((b) => b.addEventListener('click', () => {
    $$('#levelTabs button').forEach((x) => x.classList.remove('active')); b.classList.add('active'); F.level = b.dataset.l; load();
  }));
  $('#fTeam').addEventListener('change', load);
  $('#fFrom').addEventListener('blur', debounce(load, 200));
  $('#fTo').addEventListener('blur', debounce(load, 200));
  $('#fReset').addEventListener('click', () => { $('#fTeam').value = ''; $('#fFrom').value = ''; $('#fTo').value = ''; load(); });

  $('#btnXls').addEventListener('click', async () => {
    const btn = $('#btnXls'); btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-circle-notch spin"></i> در حال آماده‌سازی…';
    try {
      const agent = await api.get('/api/reports?' + query('agent'));
      const team = await api.get('/api/reports?' + query('team'));
      QCExport.reports(F.type, agent.rows, team.rows);
      toast('گزارش اکسل (دو شیت کارشناس و تیم) دانلود شد', 'success');
    } catch (e) { toast(e.message, 'error'); }
    btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-file-excel"></i> خروجی اکسل گزارش';
  });

  load();
}

App.register('reports', { title: 'گزارش‌های کنترل کیفیت', render });
})();
