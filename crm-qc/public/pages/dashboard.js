/* dashboard.js — نمای کلی سامانه */
(function () {
'use strict';
const { C, $, api, fa, esc, scorePill, slaBadge, durText, emptyState, toast } = UI;

App.register('dashboard', {
  title: 'داشبورد — نمای کلی',

  async render(root) {
    root.innerHTML = `<div class="loading-page"><div class="spinner"></div><p>در حال دریافت آمار…</p></div>`;
    const d = await api.get('/api/dashboard');
    const st = App.state;

    const kpi = (cls, icon, val, lbl, small) => `
      <div class="kpi ${cls}">
        <div class="kpi-ic"><i class="fa-solid ${icon}"></i></div>
        <div><div class="kpi-val">${val}${small ? ` <small>${small}</small>` : ''}</div><div class="kpi-lbl">${lbl}</div></div>
      </div>`;

    const avgAllTxt = d.avgAll === '' ? '—' : fa(d.avgAll) + ' <small>از ۱۰۰</small>';

    root.innerHTML = `
      <div class="page-head">
        <div class="ph-ic"><i class="fa-solid fa-gauge-high"></i></div>
        <div>
          <h2>داشبورد مدیریتی</h2>
          <p>تصویر زنده از عملکرد کنترل کیفیت تیکت و سوشال</p>
        </div>
        <div class="spacer"></div>
        <div class="stat-strip">
          <span class="ss"><i class="fa-solid fa-ticket" style="color:var(--brand)"></i><b>${fa(d.ticketCount)}</b> ارزیابی تیکت</span>
          <span class="ss"><i class="fa-solid fa-comments" style="color:var(--violet)"></i><b>${fa(d.socialCount)}</b> ارزیابی سوشال</span>
        </div>
      </div>

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
          <div class="card-head"><div class="head-icon"><i class="fa-solid fa-chart-column"></i></div><div><h3>توزیع نمرات</h3><div class="sub">تمام ارزیابی‌های نمره‌دار (تیکت + سوشال)</div></div></div>
          <div class="chart-box"><canvas id="chDist"></canvas></div>
        </div>
        <div class="card">
          <div class="card-head violet"><div class="head-icon"><i class="fa-solid fa-chart-pie"></i></div><div><h3>وضعیت SLA سوشال</h3><div class="sub">بر اساس محاسبه ساعات کاری (۹ تا ۱۸، تعطیلات: پنجشنبه/جمعه)</div></div></div>
          <div class="chart-box"><canvas id="chSla"></canvas></div>
        </div>
      </div>

      <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(420px,1fr))">
        <div class="card">
          <div class="card-head"><div class="head-icon"><i class="fa-solid fa-clock-rotate-left"></i></div><div><h3>آخرین ارزیابی‌های تیکت</h3></div>
            <div class="spacer"></div><a class="btn soft sm" href="#/tickets"><i class="fa-solid fa-list"></i> همه</a></div>
          <div class="table-wrap" id="lastTickets"></div>
        </div>
        <div class="card">
          <div class="card-head violet"><div class="head-icon"><i class="fa-solid fa-clock-rotate-left"></i></div><div><h3>آخرین ارزیابی‌های سوشال</h3></div>
            <div class="spacer"></div><a class="btn soft sm" href="#/socials"><i class="fa-solid fa-list"></i> همه</a></div>
          <div class="table-wrap" id="lastSocials"></div>
        </div>
      </div>`;

    // نمودار توزیع
    App.chart($('#chDist'), {
      type: 'bar',
      data: {
        labels: ['زیر ۵۰', '۵۰ تا ۷۵', '۷۵ تا ۹۰', '۹۰ به بالا'],
        datasets: [{
          data: d.dist,
          backgroundColor: ['rgba(248,113,113,.75)', 'rgba(251,191,36,.75)', 'rgba(56,189,248,.75)', 'rgba(52,211,153,.75)'],
          borderRadius: 9,
          borderSkipped: false
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true, ticks: { precision: 0 }, grid: { color: 'rgba(34,48,79,.5)' } }, x: { grid: { display: false } } }
      }
    });

    // نمودار SLA
    const slaHas = (d.slaOk + d.slaMissed + d.unanswered) > 0;
    App.chart($('#chSla'), {
      type: 'doughnut',
      data: {
        labels: ['رعایت شده', 'رعایت نشده', 'بدون پاسخ'],
        datasets: [{
          data: slaHas ? [d.slaOk, d.slaMissed, d.unanswered] : [1, 0, 0],
          backgroundColor: ['rgba(52,211,153,.85)', 'rgba(248,113,113,.85)', 'rgba(251,191,36,.85)'],
          borderColor: '#111a2e', borderWidth: 3
        }]
      },
      options: { responsive: true, maintainAspectRatio: false, cutout: '62%', plugins: { legend: { position: 'bottom' } } }
    });

    // جدول‌های اخیر
    const lt = d.latestTickets;
    $('#lastTickets').innerHTML = lt.length ? `<table class="tbl"><thead><tr>
      <th>کارشناس</th><th>تیم</th><th>کد تیکت</th><th>تاریخ بررسی</th><th>نمره</th></tr></thead><tbody>
      ${lt.map((t) => `<tr><td class="cell-main">${esc(t.agentName)}</td><td><span class="tag-team">${esc(t.team)}</span></td>
        <td>${esc(t.ticketCode)}</td><td>${fa(t.reviewDate)}</td><td>${scorePill(t.score)}</td></tr>`).join('')}
    </tbody></table>` : emptyState('fa-ticket', 'هنوز ارزیابی تیکتی ثبت نشده', 'از بخش «ارزیابی تیکت → ثبت ارزیابی» اولین مورد را ثبت کنید.', `<a class="btn primary sm" href="#/tickets/new"><i class="fa-solid fa-plus"></i>ثبت ارزیابی</a>`);

    const ls = d.latestSocials;
    $('#lastSocials').innerHTML = ls.length ? `<table class="tbl"><thead><tr>
      <th>کارشناس</th><th>پیامرسان</th><th>مدت پاسخ</th><th>SLA</th><th>نمره</th></tr></thead><tbody>
      ${ls.map((s) => `<tr><td class="cell-main">${esc(s.agentName)}</td><td><span class="badge blue">${esc(s.messenger)}</span></td>
        <td>${durText(s.durationMin, s.durationError)}</td><td>${slaBadge(s.slaStatus)}</td><td>${scorePill(s.score)}</td></tr>`).join('')}
    </tbody></table>` : emptyState('fa-comments', 'هنوز ارزیابی سوشالی ثبت نشده', 'از بخش «ارزیابی سوشال → ثبت ارزیابی» اولین مورد را ثبت کنید.', `<a class="btn primary sm" href="#/socials/new"><i class="fa-solid fa-plus"></i>ثبت ارزیابی</a>`);
  }
});
})();
