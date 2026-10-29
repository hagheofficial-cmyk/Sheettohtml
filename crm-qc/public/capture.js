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
    const pdf = new lib({ unit: 'pt', format: 'a4', orientation: 'portrait', compress: true });
    const pageWidth = pdf.internal.pageSize.getWidth(), pageHeight = pdf.internal.pageSize.getHeight();
    const margin = 18, imageWidth = pageWidth - margin * 2;
    const sliceHeight = Math.max(1, Math.floor(width * (pageHeight - margin * 2) / imageWidth));
    let offset = 0, page = 0;
    while (offset < height) {
      const tileHeight = Math.min(sliceHeight, height - offset);
      const scale = Math.min(1.5, 3000 / width, 4000 / tileHeight, Math.sqrt(12000000 / (width * tileHeight)));
      const canvas = await window.html2canvas(host, {
        backgroundColor: themeBackground(), scale, useCORS: true, logging: false,
        width, height: tileHeight, x: 0, y: offset,
        windowWidth: window.innerWidth, windowHeight: window.innerHeight, scrollX: 0, scrollY: 0
      });
      if (!canvas.width || !canvas.height) throw new Error('تصویر یکی از صفحه‌های PDF ساخته نشد');
      if (page) pdf.addPage();
      pdf.addImage(canvas.toDataURL('image/jpeg', 0.94), 'JPEG', margin, margin, imageWidth, tileHeight * imageWidth / width);
      canvas.width = canvas.height = 0;
      offset += tileHeight; page++;
    }
    pdf.save(fileName(filename, 'pdf'));
    return { pages: page, width, height };
  } finally { host.remove(); }
}

window.QCCapture = { download, downloadPdf, toCanvas };
})();
