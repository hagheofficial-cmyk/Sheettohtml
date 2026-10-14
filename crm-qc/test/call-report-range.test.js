'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const C = require('../shared/calc');
const { ROOT } = require('./helpers');

function child(query = '') {
  const dom = new JSDOM('<div id="resultSection" style="display:block"></div>', {
    url: 'http://qc.test/call-admin-report.html' + query, runScripts: 'outside-only'
  });
  const w = dom.window; w.QCCalc = C;
  w.eval(`var allRawCallLogs = [{ dateStr: '1405/06/20' }, { dateStr: '2026-09-12' }];
    var selectedDatesSet = new Set(allRawCallLogs.map(r => r.dateStr));
    var allResults = [], visibleCalls = [];
    function buildDateCheckboxes(dates) { window.dateChoices = dates; }
    function recomputeResultsFromRawLogs() {
      visibleCalls = allRawCallLogs.filter(r => selectedDatesSet.has(r.dateStr) && QCReportRange.matches(r.dateStr));
      allResults = [{ totalCalls: visibleCalls.length }];
      QCReportRange.afterRecompute();
    }`);
  w.eval(fs.readFileSync(path.join(ROOT, 'public/callReportRange.js'), 'utf8'));
  const send = (range, options = {}) => w.dispatchEvent(new w.MessageEvent('message', {
    source: options.source || w.parent, origin: options.origin || w.location.origin,
    data: { type: 'crmqc:date-range', range }
  }));
  return { dom, w, send };
}

test('independent call report follows initial query and parent dates, without merging either data store', (t) => {
  const { dom, w, send } = child('?qcFrom=1405%2F06%2F20&qcTo=1405%2F06%2F20');
  t.after(() => dom.window.close());
  assert.equal(w.visibleCalls.length, 1); assert.equal(w.visibleCalls[0].dateStr, '1405/06/20');
  send({ from: '1403/01/01', to: '1403/01/01' });
  assert.equal(w.QCReportRange.matches('1403/01/01'), true);
  assert.equal(w.QCReportRange.matches('1403/01/01 (عمومی)'), false);
  send({ from: '1405/06/20', to: '1405/06/20' });
  send({ from: '1405/06/21', to: '1405/06/21' });
  assert.equal(w.visibleCalls.length, 1); assert.equal(w.visibleCalls[0].dateStr, '2026-09-12');
  send({ from: 'bad' }); assert.equal(w.visibleCalls.length, 1);
  send({ from: '1405/06/22', to: '1405/06/20' }); assert.equal(w.visibleCalls[0].dateStr, '2026-09-12');
  send({ from: '1405/06/20', to: '1405/06/20' }, { source: {} });
  assert.equal(w.visibleCalls[0].dateStr, '2026-09-12');
  send({ from: '1405/06/20', to: '1405/06/20' }, { origin: 'http://untrusted.test' });
  assert.equal(w.visibleCalls[0].dateStr, '2026-09-12');
  send({}); assert.equal(w.visibleCalls.length, 2);
});

test('legacy summary without per-call dates is explicitly blocked for a range, not shown as filtered', (t) => {
  const { dom, w, send } = child(); t.after(() => dom.window.close());
  w.allRawCallLogs = []; w.allResults = [{ totalCalls: 50 }];
  send({ from: '1405/06/20', to: '1405/06/20' });
  assert.equal(w.document.querySelector('#resultSection').style.display, 'none');
  assert.ok(w.document.querySelector('#qcRangeWarning').textContent.includes('تاریخ تک‌تک تماس‌ها'));
  send({}); assert.equal(w.document.querySelector('#resultSection').style.display, 'block');
  assert.equal(w.document.querySelector('#qcRangeWarning').hidden, true);
  // A subsequent detailed-file import removes the legacy warning as well.
  send({ from: '1405/06/20', to: '1405/06/20' });
  w.allRawCallLogs = [{ dateStr: '1405/06/20' }];
  w.selectedDatesSet = new w.Set(['1405/06/20']); w.recomputeResultsFromRawLogs();
  assert.equal(w.document.querySelector('#resultSection').style.display, 'block');
  assert.equal(w.document.querySelector('#qcRangeWarning').hidden, true);
  assert.equal(w.visibleCalls.length, 1);
});
