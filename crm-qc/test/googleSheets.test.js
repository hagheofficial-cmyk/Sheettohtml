'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const Sheets = require('../googleSheets.js');

function fixture() {
  return {
    datasetId: 'dataset-1', registryCleared: false,
    agents: [{ id: 4, name: 'کارشناس الف', team: 'Tele sales', ext: 3073, active: false, aliases: ['الف'], createdAt: '2026-01-01', custom: 'keep' }],
    tickets: [{ id: 8, reviewDate: '1405/07/01', ticketDate: '1405/06/30', agentName: 'کارشناس الف', team: 'Tele sales', ticketCode: 'T-8', q1: '0', q2: '-', q3: '1', q4: '1', redline: '0', score: 0, comment: 'صفر واقعی', qcAgent: 'QC', createdAt: 'created' }],
    socials: [{ id: 9, reviewDate: '1405/07/02', receiveDate: '1405/07/02', replyDate: '1405/07/02', agentName: 'کارشناس الف', team: 'Tele sales', messenger: 'واتساپ', receiveTime: '10:00', replyTime: '10:05', responseStatus: 'پاسخ داده شده', delayReason: '', reasonVerdict: 'موجه', qSla: '1', qFollow: '0', qClosing: '-', qTone: '1', score: 0, durationMin: 5, slaStatus: 'داخل SLA', comment: 'نظر', qcAgent: 'QC', receiveWeekday: 'دوشنبه' }],
    callFeedbacks: [{ syncId: 'call-stable-1', expertName: 'کارشناس الف', score: 0, redline: 0, redlineReason: '', leadName: 'مشتری', leadPhone: '09120000000', listeningTime: '31', callDuration: '45', reviewDate: '1405/07/03', callDate: '1405/07/02', formType: 'tele', team: 'Tele sales', qcAgent: 'QC', qcComment: 'کامنت', elements: { first: 0, second: '-' }, sourceFile: 'qc_tele.xlsx', sourceRow: 2, evaluationId: '', privateFlag: 'retain' }],
    agentActions: { 'کارشناس الف': [{ id: 11, title: 'آموزش', date: '1405/07/04', status: 'انجام نشده', result: 'در انتظار', note: 'پیگیری', problem: 'ثبت اکشن', problemSource: 'ticket', createdAt: 'created' }] },
    settings: { ticketWeights: [40, 20, 20, 20], socialWeights: [30, 30, 25, 15], slaMinutes: 60, scoreBands: [90, 75, 50], workStart: '09:00' },
    qcAgents: ['QC'], lists: { messengers: ['واتساپ'] }, actionTypes: ['آموزش'],
    reminders: [{ id: 12, agent: 'کارشناس الف', date: '1405/07/05', text: 'یادآوری' }],
    seq: { ticket: 9, social: 10, agent: 5, action: 12, reminder: 13 },
    callImport: { importedAt: '2026-01-01', counts: { total: 1 } }
  };
}

test('Google Sheets rows round-trip keeps zero, tri-state, extra metadata and stable call IDs', () => {
  const original = fixture();
  const rows = Sheets.dbToSheetRows(original);
  const restored = Sheets.sheetRowsToDb(rows);
  assert.equal(restored.agents[0].active, false);
  assert.deepEqual(restored.agents[0].aliases, ['الف']);
  assert.equal(restored.agents[0].custom, 'keep');
  assert.equal(restored.tickets[0].score, 0);
  assert.equal(restored.tickets[0].q1, '0');
  assert.equal(restored.tickets[0].q2, '-');
  assert.equal(restored.tickets[0].redline, '0');
  assert.equal(restored.socials[0].durationMin, 5);
  assert.equal(restored.socials[0].receiveWeekday, 'دوشنبه');
  assert.equal(restored.calls[0].score, 0);
  assert.equal(restored.calls[0].syncId, 'call-stable-1');
  assert.deepEqual(restored.calls[0].elements, { first: 0, second: '-' });
  assert.equal(restored.calls[0].privateFlag, 'retain');
  assert.equal(restored.actions['کارشناس الف'][0].problem, 'ثبت اکشن');
  assert.deepEqual(restored.settings.ticketWeights, [40, 20, 20, 20]);
  assert.deepEqual(restored.qcAgents, ['QC']);
  assert.deepEqual(restored.lists, { messengers: ['واتساپ'] });
  assert.deepEqual(restored.reminders, [{ id: 12, agent: 'کارشناس الف', date: '1405/07/05', text: 'یادآوری' }]);
  assert.equal(restored.datasetId, 'dataset-1');
});

test('Gregorian Date cells from Google Sheets are normalized to Jalali dates for the app', () => {
  const pulled = Sheets.sheetRowsToDb({
    tickets: [{ id: '1', reviewDate: '2026-10-18', ticketDate: '2026-10-17', agentName: 'کارشناس الف', ticketCode: 'T-1' }],
    socials: [{ id: '1', reviewDate: '2026-10-18', receiveDate: '2026-10-17', replyDate: '2026-10-18', receiveTime: 0.3958333333, replyTime: 0.4375, agentName: 'کارشناس الف' }],
    calls: [{ syncId: 'call-1', reviewDate: '2026-10-18', callDate: '2026-10-17', expertName: 'کارشناس الف' }]
  });
  assert.equal(pulled.tickets[0].reviewDate, '1405/07/26');
  assert.equal(pulled.tickets[0].ticketDate, '1405/07/25');
  assert.equal(pulled.socials[0].receiveDate, '1405/07/25');
  assert.equal(pulled.socials[0].receiveTime, '09:30');
  assert.equal(pulled.socials[0].replyTime, '10:30');
  assert.equal(pulled.calls[0].callDate, '1405/07/25');
});

test('default pull merges by stable identity, updates matching rows and is idempotent', () => {
  const db = fixture();
  db.tickets.push({ id: 99, agentName: 'داده محلی که در شیت نیست', reviewDate: '1405/06/01' });
  const pulled = {
    agents: [{ id: 4, name: 'کارشناس الف', team: 'Account', ext: 3073, active: false, aliases: ['الف'] }],
    tickets: [{ id: 8, reviewDate: '1405/07/01', agentName: 'کارشناس الف', ticketCode: 'T-8', q1: '1', score: 90 }, { id: 10, agentName: 'کارشناس الف', ticketCode: 'T-10', reviewDate: '1405/07/04' }],
    socials: [], calls: [{ syncId: 'call-stable-1', sourceFile: 'qc_tele.xlsx', sourceRow: 2, formType: 'tele', expertName: 'کارشناس الف', reviewDate: '1405/07/03', score: 80, elements: { first: 1 } }],
    actions: [], settings: { ticketWeights: [40, 20, 20, 20] }
  };
  const first = Sheets.mergePullIntoDb(db, pulled, 'merge');
  assert.equal(first.changed, true);
  assert.equal(db.agents[0].team, 'Account');
  assert.equal(db.tickets.find(row => row.id === 8).score, 90);
  assert.equal(db.tickets.find(row => row.id === 8).createdAt, 'created');
  assert.ok(db.tickets.some(row => row.id === 99), 'merge does not delete local-only rows');
  assert.equal(db.callFeedbacks.length, 1, 'same source row is updated, not duplicated');
  assert.equal(db.callFeedbacks[0].score, 80);
  const second = Sheets.mergePullIntoDb(db, pulled, 'merge');
  assert.equal(second.changed, false);
});

test('sheet-authoritative policy propagates deleted rows without dropping independent call rows', () => {
  const db = fixture();
  db.tickets.push({ id: 100, agentName: 'حذف شونده' });
  db.callFeedbacks.push({ syncId: 'call-stable-2', expertName: 'کارشناس الف', sourceFile: 'qc_tele.xlsx', sourceRow: 3, formType: 'tele' });
  const result = Sheets.mergePullIntoDb(db, {
    agents: fixture().agents,
    tickets: [{ id: 8, agentName: 'کارشناس الف', ticketCode: 'T-8', reviewDate: '1405/07/01' }],
    socials: fixture().socials,
    calls: [{ syncId: 'call-stable-1', expertName: 'کارشناس الف', sourceFile: 'qc_tele.xlsx', sourceRow: 2, formType: 'tele' }],
    actions: [], settings: fixture().settings, qcAgents: ['QC'], lists: { messengers: ['واتساپ'] }
  }, 'sheet');
  assert.equal(result.changed, true);
  assert.deepEqual(db.tickets.map(row => row.id), [8]);
  assert.equal(db.callFeedbacks.length, 1);
  assert.equal(db.callFeedbacks[0].syncId, 'call-stable-1');
  assert.deepEqual(db.agentActions, {});
});

test('Apps Script HTTP redirects convert POST response redirects to GET and parse JSON', async t => {
  let receivedBody = '';
  const server = http.createServer((req, res) => {
    if (req.url === '/start' && req.method === 'POST') {
      req.setEncoding('utf8'); req.on('data', chunk => receivedBody += chunk);
      req.on('end', () => { res.writeHead(302, { Location: '/response' }); res.end(); });
      return;
    }
    if (req.url === '/response' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: true, method: 'GET' })); return;
    }
    res.writeHead(404); res.end('{}');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const address = server.address();
  const response = await Sheets.fetchJson(`http://127.0.0.1:${address.port}/start`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: { token: 'secret' }
  });
  assert.deepEqual(response.body, { ok: true, method: 'GET' });
  assert.equal(receivedBody, '{"token":"secret"}');
});

test('Apps Script and Node connector use identical managed tab headers', () => {
  const code = fs.readFileSync(path.join(__dirname, '../apps-script/Code.gs'), 'utf8');
  for (const [key, headers] of Object.entries(Sheets.HEADERS)) {
    const match = code.match(new RegExp('\\b' + key + ':\\s*\\[([^\\]]*)\\]'));
    assert.ok(match, 'missing Apps Script headers for ' + key);
    const actual = match[1].split(',').map(value => value.trim().replace(/^['\"]|['\"]$/g, ''));
    assert.deepEqual(actual, headers, 'header drift in ' + key);
  }
});

test('Web App config validation restricts URLs and requires an API token', () => {
  const good = Sheets.validateConfig({ enabled: true, mode: 'webapp', webAppUrl: 'https://script.google.com/macros/s/deployment/exec', webAppToken: 'x'.repeat(32) });
  assert.equal(good.enabled, true);
  assert.throws(() => Sheets.validateConfig({ enabled: true, mode: 'webapp', webAppUrl: 'http://script.google.com/macros/s/deployment/exec', webAppToken: 'x'.repeat(32) }), /URL امن/);
  assert.throws(() => Sheets.validateConfig({ enabled: true, mode: 'webapp', webAppUrl: 'https://example.com/deploy', webAppToken: 'x'.repeat(32) }), /URL امن/);
  assert.throws(() => Sheets.validateConfig({ enabled: true, mode: 'webapp', webAppUrl: 'https://script.google.com/macros/s/deployment/exec', webAppToken: 'short' }), /توکن/);
});
