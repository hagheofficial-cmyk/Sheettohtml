/* =========================================================================
 * callWatcher.js — اتصال پوشه‌ی دیتای تماس به سامانه (تنها سمت سرور)
 *   هر WATCH_INTERVAL_MS ثانیه پوشه data/calls را بازبینی می‌کند:
 *   - qc_recovery.json      → مسیر /api/calls (recovery)
 *   - qc_<type>_form_*.xlsx → parseQc.parseRows → ستون به callFeedbacks
 *   چاپگونه‌ی ذخیره: db.callRaw + db.callFeedbacks (ادغام‌شده از همه‌ی تیم‌ها)
 *   فایل‌هایی که مرتبه‌ی mtimeشان تغییر نکند دوباره‌واره پارس نمی‌شوند.
 * ========================================================================= */
'use strict';

const fs = require('fs');
const path = require('path');
const P = require('./shared/parseQc.js');

const DIR = path.join(__dirname, 'data', 'calls');
const INTERVAL_MS = 15000;

let XLSX = null;
function lazyXLSX() {
  if (XLSX == null) {
    try { XLSX = require('xlsx'); } catch (e) { console.warn('[calls] xlsx قابل بارگذاری نیست — فرم‌های xlsx متوقف می‌ماند. npm install را اجرا کنید.'); XLSX = false; }
  }
  return XLSX || null;
}

/* ---------- نرمال‌سازی نام: فاصله‌ی نیم‌فاصه‌ی فارسی و گوذر ---------- */
function normName(s) { return P.normName(s); }

/* ---------- ادغام دیتاهای پارس‌شده در store ---------- */
/* xx باید آبجکتهایی به شکل { expertName, score, redline, redlineReason, leadName, leadPhone,
   listeningTime, qcComment, reviewDate, formType, elements } را در db.callFeedbacks ذخیره کند.
   نرمال‌سازی برای گزارش‌ها: expertName با نام کارشناسی agents هماهنگ می‌شود (trim). */
function mergeCallRows(db, rows) {
  if (!db.callFeedbacks) db.callFeedbacks = [];
  // ردیف‌های برخاسته از هر فایل که این مرتبه خوانده‌ایم را بر اساس نام‌فایل جایگزین می‌کنیم؟
  // دانین‌گ: مرجع db.callFeedbacks جامدتر است — ردیف‌های هم‌اسم را حذف و دوباره اضافه کنیم
  // تا مسیرهای تکراری فایل دیگر مشکلی پیش نیاید. همچنین تگ sourceFile بگذاریم.
  db.callFeedbacks = db.callFeedbacks.concat(rows);
}

function dedupeCallRows(db) {
  // ردیف‌های تکراری دقیقاً با همان sourceFile را یک‌بار بیشتر نگه نمی‌داریم
  const seen = new Map();
  const out = [];
  for (const r of (db.callFeedbacks || [])) {
    const key = r.sourceFile ? (r.sourceFile + '|' + (r.expertName || '') + '|' + (r.leadPhone || '') + '|' + (r.reviewDate || '')) : null;
    if (!key) { out.push(r); continue; }
    if (!seen.has(key)) { seen.set(key, 1); out.push(r); }
  }
  db.callFeedbacks = out;
}

/* ---------- خواندن یک فایل QC recovery (JSON) ---------- */
function readRecoveryFile(recPath) {
  const txt = fs.readFileSync(recPath, 'utf8');
  const obj = JSON.parse(txt);
  const tele = Array.isArray(obj.teleRawData) ? obj.teleRawData : [];
  const acc = Array.isArray(obj.accRawData) ? obj.accRawData : [];
  const mlm = Array.isArray(obj.mlmRawData) ? obj.mlmRawData : [];

  const norm = (r, formType, sourceFile) => ({
    expertName: normName(r.expertName),
    score: (typeof r.score === 'number') ? r.score : (r.score == null || r.score === '' ? null : +r.score),
    redline: P.isRedline(r.redline) ? 1 : 0,
    redlineReason: String(r.redlineReason || '').replace(/["']/g, '').trim(),
    leadName: String(r.leadName || 'نامشخص').trim(),
    leadPhone: String(r.leadPhone || '').trim(),
    listeningTime: String(r.listeningTime || '-').replace(/["']/g, '').trim() || '-',
    qcComment: String(r.qcComment || '').trim(),
    reviewDate: P.anyToJalali(r.dateRaw || r.registrationDateRaw || r.reviewDate) ? (function () { const j = P.anyToJalali(r.dateRaw || r.registrationDateRaw || r.reviewDate); return j.jy + '/' + String(j.jm).padStart(2, '0') + '/' + String(j.jd).padStart(2, '0'); })() : '',
    formType,
    elements: r.elements || {},
    actions: '',
    sourceFile
  });

  const all = [
    ...tele.map((r) => norm(r, 'tele', sourceFileObj())),
    ...acc.map((r) => norm(r, 'account', sourceFileObj())),
    ...mlm.map((r) => norm(r, 'mlm', sourceFileObj()))
  ];
  function sourceFileObj() { return 'qc_recovery.json'; }
  return { rows: all, storedActions: obj.storedActions || {}, voiceMeta: obj.voiceMeta || {}, monthlyNotices: obj.monthlyNotices || {} };
}

/* ---------- خواندن یک فرم QC اکسل ---------- */
/* ابتدا از نام فایل، سپس از محتوای ستون‌ها نوع را تشخیص می‌دهد تا هر فایلی که
 * کاربر در پوشه می‌گذارد (حتی با نام دلخواه) به تیم درست برسد. */
function readFormFile(filePath) {
  const x = lazyXLSX();
  if (!x) return null;
  const base = path.basename(filePath);
  const wb = x.readFile(filePath);
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = x.utils.sheet_to_json(sheet);
  if (!rows.length) return null;
  let type = P.formTypeOfFileName(base) || P.sniffFormType(rows);
  if (!type) return null;
  const parsed = P.parseRows(rows, type);
  if (!parsed.length) return null;
  return { rows: parsed.map((r) => Object.assign({ sourceFile: base }, r)), type, count: parsed.length };
}

/* ---------- اسکن یک‌باره‌ی پوشه ---------- */
function scanOnce(db, saveCallback, log) {
  let changed = false;
  try {
    if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true });
    const files = fs.readdirSync(DIR).filter((f) => f !== '.gitkeep' && !f.endsWith('.md'));
    const clicks = (db.callSync && db.callSync.files) || {};

    const newFiles = {};
    let delta = { added: 0, updated: 0, recovered: 0 };

    // خوانایی موجود برای همه‌ی قسمت‌ها؟ بررسی به ترتیب — ابتدا recovery (تک‌منبع)
    const recFile = files.find((f) => f === 'qc_recovery.json');
    if (recFile) {
      const st = fs.statSync(path.join(DIR, recFile));
      const sig = st.mtimeMs + ':' + st.size;
      if (clicks[recFile] !== sig) {
        try {
          const rec = readRecoveryFile(path.join(DIR, recFile));
          // حذف همه‌ی ردیف‌هایی که از همین فایل آمده‌اند
          db.callFeedbacks = (db.callFeedbacks || []).filter((r) => r.sourceFile !== recFile);
          mergeCallRows(db, rec.rows);
          db.callRaw = {
            teleRawData: rec.rows.filter((r) => r.formType === 'tele'),
            accRawData: rec.rows.filter((r) => r.formType === 'account'),
            mlmRawData: rec.rows.filter((r) => r.formType === 'mlm'),
            storedActions: rec.storedActions,
            voiceMeta_hash: undefined,
            monthlyNotices: rec.monthlyNotices
          };
          db.callImport = db.callImport || {};
          db.callImport.importedAt = new Date().toISOString();
          db.callImport.recovery = true;
          changed = true; delta.recovered = rec.rows.length;
          newFiles[recFile] = sig;
          log && log('qc_recovery.json →', rec.rows.length, 'ردیف');
        } catch (e) { console.warn('[calls] recovery نامعتبر:', e.message); }
      } else newFiles[recFile] = sig;
    }

    // سپس فرم‌های xlsx/csv — هرکدام جایگزین ردیف‌های خود فایل می‌شود
    for (const f of files) {
      if (f === recFile) continue;
      const lower = f.toLowerCase();
      if (!/\.(xlsx|xls|csv)$/.test(lower)) continue;
      const st = fs.statSync(path.join(DIR, f));
      const sig = st.mtimeMs + ':' + st.size;
      if (clicks[f] !== sig) {
        try {
          const fx = readFormFile(path.join(DIR, f));
          if (fx && fx.rows) {
            db.callFeedbacks = (db.callFeedbacks || []).filter((r) => r.sourceFile !== f);
            mergeCallRows(db, fx.rows);
            // به‌روزرسانی callRaw هم (تلاش برای همگام‌سازی اسناد خام)
            if (db.callRaw) {
              const key = fx.type === 'tele' ? 'teleRawData' : fx.type === 'account' ? 'accRawData' : 'mlmRawData';
              const fresh = fx.rows.map((r) => {
                const { sourceFile, ...rest } = r; return rest;
              });
              if (fx.type === 'tele') db.callRaw.teleRawData = fresh;
              else if (fx.type === 'account') db.callRaw.accRawData = fresh;
              else db.callRaw.mlmRawData = fresh;
            }
            changed = true; delta[fx.type] = (delta[fx.type] || 0) + fx.count;
            newFiles[f] = sig;
            log && log(base(f), fx.count + ' ردیف (' + fx.type + ')');
          }
        } catch (e) { console.warn('[calls] خطا در', f, '→', e.message); }
      } else newFiles[f] = sig;
    }

    if (changed) {
      dedupeCallRows(db);
      db.callSync = db.callSync || {};
      db.callSync.files = newFiles;
      db.callSync.syncedAt = new Date().toISOString();
      db.callImport = db.callImport || {};
      db.callImport.importedAt = db.callImport.importedAt || db.callSync.syncedAt;
      db.callImport.counts = db.callImport.counts || {};
      db.callImport.counts.total = (db.callFeedbacks || []).length;
      db.callImport.counts.tele = (db.callFeedbacks || []).filter((r) => r.formType === 'tele').length;
      db.callImport.counts.account = (db.callFeedbacks || []).filter((r) => r.formType === 'account').length;
      db.callImport.counts.mlm = (db.callFeedbacks || []).filter((r) => r.formType === 'mlm').length;
      if (saveCallback) saveCallback();
    }
    return { changed, delta };
  } catch (e) {
    console.warn('[calls] بازبینی پوشه با خطا مواجه شد:', e.message);
    return { changed: false, delta: {} };
  }
}

function base(f) { return path.basename(f); }

/* ---------- راه‌اندازی واچر (تاژو) ---------- */
let timer = null;
function start(db, saveCallback, intervalMs) {
  stop();
  // یکبار اکنون + هر INTERVAL_MS
  scanOnce(db, saveCallback, (m) => console.log('[calls]', m));
  const ms = Math.max(3000, intervalMs || INTERVAL_MS);
  timer = setInterval(() => { scanOnce(db, saveCallback); }, ms);
  timer.unref && timer.unref();
  console.log('[calls] پوشه‌ی دیتا:', DIR, '| هر', ms / 1000, 'ثانیه');
}

function stop() { if (timer) clearInterval(timer); timer = null; }

/* ---------- وضعیت پوشه برای نمایش در UI ---------- */
/* فهرست فایل‌های داخل data/calls + تعداد ردیفِ تزریق‌شده از هر کدام، وضعیت پارس،
 * و برچسب زمانی آخرین جارو — برای کارت «وضعیت پوشه» در صفحه فیدبک. */
function dirStatus(db) {
  let files = [];
  try {
    if (fs.existsSync(DIR)) files = fs.readdirSync(DIR);
  } catch (e) { /* نادیده */ }
  files = files.filter((f) => f !== '.gitkeep' && !f.endsWith('.md'));
  const synced = (db.callSync && db.callSync.files) || {};
  const countsByFile = {};
  for (const r of (db.callFeedbacks || [])) {
    if (!r.sourceFile) continue;
    countsByFile[r.sourceFile] = (countsByFile[r.sourceFile] || 0) + 1;
  }
  const out = files.map((f) => {
    let size = null, mtime = null, sig = null;
    try { const st = fs.statSync(path.join(DIR, f)); size = st.size; mtime = st.mtimeMs; sig = st.mtimeMs + ':' + st.size; } catch (e) {}
    const lower = f.toLowerCase();
    let kind = 'other';
    if (f === 'qc_recovery.json') kind = 'recovery';
    else if (/\.(xlsx|xls|csv)$/.test(lower)) kind = 'form';
    let detected = 'unknown';
    if (kind === 'form') detected = P.formTypeOfFileName(f) || '(تشخیص از محتوا)';
    if (kind === 'recovery') detected = 'tele+account+mlm';
    const rows = countsByFile[f] || 0;
    const syncedState = synced[f] === sig ? 'synced' : (synced[f] ? 'stale' : (rows ? 'synced' : 'pending'));
    return {
      name: f, kind, type: kind === 'form' ? (P.formTypeOfFileName(f) || null) : null,
      detected, size, mtime, rows, state: syncedState, skipped: kind === 'other'
    };
  });
  /* شمارش زنده از خود دیتا (نه روی متای ذخیره‌شده) تا دمو/ایمپورت دستی هم منعکس شود */
  const fb = db.callFeedbacks || [];
  const liveCounts = {
    total: fb.length,
    tele: fb.filter((r) => r.formType === 'tele').length,
    account: fb.filter((r) => r.formType === 'account').length,
    mlm: fb.filter((r) => r.formType === 'mlm').length,
    demo: fb.filter((r) => r.demo).length
  };
  return {
    dir: DIR,
    intervalSec: 15,
    syncedAt: (db.callSync && db.callSync.syncedAt) || null,
    counts: liveCounts,
    files: out.sort((a, b) => (b.mtime || 0) - (a.mtime || 0))
  };
}

/* ---------- اسکن فوری (برای دکمه‌ی «به‌روزرسانی دستی» در UI) ---------- */
function rescanNow(db, saveCallback) {
  return scanOnce(db, saveCallback, (m) => console.log('[calls]', m));
}

module.exports = { start, stop, scanOnce, rescanNow, dirStatus, DIR, normName };
