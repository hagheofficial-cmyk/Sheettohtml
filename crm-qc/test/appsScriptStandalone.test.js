/* Executable Apps Script compatibility test: exercises the generated server bundle with Sheet stubs. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

class FakeRange {
  constructor(sheet, row, col, rows, cols) { Object.assign(this, { sheet, row, col, rows, cols }); }
  setValues(values) {
    for (let r = 0; r < values.length; r++) {
      for (let c = 0; c < values[r].length; c++) {
        this.sheet.ensureCell(this.row - 1 + r, this.col - 1 + c);
        this.sheet.data[this.row - 1 + r][this.col - 1 + c] = values[r][c];
      }
    }
    return this;
  }
  getValues() {
    const out = [];
    for (let r = 0; r < this.rows; r++) {
      const line = [];
      for (let c = 0; c < this.cols; c++) {
        const actual = this.sheet.data[this.row - 1 + r] || [];
        line.push(actual[this.col - 1 + c] == null ? '' : actual[this.col - 1 + c]);
      }
      out.push(line);
    }
    return out;
  }
  getValue() { return this.getValues()[0][0]; }
  setValue(value) { return this.setValues([[value]]); }
  setFontWeight() { return this; }
  setBackground() { return this; }
  setFontColor() { return this; }
}

class FakeSheet {
  constructor(name) { this.name = name; this.data = []; this.frozen = 0; this.calls = 0; }
  getName() { return this.name; }
  ensureCell(row, col) {
    while (this.data.length <= row) this.data.push([]);
    while (this.data[row].length <= col) this.data[row].push('');
  }
  getLastRow() {
    for (let i = this.data.length - 1; i >= 0; i--) if (this.data[i].some(value => value !== '' && value != null)) return i + 1;
    return 0;
  }
  getLastColumn() { return Math.max(0, ...this.data.map(row => row.reduce((last, value, i) => value !== '' && value != null ? i + 1 : last, 0))); }
  getRange(row, col, rows = 1, cols = 1) { this.calls++; return new FakeRange(this, row, col, rows, cols); }
  getDataRange() { this.calls++; return this.getRangeNoCount(1, 1, Math.max(1, this.getLastRow()), Math.max(1, this.getLastColumn())); }
  getRangeNoCount(row, col, rows, cols) { return new FakeRange(this, row, col, rows, cols); }
  clearContents() { this.calls++; this.data = []; return this; }
  deleteRows(row, count) { this.calls++; this.data.splice(row - 1, count); return this; }
  setFrozenRows(rows) { this.frozen = rows; return this; }
  autoResizeColumns() { return this; }
}

class FakeSpreadsheet {
  constructor() { this.id = 'spreadsheet-test'; this.sheets = new Map(); }
  getId() { return this.id; }
  getSheetByName(name) { return this.sheets.get(name) || null; }
  getSheets() { return [...this.sheets.values()]; }
  insertSheet(name) { const sheet = new FakeSheet(name); this.sheets.set(name, sheet); return sheet; }
}

/* TTL-aware stand-in for CacheService with a clock the test can fast-forward. */
class FakeClock {
  constructor() { this.offset = 0; }
  now() { return Date.now() + this.offset; }
  advance(ms) { this.offset += ms; return this; }
}

class FakeCache {
  constructor(clock) { this.clock = clock; this.values = new Map(); this.puts = 0; this.hits = 0; this.misses = 0; }
  live(key) {
    const entry = this.values.get(key);
    if (!entry) return null;
    if (entry.expiresAt && this.clock.now() > entry.expiresAt) { this.values.delete(key); return null; }
    return entry.value;
  }
  get(key) { const value = this.live(key); value == null ? this.misses++ : this.hits++; return value; }
  getAll(keys) {
    const out = {};
    keys.forEach(key => {
      const value = this.live(key);
      if (value == null) this.misses++; else { this.hits++; out[key] = value; }
    });
    return out;
  }
  put(key, value, ttlSeconds) {
    this.puts++;
    this.values.set(key, { value: String(value), expiresAt: ttlSeconds ? this.clock.now() + ttlSeconds * 1000 : 0 });
  }
  putAll(values, ttlSeconds) { Object.keys(values).forEach(key => this.put(key, values[key], ttlSeconds)); }
  remove(key) { this.values.delete(key); }
}

function createAppsScriptContext() {
  const spreadsheet = new FakeSpreadsheet();
  const properties = new Map();
  const clock = new FakeClock();
  const cache = new FakeCache(clock);
  const triggers = [];
  let uuid = 0;
  const context = {
    console,
    SpreadsheetApp: {
      getActiveSpreadsheet: () => spreadsheet,
      openById: id => { assert.equal(id, spreadsheet.id); return spreadsheet; },
      getUi: () => ({ createMenu: () => ({ addItem() { return this; }, addSeparator() { return this; }, addToUi() {} }) })
    },
    PropertiesService: { getScriptProperties: () => ({
      getProperty: key => properties.get(key) || null,
      setProperty: (key, value) => { properties.set(key, String(value)); return this; }
    }) },
    CacheService: { getScriptCache: () => cache },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    Utilities: {
      getUuid: () => `a1b2c3d4-e5f6-4a7b-8c9d-${String(++uuid).padStart(12, '0')}`,
      base64Encode: value => Buffer.from(value).toString('base64'),
      newBlob: value => ({ getBytes: () => Buffer.from(value) }),
      formatDate: date => date.toISOString(),
      /* Apps Script real digest: signed bytes, exactly like the Java-backed API */
      DigestAlgorithm: { SHA_256: 'SHA_256', MD5: 'MD5' },
      Charset: { UTF_8: 'UTF_8' },
      computeDigest: (algorithm, value) => Array.from(
        crypto.createHash(String(algorithm).indexOf('MD5') >= 0 ? 'md5' : 'sha256').update(String(value), 'utf8').digest(),
        (byte) => (byte > 127 ? byte - 256 : byte))
    },
    Session: { getScriptTimeZone: () => 'UTC' },
    ScriptApp: {
      getService: () => ({ getUrl: () => 'https://script.google.com/macros/s/test/exec' }),
      getProjectTriggers: () => triggers.slice(),
      deleteTrigger: trigger => { const at = triggers.indexOf(trigger); if (at >= 0) triggers.splice(at, 1); },
      newTrigger: handler => ({
        forSpreadsheet: () => ({
          onChange: () => ({ create: () => triggers.push({ handler, getHandlerFunction: () => handler }) }),
          onEdit: () => ({ create: () => triggers.push({ handler, getHandlerFunction: () => handler }) })
        })
      })
    },
    HtmlService: {
      createHtmlOutput: value => ({ content: value, setTitle(title) { this.title = title; return this; },
        addMetaTag() { return this; }, setFaviconUrl(url) { this.favicon = url; return this; } }),
      createHtmlOutputFromFile: name => ({ getContent: () => `<html data-file="${name}"></html>` })
    }
  };
  vm.createContext(context);
  const source = fs.readFileSync(path.join(__dirname, '..', 'apps-script-full', 'Code.gs'), 'utf8');
  vm.runInContext(source, context, { filename: 'Code.gs', timeout: 10000 });
  return { context, spreadsheet, cache, clock, triggers, properties };
}

function useTestAdmin(context) {
  context.createFirstAdmin_('مدیر سیستم', 'admin-1234-long');
  const raw = context.crmqcApi;
  const login = raw('POST', '/api/auth/login', { name: 'مدیر سیستم', password: 'admin-1234-long' });
  assert.equal(login.status, 200, JSON.stringify(login.data));
  context.crmqcApi = (method, url, body, token) => raw(method, url, body, token === undefined ? login.data.token : token);
  return login.data.token;
}

test('standalone Apps Script creates per-dataset tabs and uses them as the live API database', () => {
  const { context, spreadsheet, cache, clock, triggers, properties } = createAppsScriptContext();
  const setup = context.setupStandaloneApp_();
  assert.equal(setup.ok, true);
  assert.equal(setup.seeded, true);
  for (const name of ['Agents', 'Tickets', 'Socials', 'Calls', 'QC_Agents', 'Actions', 'Reminders', 'Settings', 'Lists', 'Meta']) {
    assert.ok(spreadsheet.getSheetByName(name), `missing ${name} tab`);
  }
  // Setup installs exactly one onChange trigger that keeps cached reads honest.
  assert.deepEqual(triggers.map(trigger => trigger.handler), ['crmqcOnSheetChange', 'crmqcOnSheetChange']);
  context.setupStandaloneApp_();
  assert.deepEqual(triggers.map(trigger => trigger.handler), ['crmqcOnSheetChange', 'crmqcOnSheetChange'], 'trigger must not be duplicated');

  useTestAdmin(context);
  const bootstrap = context.crmqcApi('GET', '/api/bootstrap', {});
  assert.equal(bootstrap.status, 200, bootstrap.data && bootstrap.data.error);
  assert.equal(bootstrap.data.agents.length, setup.counts.agents);
  const agent = bootstrap.data.agents[0];
  const ticket = context.crmqcApi('POST', '/api/tickets', {
    qcAgent: bootstrap.data.qcAgents[0],
    reviewDate: '1405/06/01', ticketDate: '1405/06/01',
    agentName: agent.name, team: agent.team, ticketCode: 'GAS-TEST-1',
    q1: '1', q2: '1', q3: '0', q4: '1', redline: '0', comment: 'test'
  });
  assert.equal(ticket.status, 200, ticket.data && ticket.data.error);
  assert.equal(ticket.data.id, 1);
  const ticketSheet = spreadsheet.getSheetByName('Tickets');
  assert.equal(ticketSheet.data.length, 2);
  assert.ok(ticketSheet.data[0].includes('ticketCode'));
  assert.ok(ticketSheet.data[1].includes('GAS-TEST-1'));
  const listed = context.crmqcApi('GET', '/api/tickets?per=15', {});
  assert.equal(listed.status, 200);
  assert.equal(listed.data.total, 1);
  assert.equal(listed.data.rows[0].ticketCode, 'GAS-TEST-1');

  const social = context.crmqcApi('POST', '/api/socials', {
    reviewDate: '1405/06/01', qcAgent: bootstrap.data.qcAgents[0],
    receiveDate: '1405/06/01', replyDate: '1405/06/01', agentName: agent.name,
    team: agent.team, messenger: 'واتساپ', receiveTime: '10:00', replyTime: '10:25',
    responseStatus: 'پاسخ داده شده', delayReason: '', reasonVerdict: 'کافی',
    qSla: '1', qFollow: '1', qClosing: '1', qTone: '1', comment: 'test'
  });
  assert.equal(social.status, 200, social.data && social.data.error);
  assert.equal(spreadsheet.getSheetByName('Socials').data.length, 2);
  const dataStatus = context.crmqcApi('GET', '/api/data/status', {});
  assert.equal(dataStatus.status, 200);
  assert.equal(dataStatus.data.tickets, 1);
  assert.equal(dataStatus.data.socials, 1);

  // Cached reads: repeated GETs must not touch the spreadsheet at all.
  const readCalls = () => spreadsheet.getSheets().reduce((total, sheet) => total + sheet.calls, 0);
  const before = readCalls();
  for (let i = 0; i < 5; i++) assert.equal(context.crmqcApi('GET', '/api/bootstrap', {}).status, 200);
  assert.equal(readCalls(), before, 'cached GETs must not re-read the tabs');
  assert.ok(cache.hits > 0, 'snapshot cache should be serving reads');

  // A direct spreadsheet edit is picked up as soon as the onChange trigger fires.
  const before0 = properties.get('QC_GAS_REV');
  const agentsSheet = spreadsheet.getSheetByName('Agents');
  const headers = agentsSheet.data[0];
  const manual = Array(headers.length).fill('');
  manual[headers.indexOf('id')] = 900;
  manual[headers.indexOf('name')] = 'Manual Sheet Agent';
  manual[headers.indexOf('team')] = 'Manual Team';
  manual[headers.indexOf('active')] = true;
  agentsSheet.data.push(manual);
  clock.advance(31000); // the app's own "self write" marker has expired by now
  context.crmqcOnSheetChange_();
  assert.notEqual(properties.get('QC_GAS_REV'), before0, 'external edit must bump the revision');
  const afterEdit = context.crmqcApi('GET', '/api/agents', {});
  assert.equal(afterEdit.status, 200);
  assert.ok(afterEdit.data.some(row => row.name === 'Manual Sheet Agent'));

  // Without the trigger (e.g. it was never installed) the manual refresh works too.
  const stale = Array(headers.length).fill('');
  stale[headers.indexOf('id')] = 901;
  stale[headers.indexOf('name')] = 'Refreshed Sheet Agent';
  stale[headers.indexOf('team')] = 'Manual Team';
  stale[headers.indexOf('active')] = true;
  agentsSheet.data.push(stale);
  const cachedRead = context.crmqcApi('GET', '/api/agents', {});
  assert.ok(!cachedRead.data.some(row => row.name === 'Refreshed Sheet Agent'), 'unchanged revision serves the snapshot');
  const refreshed = context.refreshFromSheet_();
  assert.equal(refreshed.ok, true);
  const afterRefresh = context.crmqcApi('GET', '/api/agents', {});
  assert.ok(afterRefresh.data.some(row => row.name === 'Refreshed Sheet Agent'));

  // Writes still land as minimal patches: appending a ticket touches only the tail.
  const tickets = spreadsheet.getSheetByName('Tickets');
  const tailCalls = tickets.calls;
  const second = context.crmqcApi('POST', '/api/tickets', {
    qcAgent: bootstrap.data.qcAgents[0],
    reviewDate: '1405/06/02', ticketDate: '1405/06/02',
    agentName: agent.name, team: agent.team, ticketCode: 'GAS-TEST-2',
    q1: '1', q2: '1', q3: '1', q4: '1', redline: '0', comment: 'append'
  });
  assert.equal(second.status, 200, second.data && second.data.error);
  assert.equal(tickets.data.length, 3);
  assert.ok(tickets.data[2].includes('GAS-TEST-2'));
  assert.ok(tickets.calls - tailCalls <= 2, 'append must not rewrite the whole tab');
  assert.ok(tickets.data[0].includes('ticketCode'), 'header row must survive the patch write');
  // The write republished its snapshot, so the next read is a cache hit again.
  const afterWrite = readCalls();
  assert.equal(context.crmqcApi('GET', '/api/data/status', {}).data.tickets, 2);
  assert.equal(readCalls(), afterWrite, 'write-through cache must serve the following read');
  // Cache TTL expiry simply falls back to reading the tabs.
  clock.advance((600 + 60) * 1000);
  assert.equal(context.crmqcApi('GET', '/api/data/status', {}).data.tickets, 2);
});

/* همان قابلیت‌های جدید، اما روی باندل مستقل Apps Script (بدون سرور Node). */
test('standalone Apps Script: ورود با رمز، دسترسی هر کارشناس QC، ماه مالی، تب المان‌ها و صفحه‌ی گزارش تماس', () => {
  const { context, spreadsheet, properties, cache, clock } = createAppsScriptContext();
  const setup = context.setupStandaloneApp_();
  assert.equal(setup.ok, true);
  const api = (method, url, body, token) => context.crmqcApi(method, url, body || {}, token);
  const C = require('../shared/calc');
  const t = C.todayJalali(), pm = C.jalaliMonthAdd(t.jy, t.jm, -1);
  const cur = C.jalaliMonthRange(t.jy, t.jm), prev = C.jalaliMonthRange(pm.jy, pm.jm);
  const months = [
    { name: 'دوره قبل', from: C.formatJalali(prev.from), to: C.formatJalali(prev.to) },
    { name: 'دوره جاری', from: C.formatJalali(cur.from), to: C.formatJalali(cur.to) }
  ];
  const ticketFor = (agentName, team, code, qcAgent) => ({
    qcAgent: qcAgent, reviewDate: C.formatJalali(cur.from), ticketDate: C.formatJalali(cur.from),
    agentName: agentName, team: team, ticketCode: code,
    q1: '1', q2: '1', q3: '0', q4: '1', redline: '0', comment: 'gas'
  });
  const sheet = (name) => {
    const found = spreadsheet.getSheetByName(name);
    assert.ok(found, 'تب ' + name + ' ساخته شده است');
    return { tab: found, head: found.data[0], rows: found.data.slice(1), col: (row, key) => row[found.data[0].indexOf(key)] };
  };

  /* No unauthenticated access or public first-admin setup. */
  const openBoot = api('GET', '/api/bootstrap');
  assert.equal(openBoot.status, 200);
  assert.equal(openBoot.data.auth.required, true);
  assert.equal(openBoot.data.agents.length, 0);
  assert.equal(api('POST', '/api/auth/setup', { name: 'intruder', password: 'intruder-long-password' }).status, 403);
  context.createFirstAdmin_('مدیر سیستم', 'admin-1234-long');
  const made = api('POST', '/api/auth/login', { name: 'مدیر سیستم', password: 'admin-1234-long' });
  assert.equal(made.status, 200, JSON.stringify(made.data));
  const adminToken = made.data.token;
  const agents = api('GET', '/api/bootstrap', {}, adminToken).data.agents;
  assert.ok(agents.length > 5);
  const target = agents[0], other = agents[1];
  assert.notEqual(target.ext, other.ext);

  const lockedBoot = api('GET', '/api/bootstrap');
  assert.equal(lockedBoot.data.auth.required, true);
  assert.equal(lockedBoot.data.agents.length, 0, 'پیش از ورود داده‌ای از شیت لو نمی‌رود');
  assert.equal(lockedBoot.data.counts.tickets, 0);
  assert.deepEqual([...lockedBoot.data.auth.accounts], []);
  assert.equal(api('POST', '/api/auth/login', { name: 'مدیر سیستم', password: 'wrong' }).status, 401);
  assert.equal(api('GET', '/api/settings', {}, 'not-a-token').status, 401);

  /* ۳) رمز hash‌شده روی تب QC_Users می‌نشیند (بدون افشا) */
  const users = sheet('QC_Users');
  /* ستون‌های اصلی طبق QC_GAS_SCHEMAS؛ کلیدهای اضافه‌ی ردیف‌ها (مثل updatedAt) هم حفظ می‌شوند */
  assert.deepEqual([...users.head].slice(0, 9), ['id', 'name', 'password', 'role', 'active', 'exts', 'agents', 'teams', 'note']);
  assert.equal(users.rows.length, 1);
  assert.equal(users.col(users.rows[0], 'name'), 'مدیر سیستم');
  assert.ok(String(users.col(users.rows[0], 'password')).indexOf('sha256$') === 0, 'رمز به‌صورت اثر انگشت ذخیره می‌شود');
  const adminBoot = api('GET', '/api/bootstrap', {}, adminToken);
  assert.equal(adminBoot.data.agents.length, agents.length, 'مدیر همه‌ی کارشناسان را می‌بیند');
  assert.equal(adminBoot.data.qcUsers[0].password, '••••••');

  /* ۴) تعریف کارشناس QC با داخلی یک کارشناس مشخص */
  const created = api('POST', '/api/qc-users',
    { name: 'مبینا', password: 'qc-1234-longer', role: 'qc', active: true, exts: String(target.ext) }, adminToken);
  assert.equal(created.status, 200, JSON.stringify(created.data));
  assert.deepEqual([...created.data.user.exts], [String(target.ext)]);
  assert.equal(sheet('QC_Users').rows.length, 2, 'کاربر دوم روی تب نوشته شد');

  /* ۵) ورود کارشناس QC → داده‌ی محدودشده و APIهای مدیریتی بسته */
  const qcLogin = api('POST', '/api/auth/login', { name: 'مبینا', password: 'qc-1234-longer' });
  assert.equal(qcLogin.status, 200);
  const qcToken = qcLogin.data.token;
  const qcBoot = api('GET', '/api/bootstrap', {}, qcToken);
  assert.deepEqual([...qcBoot.data.agents].map((a) => a.name), [target.name], 'فقط کارشناس مجاز');
  assert.equal(qcBoot.data.qcUsers, undefined);
  assert.equal(qcBoot.data.auth.admin, false);
  for (const url of ['/api/settings', '/api/criteria', '/api/qc-users', '/api/elements', '/api/fiscal-months']) {
    assert.equal(api('GET', url, {}, qcToken).status, 403, url + ' برای کارشناس QC بسته است');
  }
  assert.equal(api('GET', '/api/data/status', {}, qcToken).status, 200, 'شمارنده‌های صفحه برای QC باز است');

  const denied = api('POST', '/api/tickets', ticketFor(other.name, other.team, 'GAS-DENY', 'مبینا'), qcToken);
  assert.equal(denied.status, 403);
  assert.ok(denied.data.error.includes('دسترسی ندارید'), denied.data.error);
  const allowed = api('POST', '/api/tickets', ticketFor(target.name, target.team, 'GAS-OK', 'مبینا'), qcToken);
  assert.equal(allowed.status, 200, JSON.stringify(allowed.data));
  const tickets = sheet('Tickets');
  assert.ok(tickets.rows.some((row) => row.includes('GAS-OK')), 'رکورد مجاز روی تب Tickets نوشته شد');
  assert.ok(!tickets.rows.some((row) => row.includes('GAS-DENY')), 'رکورد غیرمجاز نوشته نمی‌شود');
  assert.equal(api('GET', '/api/tickets?per=15', {}, qcToken).data.total, 1);

  /* ۶) کش تحلیل برای کاربر محدودشده کلید جدا دارد و با نوشتن باطل می‌شود */
  assert.ok(cache.hits > 0, 'خواندن‌ها از کش سرو می‌شوند');
  const qcRead = api('GET', '/api/tickets?per=15', {}, qcToken);
  assert.equal(qcRead.data.total, 1);
  const adminRead = api('GET', '/api/tickets?per=15', {}, adminToken);
  assert.equal(adminRead.data.total, 1, 'مدیر هم همان یک رکورد را می‌بیند (داده هنوز یکی است)');

  /* ۷) خروج و خروج اجباری همه‌ی نشست‌ها */
  assert.equal(api('POST', '/api/auth/logout', { token: qcToken }, qcToken).status, 200);
  assert.equal(api('GET', '/api/bootstrap', {}, qcToken).data.auth.user, null);
  const epochBefore = properties.get('QC_GAS_TOKEN_EPOCH');
  assert.equal(context.clearSessions_().ok, true);
  assert.notEqual(properties.get('QC_GAS_TOKEN_EPOCH'), epochBefore, 'شماره‌ی نشست‌ها بالا می‌رود');
  assert.equal(api('GET', '/api/bootstrap', {}, adminToken).data.auth.user, null, 'توکن مدیر هم باطل شد');
  const relogin = api('POST', '/api/auth/login', { name: 'مدیر سیستم', password: 'admin-1234-long' });
  const token2 = relogin.data.token;

  /* ۸) بازه‌های ماه مالی روی تب Fiscal_Months */
  const saved = api('PUT', '/api/fiscal-months', { months: months }, token2);
  assert.equal(saved.status, 200, JSON.stringify(saved.data));
  const fiscal = sheet('Fiscal_Months');
  assert.deepEqual([...fiscal.head].slice(0, 5), ['id', 'name', 'from', 'to', 'note']);
  assert.deepEqual([...fiscal.rows].map((row) => fiscal.col(row, 'name')), ['دوره قبل', 'دوره جاری']);
  const readFiscal = api('GET', '/api/fiscal-months', {}, token2);
  assert.equal(readFiscal.data.current.name, 'دوره جاری');
  assert.equal(readFiscal.data.previous.name, 'دوره قبل');
  assert.deepEqual([...readFiscal.data.options].map((o) => o.value).slice(0, 2), ['fm:cur', 'fm:prev']);
  assert.equal(api('PUT', '/api/fiscal-months', { months: months }).status, 401, 'بدون نشست نوشته نمی‌شود');

  /* ۹) تب Elements: نوشتن از سامانه و ویرایش مستقیم روی شیت */
  const put = api('PUT', '/api/criteria',
    { form: 'tele', elements: [{ key: 'q1', label: 'سلام و شروع', excelKey: 'Q1', active: true }] }, token2);
  assert.equal(put.status, 200, JSON.stringify(put.data));
  const elements = sheet('Elements');
  assert.deepEqual([...elements.head].slice(0, 9), ['scope', 'team', 'form', 'key', 'label', 'excelKey', 'active', 'aliases', 'order']);
  const q1 = elements.rows.find((row) => elements.col(row, 'key') === 'q1');
  assert.ok(q1, 'ردیف المان روی تب نوشته شد');
  assert.equal(elements.col(q1, 'excelKey'), 'Q1');

  // ویرایش مستقیم روی شیت: نام فارسی و ستون اکسل جدید
  q1[elements.head.indexOf('label')] = 'سلام (ویرایش روی شیت)';
  q1[elements.head.indexOf('excelKey')] = 'Q1_SHEET';
  clock.advance(31000);
  context.crmqcOnSheetChange_();
  const afterEdit = api('GET', '/api/criteria', {}, token2);
  const def = afterEdit.data.config.forms.tele.find((d) => d.key === 'q1');
  assert.equal(def.label, 'سلام (ویرایش روی شیت)');
  assert.equal(def.excelKey, 'Q1_SHEET');
  assert.ok(def.aliases.includes('Q1'), 'ستون اکسل قبلی به aliases منتقل شد');
  const flat = api('GET', '/api/elements', {}, token2);
  assert.ok(flat.data.rows.some((row) => row.key === 'q1' && row.excelKey === 'Q1_SHEET'));

  /* ۱۰) خلاصه‌ی ماهانه روی تب Monthly_Summary */
  const rebuilt = context.rebuildMonthlySummary_();
  assert.equal(rebuilt.ok, true);
  assert.ok(rebuilt.rows >= 1);
  const summary = sheet('Monthly_Summary');
  assert.deepEqual([...summary.head].slice(0, 4), ['month', 'monthLabel', 'fiscal', 'agent']);
  assert.ok(summary.rows.length >= 1);
  assert.ok(summary.rows.some((row) => summary.col(row, 'agent') === target.name));
  /* رکورد نمونه در ۱۴۰۵/۰۶ است؛ نام ماه مالی همان بازه‌ی نوشته‌شده روی شیت می‌شود */
  const ticketRow = summary.rows.find((row) => summary.col(row, 'agent') === target.name);
  assert.equal(String(summary.col(ticketRow, 'month')), C.formatJalali(cur.from).slice(0, 7));
  assert.ok(months.some((m) => String(summary.col(ticketRow, 'fiscal')) === m.name),
    'ستون fiscal از تب Fiscal_Months پر می‌شود: ' + summary.col(ticketRow, 'fiscal'));
  const apiSummary = api('GET', '/api/monthly-summary', {}, token2);
  assert.equal(apiSummary.status, 200);
  assert.ok(apiSummary.data.rows.length >= 1);

  /* یک ستون اختصاصی برای هر کارشناس QC — نه یک ستون با نام‌های ویرگولی */
  assert.ok(!sheet('Agents').head.includes('qcAgents'), 'ستون متنی qcAgents دیگر ساخته نمی‌شود');

  // الف) ذخیره‌ی کاربر QC با تیک‌ها → ستون همان کارشناس QC تیک می‌خورد
  const synced = api('PUT', '/api/qc-users', { id: created.data.user.id, name: 'مبینا', role: 'qc', active: true,
    exts: '', agents: target.name, teams: '', syncColumn: true }, token2);
  assert.equal(synced.status, 200, JSON.stringify(synced.data));
  const written = sheet('Agents');
  assert.ok(written.head.includes('QC: مبینا'), 'ستون «QC: مبینا» ساخته می‌شود: ' + written.head.join('، '));
  const writtenTarget = written.rows.find((row) => written.col(row, 'name') === target.name);
  assert.equal(written.col(writtenTarget, 'QC: مبینا'), '✓', 'تیک همان ردیف روی ستون کارشناس QC می‌نشیند');
  const writtenOther = written.rows.find((row) => written.col(row, 'name') === other.name);
  assert.equal(String(written.col(writtenOther, 'QC: مبینا') || ''), '', 'کارشناس انتخاب‌نشده تیک ندارد');

  // ب) نوشتن مستقیم روی شیت (ستون همان QC) هم دسترسی می‌دهد (دوطرفه)
  writtenOther[written.head.indexOf('QC: مبینا')] = '✓';
  clock.advance(31000);
  context.crmqcOnSheetChange_();
  const qcLogin2 = api('POST', '/api/auth/login', { name: 'مبینا', password: 'qc-1234-longer' });
  assert.equal(qcLogin2.status, 200, JSON.stringify(qcLogin2.data));
  const qcBoot2 = api('GET', '/api/bootstrap', {}, qcLogin2.data.token);
  assert.deepEqual([...qcBoot2.data.agents].map((a) => a.name).sort(), [target.name, other.name].sort(),
    'ستون نوشته‌شده روی شیت به کارشناس QC دسترسی می‌دهد');

  // پ) شیت قدیمی بدون این ستون: با اولین نوشتن، سرستون‌ها درست بازنویسی می‌شود
  const tab = spreadsheet.getSheetByName('Agents');
  const dropped = tab.data[0].indexOf('QC: مبینا');
  tab.data = tab.data.map((row) => row.filter((cell, i) => i !== dropped));
  clock.advance(31000);
  context.crmqcOnSheetChange_();
  const moved = api('PUT', '/api/agents/' + target.id, { subgroup: 'بازبینی' }, token2);
  assert.equal(moved.status, 200, JSON.stringify(moved.data));
  const healed = sheet('Agents');
  assert.ok(healed.head.includes('QC: مبینا'), 'ستون از دست‌رفته دوباره ساخته می‌شود');
  const healedRow = healed.rows.find((row) => healed.col(row, 'id') === target.id);
  assert.ok(healedRow, 'ردیف کارشناس بعد از بازنویسی سر جایش است');
  assert.equal(healed.col(healedRow, 'name'), target.name, 'ستون‌ها جابه‌جا نمی‌شوند');
  assert.equal(healed.col(healedRow, 'ext'), target.ext, 'داخلی هم در ستون خودش می‌ماند');

  /* Direct report URL never exposes settings; admin RPC requires a token. */
  const callPage = context.doGet({ parameter: { page: 'call-report' } });
  assert.ok(callPage.content.includes('data-file="Index"'));
  assert.throws(() => context.getCallReportHtml(''));
  assert.ok(context.getCallReportHtml(token2).includes('data-file="CallReport"'));
  const indexPage = context.doGet({ parameter: {} });
  assert.ok(indexPage.content.includes('data-file="Index"'));
});

/* عملکرد: کش تب‌به‌تب با نسخه‌ی هر تب + خواندن جزئی. ثبت هر ریت و گزارش‌گیری
 * نباید کل شیت را بخواند، و نوشتنِ یک تب هرگز نباید تب‌های دیگر را پاک کند. */
test('standalone Apps Script: کش تب‌به‌تب — ثبت ریت و گزارش بدون خواندن کل شیت', () => {
  const { context, spreadsheet, cache, clock, properties } = createAppsScriptContext();
  context.setupStandaloneApp_();
  useTestAdmin(context);
  const sheet = (name) => spreadsheet.getSheetByName(name);
  const counters = () => { const o = {}; spreadsheet.getSheets().forEach((s) => { o[s.getName()] = s.calls; }); return o; };
  const delta = (a, b) => Object.keys(b).filter((k) => b[k] !== a[k]).map((k) => k + ':' + (b[k] - a[k]));
  const pick = (list, re) => list.filter((item) => re.test(item));

  /* داده‌ی حجیم در تب‌هایی که مسیر ثبت ریت هیچ نیازی به آن‌ها ندارد */
  const callsSheet = sheet('Calls');
  const callHead = callsSheet.data[0];
  for (let i = 0; i < 40; i++) {
    callsSheet.data.push(callHead.map((key) => {
      const row = { syncId: 'c' + i, expertName: 'کارشناس نمونه', team: 'تیم نمونه', score: 90, redline: 0,
        reviewDate: '1405/06/10', callDate: '1405/06/10', formType: 'tele', sourceRow: i + 2, listeningTime: '30', callDuration: '120' };
      return row[key] === undefined ? '' : row[key];
    }));
  }
  clock.advance(31000);
  context.crmqcOnSheetChange_();

  const bootstrap = context.crmqcApi('GET', '/api/bootstrap', {});
  assert.equal(bootstrap.status, 200, bootstrap.data && bootstrap.data.error);
  assert.equal(bootstrap.data.counts.calls, 40);
  const agent = bootstrap.data.agents[0];

  // ۱) GET گرم: هیچ تبی از شیت خوانده نمی‌شود
  let c0 = counters();
  for (let i = 0; i < 3; i++) assert.equal(context.crmqcApi('GET', '/api/bootstrap', {}).status, 200);
  assert.deepEqual(delta(c0, counters()), [], 'GET گرم نباید هیچ تبی را از شیت بخواند');
  assert.ok(cache.hits > 0, 'کش تب‌ها باید خواندن‌ها را سرو کند');

  const rate = (code) => context.crmqcApi('POST', '/api/tickets', {
    qcAgent: bootstrap.data.qcAgents[0], reviewDate: '1405/06/11', ticketDate: '1405/06/11',
    agentName: agent.name, team: agent.team, ticketCode: code,
    q1: '1', q2: '1', q3: '0', q4: '1', redline: '0', comment: 'perf'
  });

  // ۲) ثبت ریت: فقط تب تیکت (و Meta/خلاصه)؛ تماس‌ها و سوشال‌ها اصلاً خوانده نمی‌شوند
  c0 = counters();
  const first = rate('PERF-1');
  assert.equal(first.status, 200, first.data && first.data.error);
  const touched = delta(c0, counters());
  assert.ok(pick(touched, /^Tickets:/).length, 'تب تیکت باید نوشته شود');
  assert.deepEqual(pick(touched, /^(Calls|Socials|Agents|Actions|QC_Users|QC_Agents|Elements|Fiscal_Months|Reminders):/), [],
    'ثبت ریت نباید تب‌های بی‌ربط را بخواند یا بنویسد: ' + touched.join(' '));

  // ۳) نوشتنِ بعدی، تب خلاصه‌ی ماهانه را دوباره نمی‌سازد (throttle)
  c0 = counters();
  assert.equal(rate('PERF-2').status, 200);
  const touched2 = delta(c0, counters());
  assert.deepEqual(pick(touched2, /^Monthly_Summary:/), [], 'بازسازی خلاصه باید محدود به هر بازه‌ی زمانی باشد');
  assert.deepEqual(pick(touched2, /^(Calls|Socials|Agents):/), [], 'خواندن جزئی نباید به تب‌های دیگر دست بزند');

  // ۴) داده‌ی تب‌های دیگر سالم می‌ماند (خواندن جزئی به معنی پاک‌شدن تب نیست)
  assert.equal(sheet('Calls').data.length, 41);
  const status = context.crmqcApi('GET', '/api/data/status', {});
  assert.equal(status.status, 200);
  assert.equal(status.data.calls, 40);
  assert.equal(status.data.tickets, 2);

  // ۵) bootstrap پس از ذخیره (کاری که کلاینت می‌کند) بدون خواندن شیت، شمارش تازه دارد
  c0 = counters();
  const after = context.crmqcApi('GET', '/api/bootstrap', {});
  assert.equal(after.data.counts.tickets, 2);
  assert.equal(after.data.counts.calls, 40);
  assert.deepEqual(delta(c0, counters()), [], 'bootstrap پس از ریت نباید شیت را بخواند (کش write-through)');

  // ۶) پس از پایان بازه‌ی زمانی، نوشتنِ بعدی تب خلاصه را تازه می‌کند
  properties.set('QC_GAS_SUMMARY_AT', String(Date.now() - 10 * 60 * 1000));
  c0 = counters();
  assert.equal(rate('PERF-3').status, 200);
  assert.ok(pick(delta(c0, counters()), /^Monthly_Summary:/).length, 'پس از پایان بازه، خلاصه باید بازسازی شود');
  assert.ok(sheet('Monthly_Summary').data.length > 1, 'تب خلاصه باید سطر داشته باشد');
  const summary = context.crmqcApi('GET', '/api/monthly-summary', {});
  assert.equal(summary.status, 200);
  assert.equal(summary.data.rows.reduce((n, r) => n + (r.tickets || 0), 0), 3);

  // ۷) ویرایش مستقیم روی شیت: کش باطل می‌شود و خواندن بعدی از خود شیت است
  const agentsSheet = sheet('Agents');
  const head = agentsSheet.data[0];
  const manual = Array(head.length).fill('');
  manual[head.indexOf('id')] = 950;
  manual[head.indexOf('name')] = 'Perf Sheet Agent';
  manual[head.indexOf('team')] = 'تیم نمونه';
  manual[head.indexOf('active')] = true;
  agentsSheet.data.push(manual);
  clock.advance(31000);
  context.crmqcOnSheetChange_();
  c0 = counters();
  const agents = context.crmqcApi('GET', '/api/agents', {});
  assert.equal(agents.status, 200);
  assert.ok(agents.data.some((row) => row.name === 'Perf Sheet Agent'), 'ویرایش بیرونی باید دیده شود');
  assert.ok(delta(c0, counters()).length > 0, 'پس از ویرایش بیرونی، خواندن باید از شیت انجام شود');

  // ۸) بازخوانی دستی هم کش را دور می‌زند و داده‌ی کامل را برمی‌گرداند
  const refreshed = context.refreshFromSheet_();
  assert.equal(refreshed.ok, true);
  assert.equal(refreshed.counts.tickets, 3);
  assert.equal(refreshed.counts.calls, 40);
});

/* تور ایمنی خواندن جزئی: اگر مسیری تبی را تغییر دهد که بارگذاری نشده، باید
 * تشخیص داده شود تا درخواست با خواندن کامل تکرار شود (نه نوشتنِ تب خالی). */
test('partial loads detect mutations of tabs they did not read', () => {
  const { context, spreadsheet } = createAppsScriptContext();
  context.setupStandaloneApp_();
  const partial = context.normalizeDatabase_(context.readDatabase_(spreadsheet, ['meta', 'settings', 'lists', 'tickets']));
  const loaded = ['meta', 'settings', 'lists', 'tickets'];
  const beforeJson = context.diffFingerprints_(partial);
  /* آرایه‌های برگشتی از vm را بازسازی می‌کنیم تا مقایسه‌ی ساختاری معتبر باشد */
  const missingOf = (db) => Array.from(context.missingTabs_(beforeJson, db, loaded)).sort();
  assert.deepEqual(missingOf(partial), [], 'بدون تغییر، تبی جا نیفتاده است');

  const mutated = JSON.parse(JSON.stringify(partial));
  mutated.socials = [{ id: 1, agentName: 'کارشناس نمونه', reviewDate: '1405/06/11' }];
  assert.deepEqual(missingOf(mutated), ['socials']);

  mutated.callFeedbacks = [{ syncId: 'x', expertName: 'کارشناس نمونه' }];
  mutated.agentActions = { 'کارشناس نمونه': [{ id: 1, date: '1405/06/11', type: 'بازخورد' }] };
  assert.deepEqual(missingOf(mutated), ['agentActions', 'callFeedbacks', 'socials']);

  /* تغییرِ تبی که بارگذاری شده، «جاافتاده» حساب نمی‌شود */
  const okChange = JSON.parse(JSON.stringify(partial));
  okChange.tickets = [{ id: 1, ticketCode: 'T-1', agentName: 'کارشناس نمونه' }];
  assert.deepEqual(missingOf(okChange), []);
});

/* یک ستون برای هر کارشناس QC روی تب Agents: ساخت، تغییر نام، حذف و بقای ستونِ
 * دستی‌نوشته — این همان چیزی است که کاربر می‌خواهد به‌جای سلول‌های ویرگولی. */
test('standalone Apps Script: ستون اختصاصی هر کارشناس QC ساخته، تغییر نام و حذف می‌شود', () => {
  const { context, spreadsheet, clock } = createAppsScriptContext();
  context.setupStandaloneApp_();
  const token = useTestAdmin(context);
  const api = (method, url, body, token) => context.crmqcApi(method, url, body, token);
  const tab = () => spreadsheet.getSheetByName('Agents');
  const head = () => tab().data[0].map((cell) => String(cell));
  const column = (name) => head().indexOf('QC: ' + name);
  const rowOf = (name) => {
    const nameCol = head().indexOf('name');
    return tab().data.slice(1).find((row) => String(row[nameCol]) === name);
  };
  const target = api('GET', '/api/bootstrap').data.agents[0];
  const other = api('GET', '/api/bootstrap').data.agents[1];

  /* ۱) ساخت کاربر QC → ستون اختصاصی همان نام */
  const created = api('POST', '/api/qc-users', { name: 'مبینا', role: 'qc', active: true, password: 'qc-1234-longer' }, token);
  assert.equal(created.status, 200, JSON.stringify(created.data));
  assert.ok(column('مبینا') > 0, 'ستون «QC: مبینا» ساخته شد: ' + head().join('، '));
  const nameCol = head().indexOf('name');
  assert.equal(String(tab().data[0][nameCol]), 'name', 'ستون‌های پایه جابه‌جا نشدند');
  assert.ok(!head().includes('qcAgents'), 'ستون متنی قدیمی ساخته نمی‌شود');

  /* ۲) تیک زدن روی شیت (دستی) → در اپ همان کارشناس QC دیده می‌شود */
  rowOf(target.name)[column('مبینا')] = '✓';
  clock.advance(31000);
  context.crmqcOnSheetChange_();
  const seen = api('GET', '/api/agents', null, token).data.find((a) => a.name === target.name);
  assert.deepEqual([...seen.qcAgents], ['مبینا'], 'تیک ستون روی شیت به فهرست QC تبدیل شد');

  /* ۳) افزودن کارشناس QC دوم → ستون دوم بدون از دست رفتن تیک‌ها */
  const second = api('POST', '/api/qc-users', { name: 'هادی', role: 'qc', active: true, password: 'qc-5678-longer' }, token);
  assert.equal(second.status, 200, JSON.stringify(second.data));
  assert.ok(column('هادی') > 0, 'ستون دوم ساخته شد');
  assert.equal(rowOf(target.name)[column('مبینا')], '✓', 'تیک قبلی حفظ شد');
  assert.equal(String(rowOf(target.name)[column('هادی')] || ''), '', 'ستون جدید برای این کارشناس خالی است');

  /* ۴) کارشناس QC مسئول را عوض کن (تیک ها را در اپ بزن) */
  const both = api('PUT', '/api/agents/' + target.id, { qcAgents: ['هادی'] }, token);
  assert.equal(both.status, 200, JSON.stringify(both.data));
  assert.equal(String(rowOf(target.name)[column('مبینا')] || ''), '', 'تیک قدیمی برداشته شد');
  assert.equal(rowOf(target.name)[column('هادی')], '✓', 'تیک جدید نوشته شد');

  /* ۵) تغییر نام کاربر QC → سرستون همان ستون عوض می‌شود و تیک‌ها می‌مانند */
  const users = api('GET', '/api/qc-users', null, token).data.users;
  const hadi = users.find((u) => u.name === 'هادی');
  const renamed = api('PUT', '/api/qc-users', { id: hadi.id, name: 'هادی رضایی', role: 'qc', active: true, syncColumn: true }, token);
  assert.equal(renamed.status, 200, JSON.stringify(renamed.data));
  assert.ok(column('هادی رضایی') > 0, 'سرستون به نام تازه تغییر کرد');
  assert.equal(column('هادی'), -1, 'سرستون قدیمی نمانده است');
  assert.equal(rowOf(target.name)[column('هادی رضایی')], '✓', 'تیک بعد از تغییر نام حفظ شد');

  /* ۶) ستون دست‌نوشته‌ی روی شیت (نامی خارج از فهرست) با نوشتن‌های بعدی پاک نمی‌شود */
  const manual = tab();
  manual.data[0].push('QC: سارا');
  manual.data[1].push('✓');
  clock.advance(31000);
  context.crmqcOnSheetChange_();
  api('PUT', '/api/agents/' + other.id, { subgroup: 'واحد ویژه' }, token);
  assert.ok(head().indexOf('QC: سارا') > 0, 'ستون دست‌نوشته حفظ شد');
  const manualRow = rowOf(String(manual.data[1][manual.data[0].indexOf('name')]));
  assert.equal(String(manualRow[head().indexOf('QC: سارا')] || ''), '✓', 'تیک ستون دست‌نوشته حفظ شد');

  /* ۷) حذف حساب کاربر: تیک‌هایش پاک می‌شود ولی خودِ کارشناس QC (و ستونش) می‌ماند،
   * چون فهرست کارشناسان QC از حساب‌ها جداست و ممکن است بخواهید سوابقش بماند. */
  const beforeDelete = api('GET', '/api/qc-users', null, token).data.users;
  const deleted = api('DELETE', '/api/qc-users/' + beforeDelete.find((u) => u.name === 'هادی رضایی').id, null, token);
  assert.equal(deleted.status, 200, JSON.stringify(deleted.data));
  assert.ok(column('هادی رضایی') > 0, 'ستون کارشناس QC می‌ماند');
  assert.equal(String(rowOf(target.name)[column('هادی رضایی')] || ''), '', 'تیک‌های حساب حذف‌شده پاک شدند');
  assert.ok(column('مبینا') > 0, 'ستون بقیه‌ی کارشناسان QC سر جایش است');

  /* ۸) حذف خود کارشناس QC از فهرست → ستونش هم از شیت برداشته می‌شود */
  const dropped = api('DELETE', '/api/qc-agents/' + encodeURIComponent('هادی رضایی'), null, token);
  assert.equal(dropped.status, 200, JSON.stringify(dropped.data));
  assert.equal(column('هادی رضایی'), -1, 'با حذف کارشناس QC، ستونش برداشته می‌شود');
  assert.ok(column('مبینا') > 0, 'بقیه‌ی ستون‌ها دست‌نخورده‌اند');
});

test('anonymous web app fails closed and does not expose sheet or legacy report settings', () => {
  const { context } = createAppsScriptContext();
  context.setupStandaloneApp_();
  const api = (method, path, body, token) => context.crmqcApi(method, path, body || {}, token);
  assert.equal(api('GET', '/api/agents').status, 401);
  assert.equal(api('GET', '/api/tickets').status, 401);
  assert.equal(api('GET', '/api/session-snapshot').status, 403);
  assert.equal(api('POST', '/api/auth/setup', { name: 'attacker', password: 'attacker-long-password' }).status, 403);
  assert.equal(api('POST', '/api/auth/setup/extra', { name: 'attacker', password: 'attacker-long-password' }).status, 404);
  assert.equal(api('POST', '/api/auth/login/extra', { name: 'attacker', password: 'attacker-long-password' }).status, 404);
  assert.deepEqual([...api('GET', '/api/bootstrap').data.agents], []);
  assert.equal(api('GET', '/api/bootstrap').data.counts.tickets, 0);
  assert.deepEqual(Object.keys(api('GET', '/api/bootstrap').data.lists), []);
  assert.throws(() => context.getCallReportHtml(''));
  assert.throws(() => context.getCallReportSettings(''));
  assert.throws(() => context.saveCallReportSetting('bimeh_bazar_experts_v2', '[]', ''));
  assert.ok(context.doGet({ parameter: { page: 'call-report' } }).content.includes('data-file="Index"'));
  assert.throws(() => context.createFirstAdmin_('مدیر', 'short'));
  context.createFirstAdmin_('مدیر', 'strong-password-123');
  assert.throws(() => context.createFirstAdmin_('attacker', 'another-strong-password'));
  const login = api('POST', '/api/auth/login', { name: 'مدیر', password: 'strong-password-123' });
  assert.equal(login.status, 200);
  const admin = login.data.token;
  assert.ok(context.getCallReportHtml(admin).includes('data-file="CallReport"'));
  assert.equal(context.saveCallReportSetting('bimeh_bazar_experts_v2', '[]', admin).ok, true);
  assert.equal(api('GET', '/api/session-snapshot', {}, admin).status, 403);
  assert.equal(api('PUT', '/api/settings', { authMode: 'off' }, admin).status, 403);
  assert.equal(api('POST', '/api/qc-users', { name: 'short', role: 'qc', password: 'short' }, admin).status, 400);
  const qc = api('POST', '/api/qc-users', { name: 'QC', role: 'qc', exts: '*', password: 'strong-qc-password' }, admin);
  assert.equal(qc.status, 200, JSON.stringify(qc.data));
  const qcLogin = api('POST', '/api/auth/login', { name: 'QC', password: 'strong-qc-password' });
  const qcToken = qcLogin.data.token;
  assert.equal(qcLogin.data.user.role, 'qc');
  for (const path of ['/api/qc-users', '/api/settings', '/api/backup', '/api/criteria'])
    assert.equal(api('GET', path, {}, qcToken).status, 403, path);
  assert.equal(api('PUT', '/api/settings', { orgName: 'intrusion' }, qcToken).status, 403);
  assert.throws(() => context.getCallReportHtml(qcToken));
  assert.throws(() => context.saveCallReportSetting('bimeh_bazar_experts_v2', '[]', qcToken));
  const id = qc.data.user.id;
  assert.equal(api('PUT', '/api/qc-users/' + id, { id, name: 'QC', role: 'qc', exts: '*', password: 'new-qc-password-456' }, admin).status, 200);
  assert.equal(api('GET', '/api/tickets', {}, qcToken).status, 401, 'old token must expire when password changes');
  assert.equal(api('POST', '/api/auth/login', { name: 'QC', password: 'new-qc-password-456' }).status, 200);
});

test('anonymous login is throttled and error messages do not enumerate users', () => {
  const { context } = createAppsScriptContext();
  context.setupStandaloneApp_();
  context.createFirstAdmin_('مدیر', 'strong-password-123');
  const login = (name, password) => context.crmqcApi('POST', '/api/auth/login', { name, password });
  assert.equal(login('missing', 'bad').data.error, login('مدیر', 'bad').data.error);
  for (let i = 0; i < 4; i++) assert.equal(login('مدیر', 'bad').status, 401);
  assert.equal(login('مدیر', 'strong-password-123').status, 429);
});

test('generated server has no public administrative RPC functions', () => {
  const { context } = createAppsScriptContext();
  const exposed = Object.keys(context).filter(name => typeof context[name] === 'function' && !name.endsWith('_'));
  assert.deepEqual(exposed.sort(), ['URLSearchParams', 'crmqcApi', 'doGet', 'getCallReportHtml', 'getCallReportSettings', 'onOpen', 'saveCallReportSetting', 'setupStandaloneApp', 'createFirstAdminFromSheet', 'resetAdminFromSheet', 'refreshFromSheet', 'rebuildMonthlySummary', 'clearSessions', 'crmqcOnSheetChange'].sort());
});


test('owner-only menu functions fail in a web-app context', () => {
  const { context, properties } = createAppsScriptContext();
  context.setupStandaloneApp();
  const epoch = properties.get('QC_GAS_TOKEN_EPOCH');
  context.SpreadsheetApp.getActiveSpreadsheet = () => null;
  for (const name of ['setupStandaloneApp', 'createFirstAdminFromSheet', 'resetAdminFromSheet', 'refreshFromSheet', 'rebuildMonthlySummary', 'clearSessions', 'crmqcOnSheetChange'])
    assert.throws(() => context[name](), undefined, name);
  assert.equal(properties.get('QC_GAS_TOKEN_EPOCH'), epoch);
});

test('owner can upgrade an old short admin password without exposing setup to the web', () => {
  const { context, spreadsheet } = createAppsScriptContext();
  context.setupStandaloneApp_();
  context.createFirstAdmin_('مدیر', 'strong-password-123');
  const before = context.crmqcApi('POST', '/api/auth/login', { name: 'مدیر', password: 'strong-password-123' });
  assert.equal(before.status, 200);
  context.resetAdmin_('مدیر', 'new-strong-password-456');
  assert.equal(context.crmqcApi('GET', '/api/tickets', {}, before.data.token).status, 401);
  assert.equal(context.crmqcApi('POST', '/api/auth/login', { name: 'مدیر', password: 'new-strong-password-456' }).status, 200);
  assert.throws(() => context.resetAdmin_('مدیر', 'short'));
  const users = spreadsheet.getSheetByName('QC_Users');
  assert.ok(users.data[1].some(value => String(value).startsWith('sha256$')));
  users.data[1][users.data[0].indexOf('password')] = context.QCAccess.hashPassword('short');
  context.crmqcOnSheetChange_();
  assert.equal(context.crmqcApi('POST', '/api/auth/login', { name: 'مدیر', password: 'short' }).status, 401, 'legacy short password cannot be used');
  context.resetAdmin_('مدیر', 'restored-strong-password-123');
  assert.equal(context.crmqcApi('POST', '/api/auth/login', { name: 'مدیر', password: 'restored-strong-password-123' }).status, 200);
});

test('default generated pages bundle their scripts and set Apps Script mode before route code', () => {
  const { JSDOM } = require('jsdom');
  for (const file of ['Index.html', 'CallReport.html']) {
    const html = fs.readFileSync(path.join(__dirname, '..', 'apps-script-full', file), 'utf8');
    const dom = new JSDOM(html);
    const remote = [...dom.window.document.querySelectorAll('script[src],link[href]')]
      .map(node => node.getAttribute('src') || node.getAttribute('href'))
      .filter(url => /^https?:\/\//i.test(url));
    assert.deepEqual(remote, [], file + ' must not load external executable code or styles');
    assert.ok(!html.includes('__CF$cv$params'), file + ' must not contain legacy challenge scripts');
    dom.window.close();
    if (file === 'Index.html') {
      assert.ok(html.indexOf('window.APP_SCRIPT_MODE = true') < html.indexOf('/* pages/callReport.js */'));
    }
  }
});

test('generated anonymous web app starts in locked Apps Script mode without a Google user', async () => {
  const { JSDOM, VirtualConsole } = require('jsdom');
  const html = fs.readFileSync(path.join(__dirname, '..', 'apps-script-full', 'Index.html'), 'utf8')
    .split('__QC_APP_SCRIPT_URL__').join('https://script.google.com/macros/s/demo/exec');
  const seen = [];
  const dom = new JSDOM(html, {
    url: 'https://example.test/', runScripts: 'dangerously', pretendToBeVisual: true,
    virtualConsole: new VirtualConsole(),
    beforeParse(w) {
      w.scrollTo = () => {};
      const runner = {
        withSuccessHandler(fn) { this.ok = fn; return this; },
        withFailureHandler(fn) { this.fail = fn; return this; },
        crmqcApi(method, url) {
          seen.push([method, url]);
          const ok = this.ok;
          setTimeout(() => ok({ status: 200, data: { required: true, accounts: [], firstRun: false, orgName: '' } }), 0);
        }
      };
      w.google = { script: { run: runner } };
    }
  });
  try {
    await new Promise(resolve => setTimeout(resolve, 150));
    assert.equal(dom.window.APP_SCRIPT_MODE, true);
    assert.equal(dom.window.QCAuth.required, true);
    assert.equal(dom.window.document.querySelector('#authGate').hidden, false);
    assert.ok(seen.some(call => call[1] === '/api/auth/accounts'));
    assert.ok(!seen.some(call => call[1] === '/api/bootstrap'));
  } finally { dom.window.close(); }
});
