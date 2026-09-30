/* callAnalysis.js — تحلیل فیدبک تماس (بومی: جایگزین قابلیت‌های داشبورد پنل)
 *   همه‌ی خروجی‌های پنل دستیار فیدبک، روی دیتای ادغام‌شده‌ی سامانه:
 *   KPI، نرخ موفقیت معیارها، هیت‌مپ خطا، رتبه‌بندی، ردلاین‌ها، کامنت‌های QC، روند ماهانه.
 *   + فیلتر تاریخ جلالی (از/تا) مشترک با بقیه صفحات و خروجی اکسل چندشیتی.
 */
(function () {
'use strict';
const { C, $, $$, api, fa, esc, toast, scorePill, rateCell, emptyState } = UI;

const FORM_TABS = [
  { key: '', label: 'همه تیم‌ها', icon: 'fa-layer-group' },
  { key: 'tele', label: 'تلفنی', icon: 'fa-phone' },
  { key: 'account', label: 'اکانت', icon: 'fa-building-columns' },
  { key: 'mlm', label: 'MLM / BNPL', icon: 'fa-cart-shopping' }
];
const FORM_FA = { tele: 'تلفنی', account: 'اکانت', mlm: 'MLM' };

function heatColor(rate) {
  if (rate == null) return 'background:rgba(30,41,59,.5);color:var(--muted)';
  if (rate >= 50) return 'background:rgba(248,113,113,.4);color:#fecaca';
  if (rate >= 25) return 'background:rgba(251,191,36,.32);color:#fde68a';
  if (rate >= 8) return 'background:rgba(251,146,60,.18);color:#fdba74';
  return 'background:rgba(52,211,153,.12);color:#6ee7b7';
}

function heatVal(cell) {
  if (!cell) return '—';
  return fa(cell.errorRate) + '٪';
}

async function render(root) {
  const st = App.state;
  /* تیم‌های سازمانی → نوع QC اکسل که باید خوانده شود */
  const teamFormMap = { 'tele sales': 'tele', 'account': 'account', 'mlm': 'mlm', 'bnpl': 'mlm' };
  const FORM_LABEL = { tele: 'تلفنی', account: 'اکانت', mlm: 'MLM / BNPL' };
  const teamList = (st.teams || []).slice().sort();
  const F = { team: '', form: '', from: '', to: '' };

  function buildTeamTabs() {
    const tabs = [{ key: '', label: 'همه تیم‌ها', icon: 'fa-layer-group' }];
    for (const t of teamList) {
      const f = teamFormMap[String(t).toLowerCase()];
      const icon = f === 'tele' ? 'fa-phone' : f === 'account' ? 'fa-building-columns' : 'fa-cart-shopping';
      tabs.push({ key: String(t), label: String(t), icon });
    }
    return tabs;
  }
  const tabs = buildTeamTabs();

  root.innerHTML = `
    <div class="page-head">
      <div class="ph-ic"><i class="fa-solid fa-chart-line"></i></div>
      <div>
        <h2>تحلیل فیدبک تماس</h2>
        <p>تحلیل بومی دیتای تماس — نمره، معیارها، خطاها و ردلاین. تیم را انتخاب کن تا معیارهای همان تیم دیده شود.</p>
      </div>
      <div class="spacer"></div>
      <button class="btn success-soft no-print" id="btnXls"><i class="fa-solid fa-file-excel"></i> خروجی اکسل تحلیل</button>
    </div>

    <div class="card" style="margin-bottom:16px">
      <div class="filters" style="border-bottom:none">
        <div class="field grow-0"><label>تیم QC</label>
          <div class="tabs" id="formTabs">${tabs.map((t, i) => `<button data-t="${esc(t.key)}" class="${i === 0 ? 'active' : ''}"><i class="fa-solid ${t.icon}"></i> ${esc(t.label)}</button>`).join('')}</div>
        </div>
        <div class="field grow-0"><label>از تاریخ</label>
          <div class="date-f"><input class="input" id="fFrom" dir="ltr" style="text-align:right;padding-left:34px" inputmode="numeric" placeholder="۱۴۰۵/۰۱/۰۱">
            <button type="button" class="cal-btn" id="fFromBtn" title="انتخاب از تقویم"><i class="fa-regular fa-calendar"></i></button></div>
        </div>
        <div class="field grow-0"><label>تا تاریخ</label>
          <div class="date-f"><input class="input" id="fTo" dir="ltr" style="text-align:right;padding-left:34px" inputmode="numeric" placeholder="۱۴۰۵/۱۲/۲۹">
            <button type="button" class="cal-btn" id="fToBtn" title="انتخاب از تقویم"><i class="fa-regular fa-calendar"></i></button></div>
        </div>
        <div class="field grow-0"><label>&nbsp;</label><button class="btn ghost" id="fReset"><i class="fa-solid fa-rotate-right"></i> پاک‌سازی</button></div>
      </div>
    </div>

    <div id="anBody"><div class="loading-page"><div class="spinner"></div></div></div>`;

  JCal.attach($('#fFromBtn'), { onPick(j) { $('#fFrom').value = j ? C.formatJalali(j) : ''; load(); } });
  JCal.attach($('#fToBtn'), { onPick(j) { $('#fTo').value = j ? C.formatJalali(j) : ''; load(); } });

  $('#formTabs').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-t]');
    if (!b) return;
    $$('#formTabs button').forEach((x) => x.classList.toggle('active', x === b));
    F.team = b.dataset.t;
    /* تیم → فرم مرتبط (برای بدست آوردن معیارهای تحلیل) */
    if (F.team === '') F.form = ''; else F.form = teamFormMap[F.team.toLowerCase()] || '';
    load();
  });
  $('#fReset').addEventListener('click', () => {
    F.team = ''; F.form = ''; F.from = ''; F.to = '';
    $('#fFrom').value = ''; $('#fTo').value = '';
    $$('#formTabs button').forEach((x, i) => x.classList.toggle('active', i === 0));
    load();
  });

  async function load() {
    const p = new URLSearchParams();
    if (F.form) p.set('form', F.form);
    if (F.team) p.set('team', F.team);
    const jf = C.parseJalali($('#fFrom').value), jt = C.parseJalali($('#fTo').value);
    if (jf) p.set('from', C.formatJalali(jf));
    if (jt) p.set('to', C.formatJalali(jt));
    const body = $('#anBody');
    body.innerHTML = '<div class="loading-page"><div class="spinner"></div></div>';
    try {
      const an = await api.get('/api/calls/analysis?' + p.toString());
      renderAnalysis(an);
      drawCharts(an);
      window.__lastAnalysis = an;
    } catch (e) {
      body.innerHTML = `<div class="card">${UI.emptyState('fa-triangle-exclamation', 'خطا در تحلیل', esc(e.message))}</div>`;
      toast.error(e.message);
    }
  }

  function kpi(icon, label, value, color) {
    return `<div class="card" style="padding:14px 16px;display:flex;align-items:center;gap:12px;margin:0">
      <div class="head-icon" style="background:${color}18;color:${color};font-size:18px;width:44px;height:44px"><i class="fa-solid ${icon}"></i></div>
      <div><div style="font-size:12px;color:var(--muted)">${label}</div><div style="font-size:22px;font-weight:700">${value}</div></div>
    </div>`;
  }

  function renderAnalysis(an) {
    const k = an.kpis || {};
    const body = $('#anBody');
    const form = F.form || null;

    const kpiRow = `
    <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(180px,1fr));margin-bottom:16px">
      ${kpi('fa-phone-volume', 'تعداد فیدبک تماس', fa(k.totalCalls || 0), '#38bdf8')}
      ${kpi('fa-star-half-stroke', 'میانگین نمره', k.avgScore === '' ? '—' : fa(k.avgScore), '#34d399')}
      ${kpi('fa-ban', 'ردلاین', fa(k.redlineCount || 0), '#f87171')}
      ${kpi('fa-user-check', 'کارشناسان ارزیابی شده', fa(k.expertsWithData || 0), '#a78bfa')}
      ${kpi('fa-comment-dots', 'دارای کامنت QC', fa(k.withComment || 0), '#fbbf24')}
      ${kpi('fa-headphones', 'دارای زمان شنود', fa(k.listeningCalls || 0), '#f472b6')}
    </div>`;

    /* نمودارها */
    const chartsRow = `
    <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(360px,1fr));margin-bottom:16px">
      <div class="card"><div class="card-head"><div class="head-icon"><i class="fa-solid fa-chart-area"></i></div><div><h3>روند ماهانه</h3><div class="sub">میانگین نمره و تعداد فیدبک در هر ماه</div></div></div>
        <div class="ch-box" style="height:240px"><canvas id="chMonthly"></canvas></div></div>
      <div class="card"><div class="card-head"><div class="head-icon"><i class="fa-solid fa-chart-column"></i></div><div><h3 id="chElTitle">نرخ موفقیت معیارها</h3><div class="sub">درصد رعایت هر معیار در تماس‌های ارزیابی‌شده</div></div></div>
        <div class="ch-box" style="height:240px"><canvas id="chElements"></canvas></div></div>
    </div>`;

    /* جدول معیارها — با تگ نوع فرم که انتخاب شده */
    let ratesSection = '';
    const forms = form ? [form] : ['tele', 'account', 'mlm'];
    for (const ft of forms) {
      const rates = (an.elementRates && an.elementRates[ft]) || [];
      const ratesWithData = rates.filter((r) => r.total > 0);
      if (!ratesWithData.length) continue;
      const sorted = ratesWithData.slice().sort((a, b) => (a.successRate === '' ? 101 : a.successRate) - (b.successRate === '' ? 101 : b.successRate));
      ratesSection += `
      <div class="card" style="margin-bottom:16px">
        <div class="card-head"><div class="head-icon"><i class="fa-solid fa-list-check"></i></div>
          <div><h3>نرخ موفقیت معیارها — ${FORM_FA[ft]}</h3>
          <div class="sub">مرتب‌شده از ضعیف‌ترین؛ هر ردیف = درصد رعایت آن معیار در ${fa(sorted.length)} تست</div></div></div>
        <div class="card-pad" style="display:flex;flex-direction:column;gap:9px">
          ${sorted.map((r) => `
            <div style="display:flex;align-items:center;gap:10px">
              <div style="flex:0 0 280px;font-size:12px">${esc(r.label)} <span style="color:var(--muted);font-size:10px">(${fa(r.ok)}/${fa(r.total)})</span></div>
              <div style="flex:1;height:8px;background:rgba(148,163,184,.12);border-radius:999px;overflow:hidden">
                <div style="width:${r.successRate === '' ? 0 : r.successRate}%;height:100%;border-radius:999px;background:${r.successRate >= 90 ? '#34d399' : r.successRate >= 75 ? '#38bdf8' : r.successRate >= 50 ? '#fbbf24' : '#f87171'}"></div>
              </div>
              <div style="flex:0 0 54px;text-align:center;font-weight:600">${r.successRate === '' ? '—' : fa(r.successRate) + '٪'}</div>
            </div>`).join('')}
        </div>
      </div>`;
    }

    /* هیت‌مپ خطا */
    let heatSection = '';
    for (const ft of forms) {
      const h = (an.heatmaps && an.heatmaps[ft]) || { labels: [], keys: [], agents: [] };
      if (!h.agents.length) continue;
      heatSection += `
      <div class="card" style="margin-bottom:16px">
        <div class="card-head"><div class="head-icon"><i class="fa-solid fa-border-all"></i></div>
          <div><h3>ماتریس خطای کارشناس × معیار — ${FORM_FA[ft]}</h3>
          <div class="sub">هر خانه = درصد صفر آن معیار برای آن کارشناس؛ بالاترین خطا اول</div></div></div>
        <div class="table-responsive"><table class="tbl" style="font-size:11px;min-width:${100 + h.labels.length * 70}px">
          <thead><tr><th style="min-width:140px">کارشناس</th><th>میانگین</th>${h.labels.map((l) => `<th style="min-width:70px;writing-mode:vertical-rl;text-align:center;font-size:9px">${esc(l)}</th>`).join('')}</tr></thead>
          <tbody>${h.agents.map((a) => `
            <tr class="agent-row" data-agent="${esc(a.name)}" style="cursor:pointer" title="باز کردن پرونده ${esc(a.name)}">
              <td><span class="cell-main">${esc(a.name)}</span>${a.team ? ` <span class="tag-team">${esc(a.team)}</span>` : ''}<div style="font-size:10px;color:var(--muted)">${fa(a.count)} فیدبک</div></td>
              <td>${a.avg === '' ? '—' : scorePill(a.avg)}</td>
              ${a.cells.map((c) => `<td style="${heatColor(c ? c.errorRate : null)};text-align:center;border-radius:4px">${heatVal(c)}</td>`).join('')}
            </tr>`).join('')}
          </tbody></table></div>
      </div>`;
    }

    /* رتبه‌بندی */
    const lb = an.leaderboard || [];
    const leaderSection = `
      <div class="card" style="margin-bottom:16px">
        <div class="card-head"><div class="head-icon"><i class="fa-solid fa-ranking-star"></i></div>
          <div><h3>رتبه‌بندی کارشناسان</h3><div class="sub">${fa(lb.length)} کارشناس با دیتای تماس — کلیک = پرونده</div></div></div>
        <div class="table-wrap">
          ${lb.length ? `<table class="tbl"><thead><tr><th>#</th><th>کارشناس</th><th>تیم</th><th>تعداد</th><th>میانگین</th><th>ردلاین</th></tr></thead>
          <tbody>${lb.map((x, i) => `
            <tr class="agent-row" data-agent="${esc(x.name)}" style="cursor:pointer">
              <td>${fa(i + 1)}</td>
              <td><span class="cell-main">${esc(x.name)}</span></td>
              <td><span class="tag-team">${esc(x.team || '—')}</span></td>
              <td><b>${fa(x.count)}</b></td>
              <td>${x.avgScore === '' ? '—' : scorePill(x.avgScore)}</td>
              <td>${x.redlines ? `<span class="badge bad">${fa(x.redlines)}</span>` : '<span class="badge gray">۰</span>'}</td>
            </tr>`).join('')}</tbody></table>` : emptyState('fa-phone-slash', 'دیتای تماس در این بازه نیست', 'فایل اکسل QC را در پوشه data/calls بگذارید یا از صفحه فیدبک سامانه آپلود کنید')}
        </div>
      </div>`;

    /* ردلاین‌ها */
    const rls = an.redlines || [];
    const redlineSection = `
      <div class="card" style="margin-bottom:16px">
        <div class="card-head"><div class="head-icon" style="background:rgba(248,113,113,.12);color:#f87171"><i class="fa-solid fa-ban"></i></div>
          <div><h3>ردلاین‌ها</h3><div class="sub">${fa(rls.length)} مورد — مرتب‌شده بر اساس جدیدترین</div></div></div>
        <div class="card-pad">
          ${rls.length ? `<div style="display:flex;flex-direction:column;gap:8px">${rls.slice(0, 30).map((r) => `
            <div style="display:flex;gap:12px;align-items:flex-start;padding:10px 12px;border:1px solid rgba(248,113,113,.25);border-radius:10px;background:rgba(248,113,113,.05)">
              <span class="badge bad" style="margin-top:2px">ردلاین</span>
              <div style="flex:1;font-size:12px">
                <b class="agent-row" data-agent="${esc(r.expertName)}" style="cursor:pointer;color:var(--brand)">${esc(r.expertName)}</b>
                <span style="color:var(--muted)"> · ${FORM_FA[r.formType] || r.formType} · نمره ${r.score != null ? fa(r.score) : '—'}</span>
                <div style="color:#fca5a5;margin-top:4px">${esc(r.reason || '(علت ثبت نشده)')}</div>
                <div style="font-size:10px;color:var(--muted);margin-top:4px">لید: ${esc(r.leadName || '—')}${r.leadPhone ? ' (' + esc(r.leadPhone) + ')' : ''} · ${esc(r.date || '—')}</div>
              </div>
            </div>`).join('')}</div>
          ${rls.length > 30 ? `<div style="font-size:11px;color:var(--muted);margin-top:8px">... و ${fa(rls.length - 30)} مورد دیگر</div>` : ''}`
          : `<div style="color:var(--muted);text-align:center;padding:16px">در این بازه ردلاینی نیست — عالی است 🛡️</div>`}
        </div>
      </div>`;

    /* کامنت‌های QC */
    const cmts = an.comments || [];
    const commentSection = `
      <div class="card">
        <div class="card-head"><div class="head-icon" style="background:rgba(251,191,36,.12);color:#fbbf24"><i class="fa-solid fa-comment-dots"></i></div>
          <div><h3>کامنت‌های کارشناس QC</h3><div class="sub">${fa(cmts.length)} مورد — آخرین ۶۰ مورد</div></div></div>
        <div class="card-pad">
          ${cmts.length ? `<div style="display:flex;flex-direction:column;gap:8px">${cmts.slice(0, 25).map((r) => `
            <div style="display:flex;gap:12px;align-items:flex-start;padding:10px 12px;border:1px solid rgba(148,163,184,.15);border-radius:10px;">
              <div style="flex:1;font-size:12px">
                <b class="agent-row" data-agent="${esc(r.expertName)}" style="cursor:pointer;color:var(--brand)">${esc(r.expertName)}</b>
                <span style="color:var(--muted)"> · ${FORM_FA[r.formType] || r.formType} · نمره ${r.score != null ? fa(r.score) : '—'}</span>
                <div style="margin-top:4px">${esc(r.comment)}</div>
                <div style="font-size:10px;color:var(--muted);margin-top:4px">لید: ${esc(r.leadName || '—')} · ${esc(r.date || '—')}</div>
              </div>
            </div>`).join('')}</div>`
          : `<div style="color:var(--muted);text-align:center;padding:16px">هنوز کامنتی نیست</div>`}
        </div>
      </div>`;

    body.innerHTML = kpiRow + chartsRow + ratesSection + heatSection + leaderSection + redlineSection + commentSection;
    body.style.display = 'flex';
    body.style.flexDirection = 'column';
    body.style.gap = '0';

    /* کلیک → پرونده */
    $$('.agent-row', body).forEach((row) => {
      row.addEventListener('click', (e) => {
        e.stopPropagation();
        const name = row.dataset.agent;
        if (name) location.hash = '#/portfolio/' + encodeURIComponent(name);
      });
    });
  }

  function drawCharts(an) {
    /* روند ماهانه */
    const monthly = an.monthly || [];
    const labels = monthly.map((m) => m.month.replace('1405/', '').replace(/^1404/, '04/').replace(/^0*/, '') + ' ماه');
    const c1 = $('#chMonthly');
    if (c1 && monthly.length) {
      App.chart(c1, {
        type: 'line',
        data: {
          labels: monthly.map((m) => m.month),
          datasets: [
            { label: 'میانگین نمره', data: monthly.map((m) => m.avgScore || null), borderColor: '#34d399', backgroundColor: 'rgba(52,211,153,.12)', fill: true, tension: 0.35, yAxisID: 'y' },
            { label: 'تعداد فیدبک', data: monthly.map((m) => m.count), borderColor: '#38bdf8', backgroundColor: 'rgba(56,189,248,.1)', fill: true, tension: 0.35, yAxisID: 'y1' }
          ]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { display: true, rtl: true }, tooltip: { rtl: true } },
          scales: {
            y: { min: 0, max: 100, position: 'right', grid: { color: 'rgba(34,48,79,.5)' } },
            y1: { min: 0, position: 'left', grid: { drawOnChartArea: false } }
          }
        }
      });
    } else if (c1) {
      c1.parentElement.innerHTML = '<div style="color:var(--muted);text-align:center;padding:40px 0">دیتای ماهانه در این بازه نیست</div>';
    }
    /* نمودار ستونی معیارها — فرم جاری */
    const curF = F.form || 'mlm';
    const ratesAll = (an.elementRates && an.elementRates[curF]) || [];
    const withD = ratesAll.filter((r) => r.total > 0);
    const c2 = $('#chElements');
    const title = $('#chElTitle');
    if (title) title.textContent = 'نرخ موفقیت معیارها — ' + (FORM_FA[curF] || curF);
    if (c2 && withD.length) {
      const scoreColor = (v) => v >= 90 ? 'rgba(52,211,153,.8)' : v >= 75 ? 'rgba(56,189,248,.8)' : v >= 50 ? 'rgba(251,191,36,.8)' : 'rgba(248,113,113,.8)';
      App.chart(c2, {
        type: 'bar',
        data: {
          labels: withD.map((r) => r.label),
          datasets: [{ data: withD.map((r) => r.successRate), backgroundColor: withD.map((r) => scoreColor(r.successRate)), borderRadius: 6, borderSkipped: false }]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => ' رعایت: ' + fa(c.parsed.y) + '٪' }, rtl: true } },
          scales: { y: { min: 0, max: 100, grid: { color: 'rgba(34,48,79,.5)' } }, x: { grid: { display: false }, ticks: { maxRotation: 65, font: { size: 10 } } } }
        }
      });
    } else if (c2) {
      c2.parentElement.innerHTML = '<div style="color:var(--muted);text-align:center;padding:40px 0">دیتای معیار برای این فرم نیست</div>';
    }
  }

  /* خروجی اکسل تحلیل — ۵ شیت */
  $('#btnXls').addEventListener('click', () => {
    const an = window.__lastAnalysis;
    if (!an) return toast.info('ابتدا تحلیل بارگذاری شود');
    const sheets = [];
    sheets.push({ name: 'رتبه‌بندی', rows: [
      ['کارشناس', 'تیم', 'تعداد فیدبک', 'میانگین نمره', 'ردلاین'],
      ...(an.leaderboard || []).map((x) => [x.name, x.team, x.count, x.avgScore === '' ? '' : x.avgScore, x.redlines])
    ]});
    for (const ft of ['tele', 'account', 'mlm']) {
      const fa = FORM_FA[ft];
      const rates = (an.elementRates && an.elementRates[ft]) || [];
      if (!rates.filter((r) => r.total > 0).length) continue;
      sheets.push({ name: fa + ' - معیارها', rows: [
        ['معیار', 'کلید', 'رعایت شده', 'رعایت نشده', 'نرخ موفقیت٪'],
        ...rates.filter((r) => r.total > 0).map((r) => [r.label, r.key, r.ok, r.bad, r.successRate === '' ? '' : r.successRate])
      ]});
    }
    sheets.push({ name: 'ردلاین‌ها', rows: [
      ['کارشناس', 'تیم', 'نمره', 'علت', 'لید', 'تلفن لید', 'تاریخ', 'فایل'],
      ...(an.redlines || []).map((r) => [r.expertName, r.formType, r.score, r.reason, r.leadName, r.leadPhone, r.date, r.sourceFile || ''])
    ]});
    sheets.push({ name: 'کامنت‌های QC', rows: [
      ['کارشناس', 'تیم', 'نمره', 'کامنت', 'لید', 'تلفن لید', 'تاریخ'],
      ...(an.comments || []).map((r) => [r.expertName, r.formType, r.score, r.comment, r.leadName, r.leadPhone, r.date])
    ]});
    sheets.push({ name: 'ماهانه', rows: [
      ['ماه', 'تعداد فیدبک', 'میانگین', 'ردلاین'],
      ...(an.monthly || []).map((m) => [m.month, m.count, m.avgScore === '' ? '' : m.avgScore, m.redlines])
    ]});
    window.QCExport.sheets('تحلیل فیدبک تماس', sheets);
    toast.success('فایل اکسل تحلیل دانلود شد (' + fa(sheets.length) + ' شیت)');
  });

  load();
}

App.register('call-analysis', { title: 'تحلیل فیدبک تماس', render });
})();
