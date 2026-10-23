'use strict';
const assert=require('node:assert/strict');
const {readImage}=require('../api/_sketch-reader');
(async()=>{
 const raw={rows:[{label:'חלק',sku:null,widthMm:null,heightMm:1975,quantity:null,evidence:'גובה 197.5 ס"מ',warnings:['רוחב לא ברור']}],warnings:[]};
 let sent;
 const args={image:'data:image/png;base64,iVBORw0KGgo=',catalog:{},model:'vision-test',key:'fake-key'};
 const out=await readImage({...args,fetcher:async(url,req)=>{
  assert.equal(url,'https://api.openai.com/v1/responses');
  sent=JSON.parse(req.body);
  return {ok:true,json:async()=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(raw)}]}],usage:{input_tokens:3}})};
 }});
 assert.equal(sent.store,false);assert.equal(sent.text.format.strict,true);
 assert.equal(sent.input[0].content[1].type,'input_image');
 assert.equal(out.reading.rows[0].widthMm,null);
 assert.equal(out.reading.rows[0].quantity,null);
 await readImage({...args,examples:[{image:'data:image/png;base64,iVBORw0KGgoAAA==',original:[{widthMm:450}],rows:[{widthMm:500}]}],fetcher:async(_url,req)=>{
  const body=JSON.parse(req.body),content=body.input[0].content;
  assert.equal(content.filter(c=>c.type==='input_image').length,2);
  assert.equal(content.at(-1).image_url,args.image,'target image must be last and distinguished from reference');
  assert.ok(content.some(c=>c.type==='input_text'&&c.text.includes('corrected')));
  assert.ok(body.instructions.includes('לעולם אל תעתיק'));
  return {ok:true,json:async()=>({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify(raw)}]}]})};
 }});
 await readImage({...args,glassHints:[{notation:'קליר 8',product:{sku:'S',glass:'קליר',mm:8,proc:'chisum'}}],glassConflicts:['מיוחד'],fetcher:async(_url,req)=>{
  const body=JSON.parse(req.body),content=body.input[0].content;
  assert.equal(content.filter(c=>c.type==='input_image').length,1,'text glossary adds no reference image');
  assert.ok(content.some(c=>c.type==='input_text'&&c.text.includes('קליר 8')&&c.text.includes('glassConflicts')));
  assert.ok(body.instructions.includes('אין סוג ברירת מחדל ללקוח'));
  assert.equal(content.at(-1).image_url,args.image);
  return {ok:true,json:async()=>({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify(raw)}]}]})};
 }});
 for(const response of [
  {ok:false},
  {ok:true,json:async()=>({status:'incomplete',output:[]})},
  {ok:true,json:async()=>({status:'completed',output:[{content:[{type:'refusal'}]}]})},
  {ok:true,json:async()=>({status:'completed',output:[{content:[{type:'output_text',text:'not json'}]}]})}
 ])await assert.rejects(()=>readImage({...args,fetcher:async()=>response}));
 console.log('sketch-reader provider contract: PASS (mocked; no paid requests)');
})().catch(e=>{console.error(e);process.exitCode=1;});
