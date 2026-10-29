'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { browser } = require('./helpers');

test('PDF captures every page in bounded tiles, including horizontal overflow, and cleans up on error', async (t) => {
  const { w, dom } = browser(); t.after(() => dom.window.close());
  const source = w.document.createElement('div');
  source.innerHTML = '<table><tbody><tr><td>row</td></tr></tbody></table>';
  w.HTMLTableRowElement.prototype.getBoundingClientRect = () => ({ top: 2050, bottom: 2250 });
  w.document.body.appendChild(source);
  source.getBoundingClientRect = () => ({ width: 1200, height: 300 });
  const proto = w.HTMLElement.prototype;
  Object.defineProperty(proto, 'scrollWidth', { configurable: true, get() { return this.className === 'capture-host' ? 1500 : 0; } });
  Object.defineProperty(proto, 'clientWidth', { configurable: true, get() { return this.className === 'capture-host' ? (parseFloat(this.style.width) || 0) : 0; } });
  Object.defineProperty(proto, 'scrollHeight', { configurable: true, get() { return this.className === 'capture-host' ? 52000 : 0; } });
  const tiles = [], images = [], saved = [], pdfOptions = [];
  const originalCreate = w.document.createElement.bind(w.document);
  w.document.createElement = (name, ...args) => {
    const el = originalCreate(name, ...args);
    if (name === 'canvas') { el.getContext = () => ({ fillRect() {}, drawImage() {} }); el.toDataURL = () => 'data:image/jpeg;base64,abc'; }
    return el;
  };
  w.html2canvas = async (host, opts) => {
    assert.equal(host.style.padding, '0px'); assert.equal(host.firstChild.style.width, '100%');
    tiles.push(opts); return { width: 100, height: 100, toDataURL: () => 'data:image/jpeg;base64,abc' };
  };
  w.jspdf = { jsPDF: class {
    constructor(opts) { pdfOptions.push(opts); this.internal = { pageSize: { getWidth: () => 595, getHeight: () => 842 } }; }
    addPage() {} addImage(...args) { images.push(args); } save(name) { saved.push(name); }
  } };
  const result = await w.QCCapture.downloadPdf(source, 'profile');
  assert.equal(result.width, 1500); assert.equal(result.height, 52000);
  assert.equal(pdfOptions[0].orientation, 'landscape');
  assert.ok(Math.abs(images[0][5] - 2050 * 559 / 1500) < 0.01, 'first page ends before the row, not through it');
  assert.equal(images.length, result.pages); assert.ok(result.pages > 20); assert.ok(tiles.length < result.pages, 'multiple pages are captured per bounded batch');
  let end = 0;
  for (const tile of tiles) {
    assert.equal(tile.width, 1500); assert.equal(tile.y, end); assert.ok(tile.height * tile.scale <= 6000);
    end += tile.height;
  }
  assert.equal(end, 52000); assert.deepEqual(saved, ['profile.pdf']); assert.equal(w.document.querySelector('.capture-host'), null);
  w.html2canvas = async () => { throw new Error('render failed'); };
  await assert.rejects(w.QCCapture.downloadPdf(source, 'profile'), /render failed/);
  assert.equal(w.document.querySelector('.capture-host'), null);
});
