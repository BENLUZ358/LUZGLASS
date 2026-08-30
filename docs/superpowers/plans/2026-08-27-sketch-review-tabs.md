# תור סקיצות — טאבי "עוד לא נראה" / "נראה" — תכנית יישום

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** לחלק את תור הסקיצות לשני טאבים, כך שסקיצה חדשה עוברת קודם בדיקה והדגשה ורק אז נכנסת למסך העבודה המלא.

**Architecture:** שדה אחד חדש על ההזמנה, `sketchSeenAt`, שהוא **תווית ולא שלב**. `stage` לא משתנה ולא נכתב. הטאבים חותכים את `sqItems` הקיים; התצוגה המצומצמת היא מחלקת CSS על הפאנל הקיים ולא מסך שני. ההערות משתמשות ב-`notes` שכבר קיים, ורק מחברות צנרת שנותקה.

**Tech Stack:** HTML/CSS/JS ללא build, Firebase RTDB compat 9.23.0, בדיקות Node ב-`scripts/test-*.js`

**Spec:** `docs/superpowers/specs/2026-08-27-sketch-review-tabs-design.md`

## Global Constraints

- **`stage` לא נכתב ולא משתנה באף צעד בתכנית הזו.** `sketchSeenAt` הוא תת-שלב ויזואלי. אם צעד כלשהו נראה כאילו הוא דורש `updateStage` — הוא שגוי, עצור.
- `lgNormalizeOrder` היא רשימת היתר. שדה שלא רשום בה נמחק בשקט בדרך לכל מסך.
- אין שינוי ב-`database.rules.json`. `orders/$orderId` מאמת רק `clientPhone`.
- אין שינוי בעיצוב הדסקטופ מעבר לתוספת שורת הטאבים.
- יעד מגע 44×44px לפחות, מרווח 8px, ניגודיות 4.5:1, גופן גוף ≥12px, אנימציה 150–300ms עם `prefers-reduced-motion`, בלי גלילה אופקית.
- `aria-label` על כל כפתור אייקון. שורת הטאבים עם `role="tablist"`/`role="tab"` ו-`aria-selected`.
- הקוד ב-`admin.html` משתמש בשרשור מחרוזות (`'a' + b + 'c'`), לא בתבניות. היצמד לסגנון הקובץ.
- כל משימה מסתיימת ב-`node scripts/test-<name>.js` ירוק **ובלי נפילות חדשות** בשאר החבילות. שלוש חבילות נכשלות מראש מסיבת CRLF — `test-hashavshevet-order`, `test-order-pricing`, `test-sketch-storage`. הן לא קשורות ואין לתקן אותן כאן.

---

### Task 1: `sketchSeenAt` עובר את רשימת ההיתר

זו המשימה הראשונה בכוונה. בלעדיה כל השאר נראה עובד ולא עובד: הכתיבה ל-Firebase מצליחה, והקריאה חזרה מחזירה `undefined`.

**Files:**
- Modify: `firebase-db.js` — בתוך `lgNormalizeOrder`, ליד `notes`
- Test: `scripts/test-order-normalizer.js`

**Interfaces:**
- Produces: `order.sketchSeenAt` — מספר. `0` = עוד לא נראה. משמש במשימות 2 ו-4.

- [ ] **Step 1: כתוב את הבדיקה הנכשלת**

ב-`scripts/test-order-normalizer.js`, מיד אחרי הבלוק שנסגר בשורה 105 (`}` שאחרי `'and can show how long it has been out'`), הוסף:

```js
/* ── תת-שלב הבדיקה בתור הסקיצות ─────────────────────────────────────
   sketchSeenAt מסמן שמישהו עבר על הסקיצה והדגיש בה מה שצריך. הוא תווית
   ולא שלב: stage נשאר '' משני צדי המעבר, והתור ממשיך להיבנות מ-stage
   בדיוק כמו קודם. אם הוא היה שלב, הוא היה מוציא את ההזמנה מהתור. */
check('the whitelist carries sketchSeenAt', whitelist.has('sketchSeenAt'), true);
check('a reviewed sketch keeps its timestamp',
      lgNormalizeOrder({ id: 'L1', sketchSeenAt: 1756500000000 }).sketchSeenAt, 1756500000000);
check('and one never reviewed reports 0, not undefined',
      lgNormalizeOrder({ id: 'L1' }).sketchSeenAt, 0);
/* the whole point: it is not a stage */
check('marking a sketch seen leaves the stage empty',
      lgNormalizeOrder({ id: 'L1', stage: '', sketchSeenAt: 1756500000000 }).stage, '');
```

- [ ] **Step 2: הרץ וודא שהיא נכשלת**

```
node scripts/test-order-normalizer.js
```
צפוי: `FAIL  the whitelist carries sketchSeenAt` ועוד שתי נפילות.

- [ ] **Step 3: הוסף את השדה לרשימת ההיתר**

ב-`firebase-db.js`, בתוך `lgNormalizeOrder`, מצא את השורה:

```js
    notes:         o.notes        || '',
```

והוסף **מיד אחריה**:

```js
    // תת-שלב ויזואלי בתוך תור הסקיצות, לא שלב. מסומן כשמי שעובר על
    // הסקיצות אישר אותה, ונקרא רק בתור הסקיצות ובפורטל. stage לא מושפע.
    sketchSeenAt:  o.sketchSeenAt || 0,
```

- [ ] **Step 4: הרץ וודא שהיא עוברת**

```
node scripts/test-order-normalizer.js
```
צפוי: כל השורות `ok`.

- [ ] **Step 5: קבע**

```bash
git add firebase-db.js scripts/test-order-normalizer.js
git commit -m "feat: sketchSeenAt survives the order whitelist"
```

---

### Task 2: שני הטאבים, התצוגה המצומצמת, ו"סקיצה טופלה"

**Files:**
- Modify: `admin.html` — שורת הטאבים ב-`#sqTopBar`, CSS, `sqFiltered`, `sqRender`, `sqShowDetail`, פונקציה חדשה `sqMarkSeen`
- Test: `scripts/test-sketch-review-tabs.js` (חדש)

**Interfaces:**
- Consumes: `order.sketchSeenAt` ממשימה 1
- Produces: `sqSeenTab` — משתנה מודול, `'unseen'` או `'seen'`

- [ ] **Step 1: כתוב את הבדיקה הנכשלת**

צור `scripts/test-sketch-review-tabs.js`:

```js
#!/usr/bin/env node
/**
 * Tests the review sub-stage in the sketch queue.
 *
 * A sketch arriving from a client used to land straight in the full working
 * screen. Someone reviews sketches before production — checks the dimensions
 * are there, writes on them where something needs emphasis — and that step had
 * nowhere to live, so there was no way to tell what had been reviewed.
 *
 * The split is a SUB-STAGE, not a stage. stage stays '' on both sides, the
 * queue is still built from stage, and nothing downstream changes. That is the
 * property most worth pinning: a bug here would push orders out of the queue.
 *
 * Run: node scripts/test-sketch-review-tabs.js
 */
const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const ROOT  = path.join(__dirname, '..');
const ADMIN = fs.readFileSync(path.join(ROOT, 'admin.html'), 'utf8');

let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));

/* ── the split itself ──────────────────────────────────────────────────── */
{
  const fn = (ADMIN.match(/function sqSeenSplit[\s\S]*?\n}/) || [''])[0];
  check('the split function is found', fn.length > 0, true);
  const ctx = vm.createContext({});
  vm.runInContext(fn, ctx);

  const items = [
    { id: 'a' },
    { id: 'b', sketchSeenAt: 0 },
    { id: 'c', sketchSeenAt: 1756500000000 },
  ];
  check('a sketch nobody reviewed is unseen',
        ctx.sqSeenSplit(items, 'unseen').map(i => i.id), ['a', 'b']);
  check('and one that was reviewed is seen',
        ctx.sqSeenSplit(items, 'seen').map(i => i.id), ['c']);
  check('every sketch lands in exactly one tab',
        ctx.sqSeenSplit(items, 'unseen').length + ctx.sqSeenSplit(items, 'seen').length,
        items.length);
  check('an empty queue does not throw', ctx.sqSeenSplit([], 'unseen'), []);
}

/* ── it is a sub-stage, not a stage ────────────────────────────────────── */
/*
 * The one property that must not break. If marking a sketch seen wrote stage,
 * the order would leave the queue entirely — buildSQItems keeps only orders
 * with no stage — and the drafter, check-station and Hashavshevet routes would
 * all see a stage nobody chose.
 */
{
  const fn = (ADMIN.match(/function sqMarkSeen[\s\S]*?\n}/) || [''])[0];
  check('the mark function is found', fn.length > 0, true);
  check('marking seen writes sketchSeenAt', /sketchSeenAt:\s*Date\.now\(\)/.test(fn), true);
  check('and writes nothing else to the order',
        /update(Order)?\([^)]*\{[^}]*\bstage\b/.test(fn), false);
  check('it never calls updateStage', /updateStage\s*\(/.test(fn), false);
  check('and never assigns to sqStageMap', /sqStageMap\s*\[[^\]]*\]\s*=/.test(fn), false);
}

/* the queue is still built from stage alone — the split did not move it */
check('the queue still admits orders by stage only',
      /if \(o\.stage && o\.stage !== ''\) return;/.test(ADMIN), true);
check('and buildSQItems does not filter on sketchSeenAt',
      /function buildSQItems[\s\S]*?\n}/.exec(ADMIN)[0].includes('sketchSeenAt'), false);

/* ── the review view hides the working screen, and only there ──────────── */
check('the detail panel carries a review mode class',
      /sq-review/.test(ADMIN), true);
check('the items editor is hidden in review mode',
      /\.sq-review\s+#sqItemsWrap[\s\S]{0,120}display\s*:\s*none/.test(ADMIN), true);
check('so are the Hashavshevet and OptyWay actions',
      /\.sq-review\s+#sqBtnChash[\s\S]{0,200}display\s*:\s*none/.test(ADMIN), true);
check('the sketch itself is never hidden',
      /\.sq-review\s+#sqImgWrap[\s\S]{0,80}display\s*:\s*none/.test(ADMIN), false);
check('and neither are the notes — they are written at this step',
      /\.sq-review\s+#sqNotesWrap[\s\S]{0,80}display\s*:\s*none/.test(ADMIN), false);

/* ── accessibility and touch ───────────────────────────────────────────── */
check('the tabs are a tablist', /role="tablist"/.test(ADMIN), true);
check('each tab reports whether it is selected', /aria-selected/.test(ADMIN), true);
{
  const css = (ADMIN.match(/\.sq-seen-tab\s*\{[^}]*\}/) || [''])[0];
  check('the tab rule is found', css.length > 0, true);
  const px = (css.match(/min-height:\s*(\d+)px/) || [])[1];
  check('a tab is at least a 44px touch target', Number(px) >= 44, true);
}
{
  const css = (ADMIN.match(/#sqBtnSeen\s*\{[^}]*\}/) || [''])[0];
  check('the "handled" button rule is found', css.length > 0, true);
  const px = (css.match(/min-height:\s*(\d+)px/) || [])[1];
  check('and it is at least 44px too', Number(px) >= 44, true);
}

if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
console.log('\nAll sketch-review-tab checks passed.');
```

- [ ] **Step 2: הרץ וודא שהיא נכשלת**

```
node scripts/test-sketch-review-tabs.js
```
צפוי: `FAIL  the split function is found` ואחריה נפילות נוספות.

- [ ] **Step 3: הוסף את שורת הטאבים**

ב-`admin.html`, אחרי `<div id="sqCounter"></div>` (שורה 2422), הוסף:

```html
      <div class="sq-seen-tabs" role="tablist" aria-label="שלב הבדיקה">
        <button class="sq-seen-tab sq-seen-on" id="sqTabUnseen" role="tab" aria-selected="true"
                onclick="sqSetSeenTab('unseen')">עוד לא נראה <span id="sqTabUnseenN">0</span></button>
        <button class="sq-seen-tab" id="sqTabSeen" role="tab" aria-selected="false"
                onclick="sqSetSeenTab('seen')">נראה <span id="sqTabSeenN">0</span></button>
      </div>
```

- [ ] **Step 4: הוסף את כפתור "סקיצה טופלה"**

ב-`#sqActions` (שורה 2489), הוסף כצאצא ראשון, לפני `sqBtnDrafter`:

```html
            <button id="sqBtnSeen" class="sq-action-btn" onclick="sqMarkSeen()">✓ סקיצה טופלה</button>
```

- [ ] **Step 5: הוסף את ה-CSS**

ב-`admin.html`, מיד לפני `#sqNameInput{` (שורה 2304), הוסף:

```css
/* ── תת-שלב הבדיקה ─────────────────────────────────────────────────
   הטאבים חותכים את אותה רשימה. מצב הבדיקה מסתיר את מסך העבודה במקום
   לשכפל אותו למסך שני — נתיב קוד אחד, מקום אחד שיכול להישבר. */
.sq-seen-tabs{display:flex;gap:8px;}
.sq-seen-tab{
  min-height:44px;padding:0 14px;
  background:transparent;border:1px solid rgba(247,244,239,0.18);
  border-radius:6px;cursor:pointer;
  font-family:Heebo,sans-serif;font-size:13px;font-weight:700;
  color:rgba(247,244,239,0.72);
  transition:background 180ms ease,color 180ms ease,border-color 180ms ease;
}
.sq-seen-tab:hover{border-color:rgba(184,146,42,0.5);color:#f7f4ef;}
.sq-seen-tab:focus-visible{outline:2px solid var(--gold-text);outline-offset:2px;}
.sq-seen-tab.sq-seen-on{background:#b8922a;border-color:#b8922a;color:#1a1714;}
.sq-seen-tab span{
  display:inline-block;min-width:20px;margin-right:6px;padding:0 5px;
  border-radius:9px;background:rgba(0,0,0,0.22);font-size:12px;
}
.sq-seen-tab.sq-seen-on span{background:rgba(0,0,0,0.18);}
#sqBtnSeen{min-height:44px;background:#27ae60;border-color:#27ae60;color:#fff;}
#sqBtnSeen:hover{background:#219150;border-color:#219150;}

/* מצב בדיקה — רק הסקיצה, השם, ההערות והפעולות של השלב הזה */
.sq-review #sqItemsWrap,
.sq-review #sqInfoGrid,
.sq-review #sqPanelsWrap,
.sq-review #sqCheckBadge,
.sq-review #sqBtnChash,
.sq-review #sqBtnOpty,
.sq-review #sqBtnTest,
.sq-review #sqBtnDrafter{display:none !important;}
/* ובטאב "נראה" אין את הכפתור הזה — הסקיצה כבר טופלה */
#sqDetailScroll:not(.sq-review) #sqBtnSeen{display:none;}

@media (prefers-reduced-motion:reduce){
  .sq-seen-tab{transition:none;}
}
@media (max-width:768px){
  .sq-seen-tabs{width:100%;order:5;}
  .sq-seen-tab{flex:1;font-size:14px;}
}
```

- [ ] **Step 6: הוסף את פונקציות החלוקה והסימון**

ב-`admin.html`, מיד אחרי `sqSaveNotes` (שורה 2551), הוסף:

```js
// הטאב הנוכחי. 'unseen' — מה שעוד לא עברו עליו. 'seen' — מסך העבודה המלא.
let sqSeenTab = 'unseen';

// חלוקה טהורה, כדי שאפשר יהיה להריץ אותה בבדיקה בלי דפדפן.
function sqSeenSplit(items, tab){
  return items.filter(function(i){
    return tab === 'seen' ? !!i.sketchSeenAt : !i.sketchSeenAt;
  });
}

function sqSetSeenTab(tab){
  sqSeenTab = tab === 'seen' ? 'seen' : 'unseen';
  var u = document.getElementById('sqTabUnseen');
  var s = document.getElementById('sqTabSeen');
  if(u){ u.classList.toggle('sq-seen-on', sqSeenTab === 'unseen');
         u.setAttribute('aria-selected', sqSeenTab === 'unseen'); }
  if(s){ s.classList.toggle('sq-seen-on', sqSeenTab === 'seen');
         s.setAttribute('aria-selected', sqSeenTab === 'seen'); }
  // הבחירה הנוכחית עשויה לא להיות בטאב החדש
  sqCurrent = null; sqCurrentIdx = -1;
  sqShowDetail();
  sqRender();
}

// מסמן שעברו על הסקיצה. כותב שדה אחד ותו לא.
//
// במפורש לא נכתב כאן stage. זה תת-שלב בתוך התור, לא מעבר בצנרת: התור
// נבנה מ-stage ריק, וכתיבת stage כאן הייתה מוציאה את ההזמנה מהתור לגמרי
// ומזיזה אותה לשרטט או לחשבשבת בלי שאיש ביקש.
function sqMarkSeen(){
  if(!sqCurrent) return;
  var id = sqCurrent.id, now = Date.now();
  sqCurrent.sketchSeenAt = now;
  var it = sqItems.find(function(i){ return i.id === id; });
  if(it) it.sketchSeenAt = now;
  updateOrder(id, { sketchSeenAt: now });
  showToast('✓ הסקיצה טופלה');
  // הבאה בתור, כמו אחרי כל פעולה אחרת במסך הזה
  sqCurrent = null; sqCurrentIdx = -1;
  sqShowDetail();
  sqRender();
}
```

- [ ] **Step 7: חבר את החלוקה ל-`sqFiltered` ואת המונים ל-`sqRender`**

ב-`sqFiltered` (שורה 2726), החלף את השורה האחרונה `return true;` ואת סגירת ה-`filter` כך שהתוצאה עוברת דרך החלוקה. כלומר, החלף:

```js
    if(q&&!(item.client+item.sketchName+item.orderNum).toLowerCase().includes(q)) return false;
    return true;
  });
}
```

ב:

```js
    if(q&&!(item.client+item.sketchName+item.orderNum).toLowerCase().includes(q)) return false;
    return true;
  }).filter(function(i){
    return sqSeenTab === 'seen' ? !!i.sketchSeenAt : !i.sketchSeenAt;
  });
}
```

וב-`sqRender`, מיד אחרי `const list=sqFiltered();` (שורה 2763), הוסף:

```js
  // המונים סופרים את התור כולו, לא את התוצאה המסוננת — אחרת חיפוש
  // היה נראה כאילו הוא מרוקן את הטאב השני.
  var nUnseen = sqSeenSplit(sqItems, 'unseen').length;
  var nSeen   = sqSeenSplit(sqItems, 'seen').length;
  var elU = document.getElementById('sqTabUnseenN');
  var elS = document.getElementById('sqTabSeenN');
  if(elU) elU.textContent = nUnseen;
  if(elS) elS.textContent = nSeen;
```

- [ ] **Step 8: החל את מצב הבדיקה ב-`sqShowDetail`**

ב-`sqShowDetail`, מיד אחרי `document.getElementById('sqDetailScroll').style.display='block';` (שורה 2827), הוסף:

```js
  // מצב בדיקה מסתיר את מסך העבודה בלי לשכפל אותו. ר' .sq-review ב-CSS.
  document.getElementById('sqDetailScroll').classList.toggle('sq-review', sqSeenTab === 'unseen');
```

- [ ] **Step 9: העבר את `sketchSeenAt` ל-`sqItems`**

ב-`buildSQItems`, בתוך ה-`sqItems.push({...})` (שורה 2696), הוסף שדה:

```js
      sketchSeenAt: o.sketchSeenAt || 0,
```

- [ ] **Step 10: הרץ את הבדיקות**

```
node scripts/test-sketch-review-tabs.js
node scripts/test-order-normalizer.js
node scripts/test-dom-ids.js
node scripts/test-undefined-vars.js
node scripts/test-admin-ui.js
```
כולן ירוקות.

- [ ] **Step 11: קבע**

```bash
git add admin.html scripts/test-sketch-review-tabs.js
git commit -m "feat: a sketch is reviewed before it reaches the working screen"
```

---

### Task 3: ההערות מגיעות לשרטט ולתחנת הבדיקה

היום תור הסקיצות כותב `notes` ל-Firebase ותחנת הבדיקה קוראת מ-`localStorage`. שתי מערכות שלא מדברות. השרטט לא רואה הערות בכלל.

**Files:**
- Modify: `check-station.html` — `load()` ו-`saveQN`/`saveSkNote`
- Modify: `drafter.html` — `showOrder`, ופופאפ חדש
- Test: `scripts/test-order-notes.js` (חדש)

**Interfaces:**
- Consumes: `order.notes` — קיים כבר ברשימת ההיתר

- [ ] **Step 1: כתוב את הבדיקה הנכשלת**

צור `scripts/test-order-notes.js`:

```js
#!/usr/bin/env node
/**
 * Tests that a note written in the sketch queue reaches the people it is for.
 *
 * The sketch queue wrote notes to Firebase; check-station read them from
 * localStorage only. Two note systems that never met, so the popup in
 * check-station fired only for notes written in check-station itself, and the
 * drafter had no notes at all. A note saying "the 8mm here is tempered, not
 * polished" simply never arrived.
 *
 * Run: node scripts/test-order-notes.js
 */
const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const ROOT = path.join(__dirname, '..');
const CS   = fs.readFileSync(path.join(ROOT, 'check-station.html'), 'utf8');
const DR   = fs.readFileSync(path.join(ROOT, 'drafter.html'), 'utf8');

let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));

/* ── the merge rule ────────────────────────────────────────────────────── */
{
  const fn = (CS.match(/function mergeOrderNotes[\s\S]*?\n}/) || [''])[0];
  check('the merge function is found', fn.length > 0, true);
  const ctx = vm.createContext({});
  vm.runInContext(fn, ctx);
  const merge = (local, orders) => ctx.mergeOrderNotes(local, orders);

  check('a note from the order arrives',
        merge({}, [{ id: 'a', notes: 'בדוק מידות' }]), { a: 'בדוק מידות' });
  check('and overrides a stale local copy',
        merge({ a: 'ישן' }, [{ id: 'a', notes: 'חדש' }]), { a: 'חדש' });
  /* the risk this guards: check-station's own notes were never in Firebase,
     so a blind overwrite would delete every note written at the station */
  check('a local note survives an order that carries none',
        merge({ a: 'נכתב בתחנה' }, [{ id: 'a' }]), { a: 'נכתב בתחנה' });
  check('an empty note on the order does not erase the local one',
        merge({ a: 'נכתב בתחנה' }, [{ id: 'a', notes: '' }]), { a: 'נכתב בתחנה' });
  check('notes for other orders are left alone',
        merge({ b: 'שלי' }, [{ id: 'a', notes: 'חדש' }]), { b: 'שלי', a: 'חדש' });
  check('no orders, no change', merge({ a: 'x' }, []), { a: 'x' });
}

/* ── check-station writes through, not only to localStorage ────────────── */
check('saving a note at the station reaches Firebase',
      /function saveQN[\s\S]*?updateOrder\(/.test(CS), true);
check('and so does saving it from the sheet',
      /function saveSkNote[\s\S]*?updateOrder\(/.test(CS), true);
check('localStorage is still written, so nothing is lost offline',
      /function saveQN[\s\S]*?saveNotes\(\)/.test(CS), true);

/* ── the drafter sees them at all ──────────────────────────────────────── */
check('the drafter has a note popup', /function drShowNote/.test(DR), true);
check('and opening a sketch triggers it',
      /function showOrder[\s\S]*?drShowNote\(/.test(DR), true);
check('the popup can be dismissed', /function drDismissNote/.test(DR), true);
check('its text is escaped, not injected as html',
      /function drShowNote[\s\S]{0,300}?textContent/.test(DR), true);

if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
console.log('\nAll order-note checks passed.');
```

- [ ] **Step 2: הרץ וודא שהיא נכשלת**

```
node scripts/test-order-notes.js
```
צפוי: `FAIL  the merge function is found` ואחריה נפילות נוספות.

- [ ] **Step 3: הוסף את פונקציית המיזוג לתחנת הבדיקה**

ב-`check-station.html`, מיד לפני `function saveNotes(){` (שורה 633), הוסף:

```js
// ההערה נכתבת בתור הסקיצות ונקראת כאן. עד עכשיו הצומת הזה קרא רק
// מ-localStorage, ולכן הערה מהתור לא הגיעה לעולם.
//
// הערה שעל ההזמנה גוברת. הערה מקומית שאין לה מקבילה על ההזמנה נשארת —
// הערות שנכתבו כאן בעבר מעולם לא הגיעו ל-Firebase, ודריסה עיוורת הייתה
// מוחקת את כולן.
function mergeOrderNotes(local, orders){
  var out = {};
  for (var k in local) out[k] = local[k];
  (orders || []).forEach(function(o){
    if (o && o.id && o.notes) out[o.id] = o.notes;
  });
  return out;
}
```

- [ ] **Step 4: הפעל את המיזוג כשההזמנות מגיעות**

ב-`check-station.html`, בתוך `listenAllOrders` (שורה 553), החלף:

```js
  _csUnsub = listenAllOrders(function(fbOrders){
    window._allCsOrders = fbOrders;
    _ordersReady = true;
    if(_wdReady) _filterOrders();
  }, err => _csListenerFailed('orders', err));
```

ב:

```js
  _csUnsub = listenAllOrders(function(fbOrders){
    window._allCsOrders = fbOrders;
    notes = mergeOrderNotes(notes, fbOrders);
    saveNotes();
    _ordersReady = true;
    if(_wdReady) _filterOrders();
  }, err => _csListenerFailed('orders', err));
```

- [ ] **Step 5: כתוב הערות חזרה ל-Firebase**

ב-`check-station.html`, ב-`saveQN` (שורה 1179), החלף:

```js
function saveQN(){if(!qnId)return;const txt=document.getElementById('qnText').value.trim();if(txt)notes[qnId]=txt;else delete notes[qnId];saveNotes();document.getElementById('qnModal').classList.remove('open');renderList();toast('הערה נשמרה ✓');}
```

ב:

```js
// נכתב לשני המקומות: ל-Firebase כדי שהשרטט ותור הסקיצות יראו אותה,
// ול-localStorage כדי שהיא תישאר גם אם הרשת נופלת באמצע.
function saveQN(){if(!qnId)return;const txt=document.getElementById('qnText').value.trim();if(txt)notes[qnId]=txt;else delete notes[qnId];saveNotes();updateOrder(qnId,{notes:txt});document.getElementById('qnModal').classList.remove('open');renderList();toast('הערה נשמרה ✓');}
```

ובאותו אופן `saveSkNote` (שורה 1238) — החלף:

```js
function saveSkNote(){if(!cur)return;const txt=document.getElementById('skNoteTA')?.value.trim();if(txt)notes[cur.id]=txt;else delete notes[cur.id];saveNotes();renderList();closeSheet();toast('הערה נשמרה ✓');}
```

ב:

```js
function saveSkNote(){if(!cur)return;const txt=document.getElementById('skNoteTA')?.value.trim();if(txt)notes[cur.id]=txt;else delete notes[cur.id];saveNotes();updateOrder(cur.id,{notes:txt});renderList();closeSheet();toast('הערה נשמרה ✓');}
```

- [ ] **Step 6: הוסף פופאפ הערה לשרטט**

ב-`drafter.html`, מיד לפני `</body>`, הוסף:

```html
<div id="drNotePopup" role="dialog" aria-modal="true" aria-labelledby="drNoteTitle"
     style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:900;
            align-items:center;justify-content:center;padding:20px;">
  <div style="background:#1f1c19;border:1px solid rgba(184,146,42,0.4);border-radius:10px;
              max-width:420px;width:100%;padding:20px;direction:rtl;">
    <div id="drNoteTitle" style="font-family:Heebo,sans-serif;font-size:15px;font-weight:900;
                color:#c9a84c;margin-bottom:10px;">💬 הערה על ההזמנה</div>
    <div id="drNoteText" style="font-family:Heebo,sans-serif;font-size:14px;line-height:1.6;
                color:#f7f4ef;white-space:pre-wrap;margin-bottom:16px;"></div>
    <button onclick="drDismissNote()"
            style="min-height:44px;width:100%;background:#b8922a;color:#1a1714;border:none;
                   border-radius:6px;font-family:Heebo,sans-serif;font-size:14px;
                   font-weight:700;cursor:pointer;">הבנתי</button>
  </div>
</div>
```

ובבלוק ה-script, הוסף:

```js
// ההערה נכתבת בתור הסקיצות או בתחנת הבדיקה, ומי שפותח את הסקיצה צריך
// לראות אותה. textContent ולא innerHTML — הטקסט מגיע ממשתמש.
function drShowNote(txt){
  var el = document.getElementById('drNoteText');
  if(!el || !txt) return;
  el.textContent = txt;
  document.getElementById('drNotePopup').style.display = 'flex';
}
function drDismissNote(){
  document.getElementById('drNotePopup').style.display = 'none';
}
```

- [ ] **Step 7: הצג את ההערה בפתיחת סקיצה**

ב-`drafter.html`, בסוף `showOrder` (לפני הסוגר המסולסל שלה), הוסף:

```js
  // אחרי שהמסך התייצב, אחרת הפופאפ קופץ על מסך ריק
  if(o.notes) setTimeout(function(){ drShowNote(o.notes); }, 300);
```

- [ ] **Step 8: הרץ את הבדיקות**

```
node scripts/test-order-notes.js
node scripts/test-dom-ids.js
node scripts/test-undefined-vars.js
node scripts/test-checkstate-race.js
```

- [ ] **Step 9: קבע**

```bash
git add check-station.html drafter.html scripts/test-order-notes.js
git commit -m "fix: a note written in the sketch queue never reached anyone"
```

---

### Task 4: הפורטל אומר "נראה"

**Files:**
- Modify: `portal.html` — `orderCard`
- Test: `scripts/test-sketch-review-tabs.js` (הרחבה)

**Interfaces:**
- Consumes: `order.sketchSeenAt` ממשימה 1

- [ ] **Step 1: כתוב את הבדיקה הנכשלת**

הוסף בסוף `scripts/test-sketch-review-tabs.js`, לפני בלוק הדיווח:

```js
/* ── what the client is told ───────────────────────────────────────────── */
/*
 * A label on the step that already exists, not an eighth step. The stepper's
 * index arithmetic (hasGraphic, rawStep, stepIdx) is delicate and unrelated to
 * this change; adding a step would move every order's position in it.
 */
{
  const PORTAL = fs.readFileSync(path.join(ROOT, 'portal.html'), 'utf8');
  const fn = (PORTAL.match(/function _firstStepLabel[\s\S]*?\n}/) || [''])[0];
  check('the label function is found', fn.length > 0, true);
  const ctx = vm.createContext({});
  vm.runInContext(fn, ctx);
  check('an unreviewed order still says it was received',
        ctx._firstStepLabel({}), 'התקבלה');
  check('and a reviewed one says it was seen',
        ctx._firstStepLabel({ sketchSeenAt: 1756500000000 }), 'נראה');
  check('the step count does not change',
        /STEPS=\["התקבלה","בתור","בייצור","חיסום","גרפיקה","מוכן","נאסף"\]/.test(PORTAL), true);
}
```

- [ ] **Step 2: הרץ וודא שהיא נכשלת**

```
node scripts/test-sketch-review-tabs.js
```
צפוי: `FAIL  the label function is found`.

- [ ] **Step 3: הוסף את הפונקציה**

ב-`portal.html`, מיד אחרי שורת `const STEPS=[...]` (שורה 453), הוסף:

```js
// תווית על השלב הראשון, לא שלב שמיני. חשבון האינדקסים של הסטפר
// (hasGraphic, rawStep, stepIdx) עדין ולא קשור לשינוי הזה — הוספת שלב
// הייתה מזיזה כל הזמנה במערכת במקום אחד.
function _firstStepLabel(o){ return (o && o.sketchSeenAt) ? 'נראה' : 'התקבלה'; }
```

- [ ] **Step 4: השתמש בה ב-`orderCard`**

ב-`orderCard` (שורה 765), החלף:

```js
  const orderSteps=hasGraphic?STEPS:["התקבלה","בתור","בייצור","חיסום","מוכן","נאסף"];
```

ב:

```js
  const first=_firstStepLabel(o);
  const orderSteps=hasGraphic
    ?[first].concat(STEPS.slice(1))
    :[first,"בתור","בייצור","חיסום","מוכן","נאסף"];
```

- [ ] **Step 5: הרץ את הבדיקות**

```
node scripts/test-sketch-review-tabs.js
node scripts/test-pages-ui.js
node scripts/test-dom-ids.js
node scripts/test-undefined-vars.js
```

- [ ] **Step 6: הרץ את כל החבילות וודא שאין נפילות חדשות**

```
node scripts/test-order-normalizer.js
node scripts/test-sketch-review-tabs.js
node scripts/test-order-notes.js
node scripts/test-stage-routing.js
node scripts/test-filters.js
node scripts/test-admin-ui.js
node scripts/test-csp.js
```
מותר להיכשל רק ל-`test-hashavshevet-order`, `test-order-pricing`, `test-sketch-storage` — שלושתן נכשלות מראש, מסיבת CRLF, ואינן קשורות.

- [ ] **Step 7: קבע**

```bash
git add portal.html scripts/test-sketch-review-tabs.js
git commit -m "feat: the portal says a sketch was seen"
```

---

## בדיקה ידנית לפני מיזוג

הבדיקות סטטיות; אלה הדברים שרק דפדפן יראה.

1. פתח את תור הסקיצות. שני טאבים, "עוד לא נראה" נבחר, המונים נכונים.
2. בטאב "עוד לא נראה" — אין רשימת פריטים, אין כפתורי חשבשבת/OptyWay. **יש** סקיצה גדולה, שם סקיצה, הערות, ערוך, סקיצה טופלה.
3. ערוך סקיצה, הדגש עליה משהו, שמור. ההדגשה נשארת.
4. כתוב הערה. לחץ "סקיצה טופלה". הסקיצה עוברת לטאב "נראה", והמונים זזים.
5. בטאב "נראה" — המסך המלא חזר, וכפתור "סקיצה טופלה" נעלם.
6. שלח לחשבשבת מהטאב "נראה". עובד בדיוק כמו קודם.
7. פתח את הסקיצה בשרטט — ההערה קופצת, וההדגשה מהשלב הקודם על התמונה.
8. אותו דבר בתחנת הבדיקה.
9. בפורטל — ההזמנה אומרת "נראה" במקום "התקבלה", ושאר השלבים לא זזו.
10. באייפד ובפלאפון — הטאבים במלוא הרוחב, אפשר ללחוץ בנוחות, אין גלילה אופקית.
