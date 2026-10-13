/* Real reload/close/reopen verification; same optional Chromium tools as browser-check.cjs. */
'use strict';
const {chromium}=require('playwright-core');const m=require('@sparticuz/chromium'),binary=m.default||m;
const path=require('node:path'),fs=require('node:fs'),assert=require('node:assert/strict');const {pathToFileURL}=require('node:url');
const ROOT=path.resolve(__dirname,'..'),out=path.join(ROOT,'node_modules/.cache/session-browser');
(async()=>{
 fs.mkdirSync(out,{recursive:true});const lib=await m.inflate(path.join(ROOT,'node_modules/@sparticuz/chromium/bin/al2023.tar.br'));
 const browser=await chromium.launch({executablePath:await binary.executablePath(),args:binary.args.filter(arg=>arg!=='--single-process'),env:{...process.env,LD_LIBRARY_PATH:path.join(lib,'lib')}});
 const errors=[];
 try{
  for(const [name,url] of [['http','http://127.0.0.1:8000/'],['offline',pathToFileURL(path.join(ROOT,'../HTML اصلی/index.html')).href]]){
   const context=await browser.newContext({viewport:{width:1440,height:1000},locale:'fa-IR',timezoneId:'Asia/Tehran'});
   const page=await context.newPage();page.on('pageerror',error=>errors.push(error.stack));
   await page.goto(url);await page.waitForSelector('#cntC');await page.selectOption('#gPreset','all');await page.waitForFunction(()=>document.querySelector('#cntC').textContent==='۸۱');
   const icons=await page.locator('link[rel="icon"]').count();assert.equal(icons,1);
   assert.equal(await page.locator('.topbar-logo img').evaluate(img=>img.complete&&img.naturalWidth===512),true);
   await page.fill('#gFrom','1405/06/20');await page.fill('#gTo','1405/06/20');await page.waitForFunction(()=>App.dateRange.to==='1405/06/20'&&document.querySelector('#cntC').textContent==='۳۹');
   await page.click('#themeToggle');await page.click('a[data-route="reports"]');await page.click('#typeTabs [data-t="call"]');await page.click('#levelTabs [data-l="team"]');await page.waitForSelector('#tblWrap tbody tr');
   await page.click('#confirmData');await page.waitForFunction(()=>BrowserSession.saved&&!BrowserSession.saved.dirty);
   assert.equal(await page.evaluate(()=>BrowserSession.saved.data.callFeedbacks.length),81);assert.equal(await page.evaluate(()=>BrowserSession.saved.data.agents.length),65);
   await page.screenshot({path:path.join(out,name+'-confirmed.png')});
   await page.reload();await page.waitForFunction(()=>UI.api.browserPinned&&document.querySelector('#tblWrap tbody tr'));
   assert.equal(await page.locator('#typeTabs .active').getAttribute('data-t'),'call');assert.equal(await page.locator('#levelTabs .active').getAttribute('data-l'),'team');
   assert.equal(await page.evaluate(()=>App.dateRange.from),'1405/06/20');assert.equal(await page.evaluate(()=>App.theme),'light');
   assert.equal(await page.evaluate(()=>UI.api.get('/api/calls').then(d=>d.count)),81);assert.equal(await page.locator('#useServerData').isVisible(),true);
   assert.equal(await page.evaluate(()=>BrowserSession.saved.dirty),false);
   await page.screenshot({path:path.join(out,name+'-restored.png')});
   // A new local registry edit is real data, survives the next explicit confirmation and tab close.
   await page.evaluate(async()=>{await UI.api.post('/api/agents',{name:'نام بررسی ذخیره مرورگر',team:'MLM',ext:98989});await App.boot();});
   await page.click('#confirmData');await page.waitForFunction(()=>BrowserSession.saved&&!BrowserSession.saved.dirty&&BrowserSession.saved.data.agents.length===66);
   await page.close();const reopened=await context.newPage();reopened.on('pageerror',error=>errors.push(error.stack));await reopened.goto(url);
   await reopened.waitForFunction(()=>UI.api.browserPinned&&App.state&&App.state.agents.some(a=>a.name==='نام بررسی ذخیره مرورگر'));
   assert.equal(await reopened.evaluate(()=>UI.api.get('/api/calls').then(d=>d.count)),81);
   await reopened.setViewportSize({width:390,height:844});await reopened.waitForFunction(()=>document.querySelector('#sidebar').getBoundingClientRect().left>=innerWidth-1);await reopened.screenshot({path:path.join(out,name+'-mobile.png')});
   assert.equal(await reopened.evaluate(()=>document.documentElement.scrollWidth),390);assert.ok(await reopened.locator('#confirmData').isVisible());
   await context.close();console.log('PASS',name,'full snapshot, PNG branding, report type/level, dates, theme, reload, closed tab/new tab, mobile');
  }
  assert.deepEqual(errors,[]);
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
