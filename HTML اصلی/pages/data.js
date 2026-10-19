/* data.js — مرکز داده: آپلود فایل‌های QC، وضعیت داده‌ها، بک‌اپ/بازیابی، پاک‌سازی
 *
 * یک صفحه برای همه چیز که با دیتا سر و کار دارد:
 *   ۱) نمای کلی: چقدر تیکت/سوشال/تماس روی سیستم است؟
 *   ۲) آپلود اکسل QC تیم‌ها (Telesales/اکانت/MLM) — تشخیص خودکار نوع فرم
 *   ۳) بک‌اپ کامل (همه دیتا یا بازه‌دار) → فایل JSON
 *   ۴) بازیابی از فایل بک‌اپ JSON
 *   ۵) پاک‌سازی دیتای تماس کامل یا بازه‌دار
 */
(function () {
'use strict';
const { C, $, $$, api, fa, esc, toast, emptyState, debounce, confirmDlg } = UI;

const STANDALONE = location.protocol === 'file:';

function fmtSize(n) {
  if (n < 1024) return n + ' بایت';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / (1024 * 1024)).toFixed(2) + ' MB';
}

async function render(root) {
  root.innerHTML = `
  <div class="page-head">
    <div class="ph-ic"><i class="fa-solid fa-database"></i></div>
    <div>
      <h2>مرکز داده</h2>
      <p>آپلود اکسل‌های QC، وضعیت داده‌های سیستم، بک‌اپ و بازیابی — همه در یک صفحه</p>
    </div>
    <div class="spacer"></div>
    <button class="btn brand" id="btnRescan"><i class="fa-solid fa-rotate"></i> تازه‌سازی</button>
  </div>

  <!-- وضعیت فعلی داده‌ها -->
  <div class="card" style="margin-bottom:16px" id="statusCard">
    <div class="card-head">
      <div class="head-icon" style="background:rgba(56,189,248,.12);color:#38bdf8"><i class="fa-solid fa-chart-column"></i></div>
      <div><h3>وضعیت فعلی داده‌ها</h3><div class="sub" id="statusRange">رکوردهای بازه‌ی انتخاب‌شده، به تفکیک تیم</div></div>
    </div>
    <div class="card-pad">
      <div class="stat-grid" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(155px,1fr));gap:11px" id="statusGrid">
        <div class="loading-page" style="grid-column:1/-1"><div class="spinner"></div></div>
      </div>
      <div id="statusUndated"></div><div id="statusDiagnostics"></div>
    </div>
    <div class="table-wrap" id="statusTeams"></div>
  </div>

  <!-- آپلود اکسل ریت تماس -->
  <div class="card" style="margin-bottom:16px">
    <div class="card-head">
      <div class="head-icon" style="background:rgba(167,139,250,.12);color:#a78bfa"><i class="fa-solid fa-cloud-arrow-up"></i></div>
      <div>
        <h3>آپلود اکسل‌های ریت تماس</h3>
        <div class="sub">اکسل‌های QC Telesales / اکانت / MLM را اینجا رها کن — نوع فرم خودکار تشخیص داده می‌شود.</div>
      </div>
    </div>
    <div class="card-pad" style="display:flex;flex-direction:column;gap:12px">
      <div id="dropZone" style="border:2px dashed rgba(167,139,250,.35);border-radius:12px;padding:28px;text-align:center;color:var(--muted);font-size:13px;transition:.2s;cursor:pointer">
        <i class="fa-solid fa-cloud-arrow-up" style="font-size:30px;color:#a78bfa;display:block;margin-bottom:10px"></i>
        فایل‌های اکسل QC را اینجا رها کن یا <b style="color:#a78bfa">کلیک کن برای انتخاب</b>
        <div style="font-size:11px;margin-top:6px;color:var(--muted)">می‌توانی چند فایل را هم‌زمان انتخاب کنی (Ctrl + کلیک)</div>
      </div>
      <input type="file" id="qInp" accept=".xlsx,.xls,.csv" multiple hidden>
      <div id="upResult" style="display:none;font-size:12px;padding:9px 12px;border-radius:9px"></div>
      ${!STANDALONE ? `
      <div class="note" style="margin:0">
        <i class="fa-solid fa-circle-info"></i>
        <span><b>روش دوم (بدون آپلود):</b> فایل‌ها را مستقیم در پوشه‌ی <code style="direction:ltr">crm-qc/data/calls/</code> بگذار — سرور هر ۱۵ ثانیه خودکار جارو می‌کند.</span>
      </div>` : ''}
      <div class="field"><label>تیم مقصد برای نام‌های ثبت‌نشده (اختیاری)</label><select class="input" id="importTeam"><option value="">بر اساس مدیریت کارشناسان؛ بدون انتساب حدسی</option>${(App.state.teams||[]).map(team=>`<option value="${esc(team)}">${esc(QCParse.displayTeam(team))}</option>`).join('')}</select><small style="color:var(--muted)">فقط نام‌های ثبت‌نشده به این تیم منتسب می‌شوند؛ تیم کارشناسان شناخته‌شده از مدیریت خوانده می‌شود.</small></div>
      <div id="filesList" style="font-size:12px"></div>
    </div>
  </div>

  <!-- بک‌اپ و بازیابی -->
  <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(min(100%,430px),1fr));margin-bottom:16px">
    <div class="card">
      <div class="card-head">
        <div class="head-icon" style="background:rgba(52,211,153,.12);color:#34d399"><i class="fa-solid fa-file-import"></i></div>
        <div><h3>بک‌اپ کامل سامانه</h3><div class="sub">دانلود همه دیتا (تیکت، سوشال، تماس، کارشناس‌ها، تنظیمات) به‌صورت فایل JSON</div></div>
      </div>
      <div class="card-pad" style="display:flex;flex-direction:column;gap:12px">
        <div class="form-grid" style="grid-template-columns:1fr 1fr;gap:10px">
          <div class="field"><label>از تاریخ (اختیاری)</label>
            <div class="date-f"><input class="input" id="bupFrom" dir="ltr" style="text-align:right;padding-left:34px" inputmode="numeric" placeholder="۱۴۰۵/۰۱/۰۱">
              <button type="button" class="cal-btn" id="bupFromBtn" title="از تقویم"><i class="fa-regular fa-calendar"></i></button></div>
          </div>
          <div class="field"><label>تا تاریخ (اختیاری)</label>
            <div class="date-f"><input class="input" id="bupTo" dir="ltr" style="text-align:right;padding-left:34px" inputmode="numeric" placeholder="۱۴۰۵/۱۲/۲۹">
              <button type="button" class="cal-btn" id="bupToBtn" title="از تقویم"><i class="fa-regular fa-calendar"></i></button></div>
          </div>
        </div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><input class="input" id="backupYear" inputmode="numeric" dir="ltr" style="width:90px" value="${C.todayJalali().jy}" aria-label="سال بک اپ">
          <select class="input" id="backupMonth" style="width:125px" aria-label="ماه بک اپ">${C.MONTHS_FA.map((name,index)=>`<option value="${index+1}" ${index+1===C.todayJalali().jm?'selected':''}>${name}</option>`).join('')}</select>
          <button class="btn soft" id="backupMonthSet">انتخاب کل ماه</button><button class="btn ghost" id="backupUseGlobal">استفاده از بازه گزارش</button></div>
        <div class="note" style="margin:0"><i class="fa-solid fa-circle-info"></i> اگر تاریخ نزنی، کل دیتا دانلود می‌شود. با تاریخ فقط رکوردهای آن بازه.</div>
        <div style="display:flex;gap:9px;flex-wrap:wrap">
          <button class="btn success-soft" id="btnBackup"><i class="fa-solid fa-floppy-disk"></i> دانلود فایل بک‌اپ</button>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-head">
        <div class="head-icon" style="background:rgba(251,191,36,.12);color:#fbbf24"><i class="fa-solid fa-file-export"></i></div>
        <div><h3>بازیابی / ایمپورت دیتا</h3><div class="sub">فایل بک‌اپ JSON که قبلاً از همین‌جا دانلود کردی</div></div>
      </div>
      <div class="card-pad" style="display:flex;flex-direction:column;gap:12px">
        <div class="note" style="margin:0">
          <i class="fa-solid fa-circle-info"></i>
          <span>فایل <b>بک‌اپ کامل</b> سامانه را انتخاب کنید — کل دیتای مرکز (تیکت، سوشال، ریت تماس) با آن جایگزین یا ادغام می‌شود.</span>
        </div>
        <button class="btn soft" id="btnRestoreSel"><i class="fa-solid fa-file-arrow-up" style="color:#14b8a6"></i> انتخاب فایل بازیابی…</button>
        <input type="file" id="restoreInp" accept=".json,application/json" hidden>
        <div id="restoreResult" style="display:none;font-size:12px;padding:9px 12px;border-radius:9px"></div>
      </div>
    </div>
  </div>

  <!-- پاک‌سازی داده‌ها -->
  <div class="card" style="margin-bottom:0">
    <div class="card-head">
      <div class="head-icon" style="background:rgba(248,113,113,.12);color:#f87171"><i class="fa-solid fa-trash-can"></i></div>
      <div><h3>پاک‌سازی داده‌ها</h3><div class="sub">پاک کردن فایل‌های آپلودی (تماس) — بر اساس بازه یا کامل</div></div>
    </div>
    <div class="card-pad" style="display:flex;flex-direction:column;gap:12px">
      <div class="form-grid" style="grid-template-columns:1fr 1fr;gap:10px">
        <div class="field"><label>از تاریخ (اختیاری)</label>
          <div class="date-f"><input class="input" id="clrFrom" dir="ltr" style="text-align:right;padding-left:34px" inputmode="numeric" placeholder="۱۴۰۵/۰۷/۰۱">
            <button type="button" class="cal-btn" id="clrFromBtn" title="از تقویم"><i class="fa-regular fa-calendar"></i></button></div>
        </div>
        <div class="field"><label>تا تاریخ (اختیاری)</label>
          <div class="date-f"><input class="input" id="clrTo" dir="ltr" style="text-align:right;padding-left:34px" inputmode="numeric" placeholder="۱۴۰۵/۰۸/۳۰">
            <button type="button" class="cal-btn" id="clrToBtn" title="از تقویم"><i class="fa-regular fa-calendar"></i></button></div>
        </div>
      </div>
      <div class="note" style="margin:0"><i class="fa-solid fa-circle-info"></i> اگر تاریخ نزنی، کل دیتای تماس پاک می‌شود.</div>
      <div style="display:flex;gap:9px;flex-wrap:wrap">
        <button class="btn danger-soft" id="btnClearCalls"><i class="fa-solid fa-trash-can"></i> پاک کردن تاریخی دیتای تماس</button>
        <button class="btn danger-soft" id="btnClearCallsAll"><i class="fa-solid fa-ban"></i> پاک کردن کامل دیتای تماس</button>
      </div>
    </div>
  </div>
  `;

  /* ------- وضعیت کلی داده‌ها ------- */
  const grid = $('#statusGrid', root), teamTable = $('#statusTeams', root);
  let statusId = 0;
  async function loadStatus() {
    const request = ++statusId;
    if (!grid.isConnected) return;
    try {
      const [b, cm] = await Promise.all([api.get('/api/bootstrap'), api.get('/api/data/status')]);
      if (request !== statusId || !grid.isConnected) return;
      const callCounts = cm.byForm;
      $('#statusRange').textContent = App.dateRangeLabel() + ' · مبنا: تاریخ بررسی فرم';
      grid.innerHTML = `
        ${stat('تیکت‌های ارزیابی', fa(cm.tickets), '#38bdf8')}
        ${stat('سوشال‌های ارزیابی', fa(cm.socials), '#a78bfa')}
        ${stat('کارشناسان فعال', fa(b.agents.length), '#34d399')}
        ${stat('کارشناسان QC', fa(b.qcAgents.length), '#fbbf24')}
        ${stat('ریت‌های تماس', fa(cm.calls), 'var(--ink)')}
        ${stat('تیم‌ها', fa(cm.byTeam.length), '#ff7a59')}
      ` + (callCounts ? `
        <div style="grid-column:1/-1;background:var(--panel-soft);border-radius:10px;padding:10px 14px;display:flex;gap:14px;flex-wrap:wrap;font-size:12px">
          <span style="color:var(--muted)">تماس‌ها به تفکیک فرم:</span>
          <span>Telesales <b>${fa(callCounts.tele || 0)}</b></span>
          <span>اکانت <b>${fa(callCounts.account || 0)}</b></span>
          <span>MLM <b>${fa(callCounts.mlm || 0)}</b></span>
        </div>` : '');
      teamTable.innerHTML = `<table class="tbl"><thead><tr><th>تیم</th><th>تعداد ریت تیکت</th><th>تعداد ریت سوشال</th><th>تعداد ریت تماس</th><th>مجموع داده</th></tr></thead>
        <tbody>${cm.byTeam.map((t) => `<tr><td><span class="tag-team">${esc(t.team)}</span></td>
          <td>${fa(t.ticketCount)}</td><td>${fa(t.socialCount)}</td><td>${fa(t.callCount)}</td><td><b>${fa(t.totalCount)}</b></td></tr>`).join('')}</tbody></table>`;
      $('#statusDiagnostics',root).innerHTML = diagnosticsHTML(cm.diagnostics);
      const undated = cm.undated.tickets + cm.undated.socials + cm.undated.calls;
      $('#statusUndated').innerHTML = undated ? `<div class="note" style="margin:12px 0 0"><i class="fa-solid fa-circle-info"></i>
        ${fa(undated)} رکورد بدون تاریخ بررسی معتبر در سامانه وجود دارد (تیکت: ${fa(cm.undated.tickets)}، سوشال: ${fa(cm.undated.socials)}، تماس: ${fa(cm.undated.calls)}).
        این رکوردها در «همه تاریخ‌ها» دیده می‌شوند؛ به روز دلخواه نسبت داده نمی‌شوند.</div>` : '';
    } catch (e) {
      if (request !== statusId || !grid.isConnected) return;
      teamTable.innerHTML = '';
      grid.innerHTML = `<div class="empty" style="grid-column:1/-1"><i class="fa-solid fa-triangle-exclamation"></i> خطا: ${esc(e.message)}</div>`;
    }
  }
  function diagnosticsHTML(d) {
    if(!d || !(d.unknownExperts.length||d.teamConflicts.length||d.ambiguous))return '';
    return `<div class="diagnostics"><h4><i class="fa-solid fa-triangle-exclamation"></i> بررسی انتساب کارشناسان به تیم</h4>
      ${d.unknownExperts.length?`<p>${fa(d.unknownExperts.reduce((n,x)=>n+x.count,0))} ریت متعلق به نام‌هایی است که در مدیریت ثبت نشده‌اند. نوع فرم MLM به‌تنهایی تیم قطعیِ شخص نیست؛ اگر تیم مقصد مشخص نشده باشد «بدون تیم» می‌ماند.</p><ul>${d.unknownExperts.map(x=>`<li>${esc(x.name)} — ${fa(x.count)} ریت (${x.forms.map(f=>({tele:'Telesales',account:'Account',mlm:'MLM / BNPL'})[f]||f).join(' / ')})</li>`).join('')}</ul>`:''}
      ${d.teamConflicts.length?`<p>نوع فرم با تیم فعلی این کارشناسان متفاوت است؛ تیم مدیریت بدون تأیید شما عوض نمی‌شود:</p><ul>${d.teamConflicts.map(x=>`<li>${esc(x.name)} — تیم فعلی ${esc(QCParse.displayTeam(x.team))}، فرم ${esc(x.form)}؛ ${fa(x.count)} ریت</li>`).join('')}</ul>`:''}
      ${d.ambiguous?`<p>${fa(d.ambiguous)} تطبیق نام مبهم است و به شخص حدسی منتسب نشده.</p>`:''}<a class="btn soft sm" href="#/agents">بررسی و اصلاح مدیریت کارشناسان</a></div>`;
  }
  function stat(label, val, color) {
    return `<div style="background:var(--panel-soft);border:1px solid var(--line-soft);border-radius:10px;padding:13px 15px">
      <div style="font-size:11px;color:var(--muted);margin-bottom:5px">${label}</div>
      <div style="font-size:22px;font-weight:800;color:${color}">${val}</div></div>`;
  }

  /* ------- آپلود اکسل QC ------- */
  async function ingest(files) {
    const arr = [...files].filter((f) => /\.(xlsx|xls|csv)$/i.test(f.name));
    if (!arr.length) { toast.info('فقط فایل‌های .xlsx / .xls / .csv پذیرفته می‌شود'); return; }
    if (typeof XLSX === 'undefined') { toast.error('کتابخانه‌ی اکسل بارگذاری نشده — از سرور استفاده کنید'); return; }

    const resEl = $('#upResult');
    resEl.style.display = '';
    resEl.style.background = 'rgba(56,189,248,.08)'; resEl.style.color = '#38bdf8';
    resEl.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> در حال خواندن ${fa(arr.length)} فایل…`;

    const payload = [], errs = [];
    for (const f of arr) {
      try {
        const buf = await f.arrayBuffer();
        const wb = XLSX.read(buf, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws);
        if (!rows.length) { errs.push(f.name + ' (خالی)'); continue; }
        payload.push({ name: f.name, rows });
      } catch (e) { errs.push(f.name + ' (' + e.message + ')'); }
    }
    if (!payload.length) {
      resEl.style.background = 'rgba(248,113,113,.08)'; resEl.style.color = '#f87171';
      resEl.innerHTML = `<i class="fa-solid fa-circle-xmark"></i> هیچ فایلی خوانده نشد — ${esc(errs.join('، '))}`;
      return;
    }
    if(!root.isConnected)return;
    const mode = await UI.confirmImport('ورود اکسل ریت', payload.map(f=>f.name+' — '+f.rows.length+' ردیف').join(' | '), 'فقط دیتای فایل‌های هم‌نام انتخاب‌شده جایگزین می‌شود؛ سایر فایل‌ها و تیکت/سوشال محفوظ‌اند.');
    if(!mode){resEl.innerHTML='ورود فایل لغو شد؛ داده‌ای تغییر نکرد.';return;}
    try {
      const r = await api.post('/api/calls/files', { files: payload, mode, team: $('#importTeam',root).value });
      if(!root.isConnected)return;
      const okF = (r.results || []).filter((x) => x.ok);
      const badF = (r.results || []).filter((x) => !x.ok);
      const formFa = { tele: 'Telesales', account: 'اکانت', mlm: 'MLM' };
      resEl.style.background = 'rgba(52,211,153,.08)'; resEl.style.color = '#34d399';
      resEl.innerHTML = `<i class="fa-solid fa-circle-check"></i> آپلود موفق: ` +
        okF.map((x) => `${esc(x.name)} → ${fa(x.count)} ردیف ${formFa[x.type] || x.type}`).join(' | ');
      if (badF.length || errs.length) {
        resEl.innerHTML += `<div style="margin-top:7px;color:#fbbf24;font-size:11px"><i class="fa-solid fa-triangle-exclamation"></i> نادیده‌گرفته: ${esc([...badF.map((x) => x.name+' ('+(x.reason||'نامعتبر')+')'), ...errs].join('، '))}</div>`;
      }
      const added=okF.reduce((n,x)=>n+(x.changes?x.changes.added:x.count),0), duplicates=okF.reduce((n,x)=>n+(x.changes?x.changes.duplicates:0),0);
      toast.success(fa(added)+' ریت جدید وارد شد؛ '+fa(duplicates)+' ریت تکراری دوباره شمرده نشد');
      loadStatus(); App.refreshCounts(true);
      if (!STANDALONE) loadFiles();
    } catch (e) {
      resEl.style.background = 'rgba(248,113,113,.08)'; resEl.style.color = '#f87171';
      resEl.innerHTML = `<i class="fa-solid fa-circle-xmark"></i> خطا در آپلود: ${esc(e.message)}`;
    }
  }

  const drop = $('#dropZone');
  const inp = $('#qInp');
  drop.addEventListener('click', () => inp.click());
  ['dragover', 'dragenter'].forEach((ev) => drop.addEventListener(ev, (e) => {
    e.preventDefault(); drop.style.borderColor = '#a78bfa'; drop.style.background = 'rgba(167,139,250,.06)';
  }));
  ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => {
    e.preventDefault(); drop.style.borderColor = 'rgba(167,139,250,.35)'; drop.style.background = '';
  }));
  drop.addEventListener('drop', (e) => {
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) ingest(e.dataTransfer.files);
  });
  inp.addEventListener('change', () => {
    if (inp.files && inp.files.length) ingest(inp.files);
    inp.value = '';
  });

  /* ------- فایل‌های درون سیستم (سرور) ------- */
  async function loadFiles() {
    const fl = $('#filesList');
    if (!fl) return;
    try {
      const st = await api.get('/api/calls/dirstatus');
      const files = (st.files || []).filter((f) => !f.skipped && f.rows > 0);
      if (!files.length) {
        fl.innerHTML = `<div style="color:var(--muted);text-align:center;padding:8px 0"><i class="fa-solid fa-inbox"></i> هنوز فایلی سیستم نیست</div>`;
        return;
      }
      const formFa = { tele: 'Telesales', account: 'اکانت', mlm: 'MLM' };
      fl.innerHTML = `<div style="border-top:1px solid var(--line-soft);padding-top:10px;margin-top:10px">
        <div style="font-size:12px;color:var(--muted);margin-bottom:7px">فایل‌های منبع (تعداد ردیف کل فایل، مستقل از بازه‌ی گزارش):</div>
        <table class="tbl" style="font-size:12px;margin:0">
          <thead><tr><th>فایل</th><th>نوع فرم</th><th>ردیف‌ها</th><th>حجم</th></tr></thead>
          <tbody>${files.map((f) => `<tr>
            <td style="direction:ltr;text-align:left;max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"><i class="fa-solid fa-file-excel" style="color:#34d399"></i> ${esc(f.name)}</td>
            <td>${formFa[f.type] || f.type || '—'}</td>
            <td>${fa(f.rows)}</td>
            <td style="direction:ltr">${fmtSize(f.size)}</td>
          </tr>`).join('')}</tbody>
        </table></div>`;
    } catch (e) { fl.innerHTML = ''; }
  }

  /* ------- تقویم‌های بک‌اپ / پاک‌سازی ------- */
  JCal.attach($('#bupFromBtn'), { input:$('#bupFrom'), onPick(j) { $('#bupFrom').value = j ? C.formatJalali(j) : ''; } });
  JCal.attach($('#bupToBtn'), { input:$('#bupTo'), onPick(j) { $('#bupTo').value = j ? C.formatJalali(j) : ''; } });
  JCal.attach($('#clrFromBtn'), { input:$('#clrFrom'), onPick(j) { $('#clrFrom').value = j ? C.formatJalali(j) : ''; } });
  JCal.attach($('#clrToBtn'), { input:$('#clrTo'), onPick(j) { $('#clrTo').value = j ? C.formatJalali(j) : ''; } });

  $('#backupMonthSet',root).addEventListener('click',()=>{
    const range=C.jalaliMonthRange(Number(C.faToEn($('#backupYear',root).value)),Number($('#backupMonth',root).value));
    if(!range){toast.error('سال یا ماه نامعتبر است');return;} $('#bupFrom').value=C.formatJalali(range.from);$('#bupTo').value=C.formatJalali(range.to);
  });
  $('#backupUseGlobal',root).addEventListener('click',()=>{$('#bupFrom').value=App.dateRange.from;$('#bupTo').value=App.dateRange.to;});

  /* ------- بک‌اپ کامل ------- */
  $('#btnBackup').addEventListener('click', async () => {
    const b = $('#btnBackup'); b.disabled = true;
    try {
      const rawRange={from:$('#bupFrom').value.trim(),to:$('#bupTo').value.trim()};
      const error=QCReports.validateRange(rawRange);if(error)throw new Error(error);
      const fromJ=C.parseDate(rawRange.from),toJ=C.parseDate(rawRange.to);
      const from = fromJ ? C.formatJalali(fromJ) : '';
      const to = toJ ? C.formatJalali(toJ) : '';
      const qs = (from || to) ? '?from=' + encodeURIComponent(from) + '&to=' + encodeURIComponent(to) : '';
      const data = await api.get('/api/backup' + qs);
      const dateStr = (data.exportedAt || '').slice(0, 10).replace(/-/g, '');
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `crm-qc-backup-${from?from.replaceAll('/','-'):'all'}_${to?to.replaceAll('/','-'):dateStr}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(`بک‌اپ دانلود شد — ${fa(data.agents.length)} کارشناس / ${fa(data.tickets.length)} تیکت / ${fa(data.socials.length)} سوشال / ${fa((data.callFeedbacks || []).length)} تماس`);
    } catch (e) { toast.error(e.message); }
    b.disabled = false;
  });

  /* ------- بازیابی ------- */
  $('#btnRestoreSel').addEventListener('click', () => $('#restoreInp').click());
  $('#restoreInp').addEventListener('change', (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    const rd = new FileReader();
    rd.onload = async () => {
      try {
        const obj = JSON.parse(rd.result);
        const isBackup = obj.schema === 'crm-qc-backup';
        const isRecovery = obj.teleRawData || obj.accRawData || obj.mlmRawData;
        if (!isBackup && !isRecovery) throw new Error('این فایل بک‌اپ سامانه یا فایل بازیابی پنل ریت نیست');
        const resEl = $('#restoreResult');
        resEl.style.display = '';
        const summary=isBackup ? `${(obj.tickets||[]).length} تیکت، ${(obj.socials||[]).length} سوشال، ${(obj.callFeedbacks||[]).length} ریت تماس · بازه ${obj.range&&obj.range.from||'ابتدا'} تا ${obj.range&&obj.range.to||'انتها'}` : `${(obj.teleRawData||[]).length+(obj.accRawData||[]).length+(obj.mlmRawData||[]).length} ریت تماس`;
        const mode=await UI.confirmImport(isBackup?'ورود آرشیو / بک‌اپ':'ورود فایل ریت',summary,isBackup?'تمام دیتای فعلیِ تیکت، سوشال، تماس و فهرست کارشناسان/تنظیمات با محتویات این بک‌اپ جایگزین می‌شود.':'فقط ریت‌های منبع qc_recovery.json جایگزین می‌شوند؛ سایر منابع محفوظ‌اند.');
        if(!mode){resEl.textContent='عملیات لغو شد؛ دیتای فعلی تغییر نکرد.';return;}
        try {
          const r=isBackup?await api.post('/api/backup',{backup:obj,mode}):await api.post('/api/calls',{recovery:obj,mode});
          if(!root.isConnected)return;
          resEl.style.background='var(--good-soft)';resEl.style.color='var(--good)';
          resEl.textContent=isBackup?`${mode==='append'?'ادغام':'جایگزینی'} موفق — اکنون ${r.restored.tickets} تیکت، ${r.restored.socials} سوشال، ${r.restored.calls} ریت تماس و ${r.restored.agents} کارشناس موجود است.`:'ورود ریت با روش انتخاب‌شده انجام شد.';
          toast.success(mode==='append'?'داده اضافه شد؛ آرشیو قبلی محفوظ است':'داده با تأیید شما جایگزین شد');
          await App.boot();await loadStatus();if(!STANDALONE)loadFiles();
        } catch(error){resEl.style.color='var(--bad)';resEl.textContent='خطا: '+error.message;}

      } catch (ex) { toast.error(ex.message || 'فایل نامعتبر'); }
      e.target.value = '';
    };
    rd.readAsText(f, 'utf-8');
  });

  /* ------- پاک‌سازی تاریخی / کامل ------- */
  $('#btnClearCalls').addEventListener('click', () => {
    const rawRange={from:$('#clrFrom').value.trim(),to:$('#clrTo').value.trim()};
    const error=QCReports.validateRange(rawRange);if(error){toast.error(error);return;}
    const fromJ=C.parseDate(rawRange.from),toJ=C.parseDate(rawRange.to);
    if (!fromJ && !toJ) { toast.info('حداقل یک تاریخ را انتخاب کنید، یا دکمه «پاک کردن کامل» را بزنید'); return; }
    const from = fromJ ? C.formatJalali(fromJ) : '';
    const to = toJ ? C.formatJalali(toJ) : '';
    confirmDlg('پاک‌سازی بازه‌دار دیتای تماس',
      `ردیف‌هایی که تاریخ بررسی آنان بین ${from ? esc(fa(from)) : 'شروع'} و ${to ? esc(fa(to)) : 'پایان'} است پاک می‌شود. فایل‌های آپلودی در پوشه باقی می‌مانند و سرور دوباره جارو می‌کند.`,
      async () => {
        try {
          const qs = '?from=' + encodeURIComponent(from) + '&to=' + encodeURIComponent(to);
          const r = await api.del('/api/calls' + qs);
          toast.success(`${fa(r.removed || 0)} ردیف پاک شد`);
          loadStatus();
          if (!STANDALONE) loadFiles();
        } catch (e) { toast.error(e.message); }
      },
      'بله، پاک شود'
    );
  });

  $('#btnClearCallsAll').addEventListener('click', () => {
    confirmDlg('پاک‌سازی کامل دیتای تماس',
      'همه ردیف‌های ریت تماس (Telesales، اکانت، MLM) برای همیشه پاک می‌شود. فایل‌های آپلودی در پوشه می‌مانند و با بازخوانی بعدی سرور دوباره آمده‌اند.',
      async () => {
        try {
          const r = await api.del('/api/calls');
          toast.success(`پاک شد — ${fa(r.removed || 0)} ردیف`);
          loadStatus();
          if (!STANDALONE) loadFiles();
        } catch (e) { toast.error(e.message); }
      },
      'بله، پاک شود'
    );
  });

  $('#btnRescan').addEventListener('click', () => { loadStatus(); if (!STANDALONE) loadFiles(); toast.info('تازه‌سازی شد'); });

  App.onDateRangeChange(loadStatus);
  await loadStatus();
  if (!STANDALONE) await loadFiles();
}

App.register('data', { title: 'مرکز داده', render });
})();
