# בונה סקיצות מבוסס שייפים — שלב 1 — תכנית יישום

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** להוציא את חוקי הפרזול מתוך הצייר למנוע טהור, ולבנות עליו הרכבה משייפים בודדים עם ליקוט שאינו יכול לסתור את הציור.

**Architecture:** מנוע אחד, שני צרכנים — בדיוק כמו `LG_TRACK` ב-`workday.html`. `lg-shapes.js` מחזיר צמתים; הצייר מצייר מהם והליקוט נגזר מהם. הצייר הקיים (1,220 שורות) נשמר במלואו ומפסיק להחליט בלבד.

**Tech Stack:** HTML/CSS/JS ללא build, Firebase RTDB compat 9.23.0, בדיקות Node ב-`scripts/test-*.js`

**Spec:** `docs/superpowers/specs/2026-08-21-shape-builder-design.md`

## מצב הפתיחה

**שלב 0 כבר כתוב** בענף `hardware-items` (23.8) ולא מוזג — הוא נעצר כדי לא למזג בזמן הכנסת לקוח אמיתי. הוא אינו תלוי בתכנית הזו ואינו חלק ממנה.

**שאלת החסימה נענתה.** הספק דרש לוודא שהצייר עדיין מצייר נכון אחרי המעבר מס"מ למ"מ. אומת ב-7.9 מול צילום מסך מהמכשיר: קווי מידה 500 · 800 · 2000 · 20 במקומם ובפרופורציה. הצייר תקין.

**שדות הקלט תוקנו** (`d11e959`) — `lgMmToInputStr` מחזיר מ"מ לשדה, והמידות שורדות הלוך-ושוב.

## Global Constraints

- **המנוע טהור.** `lg-shapes.js` — בלי DOM, בלי קנבס, בלי Firebase, בלי `window`. הוא נטען ב-`vm` בבדיקות.
- **`lgBOM` לא מחזיר מק"טים לעולם.** רק סוגים ווריאנטים. זו ההחלטה הארכיטקטונית של הספק: מק"ט במנוע היה קושר אותו למותג פרזול של לקוח מסוים.
- **`lgBOM` קורא את `lgJunctions`.** אסור שיחשב צמתים בעצמו — שתי גרסאות יתפצלו, וזה בדיוק מה שמייצר את ספירת ה-6 במקום 4.
- **הפרזול שייך לצומת, לא לשייף.** ציר בין קבוע לדלת הוא חתיכה אחת, נספרת פעם אחת.
- **הצייר לא מוחלף.** 1,220 השורות נשמרות. הן מפסיקות להחליט ומתחילות לצייר את מה שהמנוע מחזיר.
- **מזהי שייף יציבים.** `id` לא משתנה לעולם; המספר המוצג נגזר מהמיקום. הסיבה בספק: `chisumArrivedIdxs` הוא אינדקס מיקומי, וההצפנה שלו היא מה ששבר את סימוני החיסום.
- **מידות דרך `lg-parse.js` בלבד.** `lgParseDimensionInput` לקלט, `lgMmToInputStr` לשדה. אין פרסור מקומי.
- עיצוב: יעד מגע 44×44px, מרווח 8px, ניגודיות 4.5:1, גופן ≥12px, אנימציה 150–300ms עם `prefers-reduced-motion`, בלי גלילה אופקית.
- **מטרה גדולה על הציור, מטרה קטנה ברצועה** — קו מידה (~90×30px) נלחץ על הציור; ציר (~10px) ברצועה.
- כל משימה מסתיימת בחבילה שלה ירוקה **ובלי נפילות חדשות**. שלוש חבילות נכשלות מראש מסיבת CRLF — `test-hashavshevet-order`, `test-order-pricing`, `test-sketch-storage` — ואין לתקן אותן כאן.
- **הסריקה חייבת לבדוק קוד יציאה**, לא לחפש את המחרוזת `FAIL`. חבילה שקורסת אינה מדפיסה `FAIL` ונראית ירוקה בטעות.

---

### Task 1: המנוע — צמתים וּולידציה

הלב. כל השאר תלוי בו, והוא נבדק בלי דפדפן.

**Files:**
- Create: `lg-shapes.js`
- Test: `scripts/test-shapes-engine.js`

**Interfaces:**
- Produces: `lgJunctions(shower)` → `[{ between:[a,b], type, qty }]`
- Produces: `lgValidate(shower)` → `[{ at, msg }]`

- [ ] **Step 1: כתוב את הבדיקה הנכשלת**

צור `scripts/test-shapes-engine.js`:

```js
#!/usr/bin/env node
/**
 * Tests lg-shapes.js — the rules engine behind the shape builder.
 *
 * The rules were always there; they were trapped inside the drawer.
 * drawSinglePanel both decided that a wall-mounted fixed panel takes four
 * brackets and drew them, so a bill of materials could not be derived without
 * writing the same rules a second time — and two copies drift.
 *
 * The counting case is the one that matters. Hardware belongs to the JUNCTION,
 * not to the shape: the hinge between a fixed panel and a door is one piece
 * shared by both, not one for each. Count per shape and every shower comes out
 * as six pieces instead of four, and that number reaches the warehouse.
 *
 * Run: node scripts/test-shapes-engine.js
 */
const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const ROOT = path.join(__dirname, '..');
const SRC  = fs.readFileSync(path.join(ROOT, 'lg-shapes.js'), 'utf8');

/* the engine must be pure — it has to run with no DOM, no window, no firebase */
const ctx = vm.createContext({});
vm.runInContext(SRC, ctx);
const { lgJunctions, lgValidate } = ctx;

let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));

const shower = (shapes, boundary) => ({
  boundary: boundary || { right: 'wall', left: 'wall' },
  finish: 'shahor', quality: 'zamak', shapes,
});
const fixed = (id, extra) => Object.assign({ id, kind: 'fixed', w: 700, h: 2000 }, extra || {});
const door  = (id, hingeSide, extra) =>
  Object.assign({ id, kind: 'door', w: 600, h: 2000, hingeSide: hingeSide || 'right' }, extra || {});

const types = s => lgJunctions(s).map(j => j.type);
const counts = s => {
  const out = {};
  lgJunctions(s).forEach(j => { if (j.type) out[j.type] = (out[j.type] || 0) + j.qty; });
  return out;
};

/* ── the five cases the spec names ─────────────────────────────────────── */

/* fixed + door + fixed: four wall brackets, two glass-glass hinges, one
   handle. Counting per shape instead of per junction gives six hinges. */
{
  const s = shower([fixed('s1'), door('s2', 'right'), fixed('s3')]);
  check('fixed + door + fixed — the wall brackets',
        counts(s)['bracket-wall'], 4);
  check('and the hinges are counted once for the pair, not once per shape',
        counts(s)['hinge-gg'], 2);
  check('the shower is valid', lgValidate(s), []);
}

/* a door cannot hang on another door */
{
  const s = shower([fixed('s1'), door('s2', 'left'), door('s3', 'right'), fixed('s4')]);
  const bad = shower([fixed('s1'), door('s2', 'left'), door('s3', 'left')]);
  check('two doors meeting handle to handle are allowed', lgValidate(s), []);
  check('but a door hinged onto another door is refused', lgValidate(bad).length > 0, true);
  check('and the message names the offending shape', lgValidate(bad)[0].at, 's3');
}

/* a door needs something to hang on */
{
  const s = shower([door('s1', 'right')], { right: 'open', left: 'open' });
  check('a door anchored to nothing is refused', lgValidate(s).length > 0, true);
}

/* the two simple shapes */
{
  const one = shower([fixed('s1')]);
  check('a single fixed panel takes two wall brackets', counts(one)['bracket-wall'], 2);
  check('and nothing else', Object.keys(counts(one)), ['bracket-wall']);

  const two = shower([fixed('s1'), fixed('s2')]);
  check('fixed + fixed — four wall brackets', counts(two)['bracket-wall'], 4);
  check('and two glass-to-glass brackets', counts(two)['bracket-gg'], 2);
}

/* ── the junction table, read directly ─────────────────────────────────── */
{
  const s = shower([fixed('s1'), door('s2', 'right')], { right: 'wall', left: 'wall' });
  const js = lgJunctions(s);
  check('every gap between the walls is a junction', js.length, 3);
  check('the ends carry the wall', js[0].between[0], 'wall');
  check('a door hinged to a wall takes a wall hinge',
        types(shower([door('s1', 'right')], { right: 'wall', left: 'wall' }))[0], 'hinge-wall');
  check('the handle end against a wall carries no hardware',
        types(shower([door('s1', 'right')], { right: 'wall', left: 'wall' }))[1], null);
}

/* ── the handle is derived, never chosen ───────────────────────────────── */
/* the shape says which side it hangs from; the handle is always the other one,
   so there is no field in which to put a handle on the hinge side */
{
  const s = shower([fixed('s1'), door('s2', 'right')]);
  check('a shape carries no hardware of its own',
        Object.keys(s.shapes[1]).some(k => /hinge(?!Side)|bracket|handle/i.test(k)), false);
}

/* ── purity ────────────────────────────────────────────────────────────── */
check('the engine names no sku', /skuCatalog|itemkey|hashavshevet/i.test(SRC), false);
check('and touches no document', /document\.|window\.|canvas/i.test(SRC), false);
check('and no firebase', /firebase|_lgDb/i.test(SRC), false);

if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
console.log('\nAll shape-engine checks passed.');
```

- [ ] **Step 2: הרץ וודא שהיא נכשלת**

```
node scripts/test-shapes-engine.js
```
צפוי: קריסה — `lg-shapes.js` לא קיים.

- [ ] **Step 3: כתוב את המנוע**

צור `lg-shapes.js`:

```js
// ════════════════════════════════════════════════════════════════════════
//  LuzGlass — lg-shapes.js
//  מנוע חוקי הפרזול. טהור: בלי DOM, בלי קנבס, בלי Firebase.
// ════════════════════════════════════════════════════════════════════════
//
//  החוקים היו תמיד כאן — הם היו כלואים בתוך הצייר. drawSinglePanel גם
//  החליט שקבוע על קיר לוקח ארבע זוויות וגם צייר אותן, ולכן אי אפשר היה
//  לגזור ליקוט בלי לכתוב את החוקים פעם שנייה. שתי גרסאות מתפצלות.
//
//  העיקרון: **הפרזול שייך לצומת, לא לשייף.** הציר שבין הקבוע לדלת הוא
//  חתיכה אחת ששייכת לשניהם. ספירה לכל שייף בנפרד נותנת 6 במקום 4 בכל
//  מקלחון, והמספר הזה מגיע למחסן.

// קצה של שייף כפי שהוא נראה לצומת שלידו.
// לדלת שני קצוות שונים: קצה-ציר וקצה-ידית. הידית נגזרת — תמיד בצד ההפוך
// לציר — ולכן אין שדה שאפשר לשים בו ידית בצד הציר, ואי אפשר לטעות.
function _lgEdge(shape, side) {
  if (!shape) return 'wall';
  if (shape.kind !== 'door') return 'fixed';
  return shape.hingeSide === side ? 'hinge' : 'handle';
}

// טבלת הצמתים מהספק. מפתח: קצה א' + קצה ב', ממוינים כדי ששני הכיוונים
// ייתנו את אותה תשובה.
const _LG_JUNCTION = {
  'fixed|wall':   { type: 'bracket-wall', qty: 2 },
  'fixed|fixed':  { type: 'bracket-gg',   qty: 2 },
  'fixed|hinge':  { type: 'hinge-gg',     qty: 2 },
  'hinge|wall':   { type: 'hinge-wall',   qty: 2 },
  'handle|wall':  { type: null,           qty: 0 },
  'handle|handle':{ type: null,           qty: 0 },
  'fixed|handle': { type: null,           qty: 0 },
  'hinge|hinge':  { type: null,           qty: 0 },   // חסום ב-lgValidate
};

function _lgPairKey(a, b) { return [a, b].sort().join('|'); }

// כל הרווחים בין הקצוות, משמאל לימין: קיר, שייף, שייף, ..., קיר.
function lgJunctions(shower) {
  const shapes = (shower && shower.shapes) || [];
  const bound  = (shower && shower.boundary) || { right: 'wall', left: 'wall' };
  const out = [];
  for (let i = 0; i <= shapes.length; i++) {
    const left  = i === 0 ? null : shapes[i - 1];
    const right = i === shapes.length ? null : shapes[i];
    const leftEdge  = left  ? _lgEdge(left, 'left')   : (bound.right === 'wall' ? 'wall' : 'open');
    const rightEdge = right ? _lgEdge(right, 'right') : (bound.left  === 'wall' ? 'wall' : 'open');
    const rule = _LG_JUNCTION[_lgPairKey(leftEdge, rightEdge)] || { type: null, qty: 0 };
    out.push({
      between: [left ? left.id : 'wall', right ? right.id : 'wall'],
      type: rule.type,
      qty:  rule.qty,
    });
  }
  return out;
}

// מה שהמנוע עוצר. ההודעה נושאת את מזהה השייף, כדי שהמסך יוכל להצביע עליו.
function lgValidate(shower) {
  const shapes = (shower && shower.shapes) || [];
  const bound  = (shower && shower.boundary) || { right: 'wall', left: 'wall' };
  const errors = [];
  shapes.forEach((sh, i) => {
    if (sh.kind !== 'door') return;
    const side  = sh.hingeSide === 'left' ? 'left' : 'right';
    // מי יושב בצד שממנו הדלת נתלית
    const neighbour = side === 'right'
      ? (i === 0 ? (bound.right === 'wall' ? 'wall' : null) : shapes[i - 1])
      : (i === shapes.length - 1 ? (bound.left === 'wall' ? 'wall' : null) : shapes[i + 1]);
    if (!neighbour) {
      errors.push({ at: sh.id, msg: 'לדלת אין על מה להיתלות — נדרש קבוע או קיר' });
      return;
    }
    if (neighbour === 'wall') return;
    if (neighbour.kind === 'door') {
      errors.push({ at: sh.id, msg: 'דלת לא יכולה להיתלות על דלת' });
    }
  });
  return errors;
}

if (typeof module !== 'undefined' && module.exports)
  module.exports = { lgJunctions, lgValidate };
```

- [ ] **Step 4: הרץ עד ירוק**

```
node scripts/test-shapes-engine.js
```

- [ ] **Step 5: קבע**

```bash
git add lg-shapes.js scripts/test-shapes-engine.js
git commit -m "feat: the hardware rules leave the drawer and become an engine"
```

---

### Task 2: הליקוט — `lgBOM`

**Files:**
- Modify: `lg-shapes.js`
- Test: `scripts/test-shapes-engine.js`

**Interfaces:**
- Consumes: `lgJunctions` ממשימה 1
- Produces: `lgBOM(shower)` → `[{ type, variant, finish, quality, qty }]`

- [ ] **Step 1: כתוב את הבדיקה הנכשלת**

הוסף ל-`scripts/test-shapes-engine.js`, לפני בלוק הדיווח:

```js
/* ── the bill of materials ─────────────────────────────────────────────── */
/*
 * lgBOM reads lgJunctions. It must never compute junctions of its own: the
 * moment the picking list and the drawing each work it out separately they
 * drift, and the drift is invisible until the wrong count reaches the
 * warehouse. Same shape as LG_TRACK in workday.html — one engine, two
 * consumers.
 */
{
  const { lgBOM } = ctx;
  check('lgBOM exists', typeof lgBOM, 'function');

  const s = shower([fixed('s1'), door('s2', 'right'), fixed('s3')]);
  const bom = lgBOM(s);
  const line = t => bom.find(b => b.type === t);

  check('the wall brackets are one line of four', line('bracket-wall').qty, 4);
  check('the hinges are one line of two',         line('hinge-gg').qty, 2);
  check('a handle is derived for the door',       line('handle').qty, 1);
  check('nothing is listed twice',
        bom.length, new Set(bom.map(b => b.type + '|' + b.variant)).size);

  /* the architectural decision the spec calls the most important in the
     document: types, never skus. A sku in the engine would bind it to one
     customer's hardware brand. */
  check('no line carries a sku',
        bom.some(b => 'sku' in b || 'itemkey' in b), false);
  check('every line carries the finish and quality instead',
        bom.every(b => b.finish === 'shahor' && b.quality === 'zamak'), true);

  /* it must agree with the junctions by construction */
  const fromJunctions = counts(s);
  check('the picking list cannot contradict the drawing',
        line('bracket-wall').qty, fromJunctions['bracket-wall']);

  /* the contractor chooses HOW MANY; the engine decides the TYPE */
  const three = shower([fixed('s1', { wallBracketQty: 3 }), door('s2', 'right'), fixed('s3')]);
  check('three brackets is a choice the engine honours',
        lgBOM(three).find(b => b.type === 'bracket-wall').qty, 5);

  /* an open variant is a choice too, and it changes the line, not the type */
  const open = shower([fixed('s1', { bracketVariant: 'open' }), door('s2', 'right'), fixed('s3')]);
  check('an open bracket is a variant of the same type',
        open && lgBOM(open).some(b => b.type === 'bracket-wall' && b.variant === 'open'), true);
}
```

- [ ] **Step 2: הרץ וודא שהיא נכשלת**

- [ ] **Step 3: הוסף את `lgBOM`**

ב-`lg-shapes.js`, לפני הייצוא:

```js
// הליקוט. קורא את lgJunctions ולא מחשב צמתים בעצמו — אחרת יש שתי גרסאות
// של אותם חוקים, והפער ביניהן נגלה רק כשהמספר השגוי מגיע למחסן.
//
// מחזיר **סוגים, לא מק"טים**. זו ההחלטה החשובה במסמך התכנון: מק"ט בתוך
// המנוע היה קושר אותו לקטלוג ולמותג הפרזול של לקוח מסוים, וקבלן שעובד עם
// פרזול אחר היה מחייב שינוי במנוע. המיפוי (סוג, וריאנט) × (גימור, איכות)
// → מק"ט הוא שכבה נפרדת, בשלב 2.
function lgBOM(shower) {
  const shapes  = (shower && shower.shapes) || [];
  const finish  = (shower && shower.finish)  || '';
  const quality = (shower && shower.quality) || '';
  const byId    = {};
  shapes.forEach(s => { byId[s.id] = s; });

  const lines = {};
  const add = (type, variant, qty) => {
    if (!type || !qty) return;
    const key = type + '|' + (variant || 'regular');
    if (!lines[key]) lines[key] = { type, variant: variant || 'regular', finish, quality, qty: 0 };
    lines[key].qty += qty;
  };

  lgJunctions(shower).forEach(j => {
    if (!j.type) return;
    // הכמות היא בחירת הקבלן; הסוג הוא מה שהמנוע קבע. השייף שנוגע בצומת
    // הוא שנושא את הבחירה, ולכן נקראת ממנו ולא מהצומת.
    const owner = byId[j.between[0]] || byId[j.between[1]] || {};
    const isBracket = j.type.indexOf('bracket') === 0;
    const qty     = isBracket ? (Number(owner.wallBracketQty) || j.qty) : (Number(owner.hingeQty) || j.qty);
    const variant = isBracket ? owner.bracketVariant : owner.hingeVariant;
    add(j.type, variant, qty);
  });

  // ידית לכל דלת. היא נגזרת מצד הציר ולעולם לא נבחרת, ולכן אין לה צומת.
  shapes.forEach(s => { if (s.kind === 'door') add('handle', s.handleVariant, 1); });

  // מחזיק רצפה — בחירה מפורשת של הקבלן, לא נגזרת
  shapes.forEach(s => { if (s.floorBracket) add('bracket-floor', null, 1); });

  return Object.keys(lines).map(k => lines[k]);
}
```

והוסף לייצוא: `module.exports = { lgJunctions, lgValidate, lgBOM };`

- [ ] **Step 4: הרץ עד ירוק**

- [ ] **Step 5: קבע**

```bash
git add lg-shapes.js scripts/test-shapes-engine.js
git commit -m "feat: the picking list is derived from the junctions, not counted again"
```

---

### Task 3: הצייר מפסיק להחליט

הצייר נשמר. מה שיוצא ממנו הוא **ההחלטה** בלבד.

**Files:**
- Modify: `sketch-demo.html`
- Test: `scripts/test-shapes-drawer.js` (חדש)

**Interfaces:**
- Consumes: `lgJunctions` ממשימה 1

- [ ] **Step 1: כתוב את הבדיקה הנכשלת**

צור `scripts/test-shapes-drawer.js`:

```js
#!/usr/bin/env node
/**
 * Tests that the drawer draws what the engine decided, and decides nothing.
 *
 * drwBracket, drwGGBracket, drwHinge, drwHingeOnFixed and drwFloorBracket
 * each encoded a rule as well as a picture. As long as the decision lives
 * inside the drawing, a picking list has to restate it — and the two copies
 * drift where nobody can see.
 *
 * Run: node scripts/test-shapes-drawer.js
 */
const fs   = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DEMO = fs.readFileSync(path.join(ROOT, 'sketch-demo.html'), 'utf8');

let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));

check('the page loads the engine', /<script src="lg-shapes\.js"><\/script>/.test(DEMO), true);
check('and the drawer asks it what to draw', /lgJunctions\(/.test(DEMO), true);

/* the drawing functions keep their geometry and lose their rule */
{
  const draw = (DEMO.match(/function drawSinglePanel[\s\S]*?\n\}/) || [''])[0];
  check('drawSinglePanel is found', draw.length > 0, true);
  check('it no longer decides how many wall brackets there are',
        /wallSide\s*===\s*'both'/.test(draw), false);
}

/* the pieces themselves survive — they are the expensive part */
for (const fn of ['drwBracket', 'drwGGBracket', 'drwHinge', 'drwHingeOnFixed', 'drwFloorBracket']) {
  check(`${fn} is still there to draw with`, new RegExp('function ' + fn).test(DEMO), true);
}

/* the hinge symbol: same place, same colour, a shape a contractor recognises */
{
  const fn = (DEMO.match(/function drwHinge\([\s\S]*?\n\}/) || [''])[0];
  check('the hinge is drawn as a plate, a pivot and a clamp',
        /arc\(/.test(fn) && (fn.match(/fillRect|rect\(/g) || []).length >= 2, true);
  check('and keeps the gold it always had', /#b8922a|gold/i.test(fn) || /cx\.fillStyle/.test(fn), true);
}

/* a position map, so a shape can be pointed at later */
check('the drawer reports where each shape landed',
      /shapeRects|_lgShapeAt|hitMap/.test(DEMO), true);

if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
console.log('\nAll drawer checks passed.');
```

- [ ] **Step 2: הרץ וודא שהיא נכשלת**

- [ ] **Step 3: טען את המנוע**

ב-`sketch-demo.html`, ליד `<script src="lg-parse.js"></script>`:

```html
<script src="lg-shapes.js"></script>
```

- [ ] **Step 4: העבר את ההחלטה למנוע**

בכל מקום ב-`drawSinglePanel` שבו נקבעת **כמות** או **קיום** של פרזול, החלף את התנאי בקריאה לתוצאת `lgJunctions` שחושבה פעם אחת לפני הלולאה. הציור עצמו — הקואורדינטות, הצבעים, הגדלים — לא משתנה.

התבנית:

```js
// פעם אחת, לפני שמציירים
const _junctions = lgJunctions(_currentShower());

// ובתוך הציור, במקום להחליט:
_junctions.forEach(j => {
  if(j.type === 'bracket-wall')  { /* צייר j.qty זוויות במיקום של j */ }
  if(j.type === 'bracket-gg')    { /* ... */ }
  if(j.type === 'hinge-gg')      { /* ... */ }
  if(j.type === 'hinge-wall')    { /* ... */ }
});
```

- [ ] **Step 5: החלף את סמל הציר**

ב-`drwHinge` — **רק הגאומטריה**. אותו מיקום, אותו גודל, אותו זהב:

```js
// ציר הוא פיזית לוחית, ציר סיבוב ומלחציים על הזכוכית. המלבן שהיה כאן ישב
// במקום הנכון אבל לא נראה כמו ציר, וקבלן שמסתכל על השרטוט צריך לזהות מיד.
// המיקום לא משתנה: hx = hingeSide==='left' ? x : x+pw, ‏20 מ"מ מלמעלה ומלמטה.
function drwHinge(x, y){
  cx.fillStyle = '#b8922a';
  cx.fillRect(x - 6, y - 7, 5, 14);      // הלוחית
  cx.beginPath(); cx.arc(x, y, 3, 0, Math.PI * 2); cx.fill();   // ציר הסיבוב
  cx.fillRect(x + 2, y - 4, 6, 8);       // המלחציים על הזכוכית
}
```

ואותו שינוי ב-`drwHingeOnFixed`.

- [ ] **Step 6: חשוף מפת מיקומים**

בסוף הציור, שמור איזה שייף יושב באיזה מלבן:

```js
// בלי המפה הזו אי אפשר יהיה להצביע על צורה — לא במסך הזה ולא בתחנת
// הבדיקה. נשמר עכשיו כי אחר כך זה יחייב לחזור לצייר.
window._lgShapeRects = shapeRects;   // [{ id, x, y, w, h }]
```

- [ ] **Step 7: הרץ**

```
node scripts/test-shapes-drawer.js
node scripts/test-shapes-engine.js
node scripts/test-dimensions.js
node scripts/test-dom-ids.js
node scripts/test-undefined-vars.js
```

- [ ] **Step 8: בדיקה ידנית — חובה**

הבדיקות סטטיות. פתח `sketch-demo.html` בדפדפן:

1. בחר "קבוע ודלת" — הציור זהה למה שהיה, עם סמל ציר חדש
2. ספור זוויות: קבוע על קיר → 4, לא 6
3. בחר "2 קבועים 2 דלתות" — הציור שלם
4. שנה מידה — הציור מתעדכן

- [ ] **Step 9: קבע**

```bash
git add sketch-demo.html scripts/test-shapes-drawer.js
git commit -m "feat: the drawer draws what the engine decided"
```

---

### Task 4: הגלריה והרצועה

**Files:**
- Modify: `sketch-demo.html`
- Test: `scripts/test-shapes-ui.js` (חדש)

- [ ] **Step 1: כתוב את הבדיקה הנכשלת**

צור `scripts/test-shapes-ui.js` עם בדיקות ל:

```js
/* הגלריה קצרה בכוונה — שש-שבע צורות, ושתיים מהן קיצורי דרך */
check('the gallery offers a fixed panel',      /data-shape="fixed"/.test(DEMO), true);
check('a sloped fixed panel is a shortcut, not a kind',
      /data-shape="fixed"[^>]*data-slope|hasSlope/.test(DEMO), true);
check('a door for each hinge side',
      /data-shape="door"[^>]*data-hinge="right"/.test(DEMO) &&
      /data-shape="door"[^>]*data-hinge="left"/.test(DEMO), true);
check('no gallery item bakes hardware in',
      /data-shape="[^"]*"[^>]*data-(hinge-qty|bracket)/.test(DEMO), false);

/* touch targets */
{
  const css = (DEMO.match(/\.shape-chip\s*\{[^}]*\}/) || [''])[0];
  check('a gallery chip is a 44px target',
        Number((css.match(/min-height:\s*(\d+)px/) || [])[1]) >= 44, true);
}

/* the strip is where the small targets live */
check('there is a strip for the small controls', /id="shapeStrip"/.test(DEMO), true);
check('validation errors point at a shape',
      /lgValidate\([\s\S]{0,200}?\.at/.test(DEMO), true);
```

- [ ] **Step 2–4:** הרץ (אדום) · בנה את הגלריה והרצועה לפי הספק · הרץ עד ירוק

**הגלריה:** שש צורות בלבד — קבוע · קבוע משופע · דלת ציר-ימין · דלת ציר-שמאל · מראה · צורה חופשית. "קבוע משופע" הוא `fixed` עם `hasSlope` מסומן מראש, לא סוג נפרד.

**החלוקה לפי גודל המטרה:**

| | גודל | איפה נוגעים |
|---|---|---|
| קו מידה של פאנל | ~90×30px | **על הציור** — `dLine(...)` כבר קושר קו לשדה |
| כפתור שיפוע | ~30×30px | **על הציור** |
| ציר · זווית | ~10px | **ברצועה** |

**השיפוע יוצא מהגלילה** — כפתור על השייף עצמו, שפותח שני דברים בלבד: ציר וצד.

- [ ] **Step 5: בדיקה ידנית בנייד** — הרכבת מקלחון שלם באצבע, בלי זום.

- [ ] **Step 6: קבע**

---

### Task 5: ספריית הקומבינציות

בלי ספרייה הכלי החדש **גרוע מהקיים**: היום לוחצים "קבוע ודלת" פעם אחת.

**Files:**
- Modify: `sketch-demo.html`, `database.rules.json`
- Create: `scripts/seed-combos.js`
- Test: `scripts/test-shapes-ui.js`

- [ ] **Step 1: בדיקה** — תבנית שומרת **טופולוגיה, לא מידות**:

```js
check('a template stores shapes and order',   /shapes:\s*\[/.test(seed), true);
check('and never a measurement',
      /\b(w|h)\s*:\s*\d/.test(templateBlock), false);
```

הסיבה בספק: *"תבנית עם מידות שמורות מזמינה לשלוח מידה מעבודה קודמת לחיסום, וזכוכית שנחתכה לא חוזרת."*

- [ ] **Step 2: זרע את 15 הקומבינציות** ל-`comboTemplates/` ב-Firebase, **ומחק את `COMBOS` מהקוד.**

⚠️ שתי ספריות במקביל הן אותה טעות כמו `GL` המקובע לצד `prices/global`. מי שיערוך אחת לא יידע על השנייה.

- [ ] **Step 3: חוק Firebase** — קריאה לכל מחובר, כתיבה לאדמין בלבד. ואז `node scripts/deploy-rules.js`.

- [ ] **Step 4–5:** הרץ · קבע

---

### Task 6: שמירה — כל שייף הוא פריט

**Files:**
- Modify: `sketch-demo.html`
- Test: `scripts/test-shapes-save.js` (חדש)

- [ ] **Step 1: בדיקה**

```js
check('each shape becomes an item', ...);
check('the shape id travels with the item', /shapeId:/.test(save), true);
check('dimensions are stored in millimetres', ...);
check('the hardware lines carry types, not skus',
      /itemkey|sku:/.test(bomBlock), false);
```

- [ ] **Step 2–5:** בנה את השמירה · הרץ · **בדיקה ידנית: הרכב, שמור, ובדוק שההזמנה מגיעה לתור הסקיצות** · קבע

---

## מה לא נכנס לשלב 1

לפי ההיקף בספק:

| נכנס | לא נכנס |
|---|---|
| מנוע חוקים טהור | זוויות 90° |
| גלריה · רצועה · הרכבה לינארית | הצבעה על צורה בתחנת הבדיקה |
| ליקוט בסוגים | מיפוי סוג → מק"ט (שלב 2) |
| ספריית קומבינציות | שורות פרזול במסמך (שלב 3) |
| שמירה לפיירבייס | |

## הבדיקה הידנית שסוגרת את השלב

הרכב מקלחון של **קבוע + דלת + קבוע**, ובדוק שהליקוט אומר:

```
4 זוויות קיר · 2 צירים זכוכית-זכוכית · 1 ידית
```

**לא 6 צירים.** זו הספירה שכל התכנית הזו קיימת בשבילה.
