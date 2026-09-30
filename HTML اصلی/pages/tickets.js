/* tickets.js — بخش ارزیابی تیکت: فرم ثبت/ویرایش + سوابق */
(function () {
'use strict';
const { C, $, $$, api, fa, esc, el, toast, modal, modalHead, confirmDlg, dateField, combo, triSwitch, redlineSwitch, selectField, scorePill, markBadge, pager, emptyState, debounce } = UI;

const CRITERIA = [
  { key: 'q1', icon: 'fa-magnifying-glass-chart', title: 'پیگیری صحیح و رسیدگی تا مشخص‌شدن نتیجه' },
  { key: 'q2', icon: 'fa-note-sticky', title: 'ثبت کامل یادداشت در پارس‌لاجیک' },
  { key: 'q3', icon: 'fa-circle-check', title: 'انتخاب صحیح دلیل بستن تیکت' },
  { key: 'q4', icon: 'fa-bolt', title: 'ثبت صحیح اکشن در CRM' }
];

/* ---------------------------------------------------------- فرم ثبت/ویرایش */
async function formPage(root, editId) {
  const st = App.state;
  let rec = null;
  if (editId) {
    root.innerHTML = `<div class="loading-page"><div class="spinner"></div></div>`;
    try { rec = await api.get('/api/tickets/' + editId); }
    catch (e) { root.innerHTML = `<div class="card">${emptyState('fa-circle-question', 'رکورد یافت نشد', e.message, '<a class="btn ghost" href="#/tickets">بازگشت به لیست</a>')}</div>`; return; }
  }
  const W = st.settings.ticketWeights;

  root.innerHTML = `
    <div class="page-head">
      <div class="ph-ic"><i class="fa-solid fa-ticket"></i></div>
      <div><h2>${editId ? 'ویرایش ارزیابی تیکت #' + fa(editId) : 'ثبت ارزیابی تیکت'}</h2>
      <p>نمره بر اساس وزن المان‌ها محاسبه می‌شود؛ المان «نامرتبط» از مخرج حذف می‌شود — ردلاین، نمره را صفر می‌کند.</p></div>
    </div>
    <div class="grid" style="grid-template-columns:minmax(0,1fr) 320px;align-items:start" id="grid">
      <div style="display:flex;flex-direction:column;gap:16px;min-width:0">
        <div class="card">
          <div class="card-head"><div class="head-icon"><i class="fa-solid fa-circle-info"></i></div><h3>اطلاعات پایه</h3></div>
          <div class="card-pad"><div class="form-grid" id="baseGrid"></div></div>
        </div>
        <div class="card">
          <div class="card-head"><div class="head-icon"><i class="fa-solid fa-list-check"></i></div><div><h3>المان‌های ارزیابی</h3><div class="sub">معادل ستون‌های G تا K فایل اکسل تیکت</div></div></div>
          <div class="card-pad">
            <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(270px,1fr))" id="critGrid"></div>
            <div id="rlSlot" style="margin-top:14px"></div>
          </div>
        </div>
        <div class="card">
          <div class="card-head"><div class="head-icon"><i class="fa-regular fa-comment-dots"></i></div><h3>کامنت کنترل کیفیت</h3></div>
          <div class="card-pad"><textarea class="input" id="comment" rows="3" placeholder="توضیحات ارزیاب برای کارشناس / سرپرست…">${esc(rec ? rec.comment || '' : '')}</textarea></div>
        </div>
      </div>

      <div style="position:sticky;top:calc(var(--topbar-h) + 16px);display:flex;flex-direction:column;gap:16px;min-width:0">
        <div class="score-live card-pad" style="flex-direction:column;align-items:center;text-align:center;gap:13px;padding:22px">
          <div class="donut" id="donut"><div class="num"><div><span id="scoreNum">؟</span><small>از ۱۰۰</small></div></div></div>
          <div class="meta" id="scoreMeta" style="align-items:center"></div>
          <button class="btn primary" id="save" style="width:100%"><i class="fa-solid fa-floppy-disk"></i>${editId ? 'ذخیره تغییرات' : 'ثبت ارزیابی'}</button>
          ${editId ? '<a class="btn ghost" href="#/tickets" style="width:100%"><i class="fa-solid fa-arrow-right"></i>بازگشت به لیست</a>' : '<a class="btn ghost" href="#/tickets" style="width:100%"><i class="fa-solid fa-list"></i>مشاهده سوابق</a>'}
        </div>
        <div class="card card-pad" style="font-size:12px;color:var(--muted);line-height:2">
          <b style="color:var(--ink-2)"><i class="fa-solid fa-scale-balanced" style="color:var(--brand)"></i> فرمول نمره‌دهی</b><br>
          نمره = (مجموع وزن المان‌های رعایت‌شده ÷ مجموع وزن المان‌های قابل‌سنجش) × ۱۰۰<br>
          وزن‌ها: ${CRITERIA.map((c, i) => 'المان ' + fa(i + 1) + ': ' + fa(W[i])).join('، ')}<br>
          ردلاین = ۰ ⇒ نمره نهایی ۰
        </div>
      </div>
    </div>`;

  // رسپانسیو: ستون کناری در موبایل زیر فرم
  const grid = $('#grid');
  const fit = () => { grid.style.gridTemplateColumns = window.innerWidth < 1100 ? '1fr' : 'minmax(0,1fr) 320px'; };
  fit(); window.addEventListener('resize', fit);

  // --- فیلدهای پایه
  const base = $('#baseGrid');
  const fQc = selectField({ label: 'کارشناس کنترل کیفیت', required: true, items: st.qcAgents, value: undefined });
  const fReview = dateField({ label: 'تاریخ بررسی', name: 'reviewDate', required: true, value: rec ? rec.reviewDate : C.formatJalali(C.todayJalali()) });
  const fTicketDate = dateField({ label: 'تاریخ ایجاد تیکت', name: 'ticketDate', required: true, value: rec ? rec.ticketDate : '' });
  const fAgent = combo({ label: 'نام کارشناس', required: true, items: App.agentComboItems(), value: rec ? rec.agentName : '', placeholder: 'جستجوی نام کارشناس…', onPick: () => setTimeout(syncTeam, 0) });
  const fTeam = el(`<div class="field"><label>تیم کارشناس <span class="hint">(خودکار)</span></label><input class="input" readonly tabindex="-1" style="opacity:.75;cursor:not-allowed" placeholder="—"></div>`);
  const fCode = el(`<div class="field"><label>کد یکتای تیکت <span class="req">*</span></label><input class="input" dir="ltr" style="text-align:right" inputmode="numeric" placeholder="مثلاً 52418" value="${esc(rec ? rec.ticketCode : '')}"></div>`);
  [fQc, fReview, fTicketDate, fAgent, fTeam, fCode].forEach((f) => base.appendChild(f));
  if (rec) fQc.setValue(rec.qcAgent);

  const teamInp = $('input', fTeam);
  const syncTeam = () => { teamInp.value = App.teamOf(fAgent.getValue()) || (rec ? rec.team : ''); };
  fAgent.addEventListener('input', debounce(syncTeam, 200));
  $('input', fAgent).addEventListener('blur', debounce(syncTeam, 120));
  syncTeam();

  // --- المان‌ها
  const critGrid = $('#critGrid');
  const tris = {};
  CRITERIA.forEach((c, i) => {
    const card = el(`<div class="criteria-card">
      <div class="c-top"><div class="c-ic"><i class="fa-solid ${c.icon}"></i></div>
        <div class="c-title">${c.title}</div><span class="c-weight">وزن ${fa(W[i])}</span></div>
      <div data-slot></div></div>`);
    const tri = triSwitch({ name: c.key, value: rec ? rec[c.key] : '', onChange: calc });
    $('[data-slot]', card).appendChild(tri);
    tris[c.key] = tri;
    critGrid.appendChild(card);
  });
  const rl = redlineSwitch({ value: rec ? String(rec.redline) : '', onChange: calc });
  $('#rlSlot').appendChild(rl);

  // --- محاسبه زنده
  const donut = $('#donut'), scoreNum = $('#scoreNum'), scoreMeta = $('#scoreMeta');
  function calc() {
    const vals = CRITERIA.map((c) => tris[c.key].getValue());
    const score = C.ticketScore(vals[0], vals[1], vals[2], vals[3], rl.getValue(), W);
    if (score === '') {
      donut.style.setProperty('--p', 0); donut.style.setProperty('--c', 'var(--brand)');
      scoreNum.textContent = '؟';
      scoreMeta.innerHTML = `<div class="row"><i class="fa-solid fa-hourglass-half" style="color:var(--warn)"></i> همه المان‌ها و ردلاین را مشخص کنید</div>`;
    } else {
      const p = Math.max(2, score);
      donut.style.setProperty('--p', p);
      donut.style.setProperty('--c', score >= 90 ? 'var(--good)' : score >= 75 ? 'var(--brand)' : score >= 50 ? 'var(--warn)' : 'var(--bad)');
      scoreNum.textContent = fa(score);
      const na = vals.filter((v) => v === '-').length;
      scoreMeta.innerHTML = `
        ${String(rl.getValue()) === '0' ? '<div class="row" style="color:var(--bad)"><i class="fa-solid fa-ban"></i> ردلاین فعال — نمره صفر شد</div>' : ''}
        <div class="row"><i class="fa-solid fa-check-double" style="color:var(--good)"></i> ${fa(vals.filter((v) => v === '1').length)} المان رعایت شده</div>
        <div class="row"><i class="fa-solid fa-xmark" style="color:var(--bad)"></i> ${fa(vals.filter((v) => v === '0').length)} المان عدم رعایت</div>
        ${na ? `<div class="row"><i class="fa-solid fa-minus" style="color:var(--warn)"></i> ${fa(na)} المان نامرتبط (از مخرج حذف شد)</div>` : ''}`;
    }
    return score;
  }
  calc();

  // --- ذخیره
  const saveBtn = $('#save');
  saveBtn.addEventListener('click', async () => {
    const payload = {
      qcAgent: fQc.getValue(),
      reviewDate: fReview.getValue(),
      ticketDate: fTicketDate.getValue(),
      agentName: fAgent.getValue(),
      ticketCode: $('input', fCode).value.trim(),
      q1: tris.q1.getValue(), q2: tris.q2.getValue(), q3: tris.q3.getValue(), q4: tris.q4.getValue(),
      redline: rl.getValue(),
      comment: $('#comment').value.trim()
    };
    saveBtn.disabled = true;
    saveBtn.innerHTML = '<i class="fa-solid fa-circle-notch spin"></i> در حال ذخیره…';
    try {
      const saved = editId ? await api.put('/api/tickets/' + editId, payload) : await api.post('/api/tickets', payload);
      toast(editId ? 'تغییرات ذخیره شد — نمره: ' + fa(saved.score == null ? '—' : saved.score) : 'ارزیابی با نمره ' + fa(saved.score == null ? '—' : saved.score) + ' ثبت شد', 'success');
      await App.boot();
      location.hash = '#/tickets';
    } catch (e) {
      toast(e.message, 'error', 5200);
      saveBtn.disabled = false;
      saveBtn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> ' + (editId ? 'ذخیره تغییرات' : 'ثبت ارزیابی');
    }
  });
}

/* ----------------------------------------------------------------- لیست */
async function listPage(root) {
  const st = App.state;
  const F = { page: 1 };

  root.innerHTML = `
    <div class="page-head">
      <div class="ph-ic"><i class="fa-solid fa-list-check"></i></div>
      <div><h2>سوابق ارزیابی تیکت</h2><p>جستجو، فیلتر، ویرایش و خروجی اکسل با ساختار فایل مرجع</p></div>
      <div class="spacer"></div>
      <a class="btn primary" href="#/tickets/new"><i class="fa-solid fa-plus"></i> ثبت ارزیابی جدید</a>
    </div>
    <div class="card">
      <div class="filters" id="filters"></div>
      <div class="table-wrap" id="tblWrap"><div class="loading-page"><div class="spinner"></div></div></div>
      <div class="pager" id="pager"></div>
    </div>`;

  // فیلترها
  const filters = $('#filters');
  const mk = (html) => { const d = el(html); filters.appendChild(d); return d; };
  const fSearch = mk(`<div class="field" style="flex:2"><label>جستجو</label><input class="input" placeholder="نام کارشناس، کد تیکت، کامنت…"></div>`);
  const fTeam = mk(`<div class="field"><label>تیم</label><select class="input"><option value="">همه تیم‌ها</option>${st.teams.map((t) => `<option>${esc(t)}</option>`).join('')}</select></div>`);
  const fQc = mk(`<div class="field"><label>کارشناس QC</label><select class="input"><option value="">همه</option>${st.qcAgents.map((t) => `<option>${esc(t)}</option>`).join('')}</select></div>`);
  const fFrom = mk(`<div class="field"><label>از تاریخ بررسی</label>
    <div class="date-f"><input class="input" dir="ltr" style="text-align:right;padding-left:34px" placeholder="14xx/mm/dd" inputmode="numeric">
      <button type="button" class="cal-btn" title="تقویم"><i class="fa-regular fa-calendar"></i></button></div></div>`);
  const fTo = mk(`<div class="field"><label>تا تاریخ بررسی</label>
    <div class="date-f"><input class="input" dir="ltr" style="text-align:right;padding-left:34px" placeholder="14xx/mm/dd" inputmode="numeric">
      <button type="button" class="cal-btn" title="تقویم"><i class="fa-regular fa-calendar"></i></button></div></div>`);
  const btnXls = mk(`<div class="field grow-0"><label>&nbsp;</label><button class="btn success-soft"><i class="fa-solid fa-file-excel"></i> خروجی اکسل</button></div>`);
  const btnReset = mk(`<div class="field grow-0"><label>&nbsp;</label><button class="btn ghost"><i class="fa-solid fa-rotate-right"></i> پاک‌سازی</button></div>`);

  function query() {
    const p = new URLSearchParams();
    if ($('input', fSearch).value.trim()) p.set('search', $('input', fSearch).value.trim());
    if ($('select', fTeam).value) p.set('team', $('select', fTeam).value);
    if ($('select', fQc).value) p.set('qc', $('select', fQc).value);
    const jf = C.parseJalali($('input', fFrom).value), jt = C.parseJalali($('input', fTo).value);
    if (jf) p.set('from', C.formatJalali(jf));
    if (jt) p.set('to', C.formatJalali(jt));
    p.set('page', F.page); p.set('per', 15);
    return p.toString();
  }

  async function load() {
    const wrap = $('#tblWrap');
    wrap.innerHTML = `<div class="loading-page"><div class="spinner"></div></div>`;
    let data;
    try { data = await api.get('/api/tickets?' + query()); }
    catch (e) { wrap.innerHTML = emptyState('fa-triangle-exclamation', 'خطا', e.message); return; }

    if (!data.rows.length) {
      wrap.innerHTML = emptyState('fa-ticket', 'رکوردی یافت نشد', 'فیلترها را تغییر دهید یا ارزیابی جدیدی ثبت کنید.', `<a class="btn primary sm" href="#/tickets/new"><i class="fa-solid fa-plus"></i>ثبت ارزیابی</a>`);
      $('#pager').innerHTML = '';
      return;
    }
    wrap.innerHTML = `<table class="tbl"><thead><tr>
      <th>#</th><th>QC</th><th>تاریخ بررسی</th><th>تاریخ تیکت</th><th>کارشناس</th><th>تیم</th><th>کد تیکت</th>
      <th title="پیگیری صحیح">پیگیری</th><th title="ثبت یادداشت">یادداشت</th><th title="دلیل بستن">دلیل بستن</th><th title="اکشن CRM">اکشن</th>
      <th title="عدم تماس با شریک — ردلاین">ردلاین</th><th>نمره</th><th style="width:120px"></th></tr></thead>
    <tbody>
      ${data.rows.map((t) => `<tr data-id="${t.id}">
        <td style="color:var(--muted)">${fa(t.id)}</td>
        <td>${esc(t.qcAgent)}</td>
        <td>${fa(t.reviewDate)}</td>
        <td>${fa(t.ticketDate)}</td>
        <td class="cell-main">${esc(t.agentName)}</td>
        <td><span class="tag-team">${esc(t.team)}</span></td>
        <td>${esc(t.ticketCode)}</td>
        <td>${markBadge(t.q1)}</td><td>${markBadge(t.q2)}</td><td>${markBadge(t.q3)}</td><td>${markBadge(t.q4)}</td>
        <td>${String(t.redline) === '0' ? '<span class="badge bad"><i class="fa-solid fa-ban"></i>تماس‌گرفته</span>' : '<span class="badge good"><i class="fa-solid fa-check"></i>سالم</span>'}</td>
        <td>${scorePill(t.score)}</td>
        <td>
          <button class="btn ghost sm icon" data-act="view" title="مشاهده"><i class="fa-solid fa-eye"></i></button>
          <button class="btn soft sm icon" data-act="edit" title="ویرایش"><i class="fa-solid fa-pen"></i></button>
          <button class="btn danger-soft sm icon" data-act="del" title="حذف"><i class="fa-solid fa-trash"></i></button>
        </td></tr>`).join('')}
    </tbody></table>`;

    pager($('#pager'), data, (p) => { F.page = p; load(); });

    $$('button[data-act]', wrap).forEach((b) => b.addEventListener('click', async () => {
      const id = b.closest('tr').dataset.id;
      const act = b.dataset.act;
      if (act === 'edit') return location.hash = '#/tickets/edit/' + id;
      if (act === 'view') return showView(id);
      if (act === 'del') {
        const tr = b.closest('tr');
        confirmDlg('حذف ارزیابی تیکت', `رکورد ${tr.children[4].textContent} (کد ${tr.children[6].textContent}) برای همیشه حذف می‌شود.`, async () => {
          try { await api.del('/api/tickets/' + id); toast('رکورد حذف شد', 'success'); await App.boot(); load(); }
          catch (e) { toast(e.message, 'error'); }
        });
      }
    }));
  }

  async function showView(id) {
    let t;
    try { t = await api.get('/api/tickets/' + id); } catch (e) { return toast(e.message, 'error'); }
    const row = (k, v) => `<div class="detail-row"><div class="k">${k}</div><div class="v">${v}</div></div>`;
    modal(`${modalHead('جزئیات ارزیابی تیکت #' + fa(t.id), 'fa-ticket')}
      <div class="modal-body">
        <div class="detail-rows">
          ${row('کارشناس کنترل کیفیت', esc(t.qcAgent))}
          ${row('کارشناس', esc(t.agentName))}
          ${row('تیم', `<span class="tag-team">${esc(t.team)}</span>`)}
          ${row('کد یکتای تیکت', esc(t.ticketCode))}
          ${row('تاریخ بررسی', fa(t.reviewDate) + ' — ' + C.weekdayFa(C.parseJalali(t.reviewDate)))}
          ${row('تاریخ ایجاد تیکت', fa(t.ticketDate) + ' — ' + C.weekdayFa(C.parseJalali(t.ticketDate)))}
          ${row('پیگیری صحیح (وزن ۴۰)', markBadge(t.q1))}
          ${row('ثبت یادداشت (وزن ۲۰)', markBadge(t.q2))}
          ${row('دلیل بستن تیکت (وزن ۲۰)', markBadge(t.q3))}
          ${row('اکشن CRM (وزن ۲۰)', markBadge(t.q4))}
          ${row('عدم تماس با شریک (ردلاین)', String(t.redline) === '0' ? '<span class="badge bad">تماس‌گرفته — صفر</span>' : '<span class="badge good">سالم</span>')}
          ${row('نمره نهایی', scorePill(t.score))}
          ${t.comment ? `<div class="detail-row wide"><div class="k">کامنت کنترل کیفیت</div><div class="v" style="font-weight:500;white-space:pre-wrap">${esc(t.comment)}</div></div>` : ''}
        </div>
      </div>
      <div class="modal-foot"><button class="btn ghost" data-close>بستن</button><button class="btn soft" id="vEdit"><i class="fa-solid fa-pen"></i> ویرایش</button></div>`)
      .querySelector('#vEdit').addEventListener('click', function () { this.closest('.modal-back').remove(); location.hash = '#/tickets/edit/' + id; });
  }

  // رویدادها
  const reload1 = debounce(() => { F.page = 1; load(); }, 350);
  $('input', fSearch).addEventListener('input', reload1);
  $('select', fTeam).addEventListener('change', reload1);
  $('select', fQc).addEventListener('change', reload1);
  [$('input', fFrom), $('input', fTo)].forEach((i) => i.addEventListener('change', () => { F.page = 1; load(); }));
  JCal.attach($('.cal-btn', fFrom), { onPick(j) { $('input', fFrom).value = j ? C.formatJalali(j) : ''; F.page = 1; load(); } });
  JCal.attach($('.cal-btn', fTo), { onPick(j) { $('input', fTo).value = j ? C.formatJalali(j) : ''; F.page = 1; load(); } });
  $('button', btnReset).addEventListener('click', () => {
    $('input', fSearch).value = ''; $('select', fTeam).value = ''; $('select', fQc).value = '';
    $('input', fFrom).value = ''; $('input', fTo).value = ''; F.page = 1; load();
  });
  $('button', btnXls).addEventListener('click', async () => {
    const btn = $('button', btnXls); btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-circle-notch spin"></i> در حال آماده‌سازی…';
    try {
      const p = new URLSearchParams(query()); p.set('per', 500); p.set('page', 1);
      const all = await api.get('/api/tickets?' + p.toString());
      QCExport.tickets(all.rows, App.state.settings);
      toast(fa(all.rows.length) + ' رکورد به اکسل منتقل شد', 'success');
    } catch (e) { toast(e.message, 'error'); }
    btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-file-excel"></i> خروجی اکسل';
  });

  load();
}

App.register('tickets', {
  title: (arg) => arg === 'new' ? 'ثبت ارزیابی تیکت' : arg === 'edit' ? 'ویرایش ارزیابی تیکت' : 'سوابق ارزیابی تیکت',
  render(root, arg, arg2) {
    if (arg === 'new') return formPage(root, null);
    if (arg === 'edit' && arg2) return formPage(root, arg2);
    return listPage(root);
  }
});
})();
