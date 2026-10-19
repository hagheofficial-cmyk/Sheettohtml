/* qcAdmin.js — مدیریت QC (فقط مدیر): کاربران، رمزها و دسترسی داده‌ی هر کارشناس
 * منبع داده تب `QC_Users` گوگل‌شیت است؛ هر تغییر اینجا مستقیم روی همان تب می‌نشیند
 * و برعکس، ویرایش دستی روی شیت هم در خواندن بعدی اعمال می‌شود.
 */
(function () {
'use strict';
const { C, $, $$, api, fa, esc, el, toast, modal, modalHead, confirmDlg, emptyState } = UI;

let state = { users: [], teams: [], agents: [], required: false, mode: 'auto' };

function accessSummary(user) {
  if (user.role === 'admin' || user.unrestricted) return { text: 'همه‌ی کارشناسان', cls: 'good', count: -1 };
  const exts = (user.exts || []).filter(Boolean);
  const names = (user.agents || []).filter(Boolean);
  const teams = (user.teams || []).filter(Boolean);
  const matched = matchedAgents(user).length;
  if (!exts.length && !names.length && !teams.length) {
    return matched
      ? { text: fa(matched) + ' کارشناس ← از ستون qcAgents شیت', cls: 'info', count: matched }
      : { text: 'دسترسی تعریف نشده', cls: 'bad', count: 0 };
  }
  const bits = [];
  if (exts.length) bits.push(fa(exts.length) + ' داخلی');
  if (names.length) bits.push(fa(names.length) + ' نام');
  if (teams.length) bits.push(fa(teams.length) + ' تیم');
  return { text: bits.join(' · ') + ' → ' + fa(matched) + ' کارشناس', cls: matched ? 'info' : 'warn', count: matched };
}

function matchedAgents(user) {
  const A = window.QCAccess;
  if (!A) return [];
  const allowed = A.allowedAgentNames({ agents: state.agents }, A.normalizeUser(user));
  if (!allowed) return state.agents.slice();
  return state.agents.filter((a) => allowed.has(a.name));
}

function modeText(mode, required) {
  if (mode === 'off') return 'خاموش — همه بدون رمز وارد می‌شوند';
  if (mode === 'on') return 'همیشه روشن — حتی بدون کاربر تعریف‌شده';
  return required ? 'خودکار — روشن (کاربر فعال تعریف شده)' : 'خودکار — خاموش (هیچ کاربری تعریف نشده)';
}

async function load() {
  state = await api.get('/api/qc-users');
  state.agents = state.agents || [];
  state.teams = state.teams || [];
}

async function render(root) {
  root.innerHTML = `<div class="card">${emptyState('fa-spinner fa-spin', 'در حال بارگذاری', 'کاربران QC و دسترسی‌ها خوانده می‌شوند…')}</div>`;
  try { await load(); }
  catch (e) {
    root.innerHTML = `<div class="card">${emptyState('fa-triangle-exclamation', 'خواندن کاربران ناموفق بود', e.message,
      `<button class="btn ghost" onclick="App.route()"><i class="fa-solid fa-rotate-right"></i> تلاش دوباره</button>`)}</div>`;
    return;
  }
  draw(root);
}

function draw(root) {
  const users = state.users || [];
  root.innerHTML = `
    <div class="page-head">
      <div class="ph-ic"><i class="fa-solid fa-user-shield"></i></div>
      <div>
        <h2>مدیریت QC</h2>
        <p>رمز هر کارشناس QC، نقش او و اینکه کدام کارشناسان/داخلی‌ها را ببیند — فقط مدیر سیستم</p>
      </div>
      <div class="spacer"></div>
      <button class="btn soft" id="qcExport"><i class="fa-solid fa-file-excel"></i> خروجی اکسل</button>
      <button class="btn primary" id="qcAdd"><i class="fa-solid fa-user-plus"></i> کاربر QC جدید</button>
    </div>

    <div class="card qc-mode-card">
      <div class="card-head">
        <div class="head-icon"><i class="fa-solid fa-lock"></i></div>
        <div><h3>وضعیت ورود با رمز</h3><div class="sub">${esc(modeText(state.mode, state.required))}</div></div>
      </div>
      <div class="card-pad qc-mode">
        <div class="qc-mode-options" role="radiogroup" aria-label="حالت احراز هویت">
          ${[['auto', 'خودکار', 'به محض تعریف اولین کاربر فعال، ورود با رمز اجباری می‌شود'],
             ['on', 'همیشه روشن', 'حتی اگر کاربری تعریف نشده باشد (احتیاط: ممکن است کسی نتواند وارد شود)'],
             ['off', 'خاموش', 'ورود بدون رمز؛ دسترسی‌ها اعمال نمی‌شوند']]
            .map(([value, label, hint]) => `
            <label class="qc-mode-option${state.mode === value ? ' sel' : ''}">
              <input type="radio" name="authMode" value="${value}" ${state.mode === value ? 'checked' : ''}>
              <strong>${label}</strong><small>${hint}</small>
            </label>`).join('')}
        </div>
        <div class="note"><i class="fa-solid fa-circle-info"></i>
          رمزها به‌صورت اثر انگشت (hash) ذخیره می‌شوند. اگر رمزی را مستقیم روی تب <code>QC_Users</code> به‌صورت متن ساده بنویسید هم پذیرفته می‌شود تا مدیریت از داخل شیت ممکن بماند.</div>
      </div>
    </div>

    <div class="card">
      <div class="card-head teal">
        <div class="head-icon"><i class="fa-solid fa-users-line"></i></div>
        <div><h3>کاربران سامانه</h3><div class="sub">${fa(users.length)} کاربر تعریف شده — نام، نقش و دسترسی داده</div></div>
      </div>
      <div class="card-pad">
        ${users.length ? `
        <div class="table-scroll">
          <table class="tbl qc-users">
            <thead><tr><th>کاربر</th><th>نقش</th><th>وضعیت</th><th>دسترسی داده</th><th>رمز</th><th>عملیات</th></tr></thead>
            <tbody>
              ${users.map((u, i) => {
                const acc = accessSummary(u);
                return `<tr data-i="${i}">
                  <td class="qc-name"><strong>${esc(u.name)}</strong>${u.note ? `<div class="cell-sub">${esc(u.note)}</div>` : ''}</td>
                  <td>${u.role === 'admin'
                    ? '<span class="badge brand"><i class="fa-solid fa-user-shield"></i>مدیر سیستم</span>'
                    : '<span class="badge info"><i class="fa-solid fa-user-check"></i>کارشناس QC</span>'}</td>
                  <td>${u.active ? '<span class="badge good"><i class="fa-solid fa-circle-check"></i>فعال</span>'
                                 : '<span class="badge gray"><i class="fa-solid fa-ban"></i>غیرفعال</span>'}</td>
                  <td><span class="badge ${acc.cls}">${esc(acc.text)}</span></td>
                  <td>${u.password ? '<span class="badge gray"><i class="fa-solid fa-key"></i>تعریف شده</span>'
                                   : '<span class="badge bad"><i class="fa-solid fa-key"></i>رمز ندارد</span>'}</td>
                  <td class="qc-ops">
                    <button class="btn ghost sm" data-edit="${i}" title="ویرایش"><i class="fa-solid fa-pen"></i></button>
                    <button class="btn ghost sm" data-pass="${i}" title="تغییر رمز"><i class="fa-solid fa-key"></i></button>
                    <button class="btn danger-soft sm" data-del="${i}" title="حذف"><i class="fa-solid fa-trash-can"></i></button>
                  </td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>` : emptyState('fa-user-slash', 'هنوز کاربری تعریف نشده',
          'اولین کاربر را بسازید؛ از همان لحظه ورود با رمز اجباری می‌شود و هر کارشناس QC فقط داده‌ی کارشناسانی را می‌بیند که شما اجازه داده‌اید.',
          '<button class="btn primary" id="qcEmptyAdd"><i class="fa-solid fa-user-plus"></i> ساخت اولین کاربر</button>')}
        <div class="note" style="margin-top:14px"><i class="fa-solid fa-table"></i>
          همین فهرست در تب <code>QC_Users</code> شیت نگهداری می‌شود: <code>name</code>، <code>password</code>، <code>role</code>،
          <code>active</code>، <code>exts</code> (داخلی‌ها با ویرگول)، <code>agents</code> و <code>teams</code>.
          می‌توانید دسترسی‌ها را مستقیم روی شیت هم بنویسید.
          راه دیگر: در تب <code>Agents</code> ستون <code>qcAgents</code> ردیف هر کارشناس، نام کارشناس QC مسئولش را
          بنویسید — همین اپ هم هنگام ذخیرهی کاربر، این ستون را پر می‌کند.</div>
      </div>
    </div>`;

  $('#qcAdd').addEventListener('click', () => editor(null));
  const emptyAdd = $('#qcEmptyAdd');
  if (emptyAdd) emptyAdd.addEventListener('click', () => editor(null));
  $('#qcExport').addEventListener('click', exportUsers);
  $$('input[name="authMode"]', root).forEach((r) => r.addEventListener('change', async () => {
    try {
      await api.put('/api/settings', { authMode: r.value });
      state.mode = r.value;
      await App.boot();
      toast('حالت ورود با رمز ذخیره شد', 'success');
      draw(root);
    } catch (e) { toast(e.message, 'error'); }
  }));
  $$('[data-edit]', root).forEach((b) => b.addEventListener('click', () => editor(state.users[+b.dataset.edit])));
  $$('[data-pass]', root).forEach((b) => b.addEventListener('click', () => passwordDialog(state.users[+b.dataset.pass])));
  $$('[data-del]', root).forEach((b) => b.addEventListener('click', () => {
    const u = state.users[+b.dataset.del];
    confirmDlg('حذف کاربر', `کاربر «${u.name}» و دسترسی‌هایش حذف می‌شود. داده‌های ارزیابی ثبت‌شده دست‌نخورده می‌مانند.`, async () => {
      try {
        await api.del('/api/qc-users/' + encodeURIComponent(u.id));
        await load(); await App.boot(); draw(root);
        toast('کاربر حذف شد', 'success');
      } catch (e) { toast(e.message, 'error'); }
    });
  }));
}

function exportUsers() {
  const rows = [['name', 'password', 'role', 'active', 'exts', 'agents', 'teams', 'note']]
    .concat((state.users || []).map((u) => [u.name, u.password ? '(ذخیره‌شده)' : '', u.role, u.active ? 1 : 0,
      (u.exts || []).join(','), (u.agents || []).join(','), (u.teams || []).join(','), u.note || '']));
  const access = [['کارشناس QC', 'تیم', 'نام کارشناس', 'داخلی']]
    .concat((state.users || []).reduce((all, u) => all.concat(matchedAgents(u).map((a) => [u.name, a.team, a.name, a.ext])), []));
  window.QCExport.sheets('دسترسی کاربران QC', [{ name: 'QC_Users', rows: rows }, { name: 'Access', rows: access }]);
}

function passwordDialog(user) {
  const m = modal(`${modalHead('تغییر رمز — ' + user.name, 'fa-key')}
    <div class="modal-body">
      <div class="field"><label>رمز جدید (حداقل ۴ نویسه)</label>
        <div class="auth-pass"><input class="input" id="npPass" type="password" autocomplete="new-password">
          <button type="button" class="btn ghost sm" id="npShow"><i class="fa-regular fa-eye"></i></button></div>
        <div class="note" style="margin-top:8px"><i class="fa-solid fa-shield-halved"></i> رمز به‌صورت hash ذخیره می‌شود و در شیت قابل خواندن نیست.</div>
      </div>
    </div>
    <div class="modal-foot"><button class="btn ghost" data-close>انصراف</button>
      <button class="btn primary" id="npSave"><i class="fa-solid fa-floppy-disk"></i> ذخیره رمز</button></div>`);
  $('#npShow', m).addEventListener('click', () => {
    const inp = $('#npPass', m);
    inp.type = inp.type === 'password' ? 'text' : 'password';
  });
  $('#npSave', m).addEventListener('click', async () => {
    const pass = $('#npPass', m).value;
    if (pass.length < 4) { toast.error('رمز باید حداقل ۴ نویسه باشد'); return; }
    try {
      await api.put('/api/qc-users', { id: user.id, name: user.name, role: user.role, active: user.active,
        exts: (user.exts || []).join(','), agents: (user.agents || []).join(','), teams: (user.teams || []).join(','),
        note: user.note || '', password: pass });
      m.close(); await load(); draw(document.querySelector('.route-view'));
      toast.success('رمز «' + user.name + '» تغییر کرد');
    } catch (e) { toast.error(e.message); }
  });
}

/* ------------------------------------------------------- ساخت/ویرایش کاربر */
function editor(user) {
  const editing = !!user;
  const A = window.QCAccess;
  const P = window.QCParse || {};
  const normKey = (v) => (P.nameKey ? P.nameKey(v == null ? '' : String(v)) : String(v == null ? '' : v).trim().toLowerCase());
  const userName = user ? String(user.name || '') : '';
  const selectedTeams = new Set((user && user.teams) || []);
  const extSet = new Set(((user && user.exts) || []).map((x) => String(x)));
  const nameSet = new Set(((user && user.agents) || []).map(normKey));

  /* ستون `qcAgents` ردیف کارشناس (تب Agents): اگر نام این کاربر آنجا نوشته شده باشد،
   * آن کارشناس هم در دسترسی‌اش هست — پس از شیت/اکسل هم می‌شود دسترسی داد و اینجا تیک‌خورده می‌آید. */
  const viaSheet = (a) => (A && A.splitList ? A.splitList(a.qcAgents) : [])
    .some((n) => normKey(n) === normKey(userName));
  const isOn = (a) => (a.ext != null && a.ext !== '' && extSet.has(String(a.ext))) ||
    nameSet.has(normKey(a.name)) || (!!userName && viaSheet(a));

  const byTeam = new Map();
  state.agents.forEach((a) => {
    const key = a.team || '—';
    if (!byTeam.has(key)) byTeam.set(key, []);
    byTeam.get(key).push(a);
  });
  const teamNames = [...byTeam.keys()].sort((x, y) => String(x).localeCompare(String(y), 'fa'));
  const groups = teamNames.map((team) => {
    const list = byTeam.get(team).slice().sort((x, y) => String(x.name).localeCompare(String(y.name), 'fa'));
    return `
      <div class="qc-group" data-team="${esc(team)}">
        <div class="qc-group-head">
          <strong>${esc(team)}</strong>
          <span class="cell-sub" data-team-count></span>
          <div class="spacer"></div>
          <button type="button" class="btn ghost sm" data-team-all>همه</button>
          <button type="button" class="btn ghost sm" data-team-none>هیچ</button>
          <button type="button" class="btn ghost sm" data-team-scope
            title="کل تیم به‌عنوان دسترسی ثبت شود؛ کارشناسان تازه‌ی این تیم خودکار اضافه می‌شوند">کل تیم</button>
        </div>
        <div class="qc-rows">
          ${list.map((a) => {
            const ext = a.ext == null || a.ext === '' ? '' : String(a.ext);
            const sheet = !!userName && viaSheet(a);
            return `<label class="qc-row${sheet ? ' from-sheet' : ''}" data-name="${esc(a.name)}" data-ext="${esc(ext)}">
              <input type="checkbox" data-agent="${esc(a.name)}" ${isOn(a) ? 'checked' : ''}>
              <span class="qc-row-name">${esc(a.name)}</span>
              ${ext ? `<span class="qc-row-ext" dir="ltr">${esc(C.toFaDigits(ext))}</span>` : '<span class="qc-row-ext none">بدون داخلی</span>'}
              ${sheet ? '<span class="qc-row-tag" title="از ستون qcAgents تب Agents">شیت</span>' : ''}
            </label>`;
          }).join('')}
        </div>
      </div>`;
  }).join('');

  const m = modal(`${modalHead(editing ? 'ویرایش کاربر — ' + user.name : 'کاربر QC جدید', 'fa-user-shield')}
    <div class="modal-body qc-editor">
      <div class="form-grid qc-form-grid">
        <div class="field"><label>نام کارشناس QC <span class="req">*</span></label>
          <input class="input" id="quName" value="${esc(user ? user.name : '')}" autocomplete="off"
            placeholder="همان نامی که در فرم‌ها به‌عنوان QC ثبت می‌شود" ${editing ? 'readonly' : ''}></div>
        <div class="field"><label>نقش</label>
          <select class="input" id="quRole">
            <option value="qc" ${!user || user.role !== 'admin' ? 'selected' : ''}>کارشناس QC — فقط داده‌ی مجاز</option>
            <option value="admin" ${user && user.role === 'admin' ? 'selected' : ''}>مدیر سیستم — همه‌ی صفحه‌ها و داده‌ها</option>
          </select></div>
        <div class="field"><label>${editing ? 'رمز جدید (خالی = بدون تغییر)' : 'رمز عبور'} ${editing ? '' : '<span class="req">*</span>'}</label>
          <div class="auth-pass"><input class="input" id="quPass" type="password" autocomplete="new-password" placeholder="حداقل ۴ نویسه">
            <button type="button" class="btn ghost sm" id="quShow"><i class="fa-regular fa-eye"></i></button></div></div>
        <div class="field"><label>وضعیت</label>
          <select class="input" id="quActive">
            <option value="1" ${!user || user.active ? 'selected' : ''}>فعال — می‌تواند وارد شود</option>
            <option value="0" ${user && !user.active ? 'selected' : ''}>غیرفعال — ورود بسته</option>
          </select></div>
      </div>

      <div class="field qc-access">
        <label>دسترسی داده — کدام کارشناسان را ببیند و ریت کند</label>
        <div class="qc-access-bar">
          <div class="qc-search"><i class="fa-solid fa-magnifying-glass"></i>
            <input class="input" id="quSearch" autocomplete="off" placeholder="جستجوی نام یا داخلی…"></div>
          <span class="badge info" id="quCount">۰ کارشناس</span>
          <div class="spacer"></div>
          <label class="qc-all" title="همه‌ی کارشناسان، بدون استثنا"><input type="checkbox" id="quUnlimited">
            <span>همه‌ی کارشناسان</span></label>
        </div>

        <div class="qc-picker" id="quPicker">
          <div class="qc-picked" id="quPicked"></div>
          ${state.agents.length
            ? `<div class="qc-list" id="quList">${groups}</div>`
            : `<div class="qc-empty" id="quList"><i class="fa-solid fa-user-slash"></i> هنوز کارشناسی ثبت نشده —
                اول از صفحه‌ی «مدیریت کارشناسان» فهرست را بسازید یا از تب <code>Agents</code> شیت پر کنید.</div>`}
        </div>

        <div class="qc-two">
          <div class="field"><label>داخلی‌های اضافه (با ویرگول) — کارشناسانی که در فهرست نیستند</label>
            <input class="input" id="quExtraExt" dir="ltr" style="text-align:right" autocomplete="off" placeholder="3121, 3122"
              value="${esc([...extSet].filter((x) => !state.agents.some((a) => String(a.ext) === x)).join(', '))}"></div>
          <div class="field"><label>یادداشت (اختیاری)</label>
            <input class="input" id="quNote" value="${esc(user ? user.note || '' : '')}" autocomplete="off"
              placeholder="مثلاً: مسئول بررسی تیم MLM"></div>
        </div>
        <div class="note" id="quHint"></div>
        <div class="note soft-note"><i class="fa-solid fa-table"></i> این تیک‌ها روی ستون <code>qcAgents</code> تب
          <code>Agents</code> هم نوشته می‌شود؛ پس همان دسترسی را می‌توانید مستقیم روی شیت/اکسل هم ویرایش کنید
          (نام کارشناس QC را در ردیف کارشناس بنویسید — چند نام با ویرگول).</div>
      </div>
    </div>
    <div class="modal-foot">
      <button class="btn ghost" data-close>انصراف</button>
      <button class="btn primary" id="quSave"><i class="fa-solid fa-floppy-disk"></i> ${editing ? 'ذخیره تغییرات' : 'ساخت کاربر'}</button>
    </div>`, { lg: true });

  const roleSel = $('#quRole', m), unlimited = $('#quUnlimited', m), picker = $('#quPicker', m);
  unlimited.checked = !!user && (user.role === 'admin' || !!user.unrestricted);

  /* انتخاب‌شده‌ها مستقیم از خود چک‌باکس‌ها خوانده می‌شود تا تیک‌هایی که از ستون شیت
   * آمده‌اند هم موقع ذخیره از دست نروند. */
  function selected() {
    const names = $$('input[data-agent]', m).filter((c) => c.checked).map((c) => c.dataset.agent);
    const exts = [], plain = [];
    names.forEach((n) => {
      const a = state.agents.find((x) => x.name === n);
      if (a && a.ext != null && a.ext !== '') exts.push(String(a.ext)); else plain.push(n);
    });
    const extra = String($('#quExtraExt', m).value || '').split(/[,،;؛|\s]+/).map((x) => x.trim()).filter(Boolean);
    return { names, exts: [...new Set(exts.concat(extra))], plain: [...new Set(plain)] };
  }

  function refreshCount() {
    const sel = selected();
    const off = unlimited.checked || roleSel.value === 'admin';
    picker.classList.toggle('off', off);
    $('#quCount', m).textContent = off ? 'همه‌ی کارشناسان'
      : fa(sel.names.length) + ' کارشناس' + (selectedTeams.size ? ' + ' + fa(selectedTeams.size) + ' تیم کامل' : '');

    $$('.qc-picked', m).forEach((box) => {
      box.innerHTML = off
        ? '<span class="qc-picked-empty">دسترسی نامحدود — همه‌ی کارشناسان</span>'
        : (sel.names.length
          ? sel.names.map((n) => `<span class="qc-chip">${esc(n)}<button type="button" data-unpick="${esc(n)}"
              title="برداشتن"><i class="fa-solid fa-xmark"></i></button></span>`).join('')
          : '<span class="qc-picked-empty">هنوز کارشناسی انتخاب نشده — از فهرست زیر تیک بزنید</span>');
    });
    $$('[data-unpick]', m).forEach((b) => b.addEventListener('click', () => {
      const box = $$('input[data-agent]', m).find((c) => c.dataset.agent === b.dataset.unpick);
      if (box && box.checked) { box.checked = false; refreshCount(); }
    }));

    $$('.qc-group', m).forEach((g) => {
      const boxes = $$('input[data-agent]', g);
      const on = boxes.filter((c) => c.checked).length;
      const countEl = $('[data-team-count]', g);
      if (countEl) countEl.textContent = fa(on) + ' از ' + fa(boxes.length);
      g.classList.toggle('scoped', selectedTeams.has(g.dataset.team));
      const visible = $$('.qc-row', g).filter((r) => !r.hidden).length;
      g.hidden = visible === 0;
    });

    $('#quHint', m).innerHTML = off
      ? '<i class="fa-solid fa-circle-info"></i> این کاربر همه‌ی کارشناسان را می‌بیند؛ ستون <code>qcAgents</code> برای او خالی می‌ماند.'
      : (sel.exts.length || sel.plain.length || selectedTeams.size)
        ? '<i class="fa-solid fa-circle-check"></i> فقط ارزیابی‌های این کارشناسان در داشبورد، گزارش‌ها و سوابق دیده می‌شود.'
        : '<i class="fa-solid fa-triangle-exclamation"></i> دسترسی خالی یعنی این کارشناس هیچ داده‌ای نمی‌بیند.';
  }

  $('#quShow', m).addEventListener('click', () => {
    const inp = $('#quPass', m);
    inp.type = inp.type === 'password' ? 'text' : 'password';
  });
  $('#quSearch', m).addEventListener('input', debounce(() => {
    const q = String($('#quSearch', m).value).trim().toLowerCase();
    $$('.qc-row', m).forEach((row) => {
      const hay = (row.dataset.name + ' ' + row.dataset.ext).toLowerCase();
      row.hidden = !!q && hay.indexOf(q) === -1;
    });
    refreshCount();
  }, 110));
  $('#quExtraExt', m).addEventListener('input', debounce(refreshCount, 150));
  unlimited.addEventListener('change', refreshCount);
  roleSel.addEventListener('change', () => { if (roleSel.value === 'admin') unlimited.checked = true; refreshCount(); });
  $$('input[data-agent]', m).forEach((c) => c.addEventListener('change', refreshCount));
  $$('.qc-group', m).forEach((g) => {
    const boxes = () => $$('input[data-agent]', g);
    $('[data-team-all]', g).addEventListener('click', () => { boxes().forEach((c) => { c.checked = true; }); refreshCount(); });
    $('[data-team-none]', g).addEventListener('click', () => { boxes().forEach((c) => { c.checked = false; }); refreshCount(); });
    $('[data-team-scope]', g).addEventListener('click', () => {
      const team = g.dataset.team;
      if (selectedTeams.has(team)) selectedTeams.delete(team); else selectedTeams.add(team);
      refreshCount();
    });
  });

  $('#quSave', m).addEventListener('click', async () => {
    const name = $('#quName', m).value.trim();
    const pass = $('#quPass', m).value;
    if (!name) { toast.error('نام کارشناس QC الزامی است'); return; }
    if (!editing && !pass) { toast.error('رمز اولیه الزامی است'); return; }
    if (pass && pass.length < 4) { toast.error('رمز باید حداقل ۴ نویسه باشد'); return; }
    const sel = selected();
    const role = roleSel.value;
    const off = role === 'admin' || unlimited.checked;
    const payload = {
      id: editing ? user.id : '',
      name: name,
      role: role,
      active: $('#quActive', m).value === '1',
      exts: off ? '*' : sel.exts.join(','),
      agents: off ? '' : sel.plain.join(','),
      teams: off ? '' : [...selectedTeams].join(','),
      note: $('#quNote', m).value.trim(),
      /* تیک‌ها قطعی‌اند: ستون qcAgents تب Agents دقیقاً همین می‌شود */
      syncColumn: true
    };
    if (pass) payload.password = pass;
    const btn = $('#quSave', m); btn.disabled = true;
    try {
      if (editing) await api.put('/api/qc-users', payload);
      else await api.post('/api/qc-users', payload);
      m.close();
      await load();
      await App.boot();
      draw(document.querySelector('.route-view'));
      toast.success(editing ? 'ذخیره شد — ستون qcAgents تب Agents هم به‌روز شد'
        : 'کاربر ساخته شد — از این پس با رمز وارد می‌شود');
    } catch (e) { toast.error(e.message); btn.disabled = false; }
  });

  refreshCount();
}

function debounce(fn, ms) { let t; return function (...a) { clearTimeout(t); t = setTimeout(() => fn.apply(this, a), ms); }; }

App.register('qcadmin', { title: 'مدیریت QC', render });
})();
