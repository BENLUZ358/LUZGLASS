#!/usr/bin/env node
/**
 * Tests the shape property sheet — the way in for everything the engine
 * could already draw and nobody could enter.
 *
 * Eleven capabilities lived in lg-layout.js with no field to set them: the
 * step notch, a slope on either axis, glass thickness, the floor bracket,
 * the bracket inset. A capability with no way in is the same as no
 * capability at all.
 *
 * What matters most here is the round trip: a field the sheet writes must
 * be a field the engine reads. A control that sets a name nobody looks at
 * is worse than a missing control, because it looks like it worked.
 *
 * Run: node scripts/test-shape-sheet.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DEMO = fs.readFileSync(path.join(ROOT, 'sketch-demo.html'), 'utf8');
const ENGINE = fs.readFileSync(path.join(ROOT, 'lg-layout.js'), 'utf8');

let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));

/* The sheet is built from JS strings, so a call written sheetSet('notchW')
   appears in the file as sheetSet(\'notchW\'). Searching the raw text for
   the readable form finds nothing; unescaping first makes both forms the
   same question. */
const FLAT = DEMO.split("\\'").join("'");
const has = s => FLAT.indexOf(s) > -1;
/* the CSS rule a selector opens, found by text rather than by pattern —
   selectors here carry brackets and commas that a regex would have to
   escape one by one */
const rule = sel => {
  const i = DEMO.indexOf(sel);
  if (i < 0) return '';
  const open = DEMO.indexOf('{', i);
  return open < 0 ? '' : DEMO.slice(open, DEMO.indexOf('}', open) + 1);
};

console.log('');

/* ── the sheet exists and can be reached ────────────────────────────────── */
check('the sheet is in the markup', has('id="shapeSheet"'), true);
check('with a backdrop that closes it',
      has('id="shapeSheetBack" onclick="closeShapeSheet()"'), true);
check('it is a dialog for a screen reader', has('role="dialog" aria-modal="true"'), true);
check('and it is labelled', has('aria-labelledby="shapeSheetTitle"'), true);
check('escape closes it', has("Escape')closeShapeSheet()"), true);
check('every shape in the strip has a way to open it', has('openShapeSheet('), true);
check('and that button says what it is', has('aria-label="מאפייני הזכוכית"'), true);

/* ── touch and type, per the design rules ───────────────────────────────── */
{
  check('sheet inputs are 44px targets',
        rule('.sh-row input[type=number]').indexOf('min-height:44px') > -1, true);
  check('and 16px type, so iOS does not zoom on focus',
        rule('.sh-row input[type=number]').indexOf('font-size:16px') > -1, true);
  check('segment buttons are 44px too',
        rule('.sh-seg button').indexOf('min-height:44px') > -1, true);
  check('so is a toggle row', rule('.sh-tog').indexOf('min-height:44px') > -1, true);
  check('and the close button', rule('.sheet-x').indexOf('min-height:44px') > -1, true);
  check('motion is dropped for anyone who asked',
        /prefers-reduced-motion[\s\S]{0,120}\.sheet/.test(DEMO), true);
  check('the sheet respects the phone safe area',
        has('padding-bottom:env(safe-area-inset-bottom)'), true);
  check('and becomes a side panel once there is room',
        /@media \(min-width:601px\)\{[\s\S]{0,200}\.sheet\{/.test(DEMO), true);
}

/* ── the round trip: what the sheet writes, the engine reads ────────────── */
/* This is the check that matters. Every field the sheet sets is looked for
   in lg-layout.js — a control writing to a name nothing reads would look
   like it worked and change nothing on the drawing. */
{
  const written = new Set();
  const grab = re => { let m; const r = new RegExp(re, 'g');
    while ((m = r.exec(FLAT))) written.add(m[1]); };
  grab("sheetSet\\('([a-zA-Z0-9]+)'");
  grab("sheetNum\\('([a-zA-Z0-9]+)'");
  grab("_shNum\\('([a-zA-Z0-9]+)'");
  grab("_shSeg\\('([a-zA-Z0-9]+)'");
  /* the toggle defaults name fields too */
  let m; const tog = /sheetToggle\('[a-zA-Z]+',this\.checked,\{([^}]*)\}/g;
  while ((m = tog.exec(FLAT))) {
    let f; const inner = /([a-zA-Z0-9]+)\s*:/g;
    while ((f = inner.exec(m[1]))) written.add(f[1]);
  }

  check('the sheet writes a useful number of fields', written.size >= 12, true);
  const orphan = [...written].filter(f => ENGINE.indexOf(f) < 0);
  check('and every one of them is read by the engine', orphan, []);
}

/* ── every engine capability has a control ──────────────────────────────── */
{
  const WANT = ['notchW', 'notchH', 'notchSide', 'notchBracket', 'notchHIn', 'notchRest',
                'slopeH1', 'slopeH2', 'slopeSideH', 'slopeW1', 'slopeW2', 'slopeSideV',
                'thickness', 'floorBracket', 'bracketInset'];
  check('nothing the engine can draw is unreachable',
        WANT.filter(f => !has("'" + f + "'") && !has(f + ':')), []);
}

/* ── a notch belongs to a fixed panel, never a door ─────────────────────── */
/* The step comes from the wall side, and a door hangs from the wall side.
   lgValidate refuses the combination, so the sheet must not offer it. */
check('the notch group is hidden on a door',
      /s\.kind==='door' \? '' :[\s\S]{0,140}פינוי מדרגה/.test(FLAT), true);

/* ── clearing a field returns to the engine's default ───────────────────── */
/* Writing 0 instead of deleting would pin a value that happens to equal the
   default today and stop tracking it tomorrow. */
{
  const fn = (DEMO.match(/function sheetSet\(field,val,redraw\)\{[\s\S]*?\n\}/) || [''])[0];
  check('an empty field is deleted, not zeroed', fn.indexOf('delete ps[field]') > -1, true);
  check('and setting one redraws', fn.indexOf('draw()') > -1, true);
}

/* ── the slope flag is explicit, never inferred ─────────────────────────── */
/* mkPS hands every shape slopeH1:2000 and slopeH2:1800 as "what you would
   get if you turned it on". Inferring a slope from their presence would
   have made every pane in the system sloped at once — which is exactly what
   the conversion test caught. */
{
  check('turning a height slope on sets its flag',
        has("sheetToggle('slopeH',this.checked,{hasSlope:true"), true);
  check('and a width slope sets its own',
        has("sheetToggle('slopeW',this.checked,{hasSlopeW:true"), true);
  check('the sheet reads the flag, not the numbers',
        has('hasSlopeH = !!ps.hasSlope'), true);
  check('and so does the engine',
        ENGINE.indexOf('st.hasSlope') > -1 && ENGINE.indexOf('st.hasSlopeW') > -1, true);
}

if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
console.log('\nAll sheet checks passed.');
