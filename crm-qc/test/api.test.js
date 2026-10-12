'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const X = require('xlsx');
const { ROOT, fixture, browser, clone } = require('./helpers');

async function startServer() {
  // Never start tests on the real data/store.json or data/calls directory.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crmqc-test-'));
  fs.mkdirSync(path.join(dir, 'data'));
  fs.cpSync(path.join(ROOT, 'shared'), path.join(dir, 'shared'), { recursive: true });
  for (const file of ['server.js', 'callWatcher.js']) fs.copyFileSync(path.join(ROOT, file), path.join(dir, file));
  fs.writeFileSync(path.join(dir, 'data/seed.json'), JSON.stringify(fixture()));
  fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(dir, 'node_modules'), 'dir');
  fs.symlinkSync(path.join(ROOT, 'public'), path.join(dir, 'public'), 'dir');
  const child = spawn(process.execPath, ['server.js'], { cwd: dir, env: { ...process.env, PORT: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  child.stderr.on('data', (data) => { log += data; });
  const origin = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Test server startup timeout: ' + log)); }, 10000);
    child.once('error', (error) => { clearTimeout(timeout); reject(error); });
    child.stdout.on('data', (data) => {
      log += data;
      const match = log.match(/http:\/\/0\.0\.0\.0:(\d+)/);
      if (match) { clearTimeout(timeout); resolve('http://127.0.0.1:' + match[1]); }
    });
    child.once('exit', (code) => { clearTimeout(timeout); reject(new Error('Test server exited: ' + code + '\n' + log)); });
  });
  return { dir, origin, async close() {
    await new Promise((resolve) => { child.once('exit', resolve); child.kill('SIGTERM'); });
    fs.rmSync(dir, { recursive: true, force: true });
  } };
}

test('real HTTP API and LocalApi agree on review dates, counts, scores and independent calls', async (t) => {
  const server = await startServer();
  const { dom, w } = browser();
  t.after(async () => { dom.window.close(); await server.close(); });
  async function http(method, url, data) {
    const response = await fetch(server.origin + url, { method, headers: data ? { 'Content-Type': 'application/json' } : undefined,
      body: data ? JSON.stringify(data) : undefined });
    return { status: response.status, data: await response.json() };
  }
  async function local(method, url, data) { return clone(await w.LocalApi[method === 'GET' ? 'get' : method === 'POST' ? 'post' : method === 'PUT' ? 'put' : 'del'](url, clone(data == null ? {} : data))); }
  async function restore(data = fixture()) {
    assert.equal((await http('POST', '/api/backup', { backup: data })).status, 200);
    await local('POST', '/api/backup', { backup: data });
  }
  await restore();
  const day = 'from=1405%2F06%2F20&to=1405%2F06%2F20';

  await t.test('all filtered read endpoints have online/offline parity', async () => {
    for (const url of ['/api/dashboard?' + day, '/api/data/status?' + day,
      '/api/reports?type=call&level=agent&' + day + '&agent=' + encodeURIComponent('کارشناس الف'),
      '/api/reports?type=call&level=team&' + day,
      '/api/reports?type=combined&team=Tele+Sales%2CAccount&' + day,
      '/api/reports?type=ticket&' + day, '/api/reports?type=social&' + day,
      '/api/portfolio/agents?' + day, '/api/portfolio?ident=101&' + day,
      '/api/portfolio/101?ident=101&' + day,
      '/api/tickets?' + day, '/api/socials?' + day, '/api/calls/analysis?' + day]) {
      const online = await http('GET', url); assert.equal(online.status, 200, url);
      assert.deepEqual(online.data, await local('GET', url), url);
    }
  });

  await t.test('invalid or reversed date ranges return 400 rather than all/empty data', async () => {
    for (const endpoint of ['/api/dashboard', '/api/reports', '/api/portfolio/agents', '/api/portfolio/101', '/api/tickets', '/api/socials', '/api/data/status', '/api/calls/analysis', '/api/backup']) {
      for (const query of ['from=bad', 'from=1405%2F06%2F21&to=1405%2F06%2F20']) {
        assert.equal((await http('GET', endpoint + '?' + query)).status, 400, endpoint);
        await assert.rejects(local('GET', endpoint + '?' + query), (error) => error.status === 400);
      }
    }
    assert.equal((await http('DELETE', '/api/calls?to=bad')).status, 400);
    await assert.rejects(local('DELETE', '/api/calls?to=bad'), (error) => error.status === 400);
    assert.equal((await http('GET', '/api/calls')).data.count, 7);
  });

  await t.test('ticket/social create and edit keep their existing formulas and date-scoped history online and offline', async (subt) => {
    subt.after(() => restore());
    const ticket = { agentName: 'کارشناس الف', qcAgent: 'QC تست', reviewDate: '1405/06/20', ticketDate: '1405/06/19', ticketCode: 'CRUD-T',
      q1: '1', q2: '0', q3: '-', q4: '1', redline: '1' };
    const social = { agentName: 'کارشناس الف', qcAgent: 'QC تست', reviewDate: '1405/06/20', receiveDate: '1405/06/19', replyDate: '1405/06/19',
      messenger: 'واتساپ', receiveTime: '09:00', replyTime: '09:30', responseStatus: 'پاسخ داده شده', reasonVerdict: 'کافی',
      qSla: '1', qFollow: '0', qClosing: '-', qTone: '1' };
    const stable = (row) => { row = { ...row }; delete row.createdAt; delete row.updatedAt; return row; };
    for (const [kind, body] of [['tickets', ticket], ['socials', social]]) {
      const a = await http('POST', '/api/' + kind, body); assert.equal(a.status, 200);
      const b = await local('POST', '/api/' + kind, body);
      assert.deepEqual(stable(a.data), stable(b)); assert.equal(a.data.score, kind === 'tickets' ? 75 : 60);
      assert.equal(a.data.reviewDate, '1405/06/20');
      const changed = { ...body, reviewDate: '1405/06/21', ...(kind === 'tickets' ? { redline: '0' } : { qFollow: '1' }) };
      const edited = await http('PUT', '/api/' + kind + '/' + a.data.id, changed);
      assert.equal(edited.status, 200);
      assert.deepEqual(stable(edited.data), stable(await local('PUT', '/api/' + kind + '/' + b.id, changed)));
      assert.equal(edited.data.score, kind === 'tickets' ? 0 : 100);
      const list = '/api/' + kind + '?' + day;
      assert.equal((await http('GET', list)).data.rows.some((row) => row.id === a.data.id), false);
      assert.deepEqual((await http('GET', list)).data, await local('GET', list));
      assert.equal((await http('DELETE', '/api/' + kind + '/' + a.data.id)).status, 200);
      await local('DELETE', '/api/' + kind + '/' + b.id);
    }
    await restore();
  });

  await t.test('upload is idempotent but different calls to the same phone/day are not discarded', async () => {
    const rows = [100, 0, ''].map((score, i) => ({ tele_expert_name: 'کارشناس الف', lead_name: 'شریک ' + i,
      lead_phone: '09120000000', action_date: '2026-08-25', form_created_date: '2026-09-11 17:00:00', score,
      red_line: i === 1 ? 1 : 0, red_line_reason: i === 1 ? 'گفتار نامناسب' : '', Call_opening_quality: [1, 0, '-'][i] }));
    const payload = { files: [{ name: 'tele_test.xlsx', rows }] };
    for (let i = 0; i < 2; i++) {
      const online = await http('POST', '/api/calls/files', payload);
      assert.equal(online.status, 200); assert.deepEqual(online.data, await local('POST', '/api/calls/files', payload));
      assert.equal(online.data.counts.total, 10);
    }
    const url = '/api/portfolio?ident=101&' + day;
    const online = (await http('GET', url)).data;
    assert.deepEqual(online, await local('GET', url));
    const calls = online.calls.rows.filter((r) => r.sourceFile === 'tele_test.xlsx');
    assert.equal(calls.length, 3);
    assert.deepEqual(calls.map((r) => r.reviewDate), ['1405/06/20', '1405/06/20', '1405/06/20']);
    assert.deepEqual(calls.map((r) => r.score), [100, 0, null]);
    await restore();
  });

  await t.test('data center immediately lists newly managed experts even without evaluations', async () => {
    const body = { name: 'کارشناس تازه', team: 'MLM', ext: 105 };
    assert.equal((await http('POST', '/api/agents', body)).status, 200);
    await local('POST', '/api/agents', body);
    const url = '/api/portfolio/agents?' + day + '&team=MLM';
    const online = (await http('GET', url)).data;
    assert.deepEqual(online, await local('GET', url));
    assert.equal(online.rows.length, 1); assert.equal(online.rows[0].totalCount, 0); assert.equal(online.rows[0].avgScore, '');
    await restore();
  });

  await t.test('backup uses only review date, and upper-bound-only cleanup works consistently', async () => {
    const online = (await http('GET', '/api/backup?' + day)).data;
    const offline = await local('GET', '/api/backup?' + day);
    assert.equal(online.tickets.length, 2); // T-2 ticketDate matches but reviewDate does not.
    assert.deepEqual(online.tickets, offline.tickets);
    assert.deepEqual(online.socials, offline.socials);
    assert.deepEqual(online.callFeedbacks, offline.callFeedbacks);
    const a = await http('DELETE', '/api/calls?to=1405%2F06%2F20');
    assert.deepEqual(a.data, await local('DELETE', '/api/calls?to=1405%2F06%2F20'));
    assert.equal(a.data.removed, 5);
    assert.equal((await http('GET', '/api/calls')).data.count, 2); // later day + undated, not attributed to this range
    await restore();
  });

  await t.test('recovery JSON folder input retains actual duration, reviewer, quoted redline reason and review date like API import', async (subt) => {
    subt.after(() => restore());
    const recovery = { teleRawData: [{ expertName: 'کارشناس الف', score: 0, redline: 1, redlineReason: 'گفتار "نامناسب"',
      leadName: 'شریک JSON', leadPhone: '09120000000', listeningTime: '30', callDuration: 0, qcAgent: 'QC اول',
      dateRaw: '1405/06/03', registrationDateRaw: '1405/06/20', elements: { Call_opening_quality: '0', active_engagement: '-' } }] };
    const file = path.join(server.dir, 'data/calls/qc_recovery.json');
    subt.after(() => fs.rmSync(file, { force: true }));
    fs.writeFileSync(file, JSON.stringify(recovery));
    assert.equal((await http('POST', '/api/calls/rescan', {})).status, 200);
    await local('POST', '/api/calls', { recovery });
    const online = (await http('GET', '/api/portfolio?ident=101&' + day)).data.calls.rows.find((r) => r.sourceFile === 'qc_recovery.json');
    const offline = (await local('GET', '/api/portfolio?ident=101&' + day)).calls.rows.find((r) => r.sourceFile === 'qc_recovery.json');
    const selected = (row) => [row.score, row.reviewDate, row.redlineReason, row.callDuration, row.qcAgent, row.elements];
    assert.deepEqual(selected(online), selected(offline));
    assert.equal(online.callDuration, '0'); assert.equal(online.qcAgent, 'QC اول');
    assert.equal(online.reviewDate, '1405/06/20'); assert.equal(online.redlineReason, 'گفتار "نامناسب"');
  });

  await t.test('folder scanner and browser upload read the real workbook identically (81, not 80)', async () => {
    const data = fixture(); data.callFeedbacks = [];
    await restore(data);
    const file = path.join(ROOT, 'data/seed-calls/qc_mlm_form_2026-09-26.xlsx');
    fs.copyFileSync(file, path.join(server.dir, 'data/calls/golden_mlm.xlsx'));
    const rescan = await http('POST', '/api/calls/rescan', {}); assert.equal(rescan.status, 200);
    const wb = X.readFile(file), rows = X.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
    await local('POST', '/api/calls/files', { files: [{ name: 'golden_mlm.xlsx', rows }] });
    const online = (await http('GET', '/api/dashboard?' + day)).data;
    assert.equal(online.callCount, 39);
    assert.deepEqual(online, await local('GET', '/api/dashboard?' + day));
    assert.equal((await http('GET', '/api/calls')).data.count, 81);
    assert.equal((await http('POST', '/api/calls/rescan', {})).data.changed, false);
  });
});
