'use strict';
const assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),{webcrypto,createHash}=require('node:crypto');
const image='test image';
const draft={runId:'request_123',sourceHash:createHash('sha256').update(image).digest('hex'),reading:{rows:[{label:'חלק',sku:'S',widthMm:500,heightMm:1000,quantity:1,evidence:'50x100',warnings:[]}],warnings:[]}};
async function scenario({readOnOpen=false,cached=false,enabled=true,loadFails=false}){
 let posts=0,host;
 const nodes={'.sr-error':{hidden:true,focus(){}},'[role="dialog"]':{focus(){}}};
 const document={body:{appendChild(el){host=el;}},activeElement:{focus(){}},createElement(){return{innerHTML:'',querySelector:s=>nodes[s]||null,addEventListener(){},remove(){}};}};
 const context={setTimeout,clearTimeout,console,window:{},document,crypto:webcrypto,TextEncoder,Uint8Array,structuredClone,skuCatalogMap:{},confirm:()=>true,
  _lgAuthFetch:async()=>{if(loadFails)throw Error('offline');return{ok:true,json:async()=>({enabled,draft:cached?draft:null})};},
  _lgAuthPost:async(_url,payload)=>{posts++;assert.equal(payload.action,'read');return{ok:true,json:async()=>({draft})};}};
 vm.createContext(context);vm.runInContext(fs.readFileSync('sketch-reader-ui.js','utf8'),context);
 await context.window.lgSketchReader.open({orderId:'o',image,readOnOpen});
 return{posts,html:host.innerHTML};
}
(async()=>{
 const page=fs.readFileSync('admin.html','utf8');
 const start=page.indexOf('async function sqReadSketch()'),end=page.indexOf('async function sqDownload()',start);
 let queueOptions;
 const ctx={sqCurrent:{id:'test-order'},lgHasSketch:()=>true,lgLoadSketch:async()=>image,_sqOrder:o=>o,showToast(){},window:{lgSketchReader:{open:o=>{queueOptions=o;}}}};
 vm.createContext(ctx);vm.runInContext(page.slice(start,end),ctx);await ctx.sqReadSketch();
 assert.equal(queueOptions.readOnOpen,true,'the real queue button must request the one-click start');
 const first=await scenario({readOnOpen:true});
 assert.equal(first.posts,1,'the queue read action must start extraction, not require another read click');
 assert.ok(first.html.includes('widthMm'),'render the proposed item fields');
 assert.equal((await scenario({readOnOpen:true,cached:true})).posts,0,'restoring a draft must not charge again');
 assert.equal((await scenario({readOnOpen:true,enabled:false})).posts,0);
 assert.equal((await scenario({readOnOpen:true,loadFails:true})).posts,0);
 assert.equal((await scenario({})).posts,0,'opening for inspection alone remains free');
 console.log('sketch-reader first-click workflow: PASS');
})().catch(e=>{console.error(e);process.exitCode=1;});
