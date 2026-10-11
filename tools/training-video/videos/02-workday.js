// סרטון 02 — יום עבודה (רצפה). התסריט: docs/training-videos/scripts/02-workday.md
// הקוד קובע (AUTHORING §6). שינויים מול התסריט:
//  - "חלק מהזמנה" מלמד את ההתנהגות המתוקנת (d30b9e9): ⏸ הזמנה חלקית לא מתקדמת, והשאר חוזר ל"בנה יום עבודה".
//  - בלי פסי "מכונה א׳/ב׳": אף זרימה שיוצרת הזמנות לא כותבת glassFullName ברמת ההזמנה (שאלה 3 בתסריט),
//    ולכן בפועל הרשימה שטוחה. הזרע משקף את זה ולא ממציא קיבוץ.
//  - "ואטסאפ לא יצא" מוצג דרך תשובת שרת "מנותק" של /api/whatsapp-drain (המבנה מ-api/whatsapp-drain.js).
import { CLOCK, DAY, CLIENTS, users, item, sketch, order, SKUS } from '../lib/seedlib.js';

export const meta = { id: '02', file: '02 - יום עבודה', title: 'יום עבודה', viewport: { w: 1180, h: 820 } };

// two catalog entries this video needs on top of the shared ones
const EXTRA = {
  '8HL': { code: '8HL', name: '8 מ"מ חלבי מלוטש', glass: 'חלבי', mm: 8, proc: 'litush', chalavi: true, active: true },
};
const CAT = { ...SKUS, ...EXTRA };
const it = (sku, w, h, extra = {}) => {
  if (SKUS[sku]) return item(sku, w, h, extra);
  const s = CAT[sku];
  return { sku, name: s.name, glassFullName: s.name, glass: s.glass, mm: s.mm, w, h, qty: 1,
           chisum: s.proc === 'chisum', litush: s.proc === 'litush', ...(s.chalavi ? { chalavi: true } : {}), ...extra };
};
const pair = (sku, w, h, g) => [it(sku, w, h, { quantityGroupId: g }), it(sku, w, h, { quantityGroupId: g })];

// orders the drafter finished: waiting for the floor (stage 'opty')
const opty = (n, client, sketchName, items, extra = {}) => order('ord_' + n, 'L' + n, client, {
  stage: 'opty', status: 'מחכה ל-OptyWay', sketchName, items, hasSketch: true, createdAt: CLOCK - 2 * DAY, ...extra });

const I = {
  9101: [...pair('8SMH', 885, 1985, 'q9101a'), it('M4', 600, 800)],
  9102: pair('8SL', 885, 1950, 'q9102a'),
  9103: [it('8SL', 700, 1900), it('8HL', 700, 1900)],
  9104: pair('8SL', 900, 2000, 'q9104a'),
  9105: [it('M4', 600, 900)],
  9106: [it('10SMH', 800, 2000)],
  9107: [it('6SL', 1200, 1500), it('6SL', 900, 1500), it('6SL', 600, 1500)],
};
const NAMES = { 9101: 'מקלחון ניש + מראה', 9102: 'מקלחון פינתי', 9103: 'מחיצה חלבית', 9104: 'מחיצת מקלחון ישרה',
  9105: 'מראה לאמבטיה', 9106: 'דלת מקלחון 10 מ"מ', 9107: 'ויטרינה 3 חלקים' };
const WHO = { 9101: 'galil', 9102: 'sharon', 9103: 'david', 9104: 'david', 9105: 'david', 9106: 'galil', 9107: 'david' };
const SK = n => sketch({ title: NAMES[n], client: CLIENTS[WHO[n]].name, num: 'L' + n,
  panes: I[n].map((i, k) => ({ w: i.w, h: i.h, n: k + 1, mirror: i.glass === 'מראה' })) });
// L9102: no deliveryClient flag on the order — the page recognises the delivery client by phone
const mk = n => opty(n, WHO[n], NAMES[n], I[n], n === 9102 ? { deliveryClient: false } : {});

export function seed() {
  const orders = {}, sketches = {};
  [9101, 9102, 9103, 9104, 9105].forEach(n => { orders['ord_' + n] = mk(n); sketches['ord_' + n] = SK(n); });
  const prices = { global: { '8SMH': 300, '8SL': 250, '8HL': 320, '10SMH': 380, '6SL': 200, 'M4': 220, '6SMH': 260, '10SL': 330 } };
  return {
    __clock: CLOCK, __session: '0500000000',
    // the server queues the "ready" message; the drain finds nothing more to do (the normal, connected case)
    __api: { 'whatsapp-dispatch': { ok: true, queued: true }, 'whatsapp-drain': { ok: true, processed: 0, remaining: 0, results: [] } },
    db: { users: users({ worker: 'משה' }), orders, sketches, skuCatalog: CAT, prices, meta: { orderCounter: 9200 } },
  };
}
const LATER = () => ({ ord_9106: mk(9106), ord_9107: mk(9107) });
const LATER_SK = () => ({ ord_9106: SK(9106), ord_9107: SK(9107) });

export async function script(r) {
  const toast = '#toast';
  const row = id => `#availableOrders > div:has(button[onclick*="'${id}'"])`;
  const addBtn = id => `#availableOrders button[onclick^="addGroupToDraft('${id}'"]`;
  const whole = id => `#availableOrders button[onclick="addWholeOrder('${id}')"]`;
  const fin = t => ({ sel: '#finishBody > div > div > div', text: t });
  const waitToast = t => r.node(p => p.waitForFunction(s => { const e = document.getElementById('toast');
    return e && e.classList.contains('show') && e.textContent.includes(s); }, { timeout: 8000 }, t));

  r.card({ kind: 'title', title: 'יום עבודה', sub: 'עובד הרצפה · חיתוך וליטוש',
    bullets: ['בונים **טיוטה** ומורידים אותה לעבודה', 'מסיימים את היום ב**"✅ סיים יום עבודה"**', 'מבינים **לאן כל הזמנה ממשיכה**'] });

  // ── ב. סיור במסך
  r.chapter('סיור במסך');
  await r.open('workday.html', { wait: '#availableOrders button' });
  await r.show({ wide: true, text: 'זה מסך **יום העבודה**. כאן בונים בבוקר את רשימת העבודה, ובערב סוגרים אותה.', hold: 5 });
  await r.show({ focus: '.phase-tabs', mark: ['#tab-build', '#tab-work'],
    text: 'למעלה שש לשוניות. העובד ברצפה עובד בשתיים הראשונות: **"בנה יום עבודה"** ו**"יום עבודה פעיל"**.' });
  await r.show({ focus: '.phase-tabs', mark: ['#tab-chisum', '#tab-triplex', '#tab-graphic', '#tab-delivery'],
    text: 'חיסום, טריפלקס, גרפיקה והובלות: לשם ממשיכות הזמנות בהמשך הדרך. בכל לשונית — **המספר** אומר כמה מחכות שם.' });
  await r.show({ focus: ['#tab-build', '#view-build .avail-title'], mark: ['#cnt-build', '#view-build .avail-title'], who: 'system',
    text: 'תחת **"הזמנות ממתינות לביצוע"** מופיעות לבד ההזמנות שהשרטט סיים. המספר על הלשונית = כמה **פריטים** מחכים: 10.' });
  await r.show({ focus: ['#filterBar', '#bvItems'], mark: ['#bvItems', '#bvOrders'],
    text: '**"פריטים"** מראה כל זכוכית בשורה. **"הזמנות"** מראה כל הזמנה בשורה.' });
  await r.show({ focus: '#filterBar', mark: ['#fGlass', '#fMachine', '#fType', '#fClient'],
    text: 'בשורת הסינון מצמצמים את הרשימה: לפי זכוכית, מכונה, סוג (מלוטש או חיסום) או לקוח. **"✕ נקה"** מחזיר הכול.' });

  // ── ג. הדגמה מלאה
  r.chapter('בניית טיוטה');
  await r.show({ focus: [row('ord_9101')], mark: [row('ord_9101')],
    text: 'מתחילים מ**זגגות הגליל** (L9101): שתי זכוכיות **מחוסם** ומראה **מלוטש**. התגית בכל שורה אומרת מה הפריט צריך.' });
  await r.click({ target: addBtn('ord_9101'), focus: row('ord_9101'),
    text: 'שתי הזכוכיות זהות, ולכן הן בשורה אחת עם **×2**. לוחצים **"+ הוסף הכל"**.',
    after: 'שתיהן נכנסו ל**טיוטה** וירדו מהרשימה.', afterMark: [toast], afterFocus: ['#availableOrders', toast] });
  await r.click({ target: addBtn('ord_9101'), focus: row('ord_9101'), text: 'ואת המראה: **"+ הוסף"**.',
    after: 'למטה הופיע הכפתור **"📋 טיוטה"**, והמספר עליו — כמה פריטים בטיוטה: 3.', afterMark: ['#draftPreviewBtn', toast],
    afterFocus: ['.summary-bar'] });
  await r.click({ target: '#bvOrders', focus: ['#view-build .avail-title', '#bvOrders'], text: 'כשרוצים הזמנה שלמה, נוח לעבור לתצוגת **"הזמנות"**.',
    after: 'עכשיו כל הזמנה בשורה אחת, עם **"+ הוסף הזמנה שלמה"**.', afterMark: ['#availableOrders'], afterFocus: ['#availableOrders'] });
  await r.click({ target: whole('ord_9102'), focus: row('ord_9102'),
    text: 'אצל **מקלחוני השרון** (L9102) לוחצים **"+ הוסף הזמנה שלמה"**.',
    after: 'כל ההזמנה — 2 פריטים — נכנסה בלחיצה אחת. בטיוטה: 5.', afterMark: [toast, '#draftPreviewBtn'], afterFocus: ['#availableOrders', '.summary-bar'] });
  await r.click({ target: whole('ord_9103'), focus: row('ord_9103'), text: 'וכך גם שתי ההזמנות של **אלומיניום דוד**: L9103…', hold: 3 });
  await r.click({ target: whole('ord_9104'), focus: row('ord_9104'), text: '…ו־L9104.', hold: 2.4,
    after: 'ברשימה נשארה רק **"מראה לאמבטיה"** — היא לא נכנסת היום.', afterMark: ['#availableOrders', '#draftPreviewBtn'], afterFocus: ['#availableOrders', '.summary-bar'] });
  await r.show({ focus: '.summary-bar', mark: '#draftPreviewBtn', chip: { kind: 'warn', t: '⚠ עוד לא זז כלום' },
    text: 'שימו לב: עד עכשיו **שום הזמנה לא זזה**. הטיוטה היא רק רשימה אצלך במסך.' });

  r.chapter('הורדה לעבודה');
  await r.click({ target: '#draftPreviewBtn', focus: '.summary-bar', text: 'פותחים את **"📋 טיוטה"**.',
    after: 'החלון **"📋 טיוטת עבודה"**: כל פריט בשורה — הזמנה, זכוכית, מידה וסוג.', afterMark: ['#draftList'], afterFocus: ['#draftOverlay > div'] });
  await r.show({ focus: '#draftOverlay > div', mark: '#draftSummary',
    text: 'למטה **סיכום טיוטה**: 7 ליטוש, 2 חיסום, סה"כ 9. בודקים שזה מה שמתכננים לחתוך היום.' });
  await r.show({ focus: '#draftOverlay > div', mark: { sel: '#draftList button', nth: 0 },
    text: 'ה־**✕ האדום** בסוף שורה מוציא פריט שלא שייך. (נראה את זה בהמשך.)', hold: 4 });
  await r.click({ target: 'button[onclick="commitDraftToWork()"]', focus: '#draftOverlay > div', text: 'הכול נכון? לוחצים **"▶ הורד לעבודה"**.',
    after: 'המערכת **מפצלת לבד**: "4 ליטוש | 1 חיסום → תחנת בדיקה". הליטוש נשאר אצלך; המחוסמות של זגגות הגליל עברו ל**תחנת הבדיקה**.',
    afterMark: [toast], afterFocus: null, afterChip: { kind: 'system', t: '⚙ המערכת פיצלה לבד' } });
  await r.show({ focus: ['.phase-tabs', '#workActiveContent'], mark: ['#tab-work'], who: 'system',
    text: 'המסך עבר לבד ל**"יום עבודה פעיל"**: 7 פריטי ליטוש. אין כאן שום פריט **מחוסם** — הם כבר בתחנת הבדיקה.' });
  await r.show({ wide: true, text: 'זו רשימת העבודה להיום. **אין סימון פריט אחרי פריט**: עובדים לפי הרשימה, וסוגרים את כולה בסוף היום.', hold: 5.5 });
  await r.click({ target: `button[onclick="toggleWorkItemDetail('ord_9101',2)"]`, focus: '#workActiveContent > div:has(button[onclick="toggleWorkItemDetail(\'ord_9101\',2)"])',
    text: 'רוצים לראות את כל ההזמנה? **"▾ ראה עוד"**.',
    after: 'מופיעים **כל פריטי הסקיצה** — גם המחוסמות שבתחנה — והכפתור **"🖼 פתח סקיצה"**.',
    afterMark: [{ sel: '#workActiveContent > div', nth: 0 }], afterFocus: ['#workActiveContent > div:has(button[onclick="showSketchPopup(\'ord_9101\')"])'] });
  await r.click({ target: `button[onclick="showSketchPopup('ord_9101')"]`, text: 'פותחים את הסקיצה.', hold: 2.4,
    after: 'הסקיצה של הלקוח, עם המידות. לחיצה מחוץ לה סוגרת.', afterMark: ['#sketchPopupModal > div'], afterFocus: ['#sketchPopupModal > div'] });
  await r.click({ target: '#sketchPopupModal button', text: 'סוגרים.', hold: 2 });

  r.chapter('סיום יום עבודה');
  await r.click({ target: '#finishBtn', focus: '.summary-bar', text: 'סיימתם לחתוך וללטש? לוחצים **"✅ סיים יום עבודה"**.',
    after: 'זה החלון הכי חשוב ביום: **עוד לפני שמשהו זז**, הוא מראה לאן כל הזמנה תמשיך.', afterMark: ['#finishOv .modal'], afterFocus: ['#finishOv .modal'] });
  await r.show({ focus: '#finishOv .modal', mark: fin('מלוטש מוכן'), chip: { kind: 'ok', t: '→ מוכן לאיסוף' },
    text: '**✂️ מלוטש מוכן** (L9104): כל הפריטים גמורים. ההזמנה עוברת ל**מוכן לאיסוף**, והלקוח מקבל הודעת וואטסאפ.' });
  await r.show({ focus: '#finishOv .modal', mark: fin('גרפיקה'), chip: { kind: 'system', t: '→ גרפיקה' },
    text: '**🖼 גרפיקה** (L9103): יש בה זכוכית **חלבית**, שצריכה עוד עבודה. עוברת ללשונית "גרפיקה" — **עוד בלי הודעה**.' });
  await r.show({ focus: '#finishOv .modal', mark: fin('לקוח הובלות'), chip: { kind: 'system', t: '→ הובלות' },
    text: '**🚚 לקוח הובלות** (מקלחוני השרון): המערכת זיהתה את זה **לבד**, לפי הטלפון של הלקוח. ההזמנה עוברת ל"הובלות".' });
  await r.show({ focus: '#finishOv .modal', mark: fin('חיסום ממתין'), chip: { kind: 'warn', t: '→ ממתינה לחיסום' },
    text: '**⏳ חיסום ממתין** (זגגות הגליל): המראה גמורה, אבל המחוסמות עוד לא חזרו מהמפעל. ההזמנה מחכה, **ואין הודעה** עד שהחיסום יחזור.' });
  await r.show({ focus: '#finishOv .modal', mark: ['#finishBody .wa-preview', { sel: '#finishBody > div', text: 'לא יקבלו הודעה' }],
    text: 'למטה: **דוגמת הודעה** ללקוח, ובכתום — מי **לא** יקבל הודעה עכשיו. הכלל: הודעה יוצאת רק כשההזמנה באמת מוכנה ללקוח.' });
  await r.click({ target: '#finishOv .btn-green', focus: '#finishOv .modal', text: 'הכול נכון? לוחצים **"שלח הודעות ✓"**.',
    after: '"3 הזמנות הושלמו · 1 ממתינות לחיסום". המערכת העבירה כל הזמנה למקומה **לבד**, ונעלה מחיר למה שמוכן לאיסוף ולהובלה.',
    afterMark: [toast], afterFocus: null, afterChip: { kind: 'system', t: '⚙ כל הזמנה עברה למקומה' } });
  await waitToast('הודעות נכנסו לתור');
  await r.show({ focus: [toast, '.summary-bar'], mark: toast, who: 'system',
    text: 'רגע אחר כך: **"📤 1 הודעות נכנסו לתור — יוצאות בהדרגה"**. ההודעה ל־L9104 יוצאת מהשרת. לקוח עם כמה הזמנות מקבל הודעה **אחת**.' });
  await r.show({ focus: ['.phase-tabs', '#workActiveContent'], mark: ['#cnt-graphic', '#cnt-delivery', '#workActiveContent'],
    text: '"יום עבודה פעיל" ריק. ובלשוניות: **גרפיקה 1, הובלות 1** — ההזמנות כבר מחכות שם.' });

  // ── ד. כשמשהו לא רגיל
  r.chapter('כשמשהו לא רגיל');
  // the drafter finishes two more orders (elsewhere)
  await r.exec(async (o, s) => {
    for (const k of Object.keys(s)) await firebase.database().ref('sketches/' + k).set(s[k]);
    for (const k of Object.keys(o)) await firebase.database().ref('orders/' + k).set(o[k]);
  }, LATER(), LATER_SK());
  await r.click({ target: '#tab-build', focus: '.phase-tabs', text: 'בינתיים השרטט סיים עוד שתי הזמנות. חוזרים ל**"בנה יום עבודה"**.',
    after: 'הן כבר ברשימה: **L9106** ו־**L9107**.', afterMark: [row('ord_9106'), row('ord_9107')], afterFocus: ['#availableOrders'] });

  // case 1 — chisum only
  await r.click({ target: whole('ord_9106'), focus: row('ord_9106'),
    text: '**מקרה 1: הזמנה שכולה חיסום.** הדלת של זגגות הגליל (L9106): זכוכית אחת, מחוסמת. מוסיפים אותה כרגיל…', hold: 5 });
  await r.click({ target: '#draftPreviewBtn', focus: '.summary-bar', text: '…פותחים את הטיוטה…', hold: 2,
    afterFocus: ['#draftOverlay > div'], afterMark: ['#draftSummary'] });
  await r.click({ target: 'button[onclick="commitDraftToWork()"]', focus: '#draftOverlay > div', text: '…ו**"▶ הורד לעבודה"**.', hold: 2.4,
    after: 'אין מה ללטש — ולכן המסך **נשאר** ב"בנה יום עבודה". ההודעה: הזמנת החיסום נשלחה לתחנת הבדיקה.',
    afterMark: [toast], afterFocus: null, afterChip: { kind: 'system', t: '⚙ נשלחה לתחנת הבדיקה' } });
  await r.show({ focus: '#chisumSentBanner', mark: '#chisumSentBanner', who: 'system',
    text: 'הפס הסגול אומר כמה הזמנות מחכות ב**תחנת הבדיקה** — כאן 2: הדלת, והמחוסמות של L9101 מהבוקר. "🔍 עבור לתחנה" פותח את התחנה.' });
  await r.click({ target: 'button[aria-label="סגור הודעה"]', focus: '#chisumSentBanner', text: 'ה־✕ סוגר את הפס.', hold: 2 });

  // case 2 — part of an order (+ WhatsApp not sent)
  await r.click({ target: '#bvItems', focus: ['#view-build .avail-title', '#bvItems'], text: '**מקרה 2: רק חלק מהזמנה.** חוזרים לתצוגת **"פריטים"**.', hold: 3.5,
    afterMark: [row('ord_9107')], afterFocus: ['#availableOrders'] });
  await r.click({ target: `#availableOrders button[onclick="addGroupToDraft('ord_9107',[0])"]`, focus: '#availableOrders',
    text: 'בוויטרינה של אלומיניום דוד (L9107) שלוש זכוכיות, אבל היום חותכים רק את **1200 × 1500**. מוסיפים רק אותה.',
    after: 'שתי הזכוכיות האחרות **נשארות ברשימה**.', afterMark: [row('ord_9107')], afterFocus: ['#availableOrders'] });
  await r.click({ target: addBtn('ord_9105'), focus: '#availableOrders', text: 'ומוסיפים גם את **המראה לאמבטיה** (L9105) — הזמנה שלמה של פריט אחד.', hold: 4 });
  await r.click({ target: '#draftPreviewBtn', focus: '.summary-bar', text: 'טיוטה…', hold: 1.8, afterFocus: ['#draftOverlay > div'], afterMark: ['#draftList'] });
  await r.click({ target: 'button[onclick="commitDraftToWork()"]', focus: '#draftOverlay > div', text: '…"▶ הורד לעבודה".', hold: 2,
    after: 'בלי חיסום — שני הפריטים ב"יום עבודה פעיל".', afterMark: [toast, '#workActiveContent'], afterFocus: null });
  await r.click({ target: '#finishBtn', focus: '.summary-bar', text: 'בסוף היום: **"✅ סיים יום עבודה"**.', hold: 2.6,
    after: 'הפעם יש בחלון שורה חדשה.', afterMark: ['#finishOv .modal'], afterFocus: ['#finishOv .modal'] });
  await r.show({ focus: '#finishOv .modal', mark: fin('הזמנה חלקית'), chip: { kind: 'warn', t: '⏸ הזמנה חלקית' },
    text: '**⏸ הזמנה חלקית**: ב־L9107 נשארו זכוכיות שלא ירדו לעבודה. היא **לא מתקדמת**, הלקוח **לא מקבל הודעה**, והשאר חוזר ל"בנה יום עבודה".' });
  await r.show({ focus: '#finishOv .modal', mark: fin('מלוטש מוכן'),
    text: 'המראה (L9105) גמורה כולה — היא כן עוברת למוכן לאיסוף, עם הודעה.', hold: 4 });
  // the WhatsApp device is disconnected: the server keeps the message waiting (api/whatsapp-drain.js, "disconnected")
  await r.exec(() => { window.__LG_SEED.__api['whatsapp-drain'] = { ok: true, provider: 'green', state: 'notAuthorized',
    disconnected: true, processed: 0, remaining: 1, tally: { waiting: 1 }, results: [] }; });
  await r.click({ target: '#finishOv .btn-green', focus: '#finishOv .modal', text: '**"שלח הודעות ✓"**.', hold: 2,
    after: '"1 הזמנות הושלמו · 1 חלקיות חזרו ל\'בנה יום עבודה\'".', afterMark: [toast], afterFocus: null });
  await waitToast('תקועות בתור');
  await r.show({ focus: [toast, '.summary-bar'], mark: toast, chip: { kind: 'warn', t: '⚠ ההודעה ללקוח לא יצאה' },
    text: '**מקרה 3: ההודעה לא יצאה.** סימן ⚠️ כמו **"הודעות תקועות בתור"** אומר שהוואטסאפ לא שלח — בדרך כלל כי הוא **מנותק**.' });
  r.card({ panel: true, kicker: 'מקרה 3', title: 'ההודעה תקועה? **לא מסיימים שוב**',
    sub: 'ההזמנות כבר במקום הנכון. ההודעה **מחכה בתור** ותצא כשהוואטסאפ יחובר מחדש.',
    box: { kind: 'warn', text: 'מודיעים **למשרד** שהוואטסאפ מנותק.' } });
  await r.click({ target: '#tab-build', focus: '.phase-tabs', text: 'ומה קרה ל־L9107? חוזרים ל"בנה יום עבודה".', hold: 3,
    after: 'L9107 מחכה כאן עם **שתי הזכוכיות שנשארו**. זו שנחתכה היום כבר **לא מופיעה**. מחר מוסיפים אותן כרגיל.',
    afterMark: [row('ord_9107')], afterFocus: ['#availableOrders'], afterChip: { kind: 'system', t: '⚙ השאר חזר לבד' } });

  // case 4 — a mistake in the draft
  await r.click({ target: addBtn('ord_9107'), focus: '#availableOrders', text: '**מקרה 4: טעות בטיוטה.** מוסיפים את 900 × 1500…', hold: 3.4 });
  await r.click({ target: addBtn('ord_9107'), focus: '#availableOrders', text: '…ואת 600 × 1500.', hold: 2.4,
    after: 'בטיוטה: 2.', afterMark: ['#draftPreviewBtn'], afterFocus: ['.summary-bar'] });
  await r.open('workday.html', { wait: '#draftPreviewBtn' });
  await r.show({ focus: [toast, '.summary-bar'], mark: [toast, '#draftPreviewBtn'], who: 'system',
    text: 'הדף **התרענן** באמצע? הטיוטה **חוזרת לבד**: "2 פריטים שוחזרו לטיוטה". (רק באותו מכשיר.)' });
  await r.click({ target: '#draftPreviewBtn', focus: '.summary-bar', text: 'פותחים את הטיוטה.', hold: 2,
    afterFocus: ['#draftOverlay > div'], afterMark: ['#draftList'] });
  await r.click({ target: { sel: '#draftList button', nth: 1 }, focus: '#draftOverlay > div',
    text: 'פריט לא שייך? ה־**✕ האדום** מוציא אותו.',
    after: 'הפריט יצא מהטיוטה, והסיכום התעדכן. ברשימה הוא **חזר** למקומו.', afterMark: ['#draftList', '#draftSummary'], afterFocus: ['#draftOverlay > div'] });
  await r.click({ target: 'button[onclick="clearDraft()"]', focus: '#draftOverlay > div',
    text: 'רוצים להתחיל מחדש? **"🗑️ נקה טיוטה"** מרוקן הכול, אחרי אישור.',
    after: 'הטיוטה ריקה, והפריטים חזרו לרשימה. **ההזמנות עצמן לא נפגעו** — הטיוטה היא רק רשימה.',
    afterMark: [row('ord_9107')], afterFocus: ['#availableOrders', '.summary-bar'] });

  // ── ה. סיכום
  r.chapter('סיכום');
  r.card({ title: 'סיכום · יום עבודה', bullets: [
    'בונים **טיוטה** ("+ הוסף" / "+ הוסף הזמנה שלמה") ובודקים אותה ב**"📋 טיוטה"**',
    '**"▶ הורד לעבודה"** מפצל לבד: ליטוש אצלך, חיסום ל**תחנת הבדיקה**',
    'בסוף היום **"✅ סיים יום עבודה"**: החלון מראה לאן כל הזמנה ממשיכה',
    'הזמנה **חלקית** לא מתקדמת · ⚠️ "תקועות בתור" — מודיעים למשרד',
  ], flow: [{ t: 'טיוטה' }, { t: '▶ הורד לעבודה' }, { t: 'יום עבודה פעיל' }, { t: 'שלח הודעות ✓' },
    { t: '✂️ מוכן לאיסוף · 🖼 גרפיקה · 🚚 הובלות · ⏳ חיסום · ⏸ חזרה', hot: true }] });
}
