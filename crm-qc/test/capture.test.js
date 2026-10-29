'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { browser } = require('./helpers');

test('PDF captures every page in bounded tiles, including horizontal overflow, and cleans up on error', async (t) => {
  const { w, dom } = browser(); t.after(() => dom.window.close());
  const source = w.document.createElement('div'); w.document.body.appendChild(source);
  source.getBoundingClientRect = () => ({ width: 1200, height: 300 });
  const proto = w.HTMLElement.prototype;
  Object.defineProperty(proto, 'scrollWidth', { configurable: true, get() { return this.className === 'capture-host' ? 1500 : 0; } });
  Object.defineProperty(proto, 'clientWidth', { configurable: true, get() { return this.className === 'capture-host' ? (parseFloat(this.style.width) || 0) : 0; } });
  Object.defineProperty(proto, 'scrollHeight', { configurable: true, get() { return this.className === 'capture-host' ? 52000 : 0; } });
  const tiles = [], images = [], saved = [];
  w.html2canvas = async (host, opts) => {
    assert.equal(host.style.padding, '0px'); assert.equal(host.firstChild.style.width, '100%');
    tiles.push(opts); return { width: 100, height: 100, toDataURL: () => 'data:image/jpeg;base64,abc' };
  };
  w.jspdf = { jsPDF: class {
    constructor() { this.internal = { pageSize: { getWidth: () => 595, getHeight: () => 842 } }; }
    addPage() {} addImage(...args) { images.push(args); } save(name) { saved.push(name); }
  } };
  const result = await w.QCCapture.downloadPdf(source, 'profile');
  assert.equal(result.width, 1500); assert.equal(result.height, 52000);
  assert.equal(result.pages, tiles.length); assert.equal(images.length, tiles.length); assert.ok(tiles.length > 20);
  let end = 0;
  for (const tile of tiles) {
    assert.equal(tile.width, 1500); assert.equal(tile.y, end); assert.ok(tile.height * tile.scale <= 4000);
    end += tile.height;
  }
  assert.equal(end, 52000); assert.deepEqual(saved, ['profile.pdf']); assert.equal(w.document.querySelector('.capture-host'), null);
  w.html2canvas = async () => { throw new Error('render failed'); };
  await assert.rejects(w.QCCapture.downloadPdf(source, 'profile'), /render failed/);
  assert.equal(w.document.querySelector('.capture-host'), null);
});
