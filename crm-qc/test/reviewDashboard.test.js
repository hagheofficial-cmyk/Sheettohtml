'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const ExpertRef = require('../shared/expertRef.js');
const Reports = require('../shared/reports.js');

function fixture() {
  const act = (id, agent, title, date, status, result) => ({ id, agent, title, date, status, result, problem: 'مشکل ' + title, problemSource: 'تیکت', note: '', createdAt: '' });
  return {
    agents: [{ name: 'الف', team: 'Account', active: true }, { name: 'ب', team: 'Tele sales', active: true }],
    tickets: [
      { agentName: 'الف', reviewDate: '1405/07/03', score: 90, qcAgent: 'Q' },
      { agentName: 'ب', reviewDate: '1405/07/03', score: 60, qcAgent: 'Q' }
    ],
    socials: [], callFeedbacks: [], reminders: [{ id: 1, agent: 'الف', date: '1405/07/20', text: 'پیگیری', done: false }],
    agentActions: {
      'الف': [act(1, 'الف', 'تماس پیگیری', '1405/07/02', 'انجام شده', 'موفق'), act(2, 'الف', 'هشدار کتبی', '1405/07/05', 'انجام نشده', 'ناموفق')],
      'ب': [act(3, 'ب', 'تماس پیگیری', '1405/06/10', 'انجام نشده', 'در انتظار')]
    },
    seq: { action: 4 }
  };
}

test('review dashboard: totals, statuses, results and success rate over every action', () => {
  const d = ExpertRef.reviewDashboard(fixture(), {});
  assert.equal(d.kpis.total, 3);
  assert.equal(d.kpis.done, 1);
  assert.equal(d.kpis.notDone, 2);
  assert.equal(d.kpis.success, 1);
  assert.equal(d.kpis.failed, 1);
  assert.equal(d.kpis.waiting, 1);
  assert.equal(d.kpis.experts, 2);
  assert.equal(d.kpis.successRate, 50);
  assert.equal(d.kpis.openReminders, 1);
  assert.deepEqual(d.byResult.map((x) => x.count), [1, 1, 1, 0]); // در انتظار، موفق، ناموفق، نیاز به پیگیری
});

test('review dashboard: team, expert, type, status and result filters narrow the rows', () => {
  const db = fixture();
  assert.equal(ExpertRef.reviewDashboard(db, { team: 'Account' }).kpis.total, 2);
  assert.equal(ExpertRef.reviewDashboard(db, { team: 'Tele sales' }).kpis.total, 1);
  assert.equal(ExpertRef.reviewDashboard(db, { agent: 'ب' }).kpis.total, 1);
  assert.equal(ExpertRef.reviewDashboard(db, { type: 'هشدار کتبی' }).kpis.total, 1);
  assert.equal(ExpertRef.reviewDashboard(db, { status: 'انجام نشده' }).kpis.total, 2);
  assert.equal(ExpertRef.reviewDashboard(db, { result: 'ناموفق' }).kpis.total, 1);
  assert.equal(ExpertRef.reviewDashboard(db, { team: 'Account', result: 'موفق,ناموفق' }).kpis.total, 2);
});

test('review dashboard: action date range is separate from the global range and rejects bad dates', () => {
  const db = fixture();
  assert.equal(ExpertRef.reviewDashboard(db, { aFrom: '1405/07/01', aTo: '1405/07/30' }).kpis.total, 2);
  assert.equal(ExpertRef.reviewDashboard(db, { aFrom: '1405/07/01' }).kpis.total, 2);
  // بازه‌ی سراسری تاریخ بررسی (from/to) روی این داشبورد اثر ندارد
  assert.equal(ExpertRef.reviewDashboard(db, { from: '1405/07/01', to: '1405/07/30' }).kpis.total, 3);
  assert.throws(() => ExpertRef.reviewDashboard(db, { aFrom: 'xx' }), (e) => e.status === 400);
});

test('review dashboard: per-expert, per-type, monthly and problem summaries', () => {
  const d = ExpertRef.reviewDashboard(fixture(), {});
  const alef = d.byExpert.find((e) => e.name === 'الف');
  assert.equal(alef.total, 2);
  assert.equal(alef.lastTitle, 'هشدار کتبی', 'latest action of the expert is shown');
  assert.equal(alef.lastResult, 'ناموفق');
  assert.equal(alef.openReminders, 1);
  assert.equal(alef.successRate, 50);
  assert.deepEqual(d.byMonth.map((m) => m.key), [1405 * 100 + 6, 1405 * 100 + 7]);
  assert.equal(d.byType.find((t) => t.title === 'تماس پیگیری').total, 2);
  assert.equal(d.byProblem.length, 2); // دو مشکل متمایز
  assert.equal(d.rows[0].id, 2, 'rows are newest first');
});

test('dashboard: team filter limits evaluation counts to that team', () => {
  const db = fixture();
  assert.equal(Reports.dashboard(db, {}).ticketCount, 2);
  assert.equal(Reports.dashboard(db, { team: 'Account' }).ticketCount, 1);
  assert.equal(Reports.dashboard(db, { team: 'Tele sales' }).ticketCount, 1);
  assert.equal(Reports.dashboard(db, { team: 'Tele sales' }).avgTicket, 60);
});

const { browser, go, settle } = require('./helpers');
test('public: expert reference review view renders from the route without errors', async (t) => {
  const { w, dom, errors } = browser('public');
  t.after(() => dom.window.close());
  await w.App.boot(); w.App.bindDateRangeUI();
  await go(w, 'expert-ref/review');
  for (let i = 0; i < 5; i++) await settle();
  const body = w.document.getElementById('rvBody');
  assert.ok(body, 'review body exists');
  assert.ok(!body.textContent.includes('در حال جمع‌آوری'), 'loading state is replaced');
  assert.ok(w.document.querySelector('.er-view-tabs [data-view="review"].active'), 'review tab is active');
  assert.deepEqual(errors.filter((e) => /rvBody|expertReview/.test(String(e))), []);
});
