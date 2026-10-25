'use strict';
const assert=require('node:assert/strict');
const {createHandler}=require('../api/sketch-reader');
const image='data:image/png;base64,iVBORw0KGgo=';
const row={label:'part',sku:'S',widthMm:500,heightMm:1000,quantity:1,evidence:'50x100 cm',warnings:[]};
const data={orders:{o:{stage:'',items:[]}},sketches:{o:image},skuCatalog:{S:{name:'glass',glass:'clear',mm:8,proc:'chisum'}}};
let staleOnce=false,atomicWrites=0,publicationAckLost=false,recoveryReadFails=false;
const get=p=>p.split('/').reduce((v,k)=>v?.[k],data)??null;
function put(p,v){let o=data;const ks=p.split('/');for(const k of ks.slice(0,-1))o=o[k]??={};o[ks.at(-1)]=structuredClone(v);}
const snapshot=v=>({val:()=>structuredClone(v)});
const db={ref(p){return{
 async once(){if(recoveryReadFails&&p.includes('/runs/')){recoveryReadFails=false;throw Error('recovery read unavailable');}if(staleOnce&&p==='sketchReader/o/latest'){staleOnce=false;return snapshot(null);}return snapshot(get(p));},
 async set(v){if(p==='sketchReader/o/latest')throw Error('pointer write failed');put(p,v);},
 async update(patch){atomicWrites++;for(const [k,v]of Object.entries(patch))put(p+'/'+k,v);if(publicationAckLost){publicationAckLost=false;recoveryReadFails=true;throw Error('lost write acknowledgement');}},
 async transaction(fn){// Real Firebase first runs the handler with null (no local cache), then retries with server data.
const real=get(p);let next=fn(null);if(next!==undefined&&real!==null)next=fn(structuredClone(real));if(next===undefined)return{committed:false,snapshot:snapshot(get(p))};put(p,next);return{committed:true,snapshot:snapshot(next)};}
};}};
const env={SKETCH_READER_ENABLED:'true',OPENAI_API_KEY:'fake',SKETCH_READER_MODEL:'test',SKETCH_READER_DAILY_LIMIT:'5'};
let providerCalls=0;
const handler=createHandler({db,env,verifyAdmin:async()=>({ok:true,phone:'admin'}),readImage:async()=>{providerCalls++;return{reading:{rows:[row],warnings:[]}};}});
async function call(requestId){let status=200,body;await handler({method:'POST',body:{action:'read',orderId:'o',requestId},headers:{}},{setHeader(){},status(n){status=n;return this;},json(b){body=b;}});return{status,body};}
(async()=>{
 const first=await call('request_first');
 assert.equal(first.status,200,'completed result and pointer must publish atomically');
 assert.equal(atomicWrites,1);
 assert.equal(data.sketchReader.o.runs.request_first.status,'ready');
 staleOnce=true;
 assert.equal((await call('request_second')).status,200);
 assert.equal(providerCalls,1,'recheck cache after lock, not just own request ID');
 env.SKETCH_READER_MODEL='changed-model';
 assert.equal((await call('request_third')).status,200);
 assert.equal(providerCalls,2,'changed model invalidates reusable reading');
 publicationAckLost=true;env.SKETCH_READER_MODEL='another-model';
 const recovered=await call('request_fourth');
 assert.equal(data.sketchReader.o.runs.request_fourth.status,'ready','a ready paid result must survive failed recovery reads');
 assert.equal(recovered.status,200);
 console.log('sketch-reader cache/publication races: PASS');
})().catch(e=>{console.error(e);process.exitCode=1;});
