#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const CRM = path.resolve(__dirname, '..');
const PUBLIC = path.join(CRM, 'public');
const SHARED = path.join(CRM, 'shared');
const MODULES = path.join(CRM, 'node_modules');

/* Two deployment flavours:
 *   cdn     (default) — vendor libraries/fonts stay on jsDelivr, so the HTML files
 *                       are small enough to paste into the Apps Script editor.
 *   --offline          — everything inlined; no external request, but multi-MB files
 *                       that realistically need `clasp push`. */
const MODE = process.argv.includes('--offline') ? 'offline' : 'cdn';
const OUT = MODE === 'offline' ? path.join(CRM, 'apps-script-full', 'offline') : path.join(CRM, 'apps-script-full');
const SERVER_SOURCE = path.join(CRM, 'apps-script-full', 'Server.gs');

/* public/vendor/* → npm package + published file. Versions come from the
 * installed packages, and each mapped file must exist locally so a wrong path
 * fails the build instead of shipping a dead CDN link. */
const VENDOR_CDN = {
  'vendor/chart.umd.min.js': ['chart.js', 'dist/chart.umd.min.js'],
  'vendor/xlsx.full.min.js': ['xlsx', 'dist/xlsx.full.min.js'],
  'vendor/exceljs.min.js': ['exceljs', 'dist/exceljs.min.js'],
  'vendor/html2canvas.min.js': ['html2canvas', 'dist/html2canvas.min.js'],
  'vendor/jspdf.umd.min.js': ['jspdf', 'dist/jspdf.umd.min.js'],
  'vendor/jszip.min.js': ['jszip', 'dist/jszip.min.js']
};
const FONT_AWESOME_PKG = '@fortawesome/fontawesome-free';
const VAZIR_PKG = '@fontsource/vazirmatn';

function read(file) { return fs.readFileSync(file, 'utf8'); }
function installedVersion(pkg) {
  const manifest = path.join(MODULES, ...pkg.split('/'), 'package.json');
  if (!fs.existsSync(manifest)) throw new Error(`Missing dependency ${pkg}. Run: npm --prefix crm-qc ci`);
  return JSON.parse(read(manifest)).version;
}
function jsDelivr(pkg, file) {
  if (!fs.existsSync(path.join(MODULES, ...pkg.split('/'), file))) {
    throw new Error(`CDN mapping is stale: ${pkg}@…/${file} is not in node_modules`);
  }
  return `https://cdn.jsdelivr.net/npm/${pkg}@${installedVersion(pkg)}/${file}`;
}
function dataUri(file) {
  const ext = path.extname(file).toLowerCase();
  const mime = ({
    '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.otf': 'font/otf',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml',
    '.gif': 'image/gif', '.webp': 'image/webp'
  })[ext] || 'application/octet-stream';
  return `data:${mime};base64,${fs.readFileSync(file).toString('base64')}`;
}
function safeInlineScript(source) {
  // A literal `</script` inside inlined vendor code would close the element early.
  return source.replace(/<\/script/gi, '<\\/script');
}
function safeInlineStyle(source) {
  return source.replace(/<\/style/gi, '<\\/style');
}
function inlineCss(source, baseDir) {
  return source.replace(/url\(\s*(['"]?)(.*?)\1\s*\)/gi, (whole, quote, rawUrl) => {
    const url = String(rawUrl || '').trim();
    if (!url || /^(?:data:|https?:|\/\/|#)/i.test(url)) return whole;
    const cleanUrl = url.split('?')[0];
    const file = path.resolve(baseDir, cleanUrl);
    if (!file.startsWith(CRM + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return whole;
    return `url("${dataUri(file)}")`;
  });
}
function styleTag(css, label) {
  return `\n<style>/* ${label} */\n${safeInlineStyle(css)}\n</style>\n`;
}
function scriptTag(source, label) {
  return `\n<script>/* ${label} */\n${safeInlineScript(source)}\n</script>\n`;
}
function fontAwesomeCss() {
  const file = path.join(MODULES, ...FONT_AWESOME_PKG.split('/'), 'css', 'all.min.css');
  if (!fs.existsSync(file)) throw new Error('Font Awesome dependency is missing. Run npm ci first.');
  return inlineCss(read(file), path.dirname(file));
}
function fontAwesomeTag() {
  if (MODE === 'cdn') return `\n<link rel="stylesheet" href="${jsDelivr(FONT_AWESOME_PKG, 'css/all.min.css')}">\n`;
  return styleTag(fontAwesomeCss(), 'bundled Font Awesome');
}
function vazirCss() {
  const file = path.join(PUBLIC, 'fonts.css');
  if (MODE === 'cdn') {
    // fonts.css points at ./vendor/vazirmatn/*.woff2 — serve those from jsDelivr.
    return read(file).replace(/url\(\.\/vendor\/vazirmatn\/([^)]+)\)/g, (whole, name) => {
      const cleaned = name.replace(/["']/g, '').trim();
      return `url(${jsDelivr(VAZIR_PKG, 'files/' + cleaned)})`;
    });
  }
  return inlineCss(read(file), PUBLIC);
}
/* Vendor libraries: either an external CDN tag (small file) or inlined (offline). */
function vendorScriptTag(cleanPath) {
  const mapping = VENDOR_CDN[cleanPath];
  if (MODE === 'cdn') {
    if (!mapping) throw new Error(`No CDN mapping for ${cleanPath}`);
    return `\n<script src="${jsDelivr(mapping[0], mapping[1])}"></script>\n`;
  }
  const file = mapping ? path.join(MODULES, ...mapping[0].split('/'), mapping[1]) : path.join(PUBLIC, cleanPath);
  if (!fs.existsSync(file)) throw new Error(`Cannot bundle vendor script ${cleanPath}`);
  return scriptTag(read(file), cleanPath);
}

function buildCode() {
  const runtime = `/* GENERATED by scripts/build-apps-script.js — do not edit this output directly. */
var window = globalThis;
window.APP_SCRIPT_SERVER = true;
var localStorage = {
  getItem: function () { return null; },
  setItem: function () {},
  removeItem: function () {}
};
function URLSearchParams(value) {
  this._pairs = [];
  String(value || '').replace(/^\\?/, '').split('&').forEach(function (part) {
    if (!part) return;
    var at = part.indexOf('=');
    var key = at < 0 ? part : part.slice(0, at);
    var val = at < 0 ? '' : part.slice(at + 1);
    try { key = decodeURIComponent(key.replace(/\\+/g, ' ')); } catch (ignored) {}
    try { val = decodeURIComponent(val.replace(/\\+/g, ' ')); } catch (ignored) {}
    this._pairs.push([key, val]);
  }, this);
}
URLSearchParams.prototype.forEach = function (callback, context) {
  this._pairs.forEach(function (pair) { callback.call(context, pair[1], pair[0], this); }, this);
};

`;
  const sharedOrder = ['calc.js', 'parseQc.js', 'reports.js', 'registry.js', 'importData.js', 'expertRef.js', 'access.js', 'fiscal.js', 'elements.js'];
  const shared = sharedOrder.map((name) => {
    const src = read(path.join(SHARED, name)).replace(/typeof self !== 'undefined' \? self : this/g, 'globalThis');
    return `\n/* ---- shared/${name} ---- */\n${src}\n`;
  }).join('\n');
  const seed = JSON.parse(read(path.join(CRM, 'data', 'seed.json')));
  const seedCode = `\n/* ---- Initial reference data; copied into tabs only by setupStandaloneApp. ---- */\nwindow.QC_SEED = ${JSON.stringify(seed)};\n`;
  let storage = read(path.join(PUBLIC, 'storage.js'));
  if (!storage.includes('run(method, url, body)')) throw new Error('LocalApi.run() is missing from public/storage.js');
  storage = storage.replace(/typeof self !== 'undefined' \? self : this/g, 'globalThis');
  const server = read(SERVER_SOURCE);
  return runtime + shared + seedCode + '\n/* ---- Shared API router adapted from public/storage.js ---- */\n' + storage + '\n' + server;
}

function makeIndex() {
  let html = read(path.join(PUBLIC, 'index.html'));
  const vazir = vazirCss();

  // The full Sheets app is already connected directly to the workbook, so hide
  // the optional Node-to-Sheets connector from this standalone build.
  html = html.replace(/\s*<a href="#\/sheets"[\s\S]*?<\/a>/i, '');
  html = html.replace(/<link[^>]+(?:rel=["'](?:icon|manifest|apple-touch-icon|shortcut icon)["']|href=["'][^"']*(?:favicon|manifest|apple-touch-icon)[^"']*["'])[^>]*>/gi, '');

  const inlineStyles = {
    'styles.css': inlineCss(read(path.join(PUBLIC, 'styles.css')), PUBLIC),
    'enhancements.css': inlineCss(read(path.join(PUBLIC, 'enhancements.css')), PUBLIC)
  };
  html = html.replace(/<link\b[^>]*href=["']([^"']+)["'][^>]*>/gi, (tag, href) => {
    if (/vendor\/fontawesome\/css\/all\.min\.css/i.test(href)) return fontAwesomeTag();
    const key = href.split(/[?#]/)[0];
    if (key === 'styles.css' || key === 'enhancements.css') return styleTag(inlineStyles[key], `bundled ${key}`);
    if (/^(?:vendor\/|fonts\.css)/i.test(key)) return '';
    return tag;
  });
  html = html.replace('</head>', `${styleTag(vazir, 'bundled Vazirmatn fonts')}\n</head>`);

  // One small logo is shared by every page instead of repeating a big data URI.
  const logo = dataUri(path.join(PUBLIC, 'icon-192.png'));
  html = html.replace(/src=(["'])logo\.png(?:\?[^"']*)?\1/g, 'data-app-logo src=""');

  const bridge = `<script>
window.APP_SCRIPT_MODE = true;
window.APP_SCRIPT_URL = '__QC_APP_SCRIPT_URL__';
window.APP_SCRIPT_LOGO_DATA = "${logo}";
document.addEventListener('DOMContentLoaded', function () {
  document.querySelectorAll('img[data-app-logo]').forEach(function (img) { img.src = window.APP_SCRIPT_LOGO_DATA; });
});
(function () {
  var nativeFetch = window.fetch ? window.fetch.bind(window) : null;
  function response(packet) {
    packet = packet || {};
    var status = Number(packet.status) || 500;
    var payload = packet.data == null ? { error: 'پاسخ Apps Script خالی بود.' } : packet.data;
    return { ok: status >= 200 && status < 300, status: status,
      json: function () { return Promise.resolve(payload); },
      text: function () { return Promise.resolve(JSON.stringify(payload)); } };
  }

  /* Every google.script.run round trip costs a few hundred milliseconds, so
   * identical GETs are deduplicated while in flight and their answers are
   * reused for a moment. Any write drops the cache immediately. */
  var GET_TTL_MS = 4000;
  var answered = {};
  var pending = {};
  function dropGetCache() { answered = {}; }

  function send(method, requestUrl, body) {
    return new Promise(function (resolve) {
      if (!window.google || !google.script || !google.script.run) {
        resolve({ status: 503, data: { error: 'این سامانه باید از لینک Web App در Google Apps Script باز شود.' } });
        return;
      }
      google.script.run
        .withSuccessHandler(function (packet) { resolve(packet); })
        .withFailureHandler(function (error) {
          resolve({ status: 500, data: { error: String(error && error.message || error || 'خطای Apps Script') } });
        })
        .crmqcApi(method, requestUrl, body, (window.QCAuth && window.QCAuth.token) || '');
    });
  }

  window.fetch = function (input, init) {
    var requestUrl = typeof input === 'string' ? input : (input && input.url) || '';
    if (!/^\\/api\\//.test(requestUrl)) return nativeFetch ? nativeFetch(input, init) : Promise.resolve(response({status:503,data:{error:'درخواست شبکه در دسترس نیست.'}}));
    init = init || {};
    var method = String(init.method || 'GET').toUpperCase();
    var body = {};
    if (init.body) {
      try { body = typeof init.body === 'string' ? JSON.parse(init.body) : init.body; }
      catch (error) { return Promise.resolve(response({status:400,data:{error:'JSON درخواست نامعتبر است.'}})); }
    }

    if (method !== 'GET') {
      dropGetCache();
      return send(method, requestUrl, body).then(function (packet) {
        dropGetCache();
        return response(packet);
      });
    }

    var hit = answered[requestUrl];
    if (hit && Date.now() - hit.at < GET_TTL_MS) return Promise.resolve(response(hit.packet));
    if (pending[requestUrl]) return pending[requestUrl];

    var request = send(method, requestUrl, body).then(function (packet) {
      delete pending[requestUrl];
      if (packet && Number(packet.status) === 200) answered[requestUrl] = { at: Date.now(), packet: packet };
      return response(packet);
    });
    pending[requestUrl] = request;
    return request;
  };
})();
</script>`;
  html = html.replace(/<script>\s*App\.init\(\);\s*<\/script>/i, `${bridge}\n<script>App.init();</script>`);

  html = html.replace(/<script\b[^>]*src=["']([^"']+)["'][^>]*>\s*<\/script>/gi, (tag, src) => {
    const clean = src.split(/[?#]/)[0].replace(/^\/+/, '');
    if (clean === 'pages/sheets.js') return '';
    if (clean.startsWith('vendor/')) return vendorScriptTag(clean);
    const file = path.resolve(PUBLIC, clean);
    if (!file.startsWith(PUBLIC + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      throw new Error(`Cannot bundle script ${src} referenced by public/index.html`);
    }
    return scriptTag(read(file), clean);
  });
  return html;
}

function makeCallReport() {
  let html = read(path.join(PUBLIC, 'call-admin-report.html'));
  const vazir = vazirCss();
  const logo = dataUri(path.join(PUBLIC, 'icon-192.png'));

  // Remove incidental challenge-platform snippets copied into this legacy page.
  html = html.replace(/<script\b[^>]*>[\s\S]*?__CF\$cv\.params[\s\S]*?<\/script>/gi, '');
  html = html.replace(/<link\b[^>]*href=["'][^"']*(?:favicon|apple-touch-icon)[^"']*["'][^>]*>/gi, '');
  html = html.replace(/src=(["'])logo\.png(?:\?[^"']*)?\1/g, 'data-app-logo src=""');
  html = html.replace(/<link\b[^>]*href=["']vendor\/fontawesome\/css\/all\.min\.css["'][^>]*>/gi, fontAwesomeTag());
  html = html.replace(/<link\b[^>]*href=["']callReportTheme\.css["'][^>]*>/gi, styleTag(inlineCss(read(path.join(PUBLIC, 'callReportTheme.css')), PUBLIC), 'bundled call report theme'));
  html = html.replace(/@import\s+url\(["']?\.\/fonts\.css["']?\)\s*;/gi, vazir);

  html = html.replace(/<script\b[^>]*src=["']([^"']+)["'][^>]*>\s*<\/script>/gi, (tag, src) => {
    const clean = src.split(/[?#]/)[0].replace(/^\/+/, '');
    if (clean.startsWith('vendor/')) return vendorScriptTag(clean);
    const file = path.resolve(PUBLIC, clean);
    if (!file.startsWith(PUBLIC + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      throw new Error(`Cannot bundle call-report script ${src}`);
    }
    return scriptTag(read(file), `call-report ${clean}`);
  });

  const backCss = `
.crmqc-back { position: fixed; inset-inline-start: 14px; bottom: 14px; z-index: 99999; display: flex; gap: 6px;
  padding: 6px; border-radius: 14px; background: rgba(11,18,32,.86); border: 1px solid rgba(148,163,184,.35);
  box-shadow: 0 10px 26px rgba(2,6,23,.4); backdrop-filter: blur(6px); }
.crmqc-back a { display: inline-flex; align-items: center; gap: 6px; padding: 8px 13px; border-radius: 10px;
  font: 700 12.5px Vazirmatn, sans-serif; text-decoration: none; color: #e2e8f0; background: rgba(148,163,184,.14); }
.crmqc-back a.crmqc-back-main { background: linear-gradient(135deg,#22c55e,#16a34a); color: #06210f; }
.crmqc-back a:hover { filter: brightness(1.08); }
@media print { .crmqc-back { display: none !important; } }
`;

  const bridge = `<script>
window.APP_SCRIPT_MODE = true;
(function () {
  document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('img[data-app-logo]').forEach(function (img) { img.src = "${logo}"; });
  });

  /* این صفحه در Apps Script جدا از سامانه باز می‌شود؛ دکمه‌ی بازگشت می‌گذارد
   * کاربر بدون گم‌شدن به SPA برگردد (بند ۱۱). */
  document.addEventListener('DOMContentLoaded', function () {
    if (document.querySelector('.crmqc-back')) return;
    var base = String(window.location.href).split('?')[0];
    var bar = document.createElement('div');
    bar.className = 'crmqc-back';
    bar.innerHTML = '<a class="crmqc-back-main" href="' + base + '" target="_top">' +
      '<i class="fa-solid fa-arrow-right"></i> بازگشت به سامانه QC</a>' +
      '<a class="crmqc-back-tab" href="' + base + '" target="_blank" rel="noopener">تب جدید</a>';
    document.body.appendChild(bar);
  });

  var encoded = '__QC_CALL_REPORT_STORAGE_B64__';
  var keys = {};
  try {
    if (encoded.indexOf('__QC_') !== 0) {
      var binary = atob(encoded), escaped = '';
      for (var i = 0; i < binary.length; i++) escaped += '%' + ('0' + binary.charCodeAt(i).toString(16)).slice(-2);
      keys = JSON.parse(decodeURIComponent(escaped)) || {};
    }
  } catch (error) { console.warn('تنظیمات گزارش تماس از شیت خوانده نشد', error); }
  window.__CALL_REPORT_SHEETS_STORAGE__ = keys;

  /* localStorage در فریم شنی گوگل ممکن است اصلاً در دسترس نباشد (خطای SecurityError).
   * در آن صورت یک حافظه‌ی موقت با همان رابط ساخته می‌شود تا ابزار گزارش تماس
   * متوقف نشود؛ دو کلید پیکربندی همچنان روی تب‌های اختصاصی شیت می‌نشینند. */
  (function installStorageBridge() {
    var memory = {};
    function persist(key, value) {
      if (!Object.prototype.hasOwnProperty.call(keys, key)) return;
      keys[key] = String(value);
      if (window.google && google.script && google.script.run) {
        google.script.run
          .withFailureHandler(function (error) { console.error('ذخیره تنظیمات گزارش تماس در شیت ناموفق بود', error); })
          .saveCallReportSetting(key, String(value));
      }
    }
    var shim = {
      getItem: function (key) {
        if (Object.prototype.hasOwnProperty.call(keys, key)) return keys[key];
        return Object.prototype.hasOwnProperty.call(memory, key) ? memory[key] : null;
      },
      setItem: function (key, value) { memory[key] = String(value); persist(key, value); },
      removeItem: function (key) { delete memory[key]; },
      clear: function () { memory = {}; },
      key: function (i) { return Object.keys(memory)[i] || null; },
      length: 0
    };
    var real = null;
    try { real = window.localStorage; if (real) real.getItem('__crmqc_probe__'); }
    catch (error) { real = null; }
    if (!real) {
      try { Object.defineProperty(window, 'localStorage', { value: shim, configurable: true }); }
      catch (error) { window.localStorage = shim; }
      return;
    }
    try {
      var prototype = (typeof Storage !== 'undefined' && Storage.prototype) || Object.getPrototypeOf(real);
      var oldGet = prototype.getItem, oldSet = prototype.setItem;
      prototype.getItem = function (key) {
        if (Object.prototype.hasOwnProperty.call(keys, key)) return keys[key];
        try { return oldGet.call(this, key); } catch (error) { return shim.getItem(key); }
      };
      prototype.setItem = function (key, value) {
        try { oldSet.call(this, key, value); } catch (error) { memory[key] = String(value); }
        persist(key, value);
      };
    } catch (error) { console.warn('اتصال تنظیمات گزارش تماس به شیت فعال نشد', error); }
  })();
})();
</script>`;
  html = html.replace('<head>', `<head>\n${bridge}\n${styleTag(backCss, 'bundled back-to-app button')}`);
  return html;
}

function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const outputs = {
    'Code.gs': buildCode(),
    'Index.html': makeIndex(),
    'CallReport.html': makeCallReport(),
    'appsscript.json': read(path.join(CRM, 'apps-script-full', 'appsscript.json'))
  };
  console.log(`build mode: ${MODE} → ${path.relative(CRM, OUT)}/`);
  for (const [name, content] of Object.entries(outputs)) {
    const file = path.join(OUT, name);
    fs.writeFileSync(file, content, 'utf8');
    console.log(`  ${name}: ${Buffer.byteLength(content, 'utf8').toLocaleString()} bytes`);
  }
}

try { main(); }
catch (error) { console.error(error.stack || error); process.exitCode = 1; }
