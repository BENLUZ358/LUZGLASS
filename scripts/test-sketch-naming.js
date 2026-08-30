#!/usr/bin/env node
/**
 * Tests where a sketch gets its name.
 *
 * It used to be named at upload: one text box per file, in a grid of thumbnails
 * too small to tell the sketches apart. Naming ten of them meant guessing ten
 * times. So the box is gone from the portal, and the name is set in the sketch
 * queue instead — beside the full-size image, in the same pass that enters the
 * items. From there it travels exactly as before.
 *
 * Two things this suite guards, because both would be silent:
 *
 * An upload now stores an empty name rather than "סקיצה 1". An auto-name reads
 * on the queue like a real one, and then nothing on the screen distinguishes
 * "named" from "not yet named" — which is the whole thing the change is for.
 *
 * The field saves on change, not on input. Every write to `orders` re-sends the
 * node to every connected client; per-keystroke saving would do that twenty
 * times for one name. This is the same 4.6 MB measured in test-sketch-storage.
 *
 * Run: node scripts/test-sketch-naming.js
 */

const fs   = require('fs');
const path = require('path');

const ROOT   = path.join(__dirname, '..');
const read   = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const UPLOAD = read('upload.html');
const ADMIN  = read('admin.html');

let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));

const bodyOf = (src, name) =>
  (src.match(new RegExp('(async )?function ' + name + '\\([\\s\\S]*?\\n}')) || [''])[0];

/* ── the portal no longer asks ─────────────────────────────────────────── */
check('no name box on the upload previews',
      /placeholder="שם סקיצה/.test(UPLOAD), false);
check('and nothing still writes to a per-file name',
      /uploadedFiles\[\$?\{?i\}?\]\.sketchName\s*=/.test(UPLOAD), false);
check('the remove button survived the rewrite',
      /class="rm" onclick="removeFile/.test(UPLOAD), true);
/* this pinned `const fileSketchName = '';` — the variable, not the behaviour.
   The reliability rewrite passes the empty name straight to saveSubmission and
   the name is still empty, which is the whole point of the check. */
check('an upload saves an empty name, not an invented one',
      /sketchName:\s*''/.test(bodyOf(UPLOAD, 'saveAll')), true);
check('the auto-name is really gone',
      /'סקיצה ' \+ \(i \+ 1\)/.test(UPLOAD), false);

/* ── the queue asks instead ────────────────────────────────────────────── */
check('the queue has a name field', /id="sqNameInput"/.test(ADMIN), true);
check('with a visible label, not a placeholder standing in for one',
      /<label for="sqNameInput">שם הסקיצה<\/label>/.test(ADMIN), true);
/* below the image: it is the only screen showing the sketch full size, which
   is the entire reason naming moved here */
check('it sits below the image, not above it',
      ADMIN.indexOf('id="sqImgWrap"') < ADMIN.indexOf('id="sqNameWrap"'), true);
check('and before the items, which is the same pass of work',
      ADMIN.indexOf('id="sqNameWrap"') < ADMIN.indexOf('id="sqItemsWrap"'), true);

/* ── one write per name ────────────────────────────────────────────────── */
check('saved on change', /onchange="sqSaveName\(this\.value\)"/.test(ADMIN), true);
check('never on input', /oninput="sqSaveName/.test(ADMIN), false);
{
  const body = bodyOf(ADMIN, 'sqSaveName');
  check('an unchanged field writes nothing', /if\(v === cur\) return;/.test(body), true);
  check('the write goes to the order', /updateOrder\(id, \{ sketchName: v \}\)/.test(body), true);
  check('and a failure is not swallowed', /alert\('שם הסקיצה לא נשמר/.test(body), true);
  /* sqCurrent detaches from sqItems on every rebuild — see the copies the
     orders listener already makes for total and orderClient */
  check('the list row is updated too, not only sqCurrent',
        /const row = sqItems\.find\(i => i\.id === id\);\s*if\(row\) row\.sketchName = v;/.test(body), true);
  check('and the list is redrawn', /sqRender\(\);/.test(body), true);
}
check('Enter commits rather than submitting anything',
      /if\(event\.key==='Enter'\)\{event\.preventDefault\(\);this\.blur\(\);\}/.test(ADMIN), true);

/* ── typing is not overwritten by a snapshot ───────────────────────────── */
/* orders re-broadcasts on every write from anywhere. The queue is open and the
   cursor is in the field; a snapshot landing mid-word must not replace it. */
check('a live snapshot leaves the field alone while it has focus',
      /if\(document\.activeElement\?\.id !== 'sqNameInput'\)\s*sqCurrent\.sketchName =/.test(ADMIN), true);
check('and the field is filled when a different sketch is opened',
      /nameEl\.value=o\.sketchName\|\|''; sqMarkNameState\(\);/.test(ADMIN), true);

/* ── unnamed is visible without reading ───────────────────────────────── */
check('an unnamed sketch says so in the list',
      /<span class="sq-unnamed">ללא שם<\/span>/.test(ADMIN), true);
check('and the empty field is marked',
      /el\.classList\.toggle\('sq-name-empty', !el\.value\.trim\(\)\)/.test(ADMIN), true);

/* ── touch ─────────────────────────────────────────────────────────────── */
/* under 16px iOS zooms the page on focus, and the queue is used on the iPad */
check('16px on touch widths', /@media\(max-width:900px\)\{\s*#sqNameInput\{ font-size:16px/.test(ADMIN), true);

/* ── the name still travels ────────────────────────────────────────────── */
/* the point of naming in the queue is that everything downstream is unchanged */
for (const [f, pat] of [
  ['workday.html',      /o\.sketchName\|\|o\.type\|\|''/],
  ['check-station.html', /sketchName:   o\.sketchName\|\|o\.type\|\|''/],
  ['drafter.html',      /sketchName:    o\.sketchName\|\|o\.type\|\|''/],
  ['firebase-db.js',    /sketchName:    o\.sketchName   \|\| o\.type/],
]) {
  check(`${f} still reads the same field`, pat.test(read(f)), true);
}

if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
console.log('\nAll sketch-naming checks passed.');
