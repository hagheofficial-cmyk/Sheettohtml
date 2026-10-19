/* directory.js — مدیریت پایه: تنظیمات سامانه (نمایش، SLA، ساعت کاری، وزن‌های فرمول‌ها و دیتای نمونه)
 * مدیریت کارشناسان و QC به‌صورت کامل در صفحه‌ی «مدیریت کارشناسان» (آدرس agents#) انجام می‌شود.
 */
(function () {
'use strict';
const { C, $, $$, api, fa, esc, el, toast, confirmDlg, emptyState, debounce } = UI;

async function render(root) {
  const st = App.state;
  const s = st.settings;
  const bands = Array.isArray(s.scoreBands) && s.scoreBands.length === 3 ? s.scoreBands : [90, 75, 50];

  root.innerHTML = `
    <div class="page-head">
      <div class="ph-ic"><i class="fa-solid fa-users-gear"></i></div>
      <div><h2>مدیریت پایه</h2><p>تنظیمات کامل سامانه — نمایش و نمره‌بندی، SLA و ساعت کاری، وزن‌های فرمول و دیتای نمونه</p></div>
    </div>

    <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(430px,1fr))">

      <!-- تنظیمات نمایش و نمره‌بندی -->
      <div class="card">
        <div class="card-head"><div class="head-icon"><i class="fa-solid fa-display"></i></div>
          <div><h3>نمایش و نمره‌بندی</h3><div class="sub">نام سامانه، بازه‌ی پیش‌فرض داشبورد و آستانه‌های رنگ نمره</div></div></div>
        <div class="card-pad" style="display:flex;flex-direction:column;gap:15px">
          <div class="field"><label>نام سازمان / سامانه (در هدر برگه و سایدبار)</label><input class="input" id="orgNameI" value="${esc(s.orgName)}"></div>
          <div class="field"><label>بازه‌ی پیش‌فرض داشبورد هنگام ورود</label>
            <select class="input" id="presetSel">
              <option value="cur">ماه جاری (شمسی)</option>
              <option value="prev">ماه قبل (شمسی)</option>
              <option value="today">امروز</option>
              <option value="all">همه‌ی داده‌ها</option>
              <option value="fm:cur">ماه مالی جاری</option>
              <option value="fm:prev">ماه مالی قبل</option>
            </select>
          </div>
          <div class="field"><label>آستانه‌های رنگ نمره (سبز از … ، آبی از … ، زرد از …) — ۰ تا ۱۰۰</label>
            <div class="form-grid" style="grid-template-columns:1fr 1fr 1fr">
              <div class="field" style="margin:0"><label style="color:var(--good)">سبز ≥</label><input class="input band" dir="ltr" style="text-align:center" inputmode="numeric" value="${fa(bands[0])}"></div>
              <div class="field" style="margin:0"><label style="color:var(--brand)">آبی ≥</label><input class="input band" dir="ltr" style="text-align:center" inputmode="numeric" value="${fa(bands[1])}"></div>
              <div class="field" style="margin:0"><label style="color:var(--warn)">زرد ≥</label><input class="input band" dir="ltr" style="text-align:center" inputmode="numeric" value="${fa(bands[2])}"></div>
            </div>
            <div class="note" style="margin:8px 0 0"><i class="fa-solid fa-circle-info"></i> روی تمام نمایش‌های نمره (قرص‌ها، نمودارها، جداول) بلافاصله اثر می‌گذارد. نمره‌ی کمتر از زرد = قرمز.</div>
          </div>
        </div>
      </div>

      <!-- تنظیمات SLA و ساعت کاری -->
      <div class="card">
        <div class="card-head teal"><div class="head-icon"><i class="fa-solid fa-stopwatch"></i></div>
          <div><h3>SLA و ساعت کاری</h3><div class="sub">مستقیماً روی وضعیت SLA رکوردهای جدید اثر می‌گذارد</div></div></div>
        <div class="card-pad" style="display:flex;flex-direction:column;gap:15px">
          <div class="form-grid" style="grid-template-columns:1fr 1fr 1fr">
            <div class="field"><label>آستانه SLA (دقیقه)</label><input class="input" id="slaI" dir="ltr" style="text-align:center" inputmode="numeric" value="${fa(s.slaMinutes)}"></div>
            <div class="field"><label>شروع ساعت کاری</label><input type="time" class="input" id="wsI" value="${s.workStart}"></div>
            <div class="field"><label>پایان ساعت کاری</label><input type="time" class="input" id="weI" value="${s.workEnd}"></div>
          </div>
          <div class="field"><label>روزهای تعطیل هفتگی (برای محاسبه SLA سوشال)</label>
            <div class="chips" id="weekendChips"></div>
          </div>
        </div>
      </div>

      <!-- وزن‌های فرمول‌ها -->
      <div class="card">
        <div class="card-head violet"><div class="head-icon"><i class="fa-solid fa-sliders"></i></div>
          <div><h3>وزن‌های نمره‌دهی فرم‌ها</h3><div class="sub">نمره‌ی رکوردهای جدید با این وزن‌ها حساب می‌شود (رکوردهای قبلی دست‌نخورده می‌مانند)</div></div></div>
        <div class="card-pad" style="display:flex;flex-direction:column;gap:15px">
          <div class="form-grid" style="grid-template-columns:1fr 1fr;gap:12px">
            <div class="field"><label>وزن‌های تیکت (پیگیری / یادداشت / دلیل / اکشن)</label>
              <div style="display:flex;gap:6px"><input class="input tw" style="text-align:center" dir="ltr" inputmode="numeric" value="${fa(s.ticketWeights[0])}"><input class="input tw" style="text-align:center" dir="ltr" inputmode="numeric" value="${fa(s.ticketWeights[1])}"><input class="input tw" style="text-align:center" dir="ltr" inputmode="numeric" value="${fa(s.ticketWeights[2])}"><input class="input tw" style="text-align:center" dir="ltr" inputmode="numeric" value="${fa(s.ticketWeights[3])}"></div>
            </div>
            <div class="field"><label>وزن‌های سوشال (SLA / پیگیری / پایان‌بندی / لحن)</label>
              <div style="display:flex;gap:6px"><input class="input sw" style="text-align:center" dir="ltr" inputmode="numeric" value="${fa(s.socialWeights[0])}"><input class="input sw" style="text-align:center" dir="ltr" inputmode="numeric" value="${fa(s.socialWeights[1])}"><input class="input sw" style="text-align:center" dir="ltr" inputmode="numeric" value="${fa(s.socialWeights[2])}"><input class="input sw" style="text-align:center" dir="ltr" inputmode="numeric" value="${fa(s.socialWeights[3])}"></div>
            </div>
          </div>
          <div class="note" style="margin:0"><i class="fa-solid fa-circle-info"></i> مجموع وزن‌ها لازم نیست ۱۰۰ باشد — نمره همیشه نسبت‌بندی می‌شود.</div>
        </div>
      </div>

      <!-- ماه‌های مالی (بند ۲) -->
      <div class="card fm-card">
        <div class="card-head brand"><div class="head-icon"><i class="fa-solid fa-calendar-days"></i></div>
          <div><h3>ماه‌های مالی</h3><div class="sub">بازه‌های آماده‌ی فیلتر تاریخ بالا — نام دوره و بازه‌ی شروع/پایان (جلالی)</div></div>
          <div class="spacer"></div>
          <label class="fm-year">سال مالی
            <input class="input" id="fmYear" dir="ltr" inputmode="numeric" placeholder="1405"></label>
        </div>
        <div class="card-pad">
          <div class="table-scroll fm-scroll">
            <table class="tbl fm-tbl">
              <thead><tr><th>نام ماه مالی</th><th>از تاریخ</th><th>تا تاریخ</th><th>یادداشت</th><th></th></tr></thead>
              <tbody id="fmBody"></tbody>
            </table>
          </div>
          <div class="fm-summary" id="fmSummary"></div>
          <div class="fm-actions">
            <button class="btn soft" id="fmAdd"><i class="fa-solid fa-plus"></i> افزودن ماه مالی</button>
            <button class="btn ghost" id="fmAuto"><i class="fa-solid fa-wand-magic-sparkles"></i> ساخت ۱۲ ماه سال</button>
            <div class="spacer"></div>
            <button class="btn primary" id="fmSave"><i class="fa-solid fa-floppy-disk"></i> ذخیره ماه‌های مالی</button>
          </div>
          <div class="note" style="margin:12px 0 0"><i class="fa-solid fa-table"></i>
            همین جدول در تب <code>Fiscal_Months</code> گوگل‌شیت هم نوشته می‌شود؛ می‌توانید تاریخ‌ها را مستقیم روی شیت بنویسید یا ویرایش کنید و سامانه در خواندن بعدی آن‌ها را به «بازه آماده» تبدیل می‌کند.</div>
        </div>
      </div>

      <!-- دیتای نمونه -->
      <div class="card">
        <div class="card-head amber"><div class="head-icon"><i class="fa-solid fa-flask-vial"></i></div>
          <div><h3>دیتای نمونه (برای تست سریع)</h3><div class="sub">با یک کلیک چند رکورد فیک در ۳ ماه اخیر اضافه کن تا گزارش‌ها و داشبورد پر بشن؛ با یک کلیک هم همه پاک می‌شن</div></div></div>
        <div class="card-pad" style="display:flex;flex-direction:column;gap:11px">
          <div id="demoState" class="stat-strip"><span class="ss"><i class="fa-solid fa-circle-check" style="color:var(--good)"></i> الان دیتای نمونه روی سیستم نیست</span></div>
          <div style="display:flex;gap:9px;flex-wrap:wrap">
            <button class="btn brand" id="demoAdd"><i class="fa-solid fa-wand-magic-sparkles"></i> بارگذاری دیتای نمونه (تیکت + سوشال + تماس)</button>
            <button class="btn danger-soft" id="demoDel" style="display:none"><i class="fa-solid fa-trash-can"></i> حذف کامل دیتای نمونه</button>
          </div>
          <div class="note" style="margin:0"><i class="fa-solid fa-circle-info"></i> رکوردهای نمونه با تگ <code>demo</code> ذخیره می‌شن و با دیتای واقعی خلط نمی‌شن — حذفشون همه رو یک‌جا پاک می‌کنه.</div>
        </div>
      </div>
    </div>

    <div class="card" style="margin-top:16px">
      <div class="card-pad" style="display:flex;gap:12px;align-items:center;flex-wrap:wrap">
        <button class="btn primary" id="saveSettings"><i class="fa-solid fa-floppy-disk"></i> ذخیره‌ی همه‌ی تنظیمات</button>
        <div class="note" style="margin:0"><i class="fa-solid fa-users" style="color:var(--brand)"></i> تغییر فهرست کارشناسان، تیم‌ها و کارشناسان QC از این نسخه فقط در صفحه‌ی <a href="#/agents" style="color:var(--brand);font-weight:800">«مدیریت کارشناسان»</a> انجام می‌شود.</div>
      </div>
    </div>`;

  $('#presetSel').value = s.defaultPreset || 'cur';

  /* ------------------------------------------------------ تعطیلات */
  const days = [['شنبه', 6], ['یکشنبه', 0], ['دوشنبه', 1], ['سه‌شنبه', 2], ['چهارشنبه', 3], ['پنجشنبه', 4], ['جمعه', 5]];
  let weekend = new Set(s.weekendDays);
  function weekendChips() {
    $('#weekendChips').innerHTML = days.map(([n, d]) =>
      `<button type="button" class="chip" data-d="${d}" style="cursor:pointer;${weekend.has(d) ? 'border-color:rgba(248,113,113,.5);background:var(--bad-soft);color:var(--bad)' : ''}">${n}${weekend.has(d) ? ' ✕' : ''}</button>`).join('');
    $$('#weekendChips button').forEach((b) => b.addEventListener('click', () => {
      const d = +b.dataset.d;
      weekend.has(d) ? weekend.delete(d) : weekend.add(d);
      weekendChips();
    }));
  }

  /* ------------------------------------------------------ ذخیره تنظیمات */
  $('#saveSettings').addEventListener('click', async () => {
    const btn = $('#saveSettings'); btn.disabled = true;
    const bandsIn = $$('.band').map((i) => +C.faToEn(i.value));
    if (bandsIn.some((x) => isNaN(x) || x < 0 || x > 100)) {
      toast('آستانه‌های رنگ باید عددی بین ۰ تا ۱۰۰ باشند', 'error'); btn.disabled = false; return;
    }
    try {
      await api.put('/api/settings', {
        orgName: $('#orgNameI').value.trim(),
        defaultPreset: $('#presetSel').value,
        scoreBands: bandsIn,
        slaMinutes: +C.faToEn($('#slaI').value),
        workStart: $('#wsI').value, workEnd: $('#weI').value,
        weekendDays: [...weekend],
        ticketWeights: $$('.tw').map((i) => +C.faToEn(i.value) || 0),
        socialWeights: $$('.sw').map((i) => +C.faToEn(i.value) || 0)
      });
      await App.boot();
      toast('تنظیمات ذخیره شد — نمایش‌ها و محاسبات بعدی با مقادیر جدید اعمال می‌شوند', 'success');
      render(root); /* رفرش همان صفحه با مقادیر نهایی */
    } catch (e) { toast(e.message, 'error'); }
    btn.disabled = false;
  });

  /* ---------- دیتای نمونه ---------- */
  async function demoState() {
    try {
      const b = await api.get('/api/bootstrap');
      let hasDemo = false;
      try {
        const all = await api.get('/api/tickets?per=200');
        hasDemo = (all.rows || []).some((r) => r.demo);
        if (!hasDemo) {
          const allS = await api.get('/api/socials?per=200');
          hasDemo = (allS.rows || []).some((r) => r.demo);
        }
      } catch (_) {}
      const cm = b.counts && b.counts.callMeta;
      if (!hasDemo && cm && cm.demo) hasDemo = true;
      $('#demoState').innerHTML = hasDemo
        ? `<span class="ss" style="color:var(--warn)"><i class="fa-solid fa-flask-vial" style="color:var(--warn)"></i> دیتای نمونه روی سیستم فعال است — با «حذف کامل» پاکش کن</span>`
        : `<span class="ss"><i class="fa-solid fa-circle-check" style="color:var(--good)"></i> الان دیتای نمونه روی سیستم نیست</span>`;
      $('#demoDel').style.display = hasDemo ? '' : 'none';
    } catch (e) { /* silent */ }
  }
  $('#demoAdd').addEventListener('click', async () => {
    try {
      const r = await api.post('/api/demo', {});
      toast(`دیتای نمونه بازه تیر تا شهریور لود شد — تیکت ${fa(r.added.tickets)} / سوشال ${fa(r.added.socials)} / تماس ${fa(r.added.calls)}. برید داشبورد!`, 'success', 5200);
      demoState();
    } catch (e) { toast(e.message, 'error'); }
  });
  $('#demoDel').addEventListener('click', () => {
    confirmDlg('حذف دیتای نمونه', 'همه رکوردهای تگ‌دار demo (تیکت، سوشال، تماس) پاک می‌شوند. دیتای واقعی دست‌نخورده می‌ماند.', async () => {
      try {
        const r = await api.del('/api/demo');
        toast(`پاک شد — تیکت ${fa(r.removed.tickets)} / سوشال ${fa(r.removed.socials)} / تماس ${fa(r.removed.calls)}`, 'success', 4000);
        demoState();
      } catch (e) { toast(e.message, 'error'); }
    });
  });

  /* ------------------------------------------------------ ماه‌های مالی */
  let fiscal = (App.fiscalMonths || []).map((m) => Object.assign({}, m));
  const fmBody = $('#fmBody');
  const fmYear = $('#fmYear');
  const todayJ = C.todayJalali();
  if (fmYear) fmYear.value = String(todayJ.jy);

  /* یک عدد معتبر جلالی برای شروع/پایان دوره؛ فرمت‌های رایج هم پذیرفته می‌شوند. */
  function normDate(value) {
    const d = C.parseDate(String(value || '').trim());
    return d ? C.formatJalali(d) : '';
  }
  /* کلید عددی مرتب‌سازی تاریخ جلالی (بدون پرتاب خطا روی تاریخ خالی) */
  function dateKey(value) {
    const d = C.parseDate(normDate(value));
    return d ? d.jy * 10000 + d.jm * 100 + d.jd : 0;
  }
  function daysOf(m) {
    const from = C.parseDate(m.from), to = C.parseDate(m.to);
    if (!from || !to) return 0;
    const g1 = C.toGregorian(from.jy, from.jm, from.jd);
    const g2 = C.toGregorian(to.jy, to.jm, to.jd);
    if (!g1 || !g2) return 0;
    const ms = Date.UTC(g2.gy, g2.gm - 1, g2.gd) - Date.UTC(g1.gy, g1.gm - 1, g1.gd);
    return Math.round(ms / 86400000) + 1;
  }

  /* اعتبارسنجی مشترک: هم برای ذخیره، هم برای نشان دادن خطا زیر جدول */
  function validateFiscal(rows) {
    const errors = [];
    const names = new Set();
    rows.forEach((m, i) => {
      const tag = m.name ? '«' + m.name + '»' : 'ردیف ' + fa(i + 1);
      const from = normDate(m.from), to = normDate(m.to);
      m.from = from || m.from; m.to = to || m.to;
      if (!m.name) errors.push({ i, text: 'نام ماه مالی برای ' + (i + 1) + 'مین ردیف خالی است' });
      else if (names.has(m.name)) errors.push({ i, text: tag + ' تکراری است' });
      if (m.name) names.add(m.name);
      if (!from) errors.push({ i, text: 'تاریخ شروع ' + tag + ' نامعتبر است (مثال: 1405/07/01)' });
      if (!to) errors.push({ i, text: 'تاریخ پایان ' + tag + ' نامعتبر است' });
      if (from && to && C.jalaliCmp(C.parseDate(from), C.parseDate(to)) > 0) {
        errors.push({ i, text: 'در ' + tag + ' تاریخ پایان قبل از شروع است' });
      }
    });
    const sorted = rows.slice().sort((a, b) => dateKey(a.from) - dateKey(b.from));
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1], cur = sorted[i];
      const prevTo = C.parseDate(normDate(prev.to)), curFrom = C.parseDate(normDate(cur.from));
      if (prevTo && curFrom && C.jalaliCmp(prevTo, curFrom) >= 0) {
        errors.push({ i: rows.indexOf(cur), text: 'بازه‌ی «' + (cur.name || '—') + '» با «' + (prev.name || '—') + '» هم‌پوشانی دارد' });
      }
    }
    return errors;
  }

  function renderFiscal() {
    if (!fiscal.length) {
      fmBody.innerHTML = `<tr><td colspan="5" class="fm-empty">هنوز ماه مالی تعریف نشده — یک ردیف اضافه کنید یا ۱۲ ماه سال را خودکار بسازید.</td></tr>`;
      paintFiscalSummary();
      return;
    }
    fmBody.innerHTML = fiscal.map((m, i) => `
      <tr data-i="${i}">
        <td><input class="input fm-name" value="${esc(m.name || '')}" placeholder="مثلاً مهر ۱۴۰۵"></td>
        <td><div class="date-f"><input class="input fm-from" dir="ltr" inputmode="numeric" value="${esc(m.from || '')}" placeholder="1405/07/01">
          <button type="button" class="cal-btn" data-cal="from" data-i="${i}" aria-label="تقویم شروع"><i class="fa-regular fa-calendar"></i></button></div></td>
        <td><div class="date-f"><input class="input fm-to" dir="ltr" inputmode="numeric" value="${esc(m.to || '')}" placeholder="1405/07/30">
          <button type="button" class="cal-btn" data-cal="to" data-i="${i}" aria-label="تقویم پایان"><i class="fa-regular fa-calendar"></i></button></div></td>
        <td><input class="input fm-note" value="${esc(m.note || '')}" placeholder="اختیاری"></td>
        <td class="fm-del"><button class="btn ghost sm" data-del="${i}" title="حذف"><i class="fa-solid fa-trash-can"></i></button></td>
      </tr>`).join('');
    $$('[data-del]', fmBody).forEach((b) => b.addEventListener('click', () => {
      fiscal = collectFiscal(); fiscal.splice(+b.dataset.del, 1); renderFiscal();
    }));
    $$('.cal-btn', fmBody).forEach((b) => {
      const input = b.parentElement.querySelector('input');
      JCal.attach(b, { input: input, onPick: () => { paintFiscalSummary(); } });
    });
    $$('.fm-name, .fm-from, .fm-to', fmBody).forEach((el) => el.addEventListener('change', paintFiscalSummary));
    paintFiscalSummary();
  }

  /* خلاصه + خطاها زیر جدول؛ بدون اینکه چیزی را بی‌صدا پاک کند. */
  function paintFiscalSummary() {
    const box = $('#fmSummary');
    if (!box) return;
    const rows = collectFiscal();
    if (!rows.length) { box.className = 'fm-summary'; box.innerHTML = ''; return; }
    const errors = validateFiscal(rows);
    const sorted = rows.slice().sort((a, b) => dateKey(a.from) - dateKey(b.from));
    const total = rows.reduce((sum, m) => sum + daysOf(m), 0);
    const chips = sorted.map((m) => `<span class="fm-chip"><b>${esc(m.name || '—')}</b>
      <span dir="ltr">${esc(normDate(m.from) || '—')} → ${esc(normDate(m.to) || '—')}</span>
      ${daysOf(m) ? `<em>${fa(daysOf(m))} روز</em>` : ''}</span>`).join('');
    box.className = 'fm-summary' + (errors.length ? ' has-err' : '');
    box.innerHTML = `<div class="fm-chips">${chips}</div>
      <div class="fm-total">${fa(rows.length)} دوره · مجموع ${fa(total)} روز</div>
      ${errors.length ? `<div class="fm-err"><i class="fa-solid fa-circle-exclamation"></i>
        <ul>${errors.slice(0, 5).map((e) => `<li>${esc(e.text)}</li>`).join('')}</ul></div>` : ''}`;
  }

  function collectFiscal() {
    return $$('tr[data-i]', fmBody).map((tr) => {
      const rawFrom = $('.fm-from', tr).value.trim(), rawTo = $('.fm-to', tr).value.trim();
      return {
        id: (fiscal[+tr.dataset.i] || {}).id || '',
        name: $('.fm-name', tr).value.trim(),
        from: normDate(rawFrom) || rawFrom,
        to: normDate(rawTo) || rawTo,
        note: $('.fm-note', tr).value.trim()
      };
    }).filter((m) => m.name || m.from || m.to);
  }

  $('#fmAdd').addEventListener('click', () => {
    fiscal = collectFiscal();
    /* پیشنهاد هوشمند: دوره‌ی بعد از آخرین دوره (یا ماه جاری) */
    const last = fiscal.slice().sort((a, b) => dateKey(a.to) - dateKey(b.to)).pop();
    let next = null;
    const lastTo = last ? C.parseDate(normDate(last.to)) : null;
    if (lastTo) next = C.jalaliMonthAdd(lastTo.jy, lastTo.jm, 1);
    else next = { jy: todayJ.jy, jm: todayJ.jm };
    const range = C.jalaliMonthRange(next.jy, next.jm);
    fiscal.push({ id: '', name: C.jalaliMonthLabel(next.jy, next.jm), from: C.formatJalali(range.from), to: C.formatJalali(range.to), note: '' });
    renderFiscal();
  });

  $('#fmAuto').addEventListener('click', () => {
    fiscal = collectFiscal();
    const year = Number(String(fmYear && fmYear.value || '').replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d))) || todayJ.jy;
    let added = 0, skipped = 0;
    for (let m = 1; m <= 12; m++) {
      const r = C.jalaliMonthRange(year, m);
      const from = C.formatJalali(r.from), to = C.formatJalali(r.to);
      if (fiscal.some((x) => normDate(x.from) === from && normDate(x.to) === to)) { skipped++; continue; }
      if (fiscal.some((x) => normDate(x.from) === from)) { skipped++; continue; }
      fiscal.push({ id: '', name: C.jalaliMonthLabel(year, m), from, to, note: '' });
      added++;
    }
    fiscal.sort((a, b) => dateKey(a.from) - dateKey(b.from));
    renderFiscal();
    toast(added ? `${fa(added)} ماه سال ${fa(year)} اضافه شد${skipped ? ` (${fa(skipped)} ردیف از قبل بود)` : ''}` : `همه‌ی ماه‌های ${fa(year)} از قبل وجود دارند`,
      added ? 'success' : 'info');
  });

  $('#fmSave').addEventListener('click', async () => {
    const rows = collectFiscal();
    const errors = validateFiscal(rows);
    if (errors.length) {
      paintFiscalSummary();
      toast(errors[0].text, 'error');
      const badRow = fmBody.querySelector(`tr[data-i="${errors[0].i}"] .fm-name`);
      if (badRow) badRow.focus();
      return;
    }
    rows.sort((a, b) => dateKey(a.from) - dateKey(b.from));
    const btn = $('#fmSave');
    btn.disabled = true;
    const label = btn.innerHTML;
    btn.innerHTML = '<i class="fa-solid fa-circle-notch spin"></i> ذخیره…';
    try {
      await api.put('/api/fiscal-months', { months: rows });
      await App.boot();
      fiscal = (App.fiscalMonths || []).map((m) => Object.assign({}, m));
      renderFiscal();
      if (App.buildFiscalOptions) App.buildFiscalOptions();
      toast('ماه‌های مالی ذخیره شد — در «بازه آماده» بالای صفحه در دسترس‌اند', 'success');
    } catch (e) { toast(e.message, 'error'); }
    btn.disabled = false;
    btn.innerHTML = label;
  });
  renderFiscal();

  weekendChips(); demoState();
}

App.register('directory', { title: 'مدیریت پایه', render });
})();
