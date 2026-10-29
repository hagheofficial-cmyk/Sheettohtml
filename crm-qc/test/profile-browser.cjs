/* Optional real-browser profile/PDF regression: npm i --no-save --package-lock=false playwright-core @sparticuz/chromium */
'use strict';
const { chromium } = require('playwright-core');
const mod = require('@sparticuz/chromium'), binary = mod.default || mod;
const path = require('node:path'), fs = require('node:fs'), assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const ROOT = path.resolve(__dirname, '..');
(async () => {
  const libraries = await mod.inflate(path.join(ROOT, 'node_modules/@sparticuz/chromium/bin/al2023.tar.br'));
  const browser = await chromium.launch({ executablePath: await binary.executablePath(), args: binary.args, headless: true,
    env: { ...process.env, LD_LIBRARY_PATH: path.join(libraries, 'lib') + ':' + (process.env.LD_LIBRARY_PATH || '') } });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(pathToFileURL(path.join(ROOT, '../HTML اصلی/index.html')).href, {waitUntil:'domcontentloaded'});
    await page.waitForFunction(() => window.App && document.querySelector('#cntC'));
    await page.selectOption('#gPreset', 'all');
    await page.waitForFunction(() => document.querySelector('#cntC').textContent === '۸۱');
    await page.evaluate(() => { location.hash = '#/portfolio'; });
    await page.waitForSelector('#pAll tr[data-name="الهه عسگری"]');
    await page.locator('#pAll tr[data-name="الهه عسگری"]').evaluate(el => el.click());
    await page.waitForSelector('#pCallHistory tbody tr');
    for (const width of [1440, 390]) {
      await page.setViewportSize({width, height:900});
      const result = await page.evaluate(() => {
        const table = document.querySelector('#pCallHistory'), wrap = table.closest('.profile-call-wrap');
        const tb = table.getBoundingClientRect(), wb = wrap.getBoundingClientRect();
        const headers = [...table.querySelectorAll('thead tr:last-child th')].map(h => h.getBoundingClientRect());
        return {tw:tb.width, ww:wb.width, scroll:table.scrollWidth, client:table.clientWidth,
          left:Math.min(...headers.map(r=>r.left)), right:Math.max(...headers.map(r=>r.right)), wrapLeft:wb.left, wrapRight:wb.right,
          columns:headers.length, nested:table.querySelectorAll('table,.profile-elements').length, rows:table.tBodies[0].rows.length};
      });
      assert.ok(result.columns > 15, JSON.stringify(result)); assert.ok(result.rows > 0);
      assert.equal(result.nested, 0);
      assert.ok(result.tw <= result.ww + 2 && result.scroll <= result.client + 2, JSON.stringify(result));
      assert.ok(result.left >= result.wrapLeft - 2 && result.right <= result.wrapRight + 2, JSON.stringify(result));
      console.log('Viewport', width, ':', result.columns, 'columns fit within', Math.round(result.ww), 'px.');
    }
    await page.setViewportSize({width:1440,height:900});
    const overflow = await page.evaluate(() => {
      const source = document.querySelector('#pBody'), host = document.createElement('div');
      host.className = 'capture-host'; host.style.cssText = 'width:1200px;box-sizing:border-box;padding:0';
      const copy = source.cloneNode(true); copy.style.width = '100%';
      const originalCanvases = [...source.querySelectorAll('canvas')];
      copy.querySelectorAll('canvas').forEach((canvas, i) => {
        const rect = originalCanvases[i].getBoundingClientRect(), img = document.createElement('img');
        img.src = originalCanvases[i].toDataURL('image/png');
        if (rect.width && rect.height) { img.width = Math.round(rect.width); img.height = Math.round(rect.height); }
        img.style.cssText = 'display:block;max-width:100%;height:auto;width:' + (rect.width ? Math.round(rect.width) + 'px' : '100%');
        canvas.replaceWith(img);
      });
      host.appendChild(copy); document.body.appendChild(host);
      const h = host.getBoundingClientRect();
      const escaped = [...host.querySelectorAll('*')].filter(node => { const r = node.getBoundingClientRect(); return r.width && (r.left < h.left - 2 || r.right > h.right + 2); });
      const result = {count:escaped.length, width:host.scrollWidth, client:host.clientWidth, nodes:escaped.map(n => ({tag:n.tagName, cls:n.className, text:(n.textContent||'').slice(0,60), left:n.getBoundingClientRect().left,right:n.getBoundingClientRect().right}))}; host.remove(); return result;
    });
    assert.equal(overflow.count, 0, 'capture must not clip elements on either edge: ' + JSON.stringify(overflow));
    assert.ok(overflow.width <= overflow.client + 2, JSON.stringify(overflow));
    const download = page.waitForEvent('download', {timeout:120000});
    await page.locator('#pPdf').click();
    const pdf = await download;
    const file = path.join(ROOT, 'node_modules/.cache/profile-test.pdf');
    fs.mkdirSync(path.dirname(file), {recursive:true}); await pdf.saveAs(file);
    const raw = fs.readFileSync(file); assert.equal(raw.subarray(0, 5).toString(), '%PDF-');
    const text = raw.toString('latin1'); const count = Number((text.match(/\/Count\s+(\d+)/) || [])[1]);
    assert.ok(count > 1, `PDF page count: ${count}`);
    const media = text.match(/\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)/);
    assert.ok(media && Number(media[1]) > Number(media[2]), 'PDF is landscape');
    assert.equal(await page.locator('.capture-host').count(), 0);
    assert.deepEqual(errors, []);
    console.log('Actual profile downloaded a', count, 'page landscape PDF of', raw.length, 'bytes.');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
