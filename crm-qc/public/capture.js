/* عکس کامل پرونده: تمام سوابق/جداول؛ بدون قطع‌شدن در ناحیه‌ی اسکرول. */
(function(){
'use strict';
async function download(source, filename, prepare) {
  if (!source || !source.isConnected) throw new Error('پرونده‌ی آماده‌ای برای عکس وجود ندارد');
  if (typeof window.html2canvas !== 'function') throw new Error('کتابخانه‌ی عکس بارگذاری نشده است');
  const host=document.createElement('div');host.className='capture-host';host.dataset.theme=document.documentElement.dataset.theme||'dark';
  const css=getComputedStyle(document.documentElement);
  ['bg','bg-2','panel','panel-2','panel-soft','soft','line','line-soft','border','ink','ink-2','muted','brand','brand-soft','violet','violet-soft','good','good-soft','bad','bad-soft','warn','warn-soft'].forEach(key=>host.style.setProperty('--'+key,css.getPropertyValue('--'+key)));
  const copy=source.cloneNode(true);host.appendChild(copy);
  const originals=[...source.querySelectorAll('canvas')], canvases=[...copy.querySelectorAll('canvas')];
  originals.forEach((canvas,index)=>{
    const image=document.createElement('img');image.src=canvas.toDataURL('image/png');
    image.style.cssText='width:100%;height:260px;object-fit:contain';canvases[index].replaceWith(image);
  });
  if(prepare)prepare(copy);
  document.body.appendChild(host);
  try {
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
    const width=host.scrollWidth,height=host.scrollHeight;
    const scale=Math.min(1.5,30000/height,4000/width,Math.sqrt(24000000/(width*height)));
    if(scale<0.45)UI.toast.info('این بازه سوابق زیادی دارد؛ تصویر کامل طولانی است. برای بررسی ریز مقادیر، خروجی اکسل هم قابل دانلود است.',6000);
    const canvas=await html2canvas(host,{backgroundColor:getComputedStyle(document.documentElement).getPropertyValue('--bg').trim(),scale,useCORS:true,logging:false,width,height,windowWidth:1600,windowHeight:Math.max(1000,height)});
    const blob=await new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('ساخت فایل عکس ممکن نشد')),'image/png'));
    const url=URL.createObjectURL(blob),anchor=document.createElement('a');anchor.href=url;anchor.download=filename.replace(/[\\/:*?"<>|]/g,'-')+'.png';document.body.appendChild(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),1500);
    return { width:canvas.width,height:canvas.height };
  }finally{host.remove();}
}
window.QCCapture={download};
})();
