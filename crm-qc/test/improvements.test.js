'use strict';
/* آزمون‌های نوبت جاری: سرعت ورود/تحلیل، ماه مالی، زیرمجموعه‌ی QC، کارنامه و PDF */
const test = require('node:test');
const assert = require('node:assert/strict');
const { browser, fixture, settle, go } = require('./helpers');

for (const build of ['public', 'offline']) {
  test(build + ': ورود یک‌مرحله‌ای، ماه مالی, زیرمجموعه‌ی کارشناس QC و کارنامه‌ی پرونده', async (t) => {
    const env = browser(build), { w, dom, errors } = env;
    t.after(() => dom.window.close());
    const $ = (selector) => w.document.querySelector(selector);
    const $$ = (selector) => [...w.document.querySelectorAll(selector)];
    const text = (selector) => ($(selector) ? $(selector).textContent : '');
    await w.App.boot();
    w.App.bindDateRangeUI();

    await t.test('ورود، داده‌ی اولیه را در همان پاسخ می‌دهد (بدون /api/bootstrap دوم)', async () => {
      await w.LocalApi.run('POST', '/api/auth/setup', { name: 'مدیر سیستم', password: 'admin-1234' });
      await w.QCAuth.ensure();
      const res = await w.QCAuth.login('مدیر سیستم', 'admin-1234');
      assert.equal(res.role, 'admin');
      const prefetched = w.QCAuth._bootstrap;
      assert.ok(prefetched && prefetched.auth && prefetched.auth.user, 'bootstrap همراه پاسخ ورود است');
      assert.equal(prefetched.auth.user.name, 'مدیر سیستم');
      assert.ok(Array.isArray(prefetched.agents) && prefetched.agents.length > 0);
      /* مصرف همان داده بدون درخواست مجدد */
      let bootCalls = 0;
      const original = w.UI.api.get;
      w.UI.api.get = (url, ...rest) => { if (url === '/api/bootstrap') bootCalls++; return original(url, ...rest); };
      await w.App.onAuthReady();
      w.UI.api.get = original;
      assert.equal(bootCalls, 0, 'پس از ورود، /api/bootstrap دوباره گرفته نمی‌شود');
      assert.ok($('#orgName').textContent.length > 0);
    });

    await t.test('ماه مالی: ساخت خودکار ۱۲ ماه، اعتبارسنجی تکراری و ذخیره', async () => {
      await go(w, 'directory');
      await settle();
      $('#fmYear').value = '1405';
      $('#fmAuto').click();
      await settle();
      assert.equal($$('#fmBody tr[data-i]').length, 12, '۱۲ ماه ساخته می‌شود');
      assert.ok(text('#fmSummary').includes('روز'), 'خلاصه‌ی روزها نمایش داده می‌شود');
      const first = $('#fmBody tr[data-i] .fm-name');
      const second = $('#fmBody tr[data-i]:nth-child(2) .fm-name');
      second.value = first.value;
      second.dispatchEvent(new w.Event('change', { bubbles: true }));
      $('#fmSave').click();
      await settle();
      assert.ok($('#fmSummary').classList.contains('has-err'), 'نام تکراری خطا می‌دهد');
      second.value = 'مهر — دوره‌ی آزمایشی';
      second.dispatchEvent(new w.Event('change', { bubbles: true }));
      $('#fmSave').click();
      await settle(); await settle();
      const months = await w.LocalApi.get('/api/fiscal-months');
      assert.equal(months.months.length, 12, 'ذخیره روی منبع داده انجام شد');
      assert.ok(months.months.some((m) => m.name === 'مهر — دوره‌ی آزمایشی'));
    });

    await t.test('زیرمجموعه‌ی کارشناس QC: ست‌کردن از مدیریت کارشناسان با نام/تیم/داخلی', async () => {
      const agents = await w.LocalApi.get('/api/agents');
      await w.LocalApi.run('PUT', '/api/agents/' + agents[0].id, { subgroup: 'تیم آلفا' });
      await w.LocalApi.run('PUT', '/api/agents/' + agents[1].id, { subgroup: 'تیم آلفا' });
      await go(w, 'qcadmin');
      await settle();
      [...$$('#content .btn')].find((b) => /کاربر QC جدید/.test(b.textContent)).click();
      await settle();
      assert.ok($('#quSubset'), 'بخش زیرمجموعه در مودال هست');
      const options = $$('#quSubPick option').map((o) => o.textContent);
      assert.ok(options.some((o) => o.includes('تیم آلفا')), 'زیرمجموعه‌ی ثبت‌شده در فهرست است: ' + options.join('|'));
      $('#quSubPick').value = 'تیم آلفا';
      $('#quSubPick').dispatchEvent(new w.Event('change', { bubbles: true }));
      assert.ok(text('#quSubCount').includes('۲'), 'شمارش اعضای زیرمجموعه');
      $('#quApplySubset').click();
      await settle();
      assert.deepEqual($$('#quPicked .qc-chip').map((c) => c.textContent.trim()), [agents[0].name, agents[1].name]);
      /* تنظیمات دستی هم دست‌نخورده می‌ماند */
      $('#quExtraExt').value = '9001';
      $('#quExtraExt').dispatchEvent(new w.Event('input', { bubbles: true }));
      await settle();
      const save = $('#quSave');
      $('#quName').value = 'کارشناس QC آزمایشی';
      $('#quPass').value = 'pass1234';
      save.click();
      await settle(); await settle();
      const saved = await w.LocalApi.run('GET', '/api/qc-users');
      const created = saved.users.find((u) => u.name === 'کارشناس QC آزمایشی');
      assert.ok(created, 'کاربر ساخته شد');
      assert.ok(created.exts.includes('9001'), 'داخلی دستی حفظ می‌شود');
      $('.profile-modal .x, .modal-back .modal-head .x') && null;
      const close = $$('.modal-back .modal-head .x').pop();
      if (close) close.click();
    });

    await t.test('پرونده: کارنامه‌ی قوت/ضعف/بهبود، جزئیات باز همه‌ی تماس‌ها و دکمه‌ی PDF', async () => {
      await go(w, 'portfolio');
      await settle();
      const row = $('#pAll tr[data-name="کارشناس الف"]');
      assert.ok(row, 'کارشناس در فهرست هست');
      row.click();
      await settle(); await settle();
      assert.ok($('.scorecard'), 'کارنامه ساخته می‌شود');
      assert.deepEqual($$('.scorecard .sc-col b').map((b) => b.textContent), ['نقاط قوت', 'نقاط ضعف', 'پیشنهاد بهبود']);
      assert.ok(text('.scorecard').includes('ردلاین') || text('.scorecard').includes('معیار'));
      assert.equal($$('table#pCallHistory').length, 1, 'همه‌ی تماس‌ها در یک جدول هستند');
      assert.equal($$('#pCallHistory tbody > tr').length, 5, 'برای هر تماس یک ردیف هست');
      assert.equal(text('#pCallHistory').includes('جزئیات بیشتر'), false);
      assert.ok($('#pPdf') && $('#pImage') && $('#pXls'), 'سه خروجی: اکسل، PDF، تصویر');
      let pdfCalled = null;
      w.QCCapture.downloadPdf = async (source, name) => { pdfCalled = name; return { pages: 2, width: 10, height: 10 }; };
      $('#pPdf').click();
      await settle(); await settle();
      assert.ok(pdfCalled && pdfCalled.includes('کارشناس الف'), 'PDF با نام کارشناس ساخته می‌شود');
    });

    assert.deepEqual(errors, [], 'هیچ خطای جاوااسکریپتی رخ نمی‌دهد');
  });
}
