/* capture.js — خروجی تصویر و PDF از یک بخش از صفحه (پرونده‌ی کارشناس)
 *
 * نکته‌ی مهم: نسخه‌ای که عکس گرفته می‌شود با «همان عرض» عنصر اصلی ساخته
 * می‌شود. اگر عرض عوض شود، جدول‌ها دوباره می‌چینند و ستون‌ها جابه‌جا به نظر
 * می‌رسند (باگ گزارش‌شده). ارتفاع عکس‌جای‌گرفته هم دقیقاً به اندازه‌ی خود
 * canvas اصلی است، نه یک عدد ثابت.
 */
(function () {
'use strict';

const CSS_VARS = ['bg', 'bg-2', 'panel', 'panel-2', 'panel-soft', 'soft', 'line', 'line-soft', 'border',
  'ink', 'ink-2', 'muted', 'brand', 'brand-soft', 'violet', 'violet-soft', 'good', 'good-soft', 'bad',
  'bad-soft', 'warn', 'warn-soft'];

function themeBackground() {
  return getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() || '#0b1220';
}

/* جای canvasها تصویر ثابت می‌گذاریم؛ ابعاد از خود canvas گرفته می‌شود تا
 * نسبت تصویر با چیزی که کاربر می‌بیند یکی بماند. */
function freezeCanvases(source, copy) {
  const originals = [...source.querySelectorAll('canvas')];
  const copies = [...copy.querySelectorAll('canvas')];
  originals.forEach((canvas, index) => {
    const target = copies[index];
    if (!target) return;
    let url = '';
    try { url = canvas.toDataURL('image/png'); } catch (e) { url = ''; }
    if (!url) return;
    const rect = canvas.getBoundingClientRect();
    const image = document.createElement('img');
    image.src = url;
    // Reserve the chart's aspect ratio before its data URL has loaded.
    if (rect.width && rect.height) { image.width = Math.round(rect.width); image.height = Math.round(rect.height); }
    image.style.cssText = 'display:block;max-width:100%;height:auto;' +
      (rect.width ? `width:${Math.round(rect.width)}px;` : 'width:100%;');
    target.replaceWith(image);
  });
}

/* عنصر کلون‌شده با عرض ثابت، تا چیدمان جدول‌ها دقیقاً مثل صفحه بماند. */
function buildHost(source, prepare) {
  const host = document.createElement('div');
  host.className = 'capture-host';
  host.dataset.theme = document.documentElement.dataset.theme || 'dark';
  const css = getComputedStyle(document.documentElement);
  CSS_VARS.forEach((key) => host.style.setProperty('--' + key, css.getPropertyValue('--' + key)));
  const copy = source.cloneNode(true);
  host.appendChild(copy);
  freezeCanvases(source, copy);
  if (prepare) prepare(copy);
  const rect = source.getBoundingClientRect();
  /* عرض عکس = عرض واقعی کارت‌ها (حداقل ۱۲۰۰ برای خوانایی جدول‌ها)؛ ثابت‌بودن
   * همین عرض است که از جابه‌جایی ستون‌ها در خروجی جلوگیری می‌کند. */
  const width = Math.min(1600, Math.max(1200, Math.round(rect.width || source.scrollWidth || 1200)));
  host.style.width = width + 'px';
  host.style.boxSizing = 'border-box';
  host.style.padding = '0';
  copy.style.width = '100%';
  document.body.appendChild(host);
  return { host, copy, width };
}

async function toCanvas(source, prepare) {
  if (!source || !source.isConnected) throw new Error('پرونده‌ی آماده‌ای برای خروجی وجود ندارد');
  if (typeof window.html2canvas !== 'function') throw new Error('کتابخانه‌ی عکس بارگذاری نشده است');
  const { host } = buildHost(source, prepare);
  try {
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
    const width = Math.ceil(Math.max(host.clientWidth, host.scrollWidth, parseFloat(host.style.width) || 0));
    host.style.width = width + 'px';
    const height = Math.max(host.scrollHeight, 200);
    const scale = Math.min(1.6, 30000 / height, 4000 / width, Math.sqrt(24000000 / (width * height)));
    if (scale < 0.45) UI.toast.info('این بازه سوابق زیادی دارد؛ تصویر کامل طولانی است. برای بررسی ریز مقادیر، خروجی اکسل هم قابل دانلود است.', 6000);
    return await html2canvas(host, {
      backgroundColor: themeBackground(), scale, useCORS: true, logging: false,
      width, height, windowWidth: window.innerWidth, windowHeight: window.innerHeight
    });
  } finally { host.remove(); }
}

function fileName(name, extension) {
  return String(name || 'کارنامه').replace(/[\\/:*?"<>|]/g, '-') + '.' + extension;
}

async function download(source, filename, prepare) {
  const canvas = await toCanvas(source, prepare);
  const blob = await new Promise((resolve, reject) => canvas.toBlob((b) => b ? resolve(b) : reject(new Error('ساخت فایل عکس ممکن نشد')), 'image/png'));
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName(filename, 'png');
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
  return { width: canvas.width, height: canvas.height };
}

/* Choose breaks before a row or compact block when possible, so that a
 * page boundary does not cut text in half. A block taller than one page is
 * split as a last resort rather than hiding any of its content. */
function pageBreaks(host) {
  const top = host.getBoundingClientRect().top;
  return [...host.querySelectorAll('tr, .card-head, .summary-block, .action-row, .chart-box, .profile-system-brand')]
    .map(node => { const r = node.getBoundingClientRect(); return { top: Math.floor(r.top - top), bottom: Math.ceil(r.bottom - top) }; })
    .filter(r => r.bottom > r.top).sort((a, b) => b.top - a.top);
}
function tileEnd(offset, proposed, pageSize, blocks) {
  let end = proposed;
  const min = offset + Math.max(1, Math.floor(pageSize * 0.2));
  blocks.forEach(block => {
    if (block.bottom - block.top <= pageSize && block.top >= min && block.top < end && block.bottom > end) end = block.top;
  });
  return end;
}

/* PDF به صورت تکه‌های مستقل ساخته می‌شود تا محدودیت اندازهٔ canvas
 * مرورگر باعث حذف انتهای پرونده‌های بلند نشود. */
async function downloadPdf(source, filename, prepare) {
  if (!source || !source.isConnected) throw new Error('پرونده‌ی آماده‌ای برای خروجی وجود ندارد');
  if (typeof window.html2canvas !== 'function') throw new Error('کتابخانه‌ی عکس بارگذاری نشده است');
  const lib = window.jspdf && (window.jspdf.jsPDF || window.jspdf);
  if (!lib) throw new Error('کتابخانه‌ی PDF بارگذاری نشده است');
  const { host } = buildHost(source, prepare);
  try {
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
    // Include any remaining overflow in the capture, rather than cutting it off.
    const width = Math.ceil(Math.max(host.clientWidth, host.scrollWidth, parseFloat(host.style.width) || 0));
    host.style.width = width + 'px';
    const height = Math.ceil(Math.max(host.scrollHeight, host.getBoundingClientRect().height));
    if (!width || !height) throw new Error('ابعاد محتوای PDF قابل محاسبه نیست');
    const pdf = new lib({ unit: 'pt', format: 'a4', orientation: 'landscape', compress: true });
    const pageWidth = pdf.internal.pageSize.getWidth(), pageHeight = pdf.internal.pageSize.getHeight();
    const margin = 18, imageWidth = pageWidth - margin * 2;
    const sliceHeight = Math.max(1, Math.floor(width * (pageHeight - margin * 2) / imageWidth));
    const blocks = pageBreaks(host), pages = [];
    let offset = 0;
    while (offset < height) {
      const proposed = Math.min(offset + sliceHeight, height);
      const end = proposed < height ? tileEnd(offset, proposed, sliceHeight, blocks) : proposed;
      pages.push({ y: offset, height: end - offset });
      offset = end;
    }
    // Capture several pages at a time. Re-cloning the entire app for every
    // page is extremely slow, but one canvas for an unlimited profile would
    // exceed browser limits. Batch size and pixel area remain bounded.
    const batchLimit = 6000;
    for (let first = 0; first < pages.length;) {
      let last = first + 1;
      while (last < pages.length && pages[last].y + pages[last].height - pages[first].y <= batchLimit) last++;
      const y = pages[first].y, batchHeight = pages[last - 1].y + pages[last - 1].height - y;
      const scale = Math.min(1.2, 3000 / width, 6000 / batchHeight, Math.sqrt(12000000 / (width * batchHeight)));
      const canvas = await window.html2canvas(host, {
        backgroundColor: themeBackground(), scale, useCORS: true, logging: false,
        width, height: batchHeight, x: 0, y,
        windowWidth: window.innerWidth, windowHeight: window.innerHeight, scrollX: 0, scrollY: 0,
        onclone: (doc, clonedHost) => {
          if (clonedHost && clonedHost.parentNode === doc.body) {
            [...doc.body.children].forEach(node => { if (node !== clonedHost && node.tagName !== 'STYLE') node.remove(); });
          }
        }
      });
      if (!canvas.width || !canvas.height) throw new Error('تصویر یکی از صفحه‌های PDF ساخته نشد');
      for (let index = first; index < last; index++) {
        const page = pages[index];
        const from = Math.round((page.y - y) * canvas.height / batchHeight);
        const to = Math.round((page.y + page.height - y) * canvas.height / batchHeight);
        const slice = document.createElement('canvas');
        slice.width = canvas.width; slice.height = Math.max(1, to - from);
        const context = slice.getContext('2d');
        if (!context) throw new Error('ساخت تصویر PDF ممکن نشد');
        context.fillStyle = themeBackground(); context.fillRect(0, 0, slice.width, slice.height);
        context.drawImage(canvas, 0, from, canvas.width, slice.height, 0, 0, slice.width, slice.height);
        if (index) pdf.addPage();
        pdf.addImage(slice.toDataURL('image/jpeg', 0.94), 'JPEG', margin, margin, imageWidth, page.height * imageWidth / width);
        slice.width = slice.height = 0;
      }
      canvas.width = canvas.height = 0;
      first = last;
    }
    pdf.save(fileName(filename, 'pdf'));
    return { pages: pages.length, width, height };
  } finally { host.remove(); }
}

window.QCCapture = { download, downloadPdf, toCanvas };
})();
