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

test('public: منوی همبرگری در همه‌ی اندازه‌ها پیش‌فرض بسته است و با کلیک باز می‌شود', async (t) => {
  const { w, dom } = browser('public');
  t.after(() => dom.window.close());
  w.innerWidth = 1440;
  await w.App.init();
  const doc = w.document;
  const sidebar = doc.getElementById('sidebar');
  const backdrop = doc.getElementById('sidebarBackdrop');
  const burger = doc.getElementById('hamburger');

  assert.ok(!sidebar.classList.contains('open'), 'دسکتاپ: منو پیش‌فرض بسته است');
  assert.equal(burger.getAttribute('aria-expanded'), 'false');
  assert.ok(!doc.getElementById('app').classList.contains('sidebar-collapsed'), 'حالت جمع‌شدن دسکتاپ دیگر وجود ندارد');

  burger.click();
  assert.ok(sidebar.classList.contains('open'), 'کلیک همبرگر منو را باز می‌کند');
  assert.ok(backdrop.classList.contains('show'), 'پس‌زمینه‌ی تیره با منو می‌آید');
  assert.equal(burger.getAttribute('aria-expanded'), 'true');

  backdrop.click();
  assert.ok(!sidebar.classList.contains('open'), 'کلیک روی پس‌زمینه منو را می‌بندد');

  burger.click();
  doc.getElementById('sidebarClose').click();
  assert.ok(!sidebar.classList.contains('open'), 'دکمه‌ی بستن داخل منو کار می‌کند');

  burger.click();
  await go(w, 'reports');
  assert.ok(!sidebar.classList.contains('open'), 'رفتن به صفحه‌ی دیگر منو را می‌بندد');

  w.innerWidth = 800;
  burger.click();
  assert.ok(sidebar.classList.contains('open'), 'در عرض کم هم همان دراور باز می‌شود');
  doc.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.ok(!sidebar.classList.contains('open'), 'کلید Escape منو را می‌بندد');
});
