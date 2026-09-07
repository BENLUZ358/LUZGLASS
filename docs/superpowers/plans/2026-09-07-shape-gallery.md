# גלריה, ספריות ונתיבי מידה — תכנית יישום

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** שהלקוח יבחר מקלחון בתמונה או ירכיב אותו משייפים, ושהשרטט יקרא כל מידה בלי לספור קווים.

**Architecture:** מקצה נתיבים הופך התנגשות מידות לבלתי אפשרית מבנית, במקום להימנע ממנה בזהירות. הגלריה מציירת מאותו קוד שמצייר על הקנבס, ולכן לא יכולה להציג משהו אחר ממה שייווצר. הספריות יושבות ב-Firebase, ו-`COMBOS` נמחק מהקוד.

**Tech Stack:** HTML/CSS/JS ללא build, Firebase RTDB compat 9.23.0, בדיקות Node ב-`scripts/test-*.js`

**Spec:** `docs/superpowers/specs/2026-09-07-shape-gallery-design.md`
**קודמו:** `docs/superpowers/specs/2026-08-21-shape-builder-design.md` — המנוע וטבלת הצמתים

## מצב הפתיחה

שלב 1 של הבונה מוזג ל-`main`: `lg-shapes.js` (מנוע טהור), הצייר קורא ממנו את ההחלטות, מצב שייפים עם רצועה, ומצב עריכה למידות. באג הצירים בקומבינציות נסגר (`a02464c`), ו-`test-shapes-vs-combos.js` מוודא שהצייר והמנוע מסכימים על כל 16.

## Global Constraints

- **מקצה הנתיבים הוא החוק.** אף מידה לא מחשבת את המרחק שלה בעצמה. `_dimLane(zone)` הוא המקור היחיד, ואם מידה עוקפת אותו — היא שגויה.
- **המידה הקטנה קרובה לאובייקט, הגדולה רחוקה.** ISO 129. קו של מידה גדולה לא חוצה קו של קטנה.
- **מודדים חריגים.** גובה כולל פעם אחת; שייף ששונה מקבל קו הפניה. אותו כלל לצירים ולזוויות.
- **`lgBOM` לא מחזיר מק"טים לעולם.** נשמר משלב 1.
- **`preparedForDoor` לא מכפיל ספירה.** קבוע-לדלת + דלת = אותו ליקוט כמו קבוע-לדלת לבד, פלוס ידית.
- **תבנית שומרת טופולוגיה, לא מידות.** מידות נקבעות בכל פעם מחדש.
- **הצ'יפים נוצרים מקוד הציור**, לא מצוירים ביד.
- **לחיצה, לא גרירה.**
- עיצוב: יעד מגע 44×44px · מרווח 8px · ניגודיות 4.5:1 · גופן ≥12px · קלט 16px · אנימציה 150–300ms עם `prefers-reduced-motion` · בלי גלילה אופקית של הדף · נקודות שבירה **600 / 900 / 1200**.
- **הסריקה בודקת קוד יציאה**, לא את המחרוזת `FAIL`. חבילה שקורסת אינה מדפיסה `FAIL` ונראית ירוקה בטעות.
- שלוש חבילות נכשלות מראש מסיבת CRLF — `test-hashavshevet-order`, `test-order-pricing`, `test-sketch-storage`. לא נוגעים בהן.

---

### Task 1: מקצה הנתיבים

הבסיס. בלעדיו כל השאר ממשיך להתנגש.

**Files:**
- Modify: `sketch-demo.html`
- Test: `scripts/test-dim-lanes.js` (חדש)

**Interfaces:**
- Produces: `_dimLanesReset()` · `_dimLane(zone)` → מרחק בפיקסלים

- [ ] **Step 1: כתוב את הבדיקה הנכשלת**

צור `scripts/test-dim-lanes.js`:

```js
#!/usr/bin/env node
/**
 * Tests the dimension lane allocator.
 *
 * Every dimension used to compute its own offset from the panel face, and two
 * dimensions in the same place was a bug waiting for someone to notice. Height
 * lines on touching panels landed on each other and there was no telling which
 * measurement belonged to which shape — the door's height could not be read at
 * all.
 *
 * Technical drawing solved this a century ago (ISO 129): each dimension gets a
 * lane at a fixed distance, the smallest nearest the object. Collision is not
 * avoided by care, it is made impossible — a dimension asks for a lane and is
 * given a free one.
 *
 * Run: node scripts/test-dim-lanes.js
 */
const fs=require('fs'), path=require('path'), vm=require('vm');
const ROOT=path.join(__dirname,'..');
const DEMO=fs.readFileSync(path.join(ROOT,'sketch-demo.html'),'utf8');

let failed=0;
const check=(n,a,e)=>JSON.stringify(a)===JSON.stringify(e)
  ? console.log('ok    '+n)
  : (failed++, console.error(`FAIL  ${n}\n        expected ${JSON.stringify(e)}, got ${JSON.stringify(a)}`));

const src=['_dimLanesReset','_dimLane']
  .map(n=>(DEMO.match(new RegExp('function '+n+'[\\s\\S]*?\\n\\}'))||[''])[0]).join('\n');
check('the allocator is found', /function _dimLane\(/.test(src), true);

const ctx=vm.createContext({LANE_STEP:32,LANE_FIRST:24});
vm.runInContext('var _dimLanes={};\n'+src, ctx);

ctx._dimLanesReset();
check('the first lane sits closest to the object', ctx._dimLane('left'), 24);
check('the next one is further out',                ctx._dimLane('left'), 56);
check('and the one after that further still',       ctx._dimLane('left'), 88);

/* each zone counts on its own — a height and a width never share a lane
   because they are not even in the same direction */
check('a different zone starts over', ctx._dimLane('top'), 24);
check('and advances on its own',      ctx._dimLane('top'), 56);
check('without disturbing the first', ctx._dimLane('left'), 120);

/* a redraw starts from nothing, or lanes would creep outward every frame */
ctx._dimLanesReset();
check('a redraw resets every zone', [ctx._dimLane('left'), ctx._dimLane('top')], [24,24]);

/* the property that matters, stated directly */
ctx._dimLanesReset();
const got=[];
for(let i=0;i<6;i++) got.push(ctx._dimLane('right'));
check('no two dimensions in a zone ever share a distance',
      got.length, new Set(got).size);
check('and they only ever move outward',
      got.every((v,i)=>i===0||v>got[i-1]), true);

/* an unknown zone must not throw — a new dimension type should degrade, not
   crash the whole drawing */
ctx._dimLanesReset();
check('an unseen zone still gets a lane', typeof ctx._dimLane('nowhere'), 'number');

if(failed){console.error(`\n${failed} check(s) failed.`);process.exit(1);}
console.log('\nAll dimension-lane checks passed.');
```

- [ ] **Step 2: הרץ וודא שהיא נכשלת**

```
node scripts/test-dim-lanes.js
```

- [ ] **Step 3: כתוב את המקצה**

ב-`sketch-demo.html`, ליד `EDGE_MM`:

```js
// ── מקצה נתיבי המידה ──────────────────────────────────────────────
//
// כל מידה חישבה קודם את המרחק שלה בעצמה, ושתי מידות באותו מקום היו
// באג שממתין שמישהו ישים לב. קווי הגובה של פאנלים צמודים נחתו זה על
// זה, ואי אפשר היה לדעת איזו מידה שייכת לאיזה שייף.
//
// שרטוט טכני פותר את זה מזה מאה שנה: לכל מידה נתיב במרחק קבוע,
// הקטנה קרובה לאובייקט והגדולה רחוקה — כדי שקו של מידה גדולה לא
// יחצה קו של קטנה. ההתנגשות לא נמנעת בזהירות, היא בלתי אפשרית.
const LANE_FIRST=24, LANE_STEP=32;
let _dimLanes={};
function _dimLanesReset(){ _dimLanes={}; }
function _dimLane(zone){
  const n=_dimLanes[zone]||0;
  _dimLanes[zone]=n+1;
  return LANE_FIRST+n*LANE_STEP;
}
```

- [ ] **Step 4: אפס בכל ציור**

ב-`drawComboMode` וב-`drawItemMode`, ליד `dimHits=[]`:

```js
  dimHits=[];
  // בלי איפוס הנתיבים היו זוחלים החוצה בכל ציור מחדש
  _dimLanesReset();
```

- [ ] **Step 5: הרץ עד ירוק · Step 6: קבע**

```bash
git add sketch-demo.html scripts/test-dim-lanes.js
git commit -m "feat: dimensions ask for a lane instead of computing their own offset"
```

---

### Task 2: המידות עוברות לנתיבים

**Files:**
- Modify: `sketch-demo.html`
- Test: `scripts/test-dim-lanes.js`, `scripts/test-shapes-drawer.js`

- [ ] **Step 1: כתוב את הבדיקה הנכשלת**

הוסף ל-`test-dim-lanes.js`:

```js
/* ── every dimension goes through the allocator ────────────────────────── */
/*
 * The point of the allocator is that nothing bypasses it. A single dimension
 * that keeps its own hardcoded offset is a single dimension that can land on
 * another one, and it will be the one nobody tests.
 */
check('no dimension still carries a hand-picked offset',
      /dLine\([^;]*?,\s*-?(26|28|24|18|16|22)\s*,/.test(
        DEMO.replace(/\/\/[^\n]*/g,'')), false);
check('the width lane is asked for',   /_dimLane\('top'\)/.test(DEMO), true);
check('the height lane is asked for',  /_dimLane\('left'\)/.test(DEMO), true);
check('the hardware lane is asked for',/_dimLane\('right'\)/.test(DEMO), true);

/* ── exceptions, not repetition ────────────────────────────────────────── */
/*
 * A typical shower is 2000 2000 1985 2000 2000 — five heights, four of them
 * the same. Measuring every one is what made the drawing unreadable. The
 * overall height is dimensioned once and only a shape that differs gets its
 * own line, with a leader pointing at it.
 */
{
  const fn=(DEMO.match(/function _heightDims[\s\S]*?\n\}/)||[''])[0];
  check('the height chooser is found', fn.length>0, true);
  const ctx2=vm.createContext({});
  vm.runInContext(fn, ctx2);
  const call=hs=>ctx2._heightDims(hs.map(h=>({h})));

  check('all the same height gives one dimension',
        call([2000,2000,2000]).length, 1);
  check('and it is the overall height',
        call([2000,2000,2000])[0].mm, 2000);
  /* the ordinary shower: a door 15 mm shorter than the fixed panels */
  const t=call([2000,1985,2000]);
  check('one door out of three gives two dimensions', t.length, 2);
  check('the overall first', t[0].mm, 2000);
  check('then the exception, tied to its shape', [t[1].mm, t[1].idx], [1985,1]);
  /* nothing is hidden: five different heights still give five */
  check('five different heights give five', call([1,2,3,4,5]).length, 5);
  check('a single shape gives one', call([2000]).length, 1);
  check('no shapes, no dimensions', call([]).length, 0);
}
```

- [ ] **Step 2: הרץ (אדום) · Step 3: כתוב את `_heightDims`**

```js
// מודדים חריגים, לא הכל.
//
// מקלחון טיפוסי הוא 2000 2000 1985 2000 2000 — חמש מידות שארבע מהן
// זהות. מדידת כולן היא מה שהפך את הציור לבלתי קריא. הגובה הכולל נמדד
// פעם אחת, ורק שייף ששונה ממנו מקבל קו משלו עם קו הפניה אליו.
function _heightDims(pss){
  const list=(pss||[]).map((p,i)=>({idx:i,mm:Math.round(p&&p.h||0)})).filter(o=>o.mm>0);
  if(!list.length) return [];
  const max=Math.max.apply(null,list.map(o=>o.mm));
  const out=[{mm:max,idx:null,overall:true}];
  list.forEach(o=>{ if(o.mm!==max) out.push({mm:o.mm,idx:o.idx,overall:false}); });
  return out;
}
```

- [ ] **Step 4: החלף את קווי הגובה**

הסר את `_hx` / `_hoff` מ-Task 3 של התכנית הקודמת, ובמקומם:

```js
  // גובה — נמדד פעם אחת מחוץ להרכבה, וחריגים מקבלים קו הפניה
  if(idx===0){
    _heightDims(allPS).forEach(d=>{
      const lane=_dimLane('left');
      const hy = d.overall ? y+ph : y+(d.mm)*sc;
      dLine(x-lane,y,x-lane,hy,String(d.mm),-18,false,
            d.overall?null:{pfx:pfx,field:'h',idx:d.idx});
      if(!d.overall) _leaderTo(x-lane,hy,d.idx,allPS,sc,x,y);
    });
  }
```

- [ ] **Step 5: הרוחב והפרזול לנתיבים**

```js
  dLine(x,y-_dimLane('top'),x+pw,y-_dimLane('top'),`${ps.w}`,0,true,`${pfx}_w_${idx}`);
```
והרוחב הכולל פעם אחת, ב-`drawComboMode`, בנתיב `top` שאחריו.

הצירים והידית עוברים לנתיב `right` באותה צורה.

- [ ] **Step 6: קו ההפניה**

```js
// קו דק באלכסון מהמידה אל השייף שהיא מתארת. בלעדיו "1985" באוויר לא
// אומר על איזה שייף מדובר.
function _leaderTo(fromX,fromY,idx,allPS,sc,baseX,baseY){
  let cx0=baseX;
  for(let i=0;i<idx;i++) cx0+=((allPS[i]&&allPS[i].w)||500)*sc;
  cx0+=(((allPS[idx]&&allPS[idx].w)||500)*sc)/2;
  cx.save();
  cx.strokeStyle='#b8922a';cx.lineWidth=0.7;cx.setLineDash([2,2]);
  cx.beginPath();cx.moveTo(fromX,fromY);cx.lineTo(cx0,fromY);cx.stroke();
  cx.restore();
}
```

- [ ] **Step 7: הסר את המידות מהזכוכית**

```js
  // המידות שהודפסו על הזכוכית היו פלסטר לחפיפה, והנתיבים פותרים אותה
  // טוב יותר. טקסט על הזכוכית מסתיר את הציור.
```
נשארים: המספר `①`, שם השייף, ו-`▼` בשיפוע.

- [ ] **Step 8: הרץ הכל · Step 9: בדיקה ידנית** — 5 שייפים, אף מידה לא על אחרת · **Step 10: קבע**

---

### Task 3: `preparedForDoor` במנוע

**Files:** `lg-shapes.js`, `scripts/test-shapes-engine.js`

- [ ] **Step 1: בדיקה**

```js
/* ── a fixed panel drilled for a door ──────────────────────────────────── */
/*
 * The operator asked that a fixed ordered with hinge holes shows its hinges
 * from the moment it is placed — the glass really is drilled. A door that
 * attaches hangs on those same hinges and adds nothing, so the count stays
 * what it was. That is the same promise that stopped six being counted where
 * four exist; the junction is established by the preparation instead of by
 * the door.
 */
{
  const prepared=id=>({id,kind:'fixed',w:700,h:2000,preparedForDoor:true});
  const alone=shower([prepared('s1')],{right:'wall',left:'open'});
  check('a fixed drilled for a door shows hinges on its own',
        lgBOM(alone).find(b=>b.type==='hinge-gg').qty, 2);
  check('and still takes its wall brackets',
        lgBOM(alone).find(b=>b.type==='bracket-wall').qty, 2);

  const withDoor=shower([prepared('s1'),door('s2','right')],{right:'wall',left:'open'});
  const q=t=>(lgBOM(withDoor).find(b=>b.type===t)||{qty:0}).qty;
  check('a door attaching to it adds no hinges', q('hinge-gg'), 2);
  check('the brackets do not change either',    q('bracket-wall'), 2);
  check('only the handle is new',               q('handle'), 1);

  /* an ordinary fixed is unaffected */
  check('a plain fixed still has no hinges',
        lgBOM(shower([fixed('s1')],{right:'wall',left:'open'}))
          .some(b=>b.type==='hinge-gg'), false);
}
```

- [ ] **Step 2–3: הרץ (אדום) · הוסף ל-`_lgEdge`**

```js
function _lgEdge(shape, side) {
  if (!shape) return 'wall';
  if (shape.kind !== 'door') {
    // קבוע שהוזמן עם קידוח לצירים מציג אותם מהרגע הראשון — הזכוכית
    // באמת מקודחת. דלת שמתחברת נתלית על אותם צירים ולא מוסיפה כלום:
    // הצומת נקבע על ידי ההכנה ולא על ידי נוכחות הדלת.
    if (shape.preparedForDoor && side === (shape.doorSide || 'left')) return 'hinge';
    return 'fixed';
  }
  return shape.hingeSide === side ? 'hinge' : 'handle';
}
```

⚠️ `hinge|hinge` חייב להישאר חסום ב-`lgValidate` — קבוע מוכן מול קבוע מוכן אינו חיבור.

- [ ] **Step 4–5: הרץ · קבע**

---

### Task 4: הגלריה

**Files:** `sketch-demo.html`, `scripts/test-shape-gallery.js` (חדש)

- [ ] **Step 1: בדיקה** — שבעה צ'יפים · כל אחד נושא ציור אמיתי · שיפוע אינו פריט · יעד 44px · `role="dialog"` · נסגר ב-Escape · 2/3/4 בשורה לפי 600/900/1200

- [ ] **Step 2–4:** הרץ · בנה · הרץ

**הצ'יפ מצייר מאותו קוד:**

```js
// ציור מוקטן אמיתי, מאותו drawSinglePanel שמצייר על הקנבס. אייקון
// שצויר ביד יכול להפסיק להתאים למה שהכלי מצייר ואיש לא ישים לב;
// ציור שנגזר מאותו מקור לא יכול.
function _chipPreview(kind,opts){
  const key=kind+'|'+JSON.stringify(opts||{});
  if(_chipCache[key]) return _chipCache[key];
  ...
  _chipCache[key]=c.toDataURL();
  return _chipCache[key];
}
```

- [ ] **Step 5: בדיקה ידנית בנייד** · **Step 6: קבע**

---

### Task 5: כיוון הבנייה ותוויות הקצוות

**Files:** `sketch-demo.html`, `scripts/test-shapes-ui.js`

- [ ] **Step 1: בדיקה**

```js
check('the build direction is stated', /בונים משמאל לימין/.test(DEMO), true);
check('and the empty state says to start from an end',
      /מתחילים מהקצה/.test(DEMO), true);
/* the labels were backwards: the engine's 'right' means "toward the previous
   shape", and the previous shape is drawn on the LEFT — so the button called
   "קצה ימין" controlled the left end of the drawing */
check('the ends are named for what they do, not for the engine\'s internals',
      /קצה ימין/.test(DEMO), false);
check('start and end instead', /התחלה/.test(DEMO) && /סוף/.test(DEMO), true);
```

- [ ] **Step 2–4:** הרץ · תקן · הרץ · **Step 5: קבע**

---

### Task 6: הספריות

**Files:** `sketch-demo.html`, `database.rules.json`, `scripts/seed-combos.js` (חדש), `scripts/test-combo-library.js` (חדש)

- [ ] **Step 1: בדיקה** — תבנית שומרת `shapes` ו-`boundary` ולעולם לא `w`/`h` · שם נדרש · שתי הספריות מוצגות מסומנות · מסך ריק עם כפתור אחד

```js
check('a template stores the shapes',  /shapes:\s*\[/.test(save), true);
check('and never a measurement',       /\b[wh]\s*:\s*\d/.test(tmplBlock), false);
check('the factory library is read by anyone signed in', ...);
check('and a client library only by its owner', ...);
```

- [ ] **Step 2: חוקי Firebase**

```json
"comboTemplates": {
  "factory": { ".read": "<כל מחובר>", ".write": "<אדמין>" },
  "clients": { "$phone": { ".read": "<אותו טלפון או אדמין>",
                           ".write": "<אותו טלפון או אדמין>" } }
}
```

⚠️ **`node scripts/deploy-rules.js` ידנית**, ומיד אחריו **בדיקת העלאה מהפורטל** — חוק חדש שחוסם העלאה נראה בדיוק כמו הצלחה עד שלקוח מתלונן.

- [ ] **Step 3: זריעה**

`scripts/seed-combos.js` — ריצה יבשה כברירת מחדל, `--write` לכתיבה.

⚠️ הזריעה לוקחת את `COMBOS` **אחרי** תיקוני `p_2k2d` ו-`h_2d`. הנתונים הישנים שגויים ואסור להנציח אותם.

- [ ] **Step 4: מחק את `COMBOS` מהקוד**

חפש כל קורא לפני המחיקה. שתי ספריות במקביל הן אותה טעות כמו `GL` המקובע לצד `prices/global`.

- [ ] **Step 5–6: הרץ · קבע**

---

### Task 7: שני המצבים

**Files:** `sketch-demo.html`, `scripts/test-shape-gallery.js`

- [ ] **Step 1: בדיקה** — `🚿 מקלחון` ו-`◫ יחידות` · מסך ריק מוביל ליחידות · `+ שמור לספרייה` דורש שם

- [ ] **Step 2–4:** הרץ · בנה · הרץ · **Step 5: קבע**

---

### Task 8: זום

- [ ] כפתורי `+` `−` 44px מעל הקנבס · לא פינץ' · טווח 0.5–2.5 · הבדיקה מוודאת שאין מאזין מחוות על הקנבס

---

## הבדיקה הידנית שסוגרת

1. **יחידות** → גלריה → **קבוע לדלת · דלת ימין · קבוע**
2. הליקוט: **4 זוויות · 2 צירים · 1 ידית** — **לא 4 צירים**
3. מידות: **2000 כולל** + **1985 עם קו הפניה לדלת** — **לא שלוש**
4. אף שתי מידות לא באותו קו
5. **+ שמור לספרייה** בשם
6. **מקלחון** → הספרייה שלי → התבנית שם, **בלי מידות**
7. פתח אותה, הזן מידות, ובדוק שהליקוט זהה
8. בפלאפון: הגלריה עולה מלמטה, הזום עובד, הדף נגלל, אין גלילה אופקית

## סדר העלייה

משימות 1–2 (נתיבים) עולות **בנפרד ולפני** השאר. הן משנות את הציור בכל מצב, כולל הקומבינציות שעובדות היום — וכדאי שירוצו לבד לפני שנוסיף עליהן גלריה וספריות.
