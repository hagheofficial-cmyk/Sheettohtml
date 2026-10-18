'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { browser, fixture, go, pickMulti } = require('./helpers');

const wait = (ms = 120) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check, ms = 3000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (check()) return true; await wait(20); }
  return check();
}

function manyTickets(data) {
  const base = data.tickets[0];
  data.tickets = Array.from({ length: 40 }, (_, i) => ({
    ...base, id: i + 1, ticketCode: 'T-' + (i + 1),
    agentName: i % 2 ? 'کارشناس الف' : 'کارشناس ب', team: i % 2 ? 'Tele Sales' : 'Account', reviewDate: '1405/06/20'
  }));
  return data;
}

test('every table gets Excel/image tools; Excel of a paginated table holds all filtered rows', async (t) => {
  const { w, dom, errors, workbooks } = browser('public', manyTickets(fixture())); t.after(() => dom.window.close());
  await w.App.boot(); await go(w, 'tickets');
  assert.ok(await until(() => w.document.querySelector('.tbl-tools')), 'toolbar rendered');
  const tables = w.document.querySelectorAll('table.tbl');
  assert.ok(tables.length >= 1);
  assert.equal(w.document.querySelectorAll('.tbl-tools').length, tables.length);
  assert.equal(w.document.querySelectorAll('#tblWrap tbody tr').length, 15, 'the page shows one page only');
  w.document.querySelector('.tbl-tools [data-tt="xls"]').click(); await wait();
  const wb = workbooks[workbooks.length - 1];
  assert.ok(wb, 'an Excel file was written');
  const rows = w.XLSX.utils.sheet_to_json(wb.wb.Sheets[wb.wb.SheetNames[0]], { header: 1 });
  assert.equal(rows.length, 41, '40 tickets plus the header row');
  assert.equal(rows[0].includes(''), false, 'no empty action column in the export');
  assert.deepEqual(errors, []);
});

test('image export captures every filtered row without buttons or toolbars', async (t) => {
  const { w, dom, errors } = browser('public', manyTickets(fixture())); t.after(() => dom.window.close());
  const hosts = [];
  w.html2canvas = async (host) => {
    hosts.push(host);
    return { width: 10, height: 10, toBlob: (cb) => cb(new w.Blob(['x'], { type: 'image/png' })) };
  };
  w.URL.createObjectURL = () => 'blob:x'; w.URL.revokeObjectURL = () => {};
  w.HTMLAnchorElement.prototype.click = function () { hosts.downloads = (hosts.downloads || []).concat([this.download]); };
  await w.App.boot(); await go(w, 'tickets');
  assert.ok(await until(() => w.document.querySelector('.tbl-tools')), 'toolbar rendered');
  w.document.querySelector('.tbl-tools [data-tt="img"]').click(); await wait(200);
  assert.equal(hosts.length, 1);
  const host = hosts[0];
  assert.equal(host.querySelectorAll('tbody tr').length, 40);
  assert.equal(host.querySelectorAll('button').length, 0);
  assert.equal(host.querySelector('.tbl-tools'), null);
  assert.ok(hosts.downloads[0].endsWith('.png'));
  assert.deepEqual(errors, []);
});

test('expert reference filters: nearest reminder, last change, action status, sort and team tabs', async (t) => {
  const data = fixture();
  const C = require('../shared/calc.js');
  const addDays = (j, delta) => {
    const date = C.jalaliToDate(j); date.setDate(date.getDate() + delta);
    return C.formatJalali(C.toJalaali(date.getFullYear(), date.getMonth() + 1, date.getDate()));
  };
  const today = C.todayJalali();
  data.reminders = [
    { id: 1, agent: 'کارشناس الف', date: addDays(today, 2), text: 'امروز', done: false, createdAt: '2026-10-01T10:00:00Z' },
    { id: 2, agent: 'کارشناس ب', date: addDays(today, -1), text: 'معوق', done: false, createdAt: '2026-10-10T08:00:00Z' }
  ];
  data.seq = { ...(data.seq || {}), reminder: 10 };
  const { w, dom, errors } = browser('public', data); t.after(() => dom.window.close());
  await w.App.boot(); await go(w, 'expert-ref'); await wait();
  const names = () => [...w.document.querySelectorAll('.ex-card')].map((c) => c.dataset.name);
  const set = async (id, value) => {
    const node = w.document.querySelector(id); node.value = value;
    node.dispatchEvent(new w.Event('change')); await wait(20);
    return names();
  };
  assert.deepEqual(names(), ['کارشناس الف', 'کارشناس ب', 'کارشناس بدون ریت']);
  assert.deepEqual(await set('#erRemF', 'overdue'), ['کارشناس ب']);
  assert.deepEqual(await set('#erRemF', 'd3'), ['کارشناس الف', 'کارشناس ب']);
  assert.deepEqual(await set('#erRemF', 'none'), ['کارشناس بدون ریت']);
  await set('#erRemF', '');
  assert.deepEqual(await set('#erChgF', 'never'), ['کارشناس بدون ریت']);
  await set('#erChgF', '');
  assert.deepEqual(await set('#erSort', 'rem'), ['کارشناس ب', 'کارشناس الف', 'کارشناس بدون ریت']);
  assert.deepEqual(await set('#erSort', 'chg'), ['کارشناس ب', 'کارشناس الف', 'کارشناس بدون ریت']);
  await set('#erSort', 'name');
  pickMulti(w, 'تیم', ['Account']); await wait(20);
  assert.deepEqual(names(), ['کارشناس ب']);
  w.document.querySelector('#erReset').click(); await wait(20);
  assert.deepEqual(names(), ['کارشناس الف', 'کارشناس ب', 'کارشناس بدون ریت']);
  assert.deepEqual(errors, []);
});
