/* expertReview.js — «داشبورد بررسی» در بخش مرجع کارشناسان
 *   همه‌ی اقدام‌ها (وظیفه‌ها) ثبت‌شده‌ی کارشناسان برای بررسی QC: انجام‌شده/نشده، نتیجه (موفق = رفع‌شده،
 *   ناموفق، در پیگیری)، نوع اقدام، روند ماهانه، جمع‌بندی هر کارشناس، مشکل‌های پرتکرار و جدول کامل.
 *   جمع‌بندی در shared/expertRef.js (reviewDashboard) انجام می‌شود.
 */
(function () {
'use strict';
const { C, $, api, fa, esc, emptyState } = UI;

const DONE = 'انجام شده', NOT_DONE = 'انجام نشده';
const COL = { good: 'rgba(52,211,153,.8)', bad: 'rgba(248,113,113,.8)', warn: 'rgba(251,191,36,.8)', gray: 'rgba(156,163,175,.8)', blue: 'rgba(56,189,248,.8)' };
const RESULT_TONE = { 'موفق': 'good', 'ناموفق': 'bad', 'نیاز به پیگیری': 'warn', 'در انتظار': 'gray' };
const RESULT_COLOR = { 'موفق': COL.good, 'ناموفق': COL.bad, 'نیاز به پیگیری': COL.warn, 'در انتظار': COL.gray };

const kpi = (cls, icon, val, lbl, small) => `
  <div class="kpi ${cls}">
    <div class="kpi-ic"><i class="fa-solid ${icon}"></i></div>
    <div><div class="kpi-val">${val}${small ? ` <small>${small}</small>` : ''}</div><div class="kpi-lbl">${lbl}</div></div>
  </div>`;
const pctText = (v) => (v === '' || v == null ? '—' : fa(C.round2(v)) + '٪');
const statusBadge = (s) => (s === DONE ? '<span class="badge good">انجام شده</span>' : '<span class="badge warn">انجام نشده</span>');
const resultBadge = (r) => `<span class="badge ${RESULT_TONE[r] || 'gray'}">${esc(r || 'در انتظار')}</span>`;
const teamText = (t) => (t ? esc(QCParse.displayTeam(t)) : '—');
const borderOf = () => (typeof App !== 'undefined' && App.theme === 'light' ? '#f3f6fb' : '#111a2e');
const chartBox = (id, h) => `<div class="chart-box" style="height:${h}px"><canvas id="${id}"></canvas></div>`;
const noData = (icon, title) => emptyState(icon, title, 'فیلترها را تغییر دهید یا اقدام ثبت کنید.');

function render(root) {
  root.innerHTML = `
    <div class="page-head">
      <div class="ph-ic"><i class="fa-solid fa-clipboard-check"></i></div>
      <div><h2>داشبورد بررسی</h2><p>همه‌ی اقدام‌ها و وظیفه‌های ثبت‌شده‌ی کارشناسان: انجام‌شده، نتیجه و مشکل‌ها. بازه‌ی سراسری تاریخ روی این بخش اعمال نمی‌شود؛ بازه‌ی اقدام را همین‌جا انتخاب کنید.</p></div>
      <div class="spacer"></div>
      <div class="tabs er-view-tabs">
        <button type="button" data-view="cards">کارت‌ها</button>
        <button type="button" data-view="review" class="active">داشبورد بررسی</button>
      </div>
    </div>
    <div class="card" style="margin-bottom:16px">
      <div class="filters plain">
        <div id="rvTeamSlot"></div><div id="rvAgentSlot"></div><div id="rvTypeSlot"></div><div id="rvResultSlot"></div>
        <div class="field"><label>وضعیت انجام</label>
          <select class="input" id="rvStatus"><option value="">همه</option><option value="${DONE}">انجام شده</option><option value="${NOT_DONE}">انجام نشده</option></select></div>
        <div class="field"><label>از تاریخ اقدام</label>
          <div class="date-f"><input class="input" id="rvFrom" dir="ltr" placeholder="۱۴۰۵/۰۱/۰۱" autocomplete="off"><button type="button" class="cal-btn" id="rvFromBtn" aria-label="تقویم تاریخ شروع"><i class="fa-regular fa-calendar"></i></button></div></div>
        <div class="field"><label>تا تاریخ اقدام</label>
          <div class="date-f"><input class="input" id="rvTo" dir="ltr" placeholder="۱۴۰۵/۱۲/۲۹" autocomplete="off"><button type="button" class="cal-btn" id="rvToBtn" aria-label="تقویم تاریخ پایان"><i class="fa-regular fa-calendar"></i></button></div></div>
        <div class="field grow-0"><label>&nbsp;</label><button class="btn ghost" id="rvReset" type="button"><i class="fa-solid fa-rotate-right"></i> بازنشانی</button></div>
      </div>
    </div>
    <div id="rvBody"><div class="loading-page"><div class="spinner"></div><p>در حال جمع‌آوری اقدام‌ها…</p></div></div>`;

  const body = $('#rvBody', root);
  let reqId = 0, controls = null;

  function buildControls(meta) {
    const items = (list, labelOf) => (list || []).map((v) => ({ value: v, label: labelOf ? labelOf(v) : v }));
    const onChange = () => load();
    controls = {
      team: UI.multiSelect({ label: 'تیم', allLabel: 'همه تیم‌ها', items: items(meta.teams, (t) => QCParse.displayTeam(t)), onChange }),
      agent: UI.multiSelect({ label: 'کارشناس', allLabel: 'همه کارشناسان', items: items(meta.agents), onChange }),
      type: UI.multiSelect({ label: 'نوع اقدام', allLabel: 'همه اقدام‌ها', items: items(meta.actionTypes), onChange }),
      result: UI.multiSelect({ label: 'نتیجه', allLabel: 'همه نتایج', items: items(meta.results), onChange })
    };
    $('#rvTeamSlot', root).replaceWith(controls.team);
    $('#rvAgentSlot', root).replaceWith(controls.agent);
    $('#rvTypeSlot', root).replaceWith(controls.type);
    $('#rvResultSlot', root).replaceWith(controls.result);
    $('#rvStatus', root).addEventListener('change', onChange);
    ['#rvFrom', '#rvTo'].forEach((id) => $(id, root).addEventListener('change', onChange));
    JCal.attach($('#rvFromBtn', root), { input: $('#rvFrom', root), onPick: onChange });
    JCal.attach($('#rvToBtn', root), { input: $('#rvTo', root), onPick: onChange });
    $('#rvReset', root).addEventListener('click', () => {
      controls.team.setValues([]); controls.agent.setValues([]); controls.type.setValues([]); controls.result.setValues([]);
      $('#rvStatus', root).value = ''; $('#rvFrom', root).value = ''; $('#rvTo', root).value = '';
      load();
    });
  }

  function params() {
    const p = new URLSearchParams();
    if (controls) {
      const put = (k, list) => { if (list.length) p.set(k, list.join(',')); };
      put('team', controls.team.getValues()); put('agent', controls.agent.getValues());
      put('type', controls.type.getValues()); put('result', controls.result.getValues());
    }
    const st = $('#rvStatus', root).value; if (st) p.set('status', st);
    const from = $('#rvFrom', root).value.trim(), to = $('#rvTo', root).value.trim();
    if (from) p.set('aFrom', from);
    if (to) p.set('aTo', to);
    return p.toString();
  }

  async function load() {
    const my = ++reqId;
    const qs = params();
    let d;
    try {
      d = await api.get('/api/expert-ref/review' + (qs ? '?' + qs : ''));
    } catch (e) {
      if (my !== reqId || !body.isConnected) return;
      body.innerHTML = `<div class="card">${emptyState('fa-triangle-exclamation', 'خطا', e.message)}</div>`;
      return;
    }
    if (my !== reqId || !body.isConnected) return;
    if (!controls) buildControls(d.meta);
    draw(d);
  }

  function draw(d) {
    App.clearCharts();
    const k = d.kpis;
    if (!k.total) {
      body.innerHTML = `<div class="card">${noData('fa-clipboard', 'اقدامی برای این فیلتر نیست')}</div>`;
      return;
    }
    body.innerHTML = `
      <div class="kpis" style="margin-bottom:16px">
        ${kpi('blue', 'fa-list-check', fa(k.total), 'کل اقدام‌ها')}
        ${kpi('green', 'fa-circle-check', fa(k.done), 'انجام‌شده')}
        ${kpi(k.notDone ? 'amber' : 'green', 'fa-hourglass-half', fa(k.notDone), 'انجام‌نشده')}
        ${kpi('green', 'fa-thumbs-up', fa(k.success), 'نتیجه موفق (رفع‌شده)')}
        ${kpi(k.failed ? 'red' : 'green', 'fa-thumbs-down', fa(k.failed), 'نتیجه ناموفق')}
        ${kpi(k.waiting ? 'violet' : 'green', 'fa-user-clock', fa(k.waiting), 'در انتظار / نیاز به پیگیری')}
        ${kpi('blue', 'fa-percent', pctText(k.successRate), 'نرخ موفقیت', '')}
        ${kpi('blue', 'fa-user-group', fa(k.experts), 'کارشناس دارای اقدام')}
        ${kpi(k.openReminders ? 'amber' : 'green', 'fa-bell', fa(k.openReminders), 'یادآور باز')}
      </div>

      <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(320px,1fr));margin-bottom:16px">
        <div class="card">
          <div class="card-head teal"><div class="head-icon"><i class="fa-solid fa-square-check"></i></div><h3>نتیجه‌ی اقدام‌ها</h3><div class="sub">موفق = رفع‌شده</div></div>
          ${d.byResult.some((x) => x.count) ? chartBox('rvResult', 230) : noData('fa-chart-pie', 'بدون داده')}
        </div>
        <div class="card">
          <div class="card-head violet"><div class="head-icon"><i class="fa-solid fa-list-check"></i></div><h3>نوع اقدام</h3><div class="sub">انجام‌شده و انجام‌نشده به تفکیک نوع</div></div>
          ${chartBox('rvType', Math.max(230, d.byType.length * 36 + 60))}
        </div>
      </div>

      <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(340px,1fr));margin-bottom:16px">
        <div class="card">
          <div class="card-head blue"><div class="head-icon"><i class="fa-solid fa-chart-column"></i></div><h3>روند ماهانه</h3><div class="sub">بر اساس تاریخ اقدام</div></div>
          ${d.byMonth.length ? chartBox('rvMonth', 260) : noData('fa-calendar', 'تاریخ معتبر برای روند نیست')}
        </div>
        <div class="card">
          <div class="card-head teal"><div class="head-icon"><i class="fa-solid fa-user-check"></i></div><h3>وضعیت هر کارشناس</h3><div class="sub">انجام‌شده و انجام‌نشده</div></div>
          ${chartBox('rvExpert', Math.max(260, d.byExpert.length * 34 + 60))}
        </div>
      </div>

      <div class="card" style="margin-bottom:16px">
        <div class="card-head"><div class="head-icon"><i class="fa-solid fa-users"></i></div><h3>جمع‌بندی هر کارشناس</h3><div class="sub">آخرین اقدام، نتیجه‌ها و یادآورهای باز</div></div>
        <div class="table-wrap">
          <table class="tbl">
            <thead><tr><th>کارشناس</th><th>تیم</th><th>کل</th><th>انجام شده</th><th>انجام نشده</th><th>موفق</th><th>ناموفق</th><th>در پیگیری</th><th>نرخ موفقیت</th><th>آخرین اقدام</th><th>یادآور باز</th></tr></thead>
            <tbody>${d.byExpert.map((e) => `<tr>
              <td class="cell-main">${esc(e.name)}</td><td>${teamText(e.team)}</td><td>${fa(e.total)}</td>
              <td>${fa(e.done)}</td><td>${fa(e.notDone)}</td><td>${fa(e.success)}</td><td>${fa(e.failed)}</td><td>${fa(e.waiting)}</td>
              <td>${pctText(e.successRate)}</td>
              <td>${esc(e.lastTitle)} <small dir="ltr">${fa(e.lastDate)}</small> ${resultBadge(e.lastResult)}</td>
              <td>${fa(e.openReminders)}</td></tr>`).join('')}</tbody>
          </table>
        </div>
      </div>

      <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(340px,1fr));margin-bottom:16px">
        <div class="card">
          <div class="card-head violet"><div class="head-icon"><i class="fa-solid fa-triangle-exclamation"></i></div><h3>مشکل‌های پرتکرار</h3><div class="sub">بر اساس ماتریس مشکلات</div></div>
          <div class="table-wrap" style="max-height:360px;overflow-y:auto">
            <table class="tbl">
              <thead><tr><th>مشکل</th><th>منبع</th><th>کل</th><th>انجام شده</th><th>ناموفق</th><th>باز</th></tr></thead>
              <tbody>${d.byProblem.map((p) => `<tr><td class="cell-main">${esc(p.problem)}</td><td>${esc(p.source || '—')}</td>
                <td>${fa(p.total)}</td><td>${fa(p.done)}</td><td>${fa(p.failed)}</td><td>${fa(p.open)}</td></tr>`).join('')}</tbody>
            </table>
          </div>
        </div>
        <div class="card">
          <div class="card-head"><div class="head-icon"><i class="fa-solid fa-circle-info"></i></div><h3>راهنما</h3></div>
          <div class="card-pad" style="font-size:12.5px;color:var(--ink-2);line-height:1.9">
            <div><span class="badge good">انجام شده</span> وظیفه‌ی ثبت‌شده توسط کارشناس انجام شده است.</div>
            <div><span class="badge warn">انجام نشده</span> هنوز انجام نشده و باید پیگیری شود.</div>
            <div><span class="badge good">موفق</span> نتیجه‌ی اقدام؛ یعنی مشکل رفع شده است.</div>
            <div><span class="badge bad">ناموفق</span> مشکل رفع نشده است.</div>
            <div><span class="badge warn">نیاز به پیگیری</span> / <span class="badge gray">در انتظار</span> نتیجه هنوز قطعی نیست.</div>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-head"><div class="head-icon"><i class="fa-solid fa-table-list"></i></div><h3>همه‌ی اقدام‌ها و وظیفه‌ها</h3><div class="sub">${fa(d.rows.length)} مورد · جدول کامل برای خروجی اکسل</div></div>
        <div class="table-wrap" style="max-height:560px;overflow-y:auto">
          <table class="tbl">
            <thead><tr><th>تاریخ اقدام</th><th>کارشناس</th><th>تیم</th><th>نوع اقدام</th><th>وضعیت</th><th>نتیجه</th><th>مشکل</th><th>منبع مشکل</th><th>یادداشت</th></tr></thead>
            <tbody>${d.rows.map((r) => `<tr>
              <td dir="ltr">${fa(r.date)}</td><td class="cell-main">${esc(r.expert)}</td><td>${teamText(r.team)}</td>
              <td>${esc(r.title)}</td><td>${statusBadge(r.status)}</td><td>${resultBadge(r.result)}</td>
              <td>${esc(r.problem || '—')}</td><td>${esc(r.problemSource || '—')}</td><td>${esc(r.note || '')}</td></tr>`).join('')}</tbody>
          </table>
        </div>
      </div>`;

    drawCharts(d);
  }

  function drawCharts(d) {
    const opts = (extra) => Object.assign({ responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } } }, extra || {});
    if ($('#rvResult', body)) {
      const parts = d.byResult.filter((x) => x.count > 0);
      App.chart($('#rvResult', body), {
        type: 'doughnut',
        data: { labels: parts.map((x) => x.label), datasets: [{ data: parts.map((x) => x.count), backgroundColor: parts.map((x) => RESULT_COLOR[x.label]), borderColor: borderOf(), borderWidth: 3 }] },
        options: opts({ cutout: '62%' })
      });
    }
    if ($('#rvType', body)) {
      App.chart($('#rvType', body), {
        type: 'bar',
        data: { labels: d.byType.map((t) => t.title), datasets: [
          { label: DONE, data: d.byType.map((t) => t.done), backgroundColor: COL.good },
          { label: NOT_DONE, data: d.byType.map((t) => t.notDone), backgroundColor: COL.warn }] },
        options: opts({ indexAxis: 'y', scales: { x: { stacked: true, beginAtZero: true }, y: { stacked: true } } })
      });
    }
    if ($('#rvMonth', body)) {
      App.chart($('#rvMonth', body), {
        type: 'bar',
        data: { labels: d.byMonth.map((m) => m.label), datasets: [
          { label: DONE, data: d.byMonth.map((m) => m.done), backgroundColor: COL.good },
          { label: NOT_DONE, data: d.byMonth.map((m) => m.notDone), backgroundColor: COL.warn }] },
        options: opts({ scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true } } })
      });
    }
    if ($('#rvExpert', body)) {
      App.chart($('#rvExpert', body), {
        type: 'bar',
        data: { labels: d.byExpert.map((e) => e.name), datasets: [
          { label: DONE, data: d.byExpert.map((e) => e.done), backgroundColor: COL.good },
          { label: NOT_DONE, data: d.byExpert.map((e) => e.notDone), backgroundColor: COL.warn }] },
        options: opts({ indexAxis: 'y', scales: { x: { stacked: true, beginAtZero: true }, y: { stacked: true } } })
      });
    }
  }

  root.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => {
    location.hash = b.dataset.view === 'review' ? '#/expert-ref/review' : '#/expert-ref';
  }));
  load();
}

window.QCExpertReview = { render };
})();
