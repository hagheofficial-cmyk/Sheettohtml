// =========================================================================
// Code.gs — API سبک و گزارش داخلی برای اتصال سامانه QC به گوگل شیت
//   این اسکریپت API و منوی گزارش در شیت را می‌سازد؛ رابط کامل CRM همچنان در نسخه Node میزبانی می‌شود.
//   نصب: Extensions → Apps Script → این کد را جایگزین کن → Save → Deploy
// =========================================================================

// ---------- تنظیمات شیت‌ها ----------
const SHEET_NAMES = {
  agents: 'Agents',
  tickets: 'Tickets',
  socials: 'Socials',
  calls: 'Calls',
  actions: 'Actions',
  settings: 'Settings',
  reports: 'Reports' // برای گزارش‌های خودکار
};

const HEADERS = {
  agents: ['id','name','team','ext','active','aliases','extra'],
  tickets: ['id','reviewDate','ticketDate','agentName','team','ticketCode','q1','q2','q3','q4','redline','score','comment','qcAgent','extra'],
  socials: ['id','reviewDate','receiveDate','replyDate','agentName','team','messenger','receiveTime','replyTime','responseStatus','delayReason','reasonVerdict','qSla','qFollow','qClosing','qTone','score','durationMin','slaStatus','comment','qcAgent','extra'],
  calls: ['syncId','expertName','score','redline','redlineReason','leadName','leadPhone','listeningTime','callDuration','reviewDate','callDate','formType','team','qcAgent','qcComment','elements','sourceFile','sourceRow','evaluationId','extra'],
  actions: ['id','agent','title','date','status','result','note','type','problem','problemSource','extra'],
  settings: ['key','value']
};

// ---------- منوی سفارشی ----------
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('🟢 سامانه QC')
    .addItem('۱) ساختار شیت‌ها (راه‌اندازی اولیه)', 'setupSheets')
    .addSeparator()
    .addItem('۲) ورود داده نمونه (Demo)', 'insertDemoData')
    .addSeparator()
    .addItem('۳) نمایش داشبورد در سایدبار', 'showSidebar')
    .addItem('۴) تولید گزارش در شیت Reports', 'generateReport')
    .addSeparator()
    .addItem('۵) خروجی JSON کامل (برای Node)', 'exportJson')
    .addItem('۶) ورود از JSON', 'importJsonDialog')
    .addSeparator()
    .addItem('۷) راه‌اندازی / چرخش توکن API', 'configureApiToken')
    .addItem('۸) راهنمای انتشار Web App', 'showWebAppUrl')
    .addToUi();
}

// ---------- راه‌اندازی شیت‌ها ----------
function setupSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  Object.keys(HEADERS).forEach(key => {
    const name = SHEET_NAMES[key];
    let sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);
    const headers = HEADERS[key];
    if (sh.getLastRow() === 0) {
      sh.getRange(1, 1, 1, headers.length).setValues([headers]);
      sh.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#1a73e8').setFontColor('white');
      sh.setFrozenRows(1);
      try { sh.getRange(1, 1, 1, headers.length).createFilter(); } catch (e) {}
    }
  });
  const settingsSh = ss.getSheetByName(SHEET_NAMES.settings);
  if (settingsSh.getLastRow() === 1) {
    const defaults = {
      orgName: 'سامانه یکپارچه کنترل کیفیت', ticketWeights: [40,20,20,20], socialWeights: [30,30,25,15],
      slaMinutes: 60, workStart: '09:00', workEnd: '18:00', weekendDays: [4,5],
      scoreBands: [90,75,50], defaultPreset: 'cur'
    };
    const lists = {
      messengers: ['بله','روبیکا','ایتا','تلگرام','واتساپ','پیامک'],
      responseStatuses: ['پاسخ داده شده','عدم پاسخ'],
      delayReasons: ['ندارد','اختلال سامانه یا پیام‌رسان','خارج از ساعت کاری','عدم دسترسی به اطلاعات ضروری','حجم بالای پیام‌ها','فراموشی یا عدم پیگیری','سایر'],
      reasonVerdicts: ['موجه و تأییدشده','بدون دلیل موجه','در انتظار بررسی']
    };
    settingsSh.getRange(2,1,10,2).setValues([
      ['settings',JSON.stringify(defaults)], ['qcAgents',JSON.stringify(['هادی','مبینا','شیدا','هانیه'])],
      ['lists',JSON.stringify(lists)], ['actionTypes',JSON.stringify(['تماس پیگیری','جلسه بازخورد','آموزش مجدد','ارسال بازخورد کتبی','هشدار کتبی','مشاوره با سرپرست','بررسی مجدد نمونه'])],
      ['reminders','[]'], ['seq',JSON.stringify({ticket:1,social:1,agent:1,action:1,reminder:1})],
      ['datasetId',''], ['registryCleared','false'], ['callImport','null'], ['version','1']
    ]);
  }
  SpreadsheetApp.getUi().alert('✅ ساختار شیت‌ها ساخته شد!\n\nحالا می‌توانید داده وارد کنید یا از منوی سامانه QC توکن API بسازید.');
}

function getSheet(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(name);
  if (!sh) {
    ss.insertSheet(name);
    sh = ss.getSheetByName(name);
  }
  return sh;
}

// ---------- خواندن یک شیت به آرایه آبجکت ----------
function sheetCellText(value) {
  if (value == null) return '';
  if (value instanceof Date && !isNaN(value.getTime())) {
    const format = value.getFullYear() < 1901 ? 'HH:mm' : 'yyyy-MM-dd';
    return Utilities.formatDate(value, Session.getScriptTimeZone(), format);
  }
  return String(value).trim();
}

function readSheet(sheetName) {
  const sh = getSheet(sheetName);
  const lastRow = sh.getLastRow();
  const lastCol = sh.getLastColumn();
  if (lastRow < 2) return [];
  const values = sh.getRange(1, 1, lastRow, lastCol).getValues();
  const headers = values[0].map(h => String(h).trim());
  return values.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = sheetCellText(row[i]); });
    return obj;
  }).filter(o => Object.values(o).some(v => v !== ''));
}

function safeCellValue(value) {
  if (value == null) return '';
  const text = String(value);
  return ['=','+','-','@'].includes(text.charAt(0)) ? "'" + text : text; // متن ورودی به فرمول شیت تبدیل نشود
}

function writeSheet(sheetName, rows, headers) {
  const sh = getSheet(sheetName);
  sh.clear();
  if (!rows.length) {
    sh.getRange(1,1,1,headers.length).setValues([headers]);
    sh.getRange(1,1,1,headers.length).setFontWeight('bold').setBackground('#1a73e8').setFontColor('white');
    return;
  }
  const values = [headers].concat(rows.map(r => headers.map(h => safeCellValue(r[h]))));
  sh.getRange(1, 1, values.length, headers.length).setValues(values);
  sh.getRange(1,1,1,headers.length).setFontWeight('bold').setBackground('#1a73e8').setFontColor('white');
  sh.setFrozenRows(1);
  if (values.length > 1) {
    try { sh.getRange(1,1,values.length,headers.length).createFilter(); } catch(e) {}
  }
  sh.autoResizeColumns(1, headers.length);
}

// ---------- امنیت Web App ----------
function configureApiToken() {
  const token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  PropertiesService.getScriptProperties().setProperty('WEB_APP_TOKEN', token);
  SpreadsheetApp.getUi().alert('توکن API ساخته شد. همین حالا آن را در صفحه اتصال گوگل شیت سامانه ثبت کن:\n\n' + token + '\n\nاین توکن فقط در تنظیمات خصوصی سرور ذخیره می‌شود. اگر گم شد، دوباره این گزینه را بزن تا توکن جدید ساخته شود.');
}

function validApiToken(token) {
  const saved = PropertiesService.getScriptProperties().getProperty('WEB_APP_TOKEN');
  return !!saved && !!token && String(token) === saved;
}

function readAllData() {
  const data = {};
  Object.keys(HEADERS).forEach(key => { data[key] = readSheet(SHEET_NAMES[key]); });
  data._meta = { exportedAt: new Date().toISOString(), version: 2 };
  return data;
}

// ---------- Web App API (برای اتصال Node؛ token لازم است) ----------
function doGet(e) {
  const params = (e && e.parameter) || {};
  if (!validApiToken(params.token)) return jsonResponse({ error: 'دسترسی غیرمجاز؛ توکن API را بررسی کنید' });
  const action = params.action || 'pull';
  if (action === 'pull') return jsonResponse(readAllData());
  if (action === 'dashboard') {
    const data = readAllData();
    return jsonResponse(buildDashboard(data.tickets, data.socials, data.calls, data.agents));
  }
  return jsonResponse({ error: 'action نامشخص: ' + action });
}

function doPost(e) {
  try {
    const body = e.postData ? JSON.parse(e.postData.contents) : {};
    const action = (e.parameter && e.parameter.action) || body.action || 'push';
    if (!validApiToken(body.token)) return jsonResponse({ error: 'دسترسی غیرمجاز؛ توکن API را بررسی کنید' });

    if (action === 'pull') return jsonResponse(readAllData());

    if (action === 'push') {
      // هر تب موجود در payload به‌صورت کامل جایگزین می‌شود؛ pull نیز طبق سیاست سرور انجام می‌شود.
      Object.keys(HEADERS).forEach(key => {
        if (Array.isArray(body[key])) writeSheet(SHEET_NAMES[key], body[key], HEADERS[key]);
      });
      const counts = {};
      Object.keys(HEADERS).forEach(key => { counts[key] = Array.isArray(body[key]) ? body[key].length : 0; });
      return jsonResponse({ ok: true, message: 'داده‌ها در شیت ذخیره شد', counts: counts });
    }

    if (action === 'pushReport') {
      const title = String(body.title || ('QC_Report_' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd'))).replace(/[\\/?*:[\]]/g, '_').slice(0, 90);
      if (Object.keys(SHEET_NAMES).some(key => SHEET_NAMES[key] === title)) return jsonResponse({ error: 'نام گزارش با تب داده‌ها تداخل دارد' });
      let sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(title);
      if (!sh) sh = SpreadsheetApp.getActiveSpreadsheet().insertSheet(title);
      const rows = Array.isArray(body.rows) ? body.rows : [];
      const headers = Array.isArray(body.headers) && body.headers.length ? body.headers : Object.keys(rows[0] || {});
      if (!headers.length) return jsonResponse({ error: 'گزارش ستون ندارد' });
      const values = [headers].concat(rows.map(r => headers.map(h => safeCellValue(r[h]))));
      sh.clear();
      sh.getRange(1,1,values.length,headers.length).setValues(values);
      sh.getRange(1,1,1,headers.length).setFontWeight('bold').setBackground('#34a853').setFontColor('white');
      sh.setFrozenRows(1);
      return jsonResponse({ ok: true, sheet: title, rows: rows.length });
    }

    if (action === 'append') {
      const key = body.sheet || 'tickets';
      if (!HEADERS[key] || !SHEET_NAMES[key]) return jsonResponse({ error: 'نام شیت نامعتبر است' });
      const sh = getSheet(SHEET_NAMES[key]);
      const headers = HEADERS[key];
      const rows = Array.isArray(body.rows) ? body.rows : [];
      if (!rows.length) return jsonResponse({ ok: true, added: 0 });
      const values = rows.map(row => headers.map(h => safeCellValue(row[h])));
      sh.getRange(sh.getLastRow()+1, 1, values.length, headers.length).setValues(values);
      return jsonResponse({ ok: true, added: rows.length });
    }
    return jsonResponse({ error: 'action نامشخص' });
  } catch(err) {
    return jsonResponse({ error: err.message });
  }
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj, null, 2))
    .setMimeType(ContentService.MimeType.JSON);
}

// ---------- تابع کمکی: onEdit برای گزارش خودکار ----------
function onEdit(e) {
  // هر ویرایش در شیت Tickets/Socials/Calls → به‌روزرسانی ستون‌های محاسباتی
  // این تابع خودکار بعد هر ویرایش اجرا می‌شود (Trigger ساده)
  try {
    const sheetName = e.range.getSheet().getName();
    if ([SHEET_NAMES.tickets, SHEET_NAMES.socials].indexOf(sheetName) === -1) return;
    // اینجا می‌توان محاسبات SLA/نمره را به‌صورت فرمول شیت اضافه کرد
    // فعلاً فقط لاگ
    console.log('ویرایش در ' + sheetName + ' ردیف ' + e.range.getRow());
  } catch(err) {}
}

// ---------- داشبورد داخل شیت ----------
function buildDashboard(tickets, socials, calls, agents) {
  const now = new Date();
  return {
    generatedAt: now.toISOString(),
    counts: {
      agents: agents.length,
      tickets: tickets.length,
      socials: socials.length,
      calls: calls.length
    },
    ticketsAvg: avg(tickets.map(t => parseFloat(t.score)).filter(n => !isNaN(n))),
    socialsAvg: avg(socials.map(s => parseFloat(s.score)).filter(n => !isNaN(n))),
    callsAvg: avg(calls.map(c => parseFloat(c.score)).filter(n => !isNaN(n))),
    topAgents: groupAvg(tickets.concat(socials).concat(calls), 'agentName', 'score').slice(0,5),
    recentTickets: tickets.slice(-5)
  };
}

function avg(arr) {
  if (!arr.length) return null;
  return Math.round(arr.reduce((a,b)=>a+b,0)/arr.length * 10)/10;
}

function groupAvg(rows, nameKey, scoreKey) {
  const map = {};
  rows.forEach(r => {
    const name = r[nameKey] || r.expertName || '';
    if (!name) return;
    if (!map[name]) map[name] = [];
    const sc = parseFloat(r[scoreKey]);
    if (!isNaN(sc)) map[name].push(sc);
  });
  return Object.keys(map).map(name => ({
    name: name,
    avg: avg(map[name]),
    count: map[name].length
  })).sort((a,b)=>b.avg - a.avg);
}

// ---------- سایدبار ----------
function showSidebar() {
  const html = HtmlService.createHtmlOutput(`
    <div style="font-family:Vazirmatn,sans-serif; padding:16px; direction:rtl">
      <h3 style="color:#1a73e8">📊 داشبورد QC</h3>
      <div id="content">در حال بارگذاری...</div>
      <button onclick="load()" style="background:#1a73e8;color:white;border:none;padding:8px 16px;border-radius:6px;cursor:pointer;margin-top:12px">🔄 بروزرسانی</button>
      <script>
        function load(){
          google.script.run.withSuccessHandler(data=>{
            document.getElementById('content').innerHTML = 
              '<p>کارشناسان: <b>'+data.counts.agents+'</b></p>'+
              '<p>تیکت‌ها: <b>'+data.counts.tickets+'</b> (میانگین: '+(data.ticketsAvg==null?'—':data.ticketsAvg)+')</p>'+
              '<p>سوشال: <b>'+data.counts.socials+'</b> (میانگین: '+(data.socialsAvg==null?'—':data.socialsAvg)+')</p>'+
              '<p>تماس: <b>'+data.counts.calls+'</b> (میانگین: '+(data.callsAvg==null?'—':data.callsAvg)+')</p>'+
              '<hr><p style="font-size:12px;color:#666">آخرین بروزرسانی: '+new Date(data.generatedAt).toLocaleString('fa-IR')+'</p>';
          }).buildDashboardForSidebar();
        }
        load();
      <\/script>
    </div>
  `).setTitle('داشبورد QC');
  SpreadsheetApp.getUi().showSidebar(html);
}

function buildDashboardForSidebar() {
  return buildDashboard(
    readSheet(SHEET_NAMES.tickets),
    readSheet(SHEET_NAMES.socials),
    readSheet(SHEET_NAMES.calls),
    readSheet(SHEET_NAMES.agents)
  );
}

// ---------- تولید گزارش ----------
function reportRows_() {
  const tickets = readSheet(SHEET_NAMES.tickets);
  const socials = readSheet(SHEET_NAMES.socials);
  const calls = readSheet(SHEET_NAMES.calls);
  const agents = readSheet(SHEET_NAMES.agents);
  const allNames = [...new Set([...tickets.map(t=>t.agentName), ...socials.map(s=>s.agentName), ...calls.map(c=>c.expertName)].filter(Boolean))];
  const average = rows => { const value = avg(rows.map(x=>parseFloat(x.score)).filter(n=>!isNaN(n))); return value == null ? '—' : value; };
  return allNames.map(name => {
    const t = tickets.filter(x=>x.agentName===name);
    const s = socials.filter(x=>x.agentName===name);
    const c = calls.filter(x=>x.expertName===name);
    return {
      'کارشناس': name, 'تیم': (agents.find(a=>a.name===name)||{}).team || '',
      'تعداد تیکت': t.length, 'میانگین تیکت': average(t),
      'تعداد سوشال': s.length, 'میانگین سوشال': average(s),
      'تعداد تماس': c.length, 'میانگین تماس': average(c),
      'مجموع ارزیابی': t.length + s.length + c.length
    };
  });
}

function writeReport_() {
  const rows = reportRows_();
  const headers = ['کارشناس','تیم','تعداد تیکت','میانگین تیکت','تعداد سوشال','میانگین سوشال','تعداد تماس','میانگین تماس','مجموع ارزیابی'];
  let sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAMES.reports);
  if (!sh) sh = SpreadsheetApp.getActiveSpreadsheet().insertSheet(SHEET_NAMES.reports);
  sh.clear();
  const values = [headers].concat(rows.map(r => headers.map(h => safeCellValue(r[h]))));
  sh.getRange(1,1,values.length,headers.length).setValues(values);
  sh.getRange(1,1,1,headers.length).setFontWeight('bold').setBackground('#34a853').setFontColor('white');
  sh.setFrozenRows(1);
  sh.autoResizeColumns(1,headers.length);
  return rows.length;
}

function generateReport() {
  const count = writeReport_();
  SpreadsheetApp.getUi().alert('✅ گزارش در شیت "Reports" ساخته شد (' + count + ' کارشناس)');
}
function refreshReportSilently() { writeReport_(); }
function createSixHourReportTrigger() {
  ScriptApp.getProjectTriggers().filter(trigger => trigger.getHandlerFunction() === 'refreshReportSilently').forEach(trigger => ScriptApp.deleteTrigger(trigger));
  ScriptApp.newTrigger('refreshReportSilently').timeBased().everyHours(6).create();
  SpreadsheetApp.getUi().alert('گزارش خودکار هر ۶ ساعت فعال شد.');
}

// ---------- داده نمونه ----------
function insertDemoData() {
  const demoAgents = [
    {id:'1', name:'علی احمدی', team:'Tele sales', ext:'3001', active:'1'},
    {id:'2', name:'سارا حسینی', team:'Account', ext:'3002', active:'1'},
    {id:'3', name:'محمد رضایی', team:'MLM', ext:'3003', active:'1'}
  ];
  const demoTickets = [
    {id:'1', reviewDate:'1405/07/01', ticketDate:'1405/06/30', agentName:'علی احمدی', team:'Tele sales', ticketCode:'T-1001', q1:'1', q2:'1', q3:'0', q4:'1', redline:'0', score:'75', comment:'نمونه', qcAgent:'هادی'},
    {id:'2', reviewDate:'1405/07/02', ticketDate:'1405/07/01', agentName:'سارا حسینی', team:'Account', ticketCode:'T-1002', q1:'1', q2:'0', q3:'1', q4:'1', redline:'0', score:'70', comment:'نمونه', qcAgent:'مبینا'}
  ];
  const demoCalls = [
    {expertName:'علی احمدی', score:'85', redline:'0', redlineReason:'', leadName:'مشتری نمونه', leadPhone:'09123456789', listeningTime:'00:05:00', reviewDate:'1405/07/01', formType:'tele', qcAgent:'هادی', qcComment:'عالی', elements:'{}', sourceFile:'demo'}
  ];
  writeSheet(SHEET_NAMES.agents, demoAgents, HEADERS.agents);
  writeSheet(SHEET_NAMES.tickets, demoTickets, HEADERS.tickets);
  writeSheet(SHEET_NAMES.calls, demoCalls, HEADERS.calls);
  SpreadsheetApp.getUi().alert('✅ داده نمونه وارد شد');
}

// ---------- خروجی/ورودی JSON ----------
function exportJson() {
  const data = {};
  Object.keys(HEADERS).forEach(key => { data[key] = readSheet(SHEET_NAMES[key]); });
  const json = JSON.stringify(data, null, 2).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const html = HtmlService.createHtmlOutput('<textarea style="width:100%;height:400px;direction:ltr">'+json+'</textarea><p>کپی کنید</p>').setWidth(600).setHeight(500);
  SpreadsheetApp.getUi().showModalDialog(html, 'خروجی JSON');
}

function importJsonDialog() {
  const html = HtmlService.createHtmlOutput(`
    <div style="direction:rtl; font-family:sans-serif; padding:12px">
      <p>JSON را اینجا بگذارید و ذخیره بزنید:</p>
      <textarea id="j" style="width:100%;height:300px;direction:ltr"></textarea><br>
      <button onclick="save()" style="background:#1a73e8;color:white;padding:8px 16px;border:none;border-radius:6px;margin-top:8px">ذخیره در شیت</button>
      <div id="msg"></div>
      <script>
        function save(){
          const v = document.getElementById('j').value;
          google.script.run.withSuccessHandler(m=>{
            document.getElementById('msg').innerText = m;
          }).withFailureHandler(e=>{
            document.getElementById('msg').innerText = 'خطا: '+e.message;
          }).importJsonFromText(v);
        }
      <\/script>
    </div>
  `).setWidth(600).setHeight(500);
  SpreadsheetApp.getUi().showModalDialog(html, 'ورود JSON');
}

function importJsonFromText(text) {
  const data = JSON.parse(text);
  Object.keys(HEADERS).forEach(key => {
    if (data[key] && Array.isArray(data[key])) {
      writeSheet(SHEET_NAMES[key], data[key], HEADERS[key]);
    }
  });
  return '✅ وارد شد';
}

function showWebAppUrl() {
  SpreadsheetApp.getUi().alert('برای اتصال Web App:\n\n1. منوی «سامانه QC» → راه‌اندازی / چرخش توکن API؛ توکن را کپی کن.\n2. Deploy → New deployment → Web app\n3. Execute as: Me؛ دسترسی را طبق سیاست سازمانت انتخاب کن.\n4. Deploy و URL را کپی کن.\n5. در صفحه «اتصال به گوگل شیت» سرور، URL و توکن را وارد کن.\n\nلینک را فقط به افراد مجاز بده؛ بدون توکن API، خواندن و نوشتن ممکن نیست.');
}

// ---------- Trigger خودکار (اختیاری) ----------
// هر ساعت یکبار گزارش خودکار در شیت Reports
function createHourlyTrigger() {
  ScriptApp.newTrigger('generateReport').timeBased().everyHours(6).create();
}
