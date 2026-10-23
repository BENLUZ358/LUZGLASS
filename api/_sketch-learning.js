'use strict';
const rules=require('./_sketch-reader');
const VERSION='customer-glass-profile-v2';
const scope=key=>typeof key==='string'&&key?rules.digest(key):null;
async function resolveScope(db,o){
 if(!o||o.waUnassigned||o.emailUnassigned)return null;
 const phone=String(o.clientPhone||'').replace(/\D/g,'');
 const id=String(o.customerId||'').trim();
 if(id&&!/^[A-Za-z0-9_-]{1,80}$/.test(id))return null;
 if(phone&&/^[0-9]{8,15}$/.test(phone)){
  const user=(await db.ref('users/'+phone).once('value')).val();
  if(user&&user.role==='client'){
   const userId=String(user.customerId||'').trim();
   if(id&&id!==userId)return null;
   return scope(userId?'id:'+userId:'phone:'+phone);
  }
  if(id){
   const card=(await db.ref('hashavshevetAccounts/'+id).once('value')).val();
   if(card&&String(card.phone||'').replace(/\D/g,'')===phone)return scope('id:'+id);
  }
 }
 if(o.waGroup&&id){
  const groupKey=String(o.waGroup).replace(/[.#$[\]\/]/g,'_');
  const link=(await db.ref('waGroups/'+groupKey).once('value')).val();
  if(link&&String(link.customerId)===id)return scope('id:'+id);
 }
 return null;
}
const fields=rows=>rows.map(r=>({label:String(r.label||'').slice(0,100),sku:r.sku,widthMm:r.widthMm,heightMm:r.heightMm,quantity:r.quantity}));
function example(c,target){
 const a=c.approval,r=c.run,key=target.scope;
 if(!key||c.scope!==key||c.orderId===target.orderId||!a?.learningAllowed||!a.approvedBy||a.learningScope!==key||r?.status!=='ready'||a.sourceHash!==r.sourceHash||r.catalogHash!==rules.digest(target.catalog)||r.sourceHash===target.sourceHash)return null;
 if(!Array.isArray(a.correctedRows)||!a.correctedRows.length||a.correctedRows.length>12||rules.digest(a.correctedRows)!==a.rowsDigest)return null;
 try{rules.approvedItems(a.correctedRows,target.catalog);rules.sourceImage({},r.sourceImage);}catch(_){return null;}
 if(rules.digest(r.sourceImage)!==a.sourceHash)return null;
 const original=Array.isArray(r.reading?.rows)?fields(r.reading.rows).slice(0,12):[];
 const rows=fields(a.correctedRows);
 // Keep only actual corrections, not simple unchanged approvals.
 if(rules.digest(original)===rules.digest(rows))return null;
 return {orderId:c.orderId,runId:a.runId,sourceHash:r.sourceHash,rowsDigest:a.rowsDigest,image:r.sourceImage,rows,original};
}
function indexPath(orderId,a){return 'sketchReaderLearning/'+a.learningScope+'/'+String(a.approvedAt).padStart(16,'0')+'_'+rules.digest(orderId+':'+a.runId).slice(0,20);}
async function publish(db,orderId,a){
 if(!a.learningScope)return false;
 try{await db.ref(indexPath(orderId,a)).set(a.learningAllowed?{orderId,runId:a.runId,approvedAt:a.approvedAt}:null);return true;}catch(_){return false;}
}

function validateNotations(rows){
 for(const r of rows){if(r.glassNotation!==undefined&&(typeof r.glassNotation!=='string'||r.glassNotation.length>80))throw new Error('הכיתוב לזיהוי סוג הזכוכית צריך להיות טקסט עד 80 תווים');}
}
const notation=value=>String(value||'').normalize('NFKC').trim().replace(/\s+/g,' ');
function glassProfile(sources,catalog){
 const products=new Map(rules.catalogForModel(catalog).map(e=>[e.sku,e])),groups=new Map();
 for(const source of sources){
  for(const row of source.rows){
   const token=notation(row.glassNotation);if(!token||!products.has(row.sku))continue;
   const key=token.toLocaleLowerCase();if(!groups.has(key))groups.set(key,{notation:token,skus:new Map()});
   const group=groups.get(key);if(!group.skus.has(row.sku))group.skus.set(row.sku,new Set());
   group.skus.get(row.sku).add(source.sourceHash||source.orderId);
  }
 }
 const glassHints=[],glassConflicts=[];
 for(const group of groups.values()){
  if(group.skus.size!==1){glassConflicts.push(group.notation);continue;}
  const [sku,ids]=[...group.skus][0];glassHints.push({notation:group.notation,product:products.get(sku),approvedExamples:ids.size});
 }
 return {glassHints:glassHints.slice(0,12),glassConflicts:glassConflicts.slice(0,12)};
}
async function loadContext(db,target){
 const empty={examples:[],glassHints:[],glassConflicts:[],glassSources:[]};
 const key=target.scope;if(!key)return empty;
 const snap=await db.ref('sketchReaderLearning/'+key).orderByKey().limitToLast(20).once('value');
 const candidates=Object.values(snap.val()||{}).filter(v=>v&&typeof v==='object').sort((a,b)=>b.approvedAt-a.approvedAt),examples=[],sources=[];
 for(const ref of candidates){
  if(!/^[A-Za-z0-9_-]{1,100}$/.test(ref.orderId)||!/^[A-Za-z0-9_-]{8,80}$/.test(ref.runId)||ref.orderId===target.orderId)continue;
  const order=(await db.ref('orders/'+ref.orderId).once('value')).val(),approval=order?.sketchReaderApprovals?.[ref.runId];
  if(!approval?.learningAllowed||!approval.approvedBy||approval.learningScope!==key||approval.sourceHash===target.sourceHash)continue;
  const candidateScope=await resolveScope(db,order);if(candidateScope!==key)continue;
  if(approval.catalogHash===rules.digest(target.catalog)&&Array.isArray(approval.correctedRows)&&approval.correctedRows.length<=100&&rules.digest(approval.correctedRows)===approval.rowsDigest){
   try{
    validateNotations(approval.correctedRows);rules.approvedItems(approval.correctedRows,target.catalog);
    if(approval.correctedRows.some(r=>notation(r.glassNotation)))sources.push({orderId:ref.orderId,runId:ref.runId,sourceHash:approval.sourceHash,rowsDigest:approval.rowsDigest,rows:approval.correctedRows});
   }catch(_){}
  }
  if(target.includeExample!==false&&!examples.length&&Array.isArray(approval.correctedRows)&&rules.digest(fields(approval.original?.rows||[]))!==rules.digest(fields(approval.correctedRows))){
   const run=(await db.ref('sketchReader/'+ref.orderId+'/runs/'+ref.runId).once('value')).val();
   const out=example({orderId:ref.orderId,order,scope:candidateScope,approval,run},target);if(out)examples.push(out);
  }
 }
 return {examples,...glassProfile(sources,target.catalog),glassSources:sources.map(({orderId,runId,sourceHash,rowsDigest})=>({orderId,runId,sourceHash,rowsDigest}))};
}
async function load(db,target){return (await loadContext(db,target)).examples;}
const fingerprint=context=>{
 const {examples=[],glassHints=[],glassConflicts=[],glassSources=[]}=Array.isArray(context)?{examples:context}:context;
 return rules.digest({version:VERSION,examples:examples.map(({orderId,runId,sourceHash,rowsDigest})=>({orderId,runId,sourceHash,rowsDigest})),glassHints,glassConflicts,glassSources});
};
module.exports={VERSION,scope,resolveScope,fields,example,publish,load,loadContext,fingerprint,glassProfile,validateNotations};
