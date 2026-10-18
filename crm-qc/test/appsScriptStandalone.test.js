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
  constructor(name) { this.name = name; this.data = []; this.frozen = 0; }
  ensureCell(row, col) {
    while (this.data.length <= row) this.data.push([]);
    while (this.data[row].length <= col) this.data[row].push('');
  }
  getLastRow() {
    for (let i = this.data.length - 1; i >= 0; i--) if (this.data[i].some(value => value !== '' && value != null)) return i + 1;
    return 0;
  }
  getLastColumn() { return Math.max(0, ...this.data.map(row => row.reduce((last, value, i) => value !== '' && value != null ? i + 1 : last, 0))); }
  getRange(row, col, rows = 1, cols = 1) { return new FakeRange(this, row, col, rows, cols); }
  getDataRange() { return this.getRange(1, 1, Math.max(1, this.getLastRow()), Math.max(1, this.getLastColumn())); }
  clearContents() { this.data = []; return this; }
  setFrozenRows(rows) { this.frozen = rows; return this; }
  autoResizeColumns() { return this; }
}

class FakeSpreadsheet {
  constructor() { this.id = 'spreadsheet-test'; this.sheets = new Map(); }
  getId() { return this.id; }
  getSheetByName(name) { return this.sheets.get(name) || null; }
  insertSheet(name) { const sheet = new FakeSheet(name); this.sheets.set(name, sheet); return sheet; }
}

function createAppsScriptContext() {
  const spreadsheet = new FakeSpreadsheet();
  const properties = new Map();
  let uuid = 0;
  const context = {
    console,
    SpreadsheetApp: {
      getActiveSpreadsheet: () => spreadsheet,
      openById: id => { assert.equal(id, spreadsheet.id); return spreadsheet; },
      getUi: () => ({ createMenu: () => ({ addItem() { return this; }, addToUi() {} }) })
    },
    PropertiesService: { getScriptProperties: () => ({
      getProperty: key => properties.get(key) || null,
      setProperty: (key, value) => { properties.set(key, String(value)); return this; }
    }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    Utilities: {
      getUuid: () => `uuid-${++uuid}`,
      base64Encode: value => Buffer.from(value).toString('base64'),
      newBlob: value => ({ getBytes: () => Buffer.from(value) }),
      formatDate: date => date.toISOString()
    },
    Session: { getScriptTimeZone: () => 'UTC' },
    ScriptApp: { getService: () => ({ getUrl: () => 'https://script.google.com/macros/s/test/exec' }) },
    HtmlService: {
      createHtmlOutput: value => ({ setTitle(title) { this.title = title; return this; }, content: value }),
      createTemplateFromFile: name => ({ evaluate() { return { setTitle(title) { return { title, name }; } }; } })
    }
  };
  vm.createContext(context);
  const source = fs.readFileSync(path.join(__dirname, '..', 'apps-script-full', 'Code.gs'), 'utf8');
  vm.runInContext(source, context, { filename: 'Code.gs', timeout: 10000 });
  return { context, spreadsheet };
}

test('standalone Apps Script creates per-dataset tabs and uses them as the live API database', () => {
  const { context, spreadsheet } = createAppsScriptContext();
  const setup = context.setupStandaloneApp();
  assert.equal(setup.ok, true);
  assert.equal(setup.seeded, true);
  for (const name of ['Agents', 'Tickets', 'Socials', 'Calls', 'QC_Agents', 'Actions', 'Reminders', 'Settings', 'Lists', 'Meta']) {
    assert.ok(spreadsheet.getSheetByName(name), `missing ${name} tab`);
  }

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

  // Direct edits in the spreadsheet are visible to the next app request.
  const agentsSheet = spreadsheet.getSheetByName('Agents');
  const headers = agentsSheet.data[0];
  const manual = Array(headers.length).fill('');
  manual[headers.indexOf('id')] = 900;
  manual[headers.indexOf('name')] = 'Manual Sheet Agent';
  manual[headers.indexOf('team')] = 'Manual Team';
  manual[headers.indexOf('active')] = true;
  agentsSheet.data.push(manual);
  const afterEdit = context.crmqcApi('GET', '/api/agents', {});
  assert.equal(afterEdit.status, 200);
  assert.ok(afterEdit.data.some(row => row.name === 'Manual Sheet Agent'));
});
