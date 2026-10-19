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
  copy.style.width = width + 'px';
  document.body.appendChild(host);
  return { host, copy, width };
}

async function toCanvas(source, prepare) {
  if (!source || !source.isConnected) throw new Error('پرونده‌ی آماده‌ای برای خروجی وجود ندارد');
  if (typeof window.html2canvas !== 'function') throw new Error('کتابخانه‌ی عکس بارگذاری نشده است');
  const { host, width } = buildHost(source, prepare);
  try {
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
    const height = Math.max(host.scrollHeight, 200);
    const scale = Math.max(0.3, Math.min(1.6, 30000 / height, 4000 / width, Math.sqrt(24000000 / (width * height))));
    if (scale < 0.45) UI.toast.info('این بازه سوابق زیادی دارد؛ تصویر کامل طولانی است. برای بررسی ریز مقادیر، خروجی اکسل هم قابل دانلود است.', 6000);
    return await html2canvas(host, {
      backgroundColor: themeBackground(), scale, useCORS: true, logging: false,
      width, height, windowWidth: width + 80, windowHeight: Math.max(1000, height)
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

/* PDF از همان تصویر ساخته می‌شود: متن فارسی به‌صورت گرافیکی می‌ماند و نیازی
 * به فونت فارسی داخل jsPDF نیست. تصویر بلند به صفحه‌های A4 بریده می‌شود. */
async function downloadPdf(source, filename, prepare) {
  const lib = window.jspdf && (window.jspdf.jsPDF || window.jspdf);
  if (!lib) throw new Error('کتابخانه‌ی PDF بارگذاری نشده است');
  const canvas = await toCanvas(source, prepare);
  const pdf = new lib({ unit: 'pt', format: 'a4', orientation: 'portrait', compress: true });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 18;
  const imageWidth = pageWidth - margin * 2;
  const ratio = imageWidth / canvas.width;
  const sliceHeight = Math.max(200, Math.floor((pageHeight - margin * 2) / ratio));
  const background = themeBackground();
  let offset = 0, page = 0;
  while (offset < canvas.height) {
    const height = Math.min(sliceHeight, canvas.height - offset);
    const slice = document.createElement('canvas');
    slice.width = canvas.width;
    slice.height = height;
    const context = slice.getContext('2d');
    context.fillStyle = background;
    context.fillRect(0, 0, slice.width, slice.height);
    context.drawImage(canvas, 0, offset, canvas.width, height, 0, 0, canvas.width, height);
    if (page) pdf.addPage();
    pdf.addImage(slice.toDataURL('image/jpeg', 0.94), 'JPEG', margin, margin, imageWidth, height * ratio);
    page++;
    offset += height;
  }
  pdf.save(fileName(filename, 'pdf'));
  return { pages: page, width: canvas.width, height: canvas.height };
}

window.QCCapture = { download, downloadPdf, toCanvas };
})();
