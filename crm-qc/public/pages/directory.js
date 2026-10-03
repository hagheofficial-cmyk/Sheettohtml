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
              <option value="cur">ماه جاری</option>
              <option value="prev">ماه قبل</option>
              <option value="all">همه‌ی داده‌ها</option>
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

  weekendChips(); demoState();
}

App.register('directory', { title: 'مدیریت پایه', render });
})();
