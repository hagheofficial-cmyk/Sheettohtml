/* directory.js — مدیریت پایه: کارشناسان، کارشناسان QC و تنظیمات محاسباتی */
(function () {
'use strict';
const { C, $, $$, api, fa, esc, el, toast, confirmDlg, emptyState, debounce } = UI;

async function render(root) {
  const st = App.state;
  const s = st.settings;

  root.innerHTML = `
    <div class="page-head">
      <div class="ph-ic"><i class="fa-solid fa-users-gear"></i></div>
      <div><h2>مدیریت پایه</h2><p>فهرست کارشناسان و تیم‌ها، کارشناسان QC و تنظیمات فرمول‌ها (وزن‌ها، SLA، ساعت کاری)</p></div>
    </div>

    <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(430px,1fr))">

      <!-- کارشناسان -->
      <div class="card">
        <div class="card-head"><div class="head-icon"><i class="fa-solid fa-users"></i></div>
          <div><h3>کارشناسان سازمان</h3><div class="sub">${fa(st.agents.length)} نفر فعال در ${fa(st.teams.length)} تیم</div></div>
          <div class="spacer"></div><button class="btn soft sm" id="addAgentBtn"><i class="fa-solid fa-plus"></i> افزودن</button></div>
        <div class="filters" style="border-bottom:1px solid var(--line-soft)">
          <div class="field"><label>جستجو</label><input class="input" id="agSearch" placeholder="نام یا تیم…"></div>
        </div>
        <div class="table-wrap" style="max-height:430px;overflow-y:auto" id="agTable"></div>
      </div>

      <div style="display:flex;flex-direction:column;gap:16px">
        <!-- کارشناسان QC -->
        <div class="card">
          <div class="card-head violet"><div class="head-icon"><i class="fa-solid fa-user-shield"></i></div>
            <div><h3>کارشناسان کنترل کیفیت</h3><div class="sub">در فرم‌های ثبت قابل انتخاب‌اند</div></div></div>
          <div class="card-pad">
            <div class="chips" id="qcChips"></div>
            <div style="display:flex;gap:9px;margin-top:13px">
              <input class="input" id="qcNew" placeholder="نام کارشناس QC جدید…" style="flex:1">
              <button class="btn soft" id="qcAdd"><i class="fa-solid fa-plus"></i> افزودن</button>
            </div>
          </div>
        </div>

        <!-- دیتای نمونه (تست سریع) -->
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

        <!-- ایمپورت دیتای فیدبک تماس -->
        <div class="card">
          <div class="card-head teal"><div class="head-icon"><i class="fa-solid fa-headset"></i></div>
            <div><h3>دیتای فیدبک تماس</h3><div class="sub">فایل qc_recovery.json از پنل فیدبک را ایمپورت کنید تا در پرونده‌ها و گزارش تجمیعی استفاده شود</div></div></div>
          <div class="card-pad" style="display:flex;flex-direction:column;gap:11px">
            <div class="stat-strip" id="callMeta"><span class="ss">...در حال بارگذاری وضعیت</span></div>
            <div style="display:flex;gap:9px;flex-wrap:wrap">
              <button class="btn soft" id="impBtn"><i class="fa-solid fa-file-import"></i> انتخاب فایل qc_recovery.json</button>
              <button class="btn danger-soft" id="impClear" style="display:none"><i class="fa-solid fa-trash"></i> پاک کردن دیتای ایمپورتی</button>
              <input type="file" id="impFile" accept=".json,application/json" hidden>
            </div>
          </div>
        </div>

        <!-- تنظیمات محاسباتی -->
        <div class="card">
          <div class="card-head violet"><div class="head-icon"><i class="fa-solid fa-sliders"></i></div>
            <div><h3>تنظیمات محاسبات</h3><div class="sub">مستقیماً روی نمره و SLA رکوردهای جدید اثر می‌گذارد</div></div></div>
          <div class="card-pad" style="display:flex;flex-direction:column;gap:15px">
            <div class="field"><label>نام سازمان / سامانه</label><input class="input" id="orgNameI" value="${esc(s.orgName)}"></div>
            <div class="form-grid" style="grid-template-columns:1fr 1fr 1fr">
              <div class="field"><label>آستانه SLA (دقیقه)</label><input class="input" id="slaI" dir="ltr" style="text-align:center" value="${s.slaMinutes}"></div>
              <div class="field"><label>شروع ساعت کاری</label><input type="time" class="input" id="wsI" value="${s.workStart}"></div>
              <div class="field"><label>پایان ساعت کاری</label><input type="time" class="input" id="weI" value="${s.workEnd}"></div>
            </div>
            <div class="field"><label>روزهای تعطیل هفتگی (برای محاسبه SLA سوشال)</label>
              <div class="chips" id="weekendChips"></div>
            </div>
            <div class="form-grid" style="grid-template-columns:1fr 1fr;gap:12px">
              <div class="field"><label>وزن‌های تیکت (پیگیری / یادداشت / دلیل / اکشن)</label>
                <div style="display:flex;gap:6px"><input class="input tw" style="text-align:center" dir="ltr" value="${s.ticketWeights[0]}"><input class="input tw" style="text-align:center" dir="ltr" value="${s.ticketWeights[1]}"><input class="input tw" style="text-align:center" dir="ltr" value="${s.ticketWeights[2]}"><input class="input tw" style="text-align:center" dir="ltr" value="${s.ticketWeights[3]}"></div>
              </div>
              <div class="field"><label>وزن‌های سوشال (SLA / پیگیری / پایان‌بندی / لحن)</label>
                <div style="display:flex;gap:6px"><input class="input sw" style="text-align:center" dir="ltr" value="${s.socialWeights[0]}"><input class="input sw" style="text-align:center" dir="ltr" value="${s.socialWeights[1]}"><input class="input sw" style="text-align:center" dir="ltr" value="${s.socialWeights[2]}"><input class="input sw" style="text-align:center" dir="ltr" value="${s.socialWeights[3]}"></div>
              </div>
            </div>
            <button class="btn primary" id="saveSettings"><i class="fa-solid fa-floppy-disk"></i> ذخیره تنظیمات</button>
          </div>
        </div>
      </div>
    </div>`;

  /* ------------------------------------------------------ کارشناسان */
  async function loadAgents() {
    const wrap = $('#agTable');
    let agents;
    try { agents = await api.get('/api/agents'); } catch (e) { wrap.innerHTML = emptyState('fa-triangle-exclamation', 'خطا', e.message); return; }
    const q = $('#agSearch').value.trim();
    const active = agents.filter((a) => a.active);
    const show = active.filter((a) => !q || a.name.includes(q) || a.team.includes(q));
    if (!show.length) { wrap.innerHTML = emptyState('fa-user-slash', 'موردی نیست', 'کارشناسی با این مشخصات یافت نشد.'); return; }
    wrap.innerHTML = `<table class="tbl"><thead><tr><th>نام</th><th>تیم</th><th>داخلی</th><th style="width:86px"></th></tr></thead><tbody>
      ${show.map((a) => `<tr data-id="${a.id}">
        <td class="cell-main">${esc(a.name)}</td>
        <td><span class="tag-team">${esc(a.team)}</span></td>
        <td>${a.ext ? fa(a.ext) : '—'}</td>
        <td>
          <button class="btn soft sm icon" data-act="edit" title="ویرایش"><i class="fa-solid fa-pen"></i></button>
          <button class="btn danger-soft sm icon" data-act="del" title="بایگانی"><i class="fa-solid fa-box-archive"></i></button>
        </td></tr>`).join('')}</tbody></table>`;

    $$('button[data-act]', wrap).forEach((b) => b.addEventListener('click', async () => {
      const id = b.closest('tr').dataset.id;
      const a = active.find((x) => x.id === +id);
      if (b.dataset.act === 'del') {
        confirmDlg('بایگانی کارشناس', `«${a.name}» بایگانی می‌شود (سوابق ارزیابی او حفظ می‌ماند).`, async () => {
          try { await api.del('/api/agents/' + id); toast('کارشناس بایگانی شد', 'success'); await App.boot(); loadAgents(); }
          catch (e) { toast(e.message, 'error'); }
        }, 'بله، بایگانی شود');
      } else {
        agentForm(a, async () => { await App.boot(); loadAgents(); });
      }
    }));
  }

  function agentForm(agent, done) {
    const isNew = !agent;
    const m = UI.modal(`${UI.modalHead(isNew ? 'افزودن کارشناس' : 'ویرایش کارشناس', 'fa-user-pen')}
      <div class="modal-body"><div class="form-grid" style="grid-template-columns:1fr">
        <div class="field"><label>نام و نام خانوادگی <span class="req">*</span></label><input class="input" id="aN" value="${esc(agent ? agent.name : '')}"></div>
        <div class="field"><label>تیم <span class="req">*</span></label><input class="input" id="aT" list="teamsDl" value="${esc(agent ? agent.team : '')}" placeholder="مثلاً Tele sales">
          <datalist id="teamsDl">${App.state.teams.map((t) => `<option value="${esc(t)}">`).join('')}</datalist></div>
        <div class="field"><label>شماره داخلی</label><input class="input" id="aE" dir="ltr" style="text-align:right" inputmode="numeric" value="${agent && agent.ext ? agent.ext : ''}"></div>
      </div></div>
      <div class="modal-foot"><button class="btn ghost" data-close>انصراف</button><button class="btn primary" id="aSave"><i class="fa-solid fa-floppy-disk"></i> ذخیره</button></div>`);
    $('#aSave', m).addEventListener('click', async () => {
      const payload = { name: $('#aN', m).value.trim(), team: $('#aT', m).value.trim(), ext: $('#aE', m).value.trim() };
      try {
        if (isNew) await api.post('/api/agents', payload); else await api.put('/api/agents/' + agent.id, payload);
        toast('ذخیره شد', 'success'); m.remove(); done();
      } catch (e) { toast(e.message, 'error'); }
    });
  }

  $('#addAgentBtn').addEventListener('click', () => agentForm(null, async () => { await App.boot(); loadAgents(); }));
  $('#agSearch').addEventListener('input', debounce(loadAgents, 300));

  /* --------------------------------------------------- کارشناسان QC */
  function qcChips() {
    $('#qcChips').innerHTML = App.state.qcAgents.map((n) =>
      `<span class="chip">${esc(n)}<button data-n="${esc(n)}" title="حذف"><i class="fa-solid fa-xmark"></i></button></span>`).join('') ||
      '<span style="color:var(--muted);font-size:12px">موردی ثبت نشده</span>';
    $$('#qcChips button').forEach((b) => b.addEventListener('click', async () => {
      try { await api.del('/api/qc-agents/' + encodeURIComponent(b.dataset.n)); toast('حذف شد', 'success'); await App.boot(); qcChips(); }
      catch (e) { toast(e.message, 'error'); }
    }));
  }
  $('#qcAdd').addEventListener('click', async () => {
    const name = $('#qcNew').value.trim();
    if (!name) return;
    try { await api.post('/api/qc-agents', { name }); $('#qcNew').value = ''; toast('افزوده شد', 'success'); await App.boot(); qcChips(); }
    catch (e) { toast(e.message, 'error'); }
  });

  /* -------------------------------------------------------- تعطیلات */
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
    try {
      await api.put('/api/settings', {
        orgName: $('#orgNameI').value.trim(),
        slaMinutes: +$('#slaI').value,
        workStart: $('#wsI').value, workEnd: $('#weI').value,
        weekendDays: [...weekend],
        ticketWeights: $$('.tw').map((i) => +C.faToEn(i.value) || 0),
        socialWeights: $$('.sw').map((i) => +C.faToEn(i.value) || 0)
      });
      await App.boot();
      toast('تنظیمات ذخیره شد — نمره‌های بعدی با مقادیر جدید محاسبه می‌شوند', 'success');
    } catch (e) { toast(e.message, 'error'); }
    btn.disabled = false;
  });

  /* ---------------- ایمپورت فیدبک تماس ---------------- */
  async function callMeta() {
    const wrap = $('#callMeta');
    try {
      const d = await api.get('/api/calls');
      const meta = d.meta;
      if (!meta || (d.count === 0)) {
        wrap.innerHTML = '<span class="ss"><i class="fa-solid fa-circle-exclamation" style="color:var(--muted)"></i> هنوز دیتای فیدبکی ایمپورت نشده است</span>';
        $('#impClear').style.display = 'none';
      } else {
        const c = meta.counts;
        wrap.innerHTML = `<span class="ss"><i class="fa-solid fa-circle-check" style="color:var(--good)"></i> ${fa(d.count)} رکورد (تلفنی ${fa(c.tele)} · اکانت ${fa(c.account)} · MLM ${fa(c.mlm)})</span>`;
        $('#impClear').style.display = '';
      }
    } catch (e) { wrap.innerHTML = `<span class="ss" style="color:var(--bad)">${esc(e.message)}</span>`; }
  }
  $('#impBtn').addEventListener('click', () => $('#impFile').click());
  $('#impFile').addEventListener('change', (e) => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const obj = JSON.parse(String(reader.result));
        if (!obj.teleRawData && !obj.accRawData && !obj.mlmRawData) throw new Error('ساختار qc_recovery.json شناسایی نشد');
        const res = await api.post('/api/calls', { recovery: obj });
        toast(`${fa(res.counts.total)} رکورد فیدبک تماس ایمپورت شد`, 'success');
        callMeta();
      } catch (ex) { toast(ex.message || 'فایل نامعتبر است', 'error'); }
      e.target.value = '';
    };
    reader.readAsText(file, 'utf-8');
  });
  $('#impClear').addEventListener('click', () => {
    confirmDlg('پاک کردن دیتای فیدبک', 'همه رکوردهای ایمپورتی (تماس، توافق، متادیتا) حذف می‌شود. ادامه می‌دهید؟', async () => {
      await api.del('/api/calls');
      toast('دیتای فیدبک پاک شد', 'success');
      callMeta();
    });
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
      demoState(); loadAgents();
    } catch (e) { toast(e.message, 'error'); }
  });
  $('#demoDel').addEventListener('click', () => {
    confirmDlg('حذف دیتای نمونه', 'همه رکوردهای تگ‌دار demo (تیکت، سوشال، تماس) پاک می‌شوند. دیتای واقعی دست‌نخورده می‌ماند.', async () => {
      try {
        const r = await api.del('/api/demo');
        toast(`پاک شد — تیکت ${fa(r.removed.tickets)} / سوشال ${fa(r.removed.socials)} / تماس ${fa(r.removed.calls)}`, 'success', 4000);
        demoState(); loadAgents();
      } catch (e) { toast(e.message, 'error'); }
    });
  });

  loadAgents(); qcChips(); weekendChips(); callMeta(); demoState();
}

App.register('directory', { title: 'مدیریت پایه', render });
})();
