'use strict';
const assert=require('node:assert/strict');
const {createHandler}=require('../api/sketch-reader');
function fakeDb(initial){
 const data=structuredClone(initial);
 function get(path){return path.split('/').reduce((o,k)=>o?.[k],data)??null;}
 function put(path,v){const keys=path.split('/');let p=data;for(const k of keys.slice(0,-1))p=p[k]??={};p[keys.at(-1)]=structuredClone(v);}
 const snap=v=>({val:()=>structuredClone(v)});
 return {data,ref(path){return {async once(){return snap(get(path));},async set(v){put(path,v);}, async update(patch){for(const [k,v] of Object.entries(patch))put(path+'/'+k,v);},
 async transaction(fn){const v=fn(structuredClone(get(path)));if(v===undefined)return {committed:false,snapshot:snap(get(path))};put(path,v);return {committed:true,snapshot:snap(v)};}};}};
}
const image='data:image/png;base64,iVBORw0KGgo=';
const catalog={'8SMH':{name:'שקוף 8 מחוסם',glass:'שקוף',mm:8,proc:'chisum'}};
const row={label:'דלת',sku:'8SMH',widthMm:811,heightMm:1975,quantity:1,evidence:'81.1 על 197.5 ס"מ',warnings:[]};
const env={SKETCH_READER_ENABLED:'true',OPENAI_API_KEY:'not-a-real-key',SKETCH_READER_MODEL:'test-model',SKETCH_READER_DAILY_LIMIT:'3'};
async function call(handler,body,method='POST'){let status=200,value;await handler({method,body,query:body,headers:{}},{status(s){status=s;return this;},json(v){value=v;return this;},setHeader(){}});return {status,value};}
(async()=>{
 let calls=0,args;
 const db=fakeDb({orders:{o1:{stage:'',items:[{w:5}],hasSketch:true}},sketches:{o1:image},skuCatalog:catalog});
 const handler=createHandler({db,env,verifyAdmin:async()=>({ok:true,phone:'admin'}),now:()=>1_000_000,
 readImage:async p=>{calls++;args=p;return {reading:{rows:[row],warnings:[]},usage:{input_tokens:20}};}});
 const denied=createHandler({db,env,verifyAdmin:async()=>({ok:false,status:403,error:'forbidden'})});
 assert.equal((await call(denied,{action:'read',orderId:'o1',requestId:'request_0001'})).status,403);
 assert.equal(calls,0);
 const off=createHandler({db,env:{},verifyAdmin:async()=>({ok:true,phone:'admin'})});
 assert.equal((await call(off,{action:'read',orderId:'o1',requestId:'request_0001'})).status,503);
 const before=structuredClone(db.data.orders.o1);
 const first=await call(handler,{action:'read',orderId:'o1',requestId:'request_0001'});
 assert.equal(first.status,200);
 assert.equal(calls,1);
 assert.equal(args.image,image);
 assert.equal(args.order,undefined);
 assert.equal(args.items,undefined);
 assert.deepEqual(db.data.orders.o1,before,'reading must not mutate order');
 const runId=first.value.draft.runId;
 assert.equal((await call(handler,{action:'read',orderId:'o1',requestId:'request_0002'})).status,200);
 assert.equal(calls,1,'cached reading must not cost twice');
 assert.equal((await call(handler,{orderId:'o1'},'GET')).value.draft.runId,runId);
 assert.equal(calls,1);
 assert.equal((await call(handler,{action:'approve',orderId:'o1',runId,rows:[row]})).status,400);
 assert.deepEqual(db.data.orders.o1,before);
 const approved=await call(handler,{action:'approve',orderId:'o1',runId,rows:[row],acknowledged:true});
 assert.equal(approved.status,200);
 assert.equal(db.data.orders.o1.items[0].w,811);
 assert.equal(db.data.orders.o1.stage,'');
 assert.equal(db.data.orders.o1.sketchReaderApproval.original.rows[0].widthMm,811);
 assert.equal(db.data.orders.o1.sketchReaderApproval.approvedBy,'admin');
 assert.equal((await call(handler,{action:'approve',orderId:'o1',runId,rows:[row],acknowledged:true})).status,200);
 assert.equal((await call(handler,{action:'approve',orderId:'o1',runId,rows:[{...row,widthMm:900}],acknowledged:true})).status,409);
 // A new reading followed by a concurrent manual edit cannot replace that edit.
 const reread=await call(handler,{action:'read',orderId:'o1',requestId:'request_0003',force:true});
 assert.equal(reread.status,200);
 db.data.orders.o1.items[0].w=999;
 assert.equal((await call(handler,{action:'approve',orderId:'o1',runId:reread.value.draft.runId,rows:[row],acknowledged:true})).status,409);
 assert.equal(db.data.orders.o1.items[0].w,999);
 // Provider failure never changes production data or retries a paid request ID.
 const failed=createHandler({db,env,verifyAdmin:async()=>({ok:true,phone:'admin'}),now:()=>1_000_000,
 readImage:async()=>{calls++;throw new Error('provider failed');}});
 const failedBefore=structuredClone(db.data.orders.o1);
 assert.equal((await call(failed,{action:'read',orderId:'o1',requestId:'request_fail',force:true})).status,502);
 assert.deepEqual(db.data.orders.o1,failedBefore);
 const count=calls;
 assert.equal((await call(failed,{action:'read',orderId:'o1',requestId:'request_fail',force:true})).status,409);
 assert.equal(calls,count);
 assert.equal((await call(handler,{action:'read',orderId:'o1',requestId:'request_0004',force:true})).status,429);
 assert.equal((await call(handler,{action:'read',orderId:'../bad',requestId:'request_0004'})).status,400);

 // Stale catalog/image, locked order, and concurrent reads.
 const db2=fakeDb({orders:{o2:{stage:'',items:[],hasSketch:true}},sketches:{o2:image},skuCatalog:catalog});
 let release,entered;
 const enteredPromise=new Promise(r=>entered=r);
 const concurrent=createHandler({db:db2,env,verifyAdmin:async()=>({ok:true,phone:'admin'}),now:()=>2_000_000,
 readImage:async()=>{entered();await new Promise(r=>release=r);return {reading:{rows:[row],warnings:[]}};}});
 const pending=call(concurrent,{action:'read',orderId:'o2',requestId:'request_hold'});
 await enteredPromise;
 assert.equal((await call(concurrent,{action:'read',orderId:'o2',requestId:'request_race'})).status,409);
 release();const ready=await pending;assert.equal(ready.status,200);
 db2.data.skuCatalog['8SMH'].name='changed product';
 assert.equal((await call(concurrent,{action:'approve',orderId:'o2',runId:'request_hold',rows:[row],acknowledged:true})).status,409);
 db2.data.skuCatalog=structuredClone(catalog);
 db2.data.sketches.o2='data:image/png;base64,iVBORw0KGgoAAA==';
 assert.equal((await call(concurrent,{action:'approve',orderId:'o2',runId:'request_hold',rows:[row],acknowledged:true})).status,409);
 assert.deepEqual(db2.data.orders.o2.items,[]);
 db2.data.orders.o2.stage='opty';
 assert.equal((await call(concurrent,{action:'read',orderId:'o2',requestId:'request_late'})).status,409);
 assert.equal((await call(handler,{orderId:'o1'},'GET')).value.draft.approved,undefined); // latest reread is unapproved
 assert.ok(db.data.orders.o1.sketchReaderApprovals[runId],'correction history retained');

 console.log('sketch-reader API workflow: PASS');
})().catch(e=>{console.error(e);process.exitCode=1;});
