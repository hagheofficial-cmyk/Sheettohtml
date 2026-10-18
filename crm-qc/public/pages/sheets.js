/* sheets.js — تنظیم و همگام‌سازی Google Sheets */
(function(){
'use strict';
const {$, api, esc, toast, confirmDlg} = UI;

async function render(root){
  if(api.offline){
    root.innerHTML='<div class="card"><div class="card-pad" style="padding:24px"><h3><i class="fa-brands fa-google" style="color:#34a853"></i> اتصال گوگل‌شیت در نسخه سرور</h3><p style="color:var(--muted)">این بخش برای نسخه‌ی Node فعال است. برنامه را از آدرس سرور باز کنید تا تنظیمات امن اتصال و همگام‌سازی نمایش داده شود.</p></div></div>';
    return;
  }
  root.innerHTML = `
  <div class="page-head">
    <div class="ph-ic" style="background:#34a85322;color:#34a853"><i class="fa-brands fa-google"></i></div>
    <div><h2>اتصال به گوگل شیت</h2><p>داده‌ها از شیت وارد سامانه شوند و خروجی/گزارش هم در شیت ثبت شود</p></div>
    <div class="spacer"></div><span id="sheetsBadge" class="badge" style="font-size:12px">در حال بررسی...</span>
  </div>

  <div class="card" id="sheetsStatusCard" style="margin-bottom:16px">
    <div class="card-head">
      <div class="head-icon" style="background:#4285f422;color:#4285f4"><i class="fa-solid fa-plug"></i></div>
      <div><h3>وضعیت اتصال</h3><div class="sub" id="sheetsStatusSub">—</div></div>
      <div class="spacer"></div><button class="btn ghost" id="btnSheetsRefresh"><i class="fa-solid fa-rotate"></i> بروزرسانی</button>
    </div>
    <div class="card-pad" id="sheetsStatusPad"><div class="spinner" style="margin:20px auto"></div></div>
  </div>

  <div class="card" style="margin-bottom:16px">
    <div class="card-head"><div class="head-icon" style="background:#fbbc0422;color:#fbbc04"><i class="fa-solid fa-gear"></i></div><div><h3>تنظیمات اتصال</h3><div class="sub">برای شروع، Apps Script پیشنهاد می‌شود؛ نیازی به آپلود credential در مرورگر نیست.</div></div></div>
    <div class="card-pad" style="display:flex;flex-direction:column;gap:14px">
      <div class="field"><label>حالت اتصال</label>
        <select class="input" id="shMode">
          <option value="webapp">🌐 Apps Script Web App — خواندن و نوشتن</option>
          <option value="service_account">🔐 Service Account — سازمانی</option>
          <option value="apikey">🔑 API Key — فقط خواندن</option>
        </select><small id="modeHelp" style="color:var(--muted);margin-top:4px;display:block"></small>
      </div>

      <div class="field" id="fgSpreadsheet"><label>Spreadsheet ID</label>
        <input class="input" id="shId" dir="ltr" placeholder="کپی از URL گوگل‌شیت">
        <small style="color:var(--muted)">https://docs.google.com/spreadsheets/d/<b style="color:var(--ink)">این‌قسمت</b>/edit</small>
      </div>
      <div class="field" id="fgWebApp"><label>Web App URL</label>
        <input class="input" id="shWebUrl" dir="ltr" placeholder="https://script.google.com/macros/s/.../exec">
        <small style="color:var(--muted)">Apps Script → Deploy → New deployment → Web app</small>
      </div>
      <div class="field" id="fgWebToken"><label>توکن API شیت</label>
        <input class="input" id="shWebToken" type="password" dir="ltr" autocomplete="new-password" placeholder="توکن ساخته‌شده از منوی سامانه QC در شیت">
        <small style="color:var(--muted)">توکن در مرورگر نمایش داده یا در Git ذخیره نمی‌شود؛ ورودی خالی، توکن ذخیره‌شده را حفظ می‌کند.</small>
      </div>
      <div class="field" id="fgApiKey"><label>Google API Key (فقط‌خواندنی)</label><input class="input" id="shApiKey" type="password" dir="ltr" autocomplete="new-password" placeholder="AIza…"></div>
      <div class="field" id="fgCred"><label>مسیر فایل Service Account JSON</label>
        <input class="input" id="shCred" dir="ltr" value="data/sheets-credentials.json">
        <small style="color:var(--muted)">فایل را روی سرور در crm-qc/data/ بگذارید؛ آن را ارسال یا commit نکنید.</small>
      </div>

      <div class="field"><label>سیاست دریافت از شیت</label>
        <select class="input" id="shPolicy">
          <option value="merge">ادغام امن — داده‌ی قبلی حذف نمی‌شود</option>
          <option value="sheet">شیت مرجع اصلی — ویرایش و حذف ردیف در شیت به سامانه منتقل می‌شود</option>
        </select>
        <small style="color:var(--muted)">برای استفاده از شیت به‌عنوان دیتابیس، اول یک بار «ارسال اطلاعات سامانه به شیت» را بزنید تا شیت پر شود؛ سپس می‌توانید «شیت مرجع اصلی» را انتخاب کنید.</small>
      </div>

      <div class="grid" style="grid-template-columns:1fr 1fr;gap:12px">
        <div class="field"><label>فاصله خواندن از شیت (ثانیه)</label><input class="input" id="shInterval" type="number" min="10" value="60"></div>
        <div class="field"><label style="display:flex;align-items:center;gap:8px;margin-top:18px"><input type="checkbox" id="shPush" checked> ارسال خودکار به شیت پس از ثبت</label></div>
      </div>
      <div class="field"><label>نام تب‌های شیت (قابل تغییر)</label>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <input class="input" id="shAgents" style="width:120px" placeholder="Agents">
          <input class="input" id="shTickets" style="width:120px" placeholder="Tickets">
          <input class="input" id="shSocials" style="width:120px" placeholder="Socials">
          <input class="input" id="shCalls" style="width:120px" placeholder="Calls">
          <input class="input" id="shActions" style="width:120px" placeholder="Actions">
          <input class="input" id="shSettings" style="width:120px" placeholder="Settings">
        </div>
      </div>
      <label style="display:flex;align-items:center;gap:8px;background:var(--panel-soft);padding:8px 14px;border-radius:8px;cursor:pointer;width:max-content"><input type="checkbox" id="shEnabled"> <b>فعال‌سازی اتصال</b></label>

      <div style="display:flex;gap:9px;flex-wrap:wrap">
        <button class="btn brand" id="btnSaveSheets"><i class="fa-solid fa-floppy-disk"></i> ذخیره تنظیمات</button>
        <button class="btn soft" id="btnPull"><i class="fa-solid fa-cloud-arrow-down"></i> خواندن / همگام‌سازی از شیت</button>
        <button class="btn soft" id="btnPush"><i class="fa-solid fa-cloud-arrow-up"></i> ارسال اطلاعات سامانه به شیت</button>
        <button class="btn ghost" id="btnPreview"><i class="fa-solid fa-eye"></i> پیش‌نمایش شیت</button>
        <button class="btn success-soft" id="btnReport"><i class="fa-solid fa-file-export"></i> ارسال گزارش عملکرد به شیت</button>
      </div>
      <div id="sheetsOpResult" style="display:none;padding:10px 14px;border-radius:8px;font-size:12px;overflow-wrap:anywhere"></div>
    </div>
  </div>

  <div class="card">
    <div class="card-head"><div class="head-icon" style="background:#ea433522;color:#ea4335"><i class="fa-solid fa-book"></i></div><div><h3>راه‌اندازی اولیه</h3><div class="sub">اتصال امن با Apps Script</div></div></div>
    <div class="card-pad" style="font-size:13px;line-height:1.95">
      <ol style="margin:0;padding-right:18px">
        <li>یک Google Sheet بسازید → Extensions → Apps Script → کد <code>crm-qc/apps-script/Code.gs</code> را جایگزین کنید → Save → تابع <code>setupSheets</code> را اجرا کنید.</li>
        <li>از منوی <b>سامانه QC</b> داخل شیت، «راه‌اندازی / چرخش توکن API» را بزنید و توکن را کپی کنید.</li>
        <li>Deploy → New deployment → Web app → اجرا به‌عنوان خودتان؛ دسترسی را طبق سیاست امنیتی سازمان انتخاب کنید. URL را کپی کنید.</li>
        <li>در فرم بالا URL و توکن را وارد کنید، فعال‌سازی را بزنید و ذخیره کنید.</li>
        <li>اگر دیتای فعلی سامانه را می‌خواهید حفظ کنید، «ارسال اطلاعات سامانه به شیت» را بزنید؛ اگر شیت از قبل دیتای مرجع دارد، «خواندن / همگام‌سازی» را انتخاب و «ادغام» یا «جایگزینی» را تأیید کنید.</li>
      </ol>
      <div class="note" style="margin:12px 0 0"><i class="fa-solid fa-triangle-exclamation"></i><span><b>مهم:</b> اولین ارسال کامل، تب‌های داده را با اطلاعات سامانه جایگزین می‌کند. اولین دریافت می‌تواند داده‌های سامانه را جایگزین کند. قبل از آن بک‌اپ بگیرید. توکن Apps Script را محرمانه نگه دارید.</span></div>
      <p style="margin-top:10px">پس از اولین همگام‌سازی، سامانه در فاصله‌ی تعیین‌شده از شیت می‌خواند و ثبت‌های داخل سامانه را هم به شیت می‌فرستد. گزارش عملکرد را می‌توان همین‌جا در تب جداگانه ساخت یا از منوی شیت تولید کرد.</p>
      <p>جزئیات و روش Service Account: <code>crm-qc/apps-script/README.md</code></p>
    </div>
  </div>`;

  function modeHelp(mode){
    const map={
      webapp:'نیازی به Google Cloud ندارد. برای جلوگیری از دسترسی ناشناس، درخواست‌ها با توکن امن می‌شوند.',
      service_account:'برای سرور سازمانی؛ Google Sheets API و فایل Service Account لازم است. فایل کلید را فقط روی سرور نگه دارید.',
      apikey:'فقط شیت‌های عمومی را می‌خواند؛ نوشتن خودکار و ارسال گزارش فعال نیست.'
    };
    $('#modeHelp').textContent=map[mode]||'';
    $('#fgWebApp').style.display=mode==='webapp'?'':'none';
    $('#fgWebToken').style.display=mode==='webapp'?'':'none';
    $('#fgCred').style.display=mode==='service_account'?'':'none';
    $('#fgApiKey').style.display=mode==='apikey'?'':'none';
    $('#fgSpreadsheet').style.display='';
  }

  async function loadStatus(){
    try{
      const s=await api.get('/api/sheets/status');
      const badge=$('#sheetsBadge');
      badge.textContent=!s.enabled?'⚪ غیرفعال':!s.initialized?'🟠 آماده‌ی همگام‌سازی اولیه':s.polling?'🟢 فعال':'🟡 فعال، پولینگ متوقف';
      badge.style.background=!s.enabled?'#9992':!s.initialized?'#f59e0b22':'#34a85322';
      badge.style.color=!s.enabled?'var(--muted)':!s.initialized?'#d97706':'#34a853';
      const times=[s.lastPullAt?'آخرین دریافت: '+s.lastPullAt:'بدون دریافت',s.lastPushAt?'آخرین ارسال: '+s.lastPushAt:'بدون ارسال'].join(' · ');
      $('#sheetsStatusSub').textContent=(s.enabled?`حالت ${s.mode} · سیاست ${s.syncPolicy==='sheet'?'شیت مرجع':'ادغام امن'} · هر ${s.syncIntervalSec} ثانیه · `:'')+times+(s.lastError?' · خطا: '+s.lastError:'');
      const html=`<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px">
        <div style="background:var(--panel-soft);padding:12px;border-radius:8px"><div style="font-size:11px;color:var(--muted)">Spreadsheet ID</div><div style="font-family:monospace;font-size:11px;word-break:break-all">${esc(s.spreadsheetId||'—')}</div></div>
        <div style="background:var(--panel-soft);padding:12px;border-radius:8px"><div style="font-size:11px;color:var(--muted)">Apps Script Web App</div><div style="font-family:monospace;font-size:10px;word-break:break-all">${esc(s.webAppUrl||'—')}</div></div>
        <div style="background:var(--panel-soft);padding:12px;border-radius:8px"><div style="font-size:11px;color:var(--muted)">اعتبار اولیه</div><div style="font-weight:700">${s.initialized?'تعیین شده':'نیازمند انتخاب جهت ورود'}</div></div>
        <div style="background:var(--panel-soft);padding:12px;border-radius:8px"><div style="font-size:11px;color:var(--muted)">توکن</div><div style="font-weight:700">${s.webAppTokenSet?'تنظیم شده':'تنظیم نشده'}</div></div>
      </div><div style="margin-top:10px;font-size:11px;color:var(--muted)">تب‌ها: ${Object.entries(s.sheets||{}).map(([k,v])=>esc(k)+': <b>'+esc(v)+'</b>').join(' · ')}</div>`;
      $('#sheetsStatusPad').innerHTML=html;
    }catch(error){
      $('#sheetsBadge').textContent='خطا';
      $('#sheetsStatusPad').innerHTML=`<div style="color:var(--bad)"><i class="fa-solid fa-triangle-exclamation"></i> ${esc(error.message)}</div>`;
    }
  }

  async function loadConfig(){
    try{
      const config=await api.get('/api/sheets/config');
      $('#shMode').value=config.mode||'webapp';
      $('#shId').value=config.spreadsheetId||'';
      $('#shWebUrl').value=config.webAppUrl||'';
      $('#shWebToken').value='';
      if(config.webAppTokenSet) $('#shWebToken').placeholder='توکن ذخیره شده است (برای تغییر، توکن جدید را وارد کنید)';
      $('#shApiKey').value='';
      if(config.apiKeySet) $('#shApiKey').placeholder='کلید ذخیره شده است (برای تغییر، کلید جدید را وارد کنید)';
      $('#shCred').value=config.credentialsFile||'data/sheets-credentials.json';
      $('#shPolicy').value=config.syncPolicy||'merge';
      $('#shInterval').value=config.syncIntervalSec||60;
      $('#shPush').checked=config.pushOnWrite!==false;
      $('#shEnabled').checked=!!config.enabled;
      const names=config.sheets||{};
      $('#shAgents').value=names.agents||'Agents'; $('#shTickets').value=names.tickets||'Tickets';
      $('#shSocials').value=names.socials||'Socials'; $('#shCalls').value=names.calls||'Calls';
      $('#shActions').value=names.actions||'Actions'; $('#shSettings').value=names.settings||'Settings';
      modeHelp(config.mode||'webapp');
    }catch(error){toast.error(error.message);}
  }

  $('#shMode').addEventListener('change',()=>modeHelp($('#shMode').value));
  $('#btnSheetsRefresh').addEventListener('click',loadStatus);

  $('#btnSaveSheets').addEventListener('click',async()=>{
    const button=$('#btnSaveSheets'); button.disabled=true;
    const payload={
      enabled:$('#shEnabled').checked, mode:$('#shMode').value, syncPolicy:$('#shPolicy').value,
      spreadsheetId:$('#shId').value.trim(), webAppUrl:$('#shWebUrl').value.trim(),
      credentialsFile:$('#shCred').value.trim(), syncIntervalSec:Math.max(10,parseInt($('#shInterval').value)||60),
      pushOnWrite:$('#shPush').checked,
      sheets:{agents:$('#shAgents').value.trim()||'Agents',tickets:$('#shTickets').value.trim()||'Tickets',
        socials:$('#shSocials').value.trim()||'Socials',calls:$('#shCalls').value.trim()||'Calls',
        actions:$('#shActions').value.trim()||'Actions',settings:$('#shSettings').value.trim()||'Settings'}
    };
    if($('#shWebToken').value.trim()) payload.webAppToken=$('#shWebToken').value.trim();
    if($('#shApiKey').value.trim()) payload.apiKey=$('#shApiKey').value.trim();
    try{
      const response=await api.put('/api/sheets/config',payload);
      showOp(true,'<i class="fa-solid fa-circle-check"></i> تنظیمات ذخیره شد. '+(response.status.needsInitialization?'برای شروع یک بار از شیت بخوانید یا اطلاعات سامانه را به شیت بفرستید.':''));
      toast.success('تنظیمات گوگل شیت ذخیره شد');
      await loadStatus();
    }catch(error){showOp(false,'خطا: '+esc(error.message));toast.error(error.message);}
    button.disabled=false;
  });

  function showOp(success,message){
    const element=$('#sheetsOpResult'); element.style.display='';
    element.style.background=success?'#34a85318':'#ef444418';
    element.style.color=success?'#16a34a':'#ef4444'; element.innerHTML=message;
  }
  function busy(button,on,label){button.disabled=on;button.innerHTML=on?'<i class="fa-solid fa-spinner fa-spin"></i> در حال انجام…':label;}
  const pullLabel='<i class="fa-solid fa-cloud-arrow-down"></i> خواندن / همگام‌سازی از شیت';
  const pushLabel='<i class="fa-solid fa-cloud-arrow-up"></i> ارسال اطلاعات سامانه به شیت';

  $('#btnPull').addEventListener('click',async()=>{
    const button=$('#btnPull');
    let payload={};
    try{
      const status=await api.get('/api/sheets/status');
      if(status.enabled&&!status.initialized){
        const choice=await UI.confirmImport('اولین دریافت اطلاعات از گوگل‌شیت',
          'این کار، اطلاعات موجود در تب‌های Google Sheet را به سامانه وارد می‌کند. انتخاب جایگزینی، داده‌های فعلی سامانه در تب‌های تحت مدیریت را حذف می‌کند.',
          'داده‌های سامانه و همه کارشناسان/سوابقِ تب‌های مربوط با محتوای شیت جایگزین می‌شوند؛ قبل از آن بک‌اپ بگیرید.');
        if(!choice)return;
        payload={initialize:true,initialPolicy:choice==='replace'?'sheet':'merge'};
      }
      busy(button,true,pullLabel);
      const result=await api.post('/api/sheets/pull',payload);
      showOp(true,`<i class="fa-solid fa-circle-check"></i> دریافت شد؛ سیاست ${result.policy==='sheet'?'شیت مرجع':'ادغام امن'} · تعداد: ${esc(JSON.stringify(result.counts||{}))} · ${result.changed?'تغییر اعمال شد':'بدون تغییر'}${result.initialized?' · همگام‌سازی خودکار شروع شد':''}`);
      toast.success('داده‌ها از گوگل‌شیت دریافت شدند'); await loadStatus();
      if(result.changed) await App.boot();
    }catch(error){showOp(false,'خطا: '+esc(error.message));}
    finally{busy(button,false,pullLabel);}
  });

  $('#btnPush').addEventListener('click',()=>{
    const run=async()=>{
      const button=$('#btnPush'); busy(button,true,pushLabel);
      try{
        const result=await api.post('/api/sheets/push',{});
        showOp(true,'<i class="fa-solid fa-circle-check"></i> به شیت نوشته شد: '+esc(JSON.stringify(result.pushed||{}))+(result.initialized?' · همگام‌سازی خودکار فعال شد':''));
        toast.success('اطلاعات سامانه به Google Sheet ارسال شد'); await loadStatus();
      }catch(error){showOp(false,'خطا: '+esc(error.message));}
      finally{busy(button,false,pushLabel);}
    };
    confirmDlg('ارسال کامل اطلاعات به Google Sheet',
      'محتوای فعلی سامانه در تب‌های Agents، Tickets، Socials، Calls، Actions و Settings نوشته می‌شود و محتوای قبلی همان تب‌ها جایگزین خواهد شد. اگر شیت اطلاعات مهمی دارد، اول بک‌اپ بگیرید یا به‌جای ارسال، دریافت با گزینه ادغام را انجام دهید.',
      run,'بله، ارسال و جایگزینی تب‌ها');
  });

  $('#btnPreview').addEventListener('click',async()=>{
    const button=$('#btnPreview'); busy(button,true,'پیش‌نمایش شیت');
    try{
      const result=await api.get('/api/sheets/preview');
      let html='<div style="margin-top:12px;max-height:400px;overflow:auto;border:1px solid var(--line);border-radius:8px;padding:10px;background:var(--panel-soft)">';
      html+='<div><b>تعداد کل:</b> '+esc(JSON.stringify(result.preview.totals))+'</div>';
      ['agents','tickets','socials','calls'].forEach(key=>{
        html+=`<h4 style="margin:10px 0 4px">${esc(key)}</h4><pre style="font-size:11px;white-space:pre-wrap;word-break:break-all;background:var(--panel);padding:8px;border-radius:6px">${esc(JSON.stringify((result.preview[key]||[]).slice(0,3),null,2))}</pre>`;
      });
      html+='</div>'; showOp(true,html);
    }catch(error){showOp(false,'خطا: '+esc(error.message));}
    finally{busy(button,false,'<i class="fa-solid fa-eye"></i> پیش‌نمایش شیت');}
  });

  $('#btnReport').addEventListener('click',async()=>{
    const button=$('#btnReport'); busy(button,true,'ارسال گزارش');
    try{
      const result=await api.post('/api/sheets/report',{type:'combined',filters:{from:App.dateRange.from,to:App.dateRange.to}});
      showOp(true,'<i class="fa-solid fa-circle-check"></i> گزارش عملکرد در تب <b>'+esc(result.sheet||result.title||'Reports')+'</b> نوشته شد ('+esc(result.rows==null?'':result.rows)+' ردیف).');
      toast.success('گزارش عملکرد به گوگل‌شیت ارسال شد');
    }catch(error){showOp(false,'خطا: '+esc(error.message));}
    finally{busy(button,false,'<i class="fa-solid fa-file-export"></i> ارسال گزارش عملکرد به شیت');}
  });

  await Promise.all([loadStatus(),loadConfig()]);
}
App.register('sheets',{title:'اتصال به گوگل شیت',render});
})();
