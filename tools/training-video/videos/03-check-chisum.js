// סרטון 03 — תחנת בדיקה וחיסום. התסריט: docs/training-videos/scripts/03-check-chisum.md
// חלק א: check-station.html (בדיקה ושליחה בדוח). חלק ב: workday.html, טאב חיסום (קבלת הדוח וסימון מה שחזר).
// המקרה שבן שאל עליו במפורש: לא כל הזכוכיות חזרו מהחיסום — מוצג במלואו, לפי confirmResetChisum (workday.html).
// גם: d30b9e9 — הזמנה שכל המפעל שלה חזר אבל פריט ליטוש שלה עוד לא נחתך (wdDoneIdxs) נשארת בחיסום.
import { CLOCK, DAY, CLIENTS, users, item, sketch, handSketch, order, SKUS, PRICES, locked } from '../lib/seedlib.js';

export const meta = { id: '03', file: '03 - תחנת בדיקה וחיסום', title: 'תחנת בדיקה וחיסום', viewport: { w: 1180, h: 820 } };

const inStation = (id, num, client, sketchName, items, extra = {}) =>
  order(id, num, client, { stage: 'workday', status: 'ביום עבודה', sketchName, items, ...extra });

// the two orders of report 42 (the "not everything came back" case) — written into the page later, as another day
function report42() {
  const sent = { stage: 'chisum', status: 'בחיסום', chisumArrived: false, chisumReportId: 'chisum_42', chisumReportNum: '42' };
  return {
    ord_9106: order('ord_9106', 'L9106', 'david', { ...sent, sketchName: 'מחיצות משרד', items: [
      item('10SMH', 400, 1200), item('10SMH', 450, 1200), item('10SMH', 500, 1200), item('10SMH', 550, 1200)] }),
    // the factory part went with the station; the polish item (idx 2) was not cut yet — tracked by wdDoneIdxs (d30b9e9)
    ord_9107: order('ord_9107', 'L9107', 'sharon', { ...sent, sketchName: 'מקלחון ומדף', wdDoneIdxs: { 0: true, 1: true }, items: [
      item('8SMH', 700, 1950), item('8SMH', 300, 1950), item('8SM', 600, 250)] }),
  };
}

export function seed() {
  const G = CLIENTS.galil.name, D = CLIENTS.david.name;
  const orders = {
    // the hero: no sketch image → the station draws a rectangle per glass, and each one can be tapped
    ord_9101: inStation('ord_9101', 'L9101', 'galil', 'מקלחון חזית', [item('10SMH', 700, 1900), item('10SMH', 900, 1900), item('10SMH', 300, 1900)]),
    ord_9102: inStation('ord_9102', 'L9102', 'sharon', 'מקלחון נישה', [
      item('8SMH', 800, 2000, { quantityGroupId: 'q9102', groupIndex: 1 }), item('8SMH', 800, 2000, { quantityGroupId: 'q9102', groupIndex: 2 })]),
    ord_9105: inStation('ord_9105', 'L9105', 'david', 'דלת כניסה', [item('10SMH', 500, 1500), item('10SMH', 500, 1500, { graphic: true })]),
    // has a sketch image — the image is not tappable; checked through "פריטים"
    ord_9108: inStation('ord_9108', 'L9108', 'david', 'ויטרינה', [item('10SMH', 1000, 2000), item('10SMH', 1000, 2000)], { hasSketch: true, source: 'whatsapp' }),
  };
  // a client's own drawing, sent by WhatsApp — an image: nothing on it can be tapped
  const sketches = { ord_9108: handSketch({ title: 'ויטרינה לחנות', panes: [{ w: 1000, h: 2000 }, { w: 1000, h: 2000 }], note: '10 מ"מ מחוסם · 2 יח׳' }) };
  const hashavshevetAccounts = {};
  Object.values(CLIENTS).forEach((c, i) => { const k = String(14300 + i); hashavshevetAccounts[k] = { key: k, name: c.name, phone: c.phone }; });
  return { __clock: CLOCK, __session: '0500000000', db: {
    users: users({ worker: 'יוסי' }), orders, sketches, skuCatalog: SKUS, hashavshevetAccounts,
    prices: { global: PRICES },
    workday: { date: '12.10.2026', inChisum: { 0: 'ord_9101', 1: 'ord_9102', 2: 'ord_9105', 3: 'ord_9108' },
      checkState: { ord_9102: { 0: true, 1: true }, ord_9105: { 0: true, 1: true } } },
    meta: { chisumCounter: 40, orderCounter: 9200 },
  } };
}

export async function script(r) {
  const card = text => ({ sel: '.order-card', text });
  const toast = '.toast';
  const wtoast = '#toast';
  const client = name => ({ sel: '#chisumOrders div[onclick^="toggleChisumOpen"]', text: name });
  const tick = (id, idx) => `#chisumOrders input[onchange*="toggleArrived('${id}',${idx},"]`;
  const finishBar = { sel: '#chisumArrivedBar button', text: 'סיום בדיקה ואיפוס רשימה' };
  const dlg = { sel: 'div[style*="fixed"] > div', text: 'סיום בדיקה ואיפוס רשימה' };

  r.card({ kind: 'title', title: 'תחנת בדיקה וחיסום', sub: 'בודקים, שולחים למפעל, ומקבלים חזרה',
    bullets: ['בודקים כל זכוכית **לפני** שהיא נוסעת לחיסום', 'שולחים את כל ההזמנות שנבדקו **בדוח אחד ממוספר**', 'מקבלים את הדוח בחזרה ומסמנים **רק מה שבאמת הגיע**'] });

  // ── ב. סיור במסך
  r.chapter('סיור במסך');
  await r.open('check-station.html', { wait: '.order-card' });
  // (the labels-over-panel tap bug found while recording was fixed in check-station.html, commit 1700f07)
  await r.show({ wide: true, who: 'system', text: 'זו **תחנת הבדיקה**. מגיעות לכאן לבד הזמנות שיש בהן זכוכית לחיסום, אחרי יום העבודה.', hold: 5 });
  await r.show({ focus: '#tabsBar', mark: '#tabActive',
    text: 'שני טאבים. **"🔍 לבדיקה"** — מה שעוד לא בדקת.' });
  await r.show({ focus: '#tabsBar', mark: '#tabDone',
    text: '**"✅ הושלמו"** — מה שבדקת, והוא מחכה לשליחה למפעל.' });
  await r.show({ focus: card('זגגות הגליל'), mark: card('זגגות הגליל'),
    text: 'כל כרטיס הוא **הזמנה אחת**: הלקוח, מספר ההזמנה, וכמה פריטי חיסום יש בה. הפס מראה כמה כבר נבדקו.' });
  await r.show({ focus: '#filtersBar', mark: '#filtersBar', text: 'למעלה: חיפוש, וסינון לפי סוג זכוכית או לפי לקוח.', hold: 3.5 });

  // ── ג. הדגמה מלאה — שני סוגי הסקיצות
  r.chapter('שני סוגי סקיצות');
  r.card({ title: 'בתחנה יש **שני סוגים** של סקיצה — ושתי דרכים לסמן', table: [
    ['סקיצה **שהמערכת ציירה**', 'הזמנה בלי תמונה — המערכת מציירת **מלבן לכל זכוכית** מהפריטים. **לוחצים על המלבן**.'],
    ['סקיצה **שהועלתה**', 'צילום או ציור של הלקוח (העלאה או וואטסאפ). על תמונה אי אפשר ללחוץ — **מסמנים ברשימת "📋 פריטים"**.'],
  ], box: { kind: 'info', text: 'רשימת **"📋 פריטים"** עובדת בשני הסוגים. בשניהם הסימון נשמר לבד.' } });
  r.chapter('סקיצה שהמערכת ציירה');
  await r.click({ target: card('זגגות הגליל'), focus: '#listView', text: 'מתחילים בהזמנה של **זגגות הגליל** — הזמנה **בלי תמונה**. לוחצים על הכרטיס.',
    after: 'המערכת **ציירה את הסקיצה לבד** מהפריטים: כל **מלבן סגול** הוא זכוכית אחת שנוסעת לחיסום, עם המידות שלה.', afterFocus: '#skWrap', afterMark: '#skWrap svg',
    afterChip: { kind: 'system', t: '⚙ המערכת ציירה את הסקיצה' } });
  await r.show({ focus: ['.topbar', '#skWrap'], mark: ['#progWrap', '#iCnt'], text: 'למעלה ולמטה יש מונה: **0 מתוך 3** נבדקו.', hold: 3.5 });
  await r.click({ target: 'rect[data-idx="0"]', focus: '#skWrap',
    text: 'מרימים את הזכוכית, מודדים ומשווים לסקיצה. היא תקינה? **לוחצים על המלבן שלה**.',
    after: 'המלבן נהיה **ירוק עם ✓**, והמונה עלה ל־1/3. הסימון נשמר לבד — גם אם יוצאים מהמסך.',
    afterMark: ['rect[data-idx="0"]', '#progWrap'], afterFocus: ['.topbar', '#skWrap'], afterChip: { kind: 'system', t: '⚙ נשמר לבד' } });
  await r.click({ target: 'rect[data-idx="1"]', focus: '#skWrap', text: 'הזכוכית השנייה — 900 × 1900. תקינה.', hold: 2.6 });
  await r.click({ target: 'rect[data-idx="2"]', focus: '#skWrap', text: 'והשלישית — 300 × 1900.', hold: 2.4,
    after: 'הכול סומן. המערכת מציגה: **"כל הפריטים נבדקו!"**', afterMark: '#banner', afterFocus: '#skArea',
    afterChip: { kind: 'system', t: '⚙ המערכת זיהתה שהכול נבדק' } });
  await r.show({ focus: '#banner', mark: { sel: '#banner .ban-btn', text: 'המשך' },
    text: '"המשך →" רק סוגר את ההודעה ומשאיר אותך בסקיצה.', hold: 3.5 });
  await r.click({ target: { sel: '#banner .ban-btn', text: 'סיים סקיצה' }, focus: '#banner',
    text: '**"סיים סקיצה"** מעביר את ההזמנה ל"הושלמו". לוחצים.',
    after: 'חזרה לרשימה: "✓ הסקיצה הושלמה". זגגות הגליל ירדה מ"לבדיקה", **והמספר על "הושלמו" עלה**.',
    afterMark: [toast, '#tabsBar'], afterFocus: null });
  r.card({ panel: true, kicker: '⚠ חשוב', title: '"סיים סקיצה" מסמן **את כל** הזכוכיות כנבדקו',
    sub: 'גם את אלה שלא לחצת עליהן. יש כפתור כזה גם בסרגל התחתון של הסקיצה.',
    box: { kind: 'warn', text: 'לוחצים "סיים סקיצה" **רק אחרי** שבדקת כל זכוכית ביד.' } });

  r.chapter('סקיצה שהועלתה');
  await r.click({ target: card('ויטרינה'), focus: '#listView',
    text: 'עכשיו הזמנה שהגיעה **עם סקיצה של הלקוח** — L9108, ויטרינה. בכרטיס כתוב **"🖼 יש סקיצה"**.', hold: 4,
    after: 'זו **התמונה ששלח הלקוח**, כמו שהיא. אין בה מלבנים — **על התמונה אי אפשר ללחוץ**.', afterFocus: '#skWrap', afterMark: '#skWrap',
    afterChip: { kind: 'warn', t: '⚠ תמונה — לא לוחצים עליה' } });
  await r.click({ target: 'button[aria-label="הגדל"]', focus: '#btmbar', text: 'צריך לקרוא מידה קטנה? **"+"** מגדיל, **"−"** מקטין, **"↺"** מחזיר.', hold: 3.4,
    after: 'הסקיצה גדלה. אפשר גם לגרור אותה ולצבוט באצבעות.', afterFocus: '#skArea' });
  await r.click({ target: 'button[aria-label="איפוס תצוגה"]', focus: '#btmbar', text: '"↺" — חזרה לגודל רגיל.', hold: 2 });
  await r.click({ target: '#btnSheet', focus: '.topbar', text: 'כדי לסמן — לוחצים **"📋 פריטים"** למעלה.',
    after: 'נפתחת רשימה של **כל פריטי החיסום** בהזמנה, עם המידות.', afterFocus: '#sheet', afterMark: '#shBody' });
  await r.click({ target: { sel: '#shBody .si', nth: 0 }, focus: '#sheet', text: 'מרימים את הזכוכית, משווים למידה **בתמונה** — ולוחצים על השורה שלה.',
    after: '✓ — הזכוכית סומנה, והמונה למעלה עלה. **בדיוק כמו המלבנים.**', afterMark: [{ sel: '#shBody .si', nth: 0 }, '#progWrap'], afterFocus: ['.topbar', '#sheet'] });
  await r.click({ target: { sel: '#shBody .si', nth: 1 }, focus: '#sheet', text: 'והשנייה.', hold: 2,
    after: 'שתיהן סומנו. **"כל הפריטים נבדקו!"**', afterMark: '#progWrap', afterFocus: '.topbar' });
  await r.exec(() => { const b = document.querySelector('#sheet'); if (b && b.classList.contains('open')) closeSheet(); });
  await r.click({ target: { sel: '#banner .ban-btn', text: 'סיים סקיצה' }, focus: '#banner', text: 'סוגרים את הרשימה, ו**"סיים סקיצה"** — כמו בכל הזמנה.', hold: 3,
    after: 'גם L9108 עברה ל"הושלמו".', afterMark: [toast, '#tabsBar'], afterFocus: null });

  r.chapter('שליחה לחיסום');
  await r.click({ target: '#tabDone', focus: '#tabsBar', text: 'עוברים לטאב **"✅ הושלמו"**.',
    after: 'כאן כל מה שנבדק — **4 הזמנות** — ובראש הרשימה כפתור סגול.', afterFocus: '#listView', afterMark: 'button[onclick="sendAllToFactory()"]' });
  await r.click({ target: 'button[onclick="sendAllToFactory()"]', focus: '#listView',
    text: 'את הכפתור הזה לוחצים **פעם אחת, בסוף היום**, כשהזכוכיות יוצאות למפעל: **"🔥 סיים יום — שלח 4 הזמנות לחיסום והוצא דוח"**.',
    after: '"✓ חיסום 41 — 4 הזמנות נשלחו למפעל". ההזמנות עברו לבד לשלב **חיסום**, והרשימה ב"הושלמו" התרוקנה.',
    afterMark: [toast], afterFocus: null, afterChip: { kind: 'system', t: '⚙ ההזמנות עברו לחיסום לבד' }, hold: 6 });
  await r.showPrinted({ text: 'במקביל נפתח **חלון הדפסה** עם הדוח. המערכת נתנה לו **מספר: 41**. מדפיסים — והדף נוסע עם הזכוכיות למפעל.',
    chip: { kind: 'system', t: '⚙ מספר הדוח ניתן לבד' } });
  await r.showPrinted({ text: 'בדוח: כל זכוכית — סוג, מידות, לקוח והזמנה. **9 פריטים, 4 הזמנות.** את המספר 41 נחפש כשהדוח יחזור.', who: null });
  await r.click({ target: '#tabActive', focus: '#tabsBar', text: 'ומה שעוד לא נבדק?',
    after: 'נשאר בטאב **"לבדיקה"**. הוא לא נשלח, ויחכה לבדיקה ולדוח הבא.', afterMark: '#listView', afterFocus: '#listView' });

  // ── ג2. חזרה מחיסום — workday.html
  r.card({ title: 'למחרת: הזכוכיות חוזרות מהמפעל', sub: 'עוברים ל**יום העבודה**, לטאב **חיסום**.',
    box: { kind: 'info', text: 'הדף שחזר מהמפעל ביד. המספר עליו: **41**.' } });
  r.chapter('קבלת דוח חיסום');
  await r.open('workday.html', { wait: '#tab-chisum' });
  await r.click({ target: '#tab-chisum', focus: '.phase-tabs', text: 'ביום העבודה לוחצים על הטאב **"חיסום"**.',
    after: 'יש כאן כרטיס לכל דוח שנמצא במפעל: **"📦 דוח 41 — 9 פריטים"**, נשלח למפעל, 4 הזמנות.', afterFocus: '#chisumOrders', afterMark: '#chisumOrders > div:nth-child(2)' });
  await r.click({ target: { sel: '#chisumOrders button', text: 'קיבלתי את הדוח' }, focus: '#chisumOrders',
    text: 'קודם בודקים שהמספר **זהה** למספר שעל הדף שחזר. ואז לוחצים **"📦 קיבלתי את הדוח"**.',
    after: 'המערכת שואלת שוב — כדי שלא תסמן דוח אחר.', afterFocus: { sel: 'div[style*="fixed"] > div', text: 'קיבלת את דוח' }, afterMark: '#chisumArrivedOk' });
  await r.click({ target: '#chisumArrivedOk', focus: { sel: 'div[style*="fixed"] > div', text: 'קיבלת את דוח' }, text: 'לוחצים **"✓ כן, קיבלתי"**.',
    after: 'הדוח עבר ל**"בדיקה פעילה"**, ולמעלה הופיע פס סגול: **"הגיע חיסום!"**.', afterMark: [wtoast, '#chisumArrivedBar'], afterFocus: null,
    afterChip: { kind: 'system', t: '⚙ המערכת עשתה את זה לבד' } });

  r.chapter('סימון מה שהגיע');
  await r.click({ target: client('זגגות הגליל'), focus: '#chisumOrders', text: 'עוברים לקוח אחרי לקוח. פותחים את **זגגות הגליל** — 0/3 הגיעו.',
    after: 'ליד כל זכוכית כתוב **"ממתין"**.', afterFocus: '#chisumOrders', afterMark: tick('ord_9101', 0) });
  await r.click({ target: tick('ord_9101', 0), focus: '#chisumOrders', text: 'מצאת אותה על העגלה? **מסמנים**.',
    after: 'עכשיו כתוב **"הגיע ✓"**. הסימון נשמר מיד.', afterMark: tick('ord_9101', 0), afterFocus: '#chisumOrders' });
  await r.click({ target: tick('ord_9101', 1), focus: '#chisumOrders', text: 'השנייה…', hold: 1.8 });
  await r.click({ target: tick('ord_9101', 2), focus: '#chisumOrders', text: '…והשלישית.', hold: 1.8,
    after: '**3/3 הגיעו** — בירוק.', afterMark: client('זגגות הגליל'), afterFocus: '#chisumOrders' });
  await r.click({ target: client('מקלחוני השרון'), focus: '#chisumOrders', text: 'פותחים את **מקלחוני השרון**.', hold: 2.4,
    after: 'זכוכיות **זהות** מופיעות בשורה אחת (×2). כותבים כמה הגיעו — או לוחצים **"✓ הכל"**.',
    afterMark: { sel: '#chisumOrders button', text: '✓ הכל' }, afterFocus: '#chisumOrders' });
  await r.click({ target: { sel: '#chisumOrders button', text: '✓ הכל' }, focus: '#chisumOrders', text: 'שתיהן הגיעו. **"✓ הכל"**.', hold: 2.4 });
  await r.click({ target: '#chisumOrders button[onclick*="markAllClientArrived"][onclick*="אלומיניום דוד"]', focus: '#chisumOrders',
    text: 'כל מה שיש ללקוח הגיע? **"✓ סמן הכל"** מסמן הכול בבת אחת — כאן, אלומיניום דוד.',
    after: 'שלושת הלקוחות מסומנים במלואם.', afterMark: '#chisumOrders', afterFocus: '#chisumOrders' });

  r.chapter('סיום בדיקה');
  await r.click({ target: finishBar, focus: '#chisumArrivedBar', text: 'סיימת לסמן? לוחצים **"✓ סיום בדיקה ואיפוס רשימה"**.',
    after: 'לפני שמשהו זז, המערכת **מראה מה יקרה** לכל הזמנה.', afterFocus: dlg, afterMark: dlg });
  await r.show({ focus: dlg, mark: { sel: 'div[style*="fixed"] div', text: 'תישלח הודעה ללקוח', nth: 0 },
    text: 'בירוק: הזמנה שהושלמה **ותקבל הודעה** — עם המספר שאליו ההודעה תצא, מכרטיס הלקוח בחשבשבת.', hold: 6 });
  await r.show({ focus: dlg, mark: [{ sel: 'div[style*="fixed"] div[style*="border-radius:6px"]', text: 'גרפיקה' }, { sel: 'div[style*="fixed"] div[style*="border-radius:6px"]', text: 'הובלות' }],
    text: 'הזמנה עם גרפיקה עוברת **לגרפיקה**, ולקוח הובלות — **להובלות**. להן עוד לא נשלחת הודעה.', hold: 6 });
  await r.click({ target: 'button[onclick="confirmResetChisum()"]', focus: dlg, text: 'לוחצים **"✓ אשר סיום בדיקה"**.',
    after: '"✓ 4 סקיצות הושלמו". כל הזמנה עברה **לבד** לשלב הבא שלה, והרשימה התרוקנה.',
    afterMark: [wtoast, '#chisumOrders'], afterFocus: null, afterChip: { kind: 'system', t: '⚙ המערכת העבירה לבד' } });
  await r.sleep(1400);   // the page sends the "ready" message 1.2 s after the confirm
  await r.show({ wide: true, mark: wtoast, who: 'system', text: 'ולהזמנות שמוכנות לאיסוף יצאה **הודעה ללקוח** — לבד.', hold: 3.5 });

  // ── ד. כשמשהו לא רגיל
  r.chapter('כשלא הכול חזר');
  r.card({ title: 'יום אחר: דוח 42 חזר מהמפעל — **אבל לא שלם**', sub: 'לאלומיניום דוד נשלחו 4 זכוכיות. על העגלה יש רק 3.',
    box: { kind: 'warn', text: 'מסמנים **רק** מה שבאמת על העגלה.' } });
  await r.exec(async (o) => {
    const db = firebase.database();
    await db.ref('meta/chisumCounter').set(42);
    for (const [k, v] of Object.entries(o)) await db.ref('orders/' + k).set(v);
  }, report42());
  await r.click({ target: { sel: '#chisumOrders button', text: 'קיבלתי את הדוח' }, focus: '#chisumOrders', text: 'מקבלים את **דוח 42** בדיוק כמו קודם…', hold: 2.6,
    afterFocus: { sel: 'div[style*="fixed"] > div', text: 'קיבלת את דוח' } });
  await r.click({ target: '#chisumArrivedOk', focus: { sel: 'div[style*="fixed"] > div', text: 'קיבלת את דוח' }, text: '…ומאשרים.', hold: 1.8 });
  await r.click({ target: client('אלומיניום דוד'), focus: '#chisumOrders', text: 'פותחים את **אלומיניום דוד** — 0/4 הגיעו.', hold: 2.6, afterFocus: '#chisumOrders' });
  await r.click({ target: tick('ord_9106', 0), focus: '#chisumOrders', text: 'מסמנים את **400**…', hold: 1.6 });
  await r.click({ target: tick('ord_9106', 1), focus: '#chisumOrders', text: '…את **450**…', hold: 1.6 });
  await r.click({ target: tick('ord_9106', 2), focus: '#chisumOrders', text: '…ואת **500**.', hold: 1.8,
    after: 'הזכוכית של **550** לא על העגלה — **לא מסמנים אותה**. היא נשארת "ממתין". המונה: 3/4.',
    afterMark: [tick('ord_9106', 3), client('אלומיניום דוד')], afterFocus: '#chisumOrders', afterChip: { kind: 'warn', t: '⚠ חסרה — לא מסמנים' } });
  await r.click({ target: client('מקלחוני השרון'), focus: '#chisumOrders', text: 'באותו דוח גם **מקלחוני השרון** — L9107.', hold: 2.4, afterFocus: '#chisumOrders' });
  await r.click({ target: '#chisumOrders button[onclick*="markAllClientArrived"][onclick*="מקלחוני השרון"]', focus: '#chisumOrders',
    text: 'שתי הזכוכיות שלה הגיעו. **"✓ סמן הכל"**.', hold: 2.4 });
  await r.click({ target: finishBar, focus: '#chisumArrivedBar', text: 'ושוב **"✓ סיום בדיקה ואיפוס רשימה"**.', hold: 2.4,
    afterFocus: dlg, afterMark: dlg });
  await r.show({ focus: dlg, mark: { sel: 'div[style*="fixed"] div[style*="border-radius:6px"]', text: 'סקיצות חלקיות' },
    chip: { kind: 'warn', t: '⚠ חלקית — נשארת בחיסום' },
    text: 'בכתום: **"סקיצות חלקיות — נשארות בחיסום עד שכל הפאנלים יחזרו"**. וגם מה חסר: L9106, **חסרים 1 מתוך 4**.', hold: 6.5 });
  await r.show({ focus: dlg, mark: { sel: 'div[style*="fixed"] div[style*="border-radius:6px"]', text: 'פריטי ליטוש' },
    text: 'ועוד מקרה: ב־L9107 **כל המפעל חזר**, אבל פריט **ליטוש** שלה עוד לא נחתך ביום העבודה. גם היא נשארת כאן — עד שהליטוש יסתיים.', hold: 7 });
  await r.click({ target: 'button[onclick="confirmResetChisum()"]', focus: dlg, text: 'מאשרים.', hold: 1.8,
    after: '"✓ בדיקה הושלמה · 1 עם פריטים חסרים · 1 ממתינות לליטוש". **שום הזמנה לא התקדמה, ואף לקוח לא קיבל הודעה.**',
    afterMark: [wtoast], afterFocus: null, afterHold: 5.5 });
  await r.show({ focus: client('אלומיניום דוד'), mark: [client('אלומיניום דוד'), tick('ord_9106', 3)], who: 'system',
    text: 'שלוש הזכוכיות שהגיעו **נסגרו וירדו** מהרשימה. L9106 נשארת **באותו דוח 42**, ורואים בה רק את החסרה: 550, **"ממתין"**.', hold: 7 });
  await r.show({ wide: true, mark: '#chisumArrivedBar', chip: { kind: 'warn', t: '⚠ החסרה מחכה כאן' },
    text: 'הזכוכית החסרה **לא חוזרת** לתחנת הבדיקה **ולא נכנסת** לדוח חדש. היא מחכה כאן, בטאב חיסום.', hold: 6 });
  r.card({ panel: true, kicker: 'כמה ימים אחר כך', title: 'הזכוכית החסרה הגיעה', sub: 'מסמנים אותה **באותו כרטיס**, ולוחצים שוב "סיום בדיקה".' });
  await r.click({ target: tick('ord_9106', 3), focus: '#chisumOrders', text: 'מסמנים את **550**.',
    after: '"הגיע ✓". עכשיו כל ארבע הזכוכיות של L9106 חזרו.', afterMark: tick('ord_9106', 3), afterFocus: '#chisumOrders' });
  await r.click({ target: finishBar, focus: '#chisumArrivedBar', text: '**"✓ סיום בדיקה ואיפוס רשימה"**.', hold: 2.2,
    afterFocus: dlg, afterMark: { sel: 'div[style*="fixed"] div[style*="border-radius:6px"]', text: 'תישלח הודעה ללקוח' } ,
    after: 'עכשיו L9106 בירוק: **הושלמה, ותישלח הודעה ללקוח**. L9107 עדיין מחכה לליטוש.' });
  await r.click({ target: 'button[onclick="confirmResetChisum()"]', focus: dlg, text: 'מאשרים.', hold: 1.8,
    after: 'L9106 עברה לבד לשלב הבא, **והלקוח מקבל הודעה רק עכשיו** — כשההזמנה שלמה.',
    afterMark: [wtoast, '#chisumOrders'], afterFocus: null, afterChip: { kind: 'system', t: '⚙ המערכת העבירה לבד' } });

  r.card({ panel: true, kicker: 'זכוכית שבורה', title: 'זכוכית שחזרה שבורה — **אין סימון במערכת**',
    sub: 'בחלון "קיבלת את הדוח" כתוב שאפשר לסמן נשברים — אבל אין כפתור כזה. **לא מסמנים אותה**: מבחינת המערכת היא חסרה, וההזמנה נשארת בחיסום.',
    box: { kind: 'warn', text: 'מדווחים למנהל.' } });


  // ── ה. סיכום
  r.chapter('סיכום');
  r.card({ title: 'סיכום · תחנת בדיקה וחיסום', bullets: [
    'סקיצה **שהמערכת ציירה** — לוחצים על המלבן · סקיצה **שהועלתה** — מסמנים ב**"📋 פריטים"**',
    '"סיים סקיצה" רק **אחרי** שכל זכוכית נבדקה',
    'בסוף היום: **"סיים יום — שלח לחיסום"** · הדוח המודפס נוסע עם הזכוכיות',
    'כשחוזר: **"קיבלתי את הדוח"** (בודקים את המספר) · מסמנים **רק מה שעל העגלה**',
    '"סיום בדיקה" · מה שחסר **נשאר בחיסום, באותו דוח**, בלי הודעה ללקוח',
  ], flow: [{ t: 'תחנת בדיקה' }, { t: 'הושלמו' }, { t: 'במפעל' }, { t: 'בדיקה פעילה' }, { t: 'מוכן לאיסוף / גרפיקה / הובלות', hot: true }] });
}
