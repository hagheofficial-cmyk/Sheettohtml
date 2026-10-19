/* مدیریت مشترک کارشناسان: سرور و مرورگر، اعتبارسنجی اتمیک و حفظ سوابق. */
(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./calc'), require('./parseQc'));
  else root.QCRegistry = factory(root.QCCalc, root.QCParse);
})(typeof self !== 'undefined' ? self : this, function(C, P) {
'use strict';
const text = (v) => v == null ? '' : String(v).trim();
function fail(message) { const e = new Error(message); e.status = 400; throw e; }
function extension(value) {
  if (value == null || text(value) === '') return null;
  const s = C.faToEn(text(value));
  if (!/^\d+$/.test(s) || !Number.isSafeInteger(Number(s)) || Number(s) <= 0) fail('داخلی باید عدد صحیح مثبت باشد');
  return Number(s);
}
function nextId(db) {
  db.seq = db.seq || {};
  const min = Math.max(0, ...(db.agents || []).map(a => Number(a.id) || 0)) + 1;
  db.seq.agent = Math.max(db.seq.agent || 1, min);
  return db.seq.agent++;
}
function renameReferences(db, oldName, name) {
  if (oldName === name) return;
  ['tickets', 'socials'].forEach(kind => (db[kind] || []).forEach(row => {
    if (P.normName(row.agentName) === P.normName(oldName)) { row.sourceAgentName = row.sourceAgentName || row.agentName; row.agentName = name; }
  }));
  (db.callFeedbacks || []).forEach(row => {
    if (P.normName(row.expertName) === P.normName(oldName)) { row.sourceExpertName = row.sourceExpertName || row.expertName; row.expertName = name; }
  });
  if (db.agentActions && db.agentActions[oldName]) {
    db.agentActions[name] = (db.agentActions[name] || []).concat(db.agentActions[oldName]).map(a => Object.assign({}, a, { agent: name }));
    delete db.agentActions[oldName];
  }
}
function nameList(value) {
  if (value === undefined) return undefined;
  const parts = Array.isArray(value) ? value : text(value).split(/[,،;؛|\n\r\t]+/);
  const out = [];
  parts.forEach((x) => { const n = P.normName(text(x)); if (n && !out.some((y) => P.nameKey(y) === P.nameKey(n))) out.push(n); });
  return out;
}
function save(db, body, id) {
  db.agents = db.agents || [];
  const old = id == null ? null : db.agents.find(a => Number(a.id) === Number(id));
  if (id != null && !old) fail('کارشناس یافت نشد');
  const row = Object.assign({}, old || {}, {
    name: body.name == null && old ? old.name : P.normName(body.name),
    team: body.team == null && old ? old.team : text(body.team),
    ext: body.ext === undefined && old ? old.ext : extension(body.ext),
    subgroup: body.subgroup === undefined && old ? old.subgroup : text(body.subgroup),
    active: body.active === undefined ? (old ? old.active !== false : true) : !!body.active,
    /* کارشناس(های) QC مسئول ریت‌کردن این کارشناس — ستون qcAgents تب Agents */
    qcAgents: body.qcAgents === undefined ? nameList(old ? old.qcAgents : []) : nameList(body.qcAgents)
  });
  if (!Array.isArray(row.qcAgents)) row.qcAgents = [];
  if (!row.name || !row.team) fail('نام و تیم الزامی است');
  const same = db.agents.filter(a => !old || a.id !== old.id);
  if (same.some(a => [a.name].concat(a.aliases || []).some(n => P.nameKey(n) === P.nameKey(row.name)))) fail('کارشناسی با این نام وجود دارد');
  if (row.ext != null && same.some(a => a.ext != null && extension(a.ext) === row.ext)) fail('این شماره داخلی تکراری است');
  const knownTeam = db.agents.find(a => P.teamKey(a.team) === P.teamKey(row.team));
  if (knownTeam) row.team = knownTeam.team;
  if (old) {
    if (old.name !== row.name) {
      row.aliases = Array.from(new Set((old.aliases || []).concat(old.name))).filter(n => n !== row.name);
      renameReferences(db, old.name, row.name);
    }
    db.agents[db.agents.indexOf(old)] = row;
  } else { row.id = nextId(db); db.agents.push(row); }
  return row;
}
function bulk(db, rows) {
  if (!Array.isArray(rows) || rows.length > 10000) fail('لیست کارشناسان نامعتبر یا بیش از حد بزرگ است');
  let added = 0, updated = 0, skipped = 0; const errs = [];
  rows.forEach((raw, index) => {
    try {
      if (!raw || !P.normName(raw.name)) fail('نام خالی است');
      const found = P.resolveExpert(db.agents || [], raw.name).agent;
      const body = Object.assign({}, raw, { active: true });
      if (found && !text(body.team)) body.team = found.team;
      if (found && (body.ext == null || body.ext === '')) delete body.ext;
      save(db, body, found ? found.id : null);
      if (found) updated++; else added++;
    } catch(e) { skipped++; errs.push('ردیف ' + (index + 2) + ': ' + e.message); }
  });
  return { added, updated, skipped, errs: errs.slice(0, 30), total: db.agents.length };
}
function removeAll(db, body) {
  if (!body || body.confirmation !== 'DELETE_ALL_AGENTS') fail('برای حذف همه کارشناسان تأیید صریح لازم است');
  const removed = (db.agents || []).length;
  db.seq = db.seq || {}; db.seq.agent = Math.max(db.seq.agent || 1, Math.max(0, ...(db.agents || []).map(a => Number(a.id) || 0)) + 1);
  db.agents = []; db.registryCleared = true;
  return { ok: true, removed, historyPreserved: true };
}
return { save, bulk, removeAll, extension };
});
