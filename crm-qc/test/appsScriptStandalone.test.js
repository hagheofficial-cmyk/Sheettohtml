/* Executable Apps Script compatibility test: exercises the generated server bundle with Sheet stubs. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

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
      getUuid: () => `uuid-${++uuid}`,
      base64Encode: value => Buffer.from(value).toString('base64'),
      newBlob: value => ({ getBytes: () => Buffer.from(value) }),
      formatDate: date => date.toISOString()
    },
    Session: { getScriptTimeZone: () => 'UTC' },
    ScriptApp: {
      getService: () => ({ getUrl: () => 'https://script.google.com/macros/s/test/exec' }),
      getProjectTriggers: () => triggers.slice(),
      deleteTrigger: trigger => { const at = triggers.indexOf(trigger); if (at >= 0) triggers.splice(at, 1); },
      newTrigger: handler => ({
        forSpreadsheet: () => ({
          onChange: () => ({ create: () => triggers.push({ handler, getHandlerFunction: () => handler }) })
        })
      })
    },
    HtmlService: {
      createHtmlOutput: value => ({ content: value, setTitle(title) { this.title = title; return this; }, addMetaTag() { return this; } }),
      createHtmlOutputFromFile: name => ({ getContent: () => `<html data-file="${name}"></html>` })
    }
  };
  vm.createContext(context);
  const source = fs.readFileSync(path.join(__dirname, '..', 'apps-script-full', 'Code.gs'), 'utf8');
  vm.runInContext(source, context, { filename: 'Code.gs', timeout: 10000 });
  return { context, spreadsheet, cache, clock, triggers, properties };
}

test('standalone Apps Script creates per-dataset tabs and uses them as the live API database', () => {
  const { context, spreadsheet, cache, clock, triggers, properties } = createAppsScriptContext();
  const setup = context.setupStandaloneApp();
  assert.equal(setup.ok, true);
  assert.equal(setup.seeded, true);
  for (const name of ['Agents', 'Tickets', 'Socials', 'Calls', 'QC_Agents', 'Actions', 'Reminders', 'Settings', 'Lists', 'Meta']) {
    assert.ok(spreadsheet.getSheetByName(name), `missing ${name} tab`);
  }
  // Setup installs exactly one onChange trigger that keeps cached reads honest.
  assert.deepEqual(triggers.map(trigger => trigger.handler), ['crmqcOnSheetChange']);
  context.setupStandaloneApp();
  assert.deepEqual(triggers.map(trigger => trigger.handler), ['crmqcOnSheetChange'], 'trigger must not be duplicated');

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
  context.crmqcOnSheetChange();
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
  const refreshed = context.refreshFromSheet();
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
