(() => {
  'use strict';

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const DIGITS = '۰۱۲۳۴۵۶۷۸۹';
  const MONTHS = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'];
  const PAGE_META = {
    dashboard: { title: 'داشبورد', eyebrow: 'مرور سریع عملکرد', subtitle: 'نمایی روشن از ارزیابی‌ها و وضعیت تیم، بدون دست‌کاری فایل‌های اصلی.' },
    evaluations: { title: 'ارزیابی‌ها', eyebrow: 'سوابق قابل مشاهده', subtitle: 'جست‌وجو و بررسی سریع ریت‌های موجود در فایل‌های مرجع.' },
    agents: { title: 'کارشناسان', eyebrow: 'فهرست تیم', subtitle: 'اطلاعات کارشناسان و خلاصهٔ عملکرد از روی داده‌های موجود.' },
    reports: { title: 'گزارش‌های سریع', eyebrow: 'خلاصهٔ مدیریتی', subtitle: 'توزیع نمره و معیارهای نیازمند توجه در ریت‌های تماس.' },
    data: { title: 'فایل‌های داده', eyebrow: 'شفافیت منبع', subtitle: 'مشاهدهٔ فایل‌هایی که این نسخه می‌خواند و وضعیت هرکدام.' }
  };

  const ICONS = {
    home: '<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/><path d="M9 21v-6h6v6"/>',
    list: '<path d="M9 6h11M9 12h11M9 18h11"/><path d="M4 6h.01M4 12h.01M4 18h.01"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
    chart: '<path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-5 5"/><path d="M19 13V9h-4"/>',
    database: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.66 3.58 3 8 3s8-1.34 8-3V5"/><path d="M4 12c0 1.66 3.58 3 8 3s8-1.34 8-3"/>',
    lock: '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/><path d="M12 14v3"/>',
    shield: '<path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11z"/><path d="m9 12 2 2 4-4"/>',
    filter: '<path d="M4 4h16l-6.3 7.4a2 2 0 0 0-.5 1.3V18l-4.4 2v-7.3a2 2 0 0 0-.5-1.3z"/>',
    x: '<path d="m18 6-12 12M6 6l12 12"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
    refresh: '<path d="M20 7v5h-5"/><path d="M4 17v-5h5"/><path d="M5.6 9a7 7 0 0 1 11.6-2L20 12M4 12l2.8 5a7 7 0 0 0 11.6-2"/>',
    search: '<circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 5 5"/>',
    arrowLeft: '<path d="M19 12H5M12 19l-7-7 7-7"/>',
    arrowRight: '<path d="M5 12h14M12 5l7 7-7 7"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5M12 15V3"/>',
    phone: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.4 19.4 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7l.5 3.2a2 2 0 0 1-.6 1.7L7.7 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 1.7-.6l3.2.5a2 2 0 0 1 1.7 2.4z"/>',
    ticket: '<path d="M3 8a2 2 0 0 0 0 4v4a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-4a2 2 0 0 1 0-4V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2z"/><path d="M13 5v2M13 11v2M13 17v2"/>',
    message: '<path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8z"/>',
    alert: '<path d="M10.3 4.3 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 4.3a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
    arrowUp: '<path d="m18 15-6-6-6 6"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/>',
    file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h8"/>',
    person: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    star: '<path d="m12 3 2.7 5.5 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>'
  };

  function icon(name, size = 18) {
    return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ICONS.info}</svg>`;
  }
  function hydrateIcons(root = document) {
    $$('[data-icon]', root).forEach((node) => { node.innerHTML = icon(node.dataset.icon, 18); });
  }
  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  }
  function faDigits(value) { return String(value == null ? '' : value).replace(/\d/g, (digit) => DIGITS[Number(digit)]); }
  function searchKey(value) {
    return String(value == null ? '' : value).normalize('NFKC')
      .replace(/[يى]/g, 'ی').replace(/ك/g, 'ک')
      .replace(/[۰-۹٠-٩]/g, (digit) => String(digit.charCodeAt(0) - (digit.charCodeAt(0) >= 0x06f0 ? 0x06f0 : 0x0660)))
      .replace(/[\s‌‍]/g, '').toLocaleLowerCase('fa');
  }
  function number(value, digits = 0) {
    if (value == null || value === '' || !Number.isFinite(Number(value))) return '—';
    return new Intl.NumberFormat('fa-IR', { maximumFractionDigits: digits, minimumFractionDigits: 0 }).format(Number(value));
  }
  function scoreText(value) { return value == null || value === '' ? '—' : `${number(value, 1)}٪`; }
  function scoreClass(value) {
    if (value == null || value === '') return 'muted';
    if (Number(value) >= 90) return '';
    if (Number(value) >= 75) return 'mid';
    return 'low';
  }
  function avatarLetter(name) { return Array.from(String(name || '').trim())[0] || 'ک'; }
  function monthKey(date) { return /^\d{4}\/\d{2}/.test(String(date || '')) ? String(date).slice(0, 7) : ''; }
  function monthLabel(key, includeYear = true) {
    const match = /^(\d{4})\/(\d{2})$/.exec(String(key || ''));
    if (!match) return 'نامشخص';
    const month = Number(match[2]);
    if (month < 1 || month > 12) return faDigits(key);
    return `${MONTHS[month - 1]}${includeYear ? ` ${faDigits(match[1])}` : ''}`;
  }
  function dateLabel(date, includeYear = false) {
    const match = /^(\d{4})\/(\d{2})\/(\d{2})$/.exec(String(date || ''));
    if (!match) return '—';
    const day = Number(match[3]);
    const month = Number(match[2]);
    if (month < 1 || month > 12) return faDigits(date);
    return `${faDigits(day)} ${MONTHS[month - 1]}${includeYear ? ` ${faDigits(match[1])}` : ''}`;
  }
  function selectedCalls() {
    const data = state.snapshot;
    if (!data) return [];
    return data.calls.filter((row) => {
      if (state.team !== 'all' && row.team !== state.team) return false;
      if (state.month !== 'all' && monthKey(row.reviewDate) !== state.month) return false;
      return true;
    });
  }
  function teamNames() { return state.snapshot ? state.snapshot.teams : []; }
  function allMonths() {
    if (!state.snapshot) return [];
    return [...new Set(state.snapshot.calls.map((row) => monthKey(row.reviewDate)).filter(Boolean))].sort();
  }
  function average(rows) {
    const scores = rows.map((row) => Number(row.score)).filter(Number.isFinite);
    return scores.length ? scores.reduce((sum, score) => sum + score, 0) / scores.length : null;
  }
  function byAgent(rows, name) { return rows.filter((row) => row.expertName === name); }
  function currentRoute() {
    const route = String(location.hash || '#/dashboard').replace(/^#\/?/, '').split('?')[0];
    return PAGE_META[route] ? route : 'dashboard';
  }

  const state = {
    snapshot: null,
    route: currentRoute(),
    team: 'all',
    month: 'all',
    evalType: 'all',
    evalSearch: '',
    evalPage: 1,
    agentSearch: '',
    agentPage: 1,
    pageSize: 15,
    bannerVisible: true
  };

  function setPageMeta(route) {
    const meta = PAGE_META[route] || PAGE_META.dashboard;
    $('#topTitle').textContent = meta.title;
    $('#pageTitle').textContent = meta.title;
    $('#pageEyebrow').textContent = meta.eyebrow;
    $('#pageSubtitle').textContent = meta.subtitle;
    $('#pageContent').setAttribute('aria-busy', 'false');
    $('.global-filters').hidden = route === 'data';
    $('.source-banner').hidden = !state.bannerVisible;
    $$('.nav-link, .mobile-nav a').forEach((link) => link.classList.toggle('is-active', link.dataset.route === route));
  }

  function populateFilters() {
    const teamSelect = $('#teamFilter');
    teamSelect.innerHTML = '<option value="all">همهٔ تیم‌ها</option>' + teamNames().map((team) => `<option value="${esc(team)}">${esc(team)}</option>`).join('');
    teamSelect.value = state.team;
    const monthSelect = $('#monthFilter');
    monthSelect.innerHTML = '<option value="all">همهٔ ماه‌ها</option>' + allMonths().map((month) => `<option value="${esc(month)}">${esc(monthLabel(month))}</option>`).join('');
    monthSelect.value = state.month;
    $('#navEvalCount').textContent = number(state.snapshot.counts.calls);
    $('#navAgentCount').textContent = number(state.snapshot.counts.agents);
  }

  function cardHead(title, subtitle, iconName, action = '') {
    return `<div class="card-head"><span class="head-icon">${icon(iconName, 16)}</span><div class="head-copy"><h2>${esc(title)}</h2>${subtitle ? `<p>${esc(subtitle)}</p>` : ''}</div><span class="head-spacer"></span>${action}</div>`;
  }
  function kpiCard(title, value, foot, iconName, tone, unit = '') {
    return `<article class="kpi-card ${tone}"><div class="kpi-top"><span>${esc(title)}</span><span class="kpi-icon">${icon(iconName, 15)}</span></div><div class="kpi-value">${value}${unit ? `<span class="unit">${unit}</span>` : ''}</div><div class="kpi-foot">${esc(foot)}</div></article>`;
  }
  function scorePill(value) { return `<span class="score-pill ${scoreClass(value)}">${esc(scoreText(value))}</span>`; }
  function typeLabel(type) { return type === 'account' ? 'اکانت' : type === 'mlm' ? 'MLM' : type === 'tele' ? 'تلفنی' : type === 'social' ? 'سوشال' : 'تیکت'; }
  function typeTag(type) { return `<span class="type-tag ${type === 'account' ? 'account' : type === 'mlm' ? 'mlm' : ''}">${esc(typeLabel(type))}</span>`; }
  function teamTag(team) { return `<span class="team-tag">${esc(team || 'نامشخص')}</span>`; }

  function buildTrendChart(rows) {
    const buckets = new Map();
    rows.forEach((row) => {
      const key = monthKey(row.reviewDate);
      if (!key || row.score == null) return;
      const bucket = buckets.get(key) || { sum: 0, count: 0 };
      bucket.sum += Number(row.score); bucket.count += 1; buckets.set(key, bucket);
    });
    const values = [...buckets.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, bucket]) => ({ key, avg: bucket.sum / bucket.count, count: bucket.count }));
    if (!values.length) return '<div class="chart-empty">برای این فیلتر دادهٔ امتیازداری پیدا نشد.</div>';

    const width = 640, height = 205, left = 39, right = 14, top = 24, bottom = 38;
    const plotW = width - left - right, plotH = height - top - bottom;
    const vals = values.map((item) => item.avg);
    const minValue = Math.max(0, Math.floor((Math.min(...vals) - 5) / 10) * 10);
    const maxValue = Math.min(100, Math.max(100, Math.ceil((Math.max(...vals) + 3) / 10) * 10));
    const span = Math.max(10, maxValue - minValue);
    const xAt = (index) => values.length === 1 ? left + plotW / 2 : left + plotW * index / (values.length - 1);
    const yAt = (score) => top + plotH - ((score - minValue) / span) * plotH;
    const line = values.map((item, index) => `${index ? 'L' : 'M'} ${xAt(index).toFixed(1)} ${yAt(item.avg).toFixed(1)}`).join(' ');
    const area = `${line} L ${xAt(values.length - 1).toFixed(1)} ${(top + plotH).toFixed(1)} L ${xAt(0).toFixed(1)} ${(top + plotH).toFixed(1)} Z`;
    const ticks = [minValue, (minValue + maxValue) / 2, maxValue];
    const grid = ticks.map((tick) => `<g><line class="grid-line" x1="${left}" y1="${yAt(tick)}" x2="${width - right}" y2="${yAt(tick)}"/><text x="${left - 9}" y="${yAt(tick) + 4}" text-anchor="end">${esc(number(tick))}</text></g>`).join('');
    const labels = values.map((item, index) => `<text x="${xAt(index)}" y="${height - 9}" text-anchor="middle">${esc(monthLabel(item.key, false))}</text>`).join('');
    const points = values.map((item, index) => `<g><title>${esc(monthLabel(item.key))}: ${esc(scoreText(item.avg))} · ${esc(number(item.count))} ارزیابی</title><circle class="point" cx="${xAt(index)}" cy="${yAt(item.avg)}" r="4.2"/><text class="point-label" x="${xAt(index)}" y="${yAt(item.avg) - 12}" text-anchor="middle">${esc(number(item.avg, 1))}</text></g>`).join('');
    return `<svg class="score-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="میانگین نمرهٔ تماس به تفکیک ماه"><defs><linearGradient id="scoreGradient" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#36a992" stop-opacity=".20"/><stop offset="1" stop-color="#36a992" stop-opacity=".015"/></linearGradient></defs>${grid}<path class="area" d="${area}"/><path class="line" d="${line}"/>${points}${labels}</svg>`;
  }

  function renderTeams(rows) {
    const names = state.team === 'all' ? teamNames() : [state.team];
    const stats = names.map((team) => {
      const teamRows = rows.filter((row) => row.team === team);
      return { team, rows: teamRows, avg: average(teamRows), count: teamRows.length, agents: new Set(teamRows.map((row) => row.expertName)).size };
    });
    const maxCount = Math.max(1, ...stats.map((item) => item.count));
    if (!stats.length) return '<div class="chart-empty">تیمی برای نمایش وجود ندارد.</div>';
    return `<div class="team-list">${stats.map((item) => `<div class="team-row ${item.count ? '' : 'team-zero'}"><div class="team-name">${esc(item.team)}<small>${esc(number(item.agents))} کارشناس دارای ریت</small></div><div class="progress-track" title="${esc(number(item.count))} ارزیابی"><div class="progress-fill" style="width:${Math.max(item.count ? 2 : 0, item.count / maxCount * 100)}%"></div></div><div class="team-number">${esc(number(item.count))}<small>ارزیابی</small></div><div class="team-number">${esc(item.avg == null ? '—' : `${number(item.avg, 1)}٪`)}<small>میانگین</small></div></div>`).join('')}</div>`;
  }

  function renderLatest(rows) {
    const latest = rows.slice().sort((a, b) => String(b.reviewDate).localeCompare(String(a.reviewDate)) || Number(b.sourceRow || 0) - Number(a.sourceRow || 0)).slice(0, 5);
    if (!latest.length) return '<div class="empty-state"><span class="empty-icon">' + icon('list', 20) + '</span><strong>ارزیابی‌ای در این بازه نیست</strong><p>فیلتر ماه یا تیم را پاک کنید تا تمام داده‌های موجود دیده شوند.</p></div>';
    return `<div class="latest-list">${latest.map((row) => `<div class="latest-row"><div class="person-cell"><span class="avatar">${esc(avatarLetter(row.expertName))}</span><div class="person-copy"><strong>${esc(row.expertName || 'بدون نام')}</strong><small>${esc(typeLabel(row.formType))} · ${esc(dateLabel(row.reviewDate))}</small></div></div><span class="latest-meta team-meta">${esc(row.team || '—')}</span>${scorePill(row.score)}<button class="button latest-open" data-assessment="${esc(row.id)}" type="button" aria-label="جزئیات ارزیابی">${icon('arrowLeft', 13)}</button></div>`).join('')}</div>`;
  }

  function renderCoverage(rows) {
    const selectedTeam = state.team === 'all' ? '' : ` در ${state.team}`;
    return `<div class="coverage-grid"><div class="coverage-card"><span class="coverage-icon">${icon('phone', 16)}</span><div class="coverage-copy"><strong>ریت تماس</strong><span>${esc(selectedTeam ? `دادهٔ موجود${selectedTeam}` : 'فایل‌های مرجع')}</span></div><span class="coverage-count">${esc(number(rows.length))}</span></div><div class="coverage-card empty"><span class="coverage-icon">${icon('ticket', 16)}</span><div class="coverage-copy"><strong>تیکت</strong><span>رکورد کامل در فایل نیست</span></div><span class="coverage-count">${esc(number(0))}</span></div><div class="coverage-card empty"><span class="coverage-icon">${icon('message', 16)}</span><div class="coverage-copy"><strong>سوشال</strong><span>رکورد کامل در فایل نیست</span></div><span class="coverage-count">${esc(number(0))}</span></div></div>`;
  }

  function renderDashboard() {
    const rows = selectedCalls();
    const avg = average(rows);
    const ratedAgents = new Set(rows.map((row) => row.expertName).filter(Boolean)).size;
    const redlines = rows.filter((row) => row.redline === 1).length;
    const highScores = rows.filter((row) => Number(row.score) >= 90).length;
    return `<div class="stack">
      <section class="kpi-grid" aria-label="شاخص‌های اصلی">
        ${kpiCard('ارزیابی تماس', number(rows.length), 'از فایل‌های مرجع خوانده شده', 'phone', 'blue')}
        ${kpiCard('میانگین نمره', avg == null ? '—' : number(avg, 1), 'نمرهٔ ذخیره‌شده · بدون بازنمره‌دهی', 'chart', 'green', avg == null ? '' : '٪')}
        ${kpiCard('کارشناس دارای ریت', number(ratedAgents), `از ${number(state.snapshot.agents.length)} کارشناس فهرست‌شده`, 'users', 'amber')}
        ${kpiCard('ردلاین', number(redlines), `${number(highScores)} ارزیابی با نمرهٔ ۹۰ یا بالاتر`, 'alert', 'red')}
      </section>

      <div class="grid two">
        <section class="card card-pad chart-card">${cardHead('روند میانگین نمره', 'میانگین ارزیابی‌های تماس بر اساس ماه بررسی', 'chart', '<span class="chart-legend"><i class="legend-dot"></i>میانگین نمره</span>')}${buildTrendChart(rows)}</section>
        <section class="card card-pad">${cardHead('عملکرد تیم‌ها', 'تعداد ارزیابی و میانگین نمره', 'users')} ${renderTeams(rows)}</section>
      </div>

      <section class="card card-pad">${cardHead('پوشش داده‌ها', 'فقط ردیف‌های کامل و قابل استفاده در آمار شمرده شده‌اند.', 'database')} ${renderCoverage(rows)}</section>

      <section class="card card-pad">${cardHead('آخرین ارزیابی‌ها', 'برای دیدن جزئیات، روی دکمهٔ هر ردیف بزنید.', 'list', `<a class="card-link" href="#/evaluations">همهٔ ارزیابی‌ها ${icon('arrowLeft', 13)}</a>`)}${renderLatest(rows)}</section>
    </div>`;
  }

  function filteredEvaluations() {
    const query = searchKey(state.evalSearch);
    return selectedCalls().filter((row) => {
      if (state.evalType === 'ticket' || state.evalType === 'social') return false;
      if (state.evalType !== 'all' && row.formType !== state.evalType) return false;
      if (!query) return true;
      return [row.expertName, row.team, row.qcAgent, row.reviewDate, row.formType]
        .some((value) => searchKey(value).includes(query));
    }).sort((a, b) => String(b.reviewDate).localeCompare(String(a.reviewDate)) || Number(b.sourceRow || 0) - Number(a.sourceRow || 0));
  }

  function evalTab(label, value, count) {
    const active = state.evalType === value;
    return `<button type="button" class="tab-button ${active ? 'is-active' : ''}" data-eval-type="${esc(value)}">${esc(label)}<span class="tab-count">${esc(number(count))}</span></button>`;
  }

  function assessmentRow(row) {
    const sourceType = row.formType;
    const redline = row.redline === 1 ? `<span class="redline-pill">${icon('alert', 12)}ردلاین</span>` : '<span class="latest-meta">—</span>';
    return `<tr><td class="date-text">${esc(dateLabel(row.reviewDate, true))}</td><td><button class="agent-name-button" type="button" data-profile-name="${esc(row.expertName)}"><span class="avatar">${esc(avatarLetter(row.expertName))}</span>${esc(row.expertName || 'بدون نام')}</button></td><td>${teamTag(row.team)}</td><td>${typeTag(sourceType)}</td><td>${scorePill(row.score)}</td><td>${redline}</td><td>${esc(row.qcAgent || '—')}</td><td class="actions-cell"><button class="button" type="button" data-assessment="${esc(row.id)}">جزئیات</button></td></tr>`;
  }

  function renderEvalResults() {
    const target = $('#evalResults');
    if (!target) return;
    const rows = filteredEvaluations();
    const total = rows.length;
    const maxPage = Math.max(1, Math.ceil(total / state.pageSize));
    state.evalPage = Math.min(Math.max(1, state.evalPage), maxPage);
    const startIndex = (state.evalPage - 1) * state.pageSize;
    const pageRows = rows.slice(startIndex, startIndex + state.pageSize);
    if (!total) {
      const selectedEmpty = state.evalType === 'ticket' || state.evalType === 'social';
      target.innerHTML = `<section class="card">${emptyState(selectedEmpty ? 'ارزیابی کامل پیدا نشد' : 'نتیجه‌ای با این فیلتر پیدا نشد', selectedEmpty ? 'فایل مرجع تیکت/سوشال در حال حاضر فقط قالب یا ردیف ناقص دارد. برای شفافیت، هیچ داده‌ای حدس زده یا وارد آمار نشده است.' : 'عبارت جست‌وجو را عوض کنید یا فیلترهای بالا را پاک کنید.', selectedEmpty ? 'file' : 'search')}<div class="table-note">برای مشاهدهٔ وضعیت فایل‌ها به بخش <a href="#/data" class="card-link">فایل‌های داده</a> بروید.</div></section>`;
      return;
    }
    const table = `<section class="card table-card"><div class="table-wrap"><table class="data-table"><thead><tr><th>تاریخ بررسی</th><th>کارشناس</th><th>تیم</th><th>فرم</th><th>نمره</th><th>ردلاین</th><th>کارشناس QC</th><th></th></tr></thead><tbody>${pageRows.map(assessmentRow).join('')}</tbody></table></div><div class="table-footer"><span>نمایش ${esc(number(startIndex + 1))} تا ${esc(number(Math.min(startIndex + state.pageSize, total)))} از ${esc(number(total))} ارزیابی</span><div class="pager"><button type="button" data-eval-page="prev" aria-label="صفحه قبلی" ${state.evalPage <= 1 ? 'disabled' : ''}>${icon('arrowRight', 14)}</button><span class="pager-label">صفحه ${esc(number(state.evalPage))} از ${esc(number(maxPage))}</span><button type="button" data-eval-page="next" aria-label="صفحه بعدی" ${state.evalPage >= maxPage ? 'disabled' : ''}>${icon('arrowLeft', 14)}</button></div></div></section>`;
    target.innerHTML = table;
  }

  function emptyState(title, message, iconName = 'list') {
    return `<div class="empty-state"><span class="empty-icon">${icon(iconName, 21)}</span><strong>${esc(title)}</strong><p>${esc(message)}</p></div>`;
  }

  function renderEvaluations() {
    const accountCount = selectedCalls().filter((row) => row.formType === 'account').length;
    const mlmCount = selectedCalls().filter((row) => row.formType === 'mlm').length;
    const total = accountCount + mlmCount;
    return `<div class="section-toolbar"><div><h2>فهرست ارزیابی‌ها</h2><p>${esc(number(total))} ریت تماس با فیلتر فعلی؛ جزئیات از فایل منبع می‌آید.</p></div><div class="toolbar-actions"><label class="search-box">${icon('search', 15)}<input id="evalSearch" type="search" autocomplete="off" placeholder="جست‌وجو: نام کارشناس یا QC" value="${esc(state.evalSearch)}" aria-label="جست‌وجوی ارزیابی‌ها"></label><button class="button" id="exportCsv" type="button" ${total ? '' : 'disabled'}>${icon('download', 14)}خروجی CSV</button></div></div>
      <div class="tab-row" role="tablist" aria-label="نوع ارزیابی">${evalTab('همه', 'all', total)}${evalTab('اکانت', 'account', accountCount)}${evalTab('MLM', 'mlm', mlmCount)}${evalTab('تیکت', 'ticket', 0)}${evalTab('سوشال', 'social', 0)}</div>
      <div id="evalResults"></div>`;
  }

  function currentAgents() {
    const query = searchKey(state.agentSearch);
    return state.snapshot.agents.filter((agent) => {
      if (agent.active === false) return false;
      if (state.team !== 'all' && agent.team !== state.team) return false;
      if (!query) return true;
      return [agent.name, agent.team, agent.ext].some((value) => searchKey(value).includes(query));
    }).sort((a, b) => a.team.localeCompare(b.team, 'fa') || a.name.localeCompare(b.name, 'fa'));
  }

  function renderAgentResults() {
    const target = $('#agentResults');
    if (!target) return;
    const agents = currentAgents();
    const calls = selectedCalls();
    const maxPage = Math.max(1, Math.ceil(agents.length / state.pageSize));
    state.agentPage = Math.min(Math.max(1, state.agentPage), maxPage);
    const start = (state.agentPage - 1) * state.pageSize;
    const pageAgents = agents.slice(start, start + state.pageSize);
    if (!agents.length) {
      target.innerHTML = `<section class="card">${emptyState('کارشناسی پیدا نشد', 'نام یا داخلی را بررسی کنید یا فیلتر تیم را تغییر دهید.', 'search')}</section>`;
      return;
    }
    const rows = pageAgents.map((agent) => {
      const ownCalls = byAgent(calls, agent.name);
      const avg = average(ownCalls);
      return `<tr><td><button class="agent-name-button" type="button" data-profile="${esc(agent.id)}"><span class="avatar">${esc(avatarLetter(agent.name))}</span>${esc(agent.name)}</button></td><td>${teamTag(agent.team)}</td><td class="numeric">${esc(number(agent.ext))}</td><td class="numeric">${esc(number(ownCalls.length))}</td><td>${scorePill(avg)}<span class="agent-score-sub">${ownCalls.length ? `${esc(number(ownCalls.length))} ریت تماس` : 'بدون ریت در فایل‌های موجود'}</span></td><td class="actions-cell"><button class="button" type="button" data-profile="${esc(agent.id)}">پرونده</button></td></tr>`;
    }).join('');
    target.innerHTML = `<section class="card table-card"><div class="table-wrap"><table class="data-table"><thead><tr><th>کارشناس</th><th>تیم</th><th>داخلی</th><th>تعداد ریت</th><th>میانگین نمره تماس</th><th></th></tr></thead><tbody>${rows}</tbody></table></div><div class="table-footer"><span>نمایش ${esc(number(start + 1))} تا ${esc(number(Math.min(start + state.pageSize, agents.length)))} از ${esc(number(agents.length))} کارشناس</span><div class="pager"><button type="button" data-agent-page="prev" aria-label="صفحه قبلی" ${state.agentPage <= 1 ? 'disabled' : ''}>${icon('arrowRight', 14)}</button><span class="pager-label">صفحه ${esc(number(state.agentPage))} از ${esc(number(maxPage))}</span><button type="button" data-agent-page="next" aria-label="صفحه بعدی" ${state.agentPage >= maxPage ? 'disabled' : ''}>${icon('arrowLeft', 14)}</button></div></div></section>`;
  }

  function renderAgents() {
    const activeCalls = selectedCalls();
    const withReviews = new Set(activeCalls.map((row) => row.expertName));
    const currentRoster = state.snapshot.agents.filter((agent) => agent.active !== false && (state.team === 'all' || agent.team === state.team));
    const currentTeams = [...new Set(currentRoster.map((agent) => agent.team))].length;
    return `<div class="directory-summary"><span class="summary-chip"><strong>${esc(number(currentRoster.length))}</strong> کارشناس در فهرست</span><span class="summary-chip"><strong>${esc(number(currentTeams))}</strong> تیم</span><span class="summary-chip"><strong>${esc(number(withReviews.size))}</strong> دارای ریت در بازه</span></div><div class="section-toolbar"><div><h2>فهرست کارشناسان</h2><p>برای دیدن آمار و سوابق هر فرد، روی نام یا «پرونده» بزنید.</p></div><div class="toolbar-actions"><label class="search-box">${icon('search', 15)}<input id="agentSearch" type="search" autocomplete="off" placeholder="جست‌وجو با نام یا داخلی" value="${esc(state.agentSearch)}" aria-label="جست‌وجوی کارشناسان"></label></div></div><div id="agentResults"></div>`;
  }

  function normalizeTri(value) {
    if (value === 1 || value === '1' || value === true) return 1;
    if (value === 0 || value === '0' || value === false) return 0;
    if (value === '-') return '-';
    return '';
  }

  function criteriaStats(rows) {
    const byKey = new Map();
    rows.forEach((row) => {
      Object.entries(row.elements || {}).forEach(([key, raw]) => {
        const value = normalizeTri(raw);
        if (value === '') return;
        const groupKey = `${row.formType}:${key}`;
        const item = byKey.get(groupKey) || { key, formType: row.formType, ok: 0, bad: 0, na: 0 };
        if (value === 1) item.ok += 1;
        else if (value === 0) item.bad += 1;
        else item.na += 1;
        byKey.set(groupKey, item);
      });
    });
    return [...byKey.values()].map((item) => {
      const applicable = item.ok + item.bad;
      return { ...item, applicable, errorRate: applicable ? item.bad / applicable * 100 : 0, successRate: applicable ? item.ok / applicable * 100 : 0 };
    }).filter((item) => item.applicable > 0).sort((a, b) => b.bad - a.bad || a.successRate - b.successRate);
  }

  function renderCriteria(rows) {
    const stats = criteriaStats(rows).slice(0, 8);
    if (!stats.length) return emptyState('معیار قابل محاسبه نیست', 'دادهٔ معیارها برای بازهٔ انتخاب‌شده وجود ندارد.', 'chart');
    return `<div class="criteria-list">${stats.map((item) => {
      const labels = state.snapshot.criteriaLabels[item.formType] || {};
      const label = labels[item.key] || item.key;
      return `<div class="criteria-row"><div class="criteria-name">${esc(label)}<span class="criteria-sub">${esc(typeLabel(item.formType))}</span></div><div class="rate-track" title="نرخ رعایت ${esc(number(item.successRate, 1))}٪"><div class="rate-fill ${item.errorRate >= 25 ? 'bad' : ''}" style="width:${Math.max(2, item.errorRate)}%"></div></div><div class="criteria-rate ${item.errorRate >= 25 ? 'bad' : ''}">${esc(number(item.errorRate, 1))}٪ خطا</div><div class="criteria-count">${esc(number(item.bad))} خطا</div></div>`;
    }).join('')}</div>`;
  }

  function renderDistribution(rows) {
    const groups = [
      { label: '۹۰ تا ۱۰۰', count: rows.filter((row) => Number(row.score) >= 90).length, klass: '' },
      { label: '۷۵ تا کمتر از ۹۰', count: rows.filter((row) => Number(row.score) >= 75 && Number(row.score) < 90).length, klass: 'warn' },
      { label: 'کمتر از ۷۵', count: rows.filter((row) => Number(row.score) < 75).length, klass: 'bad' }
    ];
    if (!rows.length) return emptyState('داده‌ای برای توزیع نمره نیست', 'فیلترها را تغییر دهید تا گزارش‌های موجود دیده شوند.', 'chart');
    return `<div class="distribution">${groups.map((item) => `<div class="distribution-row"><span class="distribution-label">${esc(item.label)}</span><div class="distribution-track"><div class="distribution-fill ${item.klass}" style="width:${item.count ? Math.max(2, item.count / rows.length * 100) : 0}%"></div></div><span class="distribution-value">${esc(number(item.count))} · ${esc(number(item.count / rows.length * 100, 1))}٪</span></div>`).join('')}</div><p class="table-note">درصدها بر اساس ${esc(number(rows.length))} ریت تماس فیلترشده محاسبه شده‌اند.</p>`;
  }

  function renderReports() {
    const rows = selectedCalls();
    const teamAction = '<a href="#/agents" class="card-link">فهرست کارشناسان ' + icon('arrowLeft', 13) + '</a>';
    return `<div class="kpi-grid">${kpiCard('تعداد ارزیابی', number(rows.length), 'در فیلتر فعلی', 'phone', 'blue')}${kpiCard('میانگین نمره', average(rows) == null ? '—' : number(average(rows), 1), 'از نمره‌های ثبت‌شده', 'chart', 'green', average(rows) == null ? '' : '٪')}${kpiCard('ردلاین ثبت‌شده', number(rows.filter((row) => row.redline === 1).length), 'بر اساس مقدار ذخیره‌شده در فایل', 'alert', 'red')}${kpiCard('کارشناس دارای ریت', number(new Set(rows.map((row) => row.expertName)).size), 'در بازهٔ انتخاب‌شده', 'users', 'amber')}</div><div class="report-grid"><section class="card card-pad">${cardHead('توزیع نمره', 'بازه‌های نمرهٔ تماس', 'chart')}${renderDistribution(rows)}</section><section class="card card-pad">${cardHead('مقایسهٔ تیم‌ها', 'تعداد ارزیابی و میانگین', 'users', teamAction)}${renderTeams(rows)}</section><section class="card card-pad">${cardHead('فرصت‌های بهبود', 'معیارها با بیشترین تعداد عدم رعایت', 'alert')}${renderCriteria(rows)}</section><section class="card card-pad">${cardHead('روند ماهانه', 'میانگین نمره بر اساس تاریخ بررسی', 'calendar')}${buildTrendChart(rows)}</section></div>`;
  }

  function formatSize(bytes) {
    if (!Number.isFinite(Number(bytes))) return '—';
    if (bytes < 1024) return `${number(bytes)} بایت`;
    const kb = bytes / 1024;
    return `${number(kb, 1)} کیلوبایت`;
  }
  function formatModified(value) {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return '—';
    try { return date.toLocaleString('fa-IR', { dateStyle: 'short', timeStyle: 'short' }); }
    catch (_) { return date.toISOString().slice(0, 16).replace('T', ' '); }
  }
  function sourceStatus(source) {
    if (source.status === 'loaded') return 'خوانده شد';
    if (source.status === 'template') return 'قالب / ناقص';
    return 'نامشخص';
  }
  function sourceRecordText(source) {
    if (source.id === 'ticket' || source.id === 'social') {
      return `${number(source.completeRecords || 0)} کامل · ${number(source.incompleteRows || 0)} ناقص`;
    }
    return `${number(source.records || 0)} رکورد`;
  }
  function renderSources() {
    return state.snapshot.sources.map((source) => `<article class="source-card"><div class="source-top"><span class="source-type-icon ${source.format === 'Excel' ? 'excel' : 'json'}">${icon(source.format === 'Excel' ? 'file' : 'database', 17)}</span><div class="source-title"><h3>${esc(source.label)}</h3><small dir="ltr">${esc(source.path)}</small></div><span class="source-status ${source.status === 'template' ? 'template' : ''}">${esc(sourceStatus(source))}</span></div><p class="source-description">${esc(source.note)}</p><div class="source-meta"><span class="source-records"><strong>${esc(sourceRecordText(source))}</strong></span><span>${esc(formatSize(source.sizeBytes))}</span><span>آخرین تغییر: ${esc(formatModified(source.modifiedAt))}</span></div></article>`).join('');
  }
  function renderData() {
    return `<div class="readonly-callout"><span class="safe-icon">${icon('lock', 16)}</span><div><strong>بدون هیچ عملیات نوشتن روی داده</strong><p>QC Lite فایل‌های ریشه را در لحظهٔ بارگذاری می‌خواند. آپلود، ذخیره، ویرایش و حذف در این نسخه وجود ندارد؛ فیلترها هم روی دیسک ذخیره نمی‌شوند.</p></div></div><div class="section-toolbar"><div><h2>منابع مورد استفاده</h2><p>مقادیر زیر از همین فایل‌ها خوانده شده‌اند و فایل اصلی دست‌نخورده می‌ماند.</p></div><span class="summary-chip"><span class="pulse-dot"></span> ${esc(number(state.snapshot.sources.length))} منبع</span></div><div class="source-grid">${renderSources()}</div><section class="card card-pad" style="margin-top:15px">${cardHead('یادداشت شفافیت', 'چه چیزی در آمار وارد می‌شود؟', 'info')}<div class="empty-copy" style="color:#75838c;font-size:10px;line-height:2">از ۲۹۳ ریت تماس کاملِ موجود، ۸۱ ریت MLM و ۲۱۲ ریت اکانت خوانده شده‌اند. فایل تیکت یک ردیف ناقص و فایل سوشال سه ردیف ناقص دارد؛ هیچ‌کدام به‌عنوان ارزیابی کامل شمرده نشده‌اند. فهرست ۶۵ کارشناس از فایل JSON مرجع خوانده می‌شود. هیچ داده‌ای به seed، اکسل، store یا حافظهٔ مرورگر نوشته نمی‌شود.</div></section>`;
  }

  function renderPage() {
    if (!state.snapshot) return;
    state.route = currentRoute();
    setPageMeta(state.route);
    let content = '';
    if (state.route === 'dashboard') content = renderDashboard();
    else if (state.route === 'evaluations') content = renderEvaluations();
    else if (state.route === 'agents') content = renderAgents();
    else if (state.route === 'reports') content = renderReports();
    else content = renderData();
    $('#pageContent').innerHTML = content;
    hydrateIcons($('#pageContent'));
    if (state.route === 'evaluations') renderEvalResults();
    if (state.route === 'agents') renderAgentResults();
    $('#pageContent').setAttribute('aria-busy', 'false');
  }

  function showToast(message) {
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerHTML = `${icon('check', 16)}<span>${esc(message)}</span>`;
    $('#toastZone').appendChild(toast);
    setTimeout(() => toast.remove(), 2600);
  }

  async function loadSnapshot({ silent = false } = {}) {
    const button = $('#refreshButton');
    button.classList.add('is-loading');
    button.disabled = true;
    try {
      const response = await fetch('/api/snapshot', { cache: 'no-store', headers: { 'Accept': 'application/json' } });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'خواندن داده‌ها ناموفق بود.');
      state.snapshot = payload;
      populateFilters();
      renderPage();
      if (!silent) showToast('داده‌های مرجع دوباره خوانده شدند؛ هیچ فایلی تغییر نکرد.');
      $('#footerNote').textContent = `آخرین بررسی فایل‌ها: ${formatModified(payload.loadedAt)}`;
    } catch (error) {
      $('#pageContent').setAttribute('aria-busy', 'false');
      $('#pageContent').innerHTML = `<section class="card">${emptyState('خواندن فایل‌های مرجع ممکن نشد', error.message || 'دوباره تلاش کنید.', 'alert')}<div style="text-align:center;padding:0 0 18px"><button type="button" class="button primary" id="retryLoad">تلاش دوباره</button></div></section>`;
    } finally {
      button.classList.remove('is-loading');
      button.disabled = false;
    }
  }

  function csvCell(value) {
    const str = String(value == null ? '' : value).replace(/"/g, '""');
    return `"${str}"`;
  }
  function exportCsv() {
    const rows = filteredEvaluations();
    if (!rows.length) return;
    const matrix = [
      ['تاریخ بررسی', 'کارشناس', 'تیم', 'نوع فرم', 'نمره', 'ردلاین', 'کارشناس QC', 'نام فایل مرجع'],
      ...rows.map((row) => [row.reviewDate, row.expertName, row.team, typeLabel(row.formType), row.score ?? '', row.redline === 1 ? 'بله' : 'خیر', row.qcAgent, row.sourceFile])
    ];
    const csv = '\ufeff' + matrix.map((line) => line.map(csvCell).join(',')).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'qc-lite-evaluations.csv';
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }

  function modalShell(title, body, iconName = 'info') {
    $('#modalRoot').innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-labelledby="modalTitle"><div class="modal-head"><span class="modal-icon">${icon(iconName, 16)}</span><h2 id="modalTitle">${esc(title)}</h2><button type="button" class="modal-close" data-modal-close aria-label="بستن">${icon('x', 15)}</button></div><div class="modal-body">${body}</div><div class="modal-foot"><button class="button" type="button" data-modal-close>بستن</button></div></div>`;
    hydrateIcons($('#modalRoot'));
    $('#modalRoot').setAttribute('tabindex', '-1');
    $('#modalRoot').focus();
  }

  function openAssessment(id) {
    const row = state.snapshot.calls.find((item) => item.id === id);
    if (!row) return;
    const items = [
      ['تاریخ بررسی', dateLabel(row.reviewDate, true)],
      ['کارشناس', row.expertName || '—'],
      ['تیم', row.team || '—'],
      ['نوع فرم', typeLabel(row.formType)],
      ['نمرهٔ ثبت‌شده', scoreText(row.score)],
      ['کارشناس QC', row.qcAgent || 'ثبت نشده'],
      ['تاریخ تماس', dateLabel(row.callDate, true)],
      ['زمان شنود (ثانیه)', row.listeningTime && row.listeningTime !== '-' ? row.listeningTime : 'ثبت نشده']
    ];
    const details = `<div class="detail-grid">${items.map(([label, value]) => `<div class="detail-item"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`).join('')}</div><div class="modal-section-title">معیارهای ثبت‌شده</div><div class="element-grid">${Object.entries(row.elements || {}).map(([key, value]) => {
      const label = (state.snapshot.criteriaLabels[row.formType] || {})[key] || key;
      const normalized = normalizeTri(value);
      const stateLabel = normalized === 1 ? 'رعایت' : normalized === 0 ? 'عدم رعایت' : normalized === '-' ? 'نامرتبط' : 'ثبت‌نشده';
      const stateClass = normalized === 1 ? '' : normalized === 0 ? 'bad' : normalized === '-' ? 'na' : 'unknown';
      return `<div class="element-item"><span>${esc(label)}</span><span class="element-state ${stateClass}">${esc(stateLabel)}</span></div>`;
    }).join('')}</div>${row.redline === 1 ? `<div class="modal-section-title">ردلاین</div><div class="comment-box">${esc(row.redlineReason || 'در فایل، ردلاین ثبت شده است.')}</div>` : ''}${row.qcComment ? `<div class="modal-section-title">توضیحات QC</div><div class="comment-box">${esc(row.qcComment)}</div>` : ''}<div class="table-note" style="margin-top:12px;padding:8px 0 0;background:transparent">منبع: ${esc(row.sourceFile)} · جزئیات تماس/اطلاعات شریک در این نما نمایش داده نمی‌شود.</div>`;
    modalShell('جزئیات ارزیابی', details, 'phone');
  }

  function openProfile(agentId, name = '') {
    const agent = agentId != null ? state.snapshot.agents.find((item) => String(item.id) === String(agentId)) : state.snapshot.agents.find((item) => item.name === name);
    if (!agent) return;
    const rows = byAgent(selectedCalls(), agent.name).sort((a, b) => String(b.reviewDate).localeCompare(String(a.reviewDate)) || Number(b.sourceRow || 0) - Number(a.sourceRow || 0));
    const avg = average(rows);
    const recent = rows.slice(0, 5);
    const summary = `<div class="modal-profile-head"><span class="avatar">${esc(avatarLetter(agent.name))}</span><div><h2>${esc(agent.name)}</h2><p>${esc(agent.team)} · داخلی ${esc(number(agent.ext))}</p></div></div><div class="profile-stats"><div class="profile-stat"><span>تعداد ریت تماس</span><strong>${esc(number(rows.length))}</strong></div><div class="profile-stat"><span>میانگین نمره</span><strong>${esc(avg == null ? '—' : `${number(avg, 1)}٪`)}</strong></div><div class="profile-stat"><span>ردلاین</span><strong>${esc(number(rows.filter((row) => row.redline === 1).length))}</strong></div></div>${cardHead('آخرین ارزیابی‌ها', 'بر اساس فیلتر فعلی', 'list')}${recent.length ? `<div class="profile-recent">${recent.map((row) => `<div class="latest-row"><div class="person-copy"><strong>${esc(typeLabel(row.formType))}</strong><small>${esc(dateLabel(row.reviewDate, true))}</small></div>${scorePill(row.score)}<button class="button latest-open" data-assessment="${esc(row.id)}" type="button" aria-label="جزئیات ارزیابی">${icon('arrowLeft', 13)}</button></div>`).join('')}</div>` : '<p style="margin:0;color:#8c999f;font-size:10px">برای این کارشناس در فیلتر فعلی ریت تماسی پیدا نشد.</p>'}<div class="table-note" style="margin-top:12px;padding:8px 0 0;background:transparent">تیکت و سوشال کامل در فایل‌های منبع موجود نیستند و به این خلاصه افزوده نشده‌اند.</div>`;
    modalShell(`پروندهٔ کارشناس`, summary, 'person');
  }

  function closeModal() { $('#modalRoot').innerHTML = ''; }

  function handlePageClick(event) {
    const target = event.target.closest('[data-assessment], [data-profile], [data-profile-name], [data-eval-type], [data-eval-page], [data-agent-page], #exportCsv, #retryLoad');
    if (!target) return;
    if (target.hasAttribute('data-assessment')) return openAssessment(target.dataset.assessment);
    if (target.hasAttribute('data-profile')) return openProfile(target.dataset.profile);
    if (target.hasAttribute('data-profile-name')) return openProfile(null, target.dataset.profileName);
    if (target.hasAttribute('data-eval-type')) {
      state.evalType = target.dataset.evalType; state.evalPage = 1; renderPage(); return;
    }
    if (target.hasAttribute('data-eval-page')) {
      state.evalPage += target.dataset.evalPage === 'next' ? 1 : -1; renderEvalResults(); return;
    }
    if (target.hasAttribute('data-agent-page')) {
      state.agentPage += target.dataset.agentPage === 'next' ? 1 : -1; renderAgentResults(); return;
    }
    if (target.id === 'exportCsv') return exportCsv();
    if (target.id === 'retryLoad') return loadSnapshot({ silent: true });
  }

  function bind() {
    hydrateIcons();
    $('#pageContent').addEventListener('click', handlePageClick);
    $('#pageContent').addEventListener('input', (event) => {
      if (event.target.id === 'evalSearch') { state.evalSearch = event.target.value; state.evalPage = 1; renderEvalResults(); }
      if (event.target.id === 'agentSearch') { state.agentSearch = event.target.value; state.agentPage = 1; renderAgentResults(); }
    });
    $('#teamFilter').addEventListener('change', (event) => { state.team = event.target.value; state.evalPage = 1; state.agentPage = 1; renderPage(); });
    $('#monthFilter').addEventListener('change', (event) => { state.month = event.target.value; state.evalPage = 1; state.agentPage = 1; renderPage(); });
    $('#clearFilters').addEventListener('click', () => { state.team = 'all'; state.month = 'all'; state.evalPage = 1; state.agentPage = 1; populateFilters(); renderPage(); });
    $('#refreshButton').addEventListener('click', () => loadSnapshot());
    $('#dismissBanner').addEventListener('click', () => { state.bannerVisible = false; $('.source-banner').hidden = true; });
    $('#modalRoot').addEventListener('click', (event) => {
      if (event.target === $('#modalRoot') || event.target.closest('[data-modal-close]')) return closeModal();
      const assessment = event.target.closest('[data-assessment]');
      if (assessment) return openAssessment(assessment.dataset.assessment);
    });
    document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && $('#modalRoot').innerHTML) closeModal(); });
    window.addEventListener('hashchange', () => { state.route = currentRoute(); state.evalPage = 1; state.agentPage = 1; renderPage(); closeSidebar(); });

    const sidebar = $('#sidebar');
    const scrim = $('#sidebarScrim');
    function closeSidebar() { sidebar.classList.remove('is-open'); scrim.classList.remove('is-visible'); }
    $('#mobileMenu').addEventListener('click', () => { sidebar.classList.add('is-open'); scrim.classList.add('is-visible'); });
    $('#sidebarClose').addEventListener('click', closeSidebar);
    scrim.addEventListener('click', closeSidebar);
  }

  bind();
  state.route = currentRoute();
  loadSnapshot({ silent: true });
})();
