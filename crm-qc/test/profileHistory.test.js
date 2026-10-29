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
      criteriaSnapshot: [{ key: 'same', label: 'تاریخی اکانت', active: true }], elements: { same: 0 } },
    { expertName: 'کارشناس الف', team: 'Tele Sales', formType: 'tele', reviewDate: '1405/06/20', leadName: 'لید سوم', qcComment: '', score: 80, redline: 0,
      criteriaSnapshot: [{ key: 'same', label: 'نام جدید تله', active: true }], elements: { same: 1 } }
  ];
  const { w, dom, errors } = browser(build, data); t.after(() => dom.window.close());
  await w.App.boot(); await go(w, 'portfolio/' + encodeURIComponent('کارشناس الف')); await settle(); await settle();
  const doc = w.document, rows = [...doc.querySelectorAll('#pCallHistory tbody > tr')];
  assert.equal(doc.querySelectorAll('table#pCallHistory').length, 1); assert.equal(rows.length, 3);
  const first = rows.find(r => r.textContent.includes('لید اول')), second = rows.find(r => r.textContent.includes('لید دوم'));
  const headers = [...doc.querySelectorAll('#pCallHistory thead tr:last-child th')];
  const teleCol = headers.findIndex(h => h.textContent.includes('تاریخی <b>تله</b>'));
  const accountCol = headers.findIndex(h => h.textContent.includes('تاریخی اکانت'));
  const newTeleCol = headers.findIndex(h => h.textContent.includes('نام جدید تله'));
  const naCol = headers.findIndex(h => h.textContent.includes('نامربوط'));
  assert.ok(newTeleCol >= 0 && newTeleCol !== teleCol);
  assert.equal(first.cells[naCol].textContent, '-');
  assert.ok(teleCol >= 0 && accountCol >= 0 && teleCol !== accountCol);
  assert.equal(first.cells[teleCol].textContent, '0'); assert.equal(first.cells[accountCol].textContent, '·');
  assert.equal(second.cells[teleCol].textContent, '·'); assert.equal(second.cells[accountCol].textContent, '0');
  const third = rows.find(r => r.textContent.includes('لید سوم'));
  assert.equal(third.cells[teleCol].textContent, '·'); assert.equal(third.cells[newTeleCol].textContent, '1');
  assert.ok(first.textContent.includes('QC اول'));
  assert.ok(first.textContent.includes('۹۰ ثانیه')); assert.ok(first.textContent.includes('علت الف'));
  assert.ok(first.textContent.includes('یادداشت <img src=x onerror=alert(1)>')); assert.equal(first.querySelector('img,b'), null);
  assert.equal(first.querySelector('.profile-elements, table'), null);
  assert.equal(second.querySelector('.profile-elements, table'), null);
  doc.querySelector('.profile-modal .x').click();
  await go(w, 'call-analysis'); await settle(); await settle();
  const tags = [...doc.querySelectorAll('.qc-weaknesses')];
  assert.equal(tags.length, 2); assert.ok(tags.some(el => el.textContent.includes('تاریخی <b>تله</b>')));
  assert.ok(tags.some(el => el.textContent.includes('تاریخی اکانت'))); assert.ok(tags.every(el => !el.textContent.includes('نامربوط')));
  assert.equal(doc.querySelector('.qc-weakness-tag b'), null);
  assert.equal([...doc.querySelectorAll('img')].some(el => el.getAttribute('onerror')), false);
  assert.deepEqual(errors, []);
});
