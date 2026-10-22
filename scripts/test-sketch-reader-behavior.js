'use strict';
const assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),{webcrypto,createHash}=require('node:crypto');
const source=fs.readFileSync('sketch-reader-ui.js','utf8');
const row={label:'דלת',sku:'8SMH',widthMm:811,heightMm:1975,quantity:1,evidence:'מהסקיצה',warnings:[]};
async function scenario(mismatch=false){
 let element,posts=[],approved=null,getCalls=0;
 const image='data:image/png;base64,iVBORw0KGgo=';
 const nodes={
  '.sr-error':{focus(){},hidden:true,textContent:''},
  '[role="dialog"]':{focus(){}},
  '#sr-ack':{checked:false},
 };
 const document={activeElement:{focus(){}},body:{appendChild(el){element=el;}},createElement(){
  return {events:{},innerHTML:'',querySelector(s){return nodes[s]||null;},querySelectorAll(){return[];},
   addEventListener(s,fn){this.events[s]=fn;},remove(){this.removed=true;}};
 }};
 const context={setTimeout,clearTimeout,window:{},document,crypto:webcrypto,TextEncoder,Uint8Array,structuredClone,confirm:()=>true,
  skuCatalogMap:{'8SMH':{name:'שקוף 8',glass:'שקוף',mm:8}},console,
  _lgAuthFetch:async()=>{getCalls++;return {ok:true,json:async()=>({enabled:true,draft:{
   runId:'request_test',sourceHash:mismatch?'different':createHash('sha256').update(image).digest('hex'),
   reading:{rows:[row],warnings:[]},existingItemCount:0
  }})};},
  _lgAuthPost:async(url,payload)=>{posts.push(payload);return{ok:true,json:async()=>({items:[{w:payload.rows[0].widthMm}]})};}
 };
 vm.createContext(context);vm.runInContext(source,context);
 await context.window.lgSketchReader.open({orderId:'o1',image,onApproved:data=>approved=data});
 assert.equal(getCalls,1);assert.equal(posts.length,0,'opening/restoring draft must be free');
 assert.ok(element.innerHTML.includes('widthMm'));assert.ok(element.innerHTML.includes('מ״מ'));
 const click=action=>element.events.click({target:{closest:()=>({dataset:{sr:action}})}});
 if(mismatch){
  nodes['#sr-ack'].checked=true;click('approve');await new Promise(r=>setImmediate(r));
  assert.equal(posts.length,0,'wrong source image cannot be approved');return;
 }
 click('approve');await new Promise(r=>setImmediate(r));
 assert.equal(posts.length,0,'approval requires acknowledgement');
 const target={dataset:{field:'widthMm',row:'0'},value:'900',removeAttribute(){}};
 element.events.input({target});
 assert.equal(posts.length,0,'typing never writes live items');
 nodes['#sr-ack'].checked=true;click('approve');
 await new Promise(r=>setImmediate(r));
 assert.equal(posts.length,1);assert.equal(posts[0].action,'approve');
 assert.equal(posts[0].rows[0].widthMm,900);
 assert.equal(approved.items[0].w,900);assert.equal(element.removed,true);
}
(async()=>{await scenario();await scenario(true);console.log('sketch-reader UI behavior: PASS');})().catch(e=>{console.error(e);process.exitCode=1;});
