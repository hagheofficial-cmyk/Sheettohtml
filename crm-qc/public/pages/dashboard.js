/* dashboard.js — نمای کلی سامانه + فیلتر بازه تاریخ با تقویم */
(function () {
'use strict';
const { C, $, $$, api, fa, esc, scorePill, slaBadge, durText, emptyState, toast } = UI;

App.register('dashboard', {
  title: 'داشبورد — نمای کلی',

  async render(root) {

    root.innerHTML = `
      <div class="page-head">
        <div class="ph-ic"><i class="fa-solid fa-gauge-high"></i></div>
        <div>
          <h2>داشبورد مدیریتی</h2>
          <p>تصویر زنده از عملکرد کنترل کیفیت تیکت و سوشال</p>
        </div>
        <div class="spacer"></div>
        <div class="stat-strip">
          <span class="ss"><i class="fa-solid fa-ticket" style="color:var(--brand)"></i><b id="cntT">—</b> ارزیابی تیکت</span>
          <span class="ss"><i class="fa-solid fa-comments" style="color:var(--violet)\"></i><b id="cntS">—</b> ارزیابی سوشال</span>
        </div>
      </div>

      <div class="card" style="margin-bottom:16px">
        <div class="filters" style="border-bottom:none;align-items:flex-end">
          <div class="field grow-0"><label>از تاریخ بررسی</label>
            <div class="date-f"><input class="input" id="dFrom" dir="ltr" style="text-align:right;padding-left:34px" placeholder="۱۴۰۵/۰۶/۰۱">
              <button type="button" class="cal-btn" id="dFromBtn" title="تقویم"><i class="fa-regular fa-calendar"></i></button></div>
          </div>
          <div class="field grow-0"><label>تا تاریخ بررسی</label>
            <div class="date-f"><input class="input" id="dTo" dir="ltr" style="text-align:right;padding-left:34px" placeholder="۱۴۰۵/۰۶/۳۱">
              <button type="button" class="cal-btn" id="dToBtn" title="تقویم"><i class="fa-regular fa-calendar"></i></button></div>
          </div>
          <div class="field grow-0" style="min-width:120px"><label>دید پیش‌فرض</label>
            <div class="tabs" style="width:100%">
              <button data-p="cur" class="active">ماه جاری</button>
              <button data-p="all">همه</button>
            </div>
          </div>
          <div class="field grow-0"><label>&nbsp;</label><button class="btn ghost" id="dReset"><i class="fa-solid fa-rotate-right"></i> حذف بازه</button></div>
        </div>
      </div>

      <div id="dContent"><div class="loading-page"><div class="spinner"></div><p>در حال دریافت آمار…</p></div></div>`;

    let preset = 'cur';

    function currentRange() {
      if (preset === 'cur') {
        const t = C.todayJalali();
        const rng = C.jalaliMonthRange(t.jy, t.jm);
        return { from: C.formatJalali(rng.from), to: C.formatJalali(rng.to) };
      }
      const jf = C.parseJalali($('#dFrom').value), jt = C.parseJalali($('#dTo').value);
      return { from: jf ? C.formatJalali(jf) : null, to: jt ? C.formatJalali(jt) : null };
    }

    async function load() {
      /* هر ری‌رندر: نمودارهای قبلی نابود شوند تا کنواس آزاد شود */
      App.clearCharts();
      const cont = $('#dContent');
      if (!cont.isConnected) return; /* رندر اول قدیمی است — رد شود */
      cont.innerHTML = `<div class="loading-page"><div class="spinner"></div><p>در حال دریافت آمار…</p></div>`;
      const rng = currentRange();
      const q = new URLSearchParams();
      if (rng.from) q.set('from', rng.from);
      if (rng.to) q.set('to', rng.to);

      let d;
      try {
        d = await api.get('/api/dashboard?' + q.toString());
      } catch (e) {
        cont.innerHTML = `<div class="card">${emptyState('fa-triangle-exclamation', 'خطا', e.message)}</div>`;
        return;
      }

      $('#cntT').textContent = fa(d.ticketCount);
      $('#cntS').textContent = fa(d.socialCount);

      const kpi = (cls, icon, val, lbl, small) => `
        <div class="kpi ${cls}">
          <div class="kpi-ic"><i class="fa-solid ${icon}"></i></div>
          <div><div class="kpi-val">${val}${small ? ` <small>${small}</small>` : ''}</div><div class="kpi-lbl">${lbl}</div></div>
        </div>`;

      const avgAllTxt = d.avgAll === '' ? '—' : fa(d.avgAll) + ' <small>از ۱۰۰</small>';

      cont.innerHTML = `

      <div class="kpis" style="margin-bottom:16px">
        ${kpi('blue', 'fa-star-half-stroke', avgAllTxt, 'میانگین کل نمرات')}
        ${kpi('violet', 'fa-ticket', d.ticketScored ? fa(d.ticketScored) : '—', 'تیکت نمره‌دار', d.avgTicket === '' ? '' : 'میانگین ' + fa(d.avgTicket))}
        ${kpi('blue', 'fa-comments', d.socialScored ? fa(d.socialScored) : '—', 'سوشال نمره‌دار', d.avgSocial === '' ? '' : 'میانگین ' + fa(d.avgSocial))}
        ${kpi(d.slaReal === '' ? 'blue' : d.slaReal >= 80 ? 'green' : 'amber', 'fa-stopwatch', d.slaReal === '' ? '—' : fa(d.slaReal) + '٪', 'رعایت واقعی SLA سوشال')}
        ${kpi(d.unanswered ? 'red' : 'green', 'fa-phone-slash', fa(d.unanswered), 'پیام بدون پاسخ')}
        ${kpi(d.redlineZero ? 'red' : 'green', 'fa-ban', fa(d.redlineZero), 'ردلاین صفر (تیکت)')}
      </div>

      <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(320px,1fr));margin-bottom:16px">
        <div class="card">
          <div class="card-head teal"><div class="head-icon"><i class="fa-solid fa-chart-pie"></i></div><h3>توزیع نمره‌ها</h3><div class="sub">تعداد نمره‌دار به تفکیک بازه</div></div>
          <div class="chart-box" style="height:230px"><canvas id="chDist"></canvas></div>
        </div>
        <div class="card">
          <div class="card-head violet"><div class="head-icon"><i class="fa-solid fa-stopwatch"></i></div><h3>وضعیت SLA سوشال</h3><div class="sub">پاسخ‌شده و بدون‌پاسخ تفکیکی</div></div>
          <div class="chart-box" style="height:230px"><canvas id="chSla"></canvas></div>
        </div>
      </div>

      <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(340px,1fr))">
        <div class="card">
          <div class="card-head"><div class="head-icon"><i class="fa-solid fa-ticket"></i></div>
            <div><h3>آخرین ارزیابی‌های تیکت</h3></div></div>
          <div class="table-wrap" style="max-height:280px;overflow-y:auto">
            ${(d.latestTickets || []).length ? `<table class="tbl">
              <thead><tr><th>کارشناس</th><th>تاریخ</th><th>نمره</th></tr></thead>
              <tbody>${(d.latestTickets || []).map(t => `<tr>
                <td class="cell-main">${esc(t.agentName)}</td><td dir="ltr">${fa(t.reviewDate)}</td><td>${scorePill(t.score)}</td>
              </tr>`).join('')}</tbody></table>` : emptyState('fa-ticket', 'بدون دیتا', '')}
          </div>
        </div>
        <div class="card">
          <div class="card-head violet"><div class="head-icon"><i class="fa-solid fa-comments"></i></div>
            <div><h3>آخرین ارزیابی‌های سوشال</h3></div></div>
          <div class="table-wrap" style="max-height:280px;overflow-y:auto">
            ${(d.latestSocials || []).length ? `<table class="tbl">
              <thead><tr><th>کارشناس</th><th>تاریخ</th><th>SLA</th><th>نمره</th></tr></thead>
              <tbody>${(d.latestSocials || []).map(s => `<tr>
                <td class="cell-main">${esc(s.agentName)}</td>
                <td dir="ltr">${fa(s.reviewDate)}</td>
                <td>${slaBadge(s.slaStatus)}</td>
                <td>${scorePill(s.score)}</td>
              </tr>`).join('')}</tbody></table>` : emptyState('fa-comments', 'بدون دیتا', '')}
          </div>
        </div>
      </div>`;

      /* نمودارها */
      const distSum = (d.dist || []).reduce((a, b) => a + (b || 0), 0);
      if (distSum > 0) {
        App.chart($('#chDist'), {
          type: 'doughnut',
          data: {
            labels: ['۱۰۰–۹۰', '۹۰–۷۵', '۷۵–۵۰', 'کمتر از ۵۰'],
            datasets: [{
              data: d.dist || [0, 0, 0, 0],
              backgroundColor: ['rgba(52,211,153,.7)', 'rgba(56,189,248,.7)', 'rgba(251,191,36,.7)', 'rgba(248,113,113,.7)'],
              borderColor: '#111a2e', borderWidth: 3
            }]
          },
          options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } }, cutout: '62%' }
        });
      } else {
        const dCv = $('#chDist');
        if (dCv && dCv.closest('.chart-box')) {
          dCv.closest('.chart-box').innerHTML = emptyState('fa-chart-pie', 'بدون داده در این بازه', 'بازه‌ی دیگری انتخاب کنید یا ارزیابی ثبت کنید.');
        }
      }

      const slaParts = [
        ['رعایت واقعی', d.slaOk || 0, 'rgba(52,211,153,.8)'],
        ['رعایت‌نشده', d.slaMissed || 0, 'rgba(248,113,113,.8)'],
        ['بدون پاسخ', d.unanswered || 0, 'rgba(156,163,175,.8)']
      ].filter((x) => x[1] > 0);
      if (slaParts.length) {
        App.chart($('#chSla'), {
          type: 'doughnut',
          data: {
            labels: slaParts.map((x) => x[0]),
            datasets: [{ data: slaParts.map((x) => x[1]), backgroundColor: slaParts.map((x) => x[2]), borderColor: '#111a2e', borderWidth: 3 }]
          },
          options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } }, cutout: '62%' }
        });
      } else {
        const slaCv = $('#chSla');
        if (slaCv && slaCv.closest('.chart-box')) {
          slaCv.closest('.chart-box').innerHTML = emptyState('fa-stopwatch', 'بدون داده SLA', 'با این بازه داده‌ای نیست.');
        }
      }
    }

    /* ------ تقویم ------ */
    function refreshInputs(rng) {
      if (rng.from) { $('#dFrom').value = rng.from; }
      if (rng.to) { $('#dTo').value = rng.to; }
    }
    const todayInit = C.todayJalali();
    const initRng = C.jalaliMonthRange(todayInit.jy, todayInit.jm);
    refreshInputs({ from: C.formatJalali(initRng.from), to: C.formatJalali(initRng.to) });

    JCal.attach($('#dFromBtn'), { onPick(j) { $('#dFrom').value = j ? C.formatJalali(j) : ''; preset = 'custom'; load(); } });
    JCal.attach($('#dToBtn'), { onPick(j) { $('#dTo').value = j ? C.formatJalali(j) : ''; preset = 'custom'; load(); } });

    $('#dFrom').addEventListener('change', () => { preset = 'custom'; load(); });
    $('#dTo').addEventListener('change', () => { preset = 'custom'; load(); });

    $$('[data-p]').forEach((b) => b.addEventListener('click', () => {
      $$('[data-p]').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
      preset = b.dataset.p;
      if (preset === 'cur') {
        const t0 = C.todayJalali();
        const r0 = C.jalaliMonthRange(t0.jy, t0.jm);
        refreshInputs({ from: C.formatJalali(r0.from), to: C.formatJalali(r0.to) });
      } else if (preset === 'all') {
        $('#dFrom').value = ''; $('#dTo').value = '';
      }
      load();
    }));

    $('#dReset').addEventListener('click', () => {
      $$('[data-p]').forEach((x) => x.classList.remove('active'));
      $('[data-p="cur"]').classList.add('active');
      preset = 'cur';
      const t0 = C.todayJalali();
      const r0 = C.jalaliMonthRange(t0.jy, t0.jm);
      refreshInputs({ from: C.formatJalali(r0.from), to: C.formatJalali(r0.to) });
      load();
    });

    load();
  }
});
})();
