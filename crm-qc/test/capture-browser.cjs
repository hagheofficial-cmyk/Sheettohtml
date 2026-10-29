/* Optional real-browser regression: npm i --no-save --package-lock=false playwright-core @sparticuz/chromium */
'use strict';
const { chromium } = require('playwright-core');
const mod = require('@sparticuz/chromium');
const binary = mod.default || mod;
const path = require('node:path');
const assert = require('node:assert/strict');
const ROOT = path.resolve(__dirname, '..');
(async () => {
  const libraries = await mod.inflate(path.join(ROOT, 'node_modules/@sparticuz/chromium/bin/al2023.tar.br'));
  const browser = await chromium.launch({ executablePath: await binary.executablePath(), args: binary.args,
    headless: true, env: { ...process.env, LD_LIBRARY_PATH: path.join(libraries, 'lib') + ':' + (process.env.LD_LIBRARY_PATH || '') } });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.setContent('<html><body><div id="profile" class="profile-content"><div class="grid" style="grid-template-columns:repeat(2,1fr)"><div style="height:170px">A</div><div style="height:170px">B</div></div><div class="history-wrap table-wrap"><table class="tbl profile-call-table"><tbody>' +
      Array.from({length: 22}, (_, i) => `<tr style="height:180px"><td><div class="left-marker" style="background:rgb(255,0,0);width:25px;height:25px"></div></td><td>row ${i} ${'long comment '.repeat(8)}</td><td><div class="right-marker" style="background:rgb(0,0,255);width:25px;height:25px"></div></td></tr>`).join('') +
      '</tbody></table></div></div></body></html>');
    await page.addStyleTag({path:path.join(ROOT,'public/styles.css')});
    await page.addStyleTag({path:path.join(ROOT,'public/enhancements.css')});
    await page.addScriptTag({path:path.join(ROOT,'node_modules/html2canvas/dist/html2canvas.min.js')});
    await page.addScriptTag({path:path.join(ROOT,'node_modules/jspdf/dist/jspdf.umd.min.js')});
    await page.addScriptTag({path:path.join(ROOT,'public/capture.js')});
    const out = await page.evaluate(async () => {
      const originalCanvas = window.html2canvas, realPdf = window.jspdf.jsPDF;
      const samples = [], tiles = [];
      window.jspdf.jsPDF = function (opts) { const pdf = new realPdf(opts); pdf.save = () => {}; return pdf; };
      window.html2canvas = async (host, opts) => {
        const canvas = await originalCanvas(host, opts); tiles.push({y:opts.y, height:opts.height, width:opts.width});
        const rect = host.getBoundingClientRect(); const ctx = canvas.getContext('2d');
        for (const marker of host.querySelectorAll('.left-marker,.right-marker')) {
          const r = marker.getBoundingClientRect(); const x = r.left + r.width / 2 - rect.left; const y = r.top + r.height / 2 - rect.top;
          if (y < opts.y || y >= opts.y + opts.height) continue;
          const pixel = ctx.getImageData(Math.floor(x * opts.scale), Math.floor((y - opts.y) * opts.scale), 1, 1).data;
          samples.push({name:marker.className, r:pixel[0], g:pixel[1], b:pixel[2]});
        }
        return canvas;
      };
      const visibleHeight = document.querySelector('.history-wrap').clientHeight;
      const result = await QCCapture.downloadPdf(document.querySelector('#profile'), 'test');
      return {result, tiles, samples, visibleHeight, hostLeft:document.querySelectorAll('.capture-host').length};
    });
    assert.ok(out.result.pages >= 3); assert.ok(out.result.height > out.visibleHeight * 4);
    assert.equal(out.tiles[0].y, 0); assert.equal(out.tiles.at(-1).y + out.tiles.at(-1).height, out.result.height);
    assert.equal(out.samples.length, 44, 'all left and right markers are visible through the PDF tiles');
    for (const sample of out.samples) {
      if (sample.name === 'left-marker') assert.ok(sample.r > 230 && sample.b < 30, JSON.stringify(sample));
      else assert.ok(sample.b > 230 && sample.r < 30, JSON.stringify(sample));
    }
    assert.equal(out.hostLeft, 0);
    console.log('Real Chromium PDF capture: all 22 rows and both edge columns rendered across', out.result.pages, 'pages.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
