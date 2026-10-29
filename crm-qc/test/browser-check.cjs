/* Optional real-browser regression; npm i --no-save --package-lock=false playwright-core @sparticuz/chromium */
'use strict';
const {chromium}=require('playwright-core');const binaryModule=require('@sparticuz/chromium');const binary=binaryModule.default||binaryModule;
const fs=require('node:fs');const path=require('node:path');const assert=require('node:assert/strict');const {pathToFileURL}=require('node:url');
const ROOT=path.resolve(__dirname,'..');const output=path.join(ROOT,'node_modules/.cache/browser-artifacts');
(async()=>{
 const executable=await binary.executablePath();const libraries=await binaryModule.inflate(path.join(ROOT,'node_modules/@sparticuz/chromium/bin/al2023.tar.br'));
 const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE||executable,args:binary.args,headless:true,env:{...process.env,LD_LIBRARY_PATH:path.join(libraries,'lib')+':'+(process.env.LD_LIBRARY_PATH||'')}});
 fs.mkdirSync(output,{recursive:true});const errors=[];
 try{
  const context=await browser.newContext({viewport:{width:1440,height:1000},locale:'fa-IR',timezoneId:'Asia/Tehran',acceptDownloads:true});
  await context.route('**/*',route=>{const url=new URL(route.request().url());if(['http:','https:'].includes(url.protocol)&&!['127.0.0.1','localhost'].includes(url.hostname))return route.abort();return route.continue();});
  const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
  await page.goto(process.env.APP_URL||'http://127.0.0.1:8000/',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.App&&document.getElementById('cntC'));
  await page.evaluate(()=>{Chart.defaults.animation=false;});await page.selectOption('#gPreset','all');
  await page.waitForFunction(()=>document.getElementById('cntC').textContent==='۸۱');
  await page.screenshot({path:path.join(output,'dashboard-dark.png')});
  await page.fill('#gFrom','۱۴۰۵/۶/۲۰');await page.fill('#gTo','۱۴۰۵/۶/۲۰');
  await page.waitForFunction(()=>App.dateRange.from==='1405/06/20'&&App.dateRange.to==='1405/06/20'&&document.querySelector('#cntC').textContent==='۳۹');
  await page.click('#themeToggle');assert.equal(await page.evaluate(()=>document.documentElement.dataset.theme),'light');
  await page.screenshot({path:path.join(output,'dashboard-light.png')});
  await page.click('a[data-route="agents"]');await page.waitForSelector('#agentTemplate');
  const templatePromise=page.waitForEvent('download');await page.click('#agentTemplate');const template=await templatePromise;await template.saveAs(path.join(output,'agents-template.xlsx'));
  assert.ok(await page.locator('[data-act="edit"]').count());await page.click('[data-act="edit"] >> nth=0');await page.waitForSelector('#aSave');await page.locator('.modal-back:last-child .x').click();
  await page.click('a[data-route="portfolio"]');await page.waitForSelector('#pAll tr[data-name="الهه عسگری"]');await page.click('#pAll tr[data-name="الهه عسگری"]');
  await page.waitForSelector('.profile-modal #pCallHistory');assert.equal(await page.locator('#content #pBody').count(),0);assert.equal(await page.locator('#pCallHistory tbody > tr').count(),6);
  await page.screenshot({path:path.join(output,'profile-popup.png')});
  const pngPromise=page.waitForEvent('download',{timeout:120000});await page.click('#pImage');const png=await pngPromise;await png.saveAs(path.join(output,'expert-report.png'));
  const bytes=fs.readFileSync(path.join(output,'expert-report.png'));assert.equal(bytes.slice(1,4).toString(),'PNG');
  console.log('Complete profile PNG',bytes.readUInt32BE(16),'x',bytes.readUInt32BE(20),'bytes',bytes.length);assert.ok(bytes.readUInt32BE(20)>1200);
  assert.equal(await page.locator('.capture-host').count(),0);
  await page.fill('#pFrom','1405/06/21');await page.fill('#pTo','1405/06/21');await page.click('#pRangeApply');
  await page.waitForFunction(()=>document.querySelector('#pBody').textContent.includes('بدون دیتای ریت تماس')&&App.dateRange.to==='1405/06/21');
  await page.locator('.profile-modal .x').click();await page.click('#gReset');await page.waitForFunction(()=>App.dateRange.from==='');
  await page.click('a[data-route="call-analysis"]');await page.waitForSelector('.analysis-stat');assert.equal(await page.locator('#chMonthly').count(),0);
  for(const card of await page.locator('.analysis-stat').all()){
   const frame=await card.boundingBox(),icon=await card.locator('.stat-icon').boundingBox();assert.ok(icon.x>=frame.x&&icon.x+icon.width<=frame.x+frame.width);
  }
  await page.screenshot({path:path.join(output,'analysis-light.png')});
  await page.click('a[data-route="criteria"]');await page.waitForSelector('#criteriaRows');assert.equal(await page.locator('#criteriaRows tr').count(),15);
  await page.screenshot({path:path.join(output,'criteria-light.png')});
  await page.click('a[data-route="data"]');await page.waitForSelector('#statusTeams tbody tr');const status=await page.evaluate(()=>UI.api.get('/api/data/status'));assert.equal(status.diagnostics.unknownExperts.length,0);assert.equal(status.byTeam.find(t=>t.team==='MLM').callCount,81);
  await page.fill('#backupYear','1405');await page.selectOption('#backupMonth','6');await page.click('#backupMonthSet');assert.equal(await page.inputValue('#bupFrom'),'1405/06/01');
  const backupPromise=page.waitForEvent('download');await page.click('#btnBackup');const backup=await backupPromise;await backup.saveAs(path.join(output,'month.json'));
  const month=JSON.parse(fs.readFileSync(path.join(output,'month.json'),'utf8'));assert.equal(month.callFeedbacks.length,76);assert.equal(month.range.to,'1405/06/31');
  await page.setInputFiles('#restoreInp',path.join(output,'month.json'));await page.waitForSelector('#importConfirm');assert.equal(await page.isChecked('input[name="importMode"][value="append"]'),true);
  await page.check('input[name="importMode"][value="replace"]');assert.equal(await page.locator('#importConfirm').isDisabled(),true);
  await page.locator('.modal-back:last-child [data-close]').click();
  assert.equal(await page.evaluate(async()=> (await UI.api.get('/api/calls')).count),81);
  await page.click('a[data-route="callreport"]');const frame=await (await page.waitForSelector('#crFrame')).contentFrame();
  await frame.waitForFunction(()=>document.readyState==='complete'&&window.QCReportRange);await frame.waitForFunction(()=>document.documentElement.dataset.theme==='light');
  await page.setViewportSize({width:390,height:844});await page.evaluate(()=>{location.hash='#/dashboard';});await page.waitForSelector('#cntC');await page.waitForFunction(()=>document.querySelector('#cntC').textContent==='۸۱');
  await page.waitForFunction(()=>document.querySelector('#sidebar').getBoundingClientRect().left>=innerWidth-1);await page.click('#gFromBtn');
  const rect=await page.locator('.jcal-pop').boundingBox();assert.ok(rect.x>=0&&rect.x+rect.width<=390);await page.screenshot({path:path.join(output,'mobile-light-calendar.png')});await page.click('#gReset');
  const offline=await context.newPage();offline.on('pageerror',error=>errors.push(error.message));
  await offline.goto(pathToFileURL(path.join(ROOT,'../HTML اصلی/index.html')).href,{waitUntil:'domcontentloaded'});
  await offline.waitForFunction(()=>window.App&&document.querySelector('#cntC'));await offline.selectOption('#gPreset','all');await offline.waitForFunction(()=>document.querySelector('#cntC').textContent==='۸۱');
  await offline.fill('#gFrom','1405/06/20');await offline.fill('#gTo','1405/06/20');await offline.waitForFunction(()=>document.querySelector('#cntC').textContent==='۳۹');
  assert.equal(await offline.evaluate(()=>UI.api.offline),true);await offline.click('#themeToggle');await offline.click('a[data-route="portfolio"]');
  await offline.waitForSelector('#pAll tr[data-name="الهه عسگری"]');await offline.click('#pAll tr[data-name="الهه عسگری"]');await offline.waitForSelector('#pCallHistory');
  const offlinePNG=offline.waitForEvent('download',{timeout:120000});await offline.click('#pImage');await (await offlinePNG).saveAs(path.join(output,'expert-report-offline.png'));
  assert.deepEqual(errors,[]);console.log('PASS: real Chromium, charts, manual dates, themes, modal, complete PNG, monthly backup confirmation, mobile calendar and file:// offline PNG.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
