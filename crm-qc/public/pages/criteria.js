/* تنظیم نام/ستون و افزودن/حذف المان‌های ریت تماس برای هر تیم. */
(function(){
'use strict';
const { $, $$, api, esc, fa, toast, confirmDlg } = UI;
const P = window.QCParse;
const LABEL = { tele:'Telesales', account:'Account', mlm:'MLM / BNPL' };
/* فقط این چهار تیم؛ هر تیم تنظیم المان‌های اختصاصی خودش را دارد. */
const TEAMS = [
  { team:'Account', title:'اکانت' },
  { team:'Tele sales', title:'تله' },
  { team:'BNPL', title:'بی ان پی ال' },
  { team:'MLM', title:'ام ال ام' }
];
const TEAM_TITLE = Object.fromEntries(TEAMS.map(t => [t.team, t.title]));
async function render(root) {
  const response = await api.get('/api/criteria');
  if (!root.isConnected) return;
  let config = response.config, selected = { form:'account', team:'Account' }, dirty = false, definitions = [];
  const options = TEAMS.map(t => ({ team:t.team, form:P.teamForm(t.team) || 'tele', title:t.title, sub:t.team }));
  root.innerHTML = `<div class="page-head"><div class="ph-ic"><i class="fa-solid fa-sliders"></i></div>
    <div><h2>تغییر المان‌ها</h2><p>نام نمایشی، ستون اکسل و المان‌های فعال ریت تماس هر تیم</p></div></div>
    <div class="note"><i class="fa-solid fa-shield-halved"></i><span>مقادیر واقعی فرم <b>1 / 0 / -</b> مبنای نرخ‌ها هستند. «-» در مخرج نرخ نیست و سلول خالی صفر محسوب نمی‌شود. نمره‌ی کلیِ اصلی اکسل و ریت‌های قبلی بازنویسی نمی‌شوند.</span></div>
    <div class="criteria-layout"><aside class="card criteria-team-list" id="criteriaTeams"></aside>
      <div class="card"><div class="card-head"><div class="head-icon"><i class="fa-solid fa-list-check"></i></div>
        <div><h3 id="criteriaTitle"></h3><div class="sub" id="criteriaCaption"></div></div><div class="spacer"></div>
        <button class="btn soft" id="criterionAdd"><i class="fa-solid fa-plus"></i> المان جدید</button></div>
        <div class="card-pad"><div class="field" id="criteriaFormSlot"><label>نوع فرم این تیم</label><select class="input" id="criteriaForm">${Object.keys(LABEL).map(f=>`<option value="${f}">${LABEL[f]}</option>`).join('')}</select></div></div>
        <div class="table-wrap"><table class="tbl"><thead><tr><th>نام المان در گزارش</th><th>نام ستون در اکسل دیتا</th><th>عملیات</th></tr></thead><tbody id="criteriaRows"></tbody></table></div>
        <div class="card-pad"><div class="criteria-status" id="criteriaStatus"></div><div style="display:flex;gap:10px;margin-top:14px;flex-wrap:wrap">
          <button class="btn primary" id="criteriaSave"><i class="fa-solid fa-floppy-disk"></i> ذخیره تغییرات</button>
          <button class="btn ghost" id="criteriaCancel">لغو تغییرات</button><button class="btn success-soft" id="criteriaTemplate"><i class="fa-solid fa-file-excel"></i> نمونه اکسل این فرم</button></div>
          <details class="criteria-retired"><summary>المان‌های حذف‌شده؛ حفظ شناسه برای سوابق</summary><div id="criteriaRetired"></div></details></div>
      </div></div>`;
  $('#criteriaTeams',root).innerHTML = options.map((o,index)=>`<button class="criteria-team" data-option="${index}"><i class="fa-solid ${o.form==='tele'?'fa-phone':o.form==='account'?'fa-building-columns':'fa-cart-shopping'}"></i><span>${esc(o.title)}<small>${esc(o.sub)}</small></span></button>`).join('');
  function changed(){ dirty=true; $('#criteriaStatus',root).textContent='تغییرات هنوز ذخیره نشده‌اند'; }
  function readInputs(){ $$('#criteriaRows tr',root).forEach(row=>{
    const definition = definitions.find(d=>d.key===row.dataset.key);
    if(definition){definition.label=$('[data-label]',row).value;definition.excelKey=$('[data-column]',row).value;}
  }); }
  function paint(){
    $('#criteriaTitle',root).textContent = TEAM_TITLE[selected.team] || P.displayTeam(selected.team);
    $('#criteriaCaption',root).textContent = 'نسخه '+fa(config.version||0)+' · '+fa(definitions.filter(d=>d.active!==false).length)+' المان فعال · تغییر نام ستون برای ورودی‌های بعدی؛ نام قبلی نیز شناخته می‌شود';
    $('#criteriaForm',root).value=selected.form; $('#criteriaFormSlot',root).hidden=!selected.team;
    $$('#criteriaTeams button',root).forEach(button=>{const o=options[Number(button.dataset.option)];button.classList.toggle('active',o.team===selected.team&&(!o.team?o.form===selected.form:true));});
    $('#criteriaRows',root).innerHTML=definitions.filter(d=>d.active!==false).map(d=>`<tr class="criteria-row" data-key="${esc(d.key)}">
      <td><input class="input" data-label value="${esc(d.label)}" aria-label="نام المان"></td><td><input class="input" data-column dir="auto" value="${esc(d.excelKey)}" aria-label="نام ستون اکسل"></td>
      <td><button class="btn danger-soft sm" data-delete="${esc(d.key)}" aria-label="حذف ${esc(d.label)}"><i class="fa-solid fa-trash-can"></i></button></td></tr>`).join('') || '<tr><td colspan="3">المانی فعال نیست؛ نمره‌ی اصلی محفوظ است و نرخ المان محاسبه نمی‌شود.</td></tr>';
    $('#criteriaRetired',root).innerHTML=definitions.filter(d=>d.active===false).map(d=>`<div style="display:flex;gap:10px;align-items:center;margin-top:9px"><span style="flex:1">${esc(d.label)} <code>${esc(d.excelKey)}</code></span><button class="btn ghost sm" data-restore="${esc(d.key)}">فعال‌سازی دوباره</button></div>`).join('') || 'موردی نیست';
    $$('#criteriaRows input',root).forEach(input=>input.addEventListener('input',changed));
    $$('[data-delete]',root).forEach(button=>button.addEventListener('click',()=>{
      readInputs();const d=definitions.find(d=>d.key===button.dataset.delete);
      confirmDlg('حذف المان از فرم فعال',`«${d.label}» از نرخ‌های فعال حذف می‌شود؛ مقادیر تاریخی آن پاک نمی‌شوند.`,()=>{d.active=false;changed();paint();},'حذف از المان‌های فعال');
    }));
    $$('[data-restore]',root).forEach(button=>button.addEventListener('click',()=>{readInputs();definitions.find(d=>d.key===button.dataset.restore).active=true;changed();paint();}));
  }
  function choose(option){
    if(dirty&&!confirm('تغییرات ذخیره نشده‌اند؛ بدون ذخیره ادامه می‌دهید؟'))return;
    selected={team:option.team,form:option.form};
    const entry=config.teams&&config.teams[P.teamKey(selected.team)];if(entry)selected.form=entry.form;
    definitions=JSON.parse(JSON.stringify(P.definitionsFor(selected.form,selected.team,config)));dirty=false;
    $('#criteriaStatus',root).textContent='تنظیمات ذخیره‌شده';paint();
  }
  $$('#criteriaTeams button',root).forEach(button=>button.addEventListener('click',()=>choose(options[Number(button.dataset.option)])));
  $('#criteriaForm',root).addEventListener('change',()=>{readInputs();selected.form=$('#criteriaForm',root).value;definitions=P.defaults(selected.form);changed();paint();});
  $('#criterionAdd',root).addEventListener('click',()=>{readInputs();definitions.push({key:'custom_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,8),label:'المان جدید',excelKey:'new_criterion_'+(definitions.length+1),active:true});changed();paint();});
  $('#criteriaCancel',root).addEventListener('click',()=>{dirty=false;choose(selected);});
  $('#criteriaSave',root).addEventListener('click',async()=>{
    const button=$('#criteriaSave',root);readInputs();button.disabled=true;
    try{
      const result=await api.put('/api/criteria',{team:selected.team,form:selected.form,elements:definitions,version:config.version||0});
      config=result.config;dirty=false;await App.boot();definitions=JSON.parse(JSON.stringify(P.definitionsFor(selected.form,selected.team,config)));
      $('#criteriaStatus',root).textContent='ذخیره شد؛ گزارش‌ها و ورودی‌های بعدی از این تنظیمات استفاده می‌کنند';paint();toast.success('تنظیمات المان‌ها ذخیره شد');
    }catch(e){toast.error(e.message);}finally{button.disabled=false;}
  });
  $('#criteriaTemplate',root).addEventListener('click',()=>{
    const active=P.definitionsFor(selected.form,selected.team,config).filter(d=>d.active!==false);
    QCExport.sheets('نمونه ریت '+LABEL[selected.form],[{name:'دیتا',rows:[['tele_expert_name','review_date','score','lead_name','lead_phone','red_line',...active.map(d=>d.excelKey)],['نام واقعی کارشناس','1405/06/20',100,'نام شریک','09120000000',0,...active.map(()=>1)]]}]);
  });
  choose(options[0]);
}

App.register('criteria',{title:'تغییر المان‌ها',render});
})();
