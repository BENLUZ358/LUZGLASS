'use strict';
const rules=require('./_sketch-reader');
const VERSION='approved-examples-v1';
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
async function load(db,target){
 const key=target.scope;if(!key)return [];
 const snap=await db.ref('sketchReaderLearning/'+key).orderByKey().limitToLast(20).once('value');
 const candidates=Object.values(snap.val()||{}).sort((a,b)=>b.approvedAt-a.approvedAt);
 for(const ref of candidates){
  if(!/^[A-Za-z0-9_-]{1,100}$/.test(ref.orderId)||!/^[A-Za-z0-9_-]{8,80}$/.test(ref.runId)||ref.orderId===target.orderId)continue;
  const order=(await db.ref('orders/'+ref.orderId).once('value')).val(),approval=order?.sketchReaderApprovals?.[ref.runId];
  if(!approval?.learningAllowed)continue;
  const run=(await db.ref('sketchReader/'+ref.orderId+'/runs/'+ref.runId).once('value')).val();
  const candidateScope=await resolveScope(db,order);
  const out=example({orderId:ref.orderId,order,scope:candidateScope,approval,run},target);if(out)return [out];
 }
 return [];
}
const fingerprint=examples=>rules.digest({version:VERSION,examples:examples.map(({orderId,runId,sourceHash,rowsDigest})=>({orderId,runId,sourceHash,rowsDigest}))});
module.exports={VERSION,scope,resolveScope,fields,example,publish,load,fingerprint};
