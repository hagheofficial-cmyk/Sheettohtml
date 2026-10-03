/* agents.js — مدیریت تخصصی کارشناسان
 * نما تیم‌بندی گروهی، ویرایش نام/تیم/داخلی در مودال یا آن‌لاین، انتقال گروهی بین تیم‌ها،
 * افزودن کارشناس جدید، بایگانی و بازیابی؛ خطاهای دوباره‌کاری نام را کنترل می‌کند.
 */
(function () {
'use strict';
const { C, $, $$, api, fa, esc, el, toast, emptyState, debounce, confirmDlg } = UI;

/* تربیت تیم‌ها برای آینه‌ی فرم QC — نام‌گذاری تمیز */
const TEAM_NORMAL = [
  { key: 'tele',    label: 'تلفنی — فروش',      match: (s) => /tele|تلفن|فروش/i.test(s) },
  { key: 'account', label: 'اکانت',             match: (s) => /account|اکانت/i.test(s) },
  { key: 'mlm',     label: 'MLM / BNPL',        match: (s) => /mlm|bnpl/i.test(s) }
];

function normTeamKey(teamName) {
  const t = String(teamName || '').toLowerCase();
  for (const g of TEAM_NORMAL) if (g.match(t)) return g.key;
  return '';
}
function teamBadge(t) {
  const k = normTeamKey(t);
  const colors = { tele: ['#38bdf8', 'rgba(56,189,248,.12)'], account: ['#a78bfa', 'rgba(167,139,250,.12)'], mlm: ['#34d399', 'rgba(52,211,153,.12)'] };
  const cx = colors[k] || ['#6b7ba0', 'rgba(107,123,160,.1)'];
  return `<span class="tag-team" style="background:${cx[1]};color:${cx[0]};border-color:${cx[0]}33">${esc(t)}</span>`;
}

async function render(root) {
  const st = App.state;
  root.innerHTML = `
    <div class="page-head">
      <div class="ph-ic"><i class="fa-solid fa-users-gear"></i></div>
      <div>
        <h2>مدیریت کارشناسان</h2>
        <p>نام، تیم‌بندی، شماره داخلی و کارشناسان QC — همه‌ی مدیریت انسانی در همین صفحه (سینک از مدیریت پایه)</p>
      </div>
      <div class="spacer"></div>
      <button class="btn soft" id="btnImport"><i class="fa-solid fa-file-import"></i> ایمپورت اکسل کارشناسان</button>
      <button class="btn success-soft" id="teamAdd"><i class="fa-solid fa-plus"></i> تیم جدید</button>
      <button class="btn brand" id="agentAdd"><i class="fa-solid fa-user-plus"></i> کارشناس جدید</button>
    </div>

    <div class="card" style="margin-bottom:16px">
      <div class="filters" style="border-bottom:none">
        <div class="field" style="flex:1.4;min-width:220px"><label>جستجو (نام یا داخلی)</label>
          <input class="input" id="agSearch" placeholder="مثلاً الهه عسگری یا ۳۰۲۲ یا 3022" dir="auto" autocomplete="off">
        </div>
        <div class="field"><label>نما تیم‌ها</label>
          <select class="input" id="agView">
            <option value="grouped">گروه‌بندی بر اساس تیم</option>
            <option value="flat">نمای تخت (همه کارشناسان)</option>
          </select>
        </div>
        <div class="field grow-0"><label>&nbsp;</label><button class="btn ghost" id="agReload"><i class="fa-solid fa-rotate"></i> تازه‌سازی</button></div>
      </div>
    </div>

    <!-- کارشناسان کنترل کیفیت — منتقل‌شده از مدیریت پایه (سینک همه‌ی مدیریت انسانی همین‌جا) -->
    <div class="card" style="margin-bottom:16px">
      <div class="card-head violet"><div class="head-icon"><i class="fa-solid fa-user-shield"></i></div>
        <div><h3>کارشناسان کنترل کیفیت</h3><div class="sub">این نام‌ها در فرم‌های ثبت ارزیابی تیکت و سوشال قابل انتخاب‌اند</div></div></div>
      <div class="card-pad">
        <div class="chips" id="qcChips"></div>
        <div style="display:flex;gap:9px;margin-top:13px;max-width:520px">
          <input class="input" id="qcNew" placeholder="نام کارشناس QC جدید…" style="flex:1">
          <button class="btn soft" id="qcAdd"><i class="fa-solid fa-plus"></i> افزودن</button>
        </div>
      </div>
    </div>

    <div id="agentsBody"><div class="loading-page"><div class="spinner\"></div></div></div>`;

  let allAgents = [];
  let sel = new Set(); // id های انتخاب‌شده برای انتقال گروهی

  async function load(showArchived) {
    try {
      allAgents = await api.get('/api/agents');
      if (!showArchived) allAgents = allAgents.filter((a) => a.active !== false);
      renderAgents();
    } catch (e) {
      $('#agentsBody').innerHTML = `<div class="card">${emptyState('fa-triangle-exclamation', 'خطا', e.message)}</div>`;
    }
  }

  function renderAgents() {
    const q = String($('#agSearch').value || '').trim().toLowerCase();
    const dig = C.faToEn(q).replace(/[^0-9]/g, '');
    const showArchivedMatch = (a) => a.active === false;
    let filtered = allAgents;
    if (q) {
      filtered = allAgents.filter((a) =>
        a.name.toLowerCase().includes(q) ||
        (dig && dig.length >= 2 && String(a.ext || '').includes(dig)));
    }

    const view = $('#agView').value;
    const totalActive = filtered.filter((a) => a.active !== false).length;
    const byTeam = {};
    filtered.forEach((a) => { (byTeam[a.team || '(بدون تیم)'] = byTeam[a.team || '(بدون تیم)'] || []).push(a); });
    const teamNames = Object.keys(byTeam).sort((a, b) => {
      const ka = normTeamKey(a) || 'zzz', kb = normTeamKey(b) || 'zzz';
      if (ka !== kb) return ka.localeCompare(kb);
      return a.localeCompare(b, 'fa');
    });

    function rowHtml(a) {
      const isSel = sel.has(a.id);
      const sub = a.subgroup && a.subgroup !== '—' ? `<div style="font-size:10.5px;color:var(--muted)"><i class="fa-solid fa-sitemap" style="opacity:.6"></i> ${esc(a.subgroup)}</div>` : '';
      return `<tr data-id="${a.id}" data-name="${esc(a.name)}" style="${a.active === false ? 'opacity:.45' : ''}">
        <td style="width:30px"><input type="checkbox" class="row-check" ${isSel ? 'checked' : ''}></td>
        <td class="cell-main">${esc(a.name)}${a.active === false ? ' <span class="badge gray">بایگانی</span>' : ''}${sub}</td>
        <td><input type="text" class="row-ext" dir="ltr" inputmode="numeric" data-ed="1" value="${a.ext == null ? '' : esc(String(a.ext))}" style="width:74px;text-align:center;font-size:12px;background:transparent;border:1px solid transparent;border-radius:6px;padding:4px 6px"></td>
        <td><input type="text" class="row-team" data-ed="1" value="${esc(a.team)}" list="teamsDlAll" style="flex:1;min-width:140px;font-size:12px;background:transparent;border:1px solid transparent;border-radius:6px;padding:4px 8px"></td>
        <td style="font-size:11px">${a.active !== false ? '<button class="btn soft sm" data-act="archive">بایگانی</button>' : '<button class="btn success-soft sm" data-act="restore">بازیابی</button>'}</td>
      </tr>`;
    }

    function teamSection(teamName) {
      const arr = byTeam[teamName] || [];
      const k = normTeamKey(teamName);
      const FORM = { tele: 'فرم فیدبک تلفنی', account: 'فرم فیدبک اکانت', mlm: 'فرم فیدبک MLM' };
      return `<div class="card" style="margin-bottom:14px">
        <div class="card-head" style="border-bottom:1px solid var(--line-soft);cursor:pointer" data-team="${esc(teamName)}">
          <div class="head-icon">${teamBadge(teamName)}</div>
          <div><h3 style="margin:0">${esc(teamName)}</h3>
            <div class="sub">${fa(arr.filter((x) => x.active !== false).length)} کارشناس${k ? ` · ${FORM[k] || ''}` : ''}</div></div>
          <div class="spacer"></div>
          <div class="sel-bar" style="display:none;gap:6px;align-items:center">
            <span class="badge gray">${'<span id="selCount">0</span>'} انتخاب</span>
            <select class="input sm" style="width:150px" data-target-team><option value="">انتقال به …</option>${teamNames.map((x) => `<option>${esc(x)}</option>`).join('')}</select>
            <button class="btn soft sm" data-move>اعمال</button>
          </div>
          <i class="fa-solid chevron" data-open="1" style="color:var(--muted)"></i>
        </div>
        <div class="table-wrap team-body" style="max-height:340px;overflow-y:auto">
          <table class="tbl" style="font-size:13px">
            <thead><tr><th style="width:30px"><input type="checkbox" class="sel-all"></th><th>نام</th><th style="width:110px">داخلی</th><th>تیم</th><th style="width:95px"></th></tr></thead>
            <tbody>${arr.map(rowHtml).join('')}</tbody>
          </table>
        </div>
      </div>`;
    }

    const body = $('#agentsBody');
    if (!filtered.length) {
      body.innerHTML = `<div class="card">${emptyState('fa-user-slash', 'کارشناسی پیدا نشد', 'فیلتر را عوض کن یا کارشناس جدید اضافه کن').container}</div>`;
      return;
    }

    if (view === 'flat') {
      const flatRows = filtered.sort((a, b) => a.name.localeCompare(b.name, 'fa')).map((a) => rowHtml(a)).join('');
      body.innerHTML = `<div class="card">
        <div class="table-wrap" style="max-height:600px;overflow-y:auto">
          <table class="tbl" style="font-size:13px">
            <thead><tr><th style="width:30px"><input type="checkbox" class="sel-all"></th><th>نام</th><th style="width:110px">داخلی</th><th>تیم</th><th style="width:95px"></th></tr></thead>
            <tbody>${flatRows}</tbody>
          </table>
        </div></div>
        <datalist id="teamsDlAll">${teamNames.map((x) => `<option value="${esc(x)}">`).join('')}</datalist>`;
    } else {
      body.innerHTML = teamNames.map(teamSection).join('') +
        `<datalist id="teamsDlAll">${teamNames.map((x) => `<option value="${esc(x)}">`).join('')}</datalist>`;
    }
    attachRowEvents();
  }

  function attachRowEvents() {
    /* ویرایش آن‌لاین — داخلی و تیم */
    $$('#agentsBody input[data-ed="1"].row-ext').forEach((inp) => {
      inp.addEventListener('focus', () => { inp.style.border = '1px solid var(--brand)'; inp.style.background = 'var(--panel-soft)'; });
      inp.addEventListener('blur', () => { inp.style.border = '1px solid transparent'; inp.style.background = 'transparent'; saveRow(inp); });
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') inp.blur(); });
    });
    $$('#agentsBody input[data-ed="1"].row-team').forEach((inp) => {
      inp.addEventListener('focus', () => { inp.style.border = '1px solid var(--brand)'; inp.style.background = 'var(--panel-soft)'; });
      inp.addEventListener('blur', () => { inp.style.border = '1px solid transparent'; inp.style.background = 'transparent'; saveRow(inp); });
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') inp.blur(); });
    });

    function saveRow(inp) {
      const tr = inp.closest('tr');
      const id = +tr.dataset.id;
      const a = allAgents.find((x) => x.id === id);
      if (!a) return;
      const newExt = tr.querySelector('.row-ext').value.trim();
      const newTeam = tr.querySelector('.row-team').value.trim();
      const payload = {};
      const oldExt = (a.ext == null) ? '' : String(a.ext);
      if (newExt !== oldExt || newTeam !== a.team) {
        const numExt = newExt.replace(/[^\d]/g, '');
        payload.ext = newExt === '' ? '' : numExt;
        payload.team = newTeam;
        api.put('/api/agents/' + id, payload).then(() => {
          toast.success('به‌روز شد');
          a.ext = payload.ext === '' ? null : +numExt;
          if (payload.team) { a.team = payload.team; load(); }
          App.boot(); // App.boot تیم‌های bootstrap را هم تازه می‌کند
        }).catch((e) => toast.error(e.message));
      }
    }

    /* انتخاب سطرها و انتقال گروهی */
    $$('#agentsBody .row-check').forEach((cb) => {
      cb.addEventListener('change', () => {
        const id = +cb.closest('tr').dataset.id;
        if (cb.checked) sel.add(id); else sel.delete(id);
        updateSelBar(cb);
      });
    });
    $$('#agentsBody .sel-all').forEach((sa) => {
      sa.addEventListener('change', () => {
        const table = sa.closest('table');
        const cbs = table.querySelectorAll('tbody .row-check');
        cbs.forEach((cb) => { cb.checked = sa.checked; const id = +cb.closest('tr').dataset.id; if (sa.checked) sel.add(id); else sel.delete(id); });
        updateSelBar(sa);
      });
    });

    function updateSelBar(anyEl) {
      const section = anyEl.closest('.card');
      if (!section) return;
      const sb = section.querySelector('.sel-bar');
      if (!sb) return;
      const checkedInSection = section.querySelectorAll('.row-check:checked').length;
      sb.style.display = checkedInSection ? 'flex' : 'none';
      const sc = sb.querySelector('#selCount');
      if (sc) sc.textContent = fa(checkedInSection);
    }

    $$('#agentsBody [data-move]').forEach((b) => {
      b.addEventListener('click', async () => {
        const section = b.closest('.card');
        const target = section.querySelector('[data-target-team]').value;
        if (!target) { toast.info('تیم مقصد را انتخاب کنید'); return; }
        const ids = [...section.querySelectorAll('.row-check:checked')].map((cb) => +cb.closest('tr').dataset.id);
        if (!ids.length) { toast.info('بعضی را انتخاب کنید'); return; }
        try {
          for (const id of ids) await api.put('/api/agents/' + id, { team: target });
          toast.success(fa(ids.length) + ' کارشناس به «' + target + '» منتقل شدند');
          sel.clear();
          await App.boot();
          load();
        } catch (e) { toast.error(e.message); }
      });
    });

    /* بایگانی/بازیابی */
    $$('#agentsBody [data-act="archive"], #agentsBody [data-act="restore"]').forEach((b) => {
      b.addEventListener('click', () => {
        const tr = b.closest('tr');
        const id = +tr.dataset.id;
        const a = allAgents.find((x) => x.id === id);
        if (!a) return;
        const isArch = a.active !== false;
        const action = isArch ? 'بایگانی' : 'بازیابی';
        confirmDlg(
          action + ' کارشناس',
          `«${a.name}» ${isArch ? 'بایگانی می‌شود — تیش لیستها می‌نشیند اما سوابقش حفظ می‌ماند' : 'به کاربران فعال برمی‌گردد'}؟`,
          async () => {
            try {
              if (isArch) await api.del('/api/agents/' + id);
              else await api.put('/api/agents/' + id, { active: true });
              toast.success(action + ' شد');
              await App.boot();
              load();
            } catch (e) { toast.error(e.message); }
          },
          isArch ? 'بله، بایگانی شود' : 'بله، بازیابی شود'
        );
      });
    });

    /* storefront team — تا قجری برای همیشه بسته/باز کنیم */
    $$('#agentsBody .card-head').forEach((ch) => {
      ch.addEventListener('click', (e) => {
        if (e.target.closest('input,select,button,a')) return;
        const body = ch.parentElement.querySelector('.team-body');
        const chev = ch.querySelector('.chevron');
        const open = chev && chev.dataset.open === '1';
        if (body) {
          body.style.display = open ? 'none' : '';
          if (chev) { chev.dataset.open = open ? '0' : '1'; chev.style.transform = open ? 'rotate(-90deg)' : 'rotate(0)'; }
        }
      });
    });
  }

  /* مودال افزودن/ویرایش کارشناس */
  function agentForm(agent) {
    const isNew = !agent;
    const m = UI.modal(`${UI.modalHead(isNew ? 'افزودن کارشناس' : 'ویرایش کارشناس', 'fa-user-pen')}
      <div class="modal-body"><div class="form-grid" style="grid-template-columns:1fr">
        <div class="field"><label>نام و نام خانوادگی <span class="req">*</span></label>
          <input class="input" id="aN" value="${esc(agent ? agent.name : '')}" autocomplete="off"></div>
        <div class="field"><label>تیم <span class="req">*</span></label>
          <input class="input" id="aT" list="teamsAll" value="${esc(agent ? agent.team : App.state.teams[0] || '')}" placeholder="مثلاً Tele sales">
          <datalist id="teamsAll">${App.state.teams.map((t) => `<option value="${esc(t)}">`).join('')}</datalist></div>
        <div class="field"><label>شماره داخلی</label>
          <input class="input" id="aE" dir="ltr" style="text-align:right" inputmode="numeric" value="${agent && agent.ext != null ? agent.ext : ''}" placeholder="مثلاً ۳۰۲۲"></div>
        <div class="field"><label>زیرمجموعه (واحد)</label>
          <input class="input" id="aS" value="${esc(agent && agent.subgroup ? agent.subgroup : '')}" placeholder="مثلاً Shams Team"></div>
      </div></div>
      <div class="modal-foot"><button class="btn ghost" data-close>انصراف</button><button class="btn primary" id="aSave"><i class="fa-solid fa-floppy-disk"></i> ذخیره</button></div>`);
    $('#aSave', m).addEventListener('click', async () => {
      const payload = { name: $('#aN', m).value.trim(), team: $('#aT', m).value.trim(), ext: $('#aE', m).value.trim() || null, subgroup: $('#aS', m).value.trim() };
      try {
        if (isNew) await api.post('/api/agents', payload);
        else await api.put('/api/agents/' + agent.id, payload);
        toast.success('ذخیره شد');
        m.remove();
        await App.boot();
        load();
      } catch (e) { toast.error(e.message); }
    });
  }

  /* تیم جدید — درست کارشناس جدید را باید از تیم ایجاد شود */
  function teamForm() {
    const m = UI.modal(`${UI.modalHead('تیم جدید', 'fa-people-group')}
      <div class="modal-body"><div class="form-grid" style="grid-template-columns:1fr">
        <div class="field"><label>نام تیم <span class="req">*</span></label>
          <input class="input" id="tN" autocomplete="off" placeholder="مثلاً MLM, Account, Tele sales, پشتیبانی"></div>
        <div class="note"><i class="fa-solid fa-circle-info"></i> تیم‌های جدید با اولین کارشناسی که به آن اختصاص می‌یابند ساخته می‌شوند.</div>
      </div></div>
      <div class="modal-foot"><button class="btn ghost" data-close>بستن</button></div>`);
    $('#tN', m).addEventListener('input', () => {
      const v = $('#tN', m).value.trim();
      if (!v) return;
      App.state.teams = App.state.teams || [];
      if (!App.state.teams.includes(v)) App.state.teams.push(v);
      load();
    });
  }

  /* ایمپورت اکسل زیرمجموعه/کارشناس/تیم/CallerID */
  function importForm() {
    const m = UI.modal(`${UI.modalHead('ایمپورت اکسل کارشناسان', 'fa-file-import')}
      <div class="modal-body" style="min-width:min(760px,94vw)">
        <div class="note"><i class="fa-solid fa-circle-info"></i>
          ستون‌های مورد انتظار در اکسل: <b>زیرمجموعه اصلی</b> (اختیاری)، <b>کارشناس</b> (نام)، <b>تیم</b>، <b>CallerID</b> (شماره داخلی).
          کارشناس موجود به‌روز می‌شود و کارشناس جدید اضافه می‌گردد؛ پس از آن همه فیلترها همین لیست را می‌خوانند.
        </div>
        <div class="field" style="margin-top:10px"><label>انتخاب فایل اکسل</label>
          <input type="file" class="input" id="impFile" accept=".xlsx,.xls,.csv" dir="ltr"></div>
        <div id="impPreview"></div>
      </div>
      <div class="modal-foot"><button class="btn ghost" data-close>انصراف</button>
        <button class="btn primary" id="impGo" disabled><i class="fa-solid fa-cloud-arrow-up"></i> پردازش و به‌روزرسانی لیست</button></div>`);
    let pending = [];
    $('#impFile', m).addEventListener('change', async (e) => {
      const f = e.target.files[0];
      pending = [];
      $('#impGo', m).disabled = true;
      if (!f) { $('#impPreview', m).innerHTML = ''; return; }
      let rows;
      try {
        const buf = await f.arrayBuffer();
        const wb = XLSX.read(buf, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
      } catch (err) { $('#impPreview', m).innerHTML = '<div class="note bad">خواندن فایل ممکن نشد: ' + esc(err.message) + '</div>'; return; }
      if (!rows.length) { $('#impPreview', m).innerHTML = '<div class="note bad">فایل خالی است.</div>'; return; }
      /* سطر سرستون: سطری که «کارشناس» و یکی از CallerID/داخلی را دارد */
      let hi = rows.findIndex((r) => r.some((c) => /کارشناس/.test(String(c))) && r.some((c) => /caller|داخلی/i.test(String(c))));
      if (hi < 0) hi = 0;
      const hdr = rows[hi].map((c) => String(c).trim());
      const ci = {
        sub: hdr.findIndex((c) => /زیرمجموعه|زیر\s*مجموعه|واحد|sub/i.test(c)),
        name: hdr.findIndex((c) => /کارشناس/.test(c)),
        team: hdr.findIndex((c) => /تیم/.test(c)),
        ext: hdr.findIndex((c) => /caller|callerid|داخلی|دفتر/i.test(c))
      };
      if (ci.name < 0) { $('#impPreview', m).innerHTML = '<div class="note bad">ستون «کارشناس» در فایل پیدا نشد — سرستون‌ها: ' + esc(hdr.filter(Boolean).join('، ')) + '</div>'; return; }
      for (let i = hi + 1; i < rows.length; i++) {
        const r = rows[i];
        const name = String(ci.name >= 0 && r[ci.name] != null ? r[ci.name] : '').trim();
        if (!name) continue;
        const sub = String(ci.sub >= 0 && r[ci.sub] != null ? r[ci.sub] : '').trim();
        pending.push({
          name,
          team: String(ci.team >= 0 && r[ci.team] != null ? r[ci.team] : '').trim(),
          ext: C.faToEn(String(ci.ext >= 0 && r[ci.ext] != null ? r[ci.ext] : '')).replace(/[^\d]/g, ''),
          subgroup: sub === '—' || sub === '-' ? '' : sub
        });
      }
      if (!pending.length) { $('#impPreview', m).innerHTML = '<div class="note bad">ردیفی (به‌جز سرستون) با مقدار «کارشناس» پیدا نشد.</div>'; return; }
      const shown = pending.slice(0, 12);
      $('#impPreview', m).innerHTML = `
        <div class="note" style="margin-top:10px"><i class="fa-solid fa-check"></i> ${fa(pending.length)} ردیف آماده‌ی پردازش است${pending.length > 12 ? ' — ۱۲ ردیف اول:' : ':'}</div>
        <div class="table-wrap" style="max-height:230px;overflow-y:auto;margin-top:6px"><table class="tbl" style="font-size:12px">
          <thead><tr><th>کارشناس</th><th>تیم</th><th>CallerID</th><th>زیرمجموعه</th></tr></thead>
          <tbody>${shown.map((x) => `<tr><td class="cell-main">${esc(x.name)}</td><td>${esc(x.team)}</td><td dir="ltr">${esc(x.ext)}</td><td>${esc(x.subgroup || '')}</td></tr>`).join('')}</tbody>
        </table></div>`;
      $('#impGo', m).disabled = false;
    });
    $('#impGo', m).addEventListener('click', async () => {
      const btn = $('#impGo', m);
      btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-circle-notch spin"></i> در حال ارسال…';
      try {
        const res = await api.post('/api/agents/bulk', { rows: pending });
        toast.success('ایمپورت انجام شد — افزوده: ' + fa(res.added) + '، به‌روز: ' + fa(res.updated) + (res.skipped ? '، نادیده: ' + fa(res.skipped) : ''));
        if (res.errs && res.errs.length) toast.info(res.errs.join(' · '));
        m.remove();
        await App.boot();
        $('#agView').value = 'flat';
        load();
      } catch (e) { toast.error(e.message); btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-cloud-arrow-up"></i> پردازش و به‌روزرسانی لیست'; }
    });
  }

  $('#agentAdd').addEventListener('click', () => agentForm(null));
  $('#teamAdd').addEventListener('click', teamForm);
  $('#btnImport').addEventListener('click', importForm);
  $('#agSearch').addEventListener('input', debounce(renderAgents, 220));
  $('#agView').addEventListener('change', renderAgents);
  $('#agReload').addEventListener('click', load);

  /* ------------------------------- کارشناسان QC ------------------------------- */
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

  qcChips();
  load();
}

App.register('agents', { title: 'مدیریت کارشناسان', render });
})();
