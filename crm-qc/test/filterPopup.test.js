'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { browser, settle, go } = require('./helpers');

test('public: multi-select menu opens in a fixed layer on body, flips up when short of room, and closes cleanly', async (t) => {
  const { w, dom } = browser('public');
  t.after(() => dom.window.close());
  await w.App.boot(); w.App.bindDateRangeUI();
  await go(w, 'tickets');
  await settle();
  const field = [...w.document.querySelectorAll('.field')].find((n) => n.firstElementChild && n.firstElementChild.textContent === 'کارشناس');
  assert.ok(field, 'tickets page has an agent multi-select');
  const btn = field.querySelector('.ms-btn');
  btn.getBoundingClientRect = () => ({ top: 100, bottom: 136, left: 800, right: 970, width: 170, height: 36 });
  btn.click();
  const portal = w.document.querySelector('.ms-portal.open');
  assert.ok(portal, 'open menu is moved to a fixed layer');
  assert.equal(portal.parentNode, w.document.body, 'portal is attached to body, above page cards');
  assert.equal(portal.style.top, '141px', 'opens below the button when there is room');
  assert.equal(field.querySelector('.ms-menu'), null, 'menu is detached from the filter field while open');
  btn.click();
  assert.equal(w.document.querySelector('.ms-portal'), null, 'second click closes and removes the layer');
  assert.ok(field.querySelector('.ms-menu'), 'menu returns to its field after closing');

  btn.getBoundingClientRect = () => ({ top: 640, bottom: 676, left: 800, right: 970, width: 170, height: 36 });
  btn.click();
  const flipped = w.document.querySelector('.ms-portal.open');
  assert.ok(flipped, 'menu reopens near the bottom of the viewport');
  assert.equal(flipped.style.top, 'auto', 'no room below: menu is anchored from the bottom edge');
  assert.notEqual(flipped.style.bottom, 'auto', 'flips upward');
  w.document.body.click();
  assert.equal(w.document.querySelector('.ms-portal'), null, 'outside click closes the menu');
});

test('public: hamburger collapses the sidebar on desktop, remembers the choice, and keeps the drawer on narrow screens', async (t) => {
  const { w, dom } = browser('public');
  t.after(() => dom.window.close());
  w.innerWidth = 1440;
  await w.App.init();
  const app = w.document.getElementById('app');
  w.document.getElementById('hamburger').click();
  assert.ok(app.classList.contains('sidebar-collapsed'), 'desktop click collapses');
  assert.equal(w.localStorage.getItem('crmqc.sidebar.v1'), 'collapsed');
  w.document.getElementById('hamburger').click();
  assert.ok(!app.classList.contains('sidebar-collapsed'), 'second click expands');
  assert.equal(w.localStorage.getItem('crmqc.sidebar.v1'), 'open');
  w.innerWidth = 800;
  w.document.getElementById('hamburger').click();
  assert.ok(w.document.getElementById('sidebar').classList.contains('open'), 'narrow screens open the drawer');
  assert.ok(!app.classList.contains('sidebar-collapsed'), 'narrow screens do not collapse');
});
