'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {IDBFactory}=require('fake-indexeddb');const {browser,fixture,clone,go,pickMulti,settle,ROOT}=require('./helpers');
async function prepare(build='public',factory=new IDBFactory()){
 const env=browser(build);env.w.indexedDB=factory;await env.w.App.boot();return env;
}
for(const build of ['public','offline']){
 test(build+': confirm snapshots the whole dataset, criteria/aliases/lists and actual zero, not only filtered day',async t=>{
  const env=await prepare(build),{w,dom}=env;t.after(()=>dom.window.close());
  await go(w,'reports');await w.App.setDateRange({from:'1405/06/20',to:'1405/06/20'});w.App.applyTheme('light');
  w.document.querySelector('#typeTabs [data-t="call"]').click();pickMulti(w,'کارشناس',['کارشناس الف']);await settle();
  const data=w.LocalApi.backup();assert.equal(await w.BrowserSession.confirm(),true);
  const stored=w.BrowserSession.saved;assert.deepEqual(clone(stored.data),clone(data));assert.equal(stored.data.tickets.length,3);assert.equal(stored.data.callFeedbacks.length,7);
  assert.equal(stored.data.callFeedbacks[1].score,0);assert.equal(stored.data.callFeedbacks[2].score,null);assert.equal(stored.preferences.theme,'light');
  assert.equal(stored.preferences.tabs.find(x=>x.id==='typeTabs').value,'call');assert.deepEqual(clone(stored.preferences.multiselects.find(x=>x.label==='کارشناس').values),['کارشناس الف']);
  assert.equal(w.document.querySelector('#confirmData').disabled,false);assert.ok(w.document.querySelector('#confirmedInfo').textContent.includes('تأیید'));
 });
 test(build+': saved browser data wins over different seed/server after reopen, with scope/theme/report filters restored',async t=>{
  const indexedDB=new IDBFactory(),first=await prepare(build,indexedDB);t.after(()=>first.dom.window.close());
  const w=first.w;await w.LocalApi.put('/api/agents/1',{name:'کارشناس آخرین نسخه',ext:3010,team:'MLM'});await w.App.boot();
  await go(w,'reports');await w.App.setDateRange({from:'1405/06/20',to:'1405/06/20'});w.App.applyTheme('light');
  w.document.querySelector('#typeTabs [data-t="call"]').click();pickMulti(w,'تیم',['MLM']);await settle();assert.equal(await w.BrowserSession.confirm(),true);
  const second=browser(build,{...fixture(),agents:[],tickets:[],socials:[],callFeedbacks:[]},()=>{throw new Error('server must not override checkpoint');});t.after(()=>second.dom.window.close());second.w.indexedDB=indexedDB;
  await second.w.App.init();
  assert.equal(second.w.UI.api.browserPinned,true);assert.equal(second.w.location.hash,'#/reports');
  assert.equal(second.w.App.dateRange.from,'1405/06/20');assert.equal(second.w.document.documentElement.dataset.theme,'light');
  assert.equal((await second.w.UI.api.get('/api/agents'))[0].name,'کارشناس آخرین نسخه');assert.equal((await second.w.UI.api.get('/api/calls')).count,7);
  assert.equal(second.w.document.querySelector('#typeTabs button.active').dataset.t,'call');assert.equal(second.w.document.querySelector('#dataSourceBadge').textContent,'نسخه مرورگر');
  assert.deepEqual(second.errors,[]);
 });
}

test('storage write/quota failure cannot show success or replace the previous confirmed checkpoint',async t=>{
 const env=await prepare(),{w,dom}=env;t.after(()=>dom.window.close());await go(w,'dashboard');assert.equal(await w.BrowserSession.confirm(),true);
 const old=w.BrowserSession.saved;w.LocalApi.backup().callFeedbacks[0].score=0;
 // Force a real transaction abort while retaining the previously committed object store.
 const original=w.IDBDatabase;const originalOpen=w.indexedDB.open.bind(w.indexedDB);
 w.indexedDB.open=originalOpen;
 const factory=w.indexedDB,opened=await new Promise((resolve,reject)=>{const req=factory.open('crmqc.confirmed-session.v1',1);req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});
 const proto=Object.getPrototypeOf(opened),transaction=proto.transaction;
 proto.transaction=function(...args){const tx=transaction.apply(this,args);if(args[1]==='readwrite')queueMicrotask(()=>tx.abort());return tx;};
 try{assert.equal(await w.BrowserSession.confirm(),false);assert.equal(w.BrowserSession.saved.confirmedAt,old.confirmedAt);assert.equal(w.document.querySelector('#confirmData').disabled,false);}
 finally{proto.transaction=transaction;opened.close();}
});

test('network failure during online confirmation never confirms an unrelated local seed instead',async t=>{
 const env=await prepare(),{w,dom}=env;t.after(()=>dom.window.close());await go(w,'dashboard');
 w.UI.api.offline=false;w.fetch=()=>Promise.reject(new w.TypeError('offline'));
 assert.equal(await w.BrowserSession.confirm(),false);assert.equal(w.BrowserSession.saved,null);assert.ok(w.document.querySelector('#toastZone').textContent.includes('تأیید نشد'));
});

test('pending actual writes finish before confirmation, and new writes are blocked during atomic save',async t=>{
 const env=await prepare(),{w,dom}=env;t.after(()=>dom.window.close());await go(w,'dashboard');
 let resolve;const pending=new Promise(r=>resolve=r);w.UI.api._writes.add(pending);
 const save=w.BrowserSession.confirm();await settle();assert.equal(w.document.querySelector('#confirmData').disabled,true);
 await assert.rejects(w.UI.api.post('/api/agents',{name:'نباید ثبت شود',team:'MLM'}),e=>e.status===409);
 resolve();assert.equal(await save,true);w.UI.api._writes.delete(pending);
});

test('IndexedDB-unavailable fallback writes atomically; empty registry stays empty on reload',async t=>{
 const first=browser();t.after(()=>first.dom.window.close());await first.w.App.boot();await go(first.w,'agents');
 await first.w.LocalApi.del('/api/agents',{confirmation:'DELETE_ALL_AGENTS'});assert.equal(await first.w.BrowserSession.confirm(),true);
 const saved=first.w.localStorage.getItem('crmqc.confirmed-session.v1');assert.ok(saved);
 const second=browser();t.after(()=>second.dom.window.close());second.w.localStorage.setItem('crmqc.confirmed-session.v1',saved);await second.w.App.init();
 assert.equal((await second.w.UI.api.get('/api/agents')).length,0);assert.equal((await second.w.UI.api.get('/api/calls')).count,7);
});

test('application and standalone report share real PNG branding and no overriding emoji favicon',()=>{
 for(const dir of [path.join(ROOT,'public'),path.join(ROOT,'../HTML اصلی')]){
  const html=fs.readFileSync(path.join(dir,'index.html'),'utf8');assert.equal((html.match(/rel="icon"/g)||[]).length,1);assert.ok(!html.includes('data:image/svg+xml'));
  assert.ok(html.includes('id="confirmData"'));assert.ok(html.includes('class="topbar-logo"'));assert.ok(html.includes('session.js'));
  for(const name of ['logo.png','favicon.png','favicon.ico','apple-touch-icon.png','icon-192.png','icon-512.png'])assert.ok(fs.statSync(path.join(dir,name)).size>100);
  assert.ok(fs.readFileSync(path.join(dir,'call-admin-report.html'),'utf8').includes('favicon.png?v=2'));
 }
 for(const file of ['logo.png','favicon.png','favicon.ico','apple-touch-icon.png','icon-192.png','icon-512.png'])assert.deepEqual(fs.readFileSync(path.join(ROOT,'public',file)),fs.readFileSync(path.join(ROOT,'../HTML اصلی',file)));
});
