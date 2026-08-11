#!/usr/bin/env node
/**
 * deploy-rules.js — pushes database.rules.json to Firebase.
 *
 * Vercel deploys the site; it does not deploy Firebase rules. Editing the file
 * in the repo therefore changes nothing until this runs, and the failure is
 * silent: reads are simply denied and the screen looks empty. That is exactly
 * how the client price list came to show nothing after the rule was written.
 *
 * Uses the service account already in scripts/, so it needs no firebase-tools
 * login. Prints a diff-ish summary and refuses to run with --check.
 *
 *   node scripts/deploy-rules.js --check    compare deployed against the file
 *   node scripts/deploy-rules.js            deploy
 */
const fs=require('fs'), path=require('path');
const {initializeApp,cert}=require('firebase-admin/app');
const ROOT=path.join(__dirname,'..');
const DB='https://lussglass-default-rtdb.europe-west1.firebasedatabase.app';
const app=initializeApp({credential:cert(require(path.join(ROOT,'scripts','serviceAccountKey.json'))),databaseURL:DB});
const local=fs.readFileSync(path.join(ROOT,'database.rules.json'),'utf8');
const CHECK=process.argv.includes('--check');
(async()=>{
  const t=(await app.options.credential.getAccessToken()).access_token;
  const get=await fetch(`${DB}/.settings/rules.json?access_token=${t}`);
  const live=await get.text();
  const norm=s=>JSON.stringify(JSON.parse(s));
  if(norm(live)===norm(local)){ console.log('החוקים הפרוסים זהים לקובץ. אין מה לעשות.'); process.exit(0); }
  console.log('הפרוס שונה מהקובץ.');
  if(CHECK) process.exit(1);
  const put=await fetch(`${DB}/.settings/rules.json?access_token=${t}`,{method:'PUT',body:local});
  console.log(put.ok?'✓ נפרס בהצלחה.':'✗ נכשל: HTTP '+put.status+' '+(await put.text()).slice(0,200));
  process.exit(put.ok?0:1);
})().catch(e=>{console.error(e.message);process.exit(1)});
