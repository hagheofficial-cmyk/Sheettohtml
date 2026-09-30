/* portfolio.js — پرونده کارشناس: فهرست همه‌ی کارشناسان دارای دیتا (تیکت/سوشال/تماس)
 * جستجو با نام یا داخلی + بازه تاریخِ تقویم. محاسبات به‌ازای هر تاریخ با منابع ترکیب می‌شود. */
(function () {
'use strict';
const { C, $, $$, api, fa, esc, el, toast, scorePill, rateCell, emptyState, debounce } = UI;

const FORM_TYPE_FA = { tele: 'رفتار تلفنی', account: 'تیم اکانت', mlm: 'MLM/BNPL' };

async function render(root) {
  root.innerHTML = `
    <div class="page-head">
      <div class="ph-ic"><i class="fa-solid fa-id-card-clip"></i></div>
      <div><h2>پرونده کارشناس</h2><p>فهرست همه‌ی کارشناسان دارای دیتا — کلیک روی هر سطر → جزئیات کامل + تفکیک به‌ازای هر تاریخ</p></div>
      <div class="spacer"></div>
    </div>

    <div class="card" style="margin-bottom:16px">
      <div class="filters" style="border-bottom:none;align-items:flex-end">
        <div class="field" style="flex:1.4;min-width:220px"><label>جستجوی کارشناس (نام یا داخلی)</label>
          <div style="position:relative">
            <input class="input" id="pSearch" placeholder="مثلاً: الهه عسگری یا ۳۰۱۲ یا 3012" dir="auto" autocomplete="off">
            <div id="pSugg" style="position:absolute;top:100%;left:0;right:0;background:var(--panel);border:1px solid var(--border);border-radius:0 0 10px 10px;max-height:230px;overflow-y:auto;z-index:50;display:none"></div>
          </div>
        </div>
        <div class="field grow-0"><label>از تاریخ</label>
          <div class="date-f"><input class="input" id="pFrom" dir="ltr" style="text-align:right;padding-left:34px" placeholder="۱۴۰۵/۰۶/۰۱" inputmode="numeric">
            <button type="button" class="cal-btn" id="pFromBtn" title="تقویم"><i class="fa-regular fa-calendar"></i></button></div>
        </div>
        <div class="field grow-0"><label>تا تاریخ</label>
          <div class="date-f"><input class="input" id="pTo" dir="ltr" style="text-align:right;padding-left:34px" placeholder="۱۴۰۵/۰۶/۳۱" inputmode="numeric">
            <button type="button" class="cal-btn" id="pToBtn" title="تقویم"><i class="fa-regular fa-calendar"></i></button></div>
        </div>
        <div class="field grow-0"><label>&nbsp;</label><button class="btn ghost" id="pReset"><i class="fa-solid fa-rotate-right"></i> بازنشانی</button></div>
        <div class="field grow-0"><label>&nbsp;</label><button class="btn success-soft" id="pXls" disabled><i class="fa-solid fa-file-excel"></i> خروجی اکسل</button></div>
      </div>
    </div>

    <div class="card" id="pAll" style="margin-bottom:16px"><div class="loading-page"><div class="spinner"></div><p>در حال بارگذاری فهرست کارشناسان…</p></div></div>

    <div id="pBody"></div>`;

  const agents = App.state.agents;
  let curAgent = null, curData = null, lastCombined = [];

  /* ------------------------- فهرست اصلی کارشناسان با دیتا ------------------------- */
  function periodQ() {
    const jf = C.parseJalali($('#pFrom').value), jt = C.parseJalali($('#pTo').value);
    const q = new URLSearchParams();
    if (jf) q.set('from', C.formatJalali(jf));
    if (jt) q.set('to', C.formatJalali(jt));
    return q;
  }

  async function renderMaster() {
    const wrap = $('#pAll');
    wrap.innerHTML = `<div class="loading-page"><div class="spinner"></div><p>در حال بارگذاری فهرست…</p></div>`;
    try {
      const q = periodQ();
      const d = await api.get('/api/reports?type=combined&level=agent&' + q.toString());
      const rows = (d.rows || []).slice().sort((a, b) => (b.totalCount || 0) - (a.totalCount || 0));
      lastCombined = rows;
      if (!rows.length) { wrap.innerHTML = `<div class="card-pad">${emptyState('fa-users', 'هنوز دیتایی نیست', 'تیکت/سوشال ثبت کن یا فایل‌های QC تماس را در پوشه‌ی data/calls بگذار تا طرح‌ها نمایش داده شوند.')}</div>`; return; }
      wrap.innerHTML = `
        <div class="card-head teal"><div class="head-icon"><i class="fa-solid fa-users"></i></div>
          <div><h3>همه‌ی کارشناسان دارای دیتا (${fa(rows.length)} نفر)</h3><div class="sub">کلیک روی سطر → پرونده کامل</div></div></div>
        <div class="table-wrap" style="max-height:400px;overflow-y:auto">
          <table class="tbl">
            <thead><tr>
              <th>کارشناس</th><th>تیم</th>
              <th>تیکت</th><th>میانگین</th>
              <th>سوشال</th><th>میانگین</th>
              <th>SLA واقعی</th>
              <th>تماس</th><th>میانگین</th><th>ردلاین</th>
              <th>مجموع</th><th>میانگین کل</th>
            </tr></thead>
            <tbody>${rows.map(r => `<tr style="cursor:pointer" data-name="${esc(r.name)}" title="جزئیات ${esc(r.name)}">
              <td class="cell-main">${esc(r.name)}</td>
              <td><span class="tag-team">${esc(r.team || '—')}</span></td>
              <td>${fa(r.ticketCount || 0)}</td><td>${r.ticketAvg === '' ? '—' : scorePill(r.ticketAvg)}</td>
              <td>${fa(r.socialCount || 0)}</td><td>${r.socialAvg === '' ? '—' : scorePill(r.socialAvg)}</td>
              <td>${r.socialSlaReal === '' ? '—' : fa(r.socialSlaReal) + '٪'}</td>
              <td>${fa(r.callCount || 0)}</td><td>${r.callAvg === '' ? '—' : scorePill(r.callAvg)}</td>
              <td>${r.callRedline ? `<span class="batch bad">${fa(r.callRedline)}</span>` : '—'}</td>
              <td><b>${fa(r.totalCount || 0)}</b></td>
              <td>${r.avgScore === '' ? '—' : scorePill(r.avgScore)}</td>
            </tr>`).join('')}</tbody>
          </table>
        </div>`;
      $$('tbody tr', wrap).forEach(tr => tr.addEventListener('click', () => pickAgent(tr.dataset.name)));
    } catch (e) {
      wrap.innerHTML = `<div class="card-pad">${emptyState('fa-triangle-exclamation', 'خطای بارگذاری', e.message)}</div>`;
    }
  }

  /* ------------------------- جستجوی نام ------------------------- */
  function matchAgents(q) {
    q = C.faToEn(String(q || '')).trim().toLowerCase();
    if (!q) return [];
    const dig = q.replace(/[^0-9]/g, '');
    const fromAgents = agents.filter(a =>
      a.name.toLowerCase().includes(q) || (dig.length >= 2 && String(a.ext).includes(dig)));
    // + کارشناسان دیتای تماس که درگانسی نیستند
    const agentNames = new Set(agents.map(a => a.name));
    const callOnly = (lastCombined || [])
      .filter(r => !agentNames.has(r.name) && r.name && r.name.toLowerCase().includes(q))
      .map(r => ({ name: r.name, team: r.team || '(دیتای تماس)', ext: null, active: true }));
    return [...fromAgents, ...callOnly];
  }

  function renderSugg() {
    const list = matchAgents($('#pSearch').value).slice(0, 12);
    const sugg = $('#pSugg');
    if (!list.length) { sugg.style.display = 'none'; sugg.innerHTML = ''; return; }
    sugg.innerHTML = list.map(a => `
      <button class="btn ghost" style="display:flex;justify-content:space-between;width:100%;border-radius:0;border-bottom:1px solid var(--border)" data-name="${esc(a.name)}">
        <span>${esc(a.name)}</span>
        <span style="color:var(--muted);font-size:11px">${a.ext != null ? 'داخلی ' + fa(a.ext) : ''} · ${esc(a.team)}</span>
      </button>`).join('');
    sugg.style.display = 'block';
    $$('button', sugg).forEach(b => b.addEventListener('mousedown', (e) => {
      e.preventDefault();
      pickAgent(b.dataset.name);
      sugg.style.display = 'none';
    }));
  }

  $('#pSearch').addEventListener('input', debounce(renderSugg, 150));
  $('#pSearch').addEventListener('focus', renderSugg);
  $('#pSearch').addEventListener('blur', () => setTimeout(() => { $('#pSugg').style.display = 'none'; }, 180));
  $('#pSearch').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const list = matchAgents($('#pSearch').value);
      if (list.length) { pickAgent(list[0].name); $('#pSugg').style.display = 'none'; }
    }
  });

  async function pickAgent(name) {
    $('#pSearch').value = name;
    await load(name);
    $('#pXls').disabled = false;
    // اسکرول به پرونده
    try { $('#pBody').scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (_) {}
  }

  $('#pFrom').addEventListener('change', () => { renderMaster(); if (curAgent) load(curAgent); });
  $('#pTo').addEventListener('change', () => { renderMaster(); if (curAgent) load(curAgent); });
  JCal.attach($('#pFromBtn'), { onPick(j) { $('#pFrom').value = j ? C.formatJalali(j) : ''; renderMaster(); if (curAgent) load(curAgent); } });
  JCal.attach($('#pToBtn'), { onPick(j) { $('#pTo').value = j ? C.formatJalali(j) : ''; renderMaster(); if (curAgent) load(curAgent); } });
  $('#pReset').addEventListener('click', () => {
    $('#pSearch').value = ''; $('#pFrom').value = ''; $('#pTo').value = ''; curAgent = null; curData = null;
    $('#pBody').innerHTML = '';
    $('#pXls').disabled = true;
    renderMaster();
  });

  async function load(name) {
    const body = $('#pBody');
    body.innerHTML = `<div class="loading-page"><div class="spinner"></div></div>`;
    const q = periodQ(); q.set('ident', name);
    try {
      const data = await api.get('/api/portfolio?' + q.toString());
      curAgent = name; curData = data;
      const from1 = $('#pFrom').value, to1 = $('#pTo').value;
      const periodOr = from1 || to1 ? ('بازه ' + fa(from1 || '…') + ' تا ' + fa(to1 || '…')) : 'همه دوره‌ها';
      renderProfile(body, data, periodOr);
    } catch (e) {
      curData = null;
      body.innerHTML = `<div class="card">${emptyState('fa-circle-exclamation', 'خطا', e.message)}</div>`;
    }
  }

  /* ------------------------------ رندر ------------------------------ */
  const kpi = (icon, label, val, sub, cls) => `
    <div class="kpi ${cls || ''}">
      <div class="kpi-ic"><i class="fa-solid ${icon}"></i></div>
      <div><div class="kpi-val">${val}</div><div class="kpi-lbl">${label}</div>${sub ? `<div style="font-size:11px;color:var(--muted);margin-top:4px">${sub}</div>` : ''}</div>
    </div>`;

  function ticketTable(rows) {
    if (!rows.length) return emptyState('fa-ticket', 'بدون سوابق تیکت', '');
    return `<table class="tbl"><thead><tr><th>کد تیکت</th><th>تاریخ بررسی</th><th>نمره</th></tr></thead>
      <tbody>${rows.slice().sort((a, b) => (b.id - a.id)).map(r => `<tr>
        <td>${esc(r.ticketCode)}</td><td dir="ltr">${fa(r.reviewDate)}</td><td>${scorePill(r.score)}</td></tr>`).join('')}</tbody></table>`;
  }
  function socialTable(rows) {
    if (!rows.length) return emptyState('fa-comments', 'بدون سوابق سوشال', '');
    const slaTxt = (s) => s.slaStatus === 'رعایت شده' ? '<span class="badge ok">رعایت</span>' : s.slaStatus === 'رعایت نشده' ? '<span class="badge bad">رد شده</span>' : '—';
    return `<table class="tbl"><thead><tr><th>تاریخ بررسی</th><th>SLA</th><th>نمره</th></tr></thead>
      <tbody>${rows.slice().sort((a, b) => (b.id - a.id)).map(r => `<tr>
        <td dir="ltr">${fa(r.reviewDate)}</td><td>${slaTxt(r)}</td><td>${scorePill(r.score)}</td></tr>`).join('')}</tbody></table>`;
  }
  function callTable(rows) {
    if (!rows.length) return emptyState('fa-headset', 'بدون دیتای فیدبک تماس', 'فایل فرمان QC را در data/calls بگذار یا با دکمه‌ی ایمپورت در صفحه‌ی مدیریت پایه وارد کن');
    return `<table class="tbl"><thead><tr><th>تاریخ بررسی</th><th>لید</th><th>نوع</th><th>نمره</th><th>ردلاین</th><th>زمان</th></tr></thead>
      <tbody>${rows.slice().sort((a, b) => (b.reviewDate || '').localeCompare(a.reviewDate || '')).map(r => `<tr>
        <td dir="ltr">${fa(r.reviewDate || '—')}</td>
        <td>${esc(r.leadName)}<div style="font-size:10px;color:var(--muted)" dir="ltr">${esc(r.leadPhone)}</div></td>
        <td><span class="tag-team">${FORM_TYPE_FA[r.formType] || r.formType}</span></td>
        <td>${scorePill(r.score)}</td>
        <td>${r.redline === 1 ? `<span class="badge bad" title="${esc(r.redlineReason || '')}">بله</span>` : '—'}</td>
        <td style="font-size:11px;color:var(--muted)">${esc(r.listeningTime)}</td></tr>`).join('')}</tbody></table>`;
  }

  /* ---------- تفکیک فایل‌محور تماس‌ها ─ هر فایل یک بلوک کاراسمان┘ص */
  function filesBreakdown(rows) {
    const byFile = {};
    rows.forEach(r => {
      const k = r.sourceFile || '(بدون فایل شناخته‌شده — از پنل/ایمپورت recovery)';
      (byFile[k] = byFile[k] || []).push(r);
    });
    const fileNames = Object.keys(byFile);
    if (!fileNames.length) return '';
    return `<div class="card" style="margin-bottom:16px">
      <div class="card-head"><div class="head-icon"><i class="fa-solid fa-folder-open"></i></div>
        <div><h3>تفکیک به‌ازای هر فایل QC (${fa(fileNames.length)} فایل)</h3><div class="sub">هر فایل توسط سرور در پوشه‌ی data/calls اسکن و این رکوردها را آورده</div></div></div>
      <div class="table-wrap">
        <table class="tbl"><thead><tr><th>فایل</th><th>نوع</th><th>ردیف</th><th>میانگین</th><th>ردلاین</th><th>بازه تاریخ</th></tr></thead>
        <tbody>${fileNames.map(fn => {
          const rs = byFile[fn];
          const avg = rs.length ? C.round2(rs.reduce((a, x) => a + (x.score || 0), 0) / rs.length) : '';
          const dts = rs.map(x => x.reviewDate).filter(Boolean).sort();
          const range = dts.length ? (dts[0] === dts[dts.length - 1] ? fa(dts[0]) : fa(dts[0]) + ' تا ' + fa(dts[dts.length - 1])) : '—';
          return `<tr>
            <td style="font-size:11px;direction:ltr;text-align:right">${esc(fn)}</td>
            <td><span class="tag-team">${FORM_TYPE_FA[rs[0].formType] || rs[0].formType}</span></td>
            <td>${fa(rs.length)}</td><td>${avg === '' ? '—' : scorePill(avg)}</td>
            <td>${rs.filter(x => x.redline === 1).length ? fa(rs.filter(x => x.redline === 1).length) : '—'}</td>
            <td dir="ltr">${range}</td>
          </tr>`;
        }).join('')}</tbody></table>
      </div></div>`;
  }

  /* ---------- جدول روزانهی ترکیبی: هر تاریخ — تیکت + سوشال + تماس ---------- */
  function dailyCard(daily) {
    if (!Array.isArray(daily) || !daily.length) return '';
    const rowsHtml = daily.map(r => `<tr>
      <td dir="ltr">${r.date === 'بدون تاریخ' ? esc(r.date) : fa(r.date)}</td>
      <td>${r.ticketCount ? fa(r.ticketCount) : '—'}</td><td>${r.ticketAvg === '' ? '—' : scorePill(r.ticketAvg)}</td>
      <td>${r.socialCount ? fa(r.socialCount) : '—'}</td><td>${r.socialAvg === '' ? '—' : scorePill(r.socialAvg)}</td>
      <td>${r.callCount ? fa(r.callCount) : '—'}</td><td>${r.callAvg === '' ? '—' : scorePill(r.callAvg)}</td>
      <td style="font-size:11px">${r.byType.mlm ? 'MLM:' + fa(r.byType.mlm) + ' ' : ''}${r.byType.tele ? 'تل:' + fa(r.byType.tele) + ' ' : ''}${r.byType.account ? 'اکانت:' + fa(r.byType.account) : ''}</td>
      <td>${r.redlines ? `<span class="badge bad">${fa(r.redlines)}</span>` : '—'}</td>
    </tr>`).join('');
    return `<div class="card" style="margin-bottom:16px">
      <div class="card-head amber"><div class="head-icon"><i class="fa-solid fa-calendar-days"></i></div>
        <div><h3>تفکیک به‌ازای هر تاریخ (${fa(daily.length)} روز)</h3><div class="sub">تیکت و سوشال و تماس در یک سطر — محاسبات فایل QC تماس با ریت سوشال/تیکت همان روز یکجاست</div></div></div>
      <div class="table-wrap" style="max-height:360px;overflow-y:auto">
        <table class="tbl">
          <thead><tr><th>تاریخ</th><th>تیکت</th><th>میانگین</th><th>سوشال</th><th>میانگین</th><th>تماس</th><th>میانگین</th><th>جزئیات نوع تماس</th><th>ردلاین</th></tr></thead>
          <tbody>${rowsHtml}</tbody>
        </table>
      </div></div>`;
  }

  /* ---------- کارت نرخ موفقیت معیارهای تماس (پرتفوی) ---------- */
  function criteriaCard(byTypeRates) {
    if (!Array.isArray(byTypeRates) || !byTypeRates.length) return '';
    const FORM__LABEL = { tele: 'رفتار تلفنی', account: 'تیم اکانت', mlm: 'MLM/BNPL' };
    const ids = [];
    const cards = byTypeRates.map((bt, bi) => {
      if (!bt.rates || !bt.rates.length) return '';
      const rows = bt.rates.map((r, ri) => {
        const lbl = (window.QCParse && window.QCParse.labelOf) ? window.QCParse.labelOf(bt.form, r.key) : r.key;
        const cid = 'cr-' + bi + '-' + ri;
        ids.push(cid);
        const st = r.successRate === '' ? null : r.successRate;
        const bar = st == null ? `width:0%` : st >= 90 ? `width:${st}%;background:#34d399` : st >= 75 ? `width:${st}%;background:#38bdf8` : st >= 50 ? `width:${st}%;background:#fbbf24` : `width:${st}%;background:#f87171`;
        return `<tr>
          <td style="font-size:12px">${esc(lbl)} <span style="color:var(--muted);font-size:10px">(${fa(r.ok)}/${fa(r.total)})</span></td>
          <td style="width:1%;white-space:nowrap;text-align:center">
            <div style="display:flex;align-items:center;gap:8px">
              <div style="flex:1;height:7px;background:rgba(148,163,184,.12);border-radius:999px;overflow:hidden;min-width:120px"><div style="${bar};height:100%;border-radius:999px"></div></div>
              <span style="flex-shrink:0;font-weight:600;font-size:12px;width:44px;text-align:left">${st == null ? '—' : fa(st) + '٪'}</span>
            </div>
          </td>
        </tr>`;
      }).join('');
      return `
        <div class="card" style="margin-bottom:0">
          <div class="card-head"><div class="head-icon"><i class="fa-solid fa-list-check"></i></div>
            <div><h3>نرخ موفقیت معیار‌ها — ${FORM__LABEL[bt.form] || bt.form}</h3>
            <div class="sub">${fa(bt.count)} تماس ارزیابی‌شده${bt.weak ? ` · ${fa(bt.weak)} معیار ضعیف (<100٪)` : ''}</div></div></div>
          <div class="table-wrap"><table class="tbl"><tbody>${rows}</tbody></table></div>
        </div>`;
    }).filter(Boolean).join('');

    return `<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(400px,1fr));gap:14px;margin-bottom:16px">${cards}</div>`;
  }

  /* ---------- کارت ردلاین‌های کارشناس با علت ---------- */
  function redlineCard(redlineRows) {
    if (!Array.isArray(redlineRows) || !redlineRows.length) return '';
    return `<div class="card" style="margin-bottom:16px">
      <div class="card-head" style="border-color:rgba(248,113,113,.3)">
        <div class="head-icon" style="background:rgba(248,113,113,.12);color:#f87171"><i class="fa-solid fa-ban"></i></div>
        <div><h3>ردلاین‌ها (${fa(redlineRows.length)} مورد)</h3><div class="sub">علت و جزئیات هر ردلاین — کلیک روی لید = جستجو</div></div></div>
      <div class="table-wrap">
        <table class="tbl"><thead><tr><th>تاریخ</th><th>لید</th><th>نوع</th><th>نمره</th><th>علت ردلاین</th></tr></thead>
        <tbody>${redlineRows.map((r) => `<tr>
          <td dir="ltr">${fa(r.date || '—')}</td>
          <td>${esc(r.leadName || '—')}<div style="font-size:10px;color:var(--muted)" dir="ltr">${esc(r.leadPhone || '')}</div></td>
          <td><span class="tag-team">${FORM_TYPE_FA[r.formType] || r.formType}</span></td>
          <td>${r.score != null ? scorePill(r.score) : '—'}</td>
          <td style="font-size:12px;color:#fca5a5;max-width:300px">${esc(r.reason || '(ثبت نشده)')}${r.qcComment ? `<div style="font-size:10px;color:var(--muted);margin-top:2px">"${esc(r.qcComment)}"</div>` : ''}</td>
        </tr>`).join('')}</tbody></table></div></div>`;
  }

  function renderProfile(body, d, periodLabel) {
    const a = d.agent;
    const monthLine = periodLabel && periodLabel !== 'همه دوره‌ها' ? `<span class="tag-team" style="background:rgba(167,139,250,.12);color:#a78bfa;border-color:rgba(167,139,250,.3)"><i class="fa-regular fa-calendar"></i> ${esc(periodLabel)}</span>` : '<span class="tag-team">همه دوره‌ها</span>';
    const T = d.tickets, S = d.socials, Ph = d.calls;

    const allKeys = [...new Set([
      ...d.monthly.tickets.map(m => m.key),
      ...d.monthly.socials.map(m => m.key),
      ...d.monthly.calls.map(m => m.key)
    ])].sort();
    const mIdx = (arr, k) => arr.find(m => m.key === k);
    const labels = allKeys.map(k => {
      const m = mIdx(d.monthly.tickets, k) || mIdx(d.monthly.socials, k) || mIdx(d.monthly.calls, k);
      return m.monthFa;
    });

    const typeRows = Ph.byType.length
      ? Ph.byType.map(t => `<span class="tag-team">${FORM_TYPE_FA[t.type] || t.type}: ${fa(t.count)} تماس · میانگین ${t.avg === '' ? '—' : scorePill(t.avg)}</span>`).join(' ')
      : '<span class="tag-team" style="opacity:.5">دیتای فیدبک تماس برای این کارشناس یافت نشد</span>';

    body.innerHTML = `
      <!-- شناسنامه -->
      <div class="card" style="margin-bottom:16px">
        <div class="card-pad" style="display:flex;flex-wrap:wrap;gap:14px;align-items:center">
          <div style="width:56px;height:56px;border-radius:16px;background:linear-gradient(135deg,var(--brand),var(--violet));display:flex;align-items:center;justify-content:center;font-size:26px;color:#fff;flex-shrink:0">
            <i class="fa-solid fa-user"></i>
          </div>
          <div style="flex:1;min-width:180px">
            <div style="font-size:19px;font-weight:800">${esc(a.name)}</div>
            <div style="display:flex;gap:9px;flex-wrap:wrap;margin-top:7px">
              <span class="tag-team">${esc(a.team)}</span>
              ${a.ext != null ? `<span class="badge gray"><i class="fa-solid fa-hashtag"></i> داخلی ${fa(a.ext)}</span>` : ''}
              <span class="badge ${a.active ? 'ok' : 'bad'}">${a.active ? 'فعال' : 'بایگانی'}</span>
              ${monthLine}
            </div>
          </div>
        </div>
      </div>

      <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(240px,1fr));margin-bottom:16px">
        ${kpi('fa-ticket', 'ارزیابی تیکت', `${fa(T.count)}`,
          T.avgScore === '' ? '' : `میانگین ${scorePill(T.avgScore)}`, T.redlineZero > 0 ? 'warn' : '')}
        ${kpi('fa-comments', 'ارزیابی سوشال', `${fa(S.count)}`,
          `${S.slaReal === '' ? '' : 'SLA ' + fa(S.slaReal) + '٪'}${S.unanswered ? ' · عدم پاسخ ' + fa(S.unanswered) : ''}`,
          S.slaReal !== '' && S.slaReal < 70 ? 'warn' : '')}
        ${kpi('fa-headset', 'فیدبک تماس', `${fa(Ph.count)}`,
          Ph.avgScore === '' ? '' : `میانگین ${fa(Ph.avgScore)}${Ph.redlineCount ? ' · ردلاین ' + fa(Ph.redlineCount) : ''}`,
          Ph.redlineCount > 0 ? 'danger' : '')}
      </div>

      ${dailyCard(d.daily)}
      ${filesBreakdown(Ph.rows)}
      ${criteriaCard(Ph.byTypeRates)}
      ${redlineCard(Ph.redlineRows)}

      ${allKeys.length ? `
      <div class="card" style="margin-bottom:16px">
        <div class="card-head violet"><div class="head-icon"><i class="fa-solid fa-chart-line"></i></div>
          <div><h3>روند ماهانه نمره‌ها</h3><div class="sub">میانگین هر ماه شمسی به تفکیک منبع</div></div></div>
        <div class="chart-box" style="height:260px"><canvas id="pmChart"></canvas></div>
      </div>` : ''}

      <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(340px,1fr))">
        <div class="card">
          <div class="card-head"><div class="head-icon"><i class="fa-solid fa-ticket"></i></div><div><h3>سوابق تیکت (${fa(T.count)})</h3></div></div>
          <div class="table-wrap" style="max-height:340px;overflow-y:auto">${ticketTable(T.rows)}</div>
        </div>
        <div class="card">
          <div class="card-head teal"><div class="head-icon"><i class="fa-solid fa-comments"></i></div><div><h3>سوابق سوشال (${fa(S.count)})</h3></div></div>
          <div class="table-wrap" style="max-height:340px;overflow-y:auto">${socialTable(S.rows)}</div>
        </div>
        <div class="card">
          <div class="card-head violet"><div class="head-icon"><i class="fa-solid fa-headset"></i></div><div><h3>فیدبک تماس (${fa(Ph.count)})</h3></div></div>
          <div class="card-pad" style="border-bottom:1px solid var(--border);padding:9px 14px;font-size:12px">${typeRows}</div>
          <div class="table-wrap" style="max-height:340px;overflow-y:auto">${callTable(Ph.rows)}</div>
        </div>
      </div>

      ${(d.actions.length || true) ? `
      <div class="card" style="margin-top:16px">
        <div class="card-head"><div class="head-icon"><i class="fa-solid fa-clipboard-list"></i></div>
          <div><h3>اقدامات اصلاحی و توافقات فیدبک (${fa(d.actions.length)})</h3>
          <div class="sub">${d.voiceCount ? `فایل‌های ویس: ${fa(d.voiceCount)} · ` : ''}فقط اقدامات ثبت‌شده در همین سامانه قابل تغییر وضعیت‌اند</div>
          </div>
          <div class="spacer"></div>
          <button class="btn success-soft" id="pAddAction"><i class="fa-solid fa-plus"></i> ثبت اقدام جدید</button>
        </div>
        <div id="pActionsWrap" class="card-pad" style="display:flex;flex-direction:column;gap:8px;max-height:300px;overflow-y:auto">
          ${d.actions.length ? d.actions.map(x => `
            <div class="action-row" style="display:flex;gap:10px;align-items:center;padding:9px;background:var(--panel-soft);border-radius:9px" data-id="${x.id || ''}" data-src="${esc(x.source)}">
              <span class="badge ${x.status === 'انجام شده' ? 'ok' : 'warn'} pStatus" style="cursor:${x.source === 'system' ? 'pointer' : 'default'}" title="${x.source === 'system' ? 'کلیک = تغییر وضعیت' : 'از پنل است — وضعیت را آن‌جا عوض کنید'}">${esc(x.status)}</span>
              <span style="flex:1">${esc(x.title)}</span>
              ${x.source === 'system' ? `<button class="btn ghost pDel" style="padding:4px 8px" title="حذف"><i class="fa-solid fa-trash"></i></button>` : `<span class="badge gray" style="font-size:10px">پنل</span>`}
              <span style="color:var(--muted);font-size:11px">${esc(x.date)}</span>
            </div>`).join('')
          : '<div style="color:var(--muted);text-align:center;padding:16px;font-size:12px">هنوز اقدامی ثبت نشده — تیکت‌گذر یا فیدبک اول را با «ثبت اقدام جدید» یادداشت کنید</div>'}
        </div>
      </div>` : ''}`;

    if (d.actions.length || true) {
      const wrap = $('#pActionsWrap');
      $('#pAddAction').addEventListener('click', () => {
        const title = prompt('عنوان اقدام اصلاحی را وارد کنید:');
        if (!title || !title.trim()) return;
        api.post('/api/actions', { agent: curAgent, title: title.trim() })
          .then((it) => {
            if (!wrap.querySelector('.action-row')) wrap.innerHTML = '';
            const div = document.createElement('div');
            div.className = 'action-row';
            div.style.cssText = 'display:flex;gap:10px;align-items:center;padding:9px;background:var(--panel-soft);border-radius:9px';
            div.dataset.id = it.id;
            div.dataset.src = 'system';
            div.innerHTML = `<span class="badge warn pStatus" style="cursor:pointer">انجام نشده</span>
              <span style="flex:1">${esc(it.title)}</span>
              <button class="btn ghost pDel" style="padding:4px 8px"><i class="fa-solid fa-trash"></i></button>
              <span style="color:var(--muted);font-size:11px">${esc(it.date)}</span>`;
            wrap.prepend(div);
            attachRowHandlers(div);
            toast.success('اقدام ثبت شد');
          })
          .catch((e) => toast.error(e.message));
      });

      function attachRowHandlers(row) {
        const id = +row.dataset.id, src = row.dataset.src;
        const badge = row.querySelector('.pStatus');
        const del = row.querySelector('.pDel');
        if (src !== 'system') return;
        if (badge) badge.addEventListener('click', () => {
          const next = badge.classList.contains('ok') ? 'انجام نشده' : 'انجام شده';
          api.put('/api/actions/' + id, { status: next })
            .then((it) => {
              badge.className = 'badge ' + (it.status === 'انجام شده' ? 'ok' : 'warn') + ' pStatus';
              badge.textContent = it.status;
              toast.success('وضعیت به "' + next + '" تغییر یافت');
            })
            .catch((e) => toast.error(e.message));
        });
        if (del) del.addEventListener('click', () => {
          if (!confirm('این اقدام برای همیشه حذف شود؟')) return;
          api.del('/api/actions/' + id)
            .then(() => { row.remove(); toast.success('حذف شد'); })
            .catch((e) => toast.error(e.message));
        });
      }

      $$('.action-row', wrap).forEach(attachRowHandlers);
    }

    if (allKeys.length) {
      const mkLine = (arr, color) => ({
        label: '', borderColor: color, backgroundColor: color + '33', tension: .35, pointRadius: 3,
        data: allKeys.map(k => { const m = mIdx(arr, k); return m && m.avgScore !== '' ? m.avgScore : null; })
      });
      App.chart($('#pmChart'), {
        type: 'line',
        data: {
          labels,
          datasets: [
            Object.assign(mkLine(d.monthly.tickets, '#38bdf8'), { label: 'تیکت' }),
            Object.assign(mkLine(d.monthly.socials, '#a78bfa'), { label: 'سوشال' }),
            Object.assign(mkLine(d.monthly.calls, '#34d399'), { label: 'تماس' })
          ]
        },
        options: { responsive: true, maintainAspectRatio: false, spanGaps: true, plugins: { legend: { position: 'bottom' } }, scales: { y: { min: 0, max: 100 } } }
      });
    }
  }

  /* ------------------------------ اکسل ------------------------------ */
  $('#pXls').addEventListener('click', () => {
    if (!curData) return;
    const a = curData.agent;
    const rowsT = [['کد تیکت', 'تاریخ بررسی', 'تاریخ تیکت', 'q1', 'q2', 'q3', 'q4', 'ردلاین', 'نمره'], ...curData.tickets.rows.map(r => [r.ticketCode, r.reviewDate, r.ticketDate, r.q1, r.q2, r.q3, r.q4, r.redline, r.score])];
    const rowsS = [['تاریخ بررسی', 'وضعیت', 'شروع', 'پایان', 'دقیقه کاری', 'SLA', 'نمره'], ...curData.socials.rows.map(r => [r.reviewDate, r.responseStatus, r.receiveDate + ' ' + r.receiveTime, r.replyDate + ' ' + r.replyTime, r.durationMin, r.slaStatus, r.score])];
    const rowsP = [['تاریخ بررسی', 'نام لید', 'تلفن', 'نوع فرم', 'نمره', 'ردلاین', 'علت', 'کامنت'], ...curData.calls.rows.map(r => [r.reviewDate, r.leadName, r.leadPhone, r.formType, r.score, r.redline, r.redlineReason, r.qcComment])];
    const rowsD = [['تاریخ', 'تیکت', 'میانگین تیکت', 'سوشال', 'میانگین سوشال', 'تماس', 'میانگین تماس', 'تلفنی', 'اکانت', 'MLM', 'ردلاین'], ...(curData.daily || []).map(r => [r.date, r.ticketCount, r.ticketAvg, r.socialCount, r.socialAvg, r.callCount, r.callAvg, r.byType.tele, r.byType.account, r.byType.mlm, r.redlines])];
    window.QCExport.sheets(`${a.name} — پرونده`, [
      { name: 'تیکت', rows: rowsT },
      { name: 'سوشال', rows: rowsS },
      { name: 'تماس', rows: rowsP },
      { name: 'روزانه ترکیبی', rows: rowsD }
    ]);
  });

  renderMaster();
}

App.register('portfolio', { title: 'پرونده کارشناس', render });
})();
