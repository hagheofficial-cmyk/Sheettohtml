'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const Access = require('../shared/access');
const Fiscal = require('../shared/fiscal');
const Elements = require('../shared/elements');
const Reports = require('../shared/reports');
const C = require('../shared/calc');
const { ROOT, fixture, browser, settle, go } = require('./helpers');

/* دو ماه مالی نسبت به امروز تا این تست در هر تاریخی معتبر بماند. */
function fiscalFixture() {
  const t = C.todayJalali();
  const pm = C.jalaliMonthAdd(t.jy, t.jm, -1);
  const cur = C.jalaliMonthRange(t.jy, t.jm), prev = C.jalaliMonthRange(pm.jy, pm.jm);
  return {
    current: { name: 'دوره جاری', from: C.formatJalali(cur.from), to: C.formatJalali(cur.to) },
    previous: { name: 'دوره قبل', from: C.formatJalali(prev.from), to: C.formatJalali(prev.to) }
  };
}

/* رکورد نمونه‌ی تیکت/سوشال با همه‌ی فیلدهای اجباری */
const ticketBody = (agentName, code, reviewDate) => ({
  qcAgent: 'هادی', reviewDate: reviewDate, ticketDate: reviewDate, agentName: agentName, team: 'Tele Sales',
  ticketCode: code, q1: '1', q2: '1', q3: '0', q4: '-', redline: '0', comment: ''
});
const socialBody = (agentName, reviewDate) => ({
  qcAgent: 'هادی', reviewDate: reviewDate, receiveDate: reviewDate, replyDate: reviewDate, agentName: agentName,
  messenger: 'واتساپ', receiveTime: '10:00', replyTime: '10:20', responseStatus: 'پاسخ داده شده',
  reasonVerdict: 'تأیید شد', qSla: '1', qFollow: '0', qClosing: '-', qTone: '1'
});

/* ========================================================================== *
 * ۱) لایه‌ی مشترک — همان کدی که در Node، مرورگر و Apps Script اجرا می‌شود
 * ========================================================================== */

test('shared/access: دسترسی کارشناس QC از داخلی/نام/تیم ساخته می‌شود و نوشتن خارج از آن بسته است', () => {
  const db = fixture();
  const authed = { ...db, settings: { ...db.settings, authMode: 'on' } }; // ورود همیشه روشن

  assert.deepEqual(Access.ADMIN_ROUTES, ['criteria', 'directory', 'agents', 'data', 'qcadmin', 'sheets'],
    'صفحه‌های مدیریتی (بند ۶) + مدیریت QC');
  for (const route of ['dashboard', 'tickets', 'tickets-new', 'socials', 'reports', 'portfolio', 'callreport']) {
    assert.ok(Access.SHARED_ROUTES.includes(route), route + ' برای کارشناس QC باز است');
  }
  assert.ok(Access.OPEN_API.includes('/api/data/status') && Access.OPEN_API.includes('/api/agents'),
    'خواندن‌های لازم صفحه‌های عملیاتی برای QC باز است');

  const admin = Access.normalizeUser({ name: 'مدیر سیستم', role: 'admin' }, 0);
  assert.equal(Access.isAdmin(admin), true);
  assert.equal(admin.unrestricted, true);
  assert.equal(Access.allowedAgentNames(db, admin), null, 'مدیر همه‌ی داده‌ها را می‌بیند (admin_all)');
  assert.equal(Access.canAccessApi(authed, admin, 'PUT', '/api/settings').ok, true);
  assert.equal(Access.canAccessRoute(admin, 'qcadmin', true), true);
  assert.equal(Access.scopeDb(db, admin), db, 'داده‌ی مدیر محدود نمی‌شود');

  /* جداکننده‌های فارسی/لاتین و اعداد فارسی */
  const mixed = Access.normalizeUser({ name: 'مبینا', role: 'qc', exts: '۱۰۱ ، 104', teams: 'Account', agents: '' }, 1);
  assert.deepEqual(mixed.exts, ['101', '104']);
  assert.deepEqual(mixed.teams, ['Account']);
  assert.equal(mixed.active, true, 'ستون active خالی یعنی فعال');
  assert.equal(mixed.unrestricted, false);

  const allowed = Access.allowedAgentNames(db, mixed);
  assert.ok(allowed instanceof Set);
  assert.deepEqual([...allowed].sort(), ['کارشناس الف', 'کارشناس ب', 'کارشناس بایگانی'].sort(),
    'داخلی ۱۰۱ → کارشناس الف، تیم Account → کارشناس ب و بایگانی');

  const scoped = Access.scopeDb(db, mixed);
  assert.deepEqual(scoped.tickets.map((r) => r.id), [1, 2, 3]);
  assert.deepEqual(scoped.socials.map((r) => r.id), [1, 2, 3]);
  assert.equal(scoped.callFeedbacks.filter((r) => r.expertName === 'کارشناس ثبت‌نشده').length, 0,
    'تماس‌های کارشناس خارج از دسترسی حذف می‌شوند');
  assert.deepEqual(scoped.agents.map((r) => r.name).sort(), ['کارشناس الف', 'کارشناس ب', 'کارشناس بایگانی'].sort());
  const withActions = { ...db, agentActions: { 'کارشناس الف': [{ id: 1 }], 'کارشناس بدون ریت': [{ id: 2 }] } };
  assert.deepEqual(Object.keys(Access.scopeDb(withActions, mixed).agentActions), ['کارشناس الف'],
    'اقدام‌های ثبت‌شده هم به دسترسی کارشناس QC محدود می‌شوند');
  assert.equal(scoped.__scope.user, 'مبینا');
  assert.equal(scoped.__scope.agents, 3);
  assert.equal(db.tickets.length, fixture().tickets.length, 'داده‌ی اصلی دست‌نخورده می‌ماند (کپی محدودشده)');

  /* فقط یک داخلی */
  const narrow = Access.normalizeUser({ name: 'شیدا', role: 'qc', exts: '101' }, 2);
  const scopedNarrow = Access.scopeDb(db, narrow);
  assert.deepEqual(scopedNarrow.tickets.map((r) => r.id), [1, 2]);
  assert.deepEqual(scopedNarrow.agents.map((r) => r.name), ['کارشناس الف']);
  assert.equal(scopedNarrow.callFeedbacks.length, 5);

  /* دسترسی خالی = هیچ داده‌ای، مقدار «همه» = بدون محدودیت */
  const empty = Access.normalizeUser({ name: 'هانیه', role: 'qc' }, 3);
  assert.deepEqual([...Access.allowedAgentNames(db, empty)], []);
  assert.equal(Access.scopeDb(db, empty).tickets.length, 0);
  assert.equal(Access.allowedAgentNames(db, Access.normalizeUser({ name: 'x', role: 'qc', agents: '*' }, 4)), null);
  assert.equal(Access.allowedAgentNames(db, Access.normalizeUser({ name: 'x', role: 'qc', teams: 'همه' }, 5)), null);

  /* گارد خواندن/نوشتن (بند ۵) */
  assert.equal(Access.writeGuard(authed, null, 'PUT', '/api/tickets', {}).status, 401);
  assert.equal(Access.canAccessApi(authed, null, 'GET', '/api/tickets').status, 401);
  assert.deepEqual(Access.canAccessApi(authed, narrow, 'GET', '/api/settings'), { ok: false, status: 403, error: 'این بخش فقط برای مدیر سیستم باز است' });
  assert.equal(Access.canAccessApi(authed, narrow, 'GET', '/api/criteria').status, 403);
  assert.equal(Access.canAccessApi(authed, narrow, 'GET', '/api/qc-users').status, 403);
  assert.equal(Access.canAccessApi(authed, narrow, 'GET', '/api/data/status').ok, true, 'شمارنده‌های پایین صفحه برای QC');
  assert.equal(Access.canAccessApi(authed, narrow, 'GET', '/api/agents').ok, true, 'پرونده کارشناس به فهرست کارشناسان نیاز دارد');
  assert.equal(Access.canAccessApi(authed, narrow, 'POST', '/api/agents').status, 403, 'اما نوشتن روی کارشناسان فقط مدیر');
  assert.equal(Access.canAccessApi(authed, narrow, 'GET', '/api/tickets').ok, true);

  const deniedWrite = Access.writeGuard(authed, narrow, 'POST', '/api/tickets', { agentName: 'کارشناس بدون ریت' });
  assert.equal(deniedWrite.status, 403);
  assert.ok(deniedWrite.error.includes('کارشناس بدون ریت'), deniedWrite.error);
  assert.equal(Access.writeGuard(authed, narrow, 'PUT', '/api/settings', {}).status, 403, 'تنظیمات فقط مدیر');
  assert.equal(Access.writeGuard(authed, narrow, 'POST', '/api/backup', {}).status, 403);
  assert.equal(Access.writeGuard(authed, narrow, 'POST', '/api/tickets', { agentName: 'کارشناس الف' }).ok, true);
  /* ویرایش رکوردی که مال کارشناس دیگری است، حتی بدون نام در بدنه */
  assert.equal(Access.writeGuard(authed, narrow, 'PUT', '/api/tickets/3', { score: 10 }).status, 403);
  assert.equal(Access.writeGuard(authed, narrow, 'PUT', '/api/tickets/1', { score: 10 }).ok, true);
  assert.equal(Access.writeGuard(authed, narrow, 'POST', '/api/socials', {}).status, 400, 'کارشناس نامشخص → خطا');
  assert.equal(Access.writeGuard(authed, admin, 'PUT', '/api/settings', {}).ok, true);
  /* وقتی ورود خاموش است هیچ محدودیتی اعمال نمی‌شود */
  const off = { ...db, settings: { ...db.settings, authMode: 'off' } };
  assert.equal(Access.writeGuard(off, narrow, 'PUT', '/api/settings', {}).ok, true);
  assert.equal(Access.canAccessApi(off, null, 'GET', '/api/settings').ok, true);

  /* مسیرها: کارشناس QC فقط صفحه‌های عملیاتی */
  assert.equal(Access.canAccessRoute(narrow, 'qcadmin', true), false);
  assert.equal(Access.canAccessRoute(narrow, 'criteria', true), false);
  assert.equal(Access.canAccessRoute(narrow, 'tickets-new', true), true);
  assert.equal(Access.canAccessRoute(narrow, 'dashboard', false), true, 'با ورود خاموش همه‌چیز باز');
  assert.equal(Access.canAccessRoute(null, 'dashboard', true), false, 'بدون نشست هیچ صفحه‌ای باز نیست');
  assert.deepEqual(Access.visibleRoutes(narrow, true).includes('qcadmin'), false);
  assert.deepEqual(Access.visibleRoutes(admin, true).includes('qcadmin'), true);

  /* رمز: اثر انگشت با نمک، و پذیرش رمز متن ساده‌ی نوشته‌شده روی شیت */
  const hash = Access.hashPassword('qc-1234');
  assert.ok(hash.indexOf('sha256$') === 0 && hash.split('$').length === 3);
  assert.notEqual(Access.hashPassword('qc-1234'), hash, 'هر بار نمک تازه');
  assert.equal(Access.verifyPassword(hash, 'qc-1234'), true);
  assert.equal(Access.verifyPassword(hash, 'QC-1234'), false);
  assert.equal(Access.verifyPassword('رمز-ساده', 'رمز-ساده'), true, 'رمز نوشته‌شده روی شیت هم پذیرفته می‌شود');
  assert.equal(Access.isHashed(hash), true);
  assert.equal(Access.isHashed('plain'), false);
  assert.equal(Access.randomToken(16).length, 32);
  /* usersToRows: همان ستون‌هایی که روی تب QC_Users نوشته می‌شود */
  const rows = Access.usersToRows([mixed]);
  assert.deepEqual(Object.keys(rows[0]), ['id', 'name', 'password', 'role', 'active', 'exts', 'agents', 'teams', 'note']);
  assert.equal(rows[0].exts, '101,104');
  assert.equal(rows[0].active, 1);
  const masked = Access.userMask([Access.normalizeUser({ name: 'x', password: 'sha256$aa$bb', role: 'qc' }, 0)])[0];
  assert.equal(masked.password, '••••••', 'رمز hash‌شده پشت نقاب می‌رود');
  assert.equal(Access.userMask([mixed])[0].password, '', 'کاربر بدون رمز، رمز خالی دارد');
  assert.equal(Access.login(db, 'مبینا', 'x').ok, false, 'کاربر ناشناس رد می‌شود');
});

test('shared/access: ستون qcAgents ردیف کارشناس هم دسترسی می‌دهد و با ذخیره‌ی کاربر همگام می‌ماند', () => {
  const db = fixture();
  db.agents.forEach((a) => { a.qcAgents = []; });
  db.agents.find((a) => a.name === 'کارشناس الف').qcAgents = 'مبینا، هادی'; // نوشته‌ی دستی روی تب Agents
  db.agents.find((a) => a.name === 'کارشناس ب').qcAgents = ['مبینا'];

  const mobina = Access.normalizeUser({ name: 'مبینا', role: 'qc' }, 0);
  assert.deepEqual([...Access.allowedAgentNames(db, mobina)].sort(), ['کارشناس الف', 'کارشناس ب'],
    'نام کاربر در ستون qcAgents یعنی دسترسی به همان کارشناس');
  assert.deepEqual([...Access.allowedAgentNames(db, Access.normalizeUser({ name: 'هادی', role: 'qc' }, 1))], ['کارشناس الف'],
    'نوشته‌ی رشته‌ای با جداکننده‌ی فارسی هم خوانده می‌شود');
  assert.deepEqual(Access.scopeDb(db, mobina).tickets.map((r) => r.id), [1, 2, 3]);
  assert.deepEqual(Access.scopeDb(db, Access.normalizeUser({ name: 'هادی', role: 'qc' }, 1)).tickets.map((r) => r.id), [1, 2]);

  /* حالت sync (ذخیره از صفحه‌ی مدیریت QC): ستون دقیقاً برابر دسترسی اعلامی می‌شود */
  const fromEditor = Access.normalizeUser({ name: 'مبینا', role: 'qc', agents: 'کارشناس ب' }, 0);
  assert.equal(Access.syncAgentQcColumn(db, fromEditor, 'sync'), 1);
  assert.deepEqual([...db.agents.find((a) => a.name === 'کارشناس الف').qcAgents], ['هادی'],
    'تیک برداشته‌شده از ستون هم پاک می‌شود؛ نام دیگران می‌ماند');
  assert.deepEqual([...db.agents.find((a) => a.name === 'کارشناس ب').qcAgents], ['مبینا']);

  /* حالت keep (پیش‌فرض، مثل تغییر رمز): فقط اضافه می‌کند و دسترسی داده‌شده از شیت را نمی‌پَراند */
  const shida = Access.normalizeUser({ name: 'شیدا', role: 'qc' }, 2);
  assert.equal(Access.syncAgentQcColumn(db, shida), 0);
  db.agents.find((a) => a.name === 'کارشناس بدون ریت').qcAgents = ['شیدا'];
  assert.equal(Access.syncAgentQcColumn(db, shida), 0, 'ذخیره‌ی معمولی ستون نوشته‌شده روی شیت را پاک نمی‌کند');
  assert.deepEqual([...Access.allowedAgentNames(db, shida)], ['کارشناس بدون ریت']);

  /* کاربر نامحدود/مدیر در ستون نمی‌ماند چون همه را می‌بیند */
  Access.syncAgentQcColumn(db, Access.normalizeUser({ name: 'مبینا', role: 'admin' }, 0), 'sync');
  assert.ok(db.agents.every((a) => !(a.qcAgents || []).includes('مبینا')), 'ستون برای کاربر نامحدود خالی می‌شود');

  /* تغییر نام و حذف کاربر QC، ستون را هم به‌روز می‌کند */
  db.agents.find((a) => a.name === 'کارشناس ب').qcAgents = ['شیدا', 'هادی'];
  assert.equal(Access.renameAgentQcColumn(db, 'شیدا', 'شیدا رحیمی'), 2, 'هر ردیفی که این نام را دارد به‌روز می‌شود');
  assert.deepEqual([...db.agents.find((a) => a.name === 'کارشناس ب').qcAgents], ['شیدا رحیمی', 'هادی']);
  assert.deepEqual([...db.agents.find((a) => a.name === 'کارشناس بدون ریت').qcAgents], ['شیدا رحیمی']);
  const withUsers = { ...db, qcUsers: [{ id: 'u9', name: 'شیدا رحیمی', password: 'sha256$a$b', role: 'qc' }] };
  Access.deleteUser(withUsers, 'شیدا رحیمی');
  assert.ok(withUsers.agents.every((a) => !(a.qcAgents || []).includes('شیدا رحیمی')), 'با حذف کاربر نامش از ستون می‌رود');
  assert.deepEqual([...withUsers.agents.find((a) => a.name === 'کارشناس ب').qcAgents], ['هادی']);

  /* ذخیره‌ی ردیف کارشناس (سرور/مرورگر) ستون را نگه می‌دارد و نرمال می‌کند */
  const Registry = require('../shared/registry');
  const saved = Registry.save({ ...db, seq: { agent: 99 } }, { name: 'کارشناس الف', team: 'Tele Sales', ext: 101 }, 1);
  assert.deepEqual([...saved.qcAgents], ['هادی'], 'ویرایش بدون اشاره به ستون، مقدار قبلی را حفظ می‌کند');
  const typed = Registry.save({ ...db, seq: { agent: 99 } }, { name: 'کارشناس الف', team: 'Tele Sales', ext: 101, qcAgents: 'مبینا | شیدا، مبینا' }, 1);
  assert.deepEqual([...typed.qcAgents], ['مبینا', 'شیدا'], 'جداکننده‌ها و تکراری‌ها نرمال می‌شوند');
});

test('shared/fiscal: بازه‌ی آماده‌ی ماه مالی از ردیف‌های تب Fiscal_Months ساخته می‌شود (بند ۲)', () => {
  const fx = fiscalFixture();
  const months = Fiscal.normalizeMonths([fx.previous, fx.current]);
  assert.equal(months.length, 2);
  assert.deepEqual(months.map((m) => m.id), ['fm1', 'fm2'], 'شناسه‌ی خودکار برای ردیف‌های بدون id');
  assert.equal(months[1].name, 'دوره جاری', 'مرتب‌سازی بر اساس تاریخ شروع');

  /* ردیف‌های کثیف شیت: تاریخ نامعتبر/وارونه نادیده گرفته می‌شود */
  const dirty = Fiscal.normalizeMonths([
    fx.current,
    { name: 'تاریخ خراب', from: '1404/13/40', to: '1404/08/30' },
    { name: 'وارونه', from: fx.previous.to, to: fx.previous.from },
    { name: '', from: '', to: '' }
  ]);
  assert.equal(dirty.length, 1, 'فقط ردیف معتبر می‌ماند');

  const today = C.formatJalali(C.todayJalali());
  assert.equal(Fiscal.currentMonth(months, today).name, 'دوره جاری');
  assert.equal(Fiscal.previousMonth(months, today).name, 'دوره قبل');
  assert.deepEqual(Fiscal.presetRange(months, 'fm:cur', today), { from: fx.current.from, to: fx.current.to, preset: 'fm:cur' });
  assert.deepEqual(Fiscal.presetRange(months, 'fm:prev', today), { from: fx.previous.from, to: fx.previous.to, preset: 'fm:prev' });
  assert.deepEqual(Fiscal.presetRange(months, 'fm:fm1', today), { from: fx.previous.from, to: fx.previous.to, preset: 'fm:fm1' });
  assert.equal(Fiscal.presetRange(months, 'fm:nope', today), null, 'ماه حذف‌شده → null تا کلاینت به بازه‌ی دیگر برگردد');
  assert.equal(Fiscal.presetRange(months, 'all', today), null);
  assert.equal(Fiscal.presetRange([], 'fm:cur', today), null);
  assert.equal(Fiscal.isFiscalPreset('fm:cur'), true);
  assert.equal(Fiscal.isFiscalPreset('cur'), false);
  assert.equal(Fiscal.labelFor(months, today), 'دوره جاری');
  assert.equal(Fiscal.monthOfDate(months, fx.previous.from).name, 'دوره قبل');
  assert.equal(Fiscal.monthOfDate(months, '1300/01/01'), null);
  assert.equal(Fiscal.monthOf('1405/6/20').key, '1405/06');

  const options = Fiscal.presetOptions(months, today);
  assert.deepEqual(options.map((o) => o.value), ['fm:cur', 'fm:prev', 'fm:fm2', 'fm:fm1']);
  assert.equal(options[0].label, 'ماه مالی جاری — دوره جاری');
  assert.equal(options[1].label, 'ماه مالی قبل — دوره قبل');
  assert.equal(options[0].group, 'ماه مالی');
  assert.equal(options[2].group, 'همه ماه‌های مالی');
  assert.ok(options[2].hint.includes(fx.current.from), 'راهنمای بازه در title گزینه‌ها');
  assert.deepEqual(Fiscal.presetOptions([], today), []);
});

test('shared/fiscal: خلاصه‌ی ماهانه‌ی آماده برای تب Monthly_Summary (بند ۸)', () => {
  const db = fixture();
  const out = Fiscal.monthlySummary(db, {});
  assert.ok(out.generatedAt && Array.isArray(out.rows) && Array.isArray(out.months));
  assert.equal(out.count, out.rows.length);
  assert.ok(out.rows.length > 0);
  const first = out.rows[0];
  for (const key of ['month', 'monthLabel', 'agent', 'ext', 'team', 'qcAgents', 'tickets', 'ticketAvg',
    'ticketRedline', 'socials', 'socialAvg', 'calls', 'callAvg', 'totalCount', 'combinedAvg', 'redlines', 'actions']) {
    assert.ok(Object.prototype.hasOwnProperty.call(first, key), 'ستون ' + key + ' در خلاصه‌ی ماهانه');
  }
  const agents = [...new Set(out.rows.map((r) => r.agent))].sort();
  assert.deepEqual(agents, ['کارشناس الف', 'کارشناس ب'], 'به‌ازای هر کارشناس و هر ماه یک ردیف');
  const faRow = out.rows.find((r) => r.agent === 'کارشناس الف');
  assert.equal(Number(faRow.tickets), 2);
  assert.equal(Number(faRow.ext), 101, 'داخلی کارشناس برای اتصال به تب Agents');

  const narrow = Fiscal.monthlySummary(db, { from: '1405/06/21', to: '1405/06/21' });
  assert.equal(narrow.rows.reduce((sum, r) => sum + Number(r.tickets || 0), 0), 1, 'فقط تیکت‌های همان بازه شمرده می‌شوند');
  const narrowFa = narrow.rows.find((r) => r.agent === faRow.agent);
  assert.equal(Number(narrowFa.tickets), 1);
  assert.equal(Number(narrowFa.calls), 1);
  assert.equal(Number(narrowFa.socials), 0);
  assert.deepEqual(narrow.range, { from: '1405/06/21', to: '1405/06/21' });
  assert.deepEqual(narrow.months, ['1405/06']);

  /* همان اعدادی که گزارش ترکیبی می‌دهد، اما از پیش محاسبه‌شده */
  const combined = Reports.combinedAgentReport(db, {});
  const ref = combined.find((r) => r.name === faRow.agent);
  assert.ok(ref, 'گزارش ترکیبی هم همین کارشناس را دارد');
  assert.equal(Number(faRow.ticketAvg), Number(ref.ticketAvg), 'میانگین تیکت در دو مسیر یکی است');
  assert.equal(Number(faRow.calls), 3, 'فقط تماس‌های نمره‌دار شمرده می‌شوند');
  assert.equal(Number(faRow.totalCount), Number(ref.scoredCount), 'شمار رکوردهای نمره‌دار یکی است');
  assert.equal(Number(faRow.combinedAvg), Number(ref.avgScore), 'میانگین ترکیبی یکی است');
});

test('shared/elements: تب Elements نام فارسی و ستون اکسل را جدا نگه می‌دارد (بند ۹)', () => {
  const cfg = {
    version: 4,
    forms: {
      ticket: [
        { key: 'q1', label: 'پیگیری صحیح', excelKey: 'Q1', active: true, aliases: [] },
        { key: 'q2', label: 'ثبت یادداشت', excelKey: 'Q2', active: true, aliases: ['NOTE_OLD'] }
      ],
      social: [{ key: 's1', label: 'لحن پیام', excelKey: 'S1', active: true, aliases: [] }]
    },
    teams: {
      telesales: { team: 'Tele Sales', form: 'call', elements: [
        { key: 'c1', label: 'شروع تماس', excelKey: 'Call_opening_quality', active: true, aliases: [] }
      ] }
    }
  };

  const rows = Elements.criteriaToRows(cfg);
  assert.equal(rows.length, 4);
  assert.deepEqual(Object.keys(rows[0]), ['scope', 'team', 'form', 'key', 'label', 'excelKey', 'active', 'aliases', 'order']);
  assert.deepEqual(rows.map((r) => r.order), [1, 2, 3, 4]);
  assert.equal(rows[3].scope, 'team');
  assert.equal(rows[3].team, 'Tele Sales');
  assert.equal(rows[1].aliases, 'NOTE_OLD', 'aliases با جداکننده‌ی | روی شیت نوشته می‌شود');

  /* رفت‌وبرگشت بدون تغییر: پیکربندی دقیقاً همان می‌ماند */
  assert.deepEqual(Elements.rowsToCriteria(rows, cfg), cfg);

  /* ویرایش مستقیم روی شیت: برچسب فارسی + ستون اکسل جدید */
  const edited = rows.map((r) => (r.scope === 'form' && r.key === 'q1'
    ? { ...r, label: 'پیگیری صحیح (ویرایش روی شیت)', excelKey: 'Q1_NEW' } : r));
  const next = Elements.rowsToCriteria(edited, cfg);
  const q1 = next.forms.ticket[0];
  assert.equal(q1.label, 'پیگیری صحیح (ویرایش روی شیت)');
  assert.equal(q1.excelKey, 'Q1_NEW');
  assert.deepEqual(q1.aliases, ['Q1'], 'ستون اکسل قبلی خودکار به aliases می‌رود تا سوابق قدیمی نشکنند');
  assert.deepEqual(next.forms.ticket[1].aliases, ['NOTE_OLD'], 'aliases قبلی حفظ می‌شود');
  assert.deepEqual(next.forms.social, cfg.forms.social, 'فرم‌های دست‌نخورده باقی می‌مانند');
  assert.equal(next.version, 4, 'نسخه‌ی پیکربندی را لایه‌ی ذخیره بالا می‌برد');

  /* برچسب خالی روی شیت → برچسب قبلی نگه داشته می‌شود */
  const blank = Elements.rowsToCriteria(rows.map((r) => (r.key === 'q2' ? { ...r, label: '', excelKey: '' } : r)), cfg);
  assert.equal(blank.forms.ticket[1].label, 'ثبت یادداشت');
  assert.equal(blank.forms.ticket[1].excelKey, 'Q2');

  /* غیرفعال‌کردن و افزودن ردیف تیم از روی شیت */
  const more = Elements.rowsToCriteria([
    ...rows.map((r) => (r.key === 's1' ? { ...r, active: 0 } : r)),
    { scope: 'team', team: 'Tele Sales', form: 'call', key: 'c9', label: 'ستون اختصاصی تیم', excelKey: 'X9', active: 1, aliases: '', order: 9 }
  ], cfg);
  assert.equal(more.forms.social[0].active, false);
  assert.deepEqual(more.teams.telesales.elements.map((d) => d.key), ['c1', 'c9']);

  /* ردیف خالی/بدون key نادیده گرفته می‌شود و پیکربندی خالی سالم می‌ماند */
  assert.deepEqual(Elements.rowsToCriteria([{ scope: 'form', form: 'ticket', key: '' }], cfg), cfg);
  assert.deepEqual(Elements.rowsToCriteria([], null), { version: 0, forms: {}, teams: {} });
  assert.deepEqual(Elements.aliasesOf('a|b، c\nd'), ['a', 'b', 'c', 'd']);
  const table = Elements.table(cfg, ['Tele Sales', 'Account']);
  assert.equal(table.rows.length, 4);
  assert.deepEqual(table.teams, ['Tele Sales', 'Account']);
  assert.equal(table.version, 4);
});

/* ========================================================================== *
 * ۲) سرور واقعی — ورود با رمز، scoping، تعارض نوشتن، ماه مالی، المان‌ها
 * ========================================================================== */

async function startServer() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crmqc-access-'));
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

test('real HTTP API: ورود با رمز، دسترسی مدیر/کارشناس QC، ماه مالی، المان‌ها و تعارض نوشتن', async (t) => {
  const server = await startServer();
  t.after(() => server.close());
  const fx = fiscalFixture();
  const call = async (method, url, body, token) => {
    const res = await fetch(server.origin + url, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { 'x-qc-token': token } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const raw = await res.text();
    let data; try { data = JSON.parse(raw); } catch { data = raw; }
    return { status: res.status, data };
  };

  await t.test('پیش از تعریف کاربر: ورود خاموش است و داده‌ی کامل بدون رمز می‌آید', async () => {
    const boot = await call('GET', '/api/bootstrap');
    assert.equal(boot.status, 200);
    assert.equal(boot.data.auth.required, false, 'حالت auto بدون کاربر فعال → بدون رمز');
    assert.equal(boot.data.auth.mode, 'auto');
    assert.equal(boot.data.auth.user, null);
    assert.deepEqual(boot.data.auth.accounts, []);
    assert.equal(boot.data.qcUsers, undefined, 'رمزها هرگز در bootstrap نمی‌آیند');
    assert.equal(boot.data.agents.length, 3, 'کارشناسان فعال از seed');

    /* داده‌ی نمونه پیش از قفل‌شدن ورود (سرور تازه همیشه خالی شروع می‌شود) */
    for (const row of [ticketBody('کارشناس الف', 'T-1', '1405/06/20'), ticketBody('کارشناس الف', 'T-2', '1405/06/21'),
      ticketBody('کارشناس بدون ریت', 'T-3', '1405/06/20')]) {
      assert.equal((await call('POST', '/api/tickets', row)).status, 200);
    }
    for (const row of [socialBody('کارشناس الف', '1405/06/20'), socialBody('کارشناس بدون ریت', '1405/06/20')]) {
      assert.equal((await call('POST', '/api/socials', row)).status, 200);
    }
    const after = await call('GET', '/api/bootstrap');
    assert.deepEqual(after.data.counts, { tickets: 3, socials: 2, calls: 0, callMeta: null });
    assert.equal(after.data.revision > 0, true);
    assert.equal((await call('GET', '/api/revision')).data.revision, after.data.revision);
  });

  await t.test('راه‌اندازی اولیه: ساخت حساب مدیر و قفل‌شدن ورود', async () => {
    const setup = await call('POST', '/api/auth/setup', { name: 'مدیر سیستم', password: 'admin-1234' });
    assert.equal(setup.status, 200);
    assert.equal(setup.data.user.role, 'admin');
    assert.equal(setup.data.user.unrestricted, true);
    assert.equal(setup.data.user.password, undefined, 'رمز به کلاینت برنمی‌گردد');
    assert.equal((await call('POST', '/api/auth/setup', { name: 'دیگری', password: 'x-1234' })).status, 400,
      'راه‌اندازی اولیه فقط یک بار');
    assert.equal((await call('POST', '/api/auth/setup', { name: 'a', password: '' })).status, 400);

    const locked = await call('GET', '/api/bootstrap');
    assert.equal(locked.data.auth.required, true);
    assert.deepEqual(locked.data.auth.accounts, [{ name: 'مدیر سیستم', role: 'admin' }]);
    assert.deepEqual(locked.data.agents, [], 'پیش از ورود هیچ داده‌ای لو نمی‌رود');
    assert.deepEqual(locked.data.counts, { tickets: 0, socials: 0, calls: 0, callMeta: null });
    assert.equal(locked.data.tickets, undefined);
    assert.deepEqual(locked.data.fiscalMonths, []);

    assert.equal((await call('POST', '/api/qc-users', { name: 'نفوذی', password: 'abcd', role: 'admin' })).status, 401,
      'بدون نشست هیچ نوشتنی ممکن نیست');
    assert.equal((await call('GET', '/api/settings')).status, 401);
    assert.equal((await call('GET', '/api/tickets')).status, 401);
    assert.equal((await call('GET', '/api/revision')).status, 200, 'شماره‌ی بازنگری برای همگام‌سازی عمومی است');
    const accounts = await call('GET', '/api/auth/accounts');
    assert.equal(accounts.status, 200, 'فهرست کاربران صفحه‌ی ورود بدون نشست خوانده می‌شود');
    assert.equal(accounts.data.firstRun, false);
  });

  let adminToken = '';
  await t.test('ورود: رمز درست توکن می‌دهد، رمز نادرست و توکن نامعتبر رد می‌شوند', async () => {
    assert.equal((await call('POST', '/api/auth/login', { name: 'مدیر سیستم', password: 'wrong' })).status, 401);
    assert.equal((await call('POST', '/api/auth/login', { name: 'نبود', password: 'abcd' })).status, 401);
    const ok = await call('POST', '/api/auth/login', { name: 'مدیر سیستم', password: 'admin-1234' });
    assert.equal(ok.status, 200);
    assert.equal(typeof ok.data.token, 'string');
    assert.ok(ok.data.token.length >= 24);
    assert.equal(ok.data.user.role, 'admin');
    assert.equal(ok.data.user.unrestricted, true);
    adminToken = ok.data.token;
    const badToken = await call('GET', '/api/bootstrap', undefined, 'deadbeef');
    assert.equal(badToken.status, 200, 'bootstrap همیشه پاسخ می‌دهد تا کلاینت دروازه‌ی ورود را نشان دهد');
    assert.equal(badToken.data.auth.user, null, 'اما با توکن نامعتبر هیچ کاربری فعال نیست');
    assert.deepEqual(badToken.data.agents, []);
    assert.equal((await call('GET', '/api/settings', undefined, 'deadbeef')).status, 401);
    const me = await call('GET', '/api/auth/me', undefined, adminToken);
    assert.equal(me.data.user.name, 'مدیر سیستم');
    assert.equal(me.data.admin, true);
    assert.equal(me.data.required, true);
    const bearer = await fetch(server.origin + '/api/auth/me', { headers: { Authorization: 'Bearer ' + adminToken } });
    assert.equal(bearer.status, 200, 'هدر Authorization هم پذیرفته می‌شود');
  });

  await t.test('مدیر: همه‌ی صفحه‌ها، همه‌ی داده‌ها و فهرست کاربران با رمز پوشیده', async () => {
    const boot = await call('GET', '/api/bootstrap', undefined, adminToken);
    assert.equal(boot.data.auth.admin, true);
    assert.equal(boot.data.auth.user.name, 'مدیر سیستم');
    assert.deepEqual(boot.data.counts, { tickets: 3, socials: 2, calls: 0, callMeta: null });
    assert.equal(boot.data.agents.length, 3);
    assert.ok(Array.isArray(boot.data.qcUsers));
    assert.equal(boot.data.qcUsers[0].password, '••••••', 'رمز hash‌شده حتی به مدیر هم نشان داده نمی‌شود');
    assert.equal(boot.data.qcUsers[0].password.indexOf('sha256$'), -1);
    for (const url of ['/api/settings', '/api/criteria', '/api/agents', '/api/qc-users', '/api/elements', '/api/monthly-summary']) {
      assert.equal((await call('GET', url, undefined, adminToken)).status, 200, url);
    }
  });

  await t.test('مدیر کاربر QC را با داخلی‌های مجاز تعریف می‌کند (تب QC_Users)', async () => {
    assert.equal((await call('POST', '/api/qc-users', { name: 'بی‌رمز', role: 'qc' }, adminToken)).status, 400, 'رمز اولیه الزامی است');
    assert.equal((await call('POST', '/api/qc-users', { name: 'رمزکوتاه', password: '12', role: 'qc' }, adminToken)).status, 400);
    assert.equal((await call('POST', '/api/qc-users', { name: '', password: 'abcd', role: 'qc' }, adminToken)).status, 400);

    const created = await call('POST', '/api/qc-users', {
      name: 'مبینا', password: 'qc-1234', role: 'qc', active: true, exts: '101', note: 'مسئول تیم فروش'
    }, adminToken);
    assert.equal(created.status, 200);
    assert.deepEqual(created.data.user.exts, ['101']);
    assert.equal(created.data.user.password, '••••••');
    assert.equal(created.data.user.role, 'qc');
    assert.equal(created.data.user.id, 'u2');

    const list = await call('GET', '/api/qc-users', undefined, adminToken);
    assert.equal(list.data.users.length, 2);
    assert.deepEqual(list.data.teams, ['Account', 'Tele Sales']);
    assert.equal(list.data.agents.length, 4, 'همه‌ی کارشناسان (حتی غیرفعال) برای انتخاب دسترسی');
    assert.equal(list.data.mode, 'auto');
    assert.equal(list.data.required, true);

    assert.equal((await call('POST', '/api/qc-users', { name: 'مبینا', password: 'abcd', role: 'qc' }, adminToken)).status, 400,
      'نام تکراری رد می‌شود');

    /* دسترسی تیمی/داخلی فارسی + ویرایش با PUT */
    const teamUser = await call('POST', '/api/qc-users', { name: 'شیدا', password: 'qc-5678', role: 'qc', teams: 'Account' }, adminToken);
    const id = teamUser.data.user.id;
    const updated = await call('PUT', '/api/qc-users/' + id, { id: id, name: 'شیدا', role: 'qc', teams: 'Account', exts: '۱۰۳' }, adminToken);
    assert.equal(updated.status, 200);
    assert.deepEqual(updated.data.user.exts, ['103'], 'اعداد فارسی روی شیت هم پذیرفته می‌شوند');
    assert.equal((await call('PUT', '/api/qc-users/u999', { id: 'u999', name: 'x' }, adminToken)).status, 404);

    /* ارتقای نقش و حذف مدیر */
    const promote = await call('PUT', '/api/qc-users/' + id, { id: id, name: 'شیدا', role: 'admin' }, adminToken);
    assert.equal(promote.data.user.role, 'admin');
    await call('PUT', '/api/qc-users/' + id, { id: id, name: 'شیدا', role: 'qc' }, adminToken);
    const adminId = list.data.users.find((u) => u.role === 'admin').id;
    assert.equal((await call('DELETE', '/api/qc-users/' + adminId, undefined, adminToken)).status, 400,
      'حذف حساب خود یا آخرین مدیر بسته است');
    const del = await call('DELETE', '/api/qc-users/' + id, undefined, adminToken);
    assert.equal(del.status, 200);
    assert.equal(del.data.users.length, 2);
    /* نام کاربر QC به فهرست کارشناسان QC اضافه شده تا در فرم‌ها قابل انتخاب باشد */
    const qcAgents = await call('GET', '/api/qc-agents', undefined, adminToken);
    assert.ok(qcAgents.data.includes('مبینا'), JSON.stringify(qcAgents.data));

    /* ستون qcAgents ردیف کارشناس: نوشتن از API (معادل ویرایش روی تب Agents) */
    const rows = await call('GET', '/api/agents', undefined, adminToken);
    const first = rows.data.find((a) => a.name === 'کارشناس الف');
    const second = rows.data.find((a) => a.name === 'کارشناس ب');
    assert.deepEqual(first.qcAgents, ['مبینا'], 'ذخیرهٔ کاربر QC ستون ردیف کارشناس را هم پر کرد');
    assert.deepEqual(second.qcAgents, [], 'کارشناس انتخاب‌نشده ستون خالی دارد');
    const column = await call('PUT', '/api/agents/' + second.id, { qcAgents: 'مبینا، هادی' }, adminToken);
    assert.deepEqual(column.data.qcAgents, ['مبینا', 'هادی']);
    const mobinaId = (await call('GET', '/api/qc-users', undefined, adminToken)).data.users.find((u) => u.name === 'مبینا').id;
    const byColumn = await call('POST', '/api/auth/login', { name: 'مبینا', password: 'qc-1234' });
    const bootColumn = await call('GET', '/api/bootstrap', undefined, byColumn.data.token);
    assert.deepEqual(bootColumn.data.agents.map((a) => a.name).sort(), ['کارشناس الف', 'کارشناس ب'],
      'ستون نوشته‌شده دسترسی می‌دهد');

    /* ذخیره از صفحهٔ مدیریت QC با syncColumn → ستون همگام می‌شود */
    const synced = await call('PUT', '/api/qc-users/' + mobinaId,
      { id: mobinaId, name: 'مبینا', role: 'qc', exts: '101', agents: '', teams: '', syncColumn: true }, adminToken);
    assert.equal(synced.status, 200);
    const afterSync = await call('GET', '/api/agents', undefined, adminToken);
    assert.deepEqual(afterSync.data.find((a) => a.name === 'کارشناس الف').qcAgents, ['مبینا'], 'تیک روی ستون نشست');
    assert.deepEqual(afterSync.data.find((a) => a.name === 'کارشناس ب').qcAgents, ['هادی'],
      'بدون تیک نام خودش پاک شد؛ نام دیگران دست‌نخورده می‌ماند');

    /* تمیزکردن برای آزمون‌های بعدی */
    await call('PUT', '/api/agents/' + rows.data.find((a) => a.name === 'کارشناس الف').id, { qcAgents: '' }, adminToken);
    const backToNormal = await call('GET', '/api/bootstrap', undefined, byColumn.data.token);
    assert.deepEqual(backToNormal.data.agents.map((a) => a.name), ['کارشناس الف']);
  });

  let qcToken = '';
  await t.test('کارشناس QC: فقط داده‌ی مجاز، بدون صفحه‌ها و APIهای مدیریتی', async () => {
    const login = await call('POST', '/api/auth/login', { name: 'مبینا', password: 'qc-1234' });
    assert.equal(login.status, 200);
    qcToken = login.data.token;
    assert.equal(login.data.user.role, 'qc');
    assert.equal(login.data.user.unrestricted, false);
    assert.deepEqual(login.data.user.exts, ['101']);

    const boot = await call('GET', '/api/bootstrap', undefined, qcToken);
    assert.equal(boot.data.auth.admin, false);
    assert.equal(boot.data.auth.user.name, 'مبینا');
    assert.deepEqual(boot.data.agents.map((a) => a.name), ['کارشناس الف'], 'فقط کارشناس با داخلی ۱۰۱');
    assert.deepEqual(boot.data.counts, { tickets: 2, socials: 1, calls: 0, callMeta: null }, 'شمارش‌ها هم محدودشده‌اند');
    assert.equal(boot.data.qcUsers, undefined, 'فهرست کاربران/رمزها به کارشناس QC نمی‌رسد');
    assert.deepEqual(boot.data.teams, ['Tele Sales']);

    const tickets = await call('GET', '/api/tickets', undefined, qcToken);
    assert.deepEqual(tickets.data.rows.map((r) => r.ticketCode).sort(), ['T-1', 'T-2']);
    assert.equal(tickets.data.total, 2);
    const socials = await call('GET', '/api/socials', undefined, qcToken);
    assert.equal(socials.data.total, 1);
    const agents = await call('GET', '/api/agents', undefined, qcToken);
    assert.deepEqual(agents.data.map((a) => a.name), ['کارشناس الف'], 'فهرست کارشناسان هم محدود است');
    const status = await call('GET', '/api/data/status', undefined, qcToken);
    assert.equal(status.status, 200, 'شمارنده‌های پایین صفحه برای QC باز است');
    assert.equal(status.data.tickets, 2);

    for (const url of ['/api/settings', '/api/criteria', '/api/qc-users', '/api/elements', '/api/fiscal-months', '/api/backup']) {
      assert.equal((await call('GET', url, undefined, qcToken)).status, 403, url);
    }
    assert.equal((await call('PUT', '/api/settings', { orgName: 'هک' }, qcToken)).status, 403);
    assert.equal((await call('PUT', '/api/qc-users/u1', { id: 'u1', name: 'مبینا', role: 'admin' }, qcToken)).status, 403,
      'ارتقای نقش توسط کارشناس QC بسته است');
    assert.equal((await call('POST', '/api/backup', {}, qcToken)).status, 403);
    assert.equal((await call('PUT', '/api/fiscal-months', { months: [] }, qcToken)).status, 403);
    /* صفحه‌های عملیاتی باز می‌مانند */
    for (const url of ['/api/dashboard', '/api/reports?type=ticket', '/api/portfolio/agents', '/api/expert-ref', '/api/monthly-summary']) {
      assert.equal((await call('GET', url, undefined, qcToken)).status, 200, url);
    }
    const prof = await call('GET', '/api/portfolio?ident=' + encodeURIComponent('کارشناس الف'), undefined, qcToken);
    assert.equal(prof.status, 200, 'پرونده‌ی کارشناس مجاز باز می‌شود');
    const profDenied = await call('GET', '/api/portfolio?ident=' + encodeURIComponent('کارشناس بدون ریت'), undefined, qcToken);
    assert.equal(profDenied.status, 404, 'پرونده‌ی کارشناس خارج از دسترسی یافت نمی‌شود');
    const scopedSummary = await call('GET', '/api/monthly-summary', undefined, qcToken);
    assert.deepEqual([...new Set(scopedSummary.data.rows.map((r) => r.agent))], ['کارشناس الف'],
      'خلاصه‌ی ماهانه هم محدود به دسترسی کارشناس QC است');
  });

  await t.test('کارشناس QC فقط برای کارشناسان مجاز خود ارزیابی ثبت/ویرایش می‌کند', async () => {
    const blocked = await call('POST', '/api/tickets', ticketBody('کارشناس بدون ریت', 'T-X', '1405/06/20'), qcToken);
    assert.equal(blocked.status, 403);
    assert.ok(blocked.data.error.includes('دسترسی ندارید'), blocked.data.error);
    assert.equal((await call('POST', '/api/socials', socialBody('کارشناس بدون ریت', '1405/06/20'), qcToken)).status, 403);
    assert.equal((await call('PUT', '/api/tickets/3', { comment: 'دست‌کاری' }, qcToken)).status, 403,
      'ویرایش رکورد کارشناس دیگر');
    assert.equal((await call('DELETE', '/api/tickets/3', undefined, qcToken)).status, 403);

    const allowed = await call('POST', '/api/tickets', { ...ticketBody('کارشناس الف', 'T-QC', '1405/06/20'), qcAgent: 'مبینا' }, qcToken);
    assert.equal(allowed.status, 200);
    assert.equal(allowed.data.qcAgent, 'مبینا');
    assert.equal(allowed.data.ticketCode, 'T-QC');
    assert.equal(allowed.data.team, 'Tele Sales', 'تیم از فهرست کارشناسان پر می‌شود');
    const mine = await call('GET', '/api/tickets?search=T-QC', undefined, qcToken);
    assert.equal(mine.data.total, 1, 'رکورد تازه در فهرست همان کارشناس دیده می‌شود');
    assert.equal((await call('GET', '/api/tickets?search=T-3', undefined, qcToken)).data.total, 0,
      'رکورد خارج از دسترسی در جستجو هم نمی‌آید');
  });

  await t.test('کار همزمان چند کارشناس: تعارض → ۴۰۹ با نسخه‌ی فعلی، سپس بازنویسی آگاهانه (بند ۱۰)', async () => {
    const row = (await call('GET', '/api/tickets?search=T-QC', undefined, adminToken)).data.rows[0];
    assert.ok(row.updatedAt, 'هر رکورد زمان ویرایش دارد');

    /* نفر دوم (مدیر) همان رکورد را تغییر می‌دهد */
    const other = await call('PUT', '/api/tickets/' + row.id, { ...ticketBody('کارشناس الف', 'T-QC', '1405/06/20'), qcAgent: 'هادی', comment: 'ویرایش نفر دوم' }, adminToken);
    assert.equal(other.status, 200);
    assert.notEqual(other.data.updatedAt, row.updatedAt);

    const stale = await call('PUT', '/api/tickets/' + row.id,
      { ...ticketBody('کارشناس الف', 'T-QC', '1405/06/20'), qcAgent: 'مبینا', comment: 'ویرایش نفر اول', baseUpdatedAt: row.updatedAt }, qcToken);
    assert.equal(stale.status, 409);
    assert.ok(stale.data.conflict && stale.data.conflict.current, 'نسخه‌ی فعلی رکورد به کلاینت برمی‌گردد');
    assert.equal(stale.data.conflict.current.comment, 'ویرایش نفر دوم');
    assert.ok(stale.data.error.includes('ویرایش شده است'), stale.data.error);

    const fresh = (await call('GET', '/api/tickets/' + row.id, undefined, qcToken)).data;
    const okWrite = await call('PUT', '/api/tickets/' + row.id,
      { ...ticketBody('کارشناس الف', 'T-QC', '1405/06/20'), qcAgent: 'مبینا', comment: 'با نسخه‌ی تازه', baseUpdatedAt: fresh.updatedAt }, qcToken);
    assert.equal(okWrite.status, 200, 'با baseUpdatedAt به‌روز، ذخیره بدون پرسش انجام می‌شود');

    const forced = await call('PUT', '/api/tickets/' + row.id,
      { ...ticketBody('کارشناس الف', 'T-QC', '1405/06/20'), qcAgent: 'مبینا', comment: 'بازنویسی', baseUpdatedAt: row.updatedAt, overwrite: true }, qcToken);
    assert.equal(forced.status, 200, 'کاربر می‌تواند آگاهانه تغییرات خودش را جایگزین کند');
    assert.equal(forced.data.comment, 'بازنویسی');

    const noBase = await call('PUT', '/api/tickets/' + row.id, { ...ticketBody('کارشناس الف', 'T-QC', '1405/06/20'), qcAgent: 'مبینا' }, qcToken);
    assert.equal(noBase.status, 200, 'فرم‌های بدون baseUpdatedAt هم کار می‌کنند');

    /* همان منطق برای سوشال */
    const social = (await call('GET', '/api/socials', undefined, adminToken)).data.rows[0];
    const sClash = await call('PUT', '/api/socials/' + social.id, { ...socialBody(social.agentName, social.reviewDate), baseUpdatedAt: '2000-01-01T00:00:00.000Z' }, adminToken);
    assert.equal(sClash.status, 409);
    assert.ok(sClash.data.conflict.current.id === social.id);
    const sForce = await call('PUT', '/api/socials/' + social.id, { ...socialBody(social.agentName, social.reviewDate), baseUpdatedAt: '2000-01-01T00:00:00.000Z', overwrite: true }, adminToken);
    assert.equal(sForce.status, 200);
  });

  await t.test('بازه‌ی آماده‌ی ماه مالی روی سرور/شیت ذخیره و خوانده می‌شود (بند ۲)', async () => {
    const badDate = await call('PUT', '/api/fiscal-months', { months: [{ name: 'x', from: '1404/13/40', to: fx.current.to }] }, adminToken);
    assert.equal(badDate.status, 400);
    assert.ok(badDate.data.error.includes('نامعتبر'), badDate.data.error);
    assert.equal((await call('PUT', '/api/fiscal-months', { months: [{ from: fx.current.from, to: fx.current.to }] }, adminToken)).status, 400,
      'نام ماه مالی الزامی است');

    const saved = await call('PUT', '/api/fiscal-months', { months: [fx.current, fx.previous] }, adminToken);
    assert.equal(saved.status, 200);
    assert.deepEqual(saved.data.months.map((m) => m.name), ['دوره قبل', 'دوره جاری'], 'مرتب‌سازی بر اساس شروع');
    assert.ok(saved.data.months[0].id);

    const read = await call('GET', '/api/fiscal-months', undefined, adminToken);
    assert.equal(read.status, 200);
    assert.equal(read.data.current.name, 'دوره جاری');
    assert.equal(read.data.previous.name, 'دوره قبل');
    assert.deepEqual(read.data.options.map((o) => o.value).slice(0, 2), ['fm:cur', 'fm:prev']);
    assert.equal(read.data.months.length, 2);

    /* ردیف وارونه‌ای که مستقیم روی شیت نوشته شده نادیده گرفته می‌شود */
    const dirty = await call('PUT', '/api/fiscal-months', { months: [fx.current, { name: 'وارونه', from: fx.previous.to, to: fx.previous.from }] }, adminToken);
    assert.equal(dirty.data.months.length, 1);

    await call('PUT', '/api/fiscal-months', { months: [fx.current, fx.previous] }, adminToken);
    const id = (await call('GET', '/api/fiscal-months', undefined, adminToken)).data.months[0].id;
    const deleted = await call('DELETE', '/api/fiscal-months/' + id, undefined, adminToken);
    assert.equal(deleted.status, 200);
    assert.equal(deleted.data.months.length, 1);

    const boot = await call('GET', '/api/bootstrap', undefined, adminToken);
    assert.equal(boot.data.fiscalMonths.length, 1, 'بازه‌های آماده همراه bootstrap به کلاینت می‌رسند');

    /* پیش‌فرض بازه می‌تواند ماه مالی باشد */
    const preset = await call('PUT', '/api/settings', { defaultPreset: 'fm:cur' }, adminToken);
    assert.equal(preset.data.defaultPreset, 'fm:cur');
    await call('PUT', '/api/settings', { defaultPreset: 'all' }, adminToken);
  });

  await t.test('تغییر المان‌ها: ردیف‌های تخت Elements ↔ پیکربندی معیارها (بند ۹)', async () => {
    const seeded = await call('PUT', '/api/criteria', {
      form: 'tele',
      elements: [
        { key: 'q1', label: 'پیگیری صحیح', excelKey: 'Q1', active: true },
        { key: 'q2', label: 'ثبت یادداشت', excelKey: 'Q2', active: true }
      ]
    }, adminToken);
    assert.equal(seeded.status, 200);
    assert.equal(seeded.data.config.version, 1);
    assert.equal((await call('PUT', '/api/criteria', { form: 'tele', elements: 'not-a-list' }, adminToken)).status, 400);
    assert.equal((await call('GET', '/api/elements', undefined, qcToken)).status, 403);

    const roundTripRows = (rows) => rows.filter((r) => r.scope === 'form' && r.form === 'tele');
    const flat = await call('GET', '/api/elements', undefined, adminToken);
    assert.equal(flat.status, 200);
    const teleRows = flat.data.rows.filter((r) => r.scope === 'form' && r.form === 'tele');
    const q1Row = teleRows.find((r) => r.key === 'q1'), q2Row = teleRows.find((r) => r.key === 'q2');
    assert.ok(q1Row && q2Row, 'هر المان یک ردیف روی تب Elements دارد');
    assert.equal(q1Row.active, 1);
    assert.equal(q2Row.order > 0, true);
    assert.deepEqual([...flat.data.teams].sort(), ['Account', 'Tele Sales'], 'فهرست تیم‌ها برای ردیف‌های team-scope');
    assert.equal(flat.data.version, 1);
    assert.equal(q1Row.excelKey, 'Q1');
    assert.equal(q1Row.label, 'پیگیری صحیح');
    assert.ok(roundTripRows(flat.data.rows).length >= 2);

    /* همان کاری که Server.gs پس از ویرایش مستقیم ردیف‌ها روی شیت انجام می‌دهد */
    const edited = flat.data.rows.map((r) => (r.key === 'q1' ? { ...r, label: 'پیگیری (از شیت)', excelKey: 'Q1_SHEET' } : r));
    const cfg = Elements.rowsToCriteria(edited, seeded.data.config);
    assert.deepEqual(cfg.forms.tele[0].aliases, ['Q1']);

    const stalePut = await call('PUT', '/api/criteria', { form: 'tele', elements: cfg.forms.tele, version: 99 }, adminToken);
    assert.equal(stalePut.status, 409, 'ویرایش همزمان با نسخه‌ی کهنه رد می‌شود');

    const applied = await call('PUT', '/api/criteria', { form: 'tele', elements: cfg.forms.tele, version: 1 }, adminToken);
    assert.equal(applied.status, 200);
    assert.equal(applied.data.config.version, 2);
    const after = (await call('GET', '/api/criteria', undefined, adminToken)).data.config;
    assert.equal(after.forms.tele[0].label, 'پیگیری (از شیت)');
    assert.equal(after.forms.tele[0].excelKey, 'Q1_SHEET');
    assert.ok(after.forms.tele[0].aliases.includes('Q1'), 'ستون قدیمی اکسل در aliases می‌ماند');
    assert.equal(after.forms.tele[1].excelKey, 'Q2', 'المان‌های دست‌نخورده حفظ می‌شوند');

    const roundTrip = await call('GET', '/api/elements', undefined, adminToken);
    const afterRow = roundTripRows(roundTrip.data.rows).find((r) => r.key === 'q1');
    assert.equal(afterRow.excelKey, 'Q1_SHEET');
    assert.equal(afterRow.aliases, 'Q1', 'ستون اکسل قبلی روی شیت به aliases منتقل شده');
    assert.equal(roundTrip.data.version, 2);

    /* المان team-scope هم از همان ردیف‌ها ساخته می‌شود */
    const teamPut = await call('PUT', '/api/criteria', {
      team: 'Tele Sales', form: 'tele',
      elements: [{ key: 'c1', label: 'شروع تماس', excelKey: 'Call_opening_quality', active: true }],
      version: 2
    }, adminToken);
    assert.equal(teamPut.status, 200);
    const withTeam = await call('GET', '/api/elements', undefined, adminToken);
    assert.ok(withTeam.data.rows.some((r) => r.scope === 'team' && r.team === 'Tele Sales' && r.key === 'c1'));
  });

  await t.test('خلاصه‌ی ماهانه و شماره‌ی بازنگری برای همگام‌سازی خودکار (بندهای ۸ و ۱۰)', async () => {
    const rev0 = (await call('GET', '/api/revision')).data.revision;
    assert.ok(Number.isFinite(rev0) && rev0 > 0, 'revision بدون نشست هم خوانده می‌شود');

    const summary = await call('GET', '/api/monthly-summary', undefined, adminToken);
    assert.equal(summary.status, 200);
    assert.equal(summary.data.count, summary.data.rows.length);
    assert.ok(summary.data.rows.length >= 2);
    assert.deepEqual(summary.data.months, ['1405/06']);
    assert.ok(summary.data.generatedAt);
    const ranged = await call('GET', '/api/monthly-summary?from=1405/06/21&to=1405/06/21', undefined, adminToken);
    assert.ok(ranged.data.count < summary.data.count, 'بازه‌ی محدودتر → ردیف کمتر');

    const rev1 = (await call('GET', '/api/revision')).data.revision;
    assert.equal(rev1, rev0, 'خواندن‌ها نسخه را بالا نمی‌برند');
    await call('POST', '/api/tickets', ticketBody('کارشناس الف', 'T-REV', '1405/06/20'), adminToken);
    const rev2 = (await call('GET', '/api/revision')).data.revision;
    assert.ok(rev2 > rev1, 'پس از هر نوشتن، شماره‌ی بازنگری بالا می‌رود تا بقیه به‌روز شوند');
    const boot = await call('GET', '/api/bootstrap', undefined, adminToken);
    assert.equal(boot.data.revision, rev2, 'bootstrap هم همان نسخه را می‌دهد');
  });

  await t.test('خروج کاربر و حالت‌های ورود (auto/on/off)', async () => {
    const out = await call('POST', '/api/auth/logout', { token: qcToken }, qcToken);
    assert.equal(out.status, 200);
    const afterLogout = await call('GET', '/api/bootstrap', undefined, qcToken);
    assert.equal(afterLogout.data.auth.user, null, 'توکن خارج‌شده دیگر کاربری ندارد');
    assert.deepEqual(afterLogout.data.agents, []);
    assert.equal((await call('GET', '/api/settings', undefined, qcToken)).status, 401, 'توکن خارج‌شده باطل است');
    assert.equal((await call('POST', '/api/auth/login', { name: 'مبینا', password: 'qc-1234' })).status, 200, 'ورود دوباره ممکن است');

    assert.equal((await call('PUT', '/api/settings', { authMode: 'off' }, adminToken)).status, 200);
    const openBoot = await call('GET', '/api/bootstrap');
    assert.equal(openBoot.data.auth.required, false);
    assert.equal(openBoot.data.auth.mode, 'off');
    assert.equal(openBoot.data.counts.tickets, 5, 'با ورود خاموش، داده کامل بدون رمز می‌آید');
    assert.equal(openBoot.data.qcUsers, undefined);

    assert.equal((await call('PUT', '/api/settings', { authMode: 'on' }, adminToken)).status, 200);
    const onBoot = await call('GET', '/api/bootstrap');
    assert.equal(onBoot.data.auth.required, true);
    assert.deepEqual(onBoot.data.agents, []);
    assert.equal((await call('PUT', '/api/settings', { authMode: 'junk' }, adminToken)).data.authMode, 'on', 'مقدار نامعتبر نادیده گرفته می‌شود');
    assert.equal((await call('PUT', '/api/settings', { authMode: 'auto' }, adminToken)).data.authMode, 'auto');
    /* با authMode=off محدودیت داده هم برداشته می‌شود */
    await call('PUT', '/api/settings', { authMode: 'off' }, adminToken);
    const openTickets = await call('GET', '/api/tickets');
    assert.equal(openTickets.data.total, 5);
    await call('PUT', '/api/settings', { authMode: 'auto' }, adminToken);
  });
});

/* ========================================================================== *
 * ۳) مرورگر — دروازه‌ی ورود، مدیریت QC، بازه‌ی ماه مالی و لانچر گزارش تماس
 * ========================================================================== */

for (const build of ['public', 'offline']) {
  test(build + ': ورود با رمز، صفحه‌ی مدیریت QC، بازه‌ی ماه مالی و گزارش تماس بدون iframe تودرتو', async (t) => {
    const dir = build === 'public' ? path.join(ROOT, 'public') : path.join(ROOT, '..', 'HTML اصلی');
    const env = browser(build), { w, dom, errors } = env;
    t.after(() => dom.window.close());
    const doc = w.document;
    const $ = (s) => doc.querySelector(s);
    const txt = (s) => ($(s) ? $(s).textContent.trim() : '');
    const nav = (route) => doc.querySelector('[data-route="' + route + '"]');
    const fx = fiscalFixture();
    const login = async (name, password) => {
      await w.QCAuth.logout().catch(() => {});
      await w.QCAuth.login(name, password);
      await w.App.onAuthReady();
      await settle();
    };

    /* مرورگر با داده‌ی seed بالا می‌آید: ۳ تیکت (۲ تا برای «کارشناس الف») و ۳ سوشال */
    const seedCounts = { tickets: fixture().tickets.length, socials: fixture().socials.length };
    /* بدون کاربر: مثل قبل بدون ورود باز می‌شود */
    await w.App.init();
    await settle();
    assert.equal(doc.body.classList.contains('auth-locked'), false);
    assert.equal($('#authGate').hidden, true);
    assert.equal(w.QCAuth.required, false);
    assert.equal(nav('qcadmin').hidden, false, 'پیش از فعال‌شدن ورود همه‌ی صفحه‌ها بازند');

    await t.test('دروازه‌ی ورود: ساخت مدیر، ورود، نام کاربر در نوار بالا', async () => {
      await w.LocalApi.run('POST', '/api/auth/setup', { name: 'مدیر سیستم', password: 'admin-1234' });
      await w.QCAuth.ensure();
      assert.equal(w.QCAuth.required, true);
      assert.equal(w.QCAuth.firstRun, false);
      assert.deepEqual([...w.QCAuth.accounts].map((a) => a.name), ['مدیر سیستم']);
      assert.equal(w.QCAuth.user, null, 'پیش از ورود کاربری فعال نیست');

      await w.QCAuth.login('مدیر سیستم', 'admin-1234');
      await w.App.onAuthReady();
      await settle();
      assert.equal(w.QCAuth.user.role, 'admin');
      assert.equal(w.QCAuth.isAdmin, true);
      assert.equal(doc.body.classList.contains('auth-locked'), false);
      assert.equal($('#authGate').hidden, true);
      assert.ok(txt('#userChip').includes('مدیر سیستم'), 'نام کاربر در نوار بالا: ' + txt('#userChip'));
      assert.ok($('#userChip').classList.contains('admin'));
      assert.ok(w.localStorage.getItem('crmqc.auth.v1'), 'نشست در localStorage می‌ماند');
      assert.equal(w.LocalApi.getSession().name, 'مدیر سیستم', 'نشست به LocalApi هم داده می‌شود');
      assert.equal(nav('qcadmin').hidden, false);
      assert.equal(nav('criteria').hidden, false);
      assert.equal(w.App.state.counts.tickets, seedCounts.tickets);
    });

    await t.test('دروازه‌ی ورود با رمز نادرست بسته می‌ماند', async () => {
      await w.QCAuth.logout();
      await settle();
      assert.equal(doc.body.classList.contains('auth-locked'), true);
      w.QCAuth.showGate();
      await settle();
      $('#authName').value = 'مدیر سیستم';
      $('#authPass').value = 'اشتباه';
      $('#authForm').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
      await settle(); await settle();
      assert.equal($('#authError').hidden, false);
      assert.ok($('#authError').textContent.includes('رمز'), $('#authError').textContent);
      assert.equal(doc.body.classList.contains('auth-locked'), true, 'هنوز قفل است');
      $('#authPass').value = 'admin-1234';
      $('#authForm').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
      await settle(); await settle(); await settle();
      assert.equal(doc.body.classList.contains('auth-locked'), false, 'با رمز درست باز می‌شود');
      assert.equal(w.QCAuth.user.role, 'admin');
    });

    await t.test('صفحه‌ی مدیریت QC: حالت ورود، فهرست کاربران و ساخت کاربر جدید', async () => {
      await go(w, 'qcadmin');
      await settle(); await settle();
      assert.equal(doc.querySelectorAll('.qc-mode-option input[name="authMode"]').length, 3, 'auto/on/off');
      assert.equal(doc.querySelector('.qc-mode-option input[value="auto"]').checked, true);
      assert.ok(txt('.qc-mode-card').includes('خودکار'));
      assert.ok($('#qcAdd') && $('#qcExport'), 'دکمه‌های ساخت کاربر و خروجی اکسل');
      assert.equal(doc.querySelectorAll('.qc-users tbody tr').length, 1);
      assert.ok(txt('.qc-users').includes('مدیر سیستم'));
      assert.ok(doc.querySelector('.qc-users .badge.brand'), 'نقش مدیر با نشان مشخص');
      assert.ok(txt('#content').includes('QC_Users'), 'راهنمای تب شیت در صفحه');

      /* فرم ساخت کاربر QC: نقش، رمز، فعال و انتخاب کارشناسان مجاز */
      $('#qcAdd').click();
      await settle();
      assert.ok($('#quName') && $('#quRole') && $('#quPass') && $('#quActive') && $('#quSave'));
      assert.ok($('#quUnlimited'), 'گزینه‌ی «همه‌ی کارشناسان»');
      /* ساختار تازه: فهرست تخت و همیشه تیک‌خور، فیلتر تیم با چیپ
       * (گروه‌های تودرتو حذف شدند تا کارشناس‌ها گم نشوند) */
      const teamChips = [...doc.querySelectorAll('#quTeams .qc-team-chip')];
      assert.ok(teamChips.length >= 3, 'تیم‌ها به‌شکل چیپ فیلتر می‌شوند: ' + teamChips.length);
      const rows = () => [...doc.querySelectorAll('#quList .qc-row')];
      assert.ok(rows().length >= 4, 'هر کارشناس یک ردیف');
      assert.equal(doc.querySelectorAll('#quList .qc-row input[type="checkbox"]').length, rows().length,
        'هر ردیف چک‌باکس دارد');
      assert.equal(doc.querySelectorAll('#quPicker').length, 1, 'فقط یک ناحیهٔ انتخاب');
      assert.ok($('#quPicked'), 'ناحیهٔ نمایش انتخاب‌شده‌ها');
      const rowOf = (name) => doc.querySelector('#quList .qc-row[data-name="' + name + '"]');

      /* تیک‌زدن واقعی: کلیک روی چک‌باکس و کلیک روی خود ردیف */
      rowOf('کارشناس الف').querySelector('input').click();
      await settle();
      assert.equal(rowOf('کارشناس الف').querySelector('input').checked, true, 'چک‌باکس تیک می‌خورد');
      assert.ok($('#quCount').textContent.includes('۱'), 'شمارنده: ' + $('#quCount').textContent);
      assert.ok([...doc.querySelectorAll('.qc-chip')].some((c) => c.textContent.includes('کارشناس الف')),
        'انتخاب‌شده به‌شکل چیپ نشان داده می‌شود');
      doc.querySelector('.qc-chip [data-unpick]').click();
      await settle();
      assert.equal(rowOf('کارشناس الف').querySelector('input').checked, false, 'چیپ تیک را برمی‌دارد');
      rowOf('کارشناس الف').click();
      await settle();
      assert.equal(rowOf('کارشناس الف').querySelector('input').checked, true, 'کلیک روی خود ردیف هم تیک می‌زند');

      /* انتخاب همه/هیچ روی نتایج فیلترشده */
      $('#quAll').click();
      await settle();
      assert.ok(rows().every((r) => r.querySelector('input').checked), 'انتخاب همه‌ی نتایج');
      $('#quNone').click();
      await settle();
      assert.ok(rows().every((r) => !r.querySelector('input').checked), 'پاک‌کردن نتایج');

      /* فیلتر تیم: فقط کارشناسان همان تیم می‌مانند */
      const teamKey = rowOf('کارشناس الف').dataset.team;
      const teamChip = teamChips.find((c) => c.dataset.team === teamKey);
      assert.ok(teamChip, 'چیپ تیم کارشناس الف');
      teamChip.click();
      await settle();
      assert.ok(rows().length >= 1 && rows().every((r) => r.dataset.team === teamKey), 'فیلتر تیم اعمال شد');
      assert.ok(doc.querySelector('#quTeams .qc-team-chip[data-team="' + teamKey + '"]').classList.contains('sel'),
        'چیپ تیم انتخاب‌شده است');
      doc.querySelector('#quTeams .qc-team-chip[data-team=""]').click();
      await settle();
      assert.ok(rows().length >= 4, 'برداشتن فیلتر، همه را برمی‌گرداند');

      /* جستجو فقط فیلتر می‌کند؛ تیک‌ها حفظ می‌شوند */
      rowOf('کارشناس الف').querySelector('input').click();
      await settle();
      $('#quSearch').value = 'کارشناس الف';
      $('#quSearch').dispatchEvent(new w.Event('input', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 160));
      await settle();
      assert.ok(rows().length >= 1 && rows().every((r) => r.dataset.name === 'کارشناس الف'), 'جستجو نتیجه را محدود می‌کند');
      assert.equal(rowOf('کارشناس الف').querySelector('input').checked, true, 'تیک بعد از جستجو حفظ می‌شود');
      $('#quSearch').value = '';
      $('#quSearch').dispatchEvent(new w.Event('input', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 160));
      await settle();
      assert.ok(rows().length >= 4, 'با خالی‌شدن جستجو همه برمی‌گردند');

      /* گزینهٔ نامحدود فهرست را بی‌اثر و کم‌رنگ می‌کند */
      $('#quUnlimited').checked = true;
      $('#quUnlimited').dispatchEvent(new w.Event('change', { bubbles: true }));
      await settle();
      assert.equal($('#quPicker').classList.contains('off'), true, 'با دسترسی نامحدود فهرست بی‌اثر می‌شود');
      $('#quUnlimited').checked = false;
      $('#quUnlimited').dispatchEvent(new w.Event('change', { bubbles: true }));
      await settle();
      assert.equal($('#quPicker').classList.contains('off'), false);

      $('#quName').value = 'مبینا';
      $('#quPass').value = 'qc-1234';
      $('#quExtraExt').value = '101';
      $('#quSave').click();
      await settle(); await settle(); await settle();
      const users = (await w.LocalApi.run('GET', '/api/qc-users')).users;
      assert.equal(users.length, 2, 'کاربر QC ساخته شد');
      assert.equal(users[1].name, 'مبینا');
      assert.deepEqual([...users[1].exts], ['101']);
      assert.equal(users[1].password, '••••••');
      assert.equal(doc.querySelectorAll('.qc-users tbody tr').length, 2, 'فهرست کاربران به‌روز شد');

      /* تیک‌ها روی ستون qcAgents ردیف کارشناسان (تب Agents) هم می‌نشینند */
      const synced = await w.LocalApi.run('GET', '/api/agents');
      assert.deepEqual([...(synced.find((a) => a.name === 'کارشناس الف').qcAgents || [])], ['مبینا'],
        'ستون qcAgents برای کارشناس تیک‌خورده پر شد');
      assert.deepEqual([...(synced.find((a) => a.name === 'کارشناس ب').qcAgents || [])], [],
        'کارشناس تیک‌نخورده در ستون نمی‌آید');
    });

    await t.test('ورود کارشناس QC: صفحه‌های مدیریتی پنهان و داده محدود می‌شود', async () => {
      await login('مبینا', 'qc-1234');
      assert.equal(w.QCAuth.user.role, 'qc');
      assert.equal(w.QCAuth.isAdmin, false);
      for (const route of ['criteria', 'directory', 'agents', 'data', 'qcadmin']) {
        assert.equal(nav(route).hidden, true, route + ' برای کارشناس QC پنهان است');
      }
      for (const route of ['dashboard', 'tickets', 'tickets-new', 'socials', 'reports', 'portfolio', 'callreport']) {
        assert.equal(nav(route).hidden, false, route + ' برای کارشناس QC باز است');
      }
      assert.equal(w.QCAuth.can('qcadmin'), false);
      assert.equal(w.QCAuth.can('dashboard'), true);
      assert.equal(w.App.auth.user.name, 'مبینا');
      assert.deepEqual([...w.App.state.agents].map((a) => a.name), ['کارشناس الف']);
      assert.equal(w.App.state.counts.tickets, 2, 'فقط تیکت‌های کارشناس مجاز');
      assert.equal(w.App.state.counts.socials, 2);
      assert.equal(w.App.state.qcUsers, undefined);
      assert.ok(txt('#userChip').includes('مبینا'));
      assert.ok(!$('#userChip').classList.contains('admin'));

      const tickets = await w.LocalApi.run('GET', '/api/tickets');
      assert.deepEqual([...tickets.rows].map((r) => r.ticketCode).sort(), ['T-1', 'T-2']);

      /* مسیر مدیریتی حتی با دستی‌نوشتن hash هم باز نمی‌شود */
      w.location.hash = '#/qcadmin';
      await w.App.route();
      await settle();
      assert.ok(txt('#content').includes('دسترسی ندارید'), 'صفحه‌ی مدیریتی برای کارشناس QC رندر نمی‌شود');
      assert.equal(doc.querySelectorAll('#content .qc-users').length, 0);
    });

    await t.test('ثبت ارزیابی: نام کارشناس QC قفل می‌شود و تقویم/پیشنهاد نام فعال است (بند ۷)', async () => {
      await go(w, 'tickets/new');
      await settle();
      const fields = [...doc.querySelectorAll('#content .field')];
      const labels = fields.map((f) => (f.firstElementChild ? f.firstElementChild.textContent : ''));
      const qcField = fields.find((f, i) => labels[i].includes('کنترل کیفیت'));
      assert.ok(qcField, 'فیلد کارشناس QC در فرم تیکت — ' + labels.join(' | '));
      const sel = qcField.querySelector('select');
      assert.ok(sel, 'کارشناس QC یک فهرست انتخابی است');
      assert.equal(sel.value, 'مبینا', 'نام کاربر واردشده پیش‌فرض می‌شود');
      assert.equal(sel.disabled, true, 'کارشناس QC نمی‌تواند به نام دیگری ثبت کند');
      assert.ok(qcField.textContent.includes('به‌عنوان'), qcField.textContent.slice(-90));

      const review = fields.find((f, i) => labels[i].includes('تاریخ بررسی'));
      assert.ok(review, 'فیلد تاریخ بررسی');
      assert.ok(review.querySelector('button'), 'دکمه‌ی تقویم کنار فیلد تاریخ');

      /* نام کارشناس: کمبو با پیشنهاد و پیمایش با کیبورد */
      const agentField = fields.find((f, i) => labels[i].includes('نام کارشناس'));
      assert.ok(agentField, 'فیلد نام کارشناس');
      const agentInput = agentField.querySelector('input');
      agentInput.value = 'کارشناس';
      agentInput.dispatchEvent(new w.Event('input', { bubbles: true }));
      await settle();
      assert.ok(agentField.querySelectorAll('.menu-item').length >= 1, 'نزدیک‌ترین نام‌ها پیشنهاد می‌شوند');
      assert.ok(agentField.querySelector('.menu-item mark'), 'قسمت مطابقت‌یافته هایلایت می‌شود');
      agentInput.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
      await settle();
      assert.ok(agentField.querySelector('.menu-item.hl'), 'با کلید پایین، گزینه برجسته می‌شود');
      agentInput.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await settle();
      assert.equal(agentInput.value, 'کارشناس الف', 'Enter نام برجسته را انتخاب می‌کند');

      /* برای مدیر قفل نیست */
      await login('مدیر سیستم', 'admin-1234');
      await go(w, 'tickets/new');
      await settle();
      const adminFields = [...doc.querySelectorAll('#content .field')];
      const adminQc = adminFields.find((f) => f.firstElementChild && f.firstElementChild.textContent.includes('کنترل کیفیت'));
      assert.equal(adminQc.querySelector('select').disabled, false, 'مدیر می‌تواند به نام هر کارشناس QC ثبت کند');
      assert.equal(adminQc.querySelector('select').value, 'مدیر سیستم', 'پیش‌فرض همان کاربر واردشده است');
    });

    await t.test('بازه‌ی آماده‌ی ماه مالی در نوار بالا، بدون دکمه‌ی «اعمال بازه» (بند ۲)', async () => {
      await w.LocalApi.run('PUT', '/api/fiscal-months', { months: [fx.current, fx.previous] });
      await w.App.onAuthReady();
      await settle();
      assert.equal(w.App.fiscalMonths.length, 2);
      assert.equal($('#gApply'), null, 'دکمه‌ی «اعمال بازه» حذف شده است');
      assert.ok($('#gFromBtn') && $('#gToBtn'), 'تقویم جلالی کنار هر دو فیلد تاریخ');
      const preset = $('#gPreset');
      const values = Array.from(preset.options).map((o) => o.value);
      assert.ok(values.includes('fm:cur') && values.includes('fm:prev'), values.join(','));
      assert.ok(values.some((v) => /^fm:fm/.test(v)), 'هر ماه مالی یک گزینه‌ی جدا دارد');
      assert.ok($('#gFiscalGroup') && !$('#gFiscalGroup').hidden, 'گروه «ماه مالی» در dropdown');
      assert.ok(preset.closest('.range-bar'), 'نوار بازه ساختار مرتب دارد');
      assert.ok($('.range-fields') && $('.range-tools'), 'فیلدها و ابزارها جدا چیده شده‌اند');

      const cur = w.App.presetRange('fm:cur'), prev = w.App.presetRange('fm:prev');
      assert.deepEqual({ from: cur.from, to: cur.to, preset: cur.preset },
        { from: fx.current.from, to: fx.current.to, preset: 'fm:cur' });
      assert.deepEqual({ from: prev.from, to: prev.to, preset: prev.preset },
        { from: fx.previous.from, to: fx.previous.to, preset: 'fm:prev' });

      preset.value = 'fm:prev';
      preset.dispatchEvent(new w.Event('change', { bubbles: true }));
      await settle(); await settle();
      assert.equal(w.App.dateRange.from, fx.previous.from);
      assert.equal(w.App.dateRange.to, fx.previous.to);
      assert.equal($('#gFrom').value, fx.previous.from, 'فیلدهای تاریخ با بازه‌ی آماده پر می‌شوند');
      assert.equal($('#gTo').value, fx.previous.to);
      assert.ok(txt('#gRangeNote').includes('دوره قبل'), 'یادداشت بازه نام ماه مالی را نشان می‌دهد: ' + txt('#gRangeNote'));
      assert.equal(JSON.parse(w.localStorage.getItem('crmqc.dateRange.v1@مدیر سیستم')).preset, 'fm:prev',
        'تنظیمات بازه هر کاربر جدا ذخیره می‌شود (بند ۱۰)');

      /* submit/Enter هم بازه را اعمال می‌کند */
      $('#gFrom').value = fx.current.from; $('#gTo').value = fx.current.to;
      $('#globalRange').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
      await settle(); await settle();
      assert.equal(w.App.dateRange.from, fx.current.from);
      assert.equal($('#gPreset').value, 'custom');
      $('#gReset').click();
      await settle(); await settle();
      assert.equal(w.App.dateRange.from, '', 'بازنشانی به همه‌ی تاریخ‌ها');
    });

    await t.test('ویرایشگر ماه مالی در صفحه‌ی مدیریت پایه', async () => {
      await go(w, 'directory');
      await settle(); await settle();
      assert.ok(txt('#content').includes('ماه مالی'), 'کارت ماه‌های مالی در مدیریت پایه');
      const rows = doc.querySelectorAll('#content .fm-tbl tbody tr');
      assert.equal(rows.length, 2, 'دو ردیف ماه مالی نمایش داده می‌شود');
      assert.ok(txt('#content').includes('Fiscal_Months'), 'راهنمای تب شیت');
    });

    await t.test('گزارش تماس: در Node فریم هم‌ریشه و در Apps Script داخل خود سامانه (srcdoc)', async () => {
      await go(w, 'callreport');
      await settle();
      assert.equal(doc.querySelectorAll('#content iframe').length, 1);
      assert.ok($('#crFrame') && $('#crWrap') && $('#crNewTab'), 'فریم و دکمه‌ی تب جدید');
      assert.ok($('#crFrame').getAttribute('src').includes('call-admin-report.html'));

      /* همان صفحه در حالت Apps Script: ابزار از google.script.run گرفته و در
       * یک فریم محلی (srcdoc) نشان داده می‌شود؛ دیگر لازم نیست /exec باز شود. */
      w.APP_SCRIPT_MODE = true;
      w.APP_SCRIPT_URL = 'https://script.google.com/macros/s/AKfyc/exec';
      let asked = 0;
      w.google = { script: { run: (() => {
        const api = {
          _ok: null, _fail: null,
          withSuccessHandler(fn) { api._ok = fn; return api; },
          withFailureHandler(fn) { api._fail = fn; return api; },
          getCallReportHtml() {
            asked++;
            setTimeout(() => { if (api._ok) api._ok('<html><head><title>گزارش تماس</title></head><body><div id="tool"></div></body></html>'); }, 0);
            return api;
          }
        };
        return api;
      })() } };
      w.eval(fs.readFileSync(path.join(dir, 'pages', 'callReport.js'), 'utf8'));
      await go(w, 'dashboard'); await settle();
      await go(w, 'callreport'); await settle(); await settle();
      assert.equal(asked, 1, 'یک‌بار از Apps Script گرفته می‌شود');
      const frame = doc.querySelector('#content iframe');
      assert.ok(frame, 'فریم محلی ساخته می‌شود');
      assert.ok(String(frame.getAttribute('srcdoc')).includes('گزارش تماس'), 'srcdoc از همان HTML ابزار پر می‌شود');
      assert.ok(txt('#content').includes('بازه‌ی فعلی'), 'بازه‌ی فعال سامانه نشان داده می‌شود');
      assert.ok($('#crNewTab').getAttribute('href').includes('page=call-report'));

      await w.App.setDateRange({ from: fx.current.from, to: fx.current.to, preset: 'fm:cur' });
      await settle();
      assert.ok($('#crNewTab').getAttribute('href').includes('qcFrom='), 'بازه‌ی تاریخ هم به ابزار منتقل می‌شود');
      assert.equal(doc.querySelectorAll('#content iframe').length, 1, 'فریم تازه‌سازی/تکرار نمی‌شود');
      delete w.APP_SCRIPT_MODE; delete w.APP_SCRIPT_URL; delete w.google;
    });

    await t.test('ستون‌های QC: ویرایش از شیت/اکسل هم دسترسی می‌دهد و ویرایش کاربر ذخیره می‌شود', async () => {
      await login('مدیر سیستم', 'admin-1234');

      /* فرض: مدیر مستقیم روی تب Agents نوشته است که «کارشناس ب» را مبینا ریت می‌کند */
      const before = await w.LocalApi.run('GET', '/api/agents');
      const second = before.find((a) => a.name === 'کارشناس ب');
      await w.LocalApi.run('PUT', '/api/agents/' + second.id, { qcAgents: 'مبینا، هادی' });
      const afterEdit = (await w.LocalApi.run('GET', '/api/agents')).find((a) => a.id === second.id);
      assert.deepEqual([...afterEdit.qcAgents], ['مبینا', 'هادی'], 'نوشتهٔ دستی با جداکنندهٔ فارسی هم خوانده می‌شود');

      /* در مدیریت QC هم همان کارشناس تیک‌خورده و با برچسب «شیت» دیده می‌شود */
      await go(w, 'qcadmin');
      await settle(); await settle();
      const list = (await w.LocalApi.run('GET', '/api/qc-users')).users;
      doc.querySelector('[data-edit="' + list.findIndex((u) => u.name === 'مبینا') + '"]').click();
      await settle();
      const rowB = [...doc.querySelectorAll('#quList .qc-row')].find((r) => r.dataset.name === 'کارشناس ب');
      assert.ok(rowB, 'ردیف کارشناس ب در ویرایشگر');
      assert.equal(rowB.querySelector('input').checked, true, 'از ستون شیت تیک‌خورده می‌آید');
      assert.ok(rowB.classList.contains('from-sheet') && rowB.querySelector('.qc-row-tag'), 'برچسب «شیت»');

      /* رگرسیون: ویرایش کاربر قبلاً ذخیره نمی‌شد — تیک برداشته شده باید برداشته بماند */
      const rowA = [...doc.querySelectorAll('#quList .qc-row')].find((r) => r.dataset.name === 'کارشناس الف');
      rowA.querySelector('input').click();
      await settle();
      assert.equal(rowA.querySelector('input').checked, false);
      $('#quSave').click();
      await settle(); await settle(); await settle();
      const edited = (await w.LocalApi.run('GET', '/api/qc-users')).users.find((u) => u.name === 'مبینا');
      assert.deepEqual([...edited.exts], ['102'], 'ویرایش دسترسی ذخیره می‌شود: ' + JSON.stringify(edited.exts));
      const cols = await w.LocalApi.run('GET', '/api/agents');
      assert.deepEqual([...(cols.find((a) => a.name === 'کارشناس الف').qcAgents || [])], [], 'ستون هم همگام پاک شد');
      assert.deepEqual([...(cols.find((a) => a.name === 'کارشناس ب').qcAgents || [])], ['مبینا', 'هادی'],
        'نام دیگری که از شیت نوشته شده دست‌نخورده می‌ماند');

      /* صفحهٔ مدیریت کارشناسان: ستون جدید و ویرایش آن‌لاین */
      await go(w, 'agents');
      await settle(); await settle();
      assert.ok(txt('#agentsBody').includes('کارشناسان QC مسئول'), 'سرستون جدید در صفحهٔ کارشناسان');
      const agentRow = [...doc.querySelectorAll('#agentsBody tbody tr')].find((tr) => tr.dataset.name === 'کارشناس بدون ریت');
      assert.ok(agentRow.querySelector('[data-qc-cell]'), 'سلول انتخاب کارشناسان QC');
      assert.ok(agentRow.querySelector('[data-qc-edit]'), 'دکمه‌ی انتخاب (بدون ورودی ویرگولی)');
      assert.equal(agentRow.querySelector('.row-qc'), null, 'ورودی متنی حذف شده است');
      agentRow.querySelector('[data-qc-edit]').click();
      await settle();
      const pick = [...doc.querySelectorAll('#qpList .qc-pick-row')].find((r) => r.textContent.includes('هادی'));
      assert.ok(pick, 'هادی در انتخاب‌گر هست');
      pick.querySelector('input').click();
      $('#qpSave').click();
      await settle(); await settle(); await settle();
      const col3 = (await w.LocalApi.run('GET', '/api/agents')).find((a) => a.name === 'کارشناس بدون ریت');
      assert.deepEqual([...col3.qcAgents], ['هادی'], 'انتخاب با تیک ذخیره شد');

      /* فرم افزودن/ویرایش کارشناس هم انتخاب‌گر تیکی دارد */
      doc.querySelector('#agentsBody tbody tr [data-act="edit"]').click();
      await settle();
      assert.ok($('#aQcBox') && $('#aQcPick'), 'انتخاب‌گر کارشناسان QC در فرم کارشناس');
      doc.querySelector('#modalRoot .modal-back [data-close]').click();
      await settle();

      /* حذف کاربر QC → نامش از ستون همهی ردیف‌ها پاک می‌شود */
      const all = (await w.LocalApi.run('GET', '/api/qc-users')).users;
      await w.LocalApi.run('DELETE', '/api/qc-users/' + all.find((u) => u.name === 'مبینا').id);
      const cleaned = await w.LocalApi.run('GET', '/api/agents');
      assert.ok(cleaned.every((a) => !(a.qcAgents || []).includes('مبینا')), 'بعد از حذف کاربر، نامش در ستون نمی‌ماند');
      assert.deepEqual([...(cleaned.find((a) => a.name === 'کارشناس ب').qcAgents || [])], ['هادی'], 'نام دیگران حفظ می‌شود');
    });

    assert.deepEqual(errors, [], 'بدون خطای کنسول: ' + errors.slice(0, 3).join(' | '));
  });
}
