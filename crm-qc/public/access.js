/* =========================================================================
 * access.js — نقش‌ها، رمزها و محدوده‌ی داده‌ی هر کارشناس QC
 * یک منبع حقیقت برای هر سه اجرا: سرور Node، مرورگر (آفلاین) و Apps Script.
 *
 * کاربران در تب `QC_Users` شیت (یا store نسخه Node) نگهداری می‌شوند:
 *   name      نام کارشناس QC (همان چیزی که در فرم‌ها به‌عنوان qcAgent ثبت می‌شود)
 *   password  رمز؛ به‌صورت `sha256$<salt>$<hex>` یا متن ساده (برای ویرایش مستقیم روی شیت)
 *   role      admin | qc
 *   active    1/0
 *   exts      داخلی‌های مجاز، جداشده با ویرگول/فاصله؛ `*` یعنی همه
 *   agents    نام کارشناسان مجاز (اختیاری، مکمل داخلی‌ها)
 *   teams     نام تیم‌های مجاز (اختیاری)
 * ========================================================================= */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./calc'), require('./parseQc'));
  else root.QCAccess = factory(root.QCCalc, root.QCParse);
})(typeof self !== 'undefined' ? self : this, function (C, P) {
'use strict';

const text = (v) => (v == null ? '' : String(v).trim());
const clone = (o) => (o == null ? o : JSON.parse(JSON.stringify(o)));
const nameKey = (s) => (P && P.nameKey ? P.nameKey(s) : text(s).toLowerCase().replace(/\s/g, ''));
const teamKey = (s) => (P && P.teamKey ? P.teamKey(s) : text(s).toLowerCase().replace(/[\s_/-]/g, ''));
const digits = (v) => (C && C.faToEn ? C.faToEn(text(v)) : text(v).replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));

/* صفحه‌هایی که فقط مدیر می‌بیند (بند ۶) و صفحه‌های عملیاتی مشترک. */
const ADMIN_ROUTES = ['criteria', 'directory', 'agents', 'data', 'qcadmin', 'sheets'];
const SHARED_ROUTES = ['dashboard', 'tickets', 'tickets-new', 'socials', 'socials-new', 'reports',
  'portfolio', 'expert-ref', 'expert-review', 'call-analysis', 'callreport', 'reminders'];

/* اندپوینت‌هایی که همیشه مخصوص مدیرند (بدون توجه به نقش درخواست‌کننده). */
const ADMIN_API = ['/api/criteria', '/api/settings', '/api/qc-users', '/api/fiscal-months', '/api/elements',
  '/api/backup', '/api/demo', '/api/data', '/api/sheets', '/api/calls/import', '/api/calls/meta',
  '/api/action-types', '/api/agents'];

/* خواندن‌هایی که برای صفحه‌های عملیاتیِ کارشناس QC لازم‌اند (با داده‌ی محدودشده)؛
 * وگرنه صفحه‌هایی مثل «پرونده کارشناس» و شمارنده‌های پایین صفحه با ۴۰۳ می‌افتند. */
const OPEN_API = ['/api/data/status', '/api/agents', '/api/qc-agents', '/api/action-types'];

/* ---------------------------------------------------------- SHA-256 خالص JS
 * یک پیاده‌سازی کوچک و بدون وابستگی تا hash در Node، مرورگر و Apps Script
 * دقیقاً یکسان باشد (رمزها روی شیت قابل حمل بمانند). */
const K256 = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2];

function rotr(x, n) { return (x >>> n) | (x << (32 - n)); }

function utf8Bytes(str) {
  const out = [], s = String(str);
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length && s.charCodeAt(i + 1) >= 0xdc00 && s.charCodeAt(i + 1) <= 0xdfff) {
      const cp = 0x10000 + ((c - 0xd800) << 10) + (s.charCodeAt(i + 1) - 0xdc00);
      out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
      i++;
    } else out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
  }
  return out;
}

function sha256Hex(message) {
  const bytes = utf8Bytes(message);
  const bitLen = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  const hi = Math.floor(bitLen / 0x100000000), lo = bitLen >>> 0;
  bytes.push((hi >>> 24) & 0xff, (hi >>> 16) & 0xff, (hi >>> 8) & 0xff, hi & 0xff,
             (lo >>> 24) & 0xff, (lo >>> 16) & 0xff, (lo >>> 8) & 0xff, lo & 0xff);
  let H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const w = new Array(64);
  for (let off = 0; off < bytes.length; off += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] = ((bytes[off + i * 4] << 24) | (bytes[off + i * 4 + 1] << 16) |
              (bytes[off + i * 4 + 2] << 8) | bytes[off + i * 4 + 3]) >>> 0;
    }
    for (let i = 16; i < 64; i++) {
      const x = w[i - 15], y = w[i - 2];
      const s0 = (rotr(x, 7) ^ rotr(x, 18) ^ (x >>> 3)) >>> 0;
      const s1 = (rotr(y, 17) ^ rotr(y, 19) ^ (y >>> 10)) >>> 0;
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
    for (let i = 0; i < 64; i++) {
      const S1 = (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) >>> 0;
      const ch = ((e & f) ^ (~e & g)) >>> 0;
      const t1 = (h + S1 + ch + K256[i] + w[i]) >>> 0;
      const S0 = (rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) >>> 0;
      const maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
      const t2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    H = [(H[0] + a) >>> 0, (H[1] + b) >>> 0, (H[2] + c) >>> 0, (H[3] + d) >>> 0,
         (H[4] + e) >>> 0, (H[5] + f) >>> 0, (H[6] + g) >>> 0, (H[7] + h) >>> 0];
  }
  return H.map((x) => ('00000000' + x.toString(16)).slice(-8)).join('');
}

function randomToken(bytes) {
  const n = bytes || 16;
  const g = typeof globalThis !== 'undefined' ? globalThis : root;
  if (g.crypto && typeof g.crypto.getRandomValues === 'function') {
    const arr = new Uint8Array(n); g.crypto.getRandomValues(arr);
    return Array.prototype.map.call(arr, (x) => ('0' + x.toString(16)).slice(-2)).join('');
  }
  if (g.Utilities && g.Utilities.getUuid) return String(g.Utilities.getUuid()).replace(/-/g, '').slice(0, n * 2);
  let out = '';
  while (out.length < n * 2) out += Math.random().toString(16).slice(2);
  return out.slice(0, n * 2);
}

function hashPassword(plain, salt) {
  const s = salt || randomToken(8);
  return 'sha256$' + s + '$' + sha256Hex(s + '$' + text(plain));
}

function isHashed(value) { return /^sha256\$[^$]*\$[0-9a-f]{64}$/i.test(text(value)); }

function verifyPassword(stored, plain) {
  const s = text(stored), p = text(plain);
  if (!s) return false;
  if (isHashed(s)) {
    const parts = s.split('$');
    return sha256Hex(parts[1] + '$' + p) === parts[2].toLowerCase();
  }
  /* مقدار نوشته‌شده مستقیم روی شیت: مقایسه‌ی متن ساده (با یکدست‌سازی اعداد/فاصله). */
  return nameKey(s) === nameKey(p) || s === p;
}

/* ------------------------------------------------------------- نرمال‌سازی */
function splitList(value) {
  return text(value).split(/[,،;؛|\n\r\t]+/).map((x) => text(x)).filter(Boolean);
}

/* --------------------------------- نگاشت «یک ستون برای هر کارشناس QC» روی شیت
 * به‌جای یک ستون تکی با نام‌های جداشده با ویرگول، تب Agents برای هر کارشناس QC
 * یک ستون اختصاصی دارد: سرستون `QC: <نام>` و سلول‌ها «✓» (یا خالی). همان تابع‌ها
 * هم ستون‌ها را می‌سازند و هم موقع خواندن شیت، تیک‌ها را به فهرست qcAgents برمی‌گردانند.
 * این کار ویرایش مستقیم روی شیت/اکسل را ساده و بدون خطای ویرگول می‌کند. */
const QC_COLUMN_PREFIX = 'QC';
const QC_TICK = '✓';
function qcColumnHeader(name) { return QC_COLUMN_PREFIX + ': ' + text(name); }
function qcColumnName(header) {
  const match = text(header).match(/^qc\s*[:：]\s*(.+)$/i);
  return match ? text(match[1]) : '';
}
function isQcColumn(header) { return !!qcColumnName(header); }
function isQcTick(value) {
  const v = digits(text(value)).toLowerCase().replace(/\s+/g, '');
  if (!v) return false;
  return ['✓', '✔', '☑', 'x', 'yes', 'y', 'true', '1', 'on', 'بله', 'فعال', 'دارد'].indexOf(v) !== -1;
}
/* فهرست نام‌های QC مسئول یک ردیف کارشناس (آرایه، رشته‌ی ویرگولی یا ردیف خام شیت) */
function agentQcNames(row) {
  if (row == null) return [];
  const source = Array.isArray(row) || typeof row === 'string' ? { qcAgents: row } : row;
  const out = [];
  const push = (name) => {
    const n = text(name);
    if (!n) return;
    if (!out.some((x) => nameKey(x) === nameKey(n))) out.push(n);
  };
  Object.keys(source || {}).forEach((key) => {
    const name = qcColumnName(key);
    if (name && isQcTick(source[key])) push(name);
  });
  splitList(source.qcAgents).forEach(push);
  return out;
}
/* ردیف خام شیت → ردیف تمیز: ستون‌های QC حذف و در qcAgents جمع می‌شوند */
function applyQcColumns(row) {
  const out = Object.assign({}, row || {});
  const names = agentQcNames(out);
  Object.keys(out).forEach((key) => { if (isQcColumn(key)) delete out[key]; });
  out.qcAgents = names;
  return out;
}
/* مقدار سلول برای ستون یک کارشناس QC مشخص */
function qcColumnValue(list, name) {
  const key = nameKey(name);
  return splitList(list).some((n) => nameKey(n) === key) ? QC_TICK : '';
}
/* فهرست کامل کارشناسان QC برای ساخت ستون‌ها: db.qcAgents + هر نامی که در ردیف‌ها هست */
function qcExpertNames(db, rows) {
  const out = [];
  const push = (name) => {
    const n = text(name);
    if (!n) return;
    if (!out.some((x) => nameKey(x) === nameKey(n))) out.push(n);
  };
  ((db && db.qcAgents) || []).forEach(push);
  (rows || []).forEach((row) => agentQcNames(row).forEach(push));
  return out;
}

function isWildcard(list) {
  return (list || []).some((x) => ['*', 'all', 'همه', 'همه‌چیز', '-'].indexOf(digits(x).toLowerCase()) !== -1);
}

function normalizeUser(row, index) {
  const r = row || {};
  const name = P && P.normName ? P.normName(text(r.name)) : text(r.name);
  const user = {
    id: r.id == null || r.id === '' ? 'u' + (index + 1) : String(r.id),
    name: name,
    key: nameKey(name),
    password: text(r.password),
    role: /^ad/i.test(text(r.role)) || text(r.role) === 'مدیر' ? 'admin' : 'qc',
    active: r.active === undefined || r.active === null || r.active === ''
      ? true : /^(1|true|yes|y|بله|فعال|on)$/i.test(digits(r.active)),
    exts: splitList(r.exts).map(digits),
    agents: splitList(r.agents).map((x) => (P && P.normName ? P.normName(x) : x)),
    teams: splitList(r.teams).map((x) => (P && P.normName ? P.normName(x) : x)),
    note: text(r.note),
    updatedAt: text(r.updatedAt)
  };
  user.unrestricted = user.role === 'admin' || isWildcard(user.exts) || isWildcard(user.agents) || isWildcard(user.teams);
  user.hasScope = user.unrestricted || !!user.exts.length || !!user.agents.length || !!user.teams.length;
  return user;
}

function normalizeUsers(db) {
  const rows = (db && Array.isArray(db.qcUsers) ? db.qcUsers : []);
  const seen = new Set(), out = [];
  rows.forEach((row, i) => {
    const u = normalizeUser(row, i);
    if (!u.name || seen.has(u.key)) return;
    seen.add(u.key); out.push(u);
  });
  return out;
}

function authMode(db) {
  const mode = text(db && db.settings && db.settings.authMode).toLowerCase();
  return mode === 'on' || mode === 'off' ? mode : 'auto';
}

function authRequired(db) {
  const mode = authMode(db);
  if (mode === 'off') return false;
  if (mode === 'on') return true;
  return normalizeUsers(db).some((u) => u.active && u.password);
}

function findUser(users, name) {
  const key = nameKey(P && P.normName ? P.normName(text(name)) : text(name));
  return (users || []).find((u) => u.key === key) || null;
}

function login(db, name, password) {
  const users = normalizeUsers(db);
  const user = findUser(users, name);
  if (!user) return { ok: false, error: 'کاربری با این نام تعریف نشده است' };
  if (!user.active) return { ok: false, error: 'دسترسی این کاربر غیرفعال شده است' };
  if (!verifyPassword(user.password, password)) return { ok: false, error: 'رمز واردشده درست نیست' };
  return { ok: true, user: publicUser(user) };
}

function publicUser(user) {
  return { name: user.name, role: user.role, active: user.active,
    exts: user.exts.slice(), agents: user.agents.slice(), teams: user.teams.slice(),
    note: user.note, unrestricted: !!user.unrestricted, hasScope: !!user.hasScope };
}

/* فهرست حساب‌ها برای صفحه‌ی ورود (بدون رمز). */
function accounts(db) {
  return normalizeUsers(db).filter((u) => u.active).map((u) => ({ name: u.name, role: u.role }));
}

/* ------------------------------------------------------- محدوده‌ی داده */
function allowedAgentNames(db, user, ignoreColumn) {
  if (!user) return null;
  if (user.role === 'admin' || user.unrestricted) return null; // null = بدون محدودیت
  const agents = (db && db.agents) || [];
  const exts = new Set((user.exts || []).map(digits));
  const names = new Set((user.agents || []).map(nameKey));
  const teams = new Set((user.teams || []).map(teamKey));
  const userKey = nameKey(user.name);
  const out = new Set();
  agents.forEach((a) => {
    /* ستون `qcAgents` ردیف کارشناس (تب Agents) هم دسترسی می‌دهد: اگر نام این کاربر آنجا باشد،
     * او مسئول ریت‌کردن این کارشناس است — پس می‌توان مستقیم از روی شیت/اکسل دسترسی داد. */
    const hit = (a.ext != null && a.ext !== '' && exts.has(digits(a.ext))) ||
      names.has(nameKey(a.name)) || splitList(a.aliases).some((al) => names.has(nameKey(al))) ||
      (a.team && teams.has(teamKey(a.team))) ||
      (!ignoreColumn && splitList(a.qcAgents).some((n) => nameKey(n) === userKey));
    if (hit) out.add(text(a.name));
  });
  return out;
}

/* همگام‌سازی دوطرفه: تیک‌های دسترسی یک کاربر QC روی ستون `qcAgents` تب Agents هم
 * نوشته می‌شود تا از شیت/اکسل هم قابل دیدن و ویرایش باشد. برای مدیر و
 * دسترسی نامحدود (*) این ستون خالی می‌ماند چون همه را می‌بینند. */
function syncAgentQcColumn(db, user, mode) {
  const name = text(user && user.name);
  if (!name || !db || !Array.isArray(db.agents)) return 0;
  const key = nameKey(name);
  const unlimited = user.role === 'admin' || !!user.unrestricted;
  /* mode === 'sync' یعنی کاربر از صفحهٔ مدیریت QC تیک‌ها را ثبت کرده: ستون دقیقاً
   * با دسترسی اعلامی (exts/agents/teams) یکسان می‌شود — بدون خواندن خود ستون، وگرنه هرگز
   * نمی‌شد تیکی را برداشت. در حالت پیش‌فرض ('keep') فقط نام اضافه می‌شود و از ستون
   * چیزی پاک نمی‌شود، تا مثلاً تغییر رمز دسترسی‌های نوشته‌شده روی شیت را خراب نکند. */
  const hard = mode === 'sync';
  const allowed = unlimited ? null : allowedAgentNames(db, user, hard);
  let touched = 0;
  db.agents.forEach((a) => {
    if (!a || typeof a !== 'object') return;
    const list = splitList(a.qcAgents);
    const has = list.some((n) => nameKey(n) === key);
    const granted = unlimited ? false : !!(allowed && allowed.has(text(a.name)));
    const want = hard ? granted : (has || granted);
    if (has === want) return;
    a.qcAgents = want ? list.concat(name) : list.filter((n) => nameKey(n) !== key);
    touched += 1;
  });
  return touched;
}

/* تغییر نام کاربر QC → ستون qcAgents تب Agents هم با نام جدید به‌روز می‌شود. */
function renameAgentQcColumn(db, oldName, name) {
  const from = nameKey(P && P.normName ? P.normName(text(oldName)) : text(oldName));
  const to = text(name);
  if (!from || !to || from === nameKey(to) || !db || !Array.isArray(db.agents)) return 0;
  let touched = 0;
  db.agents.forEach((a) => {
    if (!a || typeof a !== 'object') return;
    const list = splitList(a.qcAgents);
    if (!list.some((n) => nameKey(n) === from)) return;
    a.qcAgents = Array.from(new Set(list.map((n) => (nameKey(n) === from ? to : n)).filter(Boolean)));
    touched += 1;
  });
  return touched;
}

/* حذف نام یک کارشناس QC از ستون همهی ردیف‌های Agents (موقع حذف کاربر). */
function dropAgentQcColumn(db, name) {
  const key = nameKey(P && P.normName ? P.normName(text(name)) : text(name));
  if (!key || !db || !Array.isArray(db.agents)) return 0;
  let touched = 0;
  db.agents.forEach((a) => {
    if (!a || typeof a !== 'object') return;
    const list = splitList(a.qcAgents);
    const next = list.filter((n) => nameKey(n) !== key);
    if (next.length === list.length) return;
    a.qcAgents = next;
    touched += 1;
  });
  return touched;
}

function recordById(db, path, id) {
  const key = String(id);
  if (path.indexOf('/api/tickets') === 0) return (db.tickets || []).find((x) => String(x.id) === key) || null;
  if (path.indexOf('/api/socials') === 0) return (db.socials || []).find((x) => String(x.id) === key) || null;
  if (path.indexOf('/api/reminders') === 0) return (db.reminders || []).find((x) => String(x.id) === key) || null;
  if (path.indexOf('/api/actions') === 0) {
    const map = db.agentActions || {};
    for (const name of Object.keys(map)) {
      const hit = (map[name] || []).find((x) => String(x.id) === key);
      if (hit) return Object.assign({ agent: name }, hit);
    }
  }
  return null;
}

function agentOfRecord(row) {
  if (!row) return '';
  return text(row.agentName || row.sourceAgentName || row.expertName || row.sourceExpertName || row.agent || '');
}

function isAllowedName(allowed, name) {
  if (!allowed) return true;
  const n = text(name);
  if (!n) return false;
  return allowed.has(n);
}

/* کپی محدودشده‌ی db برای خواندن (هرگز خود db را تغییر نمی‌دهد). */
function scopeDb(db, user) {
  if (!db || !user || user.role === 'admin' || user.unrestricted) return db;
  const allowed = allowedAgentNames(db, user);
  const keepRow = (row) => isAllowedName(allowed, agentOfRecord(row));
  const out = Object.assign({}, db);
  out.agents = (db.agents || []).filter((a) => isAllowedName(allowed, a.name));
  out.tickets = (db.tickets || []).filter(keepRow);
  out.socials = (db.socials || []).filter(keepRow);
  out.callFeedbacks = (db.callFeedbacks || []).filter(keepRow);
  out.reminders = (db.reminders || []).filter(keepRow);
  const actions = {};
  Object.keys(db.agentActions || {}).forEach((name) => { if (isAllowedName(allowed, name)) actions[name] = db.agentActions[name]; });
  out.agentActions = actions;
  out.__scope = { user: user.name, agents: out.agents.length };
  return out;
}

/* دسترسی نوشتن: مدیر آزاد؛ کارشناس QC فقط روی رکوردهای مجاز. */
function writeGuard(db, user, method, pathname, body) {
  if (!authRequired(db)) return { ok: true };
  if (!user) return { ok: false, status: 401, error: 'برای این کار باید وارد سامانه شوید' };
  if (user.role === 'admin' || user.unrestricted) return { ok: true };
  const path = String(pathname || '');
  if (method === 'GET') return { ok: true };
  if (ADMIN_API.some((p) => path === p || path.indexOf(p + '/') === 0)) {
    return { ok: false, status: 403, error: 'این بخش فقط برای مدیر سیستم باز است' };
  }
  const scopedWrite = ['/api/tickets', '/api/socials', '/api/actions', '/api/reminders'];
  if (!scopedWrite.some((p) => path === p || path.indexOf(p + '/') === 0)) {
    return { ok: false, status: 403, error: 'اجازه‌ی این تغییر را ندارید' };
  }
  const allowed = allowedAgentNames(db, user);
  const candidates = [];
  const b = body || {};
  ['agentName', 'sourceAgentName', 'expertName', 'agent'].forEach((k) => { if (text(b[k])) candidates.push(text(b[k])); });
  const id = path.split('/')[3];
  if (id != null && id !== '') {
    const row = recordById(db, path, id);
    if (row) candidates.push(agentOfRecord(row));
  }
  if (!candidates.length) return { ok: false, status: 400, error: 'کارشناس این رکورد مشخص نیست' };
  const denied = candidates.filter((name) => !isAllowedName(allowed, name));
  if (denied.length) {
    return { ok: false, status: 403, error: 'به داده‌ی کارشناس «' + denied[0] + '» دسترسی ندارید' };
  }
  return { ok: true };
}

/* ------------------------------------------------------------ دسترسی UI */
function isAdmin(user) { return !!user && (user.role === 'admin' || !!user.unrestricted); }

function canAccessRoute(user, route, authOn) {
  if (!authOn) return true; // وقتی هیچ کاربری تعریف نشده، همه‌چیز باز است
  if (!user) return false;
  if (isAdmin(user)) return true;
  const key = String(route || '');
  return SHARED_ROUTES.includes(key) || SHARED_ROUTES.includes(key.replace(/-new$/, ''));
}

function visibleRoutes(user, authOn) {
  return SHARED_ROUTES.concat(ADMIN_ROUTES).filter((r) => canAccessRoute(user, r, authOn));
}

function canAccessApi(db, user, method, pathname) {
  if (!authRequired(db)) return { ok: true };
  if (!user) return { ok: false, status: 401, error: 'نشست شما معتبر نیست؛ دوباره وارد شوید' };
  if (isAdmin(user)) return { ok: true };
  const path = String(pathname || '').split('?')[0];
  if (method === 'GET' && OPEN_API.some((p) => path === p || path.indexOf(p + '/') === 0)) return { ok: true };
  if (ADMIN_API.some((p) => path === p || path.indexOf(p + '/') === 0)) {
    return { ok: false, status: 403, error: 'این بخش فقط برای مدیر سیستم باز است' };
  }
  return { ok: true };
}

/* ویرایش کاربر توسط مدیر (ساخت/به‌روزرسانی رکورد تب QC_Users). */
function saveUser(db, body, existing) {
  const users = Array.isArray(db.qcUsers) ? db.qcUsers : (db.qcUsers = []);
  const fail = (message, status) => { const e = new Error(message); e.status = status || 400; throw e; };
  const name = P && P.normName ? P.normName(text(body.name)) : text(body.name);
  const previousName = existing ? text(existing.name) : '';
  if (!name) fail('نام کارشناس QC الزامی است');
  const key = nameKey(name);
  const clash = users.find((u) => nameKey(u.name) === key && (!existing || String(u.id) !== String(existing.id)));
  if (clash) fail('کاربری با این نام قبلاً تعریف شده است');
  let row;
  if (existing) row = Object.assign({}, existing);
  else {
    const maxId = users.reduce((m, u) => Math.max(m, Number(String(u.id || '').replace(/\D/g, '')) || 0), 0);
    row = { id: 'u' + (maxId + 1) };
  }
  row.name = name;
  row.role = /^ad/i.test(text(body.role)) ? 'admin' : 'qc';
  row.active = body.active === undefined ? true : !!body.active;
  /* اگر فیلدی در بدنه نیامده باشد (مثلاً فقط تغییر رمز یا نام)، مقدار قبلی حفظ
   * می‌شود؛ وگرنه یک PUT ناقص می‌توانست کل دسترسی را پاک کند. */
  const listValue = (value, key) => (Array.isArray(value)
    ? value.map(key === 'exts' ? digits : text).filter(Boolean).join(',')
    : text(value));
  row.exts = body.exts === undefined ? text(existing && existing.exts) : listValue(body.exts, 'exts');
  row.agents = body.agents === undefined ? text(existing && existing.agents) : listValue(body.agents, 'agents');
  row.teams = body.teams === undefined ? text(existing && existing.teams) : listValue(body.teams, 'teams');
  row.note = text(body.note);
  row.updatedAt = new Date().toISOString();
  const plain = body.password == null ? '' : text(body.password);
  if (plain) {
    if (plain.length < 4) fail('رمز باید حداقل ۴ نویسه باشد');
    row.password = hashPassword(plain);
  } else if (!existing) fail('رمز اولیه الزامی است');
  /* ردیف ویرایش‌شده باید جایگزین ردیف قبلی شود؛ وگرنه ویرایش کاربر (دسترسی/نقش/رمز)
   * فقط در پاسخ دیده می‌شود و روی تب QC_Users نمی‌نشیند. */
  if (existing) {
    const at = users.indexOf(existing);
    if (at >= 0) users[at] = row; else users.push(row);
  } else users.push(row);
  /* نام کارشناس QC باید در فهرست qcAgents هم باشد تا در فرم‌ها و ستون‌های تب
   * Agents دیده شود. با تغییر نام، همان جایگاه قبلی به نام تازه تبدیل می‌شود
   * (وگرنه ستون قدیمی روی شیت برای همیشه می‌ماند). */
  if (!Array.isArray(db.qcAgents)) db.qcAgents = [];
  const previousKey = previousName ? nameKey(previousName) : '';
  const at = previousKey && previousKey !== key
    ? db.qcAgents.findIndex((x) => nameKey(x) === previousKey) : -1;
  if (at >= 0) db.qcAgents[at] = name;
  else if (!db.qcAgents.some((x) => nameKey(x) === key)) db.qcAgents.push(name);
  if (previousName && previousKey !== key) renameAgentQcColumn(db, previousName, name);
  return clone(row);
}

function deleteUser(db, name) {
  const users = Array.isArray(db.qcUsers) ? db.qcUsers : [];
  const key = nameKey(P && P.normName ? P.normName(text(name)) : text(name));
  const found = users.find((u) => nameKey(u.name) === key);
  if (!found) { const e = new Error('کاربر یافت نشد'); e.status = 404; throw e; }
  db.qcUsers = users.filter((u) => u !== found);
  dropAgentQcColumn(db, found.name);
  return { ok: true, name: found.name };
}

/* ردیف‌های آماده‌ی نوشتن روی تب (بدون رمز hash‌شده؟ رمز hash می‌ماند). */
function usersToRows(users) {
  return (users || []).map((u) => ({ id: u.id, name: u.name, password: u.password, role: u.role,
    active: u.active ? 1 : 0, exts: (u.exts || []).join(','), agents: (u.agents || []).join(','),
    teams: (u.teams || []).join(','), note: u.note || '' }));
}

function userMask(users) {
  return (users || []).map((u) => Object.assign({}, u, { password: u.password ? '••••••' : '' }));
}

return {
  sha256Hex: sha256Hex, hashPassword: hashPassword, verifyPassword: verifyPassword, isHashed: isHashed,
  randomToken: randomToken, splitList: splitList, normalizeUser: normalizeUser, normalizeUsers: normalizeUsers,
  authMode: authMode, authRequired: authRequired, findUser: findUser, login: login, accounts: accounts,
  publicUser: publicUser, allowedAgentNames: allowedAgentNames, scopeDb: scopeDb, writeGuard: writeGuard,
  canAccessApi: canAccessApi, canAccessRoute: canAccessRoute, visibleRoutes: visibleRoutes, isAdmin: isAdmin,
  saveUser: saveUser, deleteUser: deleteUser, usersToRows: usersToRows, userMask: userMask,
  nameKey: nameKey,
  QC_COLUMN_PREFIX: QC_COLUMN_PREFIX, QC_TICK: QC_TICK, qcColumnHeader: qcColumnHeader,
  qcColumnName: qcColumnName, isQcColumn: isQcColumn, isQcTick: isQcTick, agentQcNames: agentQcNames,
  applyQcColumns: applyQcColumns, qcColumnValue: qcColumnValue, qcExpertNames: qcExpertNames,
  syncAgentQcColumn: syncAgentQcColumn, dropAgentQcColumn: dropAgentQcColumn,
  renameAgentQcColumn: renameAgentQcColumn,
  ADMIN_ROUTES: ADMIN_ROUTES, SHARED_ROUTES: SHARED_ROUTES, ADMIN_API: ADMIN_API, OPEN_API: OPEN_API
};
});
