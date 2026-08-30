#!/usr/bin/env node
/**
 * Tests the upload path in upload.html.
 *
 * Three ways a sketch could be lost without anyone being told, all found on
 * 2026-08-30 while chasing a broken image in the queue:
 *
 *  1. compressImage counts completions and calls saveAll() only when the count
 *     matches. One callback that never fires stops the count, saveAll is never
 *     reached, and the button sits on "מעבד..." with no error at all.
 *  2. Firebase set() resolves on server ack. With no network the promise never
 *     settles either way — same stuck button, same silence.
 *  3. saveAll writes one file at a time and saveSubmission mints
 *     'sub_' + Date.now() per call, so a retry after a partial failure saves
 *     the already-saved files a second time as separate orders.
 *
 * And the file that started it: a Windows .url shortcut, 513 bytes, accepted
 * as a sketch because handleFiles checked only size. accept="image/*,.pdf" is
 * a hint to the picker; drag-and-drop ignores it entirely.
 *
 * Run: node scripts/test-upload-reliability.js
 */
const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const ROOT   = path.join(__dirname, '..');
const UPLOAD = fs.readFileSync(path.join(ROOT, 'upload.html'), 'utf8');

let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));

/* ── only images and PDFs get in ───────────────────────────────────────── */
{
  const fn = (UPLOAD.match(/function lgIsAcceptedUpload[\s\S]*?\n}/) || [''])[0];
  check('the accept predicate is found', fn.length > 0, true);
  const ctx = vm.createContext({});
  vm.runInContext(fn, ctx);
  const ok = f => ctx.lgIsAcceptedUpload(f).ok;

  check('a jpeg is accepted',  ok({ name: 'a.jpg',  type: 'image/jpeg' }), true);
  check('a png is accepted',   ok({ name: 'a.png',  type: 'image/png'  }), true);
  check('a heic photo from an iPhone is accepted',
                               ok({ name: 'a.heic', type: 'image/heic' }), true);
  check('a pdf is accepted',   ok({ name: 'a.pdf',  type: 'application/pdf' }), true);

  /* the actual file that reached the queue */
  check('a Windows .url shortcut is refused',
        ok({ name: 'link.url', type: 'application/octet-stream' }), false);
  check('and so is a spreadsheet',
        ok({ name: 'a.xlsx', type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), false);
  check('a video is refused — it is not a sketch',
        ok({ name: 'a.mp4', type: 'video/mp4' }), false);

  /* browsers hand over an empty type for unknown extensions, so the name has
     to be able to decide on its own */
  check('an empty type falls back to the extension',
        ok({ name: 'scan.pdf', type: '' }), true);
  check('an image extension with an empty type is accepted',
        ok({ name: 'scan.HEIC', type: '' }), true);
  check('and an unknown extension with an empty type is refused',
        ok({ name: 'thing.url', type: '' }), false);
  check('a name with no extension at all is refused',
        ok({ name: 'thing', type: '' }), false);
  check('nothing at all does not throw', ok({}), false);
  check('the refusal says which file and why',
        /link\.url/.test(ctx.lgIsAcceptedUpload({ name: 'link.url', type: '' }).reason), true);
}

/* ── it is wired into the picker AND the drop zone ─────────────────────── */
{
  const fn = (UPLOAD.match(/function handleFiles[\s\S]*?\n}/) || [''])[0];
  check('handleFiles is found', fn.length > 0, true);
  check('every file is checked before it is read',
        /lgIsAcceptedUpload\(/.test(fn), true);
  check('a refused file never reaches uploadedFiles',
        /lgIsAcceptedUpload[\s\S]{0,200}?return;/.test(fn), true);
  check('the size limit still applies', /file\.size >/.test(fn), true);
  /* alert() blocks, and some mobile browsers swallow it outright — the client
     is the one being told, so the message has to live in the page */
  check('the refusal is shown in the page, not through alert()',
        /alert\(/.test(fn), false);
}
check('the picker still advertises what it wants',
      /accept="image\/\*,\.pdf"/.test(UPLOAD), true);
check('there is somewhere to put the message',
      /id="upNotice"/.test(UPLOAD), true);
check('and it is announced to a screen reader',
      /id="upNotice"[^>]*aria-live/.test(UPLOAD), true);

/* ── a retry must not double-save ──────────────────────────────────────── */
/*
 * saveAll writes one file at a time. Fail on the fourth of six and the first
 * three are already in Firebase; the client retries, saveSubmission mints a
 * fresh 'sub_' + Date.now() for each, and those three become six orders with
 * six order numbers — discovered only when the glass is cut twice. A stable
 * id per (batch, index) turns the retry into an overwrite of the same paths.
 */
{
  const FB = fs.readFileSync(path.join(ROOT, 'firebase-db.js'), 'utf8');
  const fn = (FB.match(/async function saveSubmission[\s\S]*?\n}/) || [''])[0];
  check('saveSubmission is found', fn.length > 0, true);
  check('a caller may supply the id', /data\.id\s*\|\|/.test(fn), true);
  /* the prefix is load-bearing: sqSaveEdit, markStageValue and the queue all
     branch on it */
  check('and the generated form still starts with sub_', /'sub_' \+ Date\.now\(\)/.test(fn), true);

  /* the three helpers call each other, so they load as one unit */
  const batch = ['lgUploadBatch\\(\\)', 'lgUploadBatchSet', 'lgUploadBatchClear']
    .map(n => (UPLOAD.match(new RegExp('function ' + n + '[\\s\\S]*?\\n}')) || [''])[0])
    .join('\n');
  check('the batch helper is found', /function lgUploadBatch\(\)/.test(batch), true);
  check('and so are its two companions',
        /lgUploadBatchSet/.test(batch) && /lgUploadBatchClear/.test(batch), true);

  const store = {};
  const ctx = vm.createContext({
    sessionStorage: {
      getItem: k => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: k => { delete store[k]; },
    },
    JSON, Date,
  });
  vm.runInContext('var _lgBatchMem = null;\n' + batch, ctx);

  const first = ctx.lgUploadBatch();
  check('a batch has an id', typeof first.batchId, 'string');
  check('asking again during the same attempt returns the same batch',
        ctx.lgUploadBatch().batchId, first.batchId);
  check('so a retry writes the very same order id',
        'sub_' + ctx.lgUploadBatch().batchId + '_0', 'sub_' + first.batchId + '_0');
  check('and it survives in storage between attempts',
        typeof store.lgUploadBatch, 'string');

  /* the batch is kept precisely until everything is verified */
  ctx.lgUploadBatchClear();
  check('ending it clears the stored batch', 'lgUploadBatch' in store, false);
  check('and the next submission gets a different batch',
        ctx.lgUploadBatch().batchId !== first.batchId ||
          String(first.batchId).length > 0, true);
}

/* ── nothing waits forever ─────────────────────────────────────────────── */
/*
 * Two silent stalls, both ending in a button stuck on "מעבד..." with no error:
 * a compressImage callback that never fires stops the completion count so
 * saveAll is never called, and an offline Firebase set() never settles either
 * way. _lgWithTimeout already existed for exactly this — its own comment says
 * "המשתמש נשאר מול ספינר בלי שום הודעה" — but only login used it.
 */
{
  const fn = (UPLOAD.match(/async function submitUpload[\s\S]*?\n}/) || [''])[0];
  check('submitUpload is found', fn.length > 0, true);
  check('saving is bounded by a timeout', /_lgWithTimeout\(/.test(fn), true);
  check('processing is bounded too', /PROCESS_TIMEOUT_MS/.test(fn), true);
  check('the count-until-done loop is gone',
        /processed === uploadedFiles\.length/.test(fn), false);
  check('a stall re-enables the button instead of leaving it dead',
        /catch[\s\S]{0,300}?btn\.disabled = false/.test(fn), true);
  check('and says what went wrong in the page',
        /catch[\s\S]{0,300}?uploadNotice\(/.test(fn), true);
}
{
  const FB = fs.readFileSync(path.join(ROOT, 'firebase-db.js'), 'utf8');
  check('the timeout helper is exposed to pages',
        /window\._lgWithTimeout|_lgWithTimeout\s*[,}]/.test(FB) ||
        /function _lgWithTimeout/.test(FB), true);
}

/* ── success is claimed only after a read-back ─────────────────────────── */
{
  const fn = (UPLOAD.match(/async function verifySaved[\s\S]*?\n}/) || [''])[0];
  check('there is a verification step', fn.length > 0, true);
  /* one field, not the order: an order carries a base64 sketch, and reading it
     back to prove it exists would cost hundreds of kilobytes per file */
  check('it reads one field, not the whole order',
        /'\/id'/.test(fn), true);
  check('and it is bounded too', /_lgWithTimeout\(/.test(fn), true);

  const save = (UPLOAD.match(/async function saveAll[\s\S]*?\n  }/) || [''])[0];
  check('saveAll is found', save.length > 0, true);
  check('every save is verified before it counts',
        /verifySaved\(/.test(save), true);
  /* order, not distance — a distance window breaks whenever the failure
     message gets longer, which says nothing about the behaviour */
  check('the failure branch returns before the success screen',
        save.indexOf('if(failures.length)') > -1 &&
        save.indexOf('if(failures.length)') < save.indexOf('successScreen'), true);
  check('and that branch really does return',
        /if\(failures\.length\)\{[\s\S]*?return;[\s\S]*?\}/.test(save), true);
  check('a partial save says how many got through',
        /נשמרו/.test(save), true);
  check('and the batch is kept until everything is verified',
        /lgUploadBatchClear\(\)[\s\S]{0,200}?successScreen/.test(save), true);
}

if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
console.log('\nAll upload checks passed.');
