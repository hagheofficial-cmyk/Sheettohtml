/* portfolio.js — پرونده‌ی همه‌ی کارشناسان رجیستری، حتی بدون ارزیابی؛ تیم + بازه‌ی سراسری. */
(function () {
'use strict';
const { C, $, $$, api, fa, esc, el, toast, scorePill, rateCell, emptyState, debounce, scoreColorHex, triValue, callRedlineBadge, bindCallRedlines, callTimeCell } = UI;

const FORM_TYPE_FA = { tele: 'Telesales', account: 'تیم اکانت', mlm: 'MLM/BNPL' };

async function render(root, arg) {
  root.innerHTML = `
    <div class="page-head">
      <div class="ph-ic"><i class="fa-solid fa-id-card-clip"></i></div>
      <div><h2>پرونده کارشناس</h2><p>همه‌ی کارشناسان مدیریت کارشناسان — کلیک روی هر سطر برای نمره‌ها، معیارها و جزئیات هر تماس</p></div>
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
        <div id="pTeamSlot"></div>
        <div class="field grow-0"><label>&nbsp;</label><button class="btn ghost" id="pReset"><i class="fa-solid fa-rotate-right"></i> بازنشانی</button></div>

      </div>
    </div>

    <div class="card" id="pAll" style="margin-bottom:16px"><div class="loading-page"><div class="spinner"></div><p>در حال بارگذاری فهرست کارشناسان…</p></div></div>

`;

  const agents = await api.get('/api/agents');
  const master = $('#pAll', root), sugg = $('#pSugg', root);
  let profileBody = null, profileModal = null;
  if (!master) return;
  let curAgent = null, curData = null, lastCombined = [], historyCalls = [];
  let masterId = 0, profileId = 0;
  const teams = [...new Set(agents.map((a) => a.team).filter(Boolean))];
  const msTeams = UI.multiSelect({ label: 'تیم کارشناس', allLabel: 'همه تیم‌ها',
    items: teams.map((t) => ({ value: t, label: t })), onChange: () => {
      const selected = msTeams.getValues();
      if (curAgent && selected.length && !selected.includes((agents.find((a) => a.name === curAgent) || {}).team)) {
        clearProfile();
      }
      refresh();
    } });
  $('#pTeamSlot').replaceWith(msTeams);

  /* ------------------------- فهرست اصلی کارشناسان با دیتا ------------------------- */
  function periodQ() {
    const q = new URLSearchParams();
    const selected = msTeams.getValues();
    if (selected.length) q.set('team', selected.join(','));
    return q;
  }

  async function renderMaster() {
    const wrap = master, request = ++masterId;
    if (!wrap.isConnected) return;
    wrap.innerHTML = `<div class="loading-page"><div class="spinner"></div><p>در حال بارگذاری فهرست…</p></div>`;
    try {
      const q = periodQ();
      const d = await api.get('/api/portfolio/agents?' + q.toString());
      if (request !== masterId || !wrap.isConnected) return;
      const rows = (d.rows || []).slice().sort((a, b) => (b.totalCount || 0) - (a.totalCount || 0));
      lastCombined = rows;
      if (!rows.length) { wrap.innerHTML = `<div class="card-pad">${emptyState('fa-users', 'کارشناسی در این تیم نیست', 'کارشناس را در مدیریت کارشناسان اضافه کنید یا فیلتر تیم را تغییر دهید.')}</div>`; return; }
      wrap.innerHTML = `
        <div class="card-head teal"><div class="head-icon"><i class="fa-solid fa-users"></i></div>
          <div><h3>کارشناس ها</h3><div class="sub">${fa(rows.length)} کارشناس · کلیک روی سطر = پرونده کامل؛ نمره‌ی خالی در میانگین صفر حساب نمی‌شود.</div></div></div>
        <div class="table-wrap" style="max-height:400px;overflow-y:auto">
          <table class="tbl">
            <thead><tr>
              <th>کارشناس</th><th>تیم</th>
              <th>تعداد ریت تیکت</th><th>میانگین نمره تیکت</th>
              <th>تعداد ریت سوشال</th><th>میانگین نمره سوشال</th>
              <th>تعداد ریت تماس</th><th>میانگین نمره تماس</th>
              <th>ردلاین</th><th>میانگین کل نمرات کارشناس</th>
            </tr></thead>
            <tbody>${rows.map(r => `<tr style="cursor:pointer" data-name="${esc(r.name)}" title="جزئیات ${esc(r.name)}">
              <td class="cell-main">${esc(r.name)}${r.active === false ? ' <span class="badge gray">بایگانی</span>' : ''}${!r.registered ? '<div class="cell-sub">در فایل‌های واردشده؛ در مدیریت کارشناسان ثبت نشده</div>' : ''}</td>
              <td><span class="tag-team">${esc(QCParse.displayTeam(r.team || '—'))}</span></td>
              <td>${fa(r.ticketCount || 0)}</td><td>${r.ticketAvg === '' ? '—' : scorePill(r.ticketAvg)}</td>
              <td>${fa(r.socialCount || 0)}</td><td>${r.socialAvg === '' ? '—' : scorePill(r.socialAvg)}</td>
              <td>${fa(r.callCount || 0)}</td><td>${r.callAvg === '' ? '—' : scorePill(r.callAvg)}</td>
              <td>${redlinesCell(r)}</td>
              <td>${r.avgScore === '' ? '—' : scorePill(r.avgScore)}</td>
            </tr>`).join('')}</tbody>
          </table>
        </div>`;
      $$('tbody tr', wrap).forEach(tr => tr.addEventListener('click', () => pickAgent(tr.dataset.name)));
    } catch (e) {
      if (request !== masterId || !wrap.isConnected) return;
      wrap.innerHTML = `<div class="card-pad">${emptyState('fa-triangle-exclamation', 'خطای بارگذاری', e.message)}</div>`;
    }
  }

  function redlinesCell(row) {
    return [['تیکت', row.ticketRedline], ['سوشال', row.socialRedline], ['تماس', row.callRedline]]
      .filter((x) => x[1] > 0).map((x) => `<span class="badge bad">${x[0]}: ${fa(x[1])}</span>`).join(' ') || '-';
  }
  function clearProfile() {
    profileId++; curAgent = null; curData = null; $('#pSearch').value = '';
    if(profileModal && profileModal.isConnected) profileModal.close();
    profileModal=null;profileBody=null;historyCalls=[];App.clearCharts();
  }
  async function refresh() {
    const name = curAgent;
    await Promise.all([renderMaster(), name ? load(name) : Promise.resolve()]);
  }

  /* ------------------------- جستجوی نام ------------------------- */
  function matchAgents(q) {
    q = C.faToEn(String(q || '')).trim().toLowerCase();
    if (!q) return [];
    const dig = q.replace(/[^0-9]/g, '');
    const selectedTeams = msTeams.getValues();
    const fromAgents = agents.filter(a => (!selectedTeams.length || selectedTeams.includes(a.team)) &&
      (a.name.toLowerCase().includes(q) || (dig.length >= 2 && String(a.ext).includes(dig))));
    // + کارشناسان دیتای تماس که درگانسی نیستند
    const agentNames = new Set(agents.map(a => a.name));
    const callOnly = (lastCombined || [])
      .filter(r => !agentNames.has(r.name) && r.name && r.name.toLowerCase().includes(q))
      .map(r => ({ name: r.name, team: r.team || '(دیتای تماس)', ext: null, active: true }));
    return [...fromAgents, ...callOnly];
  }

  function renderSugg() {
    const list = matchAgents($('#pSearch').value).slice(0, 12);
    if (!list.length) { sugg.style.display = 'none'; sugg.innerHTML = ''; return; }
    sugg.innerHTML = list.map(a => `
      <button class="btn ghost" style="display:flex;justify-content:space-between;width:100%;border-radius:0;border-bottom:1px solid var(--border)" data-name="${esc(a.name)}">
        <span>${esc(a.name)}</span>
        <span style="color:var(--muted);font-size:11px">${a.ext != null ? 'داخلی ' + fa(a.ext) : ''} · ${esc(QCParse.displayTeam(a.team))}</span>
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
  $('#pSearch').addEventListener('blur', () => setTimeout(() => { sugg.style.display = 'none'; }, 180));
  $('#pSearch').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const list = matchAgents($('#pSearch').value);
      if (list.length) { pickAgent(list[0].name); $('#pSugg').style.display = 'none'; }
    }
  });

  function ensurePopup() {
    if(profileModal && profileModal.isConnected)return;
    profileModal=UI.modal(`${UI.modalHead('پروفایل عملکرد کارشناس','fa-id-card')}<div class="profile-toolbar">
      <div class="field"><label>از تاریخ بررسی</label><div class="date-f"><input class="input" id="pFrom" dir="ltr" value="${esc(App.dateRange.from)}"><button class="cal-btn" id="pFromCal" type="button" aria-label="تقویم شروع"><i class="fa-regular fa-calendar"></i></button></div></div>
      <div class="field"><label>تا تاریخ بررسی</label><div class="date-f"><input class="input" id="pTo" dir="ltr" value="${esc(App.dateRange.to)}"><button class="cal-btn" id="pToCal" type="button" aria-label="تقویم پایان"><i class="fa-regular fa-calendar"></i></button></div></div>
      <button class="btn soft" id="pRangeApply">اعمال بازه</button><span class="profile-period" id="pLoadedPeriod"></span>
      <div class="toolbar-actions"><button class="btn success-soft" id="pXls" disabled><i class="fa-solid fa-file-excel"></i> اکسل</button><button class="btn primary" id="pImage" disabled><i class="fa-solid fa-image"></i> دانلود عکس کامل</button></div></div>
      <div class="profile-content" id="pBody"></div>`,{className:'profile-modal',lg:true,onClose(){profileId++;curAgent=null;curData=null;profileBody=null;profileModal=null;historyCalls=[];App.clearCharts();}});
    profileBody=$('#pBody',profileModal);
    const apply=()=>App.setDateRange({from:$('#pFrom').value.trim(),to:$('#pTo').value.trim()});
    $('#pRangeApply').addEventListener('click',apply);
    JCal.attach($('#pFromCal'),{input:$('#pFrom'),onPick:apply});JCal.attach($('#pToCal'),{input:$('#pTo'),onPick:apply});
    $('#pXls').addEventListener('click',exportExcel);
    $('#pImage').addEventListener('click',async()=>{
      if(!curData || !profileBody)return;
      const button=$('#pImage'),data=curData,frozenCalls=historyCalls.slice();button.disabled=true;
      try{
        App.charts.forEach(chart=>{if(chart.update)chart.update('none');});
        await QCCapture.download(profileBody,`${data.agent.name} — ${data.scope.from||'ابتدا'} تا ${data.scope.to||'انتها'}`,copy=>{
          frozenCalls.forEach((row,index)=>{const detail=copy.querySelector('#pCallDetails-'+index);if(detail){detail.hidden=false;detail.firstElementChild.innerHTML=callDetail(row,index);}});
          copy.querySelectorAll('.rating-detail-row').forEach(row=>{row.hidden=false;});
        });toast.success('عکس کامل پرونده در بازه‌ی نمایش‌داده‌شده آماده شد');
      }catch(e){toast.error(e.message);}finally{if(button.isConnected)button.disabled=!curData;}
    });
  }
  async function pickAgent(name) {
    $('#pSearch').value=name;ensurePopup();curAgent=name;await load(name);
  }

  $('#pReset').addEventListener('click', () => {
    msTeams.setValues([]); clearProfile(); renderMaster();
  });

  async function load(name) {
    const body = profileBody, request = ++profileId;
    if (!body || !body.isConnected) return;
    curData = null; $('#pXls').disabled = true; $('#pImage').disabled=true;
    body.innerHTML = `<div class="loading-page"><div class="spinner"></div></div>`;
    const q = periodQ(); q.set('ident', name);
    try {
      const data = await api.get('/api/portfolio?' + q.toString());
      if (request !== profileId || !body.isConnected) return;
      App.clearCharts();
      curAgent = name; curData = data; $('.modal-head h3',profileModal).textContent='پروفایل عملکرد — '+data.agent.name; $('#pXls').disabled = false;$('#pImage').disabled=false;
      const scope=data.scope || {from:App.dateRange.from,to:App.dateRange.to};data.scope=scope;
      $('#pFrom').value=scope.from;$('#pTo').value=scope.to;
      const periodOr=scope.from||scope.to?'از '+fa(scope.from||'ابتدا')+' تا '+fa(scope.to||'انتها'):'همه تاریخ‌ها';
      $('#pLoadedPeriod').textContent='بازه‌ی داده‌ی نمایش‌داده‌شده: '+periodOr;
      renderProfile(body, data, periodOr);
    } catch (e) {
      if (request !== profileId || !body.isConnected) return;
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
    return `<table class="tbl"><thead><tr><th>کد تیکت</th><th>تاریخ بررسی</th><th>نمره</th><th class="no-capture">جزئیات</th></tr></thead>
      <tbody>${rows.slice().sort((a, b) => (b.id - a.id)).map(r => `<tr>
        <td>${esc(r.ticketCode)}</td><td dir="ltr">${fa(r.reviewDate)}</td><td>${scorePill(r.score)}</td><td class="no-capture"><button class="btn ghost sm" data-rating-toggle>جزئیات</button></td></tr><tr class="rating-detail-row" hidden><td colspan="4">${ticketDetail(r)}</td></tr>`).join('')}</tbody></table>`;
  }
  function socialTable(rows) {
    if (!rows.length) return emptyState('fa-comments', 'بدون سوابق سوشال', '');
    const slaTxt = (s) => s.slaStatus === 'رعایت شده' ? '<span class="badge ok">رعایت</span>' : s.slaStatus === 'رعایت نشده' ? '<span class="badge bad">رد شده</span>' : '—';
    return `<table class="tbl"><thead><tr><th>تاریخ بررسی</th><th>SLA</th><th>نمره</th><th class="no-capture">جزئیات</th></tr></thead>
      <tbody>${rows.slice().sort((a, b) => (b.id - a.id)).map(r => `<tr>
        <td dir="ltr">${fa(r.reviewDate)}</td><td>${slaTxt(r)}</td><td>${scorePill(r.score)}</td><td class="no-capture"><button class="btn ghost sm" data-rating-toggle>جزئیات</button></td></tr><tr class="rating-detail-row" hidden><td colspan="4">${socialDetail(r)}</td></tr>`).join('')}</tbody></table>`;
  }
  function ticketDetail(r){return `<div class="detail-row">QC: ${esc(r.qcAgent||'—')} · تاریخ ایجاد: ${fa(r.ticketDate)} · ردلاین: ${QCReports.hasRedline(r,'ticket')?'۱':'-'}<br>
      پیگیری: ${triValue(r.q1)} · یادداشت: ${triValue(r.q2)} · دلیل بستن: ${triValue(r.q3)} · اکشن CRM: ${triValue(r.q4)}<div style="white-space:pre-wrap">${esc(r.comment||'')}</div></div>`;}
  function socialDetail(r){return `<div class="detail-row">QC: ${esc(r.qcAgent||'—')} · پیام‌رسان: ${esc(r.messenger||'—')} · وضعیت: ${esc(r.responseStatus||'—')}<br>
      دریافت: ${fa(r.receiveDate)} ${fa(r.receiveTime)} · پاسخ: ${fa(r.replyDate)} ${fa(r.replyTime)} · دقیقه کاری: ${fa(r.durationMin)}<br>
      SLA: ${triValue(r.qSla)} · پیگیری: ${triValue(r.qFollow)} · پایان‌بندی: ${triValue(r.qClosing)} · لحن: ${triValue(r.qTone)}<div style="white-space:pre-wrap">${esc(r.delayReason||'')} ${esc(r.reasonVerdict||'')} ${esc(r.comment||'')}</div></div>`;}
  function callTable(rows) {
    if (!rows.length) return emptyState('fa-headset', 'بدون دیتای ریت تماس', 'بازه‌ی تاریخ را تغییر دهید یا از مرکز داده فایل QC وارد کنید.');
    historyCalls = rows.slice().sort((a, b) => {
      const aj = C.parseDate(a.reviewDate), bj = C.parseDate(b.reviewDate);
      return aj && bj ? C.jalaliCmp(bj, aj) : (bj ? 1 : aj ? -1 : 0);
    });
    return `<table class="tbl" id="pCallHistory"><thead><tr><th>لید</th><th>نمره</th><th>ردلاین</th><th>جزئیات بیشتر</th></tr></thead>
      <tbody>${historyCalls.map((r, index) => `<tr>
        <td class="cell-main">${esc(r.leadName || '—')}</td><td>${scorePill(r.score)}</td>
        <td>${callRedlineBadge(r, index)}</td>
        <td><button type="button" class="btn ghost sm" data-call-detail="${index}" aria-expanded="false" aria-controls="pCallDetails-${index}">
          <i class="fa-solid fa-chevron-down"></i> جزئیات بیشتر</button></td></tr>
        <tr class="call-detail-row" id="pCallDetails-${index}" hidden><td colspan="4"></td></tr>`).join('')}</tbody></table>`;
  }
  function callDetail(row, index) {
    const keys = [...new Set(QCReports.criteriaKeys([row], row.formType, QCParse).concat(Object.keys(row.elements||{})))];
    return `<div class="cell-sub" style="margin-bottom:8px">فرم: ${esc(FORM_TYPE_FA[row.formType] || row.formType)} · نمره‌ها عین فرم: 1 / 0 / -</div>
      <div class="table-wrap"><table class="tbl call-detail-table"><thead><tr><th>لید</th><th>شماره تماس</th>
        ${keys.map((key) => `<th>${esc((QCParse.definitionsFor(row.formType,row.team || curData && curData.agent.team).find(d=>d.key===key)||{}).label || (row.criteriaSnapshot||[]).find(d=>d.key===key)?.label || QCParse.labelOf(row.formType,key))}</th>`).join('')}
        <th>ردلاین</th><th>تایم مکالمه</th><th>تاریخ بررسی</th></tr></thead><tbody><tr>
          <td class="cell-main">${esc(row.leadName || '—')}</td><td dir="ltr">${esc(row.leadPhone || '—')}</td>
          ${keys.map((key) => `<td>${triValue(QCParse.elementValue(row,key))}</td>`).join('')}
          <td>${callRedlineBadge(row, index)}</td><td>${callTimeCell(row)}</td><td dir="ltr">${esc(fa(row.reviewDate))}</td>
        </tr></tbody></table></div>${row.qcComment||row.redlineReason?`<div class="detail-row" style="margin-top:8px;white-space:pre-wrap">${row.redlineReason?'علت ردلاین: '+esc(row.redlineReason):''}${row.qcComment?'<br>نظر QC: '+esc(row.qcComment):''}</div>`:''}`;
  }

  /* ---------- کارت نرخ موفقیت معیارهای تماس (پرتفوی) ---------- */
  function criteriaCard(byTypeRates) {
    if (!Array.isArray(byTypeRates) || !byTypeRates.length) return '';
    const FORM__LABEL = { tele: 'Telesales', account: 'تیم اکانت', mlm: 'MLM/BNPL' };
    const ids = [];
    const cards = byTypeRates.map((bt, bi) => {
      if (!bt.rates || !bt.rates.length) return '';
      const rows = bt.rates.map((r, ri) => {
        const lbl = r.label || window.QCParse.labelOf(bt.form,r.key,curData && curData.agent.team);
        const cid = 'cr-' + bi + '-' + ri;
        ids.push(cid);
        const st = r.successRate === '' ? null : r.successRate;
        const bar = st == null ? 'width:0%' : `width:${st}%;background:${scoreColorHex(st)}`;
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
      : '<span class="tag-team" style="opacity:.5">دیتای ریت تماس برای این کارشناس یافت نشد</span>';

    body.innerHTML = `
      <div class="capture-title no-capture"></div>
      <div class="profile-system-brand"><img src="logo.png" width="30" height="30" alt="لوگوی سامانه"><span>سامانه کنترل کیفیت CRM · گزارش عملکرد</span></div>
      <!-- شناسنامه -->
      <div class="card" style="margin-bottom:16px">
        <div class="card-pad" style="display:flex;flex-wrap:wrap;gap:14px;align-items:center">
          <div style="width:56px;height:56px;border-radius:16px;background:linear-gradient(135deg,var(--brand),var(--violet));display:flex;align-items:center;justify-content:center;font-size:26px;color:#fff;flex-shrink:0">
            <i class="fa-solid fa-user"></i>
          </div>
          <div style="flex:1;min-width:180px">
            <div style="font-size:19px;font-weight:800">${esc(a.name)}</div>
            <div style="display:flex;gap:9px;flex-wrap:wrap;margin-top:7px">
              <span class="tag-team">${esc(QCParse.displayTeam(a.team))}</span>
              ${a.id === 0 ? '<span class="badge warn">در فایل‌های واردشده؛ در مدیریت کارشناسان ثبت نشده</span>' : ''}
              ${a.ext != null ? `<span class="badge gray"><i class="fa-solid fa-hashtag"></i> داخلی ${fa(a.ext)}</span>` : ''}
              <span class="badge ${a.active ? 'ok' : 'bad'}">${a.active ? 'فعال' : 'بایگانی'}</span>
              ${monthLine}
            </div>
          </div>
        </div>
      </div>

      <div class="profile-summary"><div class="summary-block"><small>میانگین کل نمرات معتبر</small><strong>${QCReports.avgScore(T.rows.concat(S.rows,Ph.rows))===''?'—':fa(QCReports.avgScore(T.rows.concat(S.rows,Ph.rows)))}</strong></div>
        <div class="summary-block"><small>تعداد کل ریت‌ها</small><strong>${fa(T.count+S.count+Ph.count)}</strong></div><div class="summary-block"><small>ریت‌های نمره‌دار</small><strong>${fa(T.scoredCount+S.scoredCount+Ph.scoredCount)}</strong></div>
        <div class="summary-block"><small>ردلاین‌ها؛ تیکت / سوشال / تماس</small><strong>${fa(T.redlineZero)} / ${fa(S.rows.filter(r=>QCReports.hasRedline(r,'social')).length)} / ${fa(Ph.redlineCount)}</strong></div></div>
      <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(240px,1fr));margin-bottom:16px">
        ${kpi('fa-ticket', 'ارزیابی تیکت', `${fa(T.count)}`,
          T.avgScore === '' ? '' : `میانگین ${scorePill(T.avgScore)}`, T.redlineZero > 0 ? 'warn' : '')}
        ${kpi('fa-comments', 'ارزیابی سوشال', `${fa(S.count)}`,
          `${S.slaReal === '' ? '' : 'SLA ' + fa(S.slaReal) + '٪'}${S.unanswered ? ' · عدم پاسخ ' + fa(S.unanswered) : ''}`,
          S.slaReal !== '' && S.slaReal < 70 ? 'warn' : '')}
        ${kpi('fa-headset', 'ریت تماس', `${fa(Ph.count)}`,
          Ph.avgScore === '' ? '' : `میانگین ${fa(Ph.avgScore)}${Ph.redlineCount ? ' · ردلاین ' + fa(Ph.redlineCount) : ''}`,
          Ph.redlineCount > 0 ? 'danger' : '')}
      </div>

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
        <div class="card" style="grid-column:1/-1;min-width:0">
          <div class="card-head violet"><div class="head-icon"><i class="fa-solid fa-headset"></i></div><div><h3>سوابق ریت تماس (${fa(Ph.count)})</h3></div></div>
          <div class="card-pad" style="border-bottom:1px solid var(--border);padding:9px 14px;font-size:12px">${typeRows}</div>
          <div class="table-wrap" style="max-height:340px;overflow-y:auto">${callTable(Ph.rows)}</div>
        </div>
      </div>

      ${(d.actions.length || true) ? `
      <div class="card" style="margin-top:16px">
        <div class="card-head"><div class="head-icon"><i class="fa-solid fa-clipboard-list"></i></div>
          <div><h3>اقدامات اصلاحی و توافقات؛ همه تاریخ‌ها (${fa(d.actions.length)})</h3>
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
          : '<div style="color:var(--muted);text-align:center;padding:16px;font-size:12px">هنوز اقدامی ثبت نشده — تیکت‌گذر یا ریت اول را با «ثبت اقدام جدید» یادداشت کنید</div>'}
        </div>
      </div>` : ''}`;

    body.insertAdjacentHTML('beforeend', `<div class="profile-image-note">گزارش عملکرد ${esc(a.name)} · ${esc(periodLabel)}<br>مبنا: تاریخ بررسی هر ریت. نمره‌ی خالی صفر نیست؛ میانگین بر نمره‌های معتبر وزن‌دار است. 1 = رعایت، 0 = عدم رعایت، - = موضوعیت نداشته و خارج از مخرج نرخ؛ — = ثبت‌نشده. اقدام‌ها جدا از بازه‌ی ارزیابی‌اند.</div>`);
    bindCallRedlines($('#pCallHistory', body) || body, historyCalls);
    $$('[data-call-detail]', body).forEach((button) => button.addEventListener('click', () => {
      const index = Number(button.dataset.callDetail), detail = $('#pCallDetails-' + index, body);
      const expanded = button.getAttribute('aria-expanded') === 'true';
      button.setAttribute('aria-expanded', String(!expanded)); detail.hidden = expanded;
      if (!expanded && !detail.firstElementChild.innerHTML) {
        detail.firstElementChild.innerHTML = callDetail(historyCalls[index], index);
        bindCallRedlines(detail, historyCalls);
      }
    }));

    $$('[data-rating-toggle]',body).forEach(button=>button.addEventListener('click',()=>{const row=button.closest('tr').nextElementSibling;row.hidden=!row.hidden;}));
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
  function exportExcel() {
    if (!curData) return;
    const a = curData.agent;
    const rowsT = [['کد تیکت', 'تاریخ بررسی', 'تاریخ تیکت', 'q1', 'q2', 'q3', 'q4', 'ردلاین', 'نمره'], ...curData.tickets.rows.map(r => [r.ticketCode, r.reviewDate, r.ticketDate, r.q1, r.q2, r.q3, r.q4, r.redline, r.score])];
    const rowsS = [['تاریخ بررسی', 'وضعیت', 'شروع', 'پایان', 'دقیقه کاری', 'SLA', 'نمره'], ...curData.socials.rows.map(r => [r.reviewDate, r.responseStatus, r.receiveDate + ' ' + r.receiveTime, r.replyDate + ' ' + r.replyTime, r.durationMin, r.slaStatus, r.score])];
    const callSheets = ['tele', 'account', 'mlm'].map((form) => {
      const calls = curData.calls.rows.filter((r) => r.formType === form);
      const keys = QCReports.criteriaKeys(calls, form, QCParse);
      return { name: FORM_TYPE_FA[form], rows: [
        ['لید', 'شماره تماس', 'نمره', ...keys.map((key) => QCParse.labelOf(form, key)), 'ردلاین', 'علت ردلاین', 'تایم مکالمه', 'زمان شنود', 'تاریخ بررسی'],
        ...calls.map((r) => [r.leadName, r.leadPhone, C.normalizeScore(r.score), ...keys.map((key) => C.normalizeTri((r.elements || {})[key])),
          QCReports.hasRedline(r, 'call') ? 1 : '-', r.redlineReason || '', r.callDuration || '', r.listeningTime || '', r.reviewDate])
      ] };
    }).filter((sheet) => sheet.rows.length > 1);
    window.QCExport.sheets(`${a.name} — پرونده`, [
      { name: 'تیکت', rows: rowsT }, { name: 'سوشال', rows: rowsS }, ...callSheets
    ]);
  }

  App.onDateRangeChange(refresh);
  await renderMaster();
  if (arg && master.isConnected) await pickAgent(decodeURIComponent(arg));
}

App.register('portfolio', { title: 'پرونده کارشناس', render });
})();
