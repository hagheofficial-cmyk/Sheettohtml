/* socials.js — بخش ارزیابی سوشال: فرم ثبت/ویرایش + سوابق */
(function () {
'use strict';
const { C, $, $$, api, fa, esc, el, toast, modal, modalHead, confirmDlg, dateField, combo, triSwitch, selectField, scorePill, markBadge, slaBadge, durText, pager, emptyState, debounce } = UI;

const CRITERIA = [
  { key: 'qSla', icon: 'fa-stopwatch', title: 'رعایت زمان پاسخ‌گویی (SLA)' },
  { key: 'qFollow', icon: 'fa-magnifying-glass-chart', title: 'پیگیری و رسیدگی تا مشخص‌شدن نتیجه' },
  { key: 'qClosing', icon: 'fa-flag-checkered', title: 'پایان‌بندی صحیح مکالمه' },
  { key: 'qTone', icon: 'fa-feather-pointed', title: 'لحن و نگارش حرفه‌ای' }
];

/* ---------------------------------------------------------- فرم ثبت/ویرایش */
async function formPage(root, editId) {
  const st = App.state;
  let rec = null;
  if (editId) {
    root.innerHTML = `<div class="loading-page"><div class="spinner"></div></div>`;
    try { rec = await api.get('/api/socials/' + editId); }
    catch (e) { root.innerHTML = `<div class="card">${emptyState('fa-circle-question', 'رکورد یافت نشد', e.message, '<a class="btn ghost" href="#/socials">بازگشت به لیست</a>')}</div>`; return; }
  }
  const W = st.settings.socialWeights;
  const slaMin = st.settings.slaMinutes;

  root.innerHTML = `
    <div class="page-head violet">
      <div class="ph-ic"><i class="fa-solid fa-comments"></i></div>
      <div><h2>${editId ? 'ویرایش ارزیابی سوشال #' + fa(editId) : 'ثبت ارزیابی سوشال'}</h2>
      <p>مدت پاسخگویی بر اساس ساعات کاری (${fa(st.settings.workStart)} تا ${fa(st.settings.workEnd)} — تعطیلات: پنجشنبه/جمعه) و آستانه SLA برابر ${fa(slaMin)} دقیقه محاسبه می‌شود.</p></div>
    </div>
    <div class="grid" style="grid-template-columns:minmax(0,1fr) 330px;align-items:start" id="grid">
      <div style="display:flex;flex-direction:column;gap:16px;min-width:0">
        <div class="card">
          <div class="card-head violet"><div class="head-icon"><i class="fa-solid fa-circle-info"></i></div><h3>اطلاعات پیام</h3></div>
          <div class="card-pad"><div class="form-grid" id="baseGrid"></div></div>
        </div>
        <div class="card">
          <div class="card-head violet"><div class="head-icon"><i class="fa-solid fa-list-check"></i></div><div><h3>المان‌های ارزیابی</h3><div class="sub">معادل ستون‌های Q تا T فایل اکسل سوشال</div></div></div>
          <div class="card-pad">
            <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(270px,1fr))" id="critGrid"></div>
          </div>
        </div>
        <div class="card">
          <div class="card-head violet"><div class="head-icon"><i class="fa-regular fa-comment-dots"></i></div><h3>توضیحات کنترل کیفیت</h3></div>
          <div class="card-pad"><textarea class="input" id="comment" rows="3" placeholder="توضیحات ارزیاب…">${esc(rec ? rec.comment || '' : '')}</textarea></div>
        </div>
      </div>

      <div style="position:sticky;top:calc(var(--topbar-h) + 16px);display:flex;flex-direction:column;gap:16px;min-width:0">
        <div class="score-live card-pad" style="flex-direction:column;align-items:center;text-align:center;gap:13px;padding:22px">
          <div class="donut" id="donut"><div class="num"><div><span id="scoreNum">؟</span><small>از ۱۰۰</small></div></div></div>
          <div class="meta" id="slaMeta" style="align-items:center;width:100%"></div>
          <button class="btn primary" id="save" style="width:100%"><i class="fa-solid fa-floppy-disk"></i>${editId ? 'ذخیره تغییرات' : 'ثبت ارزیابی'}</button>
          ${editId ? '<a class="btn ghost" href="#/socials" style="width:100%"><i class="fa-solid fa-arrow-right"></i>بازگشت به لیست</a>' : '<a class="btn ghost" href="#/socials" style="width:100%"><i class="fa-solid fa-list"></i>مشاهده سوابق</a>'}
        </div>
        <div class="card card-pad" style="font-size:12px;color:var(--muted);line-height:2">
          <b style="color:var(--ink-2)"><i class="fa-solid fa-scale-balanced" style="color:var(--violet)"></i> فرمول نمره‌دهی</b><br>
          وزن المان‌ها: SLA ${fa(W[0])}، پیگیری ${fa(W[1])}، پایان‌بندی ${fa(W[2])}، لحن ${fa(W[3])}<br>
          «نامرتبط» از مخرج حذف می‌شود.
        </div>
      </div>
    </div>`;

  const grid = $('#grid');
  const fit = () => { grid.style.gridTemplateColumns = window.innerWidth < 1100 ? '1fr' : 'minmax(0,1fr) 330px'; };
  fit(); window.addEventListener('resize', fit);

  /* --- فیلدهای پایه */
  const base = $('#baseGrid');
  const fReview = dateField({ label: 'تاریخ بررسی', required: true, value: rec ? rec.reviewDate : C.formatJalali(C.todayJalali()) });
  const fQc = selectField({ label: 'کارشناس QC', required: true, items: st.qcAgents });
  const fAgent = combo({ label: 'نام کارشناس', required: true, items: App.agentComboItems(), value: rec ? rec.agentName : '', placeholder: 'جستجوی نام کارشناس…', onPick: () => setTimeout(syncTeam, 0) });
  const fTeam = el(`<div class="field"><label>تیم کارشناس <span class="hint">(خودکار)</span></label><input class="input" readonly tabindex="-1" style="opacity:.75;cursor:not-allowed" placeholder="—"></div>`);
  const fRecv = dateField({ label: 'تاریخ دریافت پیام', required: true, value: rec ? rec.receiveDate : '' });
  const fReply = dateField({ label: 'تاریخ پاسخدهی', required: true, value: rec ? rec.replyDate : '' });
  const fTRecv = el(`<div class="field"><label>ساعت دریافت <span class="req">*</span></label><input type="time" class="input" value="${esc(rec ? rec.receiveTime : '')}"></div>`);
  const fTReply = el(`<div class="field"><label>ساعت پاسخ <span class="req">*</span></label><input type="time" class="input" value="${esc(rec ? rec.replyTime : '')}"></div>`);
  const fMsg = selectField({ label: 'پیامرسان', required: true, items: st.lists.messengers.map((m) => ({ value: m, label: m })) });
  const fStatus = selectField({ label: 'وضعیت پاسخ', required: true, items: st.lists.responseStatuses });
  const fReason = selectField({ label: 'دلیل تأخیر یا عدم پاسخ', items: st.lists.delayReasons });
  const fVerdict = selectField({ label: 'وضعیت تأیید دلیل', required: true, items: st.lists.reasonVerdicts });
  [fReview, fQc, fAgent, fTeam, fMsg, fRecv, fTRecv, fReply, fTReply, fStatus, fReason, fVerdict].forEach((f) => base.appendChild(f));

  if (rec) { fQc.setValue(rec.qcAgent); fMsg.setValue(rec.messenger); fStatus.setValue(rec.responseStatus); fReason.setValue(rec.delayReason || ''); fVerdict.setValue(rec.reasonVerdict); }

  const teamInp = $('input', fTeam);
  const syncTeam = () => { teamInp.value = App.teamOf(fAgent.getValue()) || (rec ? rec.team : ''); };
  $('input', fAgent).addEventListener('blur', debounce(syncTeam, 120));
  fAgent.addEventListener('input', debounce(syncTeam, 250));
  syncTeam();

  /* --- المان‌ها */
  const critGrid = $('#critGrid');
  const tris = {};
  CRITERIA.forEach((c, i) => {
    const card = el(`<div class="criteria-card">
      <div class="c-top"><div class="c-ic" style="color:var(--violet)"><i class="fa-solid ${c.icon}"></i></div>
        <div class="c-title">${c.title}</div><span class="c-weight">وزن ${fa(W[i])}</span></div>
      <div data-slot></div></div>`);
    const tri = triSwitch({ name: c.key, value: rec ? rec[c.key] : '', onChange: calc });
    $('[data-slot]', card).appendChild(tri);
    tris[c.key] = tri;
    critGrid.appendChild(card);
  });

  /* --- محاسبه زنده SLA + نمره */
  const donut = $('#donut'), scoreNum = $('#scoreNum'), slaMeta = $('#slaMeta');
  function payload() {
    return {
      qcAgent: fQc.getValue(), reviewDate: fReview.getValue(),
      agentName: fAgent.getValue(),
      messenger: fMsg.getValue(),
      receiveDate: fRecv.getValue(), replyDate: fReply.getValue(),
      receiveTime: $('input', fTRecv).value, replyTime: $('input', fTReply).value,
      responseStatus: fStatus.getValue(), delayReason: fReason.getValue(), reasonVerdict: fVerdict.getValue(),
      qSla: tris.qSla.getValue(), qFollow: tris.qFollow.getValue(), qClosing: tris.qClosing.getValue(), qTone: tris.qTone.getValue(),
      comment: $('#comment').value.trim()
    };
  }

  function calc() {
    const p = payload();
    // مدت پاسخگویی (منطق دقیق اکسل)
    let mins = null, err = null;
    if (p.responseStatus === 'پاسخ داده شده' && p.receiveDate && p.replyDate && p.receiveTime && p.replyTime) {
      const s = C.combineJalaliTime(C.parseJalali(p.receiveDate), p.receiveTime);
      const e = C.combineJalaliTime(C.parseJalali(p.replyDate), p.replyTime);
      const r = C.businessMinutes(s, e, st.settings);
      if (r === 'خطای تاریخ') err = r; else mins = r;
    }
    const sla = C.slaStatus(p.responseStatus, err ? '' : mins, slaMin);
    const score = C.socialScore(p.qSla, p.qFollow, p.qClosing, p.qTone, W);

    if (score === '') {
      donut.style.setProperty('--p', 0); donut.style.setProperty('--c', 'var(--violet)'); scoreNum.textContent = '؟';
    } else {
      donut.style.setProperty('--p', Math.max(2, score));
      donut.style.setProperty('--c', score >= 90 ? 'var(--good)' : score >= 75 ? 'var(--brand)' : score >= 50 ? 'var(--warn)' : 'var(--bad)');
      scoreNum.textContent = fa(score);
    }

    const wd1 = p.receiveDate ? C.weekdayFa(C.parseJalali(p.receiveDate)) : '—';
    const wd2 = p.replyDate ? C.weekdayFa(C.parseJalali(p.replyDate)) : '—';
    slaMeta.innerHTML = `
      <div class="row" style="justify-content:space-between;width:100%"><span style="color:var(--muted)"><i class="fa-regular fa-calendar"></i> روز دریافت:</span><b>${wd1}</b></div>
      <div class="row" style="justify-content:space-between;width:100%"><span style="color:var(--muted)"><i class="fa-regular fa-calendar-check"></i> روز پاسخ:</span><b>${wd2}</b></div>
      <div class="row" style="justify-content:space-between;width:100%"><span style="color:var(--muted)"><i class="fa-solid fa-hourglass-half"></i> مدت پاسخگویی (کاری):</span><b>${durText(err ? null : mins, err)}</b></div>
      <div class="row" style="justify-content:space-between;width:100%"><span style="color:var(--muted)"><i class="fa-solid fa-stopwatch"></i> وضعیت SLA:</span><b>${sla ? slaBadge(sla) : '—'}</b></div>
      ${score === '' ? '<div class="row" style="color:var(--warn);justify-content:center"><i class="fa-solid fa-circle-info"></i> برای نمره، هر ۴ المان را مشخص کنید</div>' : ''}`;
    return score;
  }
  calc();

  /* هر تغییری → محاسبه مجدد */
  ['input', 'change', 'blur'].forEach((ev) => {
    [fReview, fRecv, fReply].forEach((f) => $('input', f).addEventListener(ev, debounce(calc, 200)));
    [$('input', fTRecv), $('input', fTReply)].forEach((i) => i.addEventListener(ev, debounce(calc, 200)));
    [fStatus, fReason, fVerdict, fMsg, fQc].forEach((f) => $('select', f).addEventListener(ev, calc));
  });

  /* --- ذخیره */
  const saveBtn = $('#save');
  saveBtn.addEventListener('click', async () => {
    saveBtn.disabled = true;
    saveBtn.innerHTML = '<i class="fa-solid fa-circle-notch spin"></i> در حال ذخیره…';
    try {
      const saved = editId ? await api.put('/api/socials/' + editId, payload()) : await api.post('/api/socials', payload());
      toast((editId ? 'تغییرات ذخیره شد' : 'ارزیابی ثبت شد') + ' — نمره: ' + fa(saved.score == null ? '—' : saved.score), 'success');
      await App.boot();
      location.hash = '#/socials';
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
    <div class="page-head violet">
      <div class="ph-ic"><i class="fa-solid fa-list-check"></i></div>
      <div><h2>سوابق ارزیابی سوشال</h2><p>مدت پاسخگویی و SLA مطابق فرمول ساعات کاری فایل اکسل محاسبه شده است</p></div>
      <div class="spacer"></div>
      <a class="btn primary" href="#/socials/new"><i class="fa-solid fa-plus"></i> ثبت ارزیابی جدید</a>
    </div>
    <div class="card">
      <div class="filters" id="filters"></div>
      <div class="table-wrap" id="tblWrap"><div class="loading-page"><div class="spinner"></div></div></div>
      <div class="pager" id="pager"></div>
    </div>`;

  const filters = $('#filters');
  const mk = (html) => { const d = el(html); filters.appendChild(d); return d; };
  const fSearch = mk(`<div class="field" style="flex:2"><label>جستجو</label><input class="input" placeholder="نام کارشناس، پیامرسان، کامنت…"></div>`);
  const fTeam = mk(`<div class="field"><label>تیم</label><select class="input"><option value="">همه تیم‌ها</option>${st.teams.map((t) => `<option>${esc(t)}</option>`).join('')}</select></div>`);
  const fQc = mk(`<div class="field"><label>کارشناس QC</label><select class="input"><option value="">همه</option>${st.qcAgents.map((t) => `<option>${esc(t)}</option>`).join('')}</select></div>`);
  const fSla = mk(`<div class="field"><label>وضعیت SLA</label><select class="input"><option value="">همه</option><option>رعایت شده</option><option>رعایت نشده</option><option>بدون پاسخ</option><option>اطلاعات ناقص</option></select></div>`);
  const fFrom = mk(`<div class="field"><label>از تاریخ بررسی</label><input class="input" dir="ltr" style="text-align:right" placeholder="1405/06/01" inputmode="numeric"></div>`);
  const fTo = mk(`<div class="field"><label>تا تاریخ بررسی</label><input class="input" dir="ltr" style="text-align:right" placeholder="1405/06/31" inputmode="numeric"></div>`);
  const btnXls = mk(`<div class="field grow-0"><label>&nbsp;</label><button class="btn success-soft"><i class="fa-solid fa-file-excel"></i> خروجی اکسل</button></div>`);
  const btnReset = mk(`<div class="field grow-0"><label>&nbsp;</label><button class="btn ghost"><i class="fa-solid fa-rotate-right"></i> پاک‌سازی</button></div>`);

  function query() {
    const p = new URLSearchParams();
    if ($('input', fSearch).value.trim()) p.set('search', $('input', fSearch).value.trim());
    if ($('select', fTeam).value) p.set('team', $('select', fTeam).value);
    if ($('select', fQc).value) p.set('qc', $('select', fQc).value);
    if ($('select', fSla).value) p.set('sla', $('select', fSla).value);
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
    try { data = await api.get('/api/socials?' + query()); }
    catch (e) { wrap.innerHTML = emptyState('fa-triangle-exclamation', 'خطا', e.message); return; }

    let rows = data.rows;

    if (!rows.length) {
      wrap.innerHTML = emptyState('fa-comments', 'رکوردی یافت نشد', 'فیلترها را تغییر دهید یا ارزیابی جدیدی ثبت کنید.', `<a class="btn primary sm" href="#/socials/new"><i class="fa-solid fa-plus"></i>ثبت ارزیابی</a>`);
      $('#pager').innerHTML = '';
      return;
    }
    wrap.innerHTML = `<table class="tbl"><thead><tr>
      <th>#</th><th>کارشناس</th><th>تیم</th><th>پیامرسان</th><th>دریافت</th><th>پاسخ</th><th>مدت (کاری)</th><th>وضعیت پاسخ</th><th>SLA</th>
      <th title="رعایت SLA">SLA‌المان</th><th title="پیگیری">پیگیری</th><th title="پایان‌بندی">پایان‌بندی</th><th title="لحن">لحن</th>
      <th>نمره</th><th style="width:120px"></th></tr></thead>
    <tbody>
      ${rows.map((s) => `<tr data-id="${s.id}">
        <td style="color:var(--muted)">${fa(s.id)}</td>
        <td class="cell-main">${esc(s.agentName)}</td>
        <td><span class="tag-team">${esc(s.team)}</span></td>
        <td><span class="badge blue">${esc(s.messenger)}</span></td>
        <td>${fa(s.receiveDate)}<div class="cell-sub">${esc(s.receiveTime || '')} ${esc(s.receiveWeekday || '')}</div></td>
        <td>${fa(s.replyDate)}<div class="cell-sub">${esc(s.replyTime || '')} ${esc(s.replyWeekday || '')}</div></td>
        <td>${durText(s.durationMin, s.durationError)}</td>
        <td>${s.responseStatus === 'عدم پاسخ' ? '<span class="badge warn"><i class="fa-solid fa-phone-slash"></i>عدم پاسخ</span>' : '<span class="badge good"><i class="fa-solid fa-reply"></i>پاسخ داده شده</span>'}</td>
        <td>${slaBadge(s.slaStatus)}</td>
        <td>${markBadge(s.qSla)}</td><td>${markBadge(s.qFollow)}</td><td>${markBadge(s.qClosing)}</td><td>${markBadge(s.qTone)}</td>
        <td>${scorePill(s.score)}</td>
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
      if (act === 'edit') return location.hash = '#/socials/edit/' + id;
      if (act === 'view') return showView(id);
      if (act === 'del') {
        confirmDlg('حذف ارزیابی سوشال', `ارزیابی «${b.closest('tr').children[1].textContent}» برای همیشه حذف می‌شود.`, async () => {
          try { await api.del('/api/socials/' + id); toast('رکورد حذف شد', 'success'); await App.boot(); load(); }
          catch (e) { toast(e.message, 'error'); }
        });
      }
    }));
  }

  async function showView(id) {
    let s;
    try { s = await api.get('/api/socials/' + id); } catch (e) { return toast(e.message, 'error'); }
    const row = (k, v) => `<div class="detail-row"><div class="k">${k}</div><div class="v">${v}</div></div>`;
    modal(`${modalHead('جزئیات ارزیابی سوشال #' + fa(s.id), 'fa-comments')}
      <div class="modal-body">
        <div class="detail-rows">
          ${row('تاریخ بررسی / QC', esc(s.qcAgent) + ' — ' + fa(s.reviewDate))}
          ${row('کارشناس / تیم', esc(s.agentName) + ' — ' + esc(s.team))}
          ${row('پیامرسان', `<span class="badge blue">${esc(s.messenger)}</span>`)}
          ${row('دریافت', fa(s.receiveDate) + ' (' + esc(s.receiveWeekday || '') + ') ساعت ' + esc(s.receiveTime || ''))}
          ${row('پاسخ', fa(s.replyDate) + ' (' + esc(s.replyWeekday || '') + ') ساعت ' + esc(s.replyTime || ''))}
          ${row('مدت پاسخگویی (کاری)', durText(s.durationMin, s.durationError))}
          ${row('وضعیت پاسخ', esc(s.responseStatus))}
          ${row('وضعیت SLA', slaBadge(s.slaStatus))}
          ${row('دلیل تأخیر/عدم پاسخ', esc(s.delayReason || '—'))}
          ${row('تأیید دلیل', esc(s.reasonVerdict || '—'))}
          ${row('رعایت SLA (وزن ۳۰)', markBadge(s.qSla))}
          ${row('پیگیری (وزن ۳۰)', markBadge(s.qFollow))}
          ${row('پایان‌بندی (وزن ۲۵)', markBadge(s.qClosing))}
          ${row('لحن (وزن ۱۵)', markBadge(s.qTone))}
          ${row('نمره نهایی', scorePill(s.score))}
          ${s.comment ? `<div class="detail-row wide"><div class="k">توضیحات کنترل کیفیت</div><div class="v" style="font-weight:500;white-space:pre-wrap">${esc(s.comment)}</div></div>` : ''}
        </div>
      </div>
      <div class="modal-foot"><button class="btn ghost" data-close>بستن</button><button class="btn soft" id="vEdit"><i class="fa-solid fa-pen"></i> ویرایش</button></div>`)
      .querySelector('#vEdit').addEventListener('click', function () { this.closest('.modal-back').remove(); location.hash = '#/socials/edit/' + id; });
  }

  const reload1 = debounce(() => { F.page = 1; load(); }, 350);
  $('input', fSearch).addEventListener('input', reload1);
  $('select', fTeam).addEventListener('change', reload1);
  $('select', fQc).addEventListener('change', reload1);
  $('select', fSla).addEventListener('change', reload1);
  [$('input', fFrom), $('input', fTo)].forEach((i) => i.addEventListener('blur', () => { F.page = 1; load(); }));
  $('button', btnReset).addEventListener('click', () => {
    $('input', fSearch).value = ''; $('select', fTeam).value = ''; $('select', fQc).value = ''; $('select', fSla).value = '';
    $('input', fFrom).value = ''; $('input', fTo).value = ''; F.page = 1; load();
  });
  $('button', btnXls).addEventListener('click', async () => {
    const btn = $('button', btnXls); btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-circle-notch spin"></i> در حال آماده‌سازی…';
    try {
      const p = new URLSearchParams(query()); p.set('per', 500); p.set('page', 1);
      const all = await api.get('/api/socials?' + p.toString());
      QCExport.socials(all.rows, App.state.settings);
      toast(fa(all.rows.length) + ' رکورد به اکسل منتقل شد', 'success');
    } catch (e) { toast(e.message, 'error'); }
    btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-file-excel"></i> خروجی اکسل';
  });

  load();
}

App.register('socials', {
  title: (arg) => arg === 'new' ? 'ثبت ارزیابی سوشال' : arg === 'edit' ? 'ویرایش ارزیابی سوشال' : 'سوابق ارزیابی سوشال',
  render(root, arg, arg2) {
    if (arg === 'new') return formPage(root, null);
    if (arg === 'edit' && arg2) return formPage(root, arg2);
    return listPage(root);
  }
});
})();
