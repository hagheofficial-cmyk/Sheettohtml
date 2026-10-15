/*
 * QC Lite — read-only companion for the CRM QC repository.
 * It reads the checked-in reference files and never writes to them.
 */
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const url = require('node:url');
const XLSX = require('../crm-qc/public/vendor/xlsx.full.min.js');
const QCCalc = require('../crm-qc/shared/calc.js');
const QCParse = require('../crm-qc/shared/parseQc.js');

const ROOT = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(__dirname, 'public');
const PORT = Number(process.env.PORT || 8001);

const FILES = Object.freeze({
  roster: path.join(ROOT, 'crm-qc/data/seed.json'),
  mlm: path.join(ROOT, 'crm-qc/data/seed-calls/qc_mlm_form_2026-09-26.xlsx'),
  account: path.join(ROOT, 'qc_acc_form_2026-10-14T19_30_41.611923442+03_30.xlsx'),
  ticketTemplate: path.join(ROOT, 'QC _ Ticket Evaluation.xlsx'),
  socialTemplate: path.join(ROOT, 'QC _ Social Evaluation.xlsx')
});

const ASSETS = Object.freeze({
  '/assets/logo.png': path.join(ROOT, 'logo.png'),
  '/assets/vazirmatn-arabic.woff2': path.join(ROOT, 'HTML اصلی/vendor/vazirmatn/vazirmatn-arabic-400-normal.woff2'),
  '/assets/vazirmatn-latin.woff2': path.join(ROOT, 'HTML اصلی/vendor/vazirmatn/vazirmatn-latin-400-normal.woff2'),
  '/assets/vazirmatn-arabic-bold.woff2': path.join(ROOT, 'HTML اصلی/vendor/vazirmatn/vazirmatn-arabic-700-normal.woff2'),
  '/assets/vazirmatn-latin-bold.woff2': path.join(ROOT, 'HTML اصلی/vendor/vazirmatn/vazirmatn-latin-700-normal.woff2')
});

let cachedSnapshot = null;
let cachedSignature = '';

function fileSignature() {
  return Object.values(FILES).map((file) => {
    const stat = fs.statSync(file);
    return `${file}:${stat.size}:${stat.mtimeMs}`;
  }).join('|');
}

function readWorkbook(file) {
  const buffer = fs.readFileSync(file);
  // These checked-in workbooks have harmless ZIP size metadata warnings in SheetJS 0.18.5.
  // Keep other parser diagnostics visible, but avoid repeating this known warning on refresh.
  const originalError = console.error;
  console.error = (...args) => {
    const message = args.map(String).join(' ');
    if (/^Bad (?:compressed|uncompressed) size: \d+ != \d+$/.test(message)) return;
    originalError.apply(console, args);
  };
  try {
    const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: false });
    return { workbook, buffer };
  } finally {
    console.error = originalError;
  }
}

function rowsForSheet(workbook, preferredName) {
  const name = workbook.SheetNames.includes(preferredName) ? preferredName : workbook.SheetNames[0];
  if (!name || !workbook.Sheets[name]) return [];
  return XLSX.utils.sheet_to_json(workbook.Sheets[name], { defval: '' });
}

function tableRows(workbook, preferredName) {
  const name = workbook.SheetNames.includes(preferredName) ? preferredName : workbook.SheetNames[0];
  if (!name || !workbook.Sheets[name]) return [];
  return XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1, defval: '' });
}

function nonEmpty(value) {
  return value !== undefined && value !== null && String(value).trim() !== '';
}

function validTri(value) {
  const tri = QCCalc.normalizeTri(value);
  return tri === 0 || tri === 1 || tri === '-';
}

function templateStatus(file, kind) {
  const { workbook } = readWorkbook(file);
  const rows = tableRows(workbook, 'Evaluations');
  const candidates = rows.slice(2).filter((row) => {
    if (kind === 'ticket') return nonEmpty(row[3]) || nonEmpty(row[1]) || nonEmpty(row[5]);
    return nonEmpty(row[6]) || nonEmpty(row[0]) || nonEmpty(row[2]);
  });

  const complete = candidates.filter((row) => {
    if (kind === 'ticket') {
      return nonEmpty(row[0]) && QCCalc.parseDate(row[1]) && QCCalc.parseDate(row[2]) &&
        nonEmpty(row[3]) && nonEmpty(row[5]) && [6, 7, 8, 9].every((i) => validTri(row[i])) &&
        ['0', '1'].includes(String(QCCalc.normalizeTri(row[10])));
    }
    return QCCalc.parseDate(row[0]) && nonEmpty(row[1]) && QCCalc.parseDate(row[3]) &&
      QCCalc.parseDate(row[5]) && nonEmpty(row[6]) && nonEmpty(row[8]) &&
      nonEmpty(row[9]) && nonEmpty(row[10]) && nonEmpty(row[12]) && nonEmpty(row[15]) &&
      [16, 17, 18, 19].every((i) => validTri(row[i]));
  });

  return {
    completeRecords: complete.length,
    incompleteRows: candidates.length - complete.length,
    candidateRows: candidates.length
  };
}

function statFor(file) {
  const stat = fs.statSync(file);
  return { sizeBytes: stat.size, modifiedAt: stat.mtime.toISOString() };
}

function normalizeCall(row, agents, sourceFile) {
  const match = QCParse.resolveExpert(agents, row.expertName).agent;
  return {
    id: `${sourceFile}:${row.sourceRow}`,
    sourceRow: row.sourceRow,
    type: 'call',
    formType: row.formType,
    expertName: row.expertName,
    team: (match && match.team) || row.team || '',
    score: QCCalc.normalizeScore(row.score),
    redline: row.redline === 1 ? 1 : 0,
    redlineReason: row.redlineReason || '',
    reviewDate: row.reviewDate || '',
    callDate: row.callDate || '',
    qcAgent: row.qcAgent || '',
    qcComment: row.qcComment || '',
    listeningTime: row.listeningTime || '',
    elements: row.elements || {},
    sourceFile
  };
}

function buildSnapshot() {
  const roster = JSON.parse(fs.readFileSync(FILES.roster, 'utf8'));
  const agents = (roster.agents || []).map((agent) => ({
    id: agent.id,
    ext: agent.ext,
    name: agent.name,
    team: agent.team,
    active: agent.active !== false
  }));

  const mlmBook = readWorkbook(FILES.mlm).workbook;
  const mlmRows = rowsForSheet(mlmBook, 'Query result');
  const mlmCalls = QCParse.parseRows(mlmRows, 'mlm', { agents });

  const accountBook = readWorkbook(FILES.account).workbook;
  const accountRows = rowsForSheet(accountBook, 'Query result');
  const accountCalls = QCParse.parseRows(accountRows, 'account', { agents });

  const calls = mlmCalls.map((row) => normalizeCall(row, agents, path.basename(FILES.mlm)))
    .concat(accountCalls.map((row) => normalizeCall(row, agents, path.basename(FILES.account))))
    .sort((a, b) => String(b.reviewDate).localeCompare(String(a.reviewDate)) || Number(b.sourceRow || 0) - Number(a.sourceRow || 0));

  const ticketStatus = templateStatus(FILES.ticketTemplate, 'ticket');
  const socialStatus = templateStatus(FILES.socialTemplate, 'social');
  const teams = [...new Set(agents.map((agent) => agent.team).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'fa'));

  const sources = [
    {
      id: 'agents', label: 'فهرست کارشناسان', path: 'crm-qc/data/seed.json', format: 'JSON',
      records: agents.length, status: 'loaded', ...statFor(FILES.roster),
      note: 'مرجع نام، تیم و داخلی کارشناسان؛ فقط برای نمایش خوانده می‌شود.'
    },
    {
      id: 'mlm', label: 'ریت تماس MLM', path: 'crm-qc/data/seed-calls/qc_mlm_form_2026-09-26.xlsx', format: 'Excel',
      records: mlmCalls.length, status: 'loaded', ...statFor(FILES.mlm),
      note: 'فرم‌های تماس موجود در پوشه نمونه؛ با همان پارسر مشترک سامانه خوانده شده‌اند.'
    },
    {
      id: 'account', label: 'ریت تماس اکانت', path: 'qc_acc_form_2026-10-14T19_30_41.611923442+03_30.xlsx', format: 'Excel',
      records: accountCalls.length, status: 'loaded', ...statFor(FILES.account),
      note: 'فایل فرم اکانت ریشه ریپو؛ امتیاز و مقادیر المان‌ها بدون بازنمره‌دهی نمایش داده می‌شوند.'
    },
    {
      id: 'ticket', label: 'ارزیابی تیکت', path: 'QC _ Ticket Evaluation.xlsx', format: 'Excel',
      ...ticketStatus, records: ticketStatus.completeRecords, status: 'template', ...statFor(FILES.ticketTemplate),
      note: 'در ردیف‌های موجود، ارزیابی کامل و قابل محاسبه پیدا نشد؛ در آمار تیکت وارد نشده است.'
    },
    {
      id: 'social', label: 'ارزیابی سوشال', path: 'QC _ Social Evaluation.xlsx', format: 'Excel',
      ...socialStatus, records: socialStatus.completeRecords, status: 'template', ...statFor(FILES.socialTemplate),
      note: 'ردیف‌های فایل نمونه ناقص‌اند و در آمار سوشال وارد نشده‌اند.'
    }
  ];

  return {
    readOnly: true,
    loadedAt: new Date().toISOString(),
    dataNote: 'این نسخه فقط فایل‌های منبع را می‌خواند. هیچ‌کدام از فایل‌ها، داده‌ها یا تنظیمات ذخیره نمی‌شوند یا تغییر نمی‌کنند.',
    agents,
    teams,
    calls,
    tickets: [],
    socials: [],
    criteriaLabels: QCParse.CRITERIA_LABELS,
    sources,
    counts: {
      agents: agents.length,
      calls: calls.length,
      tickets: 0,
      socials: 0,
      mlmCalls: mlmCalls.length,
      accountCalls: accountCalls.length
    }
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function loadSnapshot(options = {}) {
  const signature = fileSignature();
  if (!options.force && cachedSnapshot && signature === cachedSignature) {
    const snapshot = clone(cachedSnapshot);
    snapshot.loadedAt = new Date().toISOString();
    return snapshot;
  }
  const snapshot = buildSnapshot();
  cachedSnapshot = snapshot;
  cachedSignature = signature;
  return clone(snapshot);
}

function json(res, status, payload, headOnly = false) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer'
  });
  res.end(headOnly ? undefined : body);
}

function sendFile(res, file, headOnly = false) {
  fs.readFile(file, (error, body) => {
    if (error) return json(res, 404, { error: 'فایل پیدا نشد' }, headOnly);
    const ext = path.extname(file).toLowerCase();
    const mime = {
      '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.woff2': 'font/woff2',
      '.svg': 'image/svg+xml'
    }[ext] || 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': mime,
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'"
    });
    res.end(headOnly ? undefined : body);
  });
}

function createServer() {
  return http.createServer((req, res) => {
    const parsed = url.parse(req.url || '/', true);
    const pathname = decodeURIComponent(parsed.pathname || '/');
    const headOnly = req.method === 'HEAD';

    if (req.method !== 'GET' && !headOnly) {
      res.writeHead(405, { 'Allow': 'GET, HEAD', 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify({ error: 'این نسخه فقط‌خواندنی است؛ درخواست تغییردهنده پذیرفته نمی‌شود.' }));
    }

    if (pathname === '/api/health') return json(res, 200, { ok: true, readOnly: true }, headOnly);
    if (pathname === '/api/snapshot') {
      try { return json(res, 200, loadSnapshot(), headOnly); }
      catch (error) {
        console.error('[qc-lite] read error:', error.message);
        return json(res, 500, { error: 'خواندن فایل‌های مرجع ممکن نشد. فایل‌ها را بررسی و دوباره تلاش کنید.' }, headOnly);
      }
    }

    const publicFiles = {
      '/': path.join(PUBLIC_DIR, 'index.html'),
      '/index.html': path.join(PUBLIC_DIR, 'index.html'),
      '/app.js': path.join(PUBLIC_DIR, 'app.js'),
      '/styles.css': path.join(PUBLIC_DIR, 'styles.css'),
      '/favicon.svg': path.join(PUBLIC_DIR, 'favicon.svg')
    };
    const file = ASSETS[pathname] || publicFiles[pathname];
    if (!file) return json(res, 404, { error: 'یافت نشد' }, headOnly);
    return sendFile(res, file, headOnly);
  });
}

if (require.main === module) {
  const server = createServer();
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`QC Lite (read-only) → http://0.0.0.0:${server.address().port}`);
  });
}

module.exports = { createServer, loadSnapshot, buildSnapshot, FILES };
