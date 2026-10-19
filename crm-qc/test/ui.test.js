'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const X = require('xlsx');
const { browser, fixture, settle, go, pickMulti, clone } = require('./helpers');

for (const build of ['public', 'offline']) {
  test(build + ': global dates, reports, expert portfolio, data center and analysis UI', async (t) => {
    const env = browser(build), { w, dom, errors, workbooks } = env;
    t.after(() => dom.window.close());
    await w.App.boot(); w.App.bindDateRangeUI();
    const $ = (selector) => w.document.querySelector(selector);
    const $$ = (selector) => [...w.document.querySelectorAll(selector)];
    const text = (selector) => $(selector).textContent;

    await t.test('dashboard has calls and a single global range that accepts Persian input', async () => {
      await go(w, 'dashboard');
      assert.equal(text('#cntC'), '۷');
      assert.equal($('#dFrom'), null); // competing per-page filters removed
      $('#gFrom').value = '۱۴۰۵/۶/۲۰'; $('#gTo').value = '۱۴۰۵/۶/۲۰';
      $('#globalRange').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
      await settle();
      assert.equal(text('#cntC'), '۵'); assert.equal(text('#cntT'), '۲');
      assert.equal($('#gFrom').value, '1405/06/20');
      assert.equal(w.App.dateRange.to, '1405/06/20');
      assert.ok(text('#footCounts').includes('۵ تماس'));
      const dist = w.App.charts.find((chart) => chart.canvas.id === 'chDist');
      assert.deepEqual(clone(dist.config.data.datasets[0].data), [3, 1, 1, 1]);
    });

    await t.test('invalid/reversed inputs do not change the applied range; calendar preserves its icon', async () => {
      $('#gFrom').value = '1405/13/40';
      $('#globalRange').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true })); await settle();
      assert.ok($('#gFrom').classList.contains('invalid'));
      assert.equal(w.App.dateRange.from, '1405/06/20'); assert.equal(text('#cntC'), '۵');
      $('#gFrom').value = '1405/06/21'; $('#gTo').value = '1405/06/20';
      $('#globalRange').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true })); await settle();
      assert.ok(text('#gRangeNote').includes('شروع')); assert.equal(text('#cntC'), '۵');
      w.App.syncDateRangeUI();
      $('#gFromBtn').click();
      const selected = $('.jcal-day.sel'); assert.ok(selected); selected.click(); await settle();
      assert.ok($('#gFromBtn i.fa-calendar')); assert.equal($('#gFrom').value, '1405/06/20');
    });

    await t.test('call reports use seven aggregate columns, N/A counts, per-call marks and redline popup', async () => {
      await go(w, 'reports');
      $('#typeTabs button[data-t="call"]').click(); await settle();
      assert.ok(text('#chartsRow').includes('تعداد ریت بر اساس فرم ها'));
      assert.deepEqual($$('#elemCardWrap table thead th').map((node) => node.textContent),
        ['المان', 'رعایت شده', 'عدم رعایت', 'موضوعیت نداشته', 'مجموع', 'نرخ رعایت', 'نرخ عدم رعایت']);
      pickMulti(w, 'کارشناس', ['کارشناس الف']); await settle();
      assert.equal($$('#callDetailCard .call-detail-table tbody > tr').length, 4);
      const headers = $$('#callDetailCard table thead th').map((node) => node.textContent);
      assert.deepEqual(headers.slice(0, 3), ['نام کارشناس', 'نمره کلی تماس', 'نام شریک']);
      assert.equal(headers.at(-1), 'ردلاین ها');
      assert.equal($('#callDetailCard tbody tr').lastElementChild.textContent, '-');
      $('#tblWrap [data-call-group]').click();
      assert.ok(text('.modal-body').includes('گفتار نامناسب')); assert.equal($('.modal-body script'), null);
      $('.modal-back:last-child .modal-head .x').click();
      $('#levelTabs [data-l="team"]').click(); await settle();
      $('#tblWrap [data-call-group]').click();
      assert.equal($$('.modal-body tbody tr').length, 1); assert.ok(text('.modal-body').includes('کارشناس الف'));
      $('.modal-back:last-child .modal-head .x').click();
      $('#levelTabs [data-l="agent"]').click(); await settle();
      assert.ok($$('#callDetailCard .tri-value').some((node) => node.textContent === '1'));
      assert.ok($$('#callDetailCard .tri-value').some((node) => node.textContent === '0'));
      assert.ok($$('#callDetailCard .tri-value').some((node) => node.textContent === '-'));
      $('#callDetailCard [data-call-redline]').click();
      assert.ok(text('.modal-body').includes('علت ردلاین'));
      assert.ok(text('.modal-body').includes('"گفتار نامناسب"'));
      assert.equal($('.modal-body script'), null);
      $('.modal-back:last-child .modal-head .x').click();
      await w.App.setDateRange({ from: '1405/06/21', to: '1405/06/21' });
      assert.equal($('#typeTabs button.active').dataset.t, 'call');
      assert.equal($$('#callDetailCard tbody > tr').length, 1); // selected expert persists
      await w.App.setDateRange({ from: '1405/06/20', to: '1405/06/20' });
      $('#btnXls').click(); await settle();
      const workbook = workbooks.at(-1).wb;
      assert.ok(workbook.SheetNames.includes('المان‌های کلی'));
      assert.ok(workbook.SheetNames.includes('جزئیات Telesales'));
      const rows = X.utils.sheet_to_json(workbook.Sheets['المان‌های کلی'], { header: 1 });
      assert.equal(rows[0][3], 'موضوعیت نداشته');
      assert.equal(X.utils.sheet_to_json(workbook.Sheets['جزئیات Telesales'], { header: 1 }).length, 5);
    });

    await t.test('expert roster includes unrated experts; requested columns and expandable history are exact', async () => {
      await go(w, 'portfolio/' + encodeURIComponent('کارشناس الف'));
      assert.equal(text('#pAll h3'), 'کارشناس ها');
      assert.equal($$('#pAll tbody tr').length, fixture().agents.length);
      assert.deepEqual($$('#pAll thead th').map((node) => node.textContent), ['کارشناس', 'تیم', 'تعداد ریت تیکت', 'میانگین نمره تیکت',
        'تعداد ریت سوشال', 'میانگین نمره سوشال', 'تعداد ریت تماس', 'میانگین نمره تماس', 'ردلاین', 'میانگین کل نمرات کارشناس']);
      assert.ok(text('#pBody').includes('نرخ موفقیت معیار‌ها — Telesales'));
      assert.ok(text('#pBody').includes('ردلاین‌ها'));
      assert.equal(text('#pBody').includes('تفکیک به‌ازای هر تاریخ'), false);
      assert.equal(text('#pBody').includes('تفکیک به‌ازای هر فایل'), false);
      assert.deepEqual($$('#pCallHistory > thead th').map((node) => node.textContent), ['لید', 'نمره', 'ردلاین', 'جزئیات بیشتر']);
      $('#pCallHistory [data-call-detail="0"]').click();
      assert.equal($('#pCallDetails-0').hidden, false);
      assert.equal($('#pCallHistory > tbody > tr').children[2].textContent, '-');
      const headings = $$('#pCallDetails-0 th').map((node) => node.textContent);
      assert.deepEqual(headings.slice(0, 2), ['لید', 'شماره تماس']);
      assert.deepEqual(headings.slice(-3), ['ردلاین', 'تایم مکالمه', 'تاریخ بررسی']);
      assert.ok(text('#pCallDetails-0').includes('۹۰ ثانیه'));
      $('#pCallHistory [data-call-detail="1"]').click();
      assert.ok(text('#pCallDetails-1').includes('زمان شنود: ۴۰ ثانیه'));
      $('#pCallDetails-1 [data-call-redline]').click();
      assert.ok(text('.modal-body').includes('گفتار نامناسب')); $('.modal-back:last-child .modal-head .x').click();
      $('#pCallHistory [data-call-detail="0"]').click(); assert.equal($('#pCallDetails-0').hidden, true);
      const alpha = $$('#pAll tbody tr').find((node) => node.dataset.name === 'کارشناس الف');
      assert.ok(alpha.children[8].textContent.includes('تماس: ۱'));
      assert.equal(alpha.children[8].textContent.includes('سوشال'), false); // SLA failure is not a redline.
      const unrated = $$('#pAll tbody tr').find((node) => node.dataset.name === 'کارشناس بدون ریت');
      assert.equal(unrated.lastElementChild.textContent, '—');
      pickMulti(w, 'تیم کارشناس', ['Tele Sales']); await settle();
      assert.equal($$('#pAll tbody tr').length, 2);
      $$('#pAll tbody tr').find((node) => node.dataset.name === 'کارشناس بدون ریت').click();
      await settle();
      assert.ok(text('#pBody').includes('کارشناس بدون ریت'));
      assert.ok(text('#pBody').includes('بدون دیتای ریت تماس'));
      $('#pXls').click();
      assert.equal(workbooks.at(-1).wb.SheetNames.includes('روزانه ترکیبی'), false);
    });

    await t.test('data center counts live ratings by each team rather than stale import metadata', async () => {
      await go(w, 'data');
      assert.equal($$('#statusTeams tbody tr').length, 2);
      const tele = $$('#statusTeams tbody tr').find((row) => row.firstElementChild.textContent === 'Tele Sales');
      assert.deepEqual([...tele.children].map((cell) => cell.textContent), ['Tele Sales', '۱', '۲', '۴', '۷']);
      assert.ok(text('#statusGrid').includes('۵')); assert.equal(text('#statusGrid').includes('۹۹۹'), false);
      assert.ok(text('#statusUndated').includes('۱ رکورد'));
      await w.App.setDateRange({ from: '1405/06/21', to: '1405/06/21' });
      assert.ok(text('#statusRange').includes('۲۱'));
      assert.equal($$('#statusTeams tbody tr').reduce((sum, row) => sum + Number(w.QCCalc.faToEn(row.children[3].textContent)), 0), 1);
      await w.App.setDateRange({ from: '1405/06/20', to: '1405/06/20' });
    });

    await t.test('call analysis removes only the first two charts in all-team mode, keeps lower analysis', async () => {
      await go(w, 'call-analysis');
      assert.equal($('#chMonthly'), null); assert.equal($('#chElements'), null);
      assert.ok(text('#anBody').includes('ماتریس خطای کارشناس'));
      assert.ok(text('#anBody').includes('رتبه‌بندی کارشناسان'));
      assert.equal(w.App.charts.length, 0);
      $('#formTabs button[data-t="Tele Sales"]').click(); await settle();
      assert.ok($('#chMonthly')); assert.ok($('#chElements')); assert.equal(w.App.charts.length, 2);
      await w.App.setDateRange({ from: '1405/06/21', to: '1405/06/21' });
      assert.equal($('#formTabs button.active').dataset.t, 'Tele Sales');
      assert.equal(w.App.charts.length, 0); // no call of the selected team/form on this day
      $('#fReset').click(); await settle();
      assert.equal($('#chMonthly'), null); assert.equal($('#chElements'), null);
    });

    await t.test('global range persists on navigation; ticket/social lists and exports honor the same day', async () => {
      await w.App.setDateRange({ from: '1405/06/20', to: '1405/06/20' });
      await go(w, 'tickets'); assert.equal($$('#tblWrap tbody tr').length, 2);
      await go(w, 'socials'); assert.equal($$('#tblWrap tbody tr').length, 2);
      assert.equal($('#gFrom').value, '1405/06/20'); assert.ok(w.localStorage.getItem('crmqc.dateRange.v1').includes('1405/06/20'));
      $('#gReset').click(); await settle();
      assert.equal($('#gFrom').value, ''); assert.equal($('#gTo').value, '');
      assert.equal($$('#tblWrap tbody tr').length, 3);
      assert.equal(w.App.withDateRange('/api/backup', 'GET'), '/api/backup');
      await w.App.setDateRange({ from: '1405/06/20', to: '1405/06/20' });
      assert.ok(w.App.withDateRange('/api/portfolio/101', 'GET').includes('from=1405%2F06%2F20'));
      assert.equal(w.App.withDateRange('/api/calls', 'DELETE'), '/api/calls');
    });

    await t.test('independent-report new-tab link and reload use the current global day, not the initial one', async () => {
      await go(w, 'callreport');
      assert.ok($('#crFrame').src.includes('qcFrom=1405%2F06%2F20'));
      await w.App.setDateRange({ from: '1405/06/21', to: '1405/06/21' });
      assert.ok($('#crNewTab').href.includes('qcFrom=1405%2F06%2F21'));
      $('#crReload').click();
      assert.ok($('#crFrame').src.includes('qcFrom=1405%2F06%2F21'));
    });

    await t.test('all existing routes still render without JavaScript/chart lifecycle errors', async () => {
      for (const route of ['dashboard', 'reports', 'portfolio', 'data', 'call-analysis', 'callreport', 'tickets', 'socials', 'tickets/new', 'socials/new', 'directory', 'agents', 'expert-ref']) {
        await go(w, route);
        assert.equal(text('#content').includes('خطا در بارگذاری بخش'), false, route);
        assert.ok($('#globalRange'), route);
      }
      assert.deepEqual(errors, []);
    });
  });
}

test('rapid date changes discard stale dashboard responses instead of attributing data to the wrong day', async (t) => {
  const { w, dom } = browser(); t.after(() => dom.window.close());
  await w.App.boot(); await go(w, 'dashboard');
  const original = w.UI.api.get, pending = [];
  w.UI.api.get = (url) => {
    if (!url.startsWith('/api/dashboard')) return original(url);
    const scoped = w.App.withDateRange(url, 'GET');
    return new Promise((resolve) => { w.LocalApi.get(scoped).then((data) => pending.push({ resolve, data })); });
  };
  const first = w.App.setDateRange({ from: '1405/06/20', to: '1405/06/20' }); await settle();
  const second = w.App.setDateRange({ from: '1405/06/21', to: '1405/06/21' }); await settle();
  assert.equal(pending.length, 2);
  pending[1].resolve(pending[1].data); await second;
  assert.equal(w.document.querySelector('#cntC').textContent, '۱');
  pending[0].resolve(pending[0].data); await first;
  assert.equal(w.document.querySelector('#cntC').textContent, '۱');
  assert.equal(w.App.dateRange.from, '1405/06/21');
});

test('a real zero monthly call score stays zero, never a gap/null in the analysis chart', async (t) => {
  const data = fixture(); data.callFeedbacks = [{ ...data.callFeedbacks[0], score: 0 }];
  const { w, dom } = browser('public', data); t.after(() => dom.window.close());
  await w.App.boot(); await go(w, 'call-analysis');
  w.document.querySelector('#formTabs button[data-t="Tele Sales"]').click(); await settle();
  const monthly = w.App.charts.find((chart) => chart.canvas.id === 'chMonthly');
  assert.equal(monthly.config.data.datasets[0].data[0], 0);
});
