/* tableTools.js — دکمه‌های «اکسل» و «عکس» برای هر جدول سامانه.
 *   - هر `table.tbl` در صفحه (و پاپ‌آپ‌ها) یک نوار ابزار کوچک بالای خودش می‌گیرد.
 *   - اکسل و عکس از همان داده‌ی جدول ساخته می‌شوند؛ ستون‌های فقط-دکمه (عملیات) و ردیف‌های مخفی حذف می‌شوند.
 *   - جدول‌های صفحه‌بندی‌شده می‌توانند با setSource منبع «کل ردیف‌های فیلتر شده» بدهند (fetchAll).
 *   - اگر جدول منبع نداشته باشد، همان ردیف‌های نمایش‌داده‌شده خروجی می‌گیرند.
 */
(function () {
'use strict';

const stageId = 'tblToolsStage';
let pending = false;

const txt = (n) => (n ? n.textContent : '').replace(/\s+/g, ' ').trim();
const isHeadRow = (tr) => !!(tr.parentElement && tr.parentElement.tagName === 'THEAD');
const hiddenRow = (tr) => tr.hidden || tr.classList.contains('no-capture') || tr.style.display === 'none';

function headRow(table) {
  const t = table.tHead;
  return t && t.rows.length ? t.rows[t.rows.length - 1] : null;
}
function bodyRows(table) {
  return [...table.rows].filter((tr) => !isHeadRow(tr) && !hiddenRow(tr));
}

/** ستون‌هایی که باید حذف شوند: عنوان نداشته و فقط دکمه دارند (مثل «عملیات»)، یا no-capture. */
function skipColumns(table) {
  const hr = headRow(table);
  const rows = bodyRows(table);
  const width = Math.max(0, ...[...table.rows].map((r) => r.cells.length));
  const skip = new Set();
  for (let i = 0; i < width; i++) {
    const h = hr && hr.cells[i];
    if (h && h.classList.contains('no-capture')) { skip.add(i); continue; }
    const cells = rows.map((r) => r.cells[i]).filter(Boolean);
    if (!txt(h) && cells.length && cells.every((c) => c.querySelector('button, .btn'))) skip.add(i);
  }
  return skip;
}

/** داده‌ی جدول: سرستون‌ها (اگر thead باشد) و ردیف‌های متنی. */
function gridOf(table) {
  const skip = skipColumns(table);
  const pick = (cells) => [...cells].filter((_, i) => !skip.has(i));
  const hr = headRow(table);
  return {
    headers: hr ? pick(hr.cells).map(txt) : null,
    rows: bodyRows(table).map((tr) => pick(tr.cells).map(txt))
  };
}

const sanitize = (s) => String(s || 'جدول').replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim().slice(0, 120);
const stamp = () => {
  const t = window.QCCalc && window.QCCalc.todayJalali ? window.QCCalc.todayJalali() : null;
  return t ? window.QCCalc.formatJalali(t, '') : new Date().toISOString().slice(0, 10);
};
const toCell = (v) => {
  const s = window.QCCalc && window.QCCalc.faToEn ? window.QCCalc.faToEn(v) : v;
  return /^-?\d+(\.\d+)?$/.test(s.trim()) ? Number(s) : s;
};

/** عنوان جدول: نزدیک‌ترین تیتر قبل از جدول، یا data-tbl-title، یا عنوان صفحه. */
function titleOf(table) {
  if (table.dataset.tblTitle) return table.dataset.tblTitle;
  let node = table;
  for (let depth = 0; node && depth < 6; depth++, node = node.parentElement) {
    let prev = node;
    while ((prev = prev.previousElementSibling)) {
      const h = prev.matches('h1,h2,h3,h4,.card-head h3,.card-head h4') ? prev
        : prev.querySelector('.card-head h3, .card-head h4, h2, h3, h4');
      if (h && txt(h)) return txt(h);
    }
  }
  const page = document.querySelector('#content .page-head h2, #content h2');
  return (page && txt(page)) || 'جدول';
}

function exportExcel(grid, title) {
  const aoa = [];
  if (grid.headers && grid.headers.length) aoa.push(grid.headers);
  grid.rows.forEach((r) => aoa.push(r.map(toCell)));
  if (!aoa.length) throw new Error('ردیفی برای خروجی وجود ندارد');
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const width = Math.max(...aoa.map((r) => r.length));
  ws['!cols'] = Array.from({ length: width }, (_, i) => ({
    wch: Math.min(40, Math.max(8, ...aoa.map((r) => String(r[i] == null ? '' : r[i]).length)) + 2)
  }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'جدول');
  XLSX.writeFile(wb, sanitize(title) + ' — ' + stamp() + '.xlsx');
  return grid.rows.length;
}

/** نسخه‌ی تصویری: ستون‌های حذف‌شده و ردیف‌های مخفی از کپی هم حذف می‌شوند. */
function pruneCopy(copy, skip) {
  [...copy.rows].forEach((tr) => { if (hiddenRow(tr)) tr.remove(); });
  // اول ستون‌ها بر اساس اندیس (قبل از حذف هر چیز دیگر) حذف می‌شوند
  [...copy.rows].forEach((tr) => [...tr.cells].forEach((c, i) => { if (skip.has(i)) c.remove(); }));
  copy.querySelectorAll('button, .tbl-tools, .no-capture').forEach((n) => n.remove());
}

async function exportImage(table, title) {
  if (!window.QCCapture || !window.QCCapture.download) throw new Error('ابزار عکس بارگذاری نشده است');
  const skip = skipColumns(table);
  await window.QCCapture.download(table, sanitize(title) + ' — ' + stamp(), (copy) => {
    pruneCopy(copy, skip);
    const h = document.createElement('div');
    h.textContent = title;
    h.style.cssText = 'font-weight:800;font-size:16px;padding:10px 4px 12px;color:var(--ink)';
    copy.parentNode.insertBefore(h, copy);
  });
}

function stage() {
  let s = document.getElementById(stageId);
  if (!s) {
    s = document.createElement('div');
    s.id = stageId;
    s.setAttribute('aria-hidden', 'true');
    s.style.cssText = 'position:fixed;left:0;top:0;width:1600px;opacity:0;pointer-events:none;z-index:-1;direction:rtl';
    document.body.appendChild(s);
  }
  return s;
}

async function run(table, kind, btn) {
  const title = titleOf(table);
  const label = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-circle-notch spin"></i>';
  let temp = null;
  try {
    let source = table;
    if (typeof table._tblFull === 'function') {
      source = await table._tblFull();
      if (!source) throw new Error('داده‌ای برای خروجی پیدا نشد');
      temp = document.createElement('div');
      temp.appendChild(source);
      stage().appendChild(temp);
    }
    if (kind === 'xls') {
      const n = exportExcel(gridOf(source), title);
      UI.toast.success(`${n} ردیف به اکسل منتقل شد`);
    } else {
      await exportImage(source, title);
      UI.toast.success('عکس جدول دانلود شد');
    }
  } catch (e) {
    UI.toast.error(e.message || 'خطا در خروجی');
  } finally {
    if (temp) temp.remove();
    btn.disabled = false;
    btn.innerHTML = label;
  }
}

function decorate(table) {
  if (table._tt || table.closest('.capture-host, #' + stageId) || table.hasAttribute('data-no-tools')) return;
  const wrap = table.parentElement && /table-wrap|table-responsive/.test(table.parentElement.className)
    ? table.parentElement : table;
  const prev = wrap.previousElementSibling;
  if (prev && prev.classList.contains('tbl-tools') && prev.dataset.for === '1') { table._tt = prev; return; }
  const bar = document.createElement('div');
  bar.className = 'tbl-tools';
  bar.dataset.for = '1';
  bar.innerHTML = '<button type="button" class="btn ghost sm" data-tt="xls" title="خروجی اکسل از این جدول"><i class="fa-solid fa-file-excel"></i> اکسل</button>' +
    '<button type="button" class="btn ghost sm" data-tt="img" title="عکس از کل ردیف‌های این جدول"><i class="fa-regular fa-image"></i> عکس</button>';
  bar.addEventListener('click', (e) => {
    const b = e.target.closest('[data-tt]');
    if (b) run(table, b.dataset.tt, b);
  });
  wrap.parentNode.insertBefore(bar, wrap);
  table._tt = bar;
}

/** نوارهای یتیم (جدولشان حذف شده) را پاک می‌کند و جدول‌های تازه را مجهز می‌کند. */
function scan() {
  document.querySelectorAll('.tbl-tools').forEach((bar) => {
    const next = bar.nextElementSibling;
    const ok = next && (next.matches('table.tbl') || next.querySelector(':scope > table.tbl'));
    if (!ok) bar.remove();
  });
  document.querySelectorAll('table.tbl').forEach(decorate);
}

function schedule() {
  if (pending) return;
  pending = true;
  const later = window.requestAnimationFrame || ((f) => setTimeout(f, 16));
  later(() => { pending = false; scan(); });
}

/** منبع داده‌ی کامل جدول (برای جدول‌های صفحه‌بندی‌شده). fn باید یک <table> برگرداند. */
function setSource(table, fn) {
  if (table) table._tblFull = fn;
}

/** همه‌ی صفحات یک API فهرستی را با per حداکثر ۲۰۰ می‌گیرد (فیلترها همان‌هاست). */
async function fetchAll(url, params) {
  const rows = [];
  let page = 1, total = Infinity;
  while (rows.length < total && page <= 500) {
    const p = new URLSearchParams(params || '');
    p.delete('page'); p.delete('per');
    p.set('page', String(page)); p.set('per', '200');
    const d = await UI.api.get(url + '?' + p.toString());
    total = d.total || 0;
    rows.push(...(d.rows || []));
    if (!d.rows || !d.rows.length) break;
    page++;
  }
  return rows;
}

window.QCTables = { scan, setSource, fetchAll, gridOf, titleOf };

function start() {
  scan();
  new MutationObserver((muts) => {
    for (const m of muts) {
      for (const n of m.addedNodes) {
        if (n.nodeType === 1 && (n.matches('table.tbl') || (n.querySelector && n.querySelector('table.tbl')))) { schedule(); return; }
      }
    }
  }).observe(document.body, { childList: true, subtree: true });
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
else start();
})();
