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
   '<div class="sr-layout"><div class="sr-image">'+(a.image?'<img src="'+esc(a.image)+'" alt="הסקיצה המקורית להשוואה">':'')+'</div><div class="sr-edit">'+
   (reading?'<div class="sr-warnings">'+(reading.warnings||[]).map(w=>'<p>דורש בדיקה: '+esc(w)+'</p>').join('')+'</div>'+
    (a.rows.length?'':'<p class="sr-warning">לא זוהו פריטים בתמונה. בדוק את ההערות; אפשר לקרוא מחדש או להוסיף חלקים ידנית.</p>')+
    '<p>כל המידות כאן במ״מ. בדוק סוג זכוכית, מידות מרביות וכמות מול הסקיצה.</p>'+
    '<div class="sr-rows">'+a.rows.map((r,i)=>'<fieldset class="sr-row"><legend>'+esc(r.label||'חלק '+(i+1))+'</legend>'+
     '<p class="sr-evidence">'+esc(r.evidence)+'</p>'+
     (r.warnings||[]).map(w=>'<p class="sr-warning">דורש בדיקה: '+esc(w)+'</p>').join('')+
     '<label>מק״ט וסוג זכוכית<select data-row="'+i+'" data-field="sku" aria-label="מק״ט לחלק '+(i+1)+'"><option value="">בחר מק״ט</option>'+
     entries.map(([sku,e])=>'<option value="'+esc(sku)+'" '+(sku===r.sku?'selected':'')+'>'+esc(sku+' · '+e.name)+'</option>').join('')+'</select></label>'+
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
   const field=e.target.dataset.field;
   if(!field||active?.busy)return;
   const row=active.rows[Number(e.target.dataset.row)];if(!row)return;
   active.dirty=true;
   row[field]=field==='sku'?(e.target.value||null):(e.target.value===''?null:Number(e.target.value));
   const ack=host.querySelector('#sr-ack');if(ack)ack.checked=false;
   e.target.removeAttribute('aria-invalid');
  });
  host.addEventListener('click',e=>{
   const button=e.target.closest('[data-sr]');if(!button||active?.busy)return;
   switch(button.dataset.sr){
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
   if(!a.draft&&data.enabled&&a.readOnOpen){await read(false);return;}
   render();
   if(a.draft&&!a.sourceMatches)error('התמונה אינה תואמת לטיוטה השמורה. אפשר לקרוא מחדש, או לרענן את הדף אם הסקיצה נערכה.');
   if(!data.enabled&&!data.draft)error('קריאת סקיצות עדיין לא הופעלה בסביבה הזו. אפשר להמשיך להזין פריטים ידנית.');
  }catch(e){if(active===a){a.busy=false;render();error(e.message);}}
 }
 window.lgSketchReader={open,close};
})();
