'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const { createServer, loadSnapshot, FILES } = require('../server.js');

function checksum(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function checksums() {
  return Object.fromEntries(Object.entries(FILES).map(([name, file]) => [name, checksum(file)]));
}

test('snapshot reads the repository reference data without changing it', () => {
  const before = checksums();
  const snapshot = loadSnapshot({ force: true });
  const after = checksums();

  assert.deepEqual(after, before, 'source workbooks and JSON must remain byte-for-byte unchanged');
  assert.equal(snapshot.readOnly, true);
  assert.equal(snapshot.agents.length, 65);
  assert.equal(snapshot.calls.length, 293);
  assert.equal(snapshot.counts.mlmCalls, 81);
  assert.equal(snapshot.counts.accountCalls, 212);
  assert.equal(snapshot.tickets.length, 0);
  assert.equal(snapshot.socials.length, 0);
  assert.equal(snapshot.sources.find((source) => source.id === 'ticket').completeRecords, 0);
  assert.equal(snapshot.sources.find((source) => source.id === 'ticket').incompleteRows, 1);
  assert.equal(snapshot.sources.find((source) => source.id === 'social').completeRecords, 0);
  assert.equal(snapshot.sources.find((source) => source.id === 'social').incompleteRows, 3);
  assert.ok(snapshot.calls.every((call) => !Object.hasOwn(call, 'leadPhone') && !Object.hasOwn(call, 'leadName')));
});

test('HTTP app exposes data over GET and rejects writes', async (t) => {
  const before = checksums();
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;

  const health = await fetch(`${origin}/api/health`);
  assert.deepEqual(await health.json(), { ok: true, readOnly: true });

  const response = await fetch(`${origin}/api/snapshot`);
  assert.equal(response.status, 200);
  const snapshot = await response.json();
  assert.equal(snapshot.calls.length, 293);

  for (const method of ['POST', 'PUT', 'DELETE']) {
    const write = await fetch(`${origin}/api/snapshot`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: method === 'DELETE' ? undefined : JSON.stringify({ calls: [] })
    });
    assert.equal(write.status, 405, `${method} must not be accepted`);
    assert.match((await write.json()).error, /فقط‌خواندنی/);
  }
  assert.deepEqual(checksums(), before, 'HTTP requests must not alter source files');

  const page = await fetch(origin);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /QC Lite/);
});
