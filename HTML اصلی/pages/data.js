/* data.js — مرکز داده: آپلود فایل‌های QC، وضعیت داده‌ها، بک‌اپ/بازیابی، پاک‌سازی
 *
 * یک صفحه برای همه چیز که با دیتا سر و کار دارد:
 *   ۱) نمای کلی: چقدر تیکت/سوشال/تماس روی سیستم است؟
 *   ۲) آپلود اکسل QC تیم‌ها (تلفنی/اکانت/MLM) — تشخیص خودکار نوع فرم
 *   ۳) بک‌اپ کامل (همه دیتا یا بازه‌دار) → فایل JSON
 *   ۴) بازیابی از فایل بک‌اپ / qc_recovery.json
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
      <div><h3>وضعیت فعلی داده‌ها</h3><div class="sub">تعداد کلی رکوردهای ذخیره‌شده در سیستم</div></div>
    </div>
    <div class="card-pad">
      <div class="stat-grid" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(155px,1fr));gap:11px" id="statusGrid">
        <div class="loading-page" style="grid-column:1/-1"><div class="spinner"></div></div>
      </div>
    </div>
  </div>

  <!-- آپلود اکسل فیدبک تماس -->
  <div class="card" style="margin-bottom:16px">
    <div class="card-head">
      <div class="head-icon" style="background:rgba(167,139,250,.12);color:#a78bfa"><i class="fa-solid fa-cloud-arrow-up"></i></div>
      <div>
        <h3>آپلود اکسل‌های فیدبک تماس</h3>
        <div class="sub">اکسل‌های QC تلفنی / اکانت / MLM را اینجا رها کن — نوع فرم خودکار تشخیص داده می‌شود.</div>
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
      <div id="filesList" style="font-size:12px"></div>
    </div>
  </div>

  <!-- بک‌اپ و بازیابی -->
  <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(430px,1fr));margin-bottom:16px">
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
        <div class="note" style="margin:0"><i class="fa-solid fa-circle-info"></i> اگر تاریخ نزنی، کل دیتا دانلود می‌شود. با تاریخ فقط رکوردهای آن بازه.</div>
        <div style="display:flex;gap:9px;flex-wrap:wrap">
          <button class="btn success-soft" id="btnBackup"><i class="fa-solid fa-floppy-disk"></i> دانلود فایل بک‌اپ</button>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-head">
        <div class="head-icon" style="background:rgba(251,191,36,.12);color:#fbbf24"><i class="fa-solid fa-file-export"></i></div>
        <div><h3>بازیابی / ایمپورت دیتا</h3><div class="sub">فایل بک‌اپ JSON (که قبلاً دانلود کردی) یا فایل qc_recovery.json از پنل فیدبک</div></div>
      </div>
      <div class="card-pad" style="display:flex;flex-direction:column;gap:12px">
        <div class="note" style="margin:0">
          <i class="fa-solid fa-circle-info"></i>
          <span>نوع فایل خودکار تشخیص داده می‌شود: فایل <b>بک‌اپ کامل</b> کل دیتا را جایگزین می‌کند، فایل <b>qc_recovery.json</b> فقط دیتای فیدبک تماس را می‌آورد.</span>
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
  async function loadStatus() {
    const grid = $('#statusGrid');
    try {
      const b = await api.get('/api/bootstrap');
      const cm = b.counts;
      const callCounts = cm.callMeta ? cm.callMeta.counts : null;
      grid.innerHTML = `
        ${stat('تیکت‌های ارزیابی', fa(cm.tickets), '#38bdf8')}
        ${stat('سوشال‌های ارزیابی', fa(cm.socials), '#a78bfa')}
        ${stat('کارشناسان فعال', fa(b.agents.length), '#34d399')}
        ${stat('کارشناسان QC', fa(b.qcAgents.length), '#fbbf24')}
        ${stat('تماس‌ها (فیدبک)', fa(cm.calls), '#fff')}
        ${stat('تیم‌ها', fa(b.teams.length), '#ff7a59')}
      ` + (callCounts ? `
        <div style="grid-column:1/-1;background:var(--panel-soft);border-radius:10px;padding:10px 14px;display:flex;gap:14px;flex-wrap:wrap;font-size:12px">
          <span style="color:var(--muted)">تماس‌ها به تفکیک فرم:</span>
          <span>تلفنی <b>${fa(callCounts.tele || 0)}</b></span>
          <span>اکانت <b>${fa(callCounts.account || 0)}</b></span>
          <span>MLM <b>${fa(callCounts.mlm || 0)}</b></span>
        </div>` : '');
    } catch (e) {
      grid.innerHTML = `<div class="empty" style="grid-column:1/-1"><i class="fa-solid fa-triangle-exclamation"></i> خطا: ${esc(e.message)}</div>`;
    }
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
      resEl.innerHTML = `<i class="fa-solid fa-circle-xmark"></i> هیچ فایلی خوانده نشد — ${errs.join('، ')}`;
      return;
    }
    try {
      const r = await api.post('/api/calls/files', { files: payload });
      const okF = (r.results || []).filter((x) => x.ok);
      const badF = (r.results || []).filter((x) => !x.ok);
      const formFa = { tele: 'تلفنی', account: 'اکانت', mlm: 'MLM' };
      resEl.style.background = 'rgba(52,211,153,.08)'; resEl.style.color = '#34d399';
      resEl.innerHTML = `<i class="fa-solid fa-circle-check"></i> آپلود موفق: ` +
        okF.map((x) => `${esc(x.name)} → ${fa(x.count)} ردیف ${formFa[x.type] || x.type}`).join(' | ');
      if (badF.length || errs.length) {
        resEl.innerHTML += `<div style="margin-top:7px;color:#fbbf24;font-size:11px"><i class="fa-solid fa-triangle-exclamation"></i> نادیده‌گرفته: ${[...badF.map((x) => x.name), ...errs].join('، ')}</div>`;
      }
      toast.success(`${fa((r.counts || {}).total || 0)} تماس وارد سیستم شد`);
      loadStatus();
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
      const formFa = { tele: 'تلفنی', account: 'اکانت', mlm: 'MLM' };
      fl.innerHTML = `<div style="border-top:1px solid var(--line-soft);padding-top:10px;margin-top:10px">
        <div style="font-size:12px;color:var(--muted);margin-bottom:7px">فایل‌های آپلود‌شده:</div>
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
  JCal.attach($('#bupFromBtn'), { onPick(j) { $('#bupFrom').value = j ? C.formatJalali(j) : ''; } });
  JCal.attach($('#bupToBtn'), { onPick(j) { $('#bupTo').value = j ? C.formatJalali(j) : ''; } });
  JCal.attach($('#clrFromBtn'), { onPick(j) { $('#clrFrom').value = j ? C.formatJalali(j) : ''; } });
  JCal.attach($('#clrToBtn'), { onPick(j) { $('#clrTo').value = j ? C.formatJalali(j) : ''; } });

  /* ------- بک‌اپ کامل ------- */
  $('#btnBackup').addEventListener('click', async () => {
    const b = $('#btnBackup'); b.disabled = true;
    try {
      const fromJ = C.parseJalali($('#bupFrom').value.trim());
      const toJ = C.parseJalali($('#bupTo').value.trim());
      const from = fromJ ? C.formatJalali(fromJ) : '';
      const to = toJ ? C.formatJalali(toJ) : '';
      const qs = (from || to) ? '?from=' + encodeURIComponent(from) + '&to=' + encodeURIComponent(to) : '';
      const data = await api.get('/api/backup' + qs);
      const dateStr = (data.exportedAt || '').slice(0, 10).replace(/-/g, '');
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `crm-qc-backup-${dateStr}.json`;
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
        if (!isBackup && !isRecovery) throw new Error('این فایل بک‌اپ سامانه یا فایل بازیابی پنل فیدبک نیست');
        const resEl = $('#restoreResult');
        resEl.style.display = '';
        confirmDlg(
          isBackup ? 'بازیابی بک‌اپ کامل' : 'ایمپورت فایل پنل فیدبک',
          isBackup
            ? `کل دیتا (تیکت، سوشال، تماس، کارشناس‌ها، تنظیمات) با این فایل جایگزین می‌شود. از ادامه مطمئنی؟`
            : `فایل بازیابی پنل فیدبک وارد می‌شود: ${fa((obj.teleRawData || []).length + (obj.accRawData || []).length + (obj.mlmRawData || []).length)} ردیف. از ادامه مطمئنی؟`,
          async () => {
            try {
              if (isBackup) {
                const r = await api.post('/api/backup', { backup: obj });
                resEl.style.background = 'rgba(52,211,153,.08)'; resEl.style.color = '#34d399';
                resEl.innerHTML = `<i class="fa-solid fa-circle-check"></i> بازیابی موفق — ${fa(r.restored.agents)} کارشناس، ${fa(r.restored.tickets)} تیکت، ${fa(r.restored.socials)} سوشال، ${fa(r.restored.calls)} تماس`;
                toast.success('بک‌اپ بازیابی شد');
                await App.boot();
                loadStatus();
                if (!STANDALONE) loadFiles();
              } else {
                const r = await api.post('/api/calls', { recovery: obj });
                resEl.style.background = 'rgba(52,211,153,.08)'; resEl.style.color = '#34d399';
                resEl.innerHTML = `<i class="fa-solid fa-circle-check"></i> ایمپورت موفق — تلفنی ${fa(r.counts.tele)} / اکانت ${fa(r.counts.account)} / MLM ${fa(r.counts.mlm)}`;
                toast.success('دیتای فیدبک وارد شد');
                loadStatus();
                if (!STANDALONE) loadFiles();
              }
            } catch (e) {
              resEl.style.background = 'rgba(248,113,113,.08)'; resEl.style.color = '#f87171';
              resEl.innerHTML = `<i class="fa-solid fa-circle-xmark"></i> خطا: ${esc(e.message)}`;
            }
          },
          'بله، ادامه بده'
        );
      } catch (ex) { toast.error(ex.message || 'فایل نامعتبر'); }
      e.target.value = '';
    };
    rd.readAsText(f, 'utf-8');
  });

  /* ------- پاک‌سازی تاریخی / کامل ------- */
  $('#btnClearCalls').addEventListener('click', () => {
    const fromJ = C.parseJalali($('#clrFrom').value.trim());
    const toJ = C.parseJalali($('#clrTo').value.trim());
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
      'همه ردیف‌های فیدبک تماس (تلفنی، اکانت، MLM) برای همیشه پاک می‌شود. فایل‌های آپلودی در پوشه می‌مانند و با بازخوانی بعدی سرور دوباره آمده‌اند.',
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

  loadStatus();
  if (!STANDALONE) loadFiles();
}

App.register('data', { title: 'مرکز داده', render });
})();
