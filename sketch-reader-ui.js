/* Manual sketch reading. Draft edits stay local until explicit server approval. */
(function(){
 'use strict';
 let active=null,host=null,returnFocus=null;
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const catalog=()=>typeof skuCatalogMap==='object'?skuCatalogMap:{};
 function error(message){
  const el=host?.querySelector('.sr-error');if(!el)return;
  el.textContent=message;el.hidden=false;el.focus();
 }
 function close(){
  if(active?.busy)return;
  if(active?.dirty&&!confirm('התיקונים בטיוטה עדיין לא אושרו ולא נשמרו. לצאת בלי לשמור אותם?'))return;
  host?.remove();host=null;active=null;
  returnFocus?.focus();
 }
 async function checkSource(a){
  if(!a.draft)return;
  const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(a.image||''));
  a.sourceMatches=Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('')===a.draft.sourceHash;
 }
 async function bounded(fn){
  let timer;
  try{return await Promise.race([fn(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('הבקשה התעכבה. פתח מחדש את הטיוטה לפני ניסיון נוסף; ייתכן שהקריאה כבר נשמרה.')),65000);})]);}
  finally{clearTimeout(timer);}
 }
 async function api(payload){
  const res=await bounded(()=>_lgAuthPost('/api/sketch-reader',payload));
  const data=await bounded(()=>res.json());
  if(!res.ok)throw new Error(data.error||'הפעולה נכשלה');
  return data;
 }
 function skuPicker(key,sku,entries){
  const entry=entries.find(([id])=>id===sku);
  return '<div class="sr-picker"><label>חיפוש מק״ט או שם זכוכית<input type="search" data-sku-search="'+key+'" aria-label="חיפוש מק״ט '+(key==='all'?'לכל הפריטים':'לחלק '+(Number(key)+1))+'" placeholder="הקלד מק״ט או שם…" autocomplete="off"></label><p class="sr-selected" data-selected="'+key+'">'+esc(entry?entry[0]+' · '+entry[1].name:'טרם נבחר מק״ט')+'</p><div class="sr-results" data-results="'+key+'" hidden></div></div>';
 }
 function searchSkus(input){
  const key=input.dataset.skuSearch,box=host.querySelector('[data-results="'+key+'"]'),q=input.value.trim().toLocaleLowerCase();
  const matches=Object.entries(catalog()).filter(([sku,e])=>e&&e.active!==false&&e.name&&e.glass&&e.mm&&(!q||(sku+' '+e.name).toLocaleLowerCase().includes(q)));
  box.hidden=false;
  box.innerHTML=matches.slice(0,40).map(([sku,e])=>'<button type="button" data-sr="pick-sku" data-picker="'+key+'" data-sku="'+esc(sku)+'">'+esc(sku+' · '+e.name)+'</button>').join('')+(matches.length>40?'<p>הקלד עוד כדי לצמצם את התוצאות.</p>':'')+(!matches.length?'<p>לא נמצאו מק״טים. נסה מספר או שם אחר.</p>':'');
 }
 function render(){
  if(!host||!active)return;
  const a=active,draft=a.draft,reading=draft?.reading;
  const entries=Object.entries(catalog()).filter(([,e])=>e&&e.active!==false&&e.name&&e.glass&&e.mm);
  host.innerHTML='<section class="sr-panel" role="dialog" aria-modal="true" aria-labelledby="sr-title" dir="rtl" tabindex="-1">'+
   '<header class="sr-head"><div><h2 id="sr-title">קריאת סקיצה</h2><p>'+esc(a.title||'בדיקת פריטים לפני אישור')+'</p></div>'+
   '<button type="button" data-sr="close" aria-label="סגירת טיוטת הפענוח" '+(a.busy?'disabled':'')+'>סגור</button></header>'+
   '<div class="sr-body"><div class="sr-error" role="alert" tabindex="-1" hidden></div>'+
   '<p class="sr-status" role="status">'+(a.busy?'קורא את הסקיצה… אפשר להמתין כאן.':reading?(draft.approved?'הטיוטה הזו כבר אושרה. לקריאה נוספת לחץ קרא מחדש.':'טיוטה לבדיקה — הפריטים בהזמנה עדיין לא השתנו.'):'הקריאה תציע פריטים מהתמונה. בדוק ותקן לפני אישור.')+'</p>'+
   (reading?'<p class="sr-metrics">'+(Number.isFinite(draft.elapsedMs)?'זמן קריאה: '+(draft.elapsedMs/1000).toFixed(1)+' שניות. ':'')+(Number.isFinite(draft.costEstimateUsd)?'עלות משוערת: '+draft.costEstimateUsd.toFixed(4)+' דולר, לפני מסים.':'')+'</p>':'')+
   '<div class="sr-layout"><div class="sr-image"><button type="button" data-sr="zoom" aria-expanded="false">הגדל סקיצה</button>'+(a.image?'<img src="'+esc(a.image)+'" alt="הסקיצה המקורית להשוואה">':'')+'</div><div class="sr-edit">'+
   (reading?((reading.warnings||[]).length?'<p class="sr-warning">דורש בדיקה</p>':'')+
    (a.rows.length?'':'<p class="sr-warning">לא זוהו פריטים בתמונה. בדוק את ההערות; אפשר לקרוא מחדש או להוסיף חלקים ידנית.</p>')+
    '<p>כל המידות כאן במ״מ. בדוק סוג זכוכית, מידות מרביות וכמות מול הסקיצה.</p>'+
    '<div class="sr-bulk"><h3>מק״ט משותף לכל הפריטים</h3><p>בחר מק״ט ולחץ להחלה. אפשר לשנות אחר כך בכל חלק בנפרד.</p>'+skuPicker('all',a.bulkSku,entries)+'<button type="button" data-sr="apply-sku" '+(!a.bulkSku?'disabled':'')+'>החל על כל '+a.rows.length+' הפריטים</button><p class="sr-bulk-status" role="status"></p></div><h3>פריטים לבדיקה ('+a.rows.length+')</h3><div class="sr-rows">'+a.rows.map((r,i)=>'<fieldset class="sr-row"><legend>'+esc(r.label||'חלק '+(i+1))+'</legend>'+
     '<p class="sr-evidence">'+esc(r.evidence)+'</p>'+
     ((r.warnings||[]).length?'<p class="sr-warning">דורש בדיקה</p>':'')+
     skuPicker(String(i),r.sku,entries)+
     '<div class="sr-dims">'+[['widthMm','רוחב במ״מ'],['heightMm','גובה במ״מ'],['quantity','כמות']].map(([f,label])=>
      '<label>'+label+'<input type="number" inputmode="'+(f==='quantity'?'numeric':'decimal')+'" min="0.1" step="'+(f==='quantity'?'1':'0.1')+'" data-row="'+i+'" data-field="'+f+'" aria-label="'+label+' לחלק '+(i+1)+'" value="'+esc(r[f]??'')+'"></label>').join('')+'</div>'+
     '<button type="button" data-sr="remove" data-index="'+i+'">הסר חלק זה</button></fieldset>').join('')+'</div>'+
    '<button type="button" data-sr="add">הוסף חלק חסר</button>'+
    '<label class="sr-ack"><input type="checkbox" id="sr-ack">בדקתי את כל החלקים והאזהרות מול הסקיצה. אישור יחליף את הפריטים הקיימים בהזמנה ('+esc(draft.existingItemCount)+' יחידות).</label>':
    '<button type="button" class="sr-primary" data-sr="read" '+(a.busy?'disabled':'')+'>קרא סקיצה</button>')+
   '</div></div></div><footer class="sr-foot"><button type="button" data-sr="close" '+(a.busy?'disabled':'')+'>חזור בלי לשנות</button>'+
   (reading?'<button type="button" data-sr="reread" '+(a.busy?'disabled':'')+'>קרא מחדש</button><button type="button" class="sr-primary" data-sr="approve" '+(a.busy||draft.approved||a.sourceMatches===false?'disabled':'')+'>אשר פריטים להזמנה</button>':'')+'</footer></section>';
  host.querySelector('[role="dialog"]')?.focus();
 }
 async function read(force){
  if(!active||active.busy)return;
  const a=active;
  if(force&&!confirm('לקרוא את הסקיצה מחדש? זו קריאה נוספת בתשלום ותיקוני הטיוטה יוחלפו.'))return;
  a.busy=true;render();
  try{
   const data=await api({action:'read',orderId:a.orderId,requestId:crypto.randomUUID(),force:!!force});
   if(active!==a)return;
   a.draft=data.draft;a.rows=structuredClone(data.draft.reading.rows);a.dirty=false;await checkSource(a);
   a.busy=false;render();if(!a.sourceMatches)error('התמונה השתנתה בזמן הקריאה. רענן את הדף לפני אישור.');
  }catch(e){if(active===a){a.busy=false;render();error(e.message);}}
 }
 async function approve(){
  const a=active;
  if(!a||a.busy)return;
  if(a.draft?.approved||a.sourceMatches===false){error('יש לרענן או לקרוא מחדש לפני אישור');return;}
  if(!host.querySelector('#sr-ack')?.checked){error('יש לבדוק ולאשר את כל החלקים והאזהרות');return;}
  if(!a.rows.length){error('נדרש לפחות חלק אחד');return;}
  const bad=a.rows.findIndex(r=>!r.sku||!catalog()[r.sku]||!Number.isFinite(r.widthMm)||r.widthMm<=0||r.widthMm>10000||
   !Number.isFinite(r.heightMm)||r.heightMm<=0||r.heightMm>10000||!Number.isInteger(r.quantity)||r.quantity<1||r.quantity>500);
  if(bad>=0){
   error('יש להשלים מק״ט, מידות במ״מ וכמות בחלק '+(bad+1));
   const field=host.querySelector('.sr-row:nth-child('+(bad+1)+') input');
   field?.setAttribute('aria-invalid','true');return;
  }
  a.busy=true;render();
  try{
   const data=await api({action:'approve',orderId:a.orderId,runId:a.draft.runId,rows:a.rows,acknowledged: true});
   if(active!==a)return;
   a.busy=false;a.dirty=false;
   const callback=a.onApproved;close();callback?.(data);
  }catch(e){if(active===a){a.busy=false;render();error(e.message);}}
 }
 async function open(options){
  if(active)return;
  returnFocus=document.activeElement;
  active={...options,rows:[],busy:true,draft:null};const a=active;
  host=document.createElement('div');host.className='sr-overlay';
  document.body.appendChild(host);render();
  host.addEventListener('input',e=>{
   if(e.target.dataset.skuSearch!==undefined){if(!active?.busy)searchSkus(e.target);return;}
   const field=e.target.dataset.field;
   if(!field||active?.busy)return;
   const row=active.rows[Number(e.target.dataset.row)];if(!row)return;
   active.dirty=true;
   row[field]=field==='sku'?(e.target.value||null):(e.target.value===''?null:Number(e.target.value));
   const ack=host.querySelector('#sr-ack');if(ack)ack.checked=false;
   e.target.removeAttribute('aria-invalid');
  });
  host.addEventListener('focusin',e=>{if(e.target.dataset.skuSearch!==undefined&&!active?.busy)searchSkus(e.target);});
  host.addEventListener('click',e=>{
   const button=e.target.closest('[data-sr]');if(!button||active?.busy)return;
   switch(button.dataset.sr){
    case 'zoom':{
     const image=host.querySelector('.sr-image'),expanded=image.classList.toggle('sr-image-expanded');
     button.textContent=expanded?'חזור לפריטים':'הגדל סקיצה';button.setAttribute('aria-expanded',String(expanded));break;
    }
    case 'pick-sku':{
     const key=button.dataset.picker,sku=button.dataset.sku;
     if(key==='all'){active.bulkSku=sku;host.querySelector('[data-sr="apply-sku"]').disabled=false;}
     else{active.rows[Number(key)].sku=sku;active.dirty=true;const ack=host.querySelector('#sr-ack');if(ack)ack.checked=false;}
     host.querySelector('[data-selected="'+key+'"]').textContent=sku+' · '+catalog()[sku].name;
     host.querySelector('[data-results="'+key+'"]').hidden=true;
     const input=host.querySelector('[data-sku-search="'+key+'"]');input.value='';input.focus();host.querySelector('[data-results="'+key+'"]').hidden=true;break;
    }
    case 'apply-sku':{
     if(!active.bulkSku)break;
     if(active.rows.some(r=>r.sku&&r.sku!==active.bulkSku)&&!confirm('להחליף את המק״ט בכל הפריטים, כולל פריטים שבהם כבר נבחר מק״ט אחר?'))break;
     active.rows.forEach(r=>{r.sku=active.bulkSku;});active.dirty=true;render();
     host.querySelector('.sr-bulk-status').textContent='המק״ט הוחל על כל הפריטים. ניתן לשנות בכל חלק בנפרד.';break;
    }
    case 'close':close();break;
    case 'read':read(false);break;
    case 'reread':read(true);break;
    case 'approve':approve();break;
    case 'remove':active.dirty=true;active.rows.splice(Number(button.dataset.index),1);render();break;
    case 'add':active.dirty=true;active.rows.push({label:'חלק נוסף',sku:null,widthMm:null,heightMm:null,quantity:null,evidence:'נוסף ידנית',warnings:[]});render();break;
   }
  });
  host.addEventListener('keydown',e=>{
   e.stopPropagation();
   if(e.key==='Escape'){e.preventDefault();close();}
   if(e.key==='Tab'){
    const els=[...host.querySelectorAll('button:not([disabled]),input,select,[tabindex="0"]')];
    const first=els[0],last=els.at(-1);
    if(e.shiftKey&&(document.activeElement===first||document.activeElement===host.querySelector('[role="dialog"]'))){e.preventDefault();last?.focus();}
    else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}
   }
  });
  try{
   // Restore draft without calling the paid provider.
   const res=await bounded(()=>_lgAuthFetch('/api/sketch-reader?orderId='+encodeURIComponent(a.orderId)));
   const data=await res.json();if(!res.ok)throw new Error(data.error||'טעינת הטיוטה נכשלה');
   if(active!==a)return;
   a.draft=data.draft;a.rows=structuredClone(data.draft?.reading?.rows||[]);await checkSource(a);a.busy=false;
   if(data.enabled&&a.readOnOpen&&(!a.draft||a.draft.needsReread)){await read(false);return;}
   render();
   if(a.draft&&!a.sourceMatches)error('התמונה אינה תואמת לטיוטה השמורה. אפשר לקרוא מחדש, או לרענן את הדף אם הסקיצה נערכה.');
   if(!data.enabled&&!data.draft)error('קריאת סקיצות עדיין לא הופעלה בסביבה הזו. אפשר להמשיך להזין פריטים ידנית.');
  }catch(e){if(active===a){a.busy=false;render();error(e.message);}}
 }
 window.lgSketchReader={open,close};
})();
