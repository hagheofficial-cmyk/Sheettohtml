'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const ROOT = path.resolve(__dirname, '..');
const clone = (value) => JSON.parse(JSON.stringify(value));

function fixture() {
  const seed = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/seed.json'), 'utf8'));
  return { ...seed, schema: 'crm-qc-backup', agentActions: {}, callImport: { counts: { total: 999 } },
    settings: { ...seed.settings, defaultPreset: 'all' },
    agents: [
      { id: 1, name: 'کارشناس الف', team: 'Tele Sales', ext: 101, active: true },
      { id: 2, name: 'کارشناس ب', team: 'Account', ext: 102, active: true },
      { id: 3, name: 'کارشناس بدون ریت', team: 'Tele Sales', ext: 103, active: true },
      { id: 4, name: 'کارشناس بایگانی', team: 'Account', ext: 104, active: false }
    ],
    tickets: [
      { id: 1, agentName: 'کارشناس الف', team: 'Tele Sales', reviewDate: '1405/06/20', ticketDate: '1405/06/19', ticketCode: 'T-1', score: 100, redline: '1', q1: '1', q2: '-', q3: '1', q4: '0' },
      { id: 2, agentName: 'کارشناس الف', team: 'Tele Sales', reviewDate: '1405/06/21', ticketDate: '1405/06/20', ticketCode: 'T-2', score: 0, redline: '0', q1: '0', q2: '0', q3: '1', q4: '1' },
      { id: 3, agentName: 'کارشناس ب', team: 'Account', reviewDate: '۱۴۰۵/۶/۲۰', ticketDate: '1405/06/19', ticketCode: 'T-3', score: 50, redline: '1', q1: '0', q2: '1', q3: '1', q4: '1' }
    ],
    socials: [
      { id: 1, agentName: 'کارشناس الف', team: 'Tele Sales', reviewDate: '2026-09-11T09:00:00Z', score: 100, slaStatus: 'رعایت شده', qSla: '1', qFollow: '1', qClosing: '1', qTone: '-' },
      { id: 2, agentName: 'کارشناس الف', team: 'Tele Sales', reviewDate: '1405/06/20', score: null, slaStatus: 'رعایت نشده', qSla: '', qFollow: '-', qClosing: '0', qTone: '1' },
      { id: 3, agentName: 'کارشناس ب', team: 'Account', reviewDate: '1405/06/21', score: 50, redline: 1, slaStatus: 'رعایت نشده', qSla: '0', qFollow: '1', qClosing: '1', qTone: '1' }
    ],
    callFeedbacks: [
      { expertName: 'کارشناس الف', reviewDate: '1405/06/20', formType: 'tele', leadName: 'شریک اول', leadPhone: '09120000000', score: 100, redline: 0, callDuration: '90', listeningTime: '30', elements: { Call_opening_quality: 1, active_engagement: '1' } },
      { expertName: 'کارشناس الف', reviewDate: '1405/06/20', formType: 'tele', leadName: 'شریک دوم', leadPhone: '09120000000', score: 0, redline: '1', redlineReason: 'علت ردلاین: "گفتار نامناسب" <script>alert(1)</script>', listeningTime: '40', elements: { Call_opening_quality: '"0"', active_engagement: 0 } },
      { expertName: 'کارشناس الف', reviewDate: '1405/06/20', formType: 'tele', leadName: 'شریک سوم', leadPhone: '09120000001', score: null, redline: 0, elements: { Call_opening_quality: '-', active_engagement: '-', note: '-' } },
      { expertName: 'کارشناس الف', reviewDate: '1405/06/20', formType: 'tele', leadName: 'شریک چهارم', leadPhone: '09120000002', score: '', redline: 0, elements: { Call_opening_quality: '', active_engagement: '' } },
      { expertName: 'کارشناس ب', reviewDate: '1405/06/20', formType: 'account', leadName: 'شریک اکانت', score: '80', redline: 0, elements: { Call_opening_quality: 1, cta_guidance: 0 } },
      { expertName: 'کارشناس الف', reviewDate: '1405/06/21', formType: 'mlm', leadName: 'شریک MLM', score: 60, redline: 0, elements: { effective_negotiation: 0, note: 1 } },
      { expertName: 'کارشناس ثبت‌نشده', reviewDate: '', formType: 'mlm', leadName: 'بدون تاریخ', score: 50, redline: 0, elements: { effective_negotiation: '-' } }
    ]
  };
}

function browser(build = 'public', data = fixture(), fetchImpl) {
  const dir = build === 'public' ? path.join(ROOT, 'public') : path.join(ROOT, '..', 'HTML اصلی');
  const dom = new JSDOM(fs.readFileSync(path.join(dir, 'index.html'), 'utf8'), {
    url: 'http://qc.test/', runScripts: 'outside-only', pretendToBeVisual: true
  });
  const w = dom.window;
  w.scrollTo = () => {};
  w.HTMLElement.prototype.scrollIntoView = () => {};
  w.CSS = { escape: (s) => String(s).replace(/["\\]/g, '\\$&') };
  const errors = [];
  w.console.error = (...args) => errors.push(args.map(String).join(' '));
  w.addEventListener('error', (event) => errors.push(event.message));
  const charts = new Map();
  w.Chart = class {
    static defaults = { font: {} };
    constructor(canvas, config) {
      if (!canvas || !canvas.isConnected || charts.has(canvas)) throw new Error('Missing/detached/duplicate chart canvas');
      this.canvas = canvas; this.config = config; charts.set(canvas, this);
    }
    destroy() { charts.delete(this.canvas); }
  };
  const workbooks = [];
  const X = require('xlsx');
  w.XLSX = { ...X, writeFile: (wb, name) => workbooks.push({ wb, name }) };
  for (const file of ['calc.js', 'parseQc.js', 'reports.js', 'expertRef.js']) w.eval(fs.readFileSync(path.join(dir, file), 'utf8'));
  w.QC_SEED = clone(data);
  for (const file of ['registry.js', 'importData.js', 'storage.js', 'jcal.js', 'export.js', 'app.js', 'session.js', 'capture.js', 'tableTools.js']) w.eval(fs.readFileSync(path.join(dir, file), 'utf8'));
  for (const file of fs.readdirSync(path.join(dir, 'pages')).filter((f) => f.endsWith('.js'))) {
    w.eval(fs.readFileSync(path.join(dir, 'pages', file), 'utf8'));
  }
  if (fetchImpl) w.fetch = (url, options) => fetchImpl(url, options);
  else { w.UI.api.offline = true; w.UI.api._lastProbe = Date.now(); }
  return { dom, w, errors, charts, workbooks };
}

async function settle() { await new Promise((resolve) => setImmediate(resolve)); }
async function go(w, hash) { w.location.hash = '#/' + hash; await w.App.route(); }
function pickMulti(w, label, values) {
  const field = [...w.document.querySelectorAll('.field')].find((node) => node.firstElementChild && node.firstElementChild.textContent === label);
  if (!field) throw new Error('Missing multi-select: ' + label);
  field.querySelector('.ms-btn').click();
  // منوی باز به یک لایه‌ی شناور روی body منتقل می‌شود؛ لیست همان منوی باز این فیلد است
  const list = w.document.querySelector('.ms-portal.open .ms-list') || field.querySelector('.ms-list');
  for (const value of values) {
    const cb = [...list.querySelectorAll('input')].find((node) => node.dataset.v === value);
    if (!cb) throw new Error('Missing option: ' + value);
    cb.checked = true; cb.dispatchEvent(new w.Event('change', { bubbles: true }));
  }
  field.querySelector('.ms-btn').click();
  return field;
}
module.exports = { ROOT, fixture, browser, clone, settle, go, pickMulti };
