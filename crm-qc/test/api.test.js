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
  for (const file of ['server.js', 'callWatcher.js', 'googleSheets.js']) fs.copyFileSync(path.join(ROOT, file), path.join(dir, file));
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
    assert.equal((await http('POST', '/api/backup', { backup: data, mode: 'replace' })).status, 200);
    await local('POST', '/api/backup', { backup: data, mode: 'replace' });
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

  await t.test('session snapshot is complete and date-independent, including lists/raw metadata/next IDs',async()=>{
    const online=(await http('GET','/api/session-snapshot?'+day)).data;
    const offline=await local('GET','/api/session-snapshot?'+day);
    for(const key of ['agents','qcAgents','settings','lists','seq','agentActions','tickets','socials','callFeedbacks'])assert.deepEqual(online[key],offline[key],key);
    assert.equal(online.tickets.length,3);assert.equal(online.socials.length,3);assert.equal(online.callFeedbacks.length,7);assert.equal(online.agents.length,4);
    assert.equal(online.callFeedbacks[1].score,0);assert.equal(online.callFeedbacks[2].score,null);
  });

  await t.test('Google Sheets settings hide credentials and require a valid Apps Script URL/token',async()=>{
    const initial=(await http('GET','/api/sheets/status')).data;
    assert.equal(initial.enabled,false); assert.equal(initial.initialized,false);
    const saved=await http('PUT','/api/sheets/config',{enabled:true,mode:'webapp',spreadsheetId:'test-sheet',
      webAppUrl:'https://script.google.com/macros/s/test-deployment/exec',webAppToken:'secret-token-12345678901234567890',
      syncPolicy:'merge',syncIntervalSec:60,pushOnWrite:true});
    assert.equal(saved.status,200); assert.equal(saved.data.status.needsInitialization,true);
    assert.equal(saved.data.config.webAppToken,''); assert.equal(saved.data.config.webAppTokenSet,true);
    assert.equal((await http('GET','/api/sheets/config')).data.webAppToken,'');
    const invalid=await http('PUT','/api/sheets/config',{enabled:true,mode:'webapp',webAppUrl:'https://example.com/app',webAppToken:'secret-token-12345678901234567890'});
    assert.equal(invalid.status,400);
    await http('PUT','/api/sheets/config',{enabled:false,mode:'webapp',webAppUrl:'',webAppToken:''});
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

  await t.test('new backup append/replace contract is identical online/offline and preserves other months', async subt => {
    subt.after(() => restore());
    assert.equal((await http('POST','/api/backup',{backup:fixture()})).status,400);
    await assert.rejects(local('POST','/api/backup',{backup:fixture()}),e=>e.status===400);
    const archive=fixture();archive.tickets=[];archive.socials=[];archive.callFeedbacks=[{...fixture().callFeedbacks[0],sourceFile:'new-month.xlsx',sourceRow:2,reviewDate:'1405/07/02'}];
    const payload={backup:archive,mode:'append'};
    for(let i=0;i<2;i++){
      const online=await http('POST','/api/backup',payload);assert.equal(online.status,200);assert.deepEqual(online.data,await local('POST','/api/backup',payload));
      assert.equal((await http('GET','/api/calls')).data.count,8);
      assert.equal((await http('GET','/api/dashboard?'+day)).data.callCount,5);
    }
  });
  await t.test('criteria edits affect real file parsing/reports; stale and invalid updates are rejected atomically', async subt=>{
    subt.after(()=>restore());
    const definitions=require('../shared/parseQc').defaults('tele');definitions[0].label='شروع سفارشی';definitions[0].excelKey='custom_opening';
    const payload={form:'tele',team:'Tele Sales',elements:definitions,version:0};
    const saved=await http('PUT','/api/criteria',payload);assert.equal(saved.status,200);assert.deepEqual(saved.data,await local('PUT','/api/criteria',payload));
    assert.equal((await http('PUT','/api/criteria',payload)).status,409);await assert.rejects(local('PUT','/api/criteria',payload),e=>e.status===409);
    const upload={files:[{name:'tele-configured.xlsx',rows:[{tele_expert_name:'کارشناس الف',score:87,review_date:'1405/06/20',custom_opening:0,lead_name:'شریک معیار'}]}],mode:'append'};
    const result=await http('POST','/api/calls/files',upload);assert.equal(result.status,200);assert.deepEqual(result.data,await local('POST','/api/calls/files',upload));
    const endpoint='/api/reports?type=call&agent='+encodeURIComponent('کارشناس الف')+'&'+day;
    const report=(await http('GET',endpoint)).data;assert.deepEqual(report,await local('GET',endpoint));
    assert.ok(report.elements.call.some(e=>e.label==='شروع سفارشی'&&e.bad===2));assert.equal(report.calls.find(c=>c.sourceFile==='tele-configured.xlsx').score,87);
  });
  await t.test('full-registry removal and Persian/invalid extensions have real HTTP/LocalApi parity',async subt=>{
    subt.after(()=>restore());
    assert.equal((await http('DELETE','/api/agents',{})).status,400);await assert.rejects(local('DELETE','/api/agents',{}),e=>e.status===400);
    const edit={ext:'۳۰۱۰',team:'MLM'};const edited=await http('PUT','/api/agents/1',edit);assert.equal(edited.status,200);assert.deepEqual(edited.data,await local('PUT','/api/agents/1',edit));
    assert.equal(edited.data.ext,3010);
    const invalid={name:'نام نباید تغییر کند',ext:'۱۲x'};assert.equal((await http('PUT','/api/agents/1',invalid)).status,400);await assert.rejects(local('PUT','/api/agents/1',invalid),e=>e.status===400);
    assert.equal((await http('GET','/api/agents')).data[0].name,'کارشناس الف');
    const confirmed={confirmation:'DELETE_ALL_AGENTS'};const removed=await http('DELETE','/api/agents',confirmed);assert.equal(removed.status,200);assert.deepEqual(removed.data,await local('DELETE','/api/agents',confirmed));
    assert.equal((await http('GET','/api/agents')).data.length,0);assert.equal((await http('GET','/api/calls')).data.count,7);
    assert.equal((await http('GET','/api/portfolio?ident='+encodeURIComponent('کارشناس الف')+'&'+day)).status,200);
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

/* گزارش‌گیری تکراری حافظه می‌شود (کلید = نسل داده + کاربر + فیلترها)؛ نوشتن باید
 * بلافاصله آن را باطل کند تا هیچ گزارش کهنه‌ای سرو نشود. */
test('report memoization speeds repeats up and never serves stale data after a write', async (t) => {
  const server = await startServer();
  t.after(async () => { await server.close(); });
  async function http(method, url, data) {
    const response = await fetch(server.origin + url, { method, headers: data ? { 'Content-Type': 'application/json' } : undefined,
      body: data ? JSON.stringify(data) : undefined });
    return { status: response.status, data: await response.json() };
  }
  const q = 'from=1405%2F06%2F20&to=1405%2F06%2F20';
  const urls = ['/api/reports?type=ticket&' + q, '/api/reports?type=combined&' + q, '/api/dashboard?' + q,
    '/api/data/status?' + q, '/api/monthly-summary', '/api/portfolio/agents?' + q];

  for (const url of urls) {
    const a = await http('GET', url);
    assert.equal(a.status, 200, url);
    assert.deepEqual(await http('GET', url), a, 'پاسخ تکراری باید یکی باشد: ' + url);
  }
  const before = {};
  for (const url of urls) before[url] = await http('GET', url);
  assert.equal(before['/api/data/status?' + q].data.tickets, 0);

  const bootstrap = await http('GET', '/api/bootstrap');
  const agent = bootstrap.data.agents[0];
  const posted = await http('POST', '/api/tickets', {
    qcAgent: bootstrap.data.qcAgents[0], reviewDate: '1405/06/20', ticketDate: '1405/06/20',
    agentName: agent.name, team: agent.team, ticketCode: 'MEMO-1',
    q1: '1', q2: '1', q3: '0', q4: '1', redline: '0', comment: 'memo'
  });
  assert.equal(posted.status, 200, JSON.stringify(posted.data));

  for (const url of urls) {
    const now = await http('GET', url);
    assert.equal(now.status, 200, url);
    assert.notDeepEqual(now.data, before[url].data, 'حافظه‌ی گزارش باید با نوشتن باطل شود: ' + url);
  }
  assert.equal((await http('GET', '/api/data/status?' + q)).data.tickets, 1);
});

/* سرعت: شماره‌ی نسخه‌ی تازه در همان پاسخ نوشتن برمی‌گردد تا کلاینت برای فهمیدن
 * تازگی داده یک رفت‌وبرگشت اضافه به /api/revision انجام ندهد. */
test('write responses carry the new revision header (no extra revision round trip)', async (t) => {
  const server = await startServer();
  t.after(() => server.close());
  const bootstrap = await (await fetch(server.origin + '/api/bootstrap')).json();
  const agent = bootstrap.agents[0];
  const response = await fetch(server.origin + '/api/tickets', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      qcAgent: bootstrap.qcAgents[0], reviewDate: '1405/06/20', ticketDate: '1405/06/20',
      agentName: agent.name, team: agent.team, ticketCode: 'REV-1',
      q1: '1', q2: '1', q3: '0', q4: '1', redline: '0', comment: 'revision'
    })
  });
  assert.equal(response.status, 200);
  const revision = Number(response.headers.get('x-qc-revision'));
  assert.ok(revision > Number(bootstrap.revision || 0),
    'revision باید جلو رفته باشد: ' + revision + ' > ' + bootstrap.revision);
  const after = await (await fetch(server.origin + '/api/revision')).json();
  assert.equal(Number(after.revision), revision, 'همان نسخه‌ای که در پاسخ آمد');
});

/* سرعت ورود: پاسخ /api/auth/login خودِ داده‌ی اولیه را هم می‌دهد تا کلاینت بعد
 * از رمز، یک /api/bootstrap کامل دیگر نگیرد. */
test('login response already carries the bootstrap payload (one round trip fewer)', async (t) => {
  const server = await startServer();
  t.after(() => server.close());
  const setup = await (await fetch(server.origin + '/api/auth/setup', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'مدیر سیستم', password: 'admin-1234' })
  })).json();
  assert.ok(setup.token, 'توکن در پاسخ راه‌اندازی');
  assert.ok(setup.bootstrap && setup.bootstrap.auth && setup.bootstrap.auth.user, 'bootstrap در پاسخ راه‌اندازی');

  const login = await (await fetch(server.origin + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'مدیر سیستم', password: 'admin-1234' })
  })).json();
  assert.equal(login.user.role, 'admin');
  assert.ok(login.token, 'توکن ورود');
  assert.ok(login.bootstrap, 'داده‌ی اولیه همراه ورود');
  assert.equal(login.bootstrap.auth.user.name, 'مدیر سیستم');
  const fresh = await (await fetch(server.origin + '/api/bootstrap', {
    headers: { Authorization: 'Bearer ' + login.token }
  })).json();
  assert.deepEqual(login.bootstrap.teams, fresh.teams, 'همان چیزی که مسیر عادی bootstrap می‌دهد');
  assert.equal(login.bootstrap.qcUsers.length, 1);
  assert.equal(login.bootstrap.agentActions, undefined, 'داده‌ی سنگین اقدام‌ها از بار اولیه حذف شده است');
});
