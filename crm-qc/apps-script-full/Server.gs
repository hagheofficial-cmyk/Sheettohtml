/*
 * Source template for the standalone Apps Script deployment.
 * `npm --prefix crm-qc run build:apps-script` combines this with the shared
 * QC logic, seed data and the browser LocalApi router into deployable Code.gs.
 *
 * The browser UI is hosted by HtmlService. All business records are read from
 * and written to their own tabs in the bound Google Spreadsheet.
 *
 * Latency budget (SpreadsheetApp calls dominate, ~13 tabs):
 *   - reads  → served from CacheService keyed by a revision stamp, so a normal
 *              page load costs a properties read plus one cache round trip
 *              instead of ~27 spreadsheet calls;
 *   - writes → always read the sheet fresh under LockService, then patch only
 *              the changed rows/ranges and refresh the cache for later reads;
 *   - direct sheet edits → an installed onChange trigger bumps the revision, so
 *              the next read reloads instead of serving a stale snapshot.
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
  callReportAccess: 'Call_Report_Access',
  fiscalMonths: 'Fiscal_Months',
  qcUsers: 'QC_Users',
  elements: 'Elements',
  monthlySummary: 'Monthly_Summary'
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
  Call_Report_Access: ['json'],
  /* بازه‌های ماه مالی؛ مستقیم روی شیت قابل نوشتن‌اند (بند ۲) */
  Fiscal_Months: ['id', 'name', 'from', 'to', 'note'],
  /* کاربران QC: نام، رمز، نقش، فعال و دسترسی‌ها (بند ۵) */
  QC_Users: ['id', 'name', 'password', 'role', 'active', 'exts', 'agents', 'teams', 'note'],
  /* نگاشت المان‌ها: نام فارسی و ستون اکسل، قابل ویرایش روی شیت (بند ۹) */
  Elements: ['scope', 'team', 'form', 'key', 'label', 'excelKey', 'active', 'aliases', 'order'],
  /* خلاصه‌ی ماهانه‌ی آماده برای خواندن/خروجی سریع (بند ۸) */
  Monthly_Summary: ['month', 'monthLabel', 'fiscal', 'agent', 'ext', 'team', 'qcAgents', 'tickets',
    'ticketAvg', 'ticketRedline', 'socials', 'socialAvg', 'socialRedline', 'calls', 'callAvg',
    'callRedline', 'totalCount', 'combinedAvg', 'redlines', 'actions']
};

var QC_GAS_CALL_REPORT_KEYS = {
  bimeh_bazar_experts_v2: 'Call_Report_Experts',
  bimeh_bazar_team_access_profiles_v1: 'Call_Report_Access'
};

/* Identity / cache keys. Revision changes on every app write and on any direct
 * spreadsheet edit (onChange trigger), which is what invalidates cached reads. */
var QC_GAS_ID_KEY = 'QC_GAS_SPREADSHEET_ID';
var QC_GAS_REV_KEY = 'QC_GAS_REV';
var QC_GAS_CACHE_PREFIX = 'qcdb@';
var QC_GAS_SELF_WRITE_KEY = 'qcselfwrite';
var QC_GAS_CACHE_TTL_SEC = 600;
/* CacheService rejects values over 100 KB; 24k chars stays under that even when
 * every character is a 4-byte UTF-8 sequence. */
var QC_GAS_CACHE_CHUNK_CHARS = 24000;
/* Above this size the snapshot is read from the sheet every time instead. */
var QC_GAS_CACHE_MAX_CHARS = 4000000;
var QC_GAS_CHANGE_HANDLER = 'crmqcOnSheetChange';
/* کش نتیجه‌ی تحلیل‌ها: کلید = نسخه‌ی داده + کاربر + مسیر؛ با هر نوشتن باطل می‌شود. */
var QC_GAS_ANALYSIS_PREFIX = 'qcan@';
var QC_GAS_ANALYSIS_TTL_SEC = 21600;
var QC_GAS_ANALYSIS_MAX_CHARS = 900000;
var QC_GAS_TOKEN_PREFIX = 'qctok@';
var QC_GAS_TOKEN_EPOCH_KEY = 'QC_GAS_TOKEN_EPOCH';
var QC_GAS_TOKEN_TTL_SEC = 21600; // ۶ ساعت؛ با هر درخواست تمدید می‌شود

function onOpen() {
  try {
    SpreadsheetApp.getUi()
      .createMenu('سامانه QC مستقل')
      .addItem('راه‌اندازی / بررسی تب‌های سامانه', 'setupStandaloneApp')
      .addSeparator()
      .addItem('خواندن تازه از شیت (پاک‌کردن کش)', 'refreshFromSheet')
      .addItem('بازسازی تب خلاصه ماهانه', 'rebuildMonthlySummary')
      .addSeparator()
      .addItem('بستن همه نشست‌های فعال (خروج اجباری)', 'clearSessions')
      .addToUi();
  } catch (err) {
    // onOpen may also run outside the spreadsheet editor.
  }
}

/**
 * Run once from the bound spreadsheet's Apps Script editor.
 * Creates separate database tabs, seeds only a genuinely empty workbook and
 * installs the onChange trigger that keeps cached reads honest.
 */
function setupStandaloneApp() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('این اسکریپت را از داخل Google Sheet مقصد اجرا کنید.');

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    PropertiesService.getScriptProperties().setProperty(QC_GAS_ID_KEY, ss.getId());
    var sheets = {};
    Object.keys(QC_GAS_SCHEMAS).forEach(function (name) {
      var sheet = ss.getSheetByName(name) || ss.insertSheet(name);
      sheets[name] = sheet;
      ensureHeader_(sheet, QC_GAS_SCHEMAS[name]);
    });

    var meta = readKeyValueGrid_(gridValues_(sheets[QC_GAS_SHEETS.meta]));
    var hasData = ['Agents', 'Tickets', 'Socials', 'Calls', 'Actions', 'Reminders']
      .some(function (name) { return gridRows_(sheets[name]) > 1; });

    var db;
    if (meta.datasetId) {
      db = normalizeDatabase_(readDatabase_(ss));
      writeDatabaseDiff_(ss, db, db, true);
    } else if (hasData) {
      // Respect pre-existing tabs and data; do not replace them with sample data.
      db = normalizeDatabase_(readDatabase_(ss));
      if (!db.datasetId) db.datasetId = Utilities.getUuid();
      writeDatabaseDiff_(ss, {}, db, true);
    } else {
      db = normalizeDatabase_(makeSeedDatabase_());
      writeDatabaseDiff_(ss, {}, db, true);
    }

    installChangeTrigger_(ss);
    publishRevision_(bumpRevision_(), db);

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

/** Menu item: drop the cached snapshot so the next read comes straight from the tabs. */
function refreshFromSheet() {
  var ss = getDatabaseSpreadsheet_();
  var db = normalizeDatabase_(readDatabase_(ss));
  publishRevision_(bumpRevision_(), db);
  return { ok: true, counts: databaseCounts_(db) };
}

/**
 * Installed onChange trigger. Spreadsheet edits made outside the app (a user
 * typing in a tab) bump the revision, so cached reads are not stale. Writes
 * made by crmqcApi mark themselves and are skipped: they publish their own
 * revision together with the fresh snapshot.
 */
function crmqcOnSheetChange() {
  try {
    var cache = CacheService.getScriptCache();
    if (cache.get(QC_GAS_SELF_WRITE_KEY)) return;
    bumpRevision_();
  } catch (err) {
    // Never let a trigger failure break editing the spreadsheet.
  }
}

/** Public URL: `.../exec`; `?page=call-report` serves the legacy call report tool. */
function doGet(e) {
  var id = PropertiesService.getScriptProperties().getProperty(QC_GAS_ID_KEY);
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
 *
 * GET requests never take the write lock and are served from the cached
 * snapshot when the revision still matches. Anything else reads the tabs fresh
 * under LockService, writes only the rows that changed and republishes the
 * cache for the next read.
 */
function crmqcApi(method, requestUrl, body, token) {
  method = String(method || 'GET').toUpperCase();
  requestUrl = String(requestUrl || '/');
  body = body && typeof body === 'object' ? body : {};
  var pathOnly = requestUrl.split('?')[0];
  var isRead = method === 'GET';
  var authPath = pathOnly.indexOf('/api/auth/') === 0;

  /* سریع‌ترین پاسخ ممکن: فقط شماره‌ی نسخه‌ی داده تا کاربران همزمان بفهمند
   * چیز جدیدی روی شیت آمده است (بند ۱۰). هیچ خواندنی از تب‌ها انجام نمی‌شود. */
  if (isRead && pathOnly === '/api/revision') {
    return { status: 200, data: { revision: currentRevision_(), at: Date.now() } };
  }

  var lock = LockService.getScriptLock();
  var locked = false;
  try {
    var ss;
    if (!isRead) { lock.waitLock(30000); locked = true; }
    try {
      ss = getDatabaseSpreadsheet_();
    } catch (error) {
      return { status: 503, data: { error: error.message || 'شیت دیتابیس پیدا نشد.' } };
    }

    var revision = currentRevision_();
    var before = isRead ? readCachedDatabase_(revision) : null;
    if (!before) {
      before = normalizeDatabase_(readDatabase_(ss));
      // Write the snapshot back under the revision it was read at. A concurrent
      // write publishes under a newer revision, so this can never clobber it.
      if (isRead) publishRevision_(revision, before);
    }

    /* نشست: توکن از کش، نقش و دسترسی‌ها همیشه از داده‌ی تازه‌ی شیت */
    var session = refreshSession_(resolveSession_(token), before);

    /* کش نتیجه‌ی تحلیل‌ها (بند ۸): کلید = نسخه‌ی داده + کاربر + درخواست.
     * با هر نوشتن نسخه عوض می‌شود، پس پاسخ کهنه هرگز خوانده نمی‌شود. */
    var analysisKey = isRead && !authPath && cacheableRead_(pathOnly)
      ? analysisCacheKey_(revision, requestUrl, session) : null;
    if (analysisKey) {
      var cached = readAnalysisCache_(analysisKey);
      if (cached) return { status: 200, data: cached, cached: true };
    }

    window.LocalApi.replaceSnapshot(before);
    window.LocalApi.setSession(session);
    window.__GAS_DB_DIRTY__ = false;

    var result = window.LocalApi.run(method, requestUrl, body);

    if (isRead) {
      // Reads must not persist: a GET only re-derives in-memory defaults, and
      // writing from a cached snapshot could clobber a concurrent edit.
      var payload = jsonSafe_(result);
      if (analysisKey) writeAnalysisCache_(analysisKey, payload);
      return { status: 200, data: payload };
    }

    if (authPath && pathOnly === '/api/auth/logout') dropToken_(token);
    if (authPath && result && result.user && (pathOnly === '/api/auth/login' || pathOnly === '/api/auth/setup')) {
      result.token = issueToken_(result.user);
      session = refreshSession_(result.user, before);
    }

    var after = window.LocalApi.backup();
    if (window.__GAS_DB_DIRTY__ || JSON.stringify(before) !== JSON.stringify(after)) {
      markSelfWrite_();
      writeDatabaseDiff_(ss, before, after, false);
      publishRevision_(bumpRevision_(), after);
    }
    return { status: 200, data: jsonSafe_(result) };
  } catch (error) {
    return {
      status: Number(error && error.status) || 500,
      data: { error: String(error && error.message || 'خطای Apps Script') }
    };
  } finally {
    if (locked) { try { lock.releaseLock(); } catch (ignored) {} }
    try { window.LocalApi.setSession(null); } catch (ignored) {}
  }
}

/* ------------------------------------------------------------ احراز هویت */

function sessionEpoch_() {
  try {
    var props = PropertiesService.getScriptProperties();
    return Number(props.getProperty(QC_GAS_TOKEN_EPOCH_KEY) || 1);
  } catch (err) {
    return 1;
  }
}

function tokenKey_(token, epoch) {
  return QC_GAS_TOKEN_PREFIX + (epoch || sessionEpoch_()) + '@' + token;
}

function resolveSession_(token) {
  token = String(token || '');
  if (!token) return null;
  try {
    var cacheKey = tokenKey_(token);
    var raw = CacheService.getScriptCache().get(cacheKey);
    if (!raw) return null;
    var hit = JSON.parse(raw);
    if (!hit || !hit.name) return null;
    if (Number(hit.exp || 0) < Date.now()) return null;
    /* انقضای لغزان: تا وقتی کاربر کار می‌کند نشست بسته نمی‌شود */
    CacheService.getScriptCache().put(cacheKey,
      JSON.stringify({ name: hit.name, exp: Date.now() + QC_GAS_TOKEN_TTL_SEC * 1000 }), QC_GAS_TOKEN_TTL_SEC);
    return { name: hit.name };
  } catch (err) {
    return null;
  }
}

function refreshSession_(session, db) {
  if (!session || !session.name) return null;
  var fresh = window.QCAccess.findUser(window.QCAccess.normalizeUsers(db), session.name);
  if (!fresh || !fresh.active) return null;
  return fresh;
}

function issueToken_(user) {
  var token = window.QCAccess.randomToken(24);
  try {
    CacheService.getScriptCache().put(tokenKey_(token),
      JSON.stringify({ name: user.name, exp: Date.now() + QC_GAS_TOKEN_TTL_SEC * 1000 }), QC_GAS_TOKEN_TTL_SEC);
  } catch (err) {
    throw new Error('ذخیره‌ی نشست ممکن نشد؛ دوباره تلاش کنید');
  }
  return token;
}

function dropToken_(token) {
  token = String(token || '');
  if (!token) return;
  try { CacheService.getScriptCache().remove(tokenKey_(token)); } catch (err) {}
}

/** Menu item: با یک پله جلو بردن «دوره‌ی نشست» همه‌ی توکن‌های فعال بی‌اثر می‌شوند. */
function clearSessions() {
  var props = PropertiesService.getScriptProperties();
  var epoch = Number(props.getProperty(QC_GAS_TOKEN_EPOCH_KEY) || 1) + 1;
  props.setProperty(QC_GAS_TOKEN_EPOCH_KEY, String(epoch));
  return { ok: true, epoch: epoch };
}

/* ------------------------------------------------- کش نتیجه‌ی تحلیل‌ها */

function cacheableRead_(path) {
  if (!path || path.indexOf('/api/') !== 0) return false;
  var name = path.slice(5).split('/')[0];
  var allowed = ['bootstrap', 'dashboard', 'reports', 'portfolio', 'expert-ref', 'calls', 'tickets',
    'socials', 'data', 'monthly-summary', 'elements', 'fiscal-months', 'qc-users', 'agents',
    'criteria', 'settings', 'action-types', 'actions', 'reminders'];
  if (allowed.indexOf(name) === -1) return false;
  if (name === 'calls' && path.indexOf('/api/calls/analysis') !== 0) return false;
  if (name === 'data' && path.indexOf('/api/data/status') !== 0) return false;
  return true;
}

function analysisCacheKey_(revision, requestUrl, session) {
  var who = session && session.name ? window.QCAccess.normalizeUser({ name: session.name }).key : 'guest';
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, who + '\u0001' + requestUrl, Utilities.Charset.UTF_8);
  var hex = '';
  for (var i = 0; i < digest.length; i++) hex += ('0' + (digest[i] < 0 ? digest[i] + 256 : digest[i]).toString(16)).slice(-2);
  return QC_GAS_ANALYSIS_PREFIX + revision + '#' + hex.slice(0, 40);
}

function readAnalysisCache_(key) {
  try {
    var cache = CacheService.getScriptCache();
    var meta = cache.get(key + '#meta');
    if (!meta) return null;
    var info = JSON.parse(meta), keys = [];
    for (var i = 0; i < info.chunks; i++) keys.push(key + '#' + i);
    var parts = cache.getAll(keys), json = '';
    for (var c = 0; c < keys.length; c++) {
      if (parts[keys[c]] == null) return null;
      json += parts[keys[c]];
    }
    return JSON.parse(json);
  } catch (err) {
    return null;
  }
}

function writeAnalysisCache_(key, payload) {
  try {
    var json = JSON.stringify(payload);
    if (!json || json.length > QC_GAS_ANALYSIS_MAX_CHARS) return;
    var cache = CacheService.getScriptCache();
    var chunks = Math.max(1, Math.ceil(json.length / QC_GAS_CACHE_CHUNK_CHARS));
    var values = {};
    for (var i = 0; i < chunks; i++) {
      values[key + '#' + i] = json.substr(i * QC_GAS_CACHE_CHUNK_CHARS, QC_GAS_CACHE_CHUNK_CHARS);
    }
    values[key + '#meta'] = JSON.stringify({ chunks: chunks, at: new Date().toISOString() });
    cache.putAll(values, QC_GAS_ANALYSIS_TTL_SEC);
  } catch (err) {
    // کش تحلیل فقط یک بهینه‌سازی است؛ بدون آن پاسخ از راه عادی ساخته می‌شود.
  }
}

/** Menu item: بازسازی تب خلاصه‌ی ماهانه از داده‌ی فعلی شیت (بند ۸). */
function rebuildMonthlySummary() {
  var ss = getDatabaseSpreadsheet_();
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var db = normalizeDatabase_(readDatabase_(ss));
    var rows = window.QCFiscal.monthlySummary(db).rows;
    markSelfWrite_();
    writeRowsSheet_(ss.getSheetByName(QC_GAS_SHEETS.monthlySummary), [], rows, 'Monthly_Summary');
    publishRevision_(bumpRevision_(), db);
    return { ok: true, rows: rows.length };
  } finally {
    lock.releaseLock();
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
    markSelfWrite_();
    var sheet = ss.getSheetByName(sheetName);
    var values = text ? [['json'], [text]] : [['json']];
    if (sheet.getLastRow() === values.length) {
      sheet.getRange(1, 1, values.length, 1).setValues(values);
    } else {
      sheet.clearContents();
      sheet.getRange(1, 1, values.length, 1).setValues(values);
      styleHeader_(sheet, 1);
    }
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

function getDatabaseSpreadsheet_() {
  var id = PropertiesService.getScriptProperties().getProperty(QC_GAS_ID_KEY);
  if (!id) throw new Error('ابتدا تابع setupStandaloneApp را از شیت مقصد اجرا کنید.');
  return SpreadsheetApp.openById(id);
}

function installChangeTrigger_(ss) {
  try {
    var triggers = ScriptApp.getProjectTriggers();
    for (var i = 0; i < triggers.length; i++) {
      if (triggers[i].getHandlerFunction() === QC_GAS_CHANGE_HANDLER) ScriptApp.deleteTrigger(triggers[i]);
    }
    ScriptApp.newTrigger(QC_GAS_CHANGE_HANDLER).forSpreadsheet(ss).onChange().create();
  } catch (err) {
    // Without the trigger, cached reads still expire through their TTL.
  }
}

/* ------------------------------------------------------- revision + cache */

function currentRevision_() {
  var props = PropertiesService.getScriptProperties();
  var revision = props.getProperty(QC_GAS_REV_KEY);
  if (!revision) {
    revision = String(Date.now());
    props.setProperty(QC_GAS_REV_KEY, revision);
  }
  return revision;
}

function bumpRevision_() {
  var revision = String(Date.now()) + '-' + Math.floor(Math.random() * 1000000);
  PropertiesService.getScriptProperties().setProperty(QC_GAS_REV_KEY, revision);
  return revision;
}

/* Marks the next few seconds as "our own write" so the onChange trigger does
 * not invalidate the snapshot we are about to publish. */
function markSelfWrite_() {
  try { CacheService.getScriptCache().put(QC_GAS_SELF_WRITE_KEY, '1', 30); } catch (ignored) {}
}

function readCachedDatabase_(revision) {
  try {
    var cache = CacheService.getScriptCache();
    var meta = cache.get(QC_GAS_CACHE_PREFIX + revision + '#meta');
    if (!meta) return null;
    var info = JSON.parse(meta);
    var keys = [];
    for (var i = 0; i < info.chunks; i++) keys.push(QC_GAS_CACHE_PREFIX + revision + '#' + i);
    var parts = cache.getAll(keys);
    var json = '';
    for (var c = 0; c < keys.length; c++) {
      if (parts[keys[c]] == null) return null; // partially expired → read the sheet
      json += parts[keys[c]];
    }
    return normalizeDatabase_(JSON.parse(json));
  } catch (err) {
    return null;
  }
}

function publishRevision_(revision, db) {
  try {
    var json = JSON.stringify(db);
    if (json.length > QC_GAS_CACHE_MAX_CHARS) return;
    var cache = CacheService.getScriptCache();
    var chunks = Math.max(1, Math.ceil(json.length / QC_GAS_CACHE_CHUNK_CHARS));
    var values = {};
    for (var i = 0; i < chunks; i++) {
      values[QC_GAS_CACHE_PREFIX + revision + '#' + i] = json.substr(i * QC_GAS_CACHE_CHUNK_CHARS, QC_GAS_CACHE_CHUNK_CHARS);
    }
    values[QC_GAS_CACHE_PREFIX + revision + '#meta'] = JSON.stringify({ chunks: chunks, at: new Date().toISOString() });
    cache.putAll(values, QC_GAS_CACHE_TTL_SEC);
  } catch (err) {
    // Caching is an optimization; reads fall back to the spreadsheet.
  }
}

/* ------------------------------------------------------------ seed / shape */

function makeSeedDatabase_() {
  var seed = JSON.parse(JSON.stringify(window.QC_SEED || {}));
  var maxAgentId = Math.max(0, ...(seed.agents || []).map(function (agent) { return Number(agent.id) || 0; }));
  return Object.assign({}, seed, {
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
    registryCleared: false,
    fiscalMonths: [],
    qcUsers: []
  });
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
  db.fiscalMonths = window.QCFiscal.normalizeMonths(db.fiscalMonths);
  db.qcUsers = Array.isArray(db.qcUsers) ? db.qcUsers : [];
  if (!db.settings.authMode) db.settings.authMode = 'auto';
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

/* -------------------------------------------------------------- read tabs */

function sheetMap_(ss) {
  var map = {};
  var sheets = ss.getSheets();
  for (var i = 0; i < sheets.length; i++) map[sheets[i].getName()] = sheets[i];
  return map;
}

function gridValues_(sheet) {
  return sheet ? sheet.getDataRange().getValues() : [];
}

function gridRows_(sheet) {
  return sheet ? sheet.getLastRow() : 0;
}

function readDatabase_(ss) {
  var sheets = sheetMap_(ss);
  var meta = readKeyValueGrid_(gridValues_(sheets[QC_GAS_SHEETS.meta]));
  var settings = readKeyValueGrid_(gridValues_(sheets[QC_GAS_SHEETS.settings]));
  var lists = readKeyValueGrid_(gridValues_(sheets[QC_GAS_SHEETS.lists]));
  var criteria = readKeyValueGrid_(gridValues_(sheets[QC_GAS_SHEETS.criteria]));
  var callMeta = readKeyValueGrid_(gridValues_(sheets[QC_GAS_SHEETS.callMeta]));

  var agentActions = {};
  readRowsGrid_(gridValues_(sheets[QC_GAS_SHEETS.actions])).forEach(function (action) {
    var name = String(action.agent || '').trim();
    if (!name) return;
    if (!agentActions[name]) agentActions[name] = [];
    delete action.agent;
    agentActions[name].push(action);
  });

  var actionTypes = readRowsGrid_(gridValues_(sheets[QC_GAS_SHEETS.actionTypes]))
    .map(function (row) { return String(row.label || '').trim(); }).filter(Boolean);

  var fiscalMonths = window.QCFiscal.normalizeMonths(readRowsGrid_(gridValues_(sheets[QC_GAS_SHEETS.fiscalMonths])));
  var qcUsers = readRowsGrid_(gridValues_(sheets[QC_GAS_SHEETS.qcUsers]));
  var elementRows = readRowsGrid_(gridValues_(sheets[QC_GAS_SHEETS.elements]));

  var db = {
    version: meta.version || 1,
    datasetId: meta.datasetId || '',
    fiscalMonths: fiscalMonths,
    qcUsers: qcUsers,
    createdAt: meta.createdAt || '',
    registryCleared: !!meta.registryCleared,
    seq: meta.seq || {},
    agents: readRowsGrid_(gridValues_(sheets[QC_GAS_SHEETS.agents])),
    qcAgents: readRowsGrid_(gridValues_(sheets[QC_GAS_SHEETS.qcAgents]))
      .map(function (row) { return String(row.name || '').trim(); }).filter(Boolean),
    tickets: readRowsGrid_(gridValues_(sheets[QC_GAS_SHEETS.tickets])),
    socials: readRowsGrid_(gridValues_(sheets[QC_GAS_SHEETS.socials])),
    callFeedbacks: readRowsGrid_(gridValues_(sheets[QC_GAS_SHEETS.calls])),
    callImport: callMeta.callImport || null,
    callRaw: callMeta.callRaw || null,
    callSync: callMeta.callSync || { files: {}, syncedAt: null },
    agentActions: agentActions,
    actionTypes: actionTypes.length ? actionTypes : undefined,
    reminders: readRowsGrid_(gridValues_(sheets[QC_GAS_SHEETS.reminders])),
    settings: settings,
    lists: lists
  };
  if (criteria.callCriteria) db.settings.callCriteria = criteria.callCriteria;
  /* تب Elements منبع اصلی نگاشت المان‌هاست تا مستقیم روی شیت ویرایش شود (بند ۹) */
  if (elementRows.length) {
    db.settings.callCriteria = window.QCElements.rowsToCriteria(elementRows, db.settings.callCriteria || null);
  }
  if (settings.authMode) db.settings.authMode = String(settings.authMode);
  return db;
}

function readRowsGrid_(grid) {
  if (!grid || grid.length < 2) return [];
  var headers = grid[0].map(function (header) { return String(header == null ? '' : header).trim(); });
  var out = [];
  for (var r = 1; r < grid.length; r++) {
    var row = {}, populated = false;
    for (var c = 0; c < headers.length; c++) {
      var key = headers[c];
      if (!key) continue;
      var value = decodeCell_(grid[r][c], key);
      if (value !== '' && value != null) populated = true;
      row[key] = value;
    }
    if (populated) out.push(row);
  }
  return out;
}

function readKeyValueGrid_(grid) {
  var out = {};
  if (!grid || grid.length < 2) return out;
  for (var i = 1; i < grid.length; i++) {
    var key = String(grid[i][0] == null ? '' : grid[i][0]).trim();
    if (!key) continue;
    out[key] = decodeCell_(grid[i][1], key);
  }
  return out;
}

function readCallReportSettings_() {
  var sheets = sheetMap_(getDatabaseSpreadsheet_());
  return {
    bimeh_bazar_experts_v2: readSingleJsonGrid_(gridValues_(sheets[QC_GAS_SHEETS.callReportExperts]), '[]'),
    bimeh_bazar_team_access_profiles_v1: readSingleJsonGrid_(gridValues_(sheets[QC_GAS_SHEETS.callReportAccess]), '[]')
  };
}

function readSingleJsonGrid_(grid, fallback) {
  if (!grid || grid.length < 2) return fallback;
  var raw = grid[1][0];
  return raw == null || raw === '' ? fallback : String(raw);
}

/* ------------------------------------------------------------- write tabs */

function writeDatabaseDiff_(ss, before, after, forceAll) {
  before = before || {};
  after = normalizeDatabase_(JSON.parse(JSON.stringify(after || {})));
  var sheets = sheetMap_(ss);
  var changed = function (key) {
    return forceAll || JSON.stringify(before[key] == null ? null : before[key]) !== JSON.stringify(after[key] == null ? null : after[key]);
  };

  if (changed('agents')) writeRowsSheet_(sheets[QC_GAS_SHEETS.agents], before.agents, after.agents, 'Agents');
  if (changed('tickets')) writeRowsSheet_(sheets[QC_GAS_SHEETS.tickets], before.tickets, after.tickets, 'Tickets');
  if (changed('socials')) writeRowsSheet_(sheets[QC_GAS_SHEETS.socials], before.socials, after.socials, 'Socials');
  if (changed('callFeedbacks')) writeRowsSheet_(sheets[QC_GAS_SHEETS.calls], before.callFeedbacks, after.callFeedbacks, 'Calls');
  if (changed('qcAgents')) {
    writeRowsSheet_(sheets[QC_GAS_SHEETS.qcAgents],
      (before.qcAgents || []).map(function (name) { return { name: name }; }),
      (after.qcAgents || []).map(function (name) { return { name: name }; }), 'QC_Agents');
  }

  if (forceAll || JSON.stringify(before.agentActions || {}) !== JSON.stringify(after.agentActions || {})) {
    writeRowsSheet_(sheets[QC_GAS_SHEETS.actions], flatActions_(before.agentActions), flatActions_(after.agentActions), 'Actions');
  }
  if (changed('reminders')) writeRowsSheet_(sheets[QC_GAS_SHEETS.reminders], before.reminders, after.reminders, 'Reminders');
  if (changed('actionTypes')) {
    writeRowsSheet_(sheets[QC_GAS_SHEETS.actionTypes],
      (before.actionTypes || []).map(function (label) { return { label: label }; }),
      (after.actionTypes || []).map(function (label) { return { label: label }; }), 'Action_Types');
  }

  var beforeSettings = Object.assign({}, before.settings || {});
  var afterSettings = Object.assign({}, after.settings || {});
  delete beforeSettings.callCriteria;
  delete afterSettings.callCriteria;
  if (forceAll || JSON.stringify(beforeSettings) !== JSON.stringify(afterSettings)) {
    writeKeyValueSheet_(sheets[QC_GAS_SHEETS.settings], beforeSettings, afterSettings);
  }
  if (forceAll || JSON.stringify((before.settings || {}).callCriteria || null) !== JSON.stringify((after.settings || {}).callCriteria || null)) {
    writeKeyValueSheet_(sheets[QC_GAS_SHEETS.criteria], {}, { callCriteria: (after.settings || {}).callCriteria || {} });
  }
  if (changed('lists')) writeKeyValueSheet_(sheets[QC_GAS_SHEETS.lists], before.lists || {}, after.lists || {});
  if (changed('fiscalMonths')) writeRowsSheet_(sheets[QC_GAS_SHEETS.fiscalMonths], before.fiscalMonths || [], after.fiscalMonths || [], 'Fiscal_Months');
  if (changed('qcUsers')) writeRowsSheet_(sheets[QC_GAS_SHEETS.qcUsers], before.qcUsers || [], after.qcUsers || [], 'QC_Users');

  /* نگاشت تخت المان‌ها روی تب Elements (بند ۹) */
  var beforeElements = window.QCElements.criteriaToRows((before.settings || {}).callCriteria || null);
  var afterElements = window.QCElements.criteriaToRows((after.settings || {}).callCriteria || null);
  if (forceAll || JSON.stringify(beforeElements) !== JSON.stringify(afterElements)) {
    writeRowsSheet_(sheets[QC_GAS_SHEETS.elements], beforeElements, afterElements, 'Elements');
  }

  /* خلاصه‌ی ماهانه فقط وقتی داده‌ی مؤثر عوض شده بازسازی می‌شود (بند ۸) */
  var summaryInputs = ['tickets', 'socials', 'callFeedbacks', 'agentActions', 'fiscalMonths', 'agents'];
  if (forceAll || summaryInputs.some(changed)) {
    writeRowsSheet_(sheets[QC_GAS_SHEETS.monthlySummary],
      window.QCFiscal.monthlySummary(before).rows, window.QCFiscal.monthlySummary(after).rows, 'Monthly_Summary');
  }

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
    writeKeyValueSheet_(sheets[QC_GAS_SHEETS.meta], beforeMeta, afterMeta);
  }

  var beforeCallMeta = { callImport: before.callImport || null, callRaw: before.callRaw || null, callSync: before.callSync || null };
  var afterCallMeta = { callImport: after.callImport || null, callRaw: after.callRaw || null, callSync: after.callSync || null };
  if (forceAll || JSON.stringify(beforeCallMeta) !== JSON.stringify(afterCallMeta)) {
    writeKeyValueSheet_(sheets[QC_GAS_SHEETS.callMeta], beforeCallMeta, afterCallMeta);
  }
}

function flatActions_(agentActions) {
  var flat = [];
  Object.keys(agentActions || {}).forEach(function (name) {
    (agentActions[name] || []).forEach(function (row) { flat.push(Object.assign({}, row, { agent: name })); });
  });
  return flat;
}

/**
 * Writes one tab with the fewest spreadsheet calls possible:
 * unchanged → none, appended rows → one range write, contiguous deletion →
 * deleteRows, a handful of edited rows → those ranges, otherwise one body write
 * (or a full rewrite when the column set itself changed).
 */
function writeRowsSheet_(sheet, beforeRows, afterRows, schemaName) {
  if (!sheet) throw new Error('تب موردنیاز ایجاد نشده است: ' + schemaName);
  var schema = QC_GAS_SCHEMAS[schemaName] || [];
  var beforeKeys = columnKeys_(schema, beforeRows);
  var afterKeys = columnKeys_(schema, afterRows);
  var beforeValues = encodeRows_(beforeRows, beforeKeys);
  var afterValues = encodeRows_(afterRows, afterKeys);
  var sameKeys = beforeKeys.length === afterKeys.length && beforeKeys.every(function (key, i) { return key === afterKeys[i]; });

  if (sameKeys && gridEqual_(beforeValues, afterValues)) return;
  if (!sameKeys || (beforeValues.length === 0 && gridRows_(sheet) < 1)) {
    fullRewrite_(sheet, afterKeys, afterValues);
    return;
  }

  // Appended rows: the common case for every new ticket/social/call import.
  if (afterValues.length > beforeValues.length && prefixEqual_(beforeValues, afterValues)) {
    var tail = afterValues.slice(beforeValues.length);
    sheet.getRange(beforeValues.length + 2, 1, tail.length, afterKeys.length).setValues(tail);
    return;
  }

  // Contiguous deletion (single record delete, range clear, demo cleanup).
  if (afterValues.length < beforeValues.length) {
    var at = firstDifference_(beforeValues, afterValues);
    var removed = beforeValues.length - afterValues.length;
    if (at + removed <= beforeValues.length && suffixEqual_(beforeValues, at + removed, afterValues, at)) {
      sheet.deleteRows(at + 2, removed);
      return;
    }
  }

  // Same row count: patch only the edited rows when they are few and clustered.
  if (afterValues.length === beforeValues.length) {
    var ranges = changedRanges_(beforeValues, afterValues);
    if (ranges.length && ranges.length <= 6) {
      ranges.forEach(function (range) {
        sheet.getRange(range[0] + 2, 1, range[1] - range[0] + 1, afterKeys.length)
          .setValues(afterValues.slice(range[0], range[1] + 1));
      });
      return;
    }
    if (afterValues.length) {
      sheet.getRange(2, 1, afterValues.length, afterKeys.length).setValues(afterValues);
      return;
    }
  }

  fullRewrite_(sheet, afterKeys, afterValues);
}

function fullRewrite_(sheet, keys, values) {
  if (!keys.length) keys = ['id'];
  var grid = [keys].concat(values.map(function (row) { return row.slice(0, keys.length); }));
  sheet.clearContents();
  sheet.getRange(1, 1, grid.length, keys.length).setValues(grid);
  if (values.length === 0) styleHeader_(sheet, keys.length);
}

function writeKeyValueSheet_(sheet, before, after) {
  if (!sheet) throw new Error('تب تنظیمات ایجاد نشده است.');
  var keys = Object.keys(after || {}).sort();
  var beforeKeys = Object.keys(before || {}).sort();
  if (keys.join('\u0001') === beforeKeys.join('\u0001') &&
      keys.every(function (key) { return JSON.stringify(before[key] == null ? null : before[key]) === JSON.stringify(after[key] == null ? null : after[key]); })) return;
  var rows = [['key', 'value']].concat(keys.map(function (key) { return [key, encodeCell_(after[key])]; }));
  if (gridRows_(sheet) === rows.length) {
    sheet.getRange(1, 1, rows.length, 2).setValues(rows);
    return;
  }
  sheet.clearContents();
  sheet.getRange(1, 1, rows.length, 2).setValues(rows);
  styleHeader_(sheet, 2);
}

function columnKeys_(schema, rows) {
  var keys = (schema || []).slice();
  (rows || []).forEach(function (row) {
    Object.keys(row || {}).forEach(function (key) { if (keys.indexOf(key) < 0) keys.push(key); });
  });
  return keys.length ? keys : ['id'];
}

function encodeRows_(rows, keys) {
  return (rows || []).map(function (row) {
    return keys.map(function (key) { return encodeCell_(row && row[key]); });
  });
}

function rowEqual_(a, b) {
  if (a.length !== b.length) return false;
  for (var i = 0; i < a.length; i++) if (!cellEqual_(a[i], b[i])) return false;
  return true;
}

function cellEqual_(a, b) {
  if (typeof a === 'object' || typeof b === 'object') return JSON.stringify(a) === JSON.stringify(b);
  return a === b;
}

function gridEqual_(a, b) {
  if (a.length !== b.length) return false;
  for (var i = 0; i < a.length; i++) if (!rowEqual_(a[i], b[i])) return false;
  return true;
}

function prefixEqual_(before, after) {
  for (var i = 0; i < before.length; i++) if (!rowEqual_(before[i], after[i])) return false;
  return true;
}

function suffixEqual_(before, fromBefore, after, fromAfter) {
  var length = before.length - fromBefore;
  if (length !== after.length - fromAfter) return false;
  for (var i = 0; i < length; i++) if (!rowEqual_(before[fromBefore + i], after[fromAfter + i])) return false;
  return true;
}

function firstDifference_(before, after) {
  var limit = Math.min(before.length, after.length);
  for (var i = 0; i < limit; i++) if (!rowEqual_(before[i], after[i])) return i;
  return limit;
}

function changedRanges_(before, after) {
  var ranges = [], start = -1;
  for (var i = 0; i < before.length; i++) {
    var differs = !rowEqual_(before[i], after[i]);
    if (differs && start < 0) start = i;
    else if (!differs && start >= 0) { ranges.push([start, i - 1]); start = -1; }
  }
  if (start >= 0) ranges.push([start, before.length - 1]);
  return ranges;
}

/* ------------------------------------------------------------ cell coding */

function ensureHeader_(sheet, headers) {
  if (!sheet) return;
  if (gridRows_(sheet) < 1 || sheet.getLastColumn() < 1) {
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
