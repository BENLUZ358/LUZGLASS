'use strict';
// Manual, admin-only extraction. No accounting/WhatsApp calls. Disabled until configured.
const rules=require('./_sketch-reader');
const error=(status,message)=>Object.assign(new Error(message),{status});
const validId=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(v);
const validRun=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{8,80}$/.test(v);
function defaultDb(){
 const {getApps,initializeApp,cert}=require('firebase-admin/app');
 const app=getApps()[0]||initializeApp({credential:cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)),databaseURL:require('./_env').lgDatabaseUrl()});
 return require('firebase-admin/database').getDatabase(app);
}
const publicDraft=run=>run&&run.status==='ready'?{
 runId:run.runId,reading:run.reading,createdAt:run.createdAt,version:run.version,
 model:run.model,sourceHash:run.sourceHash,usage:run.usage||null,costEstimateUsd:run.costEstimateUsd??null,elapsedMs:run.elapsedMs??null,existingItemCount:run.existingItemCount||0
}:null;
function createHandler(deps={}){
 return async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  if(!['GET','POST'].includes(req.method)) return res.status(405).json({error:'פעולה לא נתמכת'});
  let ownedLock=null,db,runRef,started=false;
  try{
   const auth=await (deps.verifyAdmin||require('./_verifyAdmin').verifyAdmin)(req);
   if(!auth.ok) return res.status(auth.status).json({error:auth.error});
   db=deps.db||defaultDb();
   const env=deps.env||process.env,now=deps.now||Date.now;
   const input=req.method==='GET'?req.query:req.body;
   if(!input||!validId(input.orderId)) throw error(400,'מספר הזמנה לא תקין');
   const id=input.orderId,base='sketchReader/'+id;
   const read=async path=>(await db.ref(path).once('value')).val();
   const order=await read('orders/'+id);
   if(!order) throw error(404,'ההזמנה לא נמצאה');
   if(req.method==='GET'){
    const latest=await read(base+'/latest');
    const draft=publicDraft(latest);
    if(draft&&order.sketchReaderApproval?.runId===draft.runId) {
     draft.reading={...draft.reading,rows:order.sketchReaderApproval.correctedRows};
     draft.approved=true;
    }
    return res.status(200).json({ok:true,draft,enabled:env.SKETCH_READER_ENABLED==='true'&&!!env.OPENAI_API_KEY&&!!env.SKETCH_READER_MODEL});
   }
   if(input.action==='approve'){
    if(!validRun(input.runId)||input.acknowledged!==true) throw error(400,'יש לאשר שבדקת את כל השורות והאזהרות');
    const run=await read(base+'/runs/'+input.runId);
    if(!run||run.status!=='ready') throw error(404,'טיוטת הפענוח לא נמצאה');
    if(!Array.isArray(input.rows)||JSON.stringify(input.rows).length>150000) throw error(400,'שורות האישור אינן תקינות');
    const catalog=await read('skuCatalog')||{};
    if(run.catalogHash!==rules.digest(catalog)) throw error(409,'קטלוג המק״טים השתנה מאז הקריאה; יש לקרוא מחדש');
    let items;
    try{items=rules.approvedItems(input.rows,catalog);}catch(e){throw error(400,e.message);}
    const rowsDigest=rules.digest(input.rows);
    // A retry is a no-op. A changed retry must not silently overwrite the earlier approval.
    if(order.sketchReaderApproval?.runId===input.runId){
     if(order.sketchReaderApproval.rowsDigest!==rowsDigest) throw error(409,'הטיוטה כבר אושרה עם נתונים אחרים');
     return res.status(200).json({ok:true,items:order.items||[],approval:order.sketchReaderApproval,alreadyApproved:true});
    }
    if(!rules.canRead(order)) throw error(409,'ההזמנה כבר התקדמה; אי אפשר להחליף את הפריטים');
    const image=rules.sourceImage(order,await read('sketches/'+id));
    if(rules.digest(image)!==run.sourceHash) throw error(409,'הסקיצה השתנתה מאז הפענוח; יש לקרוא אותה מחדש');
    const approvedAt=now();
    // The corrected rows and original reading are persisted atomically WITH the live items.
    const approval={runId:input.runId,version:run.version,sourceHash:run.sourceHash,model:run.model,
     original:run.reading,correctedRows:JSON.parse(JSON.stringify(input.rows)),rowsDigest,
     approvedAt,approvedBy:auth.phone};
    const tx=await db.ref('orders/'+id).transaction(current=>{
     if(!current||!rules.canRead(current)||rules.orderFingerprint(current)!==run.baseFingerprint) return;
     return {...current,items,sketchReaderApproval:approval,sketchReaderApprovals:{...(current.sketchReaderApprovals||{}),[input.runId]:approval},updatedAt:approvedAt};
    });
    if(!tx.committed) {
     const current=tx.snapshot.val();
     if(current?.sketchReaderApproval?.runId===input.runId&&current.sketchReaderApproval.rowsDigest===rowsDigest)
      return res.status(200).json({ok:true,items:current.items,approval:current.sketchReaderApproval,alreadyApproved:true});
     throw error(409,'ההזמנה השתנתה מאז הפענוח; לא דרסנו את השינויים. יש לקרוא מחדש');
    }
    return res.status(200).json({ok:true,items,approval});
   }
   if(input.action!=='read'||!validRun(input.requestId)) throw error(400,'בקשת קריאה לא תקינה');
   if(env.SKETCH_READER_ENABLED!=='true'||!env.OPENAI_API_KEY||!env.SKETCH_READER_MODEL)
    throw error(503,'קריאת סקיצות עדיין לא הופעלה בסביבה הזו; אפשר להזין פריטים ידנית');
   if(!rules.canRead(order)) throw error(409,'אפשר לקרוא רק הזמנה שעדיין בתור וטרם נשלחה לחשבשבת');
   const runId=input.requestId;
   const previous=await read(base+'/runs/'+runId);
   if(previous){
    if(previous.status==='ready') return res.status(200).json({ok:true,draft:publicDraft(previous),cached:true});
    throw error(409,'בקשת הקריאה הזו כבר הופעלה; לא נחייב אותה שוב. אפשר לפתוח מחדש ולבקש קריאה חדשה');
   }
   const image=rules.sourceImage(order,await read('sketches/'+id));
   const sourceHash=rules.digest(image),baseFingerprint=rules.orderFingerprint(order);
   const catalog=await read('skuCatalog')||{},catalogHash=rules.digest(catalog);
   const matches=run=>run?.status==='ready'&&run.sourceHash===sourceHash&&run.baseFingerprint===baseFingerprint&&run.catalogHash===catalogHash&&run.model===env.SKETCH_READER_MODEL&&run.version===rules.VERSION;
   const latest=await read(base+'/latest');
   if(!input.force&&matches(latest))
    return res.status(200).json({ok:true,draft:publicDraft(latest),cached:true});
   const startedAt=now(),lockRef=db.ref('sketchReaderLocks/'+id);
   const lock=await lockRef.transaction(current=>{
    if(current&&startedAt-current.at<120000) return;
    return {runId,at:startedAt};
   });
   if(!lock.committed) throw error(409,'הסקיצה כבר בתהליך קריאה; המתן לסיום');
   ownedLock={ref:lockRef,runId};
   // Check again after claiming the lock: two simultaneous identical requests must cost once.
   if(await read(base+'/runs/'+runId)) throw error(409,'הבקשה כבר טופלה');
   const afterLock=await read(base+'/latest');
   if(!input.force&&matches(afterLock)) return res.status(200).json({ok:true,draft:publicDraft(afterLock),cached:true});
   const limit=Number(env.SKETCH_READER_DAILY_LIMIT||30);
   if(!Number.isInteger(limit)||limit<1||limit>1000) throw error(503,'מגבלת הקריאות אינה מוגדרת נכון');
   const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jerusalem'}).format(new Date(startedAt));
   const budget=await db.ref('sketchReaderUsage/'+day).transaction(n=>{
    if((Number(n)||0)>=limit) return;
    return (Number(n)||0)+1;
   });
   if(!budget.committed) throw error(429,'הגעת למכסת קריאת הסקיצות היומית; אפשר להמשיך ידנית');
   runRef=db.ref(base+'/runs/'+runId);
   await runRef.set({runId,status:'reading',createdAt:startedAt,createdBy:auth.phone,sourceHash,baseFingerprint,version:rules.VERSION,model:env.SKETCH_READER_MODEL});
   started=true;
   const result=await (deps.readImage||rules.readImage)({image,catalog,model:env.SKETCH_READER_MODEL,key:env.OPENAI_API_KEY});
   // Validate even injected providers. Keep raw image once in immutable run, never in orders.
   const reading=rules.normalizeReading(result.reading,catalog);
   const run={runId,status:'ready',createdAt:startedAt,createdBy:auth.phone,sourceHash,baseFingerprint,
    version:rules.VERSION,model:env.SKETCH_READER_MODEL,reading,usage:result.usage||null,costEstimateUsd:rules.estimateCostUsd(env.SKETCH_READER_MODEL,result.usage),
    existingItemCount:Array.isArray(order.items)?order.items.length:0,catalogHash,
    finishedAt:now(),elapsedMs:Math.max(0,now()-startedAt)};
   await db.ref(base).update({['runs/'+runId]:{...run,sourceImage:image},latest:run});
   return res.status(200).json({ok:true,draft:publicDraft(run)});
  }catch(e){
   if(started&&runRef) {
    try { const saved=(await runRef.once('value')).val(); if(saved?.status==='ready') return res.status(200).json({ok:true,draft:publicDraft(saved),cached:true}); } catch(_) {}
    try{
     const recovery=await runRef.transaction(saved=>saved?.status==='ready'?undefined:{...(saved||{}),status:'failed',failedAt:(deps.now||Date.now)(),error:'הקריאה לא הושלמה'});
     const saved=recovery.snapshot.val();
     if(saved?.status==='ready') return res.status(200).json({ok:true,draft:publicDraft(saved),cached:true});
    }catch(_){}
   }
   // Never leak provider response, keys, or source images into logs/client errors.
   return res.status(e.status||502).json({error:e.status?e.message:'קריאת הסקיצה נכשלה; ההזמנה לא שונתה. אפשר להמשיך ידנית'});
  }finally{
   if(ownedLock) {
    try{await ownedLock.ref.transaction(lock=>lock?.runId===ownedLock.runId?null:undefined);}catch(_){}
   }
  }
 };
}
module.exports=createHandler();
module.exports.createHandler=createHandler;
