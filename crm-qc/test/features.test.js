'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const C=require('../shared/calc');const P=require('../shared/parseQc');const R=require('../shared/reports');
const I=require('../shared/importData');const Registry=require('../shared/registry');
const {fixture,clone,browser,go,settle}=require('./helpers');
const DAY={from:'1405/06/20',to:'1405/06/20'};

test('MLM attribution: Arabic letters and space variants resolve only to a unique registered expert; no fuzzy team guesses',()=>{
  const agents=[{id:1,name:'علی رضا کریمی',team:'MLM',ext:101}];
  const rows=P.parseRows([{tele_expert_name:'علي‌رضا كريمي',review_date:DAY.from,score:85,Call_opening_quality:1}], 'mlm',{agents});
  assert.equal(rows[0].expertName,agents[0].name);assert.equal(rows[0].team,'MLM');
  const db={...fixture(),agents,callFeedbacks:rows};assert.equal(R.dataStatus(db,{...DAY,team:'mlm'}).calls,1);
  assert.equal(P.importDiagnostics(rows,agents).unknownExperts.length,0);
  const unknown=P.parseRows([{tele_expert_name:'نام واقعی ثبت نشده',review_date:DAY.from,score:90}], 'mlm',{agents});
  assert.equal(unknown[0].team,undefined);assert.equal(P.importDiagnostics(unknown,agents).unknownExperts.length,1);
  const directed=P.parseRows([{tele_expert_name:'نام واقعی ثبت نشده',review_date:DAY.from,score:90}], 'mlm',{agents,team:'MLM'});
  assert.equal(directed[0].team,'MLM');
  assert.equal(P.resolveExpert([{name:'علی رضا'},{name:'علی‌رضا'}],'علی  رضا').ambiguous,true);
});

test('registry edits: Persian extension, duplicate/invalid rejection is atomic; rename retains every grade and identity alias',()=>{
  const db=fixture(),before=clone(db);
  assert.throws(()=>Registry.save(db,{name:'نام جدید',ext:'102'},1),/تکراری/);assert.deepEqual(db,before);
  assert.throws(()=>Registry.save(db,{team:'MLM',ext:'۱۲x'},1),/صحیح/);assert.deepEqual(db,before);
  const edited=Registry.save(db,{name:'کارشناس الف جدید',team:'MLM',ext:'۳۰۱۱',subgroup:'زیرمجموعه'},1);
  assert.equal(edited.ext,3011);assert.equal(edited.subgroup,'زیرمجموعه');assert.ok(edited.aliases.includes('کارشناس الف'));
  assert.equal(db.tickets[0].agentName,edited.name);assert.equal(db.callFeedbacks[1].score,0);assert.equal(db.callFeedbacks[0].sourceExpertName,'کارشناس الف');
  const info=R.agentProfile(db,edited.name,DAY);assert.equal(info.calls.count,4);assert.equal(info.calls.avgScore,50);
  assert.equal(P.resolveExpert(db.agents,'کارشناس الف').agent.name,edited.name);
  const conflict=Registry.bulk(db,[{name:'شخص دیگر',team:'MLM',ext:3011}]);assert.equal(conflict.skipped,1);assert.equal(db.agents.length,4);
});

test('delete-all experts requires explicit confirmation and never deletes QC reviewers or performance records',()=>{
  const db=fixture(),before=clone(db);assert.throws(()=>Registry.removeAll(db,{}),/تأیید/);assert.deepEqual(db,before);
  const result=Registry.removeAll(db,{confirmation:'DELETE_ALL_AGENTS'});assert.equal(result.removed,4);assert.equal(db.agents.length,0);
  assert.deepEqual(db.callFeedbacks,before.callFeedbacks);assert.deepEqual(db.tickets,before.tickets);assert.deepEqual(db.qcAgents,before.qcAgents);
  const next=Registry.save(db,{name:'فرد جدید',team:'MLM',ext:109});assert.ok(next.id>4);
});

test('criterion rename/column alias/add/delete drives parser and rates, while stored overall scores are unchanged',()=>{
  const db=fixture();const defs=P.defaults('tele');defs[0].label='شروع تماس جدید';defs[0].excelKey='opening_new';
  defs.push({key:'custom_follow',label:'پیگیری واقعی',excelKey:'follow_new',active:true});
  db.settings.callCriteria=P.saveTeamConfig(null,{team:'Tele Sales',form:'tele',elements:defs,version:0});
  const parsed=P.parseRows([{tele_expert_name:'کارشناس الف',review_date:DAY.from,score:73,opening_new:0,Call_opening_quality:1,follow_new:'-',active_engagement:1}], 'tele',{agents:db.agents,criteria:db.settings.callCriteria});
  assert.equal(parsed[0].elements.Call_opening_quality,0);assert.equal(parsed[0].elements.custom_follow,'-');assert.equal(parsed[0].score,73);
  db.callFeedbacks=parsed;const rep=R.callReport(db,'agent',DAY,P.resolver(db.settings.callCriteria));
  const opening=rep.elements.find(e=>e.key==='Call_opening_quality');assert.equal(opening.label,'شروع تماس جدید');assert.equal(opening.errorRate,100);
  const na=rep.elements.find(e=>e.key==='custom_follow');assert.equal(na.na,1);assert.equal(na.successRate,'');
  const version=db.settings.callCriteria.version;defs[0].active=false;
  db.settings.callCriteria=P.saveTeamConfig(db.settings.callCriteria,{team:'Tele Sales',form:'tele',elements:defs,version});
  assert.equal(R.callReport(db,'agent',DAY).elements.some(e=>e.key==='Call_opening_quality'),false);
  assert.equal(db.callFeedbacks[0].elements.Call_opening_quality,0);assert.equal(R.dashboard(db,DAY).avgCall,73);
});

test('criteria validation rejects duplicate columns/prototype ids and conflicting versions before applying',()=>{
  const defs=P.defaults('mlm');defs[1].excelKey=defs[0].excelKey;assert.throws(()=>P.saveTeamConfig(null,{form:'mlm',elements:defs}),/تکراری/);
  const bad=P.defaults('mlm');bad[0].key='__proto__';assert.throws(()=>P.saveTeamConfig(null,{form:'mlm',elements:bad}),/شناسه/);
  const config=P.saveTeamConfig(null,{form:'mlm',elements:P.defaults('mlm'),version:0});
  assert.throws(()=>P.saveTeamConfig(config,{form:'mlm',elements:P.defaults('mlm'),version:0}),e=>e.status===409);
  assert.equal(P.sniffFormType([{Call_opening_quality:1,note:0}]),null);
});

test('append monthly backups keeps previous days/settings and independent ratings; reimport is idempotent',()=>{
  const db=fixture();db.datasetId='origin';db.callFeedbacks=[{...db.callFeedbacks[0],sourceFile:'tele.xlsx',sourceRow:2}];
  const originalSettings=clone(db.settings);const archive=clone(db);archive.schema='crm-qc-backup';archive.tickets=[];archive.socials=[];
  archive.settings.scoreBands=[99,98,97];archive.callFeedbacks=[{...db.callFeedbacks[0],reviewDate:'1405/06/21',score:0}];
  const first=I.restore(db,archive,'append');assert.equal(first.changes.callFeedbacks.added,1);assert.equal(db.callFeedbacks.length,2);
  assert.deepEqual(db.settings,originalSettings);assert.equal(R.dashboard(db,DAY).callCount,1);
  assert.equal(I.restore(db,archive,'append').changes.callFeedbacks.added,0);assert.equal(db.callFeedbacks.length,2);
  assert.equal(db.callFeedbacks[0].score,100);assert.equal(db.callFeedbacks[1].score,0);
});

test('legacy duplicates are multiset-aware, and explicit distinct evaluation ids never collapse',()=>{
  const a={expertName:'الف',reviewDate:DAY.from,formType:'mlm',score:0,elements:{note:1}};
  const merged=I.mergeRows([a],[a,a], 'call');assert.equal(merged.rows.length,2);
  assert.equal(I.mergeRows(merged.rows,[a,a],'call').rows.length,2);
  assert.equal(I.mergeRows([{...a,evaluationId:'one'}],[{...a,evaluationId:'two'}],'call').rows.length,2);
});

test('backup replace is explicit; unrelated integer IDs are resequenced during append, not confused with identity',()=>{
  const db=fixture(),archive=fixture(),before=clone(db);archive.tickets=[{...archive.tickets[0],reviewDate:'1405/06/22',score:0}];archive.socials=[];archive.callFeedbacks=[];
  assert.throws(()=>I.restore(db,archive),/روش ورود/);assert.deepEqual(db,before);
  I.restore(db,archive,'append');assert.equal(db.tickets.length,4);assert.equal(new Set(db.tickets.map(t=>t.id)).size,4);
  assert.equal(db.tickets[0].score,100);assert.equal(db.tickets.at(-1).score,0);
  I.restore(db,archive,'replace');assert.equal(db.tickets.length,1);assert.equal(db.socials.length,0);
});

for(const build of ['public','offline'])test(build+': new management, popup, schema, manual dates and light mode work together',async t=>{
  const env=browser(build),{w,dom,errors,workbooks}=env;t.after(()=>dom.window.close());
  await w.App.boot();w.App.bindDateRangeUI();const $=s=>w.document.querySelector(s);
  w.confirm=()=>true;
  await go(w,'agents');assert.ok($('#agentTemplate'));assert.ok($('#agentsDeleteAll'));assert.ok($('[data-act="edit"]'));
  $('#agentTemplate').click();assert.equal(workbooks.at(-1).wb.SheetNames[0],'کارشناسان');
  $('#agentsBody tr[data-id="1"] [data-act="edit"]').click();$('#aE').value='۳۰۲۰';$('#aT').value='MLM';$('#aSave').click();await settle();await settle();
  const agents=await w.LocalApi.get('/api/agents');assert.equal(agents[0].ext,3020);assert.equal(agents[0].team,'MLM');
  w.App.applyTheme('light');assert.equal(w.document.documentElement.dataset.theme,'light');assert.equal(w.localStorage.getItem('crmqc.theme.v1'),'light');
  await go(w,'criteria');assert.ok(w.document.querySelectorAll('#criteriaTeams button').length>=4, 'چهار تیم پایه + تیم‌های مدیریت کارشناسان');
  [...w.document.querySelectorAll('#criteriaTeams button')].find(b=>b.textContent.includes('تله')).click();await settle();
  assert.ok($('#criteriaRows input[data-column]'));$('#criterionAdd').click();assert.equal($('#criteriaRows').children.length,16);
  const last=$('#criteriaRows').lastElementChild;last.querySelector('[data-label]').value='المان آزمایش';last.querySelector('[data-column]').value='test_col';
  $('#criteriaSave').click();await settle();await settle();assert.ok((await w.LocalApi.get('/api/criteria')).config.teams[P.teamKey('Tele sales')].elements.some(d=>d.excelKey==='test_col'));
  await go(w,'portfolio');await w.App.setDateRange(DAY);const row=$('#pAll tr[data-name="کارشناس الف"]');row.click();await settle();
  assert.ok($('.profile-modal'));assert.equal($('#content #pBody'),null);assert.ok($('#pBody').textContent.includes('کارشناس الف'));
  assert.equal($('#pFrom').value,DAY.from);assert.equal($('#pTo').value,DAY.to);assert.ok($('#pImage'));assert.ok($('#pXls'));
  const snapshots=[];w.QCCapture.download=async(source,name,prepare)=>{const copy=source.cloneNode(true);if(prepare)prepare(copy);snapshots.push({copy,name});};
  $('#pImage').click();await settle();assert.ok(snapshots[0].name.includes('1405/06/20'));assert.equal(snapshots[0].copy.querySelectorAll('.call-detail-row[hidden]').length,0);
  assert.equal(snapshots[0].copy.querySelectorAll('#pCallHistory tbody > tr').length,4);
  $('.profile-modal .x').click();assert.equal($('.profile-modal'),null);
  await go(w,'dashboard');$('#gFrom').value='۱۴۰۵/۶/۲۱';$('#gTo').value='۱۴۰۵/۶/۲۱';$('#gTo').dispatchEvent(new w.Event('input',{bubbles:true}));
  await new Promise(resolve=>setTimeout(resolve,700));assert.equal(w.App.dateRange.from,'1405/06/21');assert.equal($('#cntC').textContent,'۱');
  assert.equal($('#globalRange').classList.contains('draft'),false);assert.ok($('#gRangeState').textContent.includes('اعمال'));
  assert.deepEqual(errors,[]);
});

/* سرعت: ثبت یک ریت نباید کل bootstrap را دوباره بخواند؛ شمارش همان‌جا اصلاح
 * می‌شود و صفحه‌ی سوابق داده‌ی خودش را می‌گیرد. این تست قرارداد را قفل می‌کند. */
test('speed: saving a rating never triggers a full App.boot (round trips stay at 2)', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const root = path.join(__dirname, '..');
  const source = (file) => fs.readFileSync(path.join(root, 'public', file), 'utf8');
  const saveBlock = (file, marker) => {
    const text = source(file);
    const start = text.indexOf(marker);
    assert.ok(start > 0, marker + ' پیدا نشد');
    const end = text.indexOf('saveBtn.addEventListener', start);
    return text.slice(start, end > start ? end : start + 2600);
  };
  const tickets = saveBlock('pages/tickets.js', 'const doSave = async (overwrite) => {');
  assert.ok(!tickets.includes('App.boot()'), 'ثبت تیکت نباید boot کامل بزند');
  assert.ok(tickets.includes("App.applyWrite('tickets'"), 'شمارش تیکت باید همان‌جا اصلاح شود');

  const socials = saveBlock('pages/socials.js', 'const doSave = async');
  assert.ok(!socials.includes('App.boot()'), 'ثبت سوشال نباید boot کامل بزند');
  assert.ok(socials.includes("App.applyWrite('socials'"), 'شمارش سوشال باید همان‌جا اصلاح شود');

  const app = source('app.js');
  assert.ok(app.includes('applyWrite(kind, delta)'), 'کمک‌تابع به‌روزرسانی شمارش هست');
  assert.ok(app.includes('noteRevision(rev)'), 'نسخه‌ی تازه از پاسخ نوشتن خوانده می‌شود');
});
