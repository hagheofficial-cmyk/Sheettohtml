/* ادغام امن آرشیوهای ماهانه؛ حفظ ریت‌های مستقل و یکسان در هر دو محیط. */
(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./calc'), require('./parseQc'));
  else root.QCImport = factory(root.QCCalc, root.QCParse);
})(typeof self !== 'undefined' ? self : this, function(C, P) {
'use strict';
const clone = x => JSON.parse(JSON.stringify(x));
const own = (o, k) => Object.prototype.hasOwnProperty.call(o || {}, k);
function fail(message) { const e = new Error(message); e.status = 400; throw e; }
function requireMode(mode) { if (!['append', 'replace'].includes(mode)) fail('روش ورود را مشخص کنید: افزودن یا جایگزینی'); return mode; }
function stable(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
  return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + stable(value[k])).join(',') + '}';
}
function day(v) { const j = C.parseDate(v); return j ? C.formatJalali(j) : String(v || ''); }
function semantic(row, kind) {
  const result = Object.create(null);
  const ignored = new Set(['id','createdAt','updatedAt','importedAt','sourceFile','datasetId','evaluationId','team','sourceAgentName','sourceExpertName','criteriaVersion','criteriaSnapshot']);
  Object.keys(row).forEach(k => {
    if (ignored.has(k)) return;
    if (/Date$/.test(k)) result[k] = day(row[k]);
    else if (k === 'score') result[k] = C.normalizeScore(row[k]);
    else if (k === 'agentName' || k === 'expertName') result[k] = P.nameKey(row[k]);
    else result[k] = row[k];
  });
  return kind + ':' + stable(result);
}
function strongKey(row, kind, namespace) {
  if (row.evaluationId) return kind + ':evaluation:' + (row.formType || '') + ':' + String(row.evaluationId) + ':' + (row.datasetId || namespace || '');
  if (kind === 'call' && row.sourceRow != null && row.sourceFile) return P.callRowKey(row);
  if (namespace && row.id != null) return kind + ':id:' + namespace + ':' + row.id;
  return null;
}
function mergeRows(existing, incoming, kind, namespace) {
  const result = existing.slice(); const strong = new Set(); const available = new Map();
  result.forEach(row => {
    const key = strongKey(row, kind, namespace && namespace.current);
    if (key) strong.add(key);
    const sig = semantic(row, kind); available.set(sig, (available.get(sig) || 0) + 1);
  });
  const counts = { added: 0, duplicates: 0 };
  incoming.forEach(raw => {
    const row = clone(raw), key = strongKey(row, kind, namespace && namespace.incoming), sig = semantic(row, kind);
    // فقط وقتی هر دو آرشیو از یک مخزنند، id ترتیبی هویت مشترک است.
    if (key && strong.has(key)) { counts.duplicates++; return; }
    if (!key && (available.get(sig) || 0) > 0) {
      available.set(sig, available.get(sig) - 1); counts.duplicates++; return;
    }
    if (key) strong.add(key);
    result.push(row); counts.added++;
  });
  return { rows: result, counts };
}
function resequence(rows, minimum) {
  const seen = new Set(); let next = Math.max(minimum || 1, Math.max(0, ...rows.map(r => Number(r.id) || 0)) + 1);
  rows.forEach(row => {
    if (!Number.isSafeInteger(Number(row.id)) || Number(row.id) <= 0 || seen.has(Number(row.id))) row.id = next++;
    else row.id = Number(row.id);
    seen.add(row.id);
  });
  return Math.max(next, Math.max(0, ...rows.map(r => r.id)) + 1);
}
function validateBackup(b) {
  if (!b || b.schema !== 'crm-qc-backup') fail('ساختار فایل بک‌اپ شناسایی نشد');
  ['agents', 'tickets', 'socials', 'callFeedbacks'].forEach(k => {
    if (!Array.isArray(b[k])) fail('بک‌اپ باید آرایه ' + k + ' داشته باشد');
    b[k].forEach(row => {
      if (!row || typeof row !== 'object' || Array.isArray(row)) fail('ردیف نامعتبر در ' + k);
      const name = k === 'agents' ? row.name : k === 'callFeedbacks' ? row.expertName : row.agentName;
      if (!P.normName(name)) fail('نام کارشناس در ' + k + ' خالی است');
    });
  });
  if (b.settings && b.settings.callCriteria) P.validateConfig(b.settings.callCriteria);
}
function restore(db, backup, mode) {
  requireMode(mode); validateBackup(backup);
  const b = clone(backup), counts = {}; const currentId = db.datasetId;
  const sameOrigin = !!currentId && currentId === b.datasetId;
  if (mode === 'replace') {
    if (b.settings) { db.settings = Object.assign({}, db.settings, b.settings); if(!own(b.settings,'callCriteria')) delete db.settings.callCriteria; }
    db.agents = b.agents; db.tickets = b.tickets; db.socials = b.socials; db.callFeedbacks = b.callFeedbacks;
    if (b.datasetId) db.datasetId = b.datasetId;
    db.qcAgents = Array.isArray(b.qcAgents) ? b.qcAgents : db.qcAgents;
    db.agentActions = b.agentActions || {};
    db.actionTypes = Array.isArray(b.actionTypes) ? b.actionTypes.slice() : null; // null ⇒ پیش‌فرض‌ها در ensure
    db.reminders = Array.isArray(b.reminders) ? b.reminders : [];
    db.callImport = b.callImport || null; db.callRaw = null;
  } else {
    ['tickets','socials','callFeedbacks'].forEach(field=>b[field].forEach(row=>{const nameField=field==='callFeedbacks'?'expertName':'agentName';const person=P.resolveExpert(db.agents||[],row[nameField]).agent;if(person&&person.name!==row[nameField]){row[field==='callFeedbacks'?'sourceExpertName':'sourceAgentName']=row[nameField];row[nameField]=person.name;}}));
    [['tickets','ticket'], ['socials','social'], ['callFeedbacks','call']].forEach(([field, kind]) => {
      const merged = mergeRows(db[field] || [], b[field], kind, sameOrigin ? { current: currentId, incoming: currentId } : null);
      db[field] = merged.rows; counts[field] = merged.counts;
    });
    const names = new Set((db.agents || []).flatMap(a => [a.name].concat(a.aliases||[])).map(P.nameKey));
    b.agents.forEach(a => {
      if (names.has(P.nameKey(a.name))) return;
      if (a.ext != null && (db.agents || []).some(old => old.ext != null && C.faToEn(String(old.ext)) === C.faToEn(String(a.ext)))) a.ext = null;
      db.agents.push(a); names.add(P.nameKey(a.name));
    });
    db.qcAgents = Array.from(new Set((db.qcAgents || []).concat(b.qcAgents || [])));
    db.agentActions = db.agentActions || {};
    Object.keys(b.agentActions || {}).forEach(name => {
      if (['__proto__','prototype','constructor'].includes(name)) return;
      const old = db.agentActions[name] || [], seen = new Set(old.map(x => stable([x.title, x.date, x.note, x.status])));
      db.agentActions[name] = old.concat((b.agentActions[name] || []).filter(x => {
        const sig = stable([x.title,x.date,x.note,x.status]); if (seen.has(sig)) return false; seen.add(sig); return true;
      }));
    });
    // نوع اقدام‌ها: اجتماع فهرست فعلی و بک‌اپ؛ یادآورها بدون تکرار (نشانه: کارشناس+تاریخ+متن+زمان ثبت).
    if (Array.isArray(b.actionTypes)) db.actionTypes = Array.from(new Set((db.actionTypes || []).concat(b.actionTypes.map(String))));
    const remSig = (x) => stable([x.agent, x.date, x.text, x.createdAt]);
    const remSeen = new Set((db.reminders || []).map(remSig));
    db.reminders = (db.reminders || []).concat((Array.isArray(b.reminders) ? b.reminders : []).filter((x) => {
      const sig = remSig(x); if (remSeen.has(sig)) return false; remSeen.add(sig); return true;
    }));
    // ادغام ماهانه تنظیمات و تیم/داخلی موجود را تغییر نمی‌دهد.
  }
  db.seq = db.seq || {};
  db.seq.ticket = resequence(db.tickets, db.seq.ticket);
  db.seq.social = resequence(db.socials, db.seq.social);
  db.seq.agent = resequence(db.agents, db.seq.agent);
  const actions = Object.values(db.agentActions || {}).flat(); db.seq.action = resequence(actions, db.seq.action);
  db.reminders = db.reminders || [];
  db.seq.reminder = resequence(db.reminders, db.seq.reminder);
  db.registryCleared = db.agents.length === 0;
  return { ok: true, mode, changes: counts, restored: { agents: db.agents.length, tickets: db.tickets.length, socials: db.socials.length, calls: db.callFeedbacks.length } };
}
function calls(db, incoming, mode, sourceFile) {
  requireMode(mode);
  if (mode === 'replace') db.callFeedbacks = (db.callFeedbacks || []).filter(r => r.sourceFile !== sourceFile);
  const merged = mergeRows(db.callFeedbacks || [], incoming, 'call');
  db.callFeedbacks = merged.rows;
  return merged.counts;
}
return { requireMode, restore, calls, mergeRows, validateBackup, semantic, stable };
});
