/* تأیید اطلاعات: نسخه کامل مرورگر، ذخیره اتمیک IndexedDB و بازیابی بدون نمره‌دهی مجدد. */
(function(){
'use strict';
if(window.APP_SCRIPT_MODE){
  window.BrowserSession={initialize:async()=>false,bind(){const el=document.querySelector('.confirm-control');if(el)el.hidden=true;const button=document.getElementById('useServerData');if(button)button.hidden=true;},markChanged(){},status(){},restorePage:async()=>{},async waitForWrites(){},get saving(){return false;}};
  return;
}
const NAME='crmqc.confirmed-session.v1', KEY='current', FALLBACK='crmqc.confirmed-session.v1';
let database=null, record=null, saving=false, restoring=false, timer=null;
const copy=x=>JSON.parse(JSON.stringify(x));
function validate(value){
  if(!value||value.version!==1||!value.data||!value.preferences)throw new Error('نسخه ذخیره‌شده مرورگر نامعتبر است');
  const data=value.data;
  for(const key of ['agents','qcAgents','tickets','socials','callFeedbacks'])if(!Array.isArray(data[key]))throw new Error('نسخه مرورگر ناقص است: '+key);
  if(!data.settings||!data.seq||!data.lists)throw new Error('تنظیمات نسخه مرورگر ناقص است');
  if(QCReports.validateRange(value.preferences.dateRange||{}))throw new Error('بازه ذخیره‌شده نامعتبر است');
  return value;
}
async function open(){
  if(database)return database;
  if(!window.indexedDB)return null;
  database=await new Promise((resolve,reject)=>{
    const req=indexedDB.open(NAME,1);
    const timeout=setTimeout(()=>reject(new Error('حافظه مرورگر پاسخ نداد؛ قبل از بستن بک‌اپ بگیرید')),5000);
    req.onupgradeneeded=()=>{if(!req.result.objectStoreNames.contains('sessions'))req.result.createObjectStore('sessions');};
    req.onsuccess=()=>{clearTimeout(timeout);resolve(req.result);};
    req.onerror=()=>{clearTimeout(timeout);reject(req.error||new Error('دسترسی به حافظه مرورگر ممکن نیست'));};
    req.onblocked=()=>{clearTimeout(timeout);reject(new Error('یک تب دیگر حافظه مرورگر را قفل کرده است'));};
  });
  return database;
}
async function read(){
  const db=await open();
  if(!db){const raw=localStorage.getItem(FALLBACK);return raw?JSON.parse(raw):null;}
  return new Promise((resolve,reject)=>{
    const transaction=db.transaction('sessions','readonly'),request=transaction.objectStore('sessions').get(KEY);
    request.onsuccess=()=>resolve(request.result||null);request.onerror=()=>reject(request.error);
  });
}
async function write(value){
  validate(value);const db=await open();
  if(!db){localStorage.setItem(FALLBACK,JSON.stringify(value));return;}
  await new Promise((resolve,reject)=>{
    const transaction=db.transaction('sessions','readwrite');
    transaction.objectStore('sessions').put(copy(value),KEY);
    transaction.oncomplete=resolve;transaction.onerror=()=>reject(transaction.error||new Error('ذخیره اطلاعات ناموفق بود'));
    transaction.onabort=()=>reject(transaction.error||new Error('ذخیره اطلاعات لغو شد'));
  });
}
function preferences(){
  const fields=[],tabs=[],multiselects=[];
  if(!/\/(?:new|edit)(?:\/|$)/.test(location.hash)&&!['#/criteria','#/agents','#/directory'].includes(location.hash)){
    document.querySelectorAll('#content input[id]:not([type="file"]),#content select[id]').forEach(input=>{
      if(input.closest('.mselect'))return;
      fields.push({id:input.id,value:input.value,checked:input.checked});
    });
    document.querySelectorAll('#content .tabs[id]').forEach(group=>{
      const button=group.querySelector('button.active');if(!button)return;
      const attr=['data-t','data-l','data-v'].find(key=>button.hasAttribute(key));if(attr)tabs.push({id:group.id,attr,value:button.getAttribute(attr)});
    });
    document.querySelectorAll('#content .field').forEach(field=>{if(field.getValues)multiselects.push({label:field.querySelector('label').textContent,values:field.getValues()});});
  }
  return {dateRange:copy(App.dateRange),theme:App.theme,hash:location.hash||'#/dashboard',fields,tabs,multiselects};
}
function status(){
  const button=document.getElementById('confirmData'),label=document.getElementById('confirmedInfo'),server=document.getElementById('useServerData');
  if(!button)return;
  button.disabled=saving;
  button.classList.toggle('saved',!!record&&!record.dirty);
  button.innerHTML=saving?'<i class="fa-solid fa-spinner fa-spin"></i><span>در حال تأیید…</span>':'<i class="fa-solid fa-circle-check"></i><span>تأیید اطلاعات</span>';
  if(label){label.textContent=record?(record.dirty?'تغییرات جدید؛ دوباره تأیید کنید':'آخرین تأیید: '+new Date(record.confirmedAt).toLocaleString('fa-IR')):'هنوز تأیید نشده';label.title=record?'ذخیره روی همین مرورگر و همین آدرس. پاک‌کردن داده مرورگر این نسخه را حذف می‌کند.':'پیش از بستن، اطلاعات ثبت‌شده را تأیید کنید';}
  if(server)server.hidden=!UI.api.browserPinned;
}
function markChanged(){
  if(!record||restoring||saving)return;
  record.dirty=true;status();
  // تغییرات ثبت‌شده آفلاین حتی بدون تأیید مجدد از دست نمی‌روند؛ وضعیتشان مشخص است.
  if(UI.api.browserPinned){
    clearTimeout(timer);timer=setTimeout(()=>persistWorking().catch(error=>UI.toast.error('ذخیره خودکار مرورگر ناموفق بود؛ تأیید اطلاعات یا بک‌اپ لازم است: '+error.message)),350);
  }
}
async function persistWorking(){
  if(!record||!record.dirty||!UI.api.browserPinned||saving||restoring)return;
  const next={...record,data:LocalApi.backup(),preferences:preferences(),dirty:true,updatedAt:new Date().toISOString()};
  await write(next);record=next;status();
}
async function initialize(){
  restoring=true;
  try{
    const saved=await read();if(!saved)return false;
    validate(saved);record=copy(saved);
    LocalApi.replaceSnapshot(record.data);
    UI.api.browserPinned=record.useBrowser!==false;
    const prefs=record.preferences;
    App.dateRange=copy(prefs.dateRange||{from:'',to:'',preset:'all'});App._rangeReady=true;
    document.documentElement.dataset.theme=prefs.theme==='light'?'light':'dark';
    if(!location.hash||location.hash==='#/'||location.hash==='#/dashboard'){
      const hash=prefs.hash;
      if(/^#\/[A-Za-z-]+(?:\/[^<>]*)?$/.test(hash||'')&&App.routes[hash.slice(2).split('/')[0]])history.replaceState(null,'',hash);
    }
    App.syncDateRangeUI();status();return true;
  }finally{restoring=false;}
}
async function confirm(){
  if(saving)return;
  clearTimeout(timer);saving=true;status();
  try{
    if(document.querySelector('#globalRange.draft')){
      const range={from:document.getElementById('gFrom').value.trim(),to:document.getElementById('gTo').value.trim(),preset:'custom'};
      const error=QCReports.validateRange(range);if(error)throw new Error('ابتدا بازه تاریخ را اصلاح کنید: '+error);
      await App.setDateRange(range);
    }
    await UI.api.waitForWrites();
    let data;
    if(UI.api.browserPinned||UI.api.offline)data=LocalApi.backup();
    else {
      const response=await fetch('/api/session-snapshot');
      if(!response.ok)throw new Error('دریافت نسخه کامل سرور ناموفق بود؛ نسخه قدیمی مرورگر به جای آن تأیید نشد');
      data=await response.json();
    }
    const now=new Date().toISOString();
    const next={version:1,confirmedAt:now,updatedAt:now,dirty:false,useBrowser:true,data,preferences:preferences()};
    await write(next);const verified=await read();validate(verified);
    if(verified.confirmedAt!==now)throw new Error('تأیید هم‌زمان در تب دیگر انجام شد؛ دوباره تلاش کنید');
    record=copy(verified);
    LocalApi.replaceSnapshot(record.data);
    if(navigator.storage&&navigator.storage.persist)navigator.storage.persist().catch(()=>{});
    UI.toast.success('کل اطلاعات ثبت‌شده، تاریخ و حالت نمایش تأیید شد؛ دفعه بعد همین نسخه مرورگر باز می‌شود.',6500);
    return true;
  }catch(error){
    UI.toast.error('اطلاعات تأیید نشد؛ قبل از بستن بک‌اپ بگیرید. '+error.message,7500);
    return false;
  }finally{saving=false;status();}
}
async function restorePage(){
  if(!record||!UI.api.browserPinned)return;
  const prefs=record.preferences;
  if(location.hash!==prefs.hash)return;
  restoring=true;
  try{
    for(const tab of prefs.tabs||[]){const group=document.getElementById(tab.id);if(!group)continue;const button=[...group.querySelectorAll('button')].find(b=>b.getAttribute(tab.attr)===tab.value);if(button&&!button.classList.contains('active'))button.click();}
    for(const item of prefs.fields||[]){const input=document.querySelector('#content #'+CSS.escape(item.id));if(input){input.value=item.value;if(input.type==='checkbox')input.checked=item.checked;input.dispatchEvent(new Event(input.tagName==='SELECT'||input.type==='checkbox'?'change':'input',{bubbles:true}));}}
    for(const item of prefs.multiselects||[]){const field=[...document.querySelectorAll('#content .field')].find(f=>f.getValues&&f.querySelector('label').textContent===item.label);if(field){field.setValues(item.values);field.notifyChange();}}
  }finally{restoring=false;}
}
function bind(){
  document.getElementById('confirmData').addEventListener('click',confirm);
  document.getElementById('useServerData').addEventListener('click',()=>UI.confirmDlg('استفاده از اطلاعات سرور','نسخه مرورگر محفوظ می‌ماند. اطلاعات سرور ممکن است متفاوت باشد؛ تغییرات محلی خودکار به سرور ارسال نمی‌شوند. ادامه می‌دهید؟',async()=>{
    try{
      const response=await fetch('/api/bootstrap');if(!response.ok)throw new Error('سرور در دسترس نیست');
      if(record){const next={...record,useBrowser:false};await write(next);record=next;}
      UI.api.browserPinned=false;UI.api.offline=false;UI.api._hideOfflineTag();await App.boot();await App.route();status();
    }catch(error){UI.toast.error(error.message);}
  },'نمایش اطلاعات سرور'));
  ['input','change','click'].forEach(type=>document.addEventListener(type,event=>{if(event.target.closest('#content .filters,#content .tabs'))markChanged();}));
  window.addEventListener('beforeunload',event=>{if(record&&record.dirty){event.preventDefault();event.returnValue='';}});
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden'&&UI.api.browserPinned)persistWorking().catch(()=>{});});
  status();
}
window.BrowserSession={initialize,confirm,bind,markChanged,restorePage,status,get saving(){return saving;},get saved(){return record?copy(record):null;},get restored(){return !!record;}};
})();
