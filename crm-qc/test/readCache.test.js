'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { browser } = require('./helpers');

function reply(data, status = 200) {
  return { ok: status >= 200 && status < 300, status, headers: { get: () => null }, json: async () => data };
}

test('browser cache isolates tokens and full query, expires after two minutes and copies results', async () => {
  const calls = [];
  const { dom, w } = browser('public', undefined, async (url, opts) => {
    calls.push([url, opts.headers && opts.headers['x-qc-token']]);
    return reply({ value: calls.length, rows: [1] });
  });
  let now = 1000000; w.Date.now = () => now;
  try {
    w.QCAuth.token = 'admin-token';
    const first = await w.UI.api.get('/api/expert-ref?team=a');
    first.rows.push(2);
    assert.deepEqual(Array.from((await w.UI.api.get('/api/expert-ref?team=a')).rows), [1]);
    assert.equal(calls.length, 1);
    await w.UI.api.get('/api/expert-ref?team=b');
    assert.equal(calls.length, 2);
    w.QCAuth.token = 'qc-token';
    await w.UI.api.get('/api/expert-ref?team=a');
    assert.equal(calls.length, 3);
    assert.equal(calls[2][1], 'qc-token');
    now += 120000;
    await w.UI.api.get('/api/expert-ref?team=a');
    assert.equal(calls.length, 4);
    await w.UI.api.get('/api/auth/me'); await w.UI.api.get('/api/auth/me');
    await w.UI.api.get('/api/revision'); await w.UI.api.get('/api/revision');
    assert.equal(calls.length, 8, 'auth and revision must always reach the server');
  } finally { dom.window.close(); }
});

test('deduplicates reads, prevents old in-flight reads from repopulating after a write', async () => {
  let resolveRead, reads = 0;
  const { dom, w } = browser('public', undefined, (url, opts) => {
    if (opts.method !== 'GET') return Promise.resolve(reply({ ok: true }));
    reads++;
    if (reads === 1) return new Promise(resolve => { resolveRead = resolve; });
    return Promise.resolve(reply({ value: reads }));
  });
  try {
    w.QCAuth.token = 'admin';
    const a = w.UI.api.get('/api/dashboard');
    const b = w.UI.api.get('/api/dashboard');
    assert.equal(reads, 1);
    await w.UI.api.post('/api/actions', { title: 'new' });
    resolveRead(reply({ value: 1 }));
    await Promise.all([a, b]);
    const fresh = await w.UI.api.get('/api/dashboard');
    assert.equal(reads, 2);
    assert.equal(fresh.value, 2);
    w.App.markStale(3);
    await w.UI.api.get('/api/dashboard');
    assert.equal(reads, 3);
  } finally { dom.window.close(); }
});

test('cache survives reload only for validated session and is removed on logout or session failure', async () => {
  const calls = [];
  const fetch = async (url) => {
    calls.push(url);
    if (url === '/api/auth/me') return reply({ required: true, user: { name: 'Admin', role: 'admin' } });
    return reply({ rows: ['private'] });
  };
  const one = browser('public', undefined, fetch);
  const two = browser('public', undefined, fetch);
  try {
    one.w.QCAuth.token = 'secret'; one.w.QCAuth.user = { name: 'Admin', role: 'admin' }; one.w.QCAuth.persist();
    await one.w.UI.api.get('/api/dashboard');
    for (const key of ['crmqc.readCache.v1']) two.w.sessionStorage.setItem(key, one.w.sessionStorage.getItem(key));
    two.w.localStorage.setItem('crmqc.auth.v1', one.w.localStorage.getItem('crmqc.auth.v1'));
    assert.equal(await two.w.QCAuth.ensure(), true);
    await two.w.UI.api.get('/api/dashboard');
    assert.deepEqual(calls, ['/api/dashboard', '/api/auth/me']);
    two.w.QCAuth.clear();
    assert.equal(two.w.sessionStorage.getItem('crmqc.readCache.v1'), null);
  } finally { one.dom.window.close(); two.dom.window.close(); }
});

test('changed permissions or rejected session cannot reuse persisted data', async () => {
  let me = { required: true, user: { name: 'Admin', role: 'qc', exts: ['101'] } }, reads = 0;
  const { dom, w } = browser('public', undefined, async (url) => {
    if (url === '/api/auth/me') return reply(me);
    if (url === '/api/auth/accounts') return reply({ required: true, accounts: [] });
    reads++; return reply({ rows: [reads] });
  });
  try {
    w.QCAuth.token = 'same-token'; w.QCAuth.user = { name: 'Admin', role: 'admin' }; w.QCAuth.persist();
    await w.UI.api.get('/api/dashboard');
    assert.equal(await w.QCAuth.ensure(), true);
    assert.equal(w.sessionStorage.getItem('crmqc.readCache.v1'), null);
    await w.UI.api.get('/api/dashboard');
    assert.equal(reads, 2);
    me = { required: true, user: null };
    assert.equal(await w.QCAuth.ensure(), false);
    assert.equal(w.sessionStorage.getItem('crmqc.readCache.v1'), null);
    assert.equal(w.QCAuth.token, '');
  } finally { dom.window.close(); }
});
