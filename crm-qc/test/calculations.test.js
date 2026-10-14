'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const X = require('xlsx');
const C = require('../shared/calc');
const P = require('../shared/parseQc');
const R = require('../shared/reports');
const { fixture, ROOT } = require('./helpers');
const DAY = { from: '1405/06/20', to: '1405/06/20' };

test('dates: Jalali/Persian/Arabic/ISO/Excel all identify the same review day', () => {
  const dates = ['1405/6/20', '۱۴۰۵/۰۶/۲۰', '١٤٠٥/٠٦/٢٠', '14050620', 14050620,
    '2026-09-11', '2026/09/11', '20260911', '"2026-09-11 17:00:00"',
    '2026-09-11T23:50:00-07:00', 46276.67769675926, '46276.67769675926', new Date('2026-09-11T00:00:00Z')];
  for (const date of dates) assert.equal(C.formatJalali(P.anyToJalali(date)), '1405/06/20', String(date));
  for (const date of ['', null, '-', 'نامشخص', '1405/13/01', '1405/12/30', '2026-02-30', '2026-13-01', 'junk']) {
    assert.equal(C.parseDate(date), null, String(date));
  }
  assert.equal(C.formatJalali(C.parseDate('1403/12/30')), '1403/12/30');
  const oldTZ = process.env.TZ;
  try {
    for (const tz of ['UTC', 'Asia/Tehran', 'America/Los_Angeles']) {
      process.env.TZ = tz;
      assert.equal(C.formatJalali(P.anyToJalali('2026-09-11T23:50:00Z')), '1405/06/20');
      assert.equal(C.formatJalali(P.anyToJalali(46276.99)), '1405/06/20');
    }
  } finally { if (oldTZ == null) delete process.env.TZ; else process.env.TZ = oldTZ; }
});

test('inclusive/open ranges; invalid/reversed ranges never silently select all data', () => {
  assert.equal(R.inRange('2026-09-11', DAY.from, DAY.to), true);
  assert.equal(R.inRange('1405/06/19', DAY.from, DAY.to), false);
  assert.equal(R.inRange('1405/06/21', DAY.from, DAY.to), false);
  assert.equal(R.inRange('', DAY.from, DAY.to), false);
  assert.equal(R.inRange('', '', ''), true);
  assert.equal(R.inRange('1405/06/19', '', DAY.to), true);
  assert.equal(R.inRange('1405/06/21', DAY.from, ''), true);
  assert.ok(R.validateRange({ from: 'invalid' }));
  assert.ok(R.validateRange({ from: '1405/06/21', to: '1405/06/20' }));
  assert.equal(R.validateRange(DAY), '');
});

test('parser: review date wins over action date regardless of column order or form', () => {
  for (const type of ['tele', 'account', 'mlm']) {
    const raw = { action_date: 46259.5, tele_expert_name: '  کارشناس الف  ', form_created_date: 46276.5,
      score: '"90"', Red_line: '"1"', lead_name: 'شریک', lead_phone: '09120000000',
      Call_opening_quality: '۱', note: '—', 'Listening time (second)': '"35"' };
    const parsed = P.parseRows([raw], type)[0];
    assert.equal(parsed.reviewDate, '1405/06/20');
    assert.equal(parsed.callDate, '1405/06/03');
    assert.equal(parsed.expertName, 'کارشناس الف');
    assert.equal(parsed.score, 90); assert.equal(parsed.redline, 1);
    assert.equal(parsed.elements.Call_opening_quality, 1);
    assert.equal(parsed.listeningTime, '35'); assert.equal(parsed.callDuration, '');
  }
  assert.equal(P.parseRows([{ tele_expert_name: 'الف', action_date: '1405/6/20', form_created_date: '' }], 'tele')[0].reviewDate, DAY.from);
  assert.equal(P.parseRows([{ tele_expert_name: 'الف' }], 'tele')[0].reviewDate, '');
  assert.equal(P.parseRows([{ tele_expert_name: 'الف', form_created_date: 'invalid', action_date: DAY.from }], 'tele')[0].reviewDate, '');
});

test('parser and averages: blank/invalid scores are not zeros; real zero remains scored', () => {
  for (const score of [null, undefined, '', ' ', '-', 'bad', '200', '-1', Infinity, NaN, false]) {
    assert.equal(C.normalizeScore(score), null, String(score));
    assert.equal(P.parseRows([{ tele_expert_name: 'الف', score }], 'tele')[0].score, null);
  }
  assert.equal(C.normalizeScore('"۰"'), 0);
  assert.equal(R.avgScore([{ score: 100 }, { score: '0' }, { score: null }, { score: '' }]), 50);
  assert.equal(R.avgScore([{ score: null }, { score: '' }]), '');
  assert.equal(C.normalizeTri('"۱"'), 1);
  assert.equal(C.normalizeTri('0.0'), 0);
  assert.equal(C.normalizeTri('—'), '-');
  assert.equal(C.normalizeTri('bad'), '');
});

test('criteria: 1/0/- counted independently, N/A excluded only from rate denominator', () => {
  const rep = R.callReport(fixture(), 'agent', { ...DAY, agent: 'کارشناس الف' }, P);
  const item = rep.elements.find((r) => r.key === 'Call_opening_quality' && r.form === 'tele');
  assert.deepEqual([item.ok, item.bad, item.na, item.missing, item.total, item.applicable], [1, 1, 1, 1, 3, 2]);
  assert.equal(item.successRate, 50); assert.equal(item.errorRate, 50);
  const na = rep.elements.find((r) => r.key === 'note');
  assert.equal(na.na, 1); assert.equal(na.total, 1); assert.equal(na.successRate, ''); assert.equal(na.errorRate, '');
  assert.equal(rep.calls.length, 4);
  assert.equal(rep.rows[0].avgScore, 50);
  assert.equal(rep.rows[0].redlines, 1);
  assert.equal(R.callReport(fixture(), 'team', DAY, P).calls.length, 0);
  assert.equal(R.callReport(fixture(), 'agent', { ...DAY, agent: 'کارشناس الف,کارشناس ب' }, P).calls.length, 0);
});

test('portfolio: all registered experts including unrated/archived; team filters and weighted average', () => {
  const data = fixture();
  const rows = R.portfolioAgents(data, DAY);
  assert.equal(rows.length, data.agents.length);
  const alpha = rows.find((r) => r.name === 'کارشناس الف');
  assert.deepEqual([alpha.ticketCount, alpha.socialCount, alpha.callCount], [1, 2, 4]);
  assert.deepEqual([alpha.ticketAvg, alpha.socialAvg, alpha.callAvg, alpha.avgScore], [100, 100, 50, 75]);
  assert.deepEqual([alpha.ticketRedline, alpha.socialRedline, alpha.callRedline], [0, 0, 1]);
  assert.equal(R.portfolioAgents(data, {}).find((r) => r.name === 'کارشناس الف').ticketRedline, 1);
  assert.equal(R.portfolioAgents(data, {}).find((r) => r.name === 'کارشناس ب').socialRedline, 1);
  const empty = rows.find((r) => r.name === 'کارشناس بدون ریت');
  assert.equal(empty.totalCount, 0); assert.equal(empty.avgScore, '');
  assert.equal(rows.find((r) => r.name === 'کارشناس بایگانی').active, false);
  assert.equal(R.portfolioAgents(data, { ...DAY, team: ['Tele Sales'] }).length, 2);
  assert.equal(R.portfolioAgents(data, { ...DAY, team: 'Tele Sales,Account' }).length, 4);
  const profile = R.agentProfile(data, '۱۰۱', DAY);
  assert.equal(profile.calls.avgScore, alpha.callAvg);
  assert.equal(profile.calls.redlineRows.length, 1);
  assert.ok(profile.calls.redlineRows[0].reason.includes('"گفتار نامناسب"'));
  assert.equal(profile.monthly.calls[0].key, '1405-06');
  assert.equal(profile.monthly.calls[0].avgScore, 50);
  assert.ok(R.agentProfile(data, 'کارشناس بدون ریت', DAY));
});

test('all aggregates share date/team filters, and dashboard includes imported calls', () => {
  const data = fixture(), status = R.dataStatus(data, DAY), dash = R.dashboard(data, DAY);
  assert.deepEqual([status.tickets, status.socials, status.calls], [2, 2, 5]);
  assert.deepEqual([dash.ticketCount, dash.socialCount, dash.callCount], [2, 2, 5]);
  assert.equal(dash.callScored, 3); assert.equal(dash.avgCall, 60);
  assert.equal(dash.avgAll, 71.67); // 100,50,100,100,0,80
  assert.deepEqual(dash.dist, [3, 1, 1, 1]);
  assert.equal(status.undated.calls, 1);
  assert.deepEqual(status.byForm, { tele: 4, account: 1, mlm: 0 });
  assert.equal(status.byTeam.reduce((n, r) => n + r.totalCount, 0), 9);
  const q = { ...DAY, team: 'Tele Sales,Account', agent: 'کارشناس الف,کارشناس ب' };
  assert.equal(R.filterCalls(data, q).length, 5);
  assert.equal(R.combinedAgentReport(data, q).reduce((n, r) => n + r.callCount, 0), 5);
  assert.equal(R.callAnalysis(data, q, P).kpis.totalCalls, 5);
  assert.equal(R.callAnalysis(data, q, P).kpis.redlineCount, 1);
  assert.equal(R.callAnalysis(data, q, P).monthly[0].avgScore, 60);
});

test('team transfers use current expert registry without changing stored history', () => {
  const data = fixture(); data.agents[0].team = 'Account';
  const q = { ...DAY, team: 'Account' };
  assert.equal(R.dashboard(data, q).ticketCount, 2);
  assert.equal(R.filterCalls(data, q).length, 5);
  assert.equal(data.tickets[0].team, 'Tele Sales');
  assert.deepEqual(R.ticketReport(data, 'team', q).map((r) => r.name), ['Account']);
  assert.deepEqual(R.socialReport(data, 'team', q).map((r) => r.name), ['Account']);
});

test('golden workbook: 81 independent ratings, 39 reviews on 1405/06/20 (not 9 action dates)', () => {
  const wb = X.readFile(path.join(ROOT, 'data/seed-calls/qc_mlm_form_2026-09-26.xlsx'));
  const raw = X.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
  const parsed = P.parseRows(raw, 'mlm');
  assert.equal(raw.length, 81); assert.equal(parsed.length, 81);
  assert.equal(parsed.filter((r) => R.inRange(r.reviewDate, DAY.from, DAY.to)).length, 39);
  const keys = parsed.map((row) => P.callRowKey({ sourceFile: 'same.xlsx', ...row }));
  assert.equal(new Set(keys).size, 81);
  assert.equal(P.callRowKey({ sourceFile: 'old.xlsx', expertName: 'الف', reviewDate: DAY.from }), null);
  const seed = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/seed-data.js'), 'utf8').replace(/^.*?window.QC_SEED\s*=\s*/s, '').replace(/;\s*$/, ''));
  assert.deepEqual(seed.callFeedbacks.map(({ sourceFile, ...row }) => row), parsed);
});

test('server/public/offline shared files and page mirrors cannot drift', () => {
  for (const file of ['calc.js', 'parseQc.js', 'reports.js', 'expertRef.js', 'registry.js', 'importData.js']) {
    assert.equal(fs.readFileSync(path.join(ROOT, 'public', file), 'utf8'), fs.readFileSync(path.join(ROOT, 'shared', file), 'utf8'));
  }
  for (const file of ['app.js', 'calc.js', 'parseQc.js', 'reports.js', 'expertRef.js', 'storage.js', 'index.html', 'styles.css', 'export.js', 'seed-data.js', 'jcal.js', 'callReportRange.js', 'call-admin-report.html', 'registry.js', 'importData.js', 'capture.js', 'enhancements.css', 'session.js', 'fonts.css', 'manifest.webmanifest', 'callReportTheme.css',
    ...fs.readdirSync(path.join(ROOT, 'public/pages')).map((file) => 'pages/' + file)]) {
    assert.equal(fs.readFileSync(path.join(ROOT, 'public', file), 'utf8'), fs.readFileSync(path.join(ROOT, '..', 'HTML اصلی', file), 'utf8'), file);
  }
});
