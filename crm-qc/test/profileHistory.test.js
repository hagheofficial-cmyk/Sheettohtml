'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { browser, fixture, go, settle } = require('./helpers');

for (const build of ['public', 'offline']) test(`${build}: profile and QC comments keep per-evaluation historical labels and escape text`, async (t) => {
  const data = fixture();
  data.callFeedbacks = [
    { expertName: 'کارشناس الف', team: 'Tele Sales', formType: 'tele', reviewDate: '1405/06/20', leadName: 'لید اول', leadPhone: '0912', qcAgent: 'QC اول', qcComment: 'یادداشت <img src=x onerror=alert(1)>', score: 30, redline: 1, redlineReason: 'علت الف', callDuration: '90',
      criteriaSnapshot: [{ key: 'same', label: 'تاریخی <b>تله</b>', active: true }, { key: 'na', label: 'نامربوط', active: true }], elements: { same: 0, na: '-' } },
    { expertName: 'کارشناس الف', team: 'Account', formType: 'account', reviewDate: '1405/06/20', leadName: 'لید دوم', qcComment: '', score: 70, redline: 0,
      criteriaSnapshot: [{ key: 'same', label: 'تاریخی اکانت', active: true }], elements: { same: 0 } }
  ];
  const { w, dom, errors } = browser(build, data); t.after(() => dom.window.close());
  await w.App.boot(); await go(w, 'portfolio/' + encodeURIComponent('کارشناس الف')); await settle(); await settle();
  const doc = w.document, rows = [...doc.querySelectorAll('#pCallHistory tbody > tr')];
  assert.equal(doc.querySelectorAll('table#pCallHistory').length, 1); assert.equal(rows.length, 2);
  const first = rows.find(r => r.textContent.includes('لید اول')), second = rows.find(r => r.textContent.includes('لید دوم'));
  assert.ok(first.textContent.includes('تاریخی <b>تله</b>')); assert.ok(first.textContent.includes('QC اول'));
  assert.ok(first.textContent.includes('۹۰ ثانیه')); assert.ok(first.textContent.includes('علت الف'));
  assert.ok(first.textContent.includes('یادداشت <img src=x onerror=alert(1)>')); assert.equal(first.querySelector('img,b'), null);
  assert.ok(second.textContent.includes('تاریخی اکانت')); assert.ok(!second.textContent.includes('تاریخی <b>تله</b>'));
  doc.querySelector('.profile-modal .x').click();
  await go(w, 'call-analysis'); await settle(); await settle();
  const tags = [...doc.querySelectorAll('.qc-weaknesses')];
  assert.equal(tags.length, 2); assert.ok(tags.some(el => el.textContent.includes('تاریخی <b>تله</b>')));
  assert.ok(tags.some(el => el.textContent.includes('تاریخی اکانت'))); assert.ok(tags.every(el => !el.textContent.includes('نامربوط')));
  assert.equal(doc.querySelector('.qc-weakness-tag b'), null);
  assert.equal([...doc.querySelectorAll('img')].some(el => el.getAttribute('onerror')), false);
  assert.deepEqual(errors, []);
});
