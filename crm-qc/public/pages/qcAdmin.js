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
      ? { text: fa(matched) + ' کارشناس ← از ستون‌های QC شیت', cls: 'info', count: matched }
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
            .filter(([value]) => !window.APP_SCRIPT_MODE || value === 'on')
            .map(([value, label, hint]) => `
            <label class="qc-mode-option${state.mode === value ? ' sel' : ''}">
              <input type="radio" name="authMode" value="${value}" ${state.mode === value ? 'checked' : ''}>
              <strong>${label}</strong><small>${hint}</small>
            </label>`).join('')}
        </div>
        <div class="note"><i class="fa-solid fa-circle-info"></i>
          رمزها به‌صورت اثر انگشت (hash) ذخیره می‌شوند. ${window.APP_SCRIPT_MODE ? 'در این نسخه ورود اجباری و رمز حداقل ۱۲ نویسه است؛ رمز را مستقیم روی شیت ننویسید.' : 'مدیر رمز و سطح دسترسی هر کاربر را تنظیم می‌کند.'}</div>
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
          همین فهرست در تب <code>QC_Users</code> شیت نگهداری می‌شود: <code>name</code>، <code>password</code>،
          <code>role</code>، <code>active</code>، <code>exts</code>، <code>agents</code> و <code>teams</code>.
          <br><b>روی شیت:</b> تب <code>Agents</code> برای هر کارشناس QC یک ستون اختصاصی با سرستون
          <code>QC: نام</code> دارد؛ در ردیف هر کارشناس با انتخاب «✓» (لیست کشویی) مشخص کنید چه کسی او را
          بررسی می‌کند. همین تیک‌ها در این صفحه هم دیده می‌شوند و برعکس.</div>
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
      <div class="field"><label>رمز جدید (حداقل ${window.APP_SCRIPT_MODE ? '۱۲' : '۴'} نویسه)</label>
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
    if (pass.length < (window.APP_SCRIPT_MODE ? 12 : 4)) { toast.error(window.APP_SCRIPT_MODE ? 'رمز باید حداقل ۱۲ نویسه باشد' : 'رمز باید حداقل ۴ نویسه باشد'); return; }
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

  /* تیم‌ها یکدست می‌شوند: «Tele sales»، «telesales» و «Tele  Sales» یک تیم‌اند.
   * فهرست هم تخت و قابل جستجو است؛ گروه‌های تودرتو باعث می‌شد کارشناس‌ها
   * پایین چند سرستون گم شوند و نشود تیک زد. */
  const teamKeyOf = (name) => String(name == null ? '' : name).replace(/[\s_‌\-]+/g, '').toLowerCase() || 'بدون‌تیم';
  const teamInfo = new Map();
  state.agents.forEach((a) => {
    const key = teamKeyOf(a.team);
    if (!teamInfo.has(key)) teamInfo.set(key, { key, labels: new Map(), agents: [] });
    const info = teamInfo.get(key);
    const label = String(a.team == null ? '' : a.team).trim() || 'بدون تیم';
    info.labels.set(label, (info.labels.get(label) || 0) + 1);
    info.agents.push(a);
  });
  const teamList = [...teamInfo.values()].map((info) => {
    let label = info.agents.length ? 'بدون تیم' : '—', best = -1;
    info.labels.forEach((count, text) => { if (count > best) { best = count; label = text; } });
    return { key: info.key, label, agents: info.agents };
  }).sort((x, y) => x.label.localeCompare(y.label, 'fa'));
  const teamLabelOf = (agent) => {
    const info = teamInfo.get(teamKeyOf(agent.team));
    if (!info) return 'بدون تیم';
    let label = '—', best = -1;
    info.labels.forEach((count, text) => { if (count > best) { best = count; label = text; } });
    return label;
  };
  const activeTeams = new Set(); // فیلتر تیم‌ها
  const picked = new Set(state.agents.filter(isOn).map((a) => a.name));

  function visibleAgents() {
    const q = String($('#quSearch', m) ? $('#quSearch', m).value : '').trim().toLowerCase();
    const digitsQ = C.faToEn(q).replace(/[^0-9]/g, '');
    return state.agents.filter((a) => {
      if (activeTeams.size && !activeTeams.has(teamKeyOf(a.team))) return false;
      if (!q) return true;
      const hay = (String(a.name || '') + ' ' + String(a.ext == null ? '' : a.ext) + ' ' + teamLabelOf(a)).toLowerCase();
      return hay.indexOf(q) >= 0 || (!!digitsQ && String(a.ext == null ? '' : a.ext).indexOf(digitsQ) >= 0);
    }).sort((x, y) => {
      const t = teamLabelOf(x).localeCompare(teamLabelOf(y), 'fa');
      return t !== 0 ? t : String(x.name).localeCompare(String(y.name), 'fa');
    });
  }

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
            <input class="input" id="quSearch" autocomplete="off" placeholder="جستجوی نام، داخلی یا تیم…"></div>
          <span class="badge info" id="quCount">۰ کارشناس</span>
          <div class="spacer"></div>
          <label class="qc-all" title="همه‌ی کارشناسان، بدون استثنا"><input type="checkbox" id="quUnlimited">
            <span>همه‌ی کارشناسان</span></label>
        </div>

        <div class="qc-subset" id="quSubset">
          <div class="qc-subset-head">
            <span class="qc-subset-ic"><i class="fa-solid fa-sitemap"></i></span>
            <div><b>زیرمجموعه — ست‌کردن از مدیریت کارشناسان</b>
              <div class="sub">نام، تیم و داخلی را از همان فهرست برمی‌دارد؛ لازم نیست دستی چیزی تایپ شود.</div></div>
            <div class="spacer"></div>
            <span class="badge info" id="quSubCount">—</span>
          </div>
          <div class="qc-subset-row">
            <label class="qc-subset-f"><span>زیرمجموعه (Subgroup)</span>
              <select class="input" id="quSubPick"><option value="">همه‌ی زیرمجموعه‌ها</option></select></label>
            <label class="qc-subset-f"><span>تیم</span>
              <select class="input" id="quTeamPick"><option value="">همه‌ی تیم‌ها</option></select></label>
            <label class="qc-subset-mode" title="اگر تیک باشد، انتخاب‌های فعلی پاک و فقط همین زیرمجموعه ست می‌شود">
              <input type="checkbox" id="quReplace" checked><span>جایگزینی انتخاب فعلی</span></label>
            <button type="button" class="btn soft" id="quApplySubset">
              <i class="fa-solid fa-arrow-down-long"></i> ست از مدیریت کارشناسان</button>
          </div>
          <div class="qc-subset-hint" id="quSubsetHint">یک زیرمجموعه یا تیم انتخاب کنید؛ دکمه، همه‌ی کارشناسان همان گروه را تیک می‌زند.</div>
        </div>

        <div class="qc-team-filter" id="quTeams" role="group" aria-label="فیلتر تیم"></div>
        <div class="qc-picker" id="quPicker">
          <div class="qc-picked" id="quPicked"></div>
          <div class="qc-toolbar">
            <button type="button" class="btn ghost sm" id="quAll"><i class="fa-solid fa-check-double"></i> انتخاب همه‌ی نتایج</button>
            <button type="button" class="btn ghost sm" id="quNone"><i class="fa-solid fa-eraser"></i> پاک‌کردن</button>
            <button type="button" class="btn ghost sm" id="quScope" title="دسترسی کل تیم‌های فیلترشده — کارشناسان تازه‌ی همان تیم هم خودکار اضافه می‌شوند">
              <i class="fa-solid fa-people-group"></i> کل تیم‌های فیلترشده</button>
            <div class="spacer"></div>
            <span class="qc-hint" id="quVisible"></span>
          </div>
          ${state.agents.length
            ? '<div class="qc-list" id="quList"></div>'
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
        <div class="note soft-note"><i class="fa-solid fa-table"></i> هر تیک روی شیت در ستون اختصاصی همین
          کارشناس QC (سرستون <code>QC: نام</code> در تب <code>Agents</code>) به‌صورت «✓» نوشته می‌شود و روی خود شیت
          هم با همان لیست کشویی قابل تغییر است؛ دیگر نیازی به نوشتن نام‌ها با ویرگول نیست.</div>
      </div>
    </div>
    <div class="modal-foot">
      <button class="btn ghost" data-close>انصراف</button>
      <button class="btn primary" id="quSave"><i class="fa-solid fa-floppy-disk"></i> ${editing ? 'ذخیره تغییرات' : 'ساخت کاربر'}</button>
    </div>`, { lg: true });

  const roleSel = $('#quRole', m);

  const picker = $('#quPicker', m);
  $('#quUnlimited', m).checked = !!user && (user.role === 'admin' || !!user.unrestricted);
  const unlimitedBox = $('#quUnlimited', m);

  /* انتخاب‌شده‌ها در یک Set نگه داشته می‌شوند تا فیلتر/جستجو تیک‌ها را از دست ندهد. */
  function collect() {
    const names = [...picked];
    const exts = [], plain = [];
    names.forEach((n) => {
      const a = state.agents.find((x) => x.name === n);
      if (a && a.ext != null && a.ext !== '') exts.push(String(a.ext)); else plain.push(n);
    });
    const extra = String($('#quExtraExt', m).value || '').split(/[,،;؛|\s]+/).map((x) => x.trim()).filter(Boolean);
    return { names, exts: [...new Set(exts.concat(extra))], plain: [...new Set(plain)] };
  }

  function rowHtml(a) {
    const ext = a.ext == null || a.ext === '' ? '' : String(a.ext);
    const sheet = !!userName && viaSheet(a);
    return `<label class="qc-row${picked.has(a.name) ? ' on' : ''}${sheet ? ' from-sheet' : ''}"
        data-name="${esc(a.name)}" data-team="${esc(teamKeyOf(a.team))}">
      <input type="checkbox" data-agent="${esc(a.name)}" ${picked.has(a.name) ? 'checked' : ''}>
      <span class="qc-row-name">${esc(a.name)}</span>
      <span class="qc-row-team">${esc(teamLabelOf(a))}</span>
      ${ext ? `<span class="qc-row-ext" dir="ltr">${esc(C.toFaDigits(ext))}</span>` : '<span class="qc-row-ext none">بدون داخلی</span>'}
      ${sheet ? '<span class="qc-row-tag" title="از ستون QC همین کارشناس QC روی تب Agents">شیت</span>' : ''}
    </label>`;
  }

  function renderTeams() {
    const box = $('#quTeams', m);
    if (!box) return;
    box.innerHTML = `<button type="button" class="qc-team-chip${activeTeams.size ? '' : ' sel'}" data-team="">همه تیم‌ها
        <b>${fa(state.agents.length)}</b></button>` +
      teamList.map((t) => `<button type="button" class="qc-team-chip${activeTeams.has(t.key) ? ' sel' : ''}"
        data-team="${esc(t.key)}">${esc(t.label)} <b>${fa(t.agents.length)}</b>
        ${selectedTeams.has(t.label) ? '<i class="fa-solid fa-people-group" title="کل تیم"></i>' : ''}</button>`).join('');
    $$('[data-team]', box).forEach((chip) => chip.addEventListener('click', () => {
      const key = chip.dataset.team;
      if (!key) activeTeams.clear();
      else if (activeTeams.has(key)) activeTeams.delete(key); else activeTeams.add(key);
      renderTeams(); renderList();
    }));
  }

  function renderList() {
    const list = $('#quList', m);
    if (!list) return;
    if (!state.agents.length) return;
    const rows = visibleAgents();
    list.innerHTML = rows.length ? rows.map(rowHtml).join('')
      : '<div class="qc-empty"><i class="fa-solid fa-magnifying-glass"></i> کارشناسی با این فیلتر پیدا نشد.</div>';
    $$('input[data-agent]', list).forEach((box) => box.addEventListener('change', () => {
      if (box.checked) picked.add(box.dataset.agent); else picked.delete(box.dataset.agent);
      box.closest('.qc-row').classList.toggle('on', box.checked);
      refreshCount();
    }));
    const visible = $('#quVisible', m);
    if (visible) visible.textContent = fa(rows.length) + ' از ' + fa(state.agents.length);
  }

  function refreshCount() {
    const off = unlimitedBox.checked || roleSel.value === 'admin';
    picker.classList.toggle('off', off);
    $('#quCount', m).textContent = off ? 'همه‌ی کارشناسان'
      : fa(picked.size) + ' کارشناس' + (selectedTeams.size ? ' + ' + fa(selectedTeams.size) + ' تیم کامل' : '');

    const box = $('#quPicked', m);
    if (box) box.innerHTML = off
      ? '<span class="qc-picked-empty">دسترسی نامحدود — همه‌ی کارشناسان</span>'
      : (picked.size
        ? [...picked].sort((x, y) => String(x).localeCompare(String(y), 'fa')).map((n) => `<span class="qc-chip">${esc(n)}<button type="button" data-unpick="${esc(n)}"
            title="برداشتن"><i class="fa-solid fa-xmark"></i></button></span>`).join('')
        : '<span class="qc-picked-empty">هنوز کارشناسی انتخاب نشده — از فهرست پایین تیک بزنید</span>');
    $$('[data-unpick]', m).forEach((b) => b.addEventListener('click', () => {
      picked.delete(b.dataset.unpick);
      const box2 = $$('input[data-agent]', m).find((c) => c.dataset.agent === b.dataset.unpick);
      if (box2) { box2.checked = false; box2.closest('.qc-row').classList.remove('on'); }
      refreshCount();
    }));

    $('#quHint', m).innerHTML = off
      ? '<i class="fa-solid fa-circle-info"></i> این کاربر همه‌ی کارشناسان را می‌بیند؛ برای او ستون‌های QC خالی می‌مانند.'
      : (picked.size || selectedTeams.size)
        ? '<i class="fa-solid fa-circle-check"></i> فقط ارزیابی‌های همین کارشناسان در داشبورد، گزارش‌ها و سوابق دیده می‌شود.'
        : '<i class="fa-solid fa-triangle-exclamation"></i> دسترسی خالی یعنی این کارشناس هیچ داده‌ای نمی‌بیند.';

    if (typeof paintSubsetCount === 'function' && $('#quSubCount', m)) paintSubsetCount();

    const scopeBtn = $('#quScope', m);
    if (scopeBtn) {
      const scopedNow = [...activeTeams].filter((key) => {
        const t = teamList.find((x) => x.key === key);
        return t && selectedTeams.has(t.label);
      });
      const allScoped = activeTeams.size > 0 && scopedNow.length === activeTeams.size;
      scopeBtn.classList.toggle('on', allScoped);
      scopeBtn.disabled = !activeTeams.size;
    }
  }

  /* --------------------------------------------------- زیرمجموعه‌ها (بند ۱)
   * زیرمجموعه‌ی هر کارشناس همان فیلد «subgroup» تب Agents است و از صفحه‌ی
   * «مدیریت کارشناسان» ویرایش می‌شود. این بخش فقط انتخاب را سریع می‌کند و
   * تنظیمات دستی قبلی (تیک‌های آزاد + داخلی‌های اضافه) دست‌نخورده می‌ماند. */
  const subgroupsOf = (a) => String((a && a.subgroup) || '').trim();
  const subList = [...new Set(state.agents.map(subgroupsOf).filter((x) => x && x !== '—'))]
    .sort((x, y) => x.localeCompare(y, 'fa'));

  function fillSubsetPickers() {
    const subSel = $('#quSubPick', m), teamSel = $('#quTeamPick', m);
    if (subSel) {
      subSel.innerHTML = '<option value="">همه‌ی زیرمجموعه‌ها</option>' + subList.map((name) => {
        const count = state.agents.filter((a) => subgroupsOf(a) === name).length;
        return `<option value="${esc(name)}">${esc(name)} (${fa(count)})</option>`;
      }).join('');
    }
    if (teamSel) {
      teamSel.innerHTML = '<option value="">همه‌ی تیم‌ها</option>' + teamList.map((t) =>
        `<option value="${esc(t.key)}">${esc(t.label)} (${fa(t.agents.length)})</option>`).join('');
    }
    paintSubsetCount();
  }

  function subsetTargets() {
    const subSel = $('#quSubPick', m), teamSel = $('#quTeamPick', m);
    const sub = subSel ? subSel.value : '';
    const team = teamSel ? teamSel.value : '';
    if (!sub && !team) return null;
    return state.agents.filter((a) => {
      if (sub && subgroupsOf(a) !== sub) return false;
      if (team && teamKeyOf(a.team) !== team) return false;
      return true;
    });
  }

  function paintSubsetCount() {
    const el = $('#quSubCount', m), hint = $('#quSubsetHint', m), btn = $('#quApplySubset', m);
    if (!el) return;
    const targets = subsetTargets();
    if (!targets) {
      el.textContent = '—';
      if (hint) hint.innerHTML = subList.length
        ? 'یک زیرمجموعه یا تیم انتخاب کنید؛ دکمه، همه‌ی کارشناسان همان گروه را تیک می‌زند.'
        : 'هنوز زیرمجموعه‌ای در «مدیریت کارشناسان» ثبت نشده — ستون «زیرمجموعه» را همان‌جا پر کنید.';
      if (btn) btn.disabled = true;
      return;
    }
    const withExt = targets.filter((a) => a.ext != null && a.ext !== '').length;
    el.textContent = fa(targets.length) + ' کارشناس';
    if (btn) btn.disabled = !targets.length;
    if (hint) {
      hint.innerHTML = targets.length
        ? `<i class="fa-solid fa-circle-info"></i> ${fa(withExt)} نفر داخلی ثبت‌شده دارند` +
          (withExt < targets.length ? ` و ${fa(targets.length - withExt)} نفر بدون داخلی‌اند (با نام ثبت می‌شوند).` : '.')
        : '<i class="fa-solid fa-triangle-exclamation"></i> برای این ترکیب کارشناسی پیدا نشد.';
    }
  }

  function applySubset() {
    const targets = subsetTargets();
    if (!targets || !targets.length) { toast('اول یک زیرمجموعه یا تیم انتخاب کنید', 'error'); return; }
    const replace = $('#quReplace', m).checked;
    if (replace) picked.clear();
    targets.forEach((a) => picked.add(a.name));
    /* داخلی‌های اضافه‌ی قبلی پاک نمی‌شوند؛ فقط زیرمجموعه اضافه/جایگزین می‌شود. */
    renderList();
    refreshCount();
    paintSubsetCount();
    const subSel = $('#quSubPick', m), teamSel = $('#quTeamPick', m);
    const teamOption = teamSel.selectedOptions && teamSel.selectedOptions[0];
    const label = subSel.value || (teamOption && teamOption.value ? teamOption.textContent.replace(/\s*\([^)]*\)\s*$/, '') : '');
    toast(fa(targets.length) + ' کارشناس' + (label ? ' از «' + label + '»' : '') +
      ' ست شد — داخلی‌ها خودکار از همان فهرست برداشته شدند', 'success');
  }

  fillSubsetPickers();
  $('#quSubPick', m).addEventListener('change', paintSubsetCount);
  $('#quTeamPick', m).addEventListener('change', paintSubsetCount);
  $('#quApplySubset', m).addEventListener('click', applySubset);

  renderTeams();
  renderList();
  refreshCount();

  $('#quShow', m).addEventListener('click', () => {
    const inp = $('#quPass', m);
    inp.type = inp.type === 'password' ? 'text' : 'password';
  });
  $('#quSearch', m).addEventListener('input', debounce(renderList, 90));
  $('#quExtraExt', m).addEventListener('input', debounce(refreshCount, 150));
  unlimitedBox.addEventListener('change', refreshCount);
  roleSel.addEventListener('change', () => { if (roleSel.value === 'admin') unlimitedBox.checked = true; refreshCount(); });
  $('#quAll', m).addEventListener('click', () => {
    visibleAgents().forEach((a) => picked.add(a.name));
    renderList(); refreshCount();
  });
  $('#quNone', m).addEventListener('click', () => {
    visibleAgents().forEach((a) => picked.delete(a.name));
    renderList(); refreshCount();
  });
  $('#quScope', m).addEventListener('click', () => {
    const teams = [...activeTeams].map((key) => teamList.find((t) => t.key === key)).filter(Boolean);
    const allScoped = teams.length > 0 && teams.every((t) => selectedTeams.has(t.label));
    teams.forEach((t) => { if (allScoped) selectedTeams.delete(t.label); else selectedTeams.add(t.label); });
    renderTeams(); refreshCount();
  });

  $('#quSave', m).addEventListener('click', async () => {
    const name = $('#quName', m).value.trim();
    const pass = $('#quPass', m).value;
    if (!name) { toast.error('نام کارشناس QC الزامی است'); return; }
    if (!editing && !pass) { toast.error('رمز اولیه الزامی است'); return; }
    if (pass && pass.length < (window.APP_SCRIPT_MODE ? 12 : 4)) { toast.error(window.APP_SCRIPT_MODE ? 'رمز باید حداقل ۱۲ نویسه باشد' : 'رمز باید حداقل ۴ نویسه باشد'); return; }
    const sel = collect();
    const role = roleSel.value;
    const off = role === 'admin' || unlimitedBox.checked;
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

}

function debounce(fn, ms) { let t; return function (...a) { clearTimeout(t); t = setTimeout(() => fn.apply(this, a), ms); }; }

App.register('qcadmin', { title: 'مدیریت QC', render });
})();
