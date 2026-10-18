/*
 * Source template for the standalone Apps Script deployment.
 * `npm --prefix crm-qc run build:apps-script` combines this with the shared
 * QC logic, seed data and the browser LocalApi router into deployable Code.gs.
 *
 * The browser UI is hosted by HtmlService. All business records are read from
 * and written to their own tabs in the bound Google Spreadsheet.
 */

var QC_GAS_SHEETS = {
  agents: 'Agents',
  tickets: 'Tickets',
  socials: 'Socials',
  calls: 'Calls',
  qcAgents: 'QC_Agents',
  actions: 'Actions',
  reminders: 'Reminders',
  actionTypes: 'Action_Types',
  settings: 'Settings',
  lists: 'Lists',
  criteria: 'Criteria',
  meta: 'Meta',
  callMeta: 'Call_Metadata',
  callReportExperts: 'Call_Report_Experts',
  callReportAccess: 'Call_Report_Access'
};

var QC_GAS_SCHEMAS = {
  Agents: ['id', 'ext', 'name', 'team', 'active', 'subgroup', 'aliases'],
  Tickets: ['id', 'qcAgent', 'reviewDate', 'ticketDate', 'agentName', 'team', 'ticketCode', 'q1', 'q2', 'q3', 'q4', 'redline', 'score', 'comment', 'createdAt', 'updatedAt', 'sourceAgentName', 'demo'],
  Socials: ['id', 'reviewDate', 'qcAgent', 'receiveDate', 'receiveWeekday', 'replyDate', 'replyWeekday', 'agentName', 'team', 'messenger', 'receiveTime', 'replyTime', 'responseStatus', 'delayReason', 'reasonVerdict', 'qSla', 'qFollow', 'qClosing', 'qTone', 'durationMin', 'durationError', 'slaStatus', 'score', 'comment', 'messageLink', 'createdAt', 'updatedAt', 'sourceAgentName', 'demo'],
  Calls: ['syncId', 'expertName', 'sourceExpertName', 'team', 'score', 'redline', 'redlineReason', 'leadName', 'leadPhone', 'listeningTime', 'callDuration', 'qcAgent', 'qcComment', 'reviewDate', 'callDate', 'formType', 'evaluationId', 'sourceFile', 'sourceRow', 'datasetId', 'criteriaVersion', 'criteriaSnapshot', 'elements', 'demo'],
  QC_Agents: ['name'],
  Actions: ['id', 'agent', 'title', 'date', 'note', 'status', 'result', 'problem', 'problemSource', 'createdAt', 'updatedAt'],
  Reminders: ['id', 'agent', 'date', 'text', 'done', 'createdAt', 'updatedAt'],
  Action_Types: ['label'],
  Settings: ['key', 'value'],
  Lists: ['key', 'value'],
  Criteria: ['key', 'value'],
  Meta: ['key', 'value'],
  Call_Metadata: ['key', 'value'],
  Call_Report_Experts: ['json'],
  Call_Report_Access: ['json']
};

var QC_GAS_KV_SHEETS = {
  Settings: true, Lists: true, Criteria: true, Meta: true, Call_Metadata: true
};

var QC_GAS_CALL_REPORT_KEYS = {
  bimeh_bazar_experts_v2: 'Call_Report_Experts',
  bimeh_bazar_team_access_profiles_v1: 'Call_Report_Access'
};

function onOpen() {
  try {
    SpreadsheetApp.getUi()
      .createMenu('سامانه QC مستقل')
      .addItem('راه‌اندازی / بررسی تب‌های سامانه', 'setupStandaloneApp')
      .addToUi();
  } catch (err) {
    // onOpen may also run outside the spreadsheet editor.
  }
}

/**
 * Run once from the bound spreadsheet's Apps Script editor.
 * Creates separate database tabs and seeds only a genuinely empty workbook.
 */
function setupStandaloneApp() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('این اسکریپت را از داخل Google Sheet مقصد اجرا کنید.');

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    PropertiesService.getScriptProperties().setProperty('QC_GAS_SPREADSHEET_ID', ss.getId());
    Object.keys(QC_GAS_SCHEMAS).forEach(function (name) {
      var sheet = ss.getSheetByName(name) || ss.insertSheet(name);
      ensureHeader_(sheet, QC_GAS_SCHEMAS[name]);
    });

    var meta = readKeyValueSheet_(ss.getSheetByName(QC_GAS_SHEETS.meta));
    var hasData = ['Agents', 'Tickets', 'Socials', 'Calls', 'Actions', 'Reminders']
      .some(function (name) { var sh = ss.getSheetByName(name); return sh && sh.getLastRow() > 1; });

    var db;
    if (meta.datasetId) {
      db = readDatabase_(ss);
      normalizeDatabase_(db);
      writeDatabaseDiff_(ss, db, db, true);
    } else if (hasData) {
      // Respect pre-existing tabs and data; do not replace them with sample data.
      db = readDatabase_(ss);
      normalizeDatabase_(db);
      if (!db.datasetId) db.datasetId = Utilities.getUuid();
      writeDatabaseDiff_(ss, {}, db, true);
    } else {
      db = makeSeedDatabase_();
      writeDatabaseDiff_(ss, {}, db, true);
    }

    return {
      ok: true,
      spreadsheetId: ss.getId(),
      seeded: !meta.datasetId && !hasData,
      tabs: Object.keys(QC_GAS_SCHEMAS),
      counts: databaseCounts_(db)
    };
  } finally {
    lock.releaseLock();
  }
}

/** Public URL: `.../exec`; `?page=call-report` serves the legacy call report tool. */
function doGet(e) {
  var id = PropertiesService.getScriptProperties().getProperty('QC_GAS_SPREADSHEET_ID');
  if (!id) {
    return HtmlService.createHtmlOutput(
      '<meta charset="utf-8"><div dir="rtl" style="font:16px sans-serif;padding:32px">' +
      '<h2>سامانه هنوز راه‌اندازی نشده است</h2><p>در Apps Script تابع <code>setupStandaloneApp</code> را از شیت مقصد اجرا و سپس Deploy کنید.</p></div>'
    ).setTitle('راه‌اندازی سامانه QC');
  }

  // Placeholder replacement (not HtmlService templates) keeps the bundled
  // vendor libraries intact: `<?` inside their source would otherwise be
  // parsed as an Apps Script scriptlet.
  var page = e && e.parameter && e.parameter.page;
  if (page === 'call-report') {
    var callHtml = HtmlService.createHtmlOutputFromFile('CallReport').getContent()
      .replace('__QC_CALL_REPORT_STORAGE_B64__', Utilities.base64Encode(
        Utilities.newBlob(JSON.stringify(readCallReportSettings_()), 'application/json').getBytes()
      ));
    return HtmlService.createHtmlOutput(callHtml)
      .setTitle('گزارش تماس روزانه')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
  }

  var indexHtml = HtmlService.createHtmlOutputFromFile('Index').getContent()
    .replace('__QC_APP_SCRIPT_URL__', ScriptApp.getService().getUrl());
  return HtmlService.createHtmlOutput(indexHtml)
    .setTitle('سامانه یکپارچه کنترل کیفیت CRM')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/**
 * Apps Script RPC endpoint used by the SPA's fetch-compatible bridge.
 * Each request reads the current spreadsheet state; writes are serialized by
 * LockService and only the tabs changed by the operation are rewritten.
 */
function crmqcApi(method, requestUrl, body) {
  method = String(method || 'GET').toUpperCase();
  requestUrl = String(requestUrl || '/');
  body = body && typeof body === 'object' ? body : {};

  var ss;
  try {
    ss = getDatabaseSpreadsheet_();
  } catch (error) {
    return { status: 503, data: { error: error.message || 'شیت دیتابیس پیدا نشد.' } };
  }

  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
    var before = readDatabase_(ss);
    normalizeDatabase_(before);
    window.LocalApi.replaceSnapshot(before);
    window.__GAS_DB_DIRTY__ = false;

    var result = window.LocalApi.run(method, requestUrl, body);
    var after = window.LocalApi.backup();
    if (window.__GAS_DB_DIRTY__ || JSON.stringify(before) !== JSON.stringify(after)) {
      writeDatabaseDiff_(ss, before, after, false);
    }
    return { status: 200, data: jsonSafe_(result) };
  } catch (error) {
    return {
      status: Number(error && error.status) || 500,
      data: { error: String(error && error.message || 'خطای Apps Script') }
    };
  } finally {
    try { lock.releaseLock(); } catch (ignored) {}
  }
}

/** Read a saved setting used by the separate daily call report page. */
function getCallReportSettings() {
  return readCallReportSettings_();
}

/** Persist the two legacy call-report configuration lists in their own tabs. */
function saveCallReportSetting(key, jsonValue) {
  var sheetName = QC_GAS_CALL_REPORT_KEYS[String(key || '')];
  if (!sheetName) throw new Error('کلید تنظیمات گزارش تماس مجاز نیست.');
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var ss = getDatabaseSpreadsheet_();
    var text = String(jsonValue == null ? '' : jsonValue);
    if (text) JSON.parse(text); // reject malformed JSON rather than corrupt the settings tab
    var sheet = ss.getSheetByName(sheetName);
    ensureHeader_(sheet, ['json']);
    sheet.clearContents();
    sheet.getRange(1, 1, 1, 1).setValues([['json']]);
    if (text) sheet.getRange(2, 1, 1, 1).setValues([[text]]);
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

function getDatabaseSpreadsheet_() {
  var id = PropertiesService.getScriptProperties().getProperty('QC_GAS_SPREADSHEET_ID');
  if (!id) throw new Error('ابتدا تابع setupStandaloneApp را از شیت مقصد اجرا کنید.');
  return SpreadsheetApp.openById(id);
}

function makeSeedDatabase_() {
  var seed = JSON.parse(JSON.stringify(window.QC_SEED || {}));
  var maxAgentId = Math.max(0, ...(seed.agents || []).map(function (agent) { return Number(agent.id) || 0; }));
  var db = Object.assign({}, seed, {
    tickets: [],
    socials: [],
    callFeedbacks: [],
    callRaw: null,
    callImport: null,
    callSync: { files: {}, syncedAt: null },
    seq: { ticket: 1, social: 1, agent: maxAgentId + 1, action: 1, reminder: 1 },
    datasetId: Utilities.getUuid(),
    createdAt: new Date().toISOString(),
    agentActions: {},
    actionTypes: Array.isArray(seed.actionTypes) ? seed.actionTypes : undefined,
    reminders: [],
    registryCleared: false
  });
  window.QCExpertRef.ensure(db);
  return db;
}

function normalizeDatabase_(db) {
  var seed = window.QC_SEED || {};
  db = db || {};
  db.version = db.version || seed.version || 1;
  db.agents = Array.isArray(db.agents) ? db.agents : [];
  db.qcAgents = Array.isArray(db.qcAgents) ? db.qcAgents : (seed.qcAgents || []);
  db.tickets = Array.isArray(db.tickets) ? db.tickets : [];
  db.socials = Array.isArray(db.socials) ? db.socials : [];
  db.callFeedbacks = Array.isArray(db.callFeedbacks) ? db.callFeedbacks : [];
  db.settings = Object.assign({}, seed.settings || {}, db.settings || {});
  db.lists = Object.assign({}, seed.lists || {}, db.lists || {});
  db.seq = Object.assign({ ticket: 1, social: 1, agent: 1, action: 1, reminder: 1 }, db.seq || {});
  db.agentActions = db.agentActions || {};
  db.actionTypes = Array.isArray(db.actionTypes) ? db.actionTypes : undefined;
  db.reminders = Array.isArray(db.reminders) ? db.reminders : [];
  db.callImport = db.callImport || null;
  db.callRaw = db.callRaw || null;
  db.callSync = db.callSync || { files: {}, syncedAt: null };
  db.datasetId = db.datasetId || Utilities.getUuid();
  db.createdAt = db.createdAt || new Date().toISOString();
  window.QCExpertRef.ensure(db);

  db.seq.ticket = Math.max(Number(db.seq.ticket) || 1, nextId_(db.tickets));
  db.seq.social = Math.max(Number(db.seq.social) || 1, nextId_(db.socials));
  db.seq.agent = Math.max(Number(db.seq.agent) || 1, nextId_(db.agents));
  var actions = Object.keys(db.agentActions).reduce(function (all, key) { return all.concat(db.agentActions[key] || []); }, []);
  db.seq.action = Math.max(Number(db.seq.action) || 1, nextId_(actions));
  db.seq.reminder = Math.max(Number(db.seq.reminder) || 1, nextId_(db.reminders));
  return db;
}

function nextId_(rows) {
  return Math.max(0, ...(rows || []).map(function (row) { return Number(row && row.id) || 0; })) + 1;
}

function readDatabase_(ss) {
  var meta = readKeyValueSheet_(ss.getSheetByName(QC_GAS_SHEETS.meta));
  var settings = readKeyValueSheet_(ss.getSheetByName(QC_GAS_SHEETS.settings));
  var lists = readKeyValueSheet_(ss.getSheetByName(QC_GAS_SHEETS.lists));
  var criteria = readKeyValueSheet_(ss.getSheetByName(QC_GAS_SHEETS.criteria));
  var callMeta = readKeyValueSheet_(ss.getSheetByName(QC_GAS_SHEETS.callMeta));
  var actions = readRowsSheet_(ss.getSheetByName(QC_GAS_SHEETS.actions));
  var agentActions = {};
  actions.forEach(function (action) {
    var name = String(action.agent || '').trim();
    if (!name) return;
    if (!agentActions[name]) agentActions[name] = [];
    delete action.agent;
    agentActions[name].push(action);
  });

  var actionTypes = readRowsSheet_(ss.getSheetByName(QC_GAS_SHEETS.actionTypes))
    .map(function (row) { return String(row.label || '').trim(); }).filter(Boolean);

  var db = {
    version: meta.version || 1,
    datasetId: meta.datasetId || '',
    createdAt: meta.createdAt || '',
    registryCleared: !!meta.registryCleared,
    seq: meta.seq || {},
    agents: readRowsSheet_(ss.getSheetByName(QC_GAS_SHEETS.agents)),
    qcAgents: readRowsSheet_(ss.getSheetByName(QC_GAS_SHEETS.qcAgents)).map(function (row) { return String(row.name || '').trim(); }).filter(Boolean),
    tickets: readRowsSheet_(ss.getSheetByName(QC_GAS_SHEETS.tickets)),
    socials: readRowsSheet_(ss.getSheetByName(QC_GAS_SHEETS.socials)),
    callFeedbacks: readRowsSheet_(ss.getSheetByName(QC_GAS_SHEETS.calls)),
    callImport: callMeta.callImport || null,
    callRaw: callMeta.callRaw || null,
    callSync: callMeta.callSync || { files: {}, syncedAt: null },
    agentActions: agentActions,
    actionTypes: actionTypes.length ? actionTypes : undefined,
    reminders: readRowsSheet_(ss.getSheetByName(QC_GAS_SHEETS.reminders)),
    settings: settings,
    lists: lists
  };
  if (criteria.callCriteria) db.settings.callCriteria = criteria.callCriteria;
  return db;
}

function writeDatabaseDiff_(ss, before, after, forceAll) {
  before = before || {};
  after = normalizeDatabase_(JSON.parse(JSON.stringify(after || {})));
  var changed = function (key) { return forceAll || JSON.stringify(before[key] == null ? null : before[key]) !== JSON.stringify(after[key] == null ? null : after[key]); };
  if (changed('agents')) writeRowsSheet_(ss.getSheetByName(QC_GAS_SHEETS.agents), after.agents, 'Agents');
  if (changed('tickets')) writeRowsSheet_(ss.getSheetByName(QC_GAS_SHEETS.tickets), after.tickets, 'Tickets');
  if (changed('socials')) writeRowsSheet_(ss.getSheetByName(QC_GAS_SHEETS.socials), after.socials, 'Socials');
  if (changed('callFeedbacks')) writeRowsSheet_(ss.getSheetByName(QC_GAS_SHEETS.calls), after.callFeedbacks, 'Calls');
  if (changed('qcAgents')) writeRowsSheet_(ss.getSheetByName(QC_GAS_SHEETS.qcAgents), (after.qcAgents || []).map(function (name) { return { name: name }; }), 'QC_Agents');

  var beforeActions = before.agentActions || {};
  var afterActions = after.agentActions || {};
  if (forceAll || JSON.stringify(beforeActions) !== JSON.stringify(afterActions)) {
    var flatActions = [];
    Object.keys(afterActions).forEach(function (name) {
      (afterActions[name] || []).forEach(function (row) { flatActions.push(Object.assign({}, row, { agent: name })); });
    });
    writeRowsSheet_(ss.getSheetByName(QC_GAS_SHEETS.actions), flatActions, 'Actions');
  }
  if (changed('reminders')) writeRowsSheet_(ss.getSheetByName(QC_GAS_SHEETS.reminders), after.reminders, 'Reminders');
  if (changed('actionTypes')) writeRowsSheet_(ss.getSheetByName(QC_GAS_SHEETS.actionTypes), (after.actionTypes || []).map(function (label) { return { label: label }; }), 'Action_Types');

  var beforeSettings = Object.assign({}, before.settings || {});
  var afterSettings = Object.assign({}, after.settings || {});
  delete beforeSettings.callCriteria;
  delete afterSettings.callCriteria;
  if (forceAll || JSON.stringify(beforeSettings) !== JSON.stringify(afterSettings)) writeKeyValueSheet_(ss.getSheetByName(QC_GAS_SHEETS.settings), beforeSettings, afterSettings);
  if (forceAll || JSON.stringify((before.settings || {}).callCriteria || null) !== JSON.stringify((after.settings || {}).callCriteria || null)) {
    writeKeyValueSheet_(ss.getSheetByName(QC_GAS_SHEETS.criteria), {}, { callCriteria: (after.settings || {}).callCriteria || {} });
  }
  if (changed('lists')) writeKeyValueSheet_(ss.getSheetByName(QC_GAS_SHEETS.lists), before.lists || {}, after.lists || {});

  var beforeMeta = {
    version: before.version || after.version,
    datasetId: before.datasetId || after.datasetId,
    createdAt: before.createdAt || after.createdAt,
    registryCleared: !!before.registryCleared,
    seq: before.seq || {}
  };
  var afterMeta = {
    version: after.version,
    datasetId: after.datasetId,
    createdAt: after.createdAt,
    registryCleared: !!after.registryCleared,
    seq: after.seq
  };
  if (forceAll || JSON.stringify(beforeMeta) !== JSON.stringify(afterMeta)) {
    writeKeyValueSheet_(ss.getSheetByName(QC_GAS_SHEETS.meta), beforeMeta, afterMeta);
  }

  var beforeCallMeta = { callImport: before.callImport || null, callRaw: before.callRaw || null, callSync: before.callSync || null };
  var afterCallMeta = { callImport: after.callImport || null, callRaw: after.callRaw || null, callSync: after.callSync || null };
  if (forceAll || JSON.stringify(beforeCallMeta) !== JSON.stringify(afterCallMeta)) {
    writeKeyValueSheet_(ss.getSheetByName(QC_GAS_SHEETS.callMeta), beforeCallMeta, afterCallMeta);
  }
}

function writeRowsSheet_(sheet, rows, schemaName) {
  if (!sheet) throw new Error('تب موردنیاز ایجاد نشده است: ' + schemaName);
  rows = Array.isArray(rows) ? rows : [];
  var schema = QC_GAS_SCHEMAS[schemaName] || [];
  var keys = schema.slice();
  rows.forEach(function (row) {
    Object.keys(row || {}).forEach(function (key) { if (keys.indexOf(key) < 0) keys.push(key); });
  });
  if (!keys.length) keys = ['id'];
  var values = [keys].concat(rows.map(function (row) {
    return keys.map(function (key) { return encodeCell_(row && row[key]); });
  }));
  sheet.clearContents();
  sheet.getRange(1, 1, values.length, keys.length).setValues(values);
  styleHeader_(sheet, keys.length);
}

function writeKeyValueSheet_(sheet, before, after) {
  if (!sheet) throw new Error('تب تنظیمات ایجاد نشده است.');
  var rows = [['key', 'value']];
  Object.keys(after || {}).sort().forEach(function (key) { rows.push([key, encodeCell_(after[key])]); });
  sheet.clearContents();
  sheet.getRange(1, 1, rows.length, 2).setValues(rows);
  styleHeader_(sheet, 2);
}

function readRowsSheet_(sheet) {
  if (!sheet || sheet.getLastRow() < 2 || sheet.getLastColumn() < 1) return [];
  var values = sheet.getRange(1, 1, sheet.getLastRow(), sheet.getLastColumn()).getValues();
  var headers = values[0].map(function (header) { return String(header == null ? '' : header).trim(); });
  var out = [];
  for (var r = 1; r < values.length; r++) {
    var row = {}, populated = false;
    for (var c = 0; c < headers.length; c++) {
      var key = headers[c];
      if (!key) continue;
      var value = decodeCell_(values[r][c], key);
      if (value !== '' && value != null) populated = true;
      row[key] = value;
    }
    if (populated) out.push(row);
  }
  return out;
}

function readKeyValueSheet_(sheet) {
  if (!sheet || sheet.getLastRow() < 2) return {};
  var rows = sheet.getRange(1, 1, sheet.getLastRow(), Math.max(2, sheet.getLastColumn())).getValues();
  var out = {};
  for (var i = 1; i < rows.length; i++) {
    var key = String(rows[i][0] == null ? '' : rows[i][0]).trim();
    if (!key) continue;
    out[key] = decodeCell_(rows[i][1], key);
  }
  return out;
}

function writeSingleJsonSheet_(sheetName, value) {
  var ss = getDatabaseSpreadsheet_();
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) throw new Error('تب گزارش تماس پیدا نشد: ' + sheetName);
  ensureHeader_(sheet, ['json']);
  sheet.clearContents();
  sheet.getRange(1, 1, 1, 1).setValues([['json']]);
  if (value != null && value !== '') sheet.getRange(2, 1, 1, 1).setValue(String(value));
}

function readSingleJsonSheet_(ss, sheetName, fallback) {
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet || sheet.getLastRow() < 2) return fallback;
  var raw = sheet.getRange(2, 1).getValue();
  if (raw == null || raw === '') return fallback;
  return String(raw);
}

function readCallReportSettings_() {
  var ss = getDatabaseSpreadsheet_();
  return {
    bimeh_bazar_experts_v2: readSingleJsonSheet_(ss, QC_GAS_SHEETS.callReportExperts, '[]'),
    bimeh_bazar_team_access_profiles_v1: readSingleJsonSheet_(ss, QC_GAS_SHEETS.callReportAccess, '[]')
  };
}

function ensureHeader_(sheet, headers) {
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    styleHeader_(sheet, headers.length);
  } else if (sheet.getLastColumn() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    styleHeader_(sheet, headers.length);
  } else {
    sheet.setFrozenRows(1);
  }
}

function styleHeader_(sheet, width) {
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, width)
    .setFontWeight('bold')
    .setBackground('#0b6da8')
    .setFontColor('#ffffff');
  sheet.autoResizeColumns(1, Math.min(width, 20));
}

function encodeCell_(value) {
  if (value == null) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') return JSON.stringify(value);
  return value;
}

function decodeCell_(value, key) {
  if (value == null || value === '') return '';
  if (value instanceof Date) {
    try { return Utilities.formatDate(value, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss'); }
    catch (ignored) { return value.toISOString(); }
  }
  if (typeof value === 'string') {
    var text = value.trim();
    if (text && (text.charAt(0) === '{' || text.charAt(0) === '[')) {
      try { return JSON.parse(text); } catch (ignored) {}
    }
    if (key === 'id' || key === 'ext' || key === 'sourceRow' || key === 'durationMin' || key === 'score') {
      if (/^-?\d+(?:\.\d+)?$/.test(text)) return Number(text);
    }
    if (key === 'active' || key === 'done') {
      if (/^(true|yes|1)$/i.test(text)) return true;
      if (/^(false|no|0)$/i.test(text)) return false;
    }
    return value;
  }
  return value;
}

function databaseCounts_(db) {
  return {
    agents: (db.agents || []).length,
    tickets: (db.tickets || []).length,
    socials: (db.socials || []).length,
    calls: (db.callFeedbacks || []).length
  };
}

function jsonSafe_(value) {
  if (value === undefined) return null;
  return JSON.parse(JSON.stringify(value));
}
