// סרטון 06 — תחנת חשבוניות. התסריט: docs/training-videos/scripts/06-invoices.md
// בן, 12/10: שוטף 30 = חשבונית מרוכזת בסוף כל חודש קלנדרי; יומיים = אפשר חשבונית אחת על כמה הזמנות של אותו לקוח;
// תיקון מידה בחשבשבת = "בטל יתרה לאספקה" בשורה המקורית + שורה חדשה, לפני הפקת החשבונית.
import { CLOCK, DAY, CLIENTS, users, item, sketch, order, itemsHash, SKUS } from '../lib/seedlib.js';

export const meta = { id: '06', file: '06 - תחנת חשבוניות', title: 'תחנת חשבוניות', viewport: { w: 1600, h: 900 } };

const hs = num => ({ hashavshevet: { reference: num.replace(/\D/g, ''), httpOk: true, sentAt: CLOCK - 5 * DAY } });
const collected = (id, num, client, sketchName, items, extra = {}) => order(id, num, client, {
  stage: 'collected', status: 'נאסף', sketchName, items, hasSketch: true, pricesLockedAt: CLOCK - DAY,
  lockedItems: items.map(i => ({ ...i, pricePerM2: 420 })), totalFinal: 1000, ...hs(num), ...extra });
const verified = items => ({ invoiceCheck: { verifiedAt: CLOCK - 18 * 3600e3, verifiedBy: 'נועה', itemsHash: itemsHash(items), note: '' } });

export function seed() {
  const I = {
    v9301: [item('8SMH', 885, 1985, { hsLine: 1 }), item('8SMH', 600, 1985, { hsLine: 2 }), item('8HMH', 885, 300, { hsLine: 3 })],
    v9302: [item('8SMH', 1200, 1950, { hsLine: 1 }), item('8SMH', 400, 1950, { hsLine: 2 })],
    v9303: [item('10SMH', 1250, 655, { hsLine: 1 }), item('10SMH', 1250, 655, { hsLine: 2 }), item('8SMH', 550, 1885, { hsLine: 3 })],
    v9304: [item('M4', 1200, 800, { hsLine: 1 })],
    v9101: [item('8SMH', 885, 1985, { hsLine: 1 }), item('8SMH', 600, 1985, { hsLine: 2 }), item('M4', 700, 900, { hsLine: 3 })],
    v9201: [item('8SMH', 900, 2000, { hsLine: 1 }), item('8SMH', 500, 2000, { hsLine: 2 })],
    v9290: [item('6SMH', 700, 1200, { hsLine: 1 })],
    v9291: [item('10SMH', 900, 2100, { hsLine: 1 })],
    v9292: [item('8SMH', 1000, 1800, { hsLine: 1 }), item('8SMH', 1000, 1800, { hsLine: 2 })],
  };
  const T = CLIENTS.tzafon.name, G = CLIENTS.galil.name, S = CLIENTS.sharon.name, D = CLIENTS.david.name;
  const sk = (title, client, num, panes) => sketch({ title, client, num, panes });
  const P = items => items.map((i, n) => ({ w: i.w, h: i.h, n: n + 1, mirror: i.glass === 'מראה' }));
  const sketches = {
    v9301: sk('מקלחון פינתי', T, 'L9301', P(I.v9301)),
    v9302: sk('מקלחון חזית', T, 'L9302', P(I.v9302)),
    v9303: sk('ויטרינה', T, 'L9303', [{ w: 1250, h: 655, n: 1 }, { w: 1250, h: 655, n: 2 }, { w: 585, h: 1885, n: 3 }]),   // ← 585, the items say 550
    v9304: sk('מראה לאמבטיה', T, 'L9304', P(I.v9304)),
    v9101: sk('מקלחון ומראה', G, 'L9101', P(I.v9101)),
    v9201: sk('מקלחון נישה', S, 'L9201', [{ w: 900, h: 2000, n: 1 }, { w: 520, h: 2000, n: 2 }]),                   // ← 520, the items say 500
    v9291: sk('דלת זכוכית', D, 'L9291', P(I.v9291)),
    v9292: sk('מחיצה', D, 'L9292', P(I.v9292)),
    v9290: sk('חלון', D, 'L9290', P(I.v9290)),
  };
  const orders = {
    v9301: collected('v9301', 'L9301', 'tzafon', 'מקלחון פינתי', I.v9301, { date: '01.10.2026' }),
    v9302: collected('v9302', 'L9302', 'tzafon', 'מקלחון חזית', I.v9302, { date: '05.10.2026' }),
    v9303: collected('v9303', 'L9303', 'tzafon', 'ויטרינה', I.v9303, { date: '07.10.2026' }),
    // no monthly flag on the order itself — it reaches "שוטף 30" through the client record, as old orders do
    v9304: collected('v9304', 'L9304', 'tzafon', 'מראה לאמבטיה', I.v9304, { date: '09.10.2026', monthlyBilling: false }),
    v9101: collected('v9101', 'L9101', 'galil', 'מקלחון ומראה', I.v9101, { date: '11.10.2026' }),
    v9201: collected('v9201', 'L9201', 'sharon', 'מקלחון נישה', I.v9201, { date: '11.10.2026', ...verified(I.v9201) }),
    v9290: collected('v9290', 'L9290', 'david', 'חלון', I.v9290, { date: '10.10.2026', invoiceDone: { docNumber: '40517', markedBy: 'נועה', markedAt: CLOCK - 20 * 3600e3 } }),
    v9291: collected('v9291', 'L9291', 'david', 'דלת זכוכית', I.v9291, { date: '11.10.2026', ...verified(I.v9291) }),
    v9292: collected('v9292', 'L9292', 'david', 'מחיצה', I.v9292, { date: '11.10.2026', ...verified(I.v9292) }),
    v9293: order('v9293', 'L9293', 'david', { stage: 'done', status: 'מוכן לאיסוף', items: [item('8SMH', 700, 700)] }),
  };
  return { __clock: CLOCK, __session: '0500000000', db: { users: users({ worker: 'נועה' }), orders, sketches, skuCatalog: SKUS, meta: { orderCounter: 9400 } } };
}

// the same, as a main admin (case 27: only the manager can revoke a verification)
const L9302_V2 = () => sketch({ title: 'מקלחון חזית', client: CLIENTS.tzafon.name, num: 'L9302', panes: [{ w: 1200, h: 1950, n: 1 }, { w: 420, h: 1950, n: 2 }], note: 'עדכון מהלקוח' });

export async function script(r) {
  const cust = key => ({ sel: '#custList .cust', text: key });
  const ord = num => ({ sel: '#ordList .ord', text: num });
  const toast = '.toast';

  r.card({ kind: 'title', title: 'תחנת חשבוניות', sub: 'עובד המשרד · סוף הדרך של כל הזמנה',
    bullets: ['בודקים את הפריטים מול הסקיצה', 'מפיקים חשבונית **בחשבשבת** ורושמים כאן את מספר המסמך', 'מה עושים כשמשהו לא מסתדר'] });
  r.card({ title: 'לפני הכול: התחנה **לא** מפיקה חשבונית', table: [
    ['⚙ המערכת', 'בודקת איתך לפני, ורושמת אחרי'],
    ['👤 אתה', 'מפיק את החשבונית **ידנית, בחשבשבת**'],
  ], box: { kind: 'warn', text: 'הכפתור "הפק חשבונית בחשבשבת" לא שולח כלום לחשבשבת. הוא פותח חלון שבו רושמים את מה שכבר עשית שם.' } });

  // ── ב. סיור במסך
  r.chapter('סיור במסך');
  await r.open('invoices.html', { wait: '#custList .cust' });
  await r.show({ wide: true, text: 'זה המסך: **שלוש עמודות**. מימין הלקוחות, באמצע ההזמנות של הלקוח שבחרת, ומשמאל — האימות: הפריטים ליד הסקיצה.', hold: 7 });
  await r.show({ focus: '#pCustomers', mark: '#pCustomers', text: 'עמודה 1 · **הלקוחות** שיש להם הזמנות שמחכות לחשבונית.' });
  await r.show({ focus: '#pOrders', mark: '#pOrders', text: 'עמודה 2 · **ההזמנות** של הלקוח שנבחר, והכפתור להפקה.' });
  await r.show({ focus: '#pVerify', mark: '#pVerify', text: 'עמודה 3 · **האימות**: הפריטים שהוקלדו, לצד הסקיצה של הלקוח.' });
  await r.show({ focus: '#pCustomers .pane-head', mark: '.scopes', who: 'system',
    text: 'הזמנה נכנסת לכאן **לבד**, ברגע שמסמנים אותה "נאסף". יש שני טאבים: **יומיות** ו**שוטף 30**. המספר על הטאב = כמה הזמנות עוד מחכות לבדיקה.' });
  await r.type({ target: '#q', value: 'זגגות', focus: '#pCustomers .pane-head',
    text: 'בחיפוש מקלידים שם, טלפון, מספר הזמנה — או **אסמכתא**: המספר של ההזמנה בחשבשבת.' });
  await r.show({ focus: '#pCustomers', mark: '#custList .cust', text: 'נשאר רק הלקוח שמתאים לחיפוש.', hold: 3.6 });
  await r.exec(() => { const q = document.getElementById('q'); q.value = ''; q.dispatchEvent(new Event('input')); });
  await r.click({ target: '.scope[data-scope=monthly]', focus: '#pCustomers',
    text: 'לקוח **שוטף 30** מקבל חשבונית מרוכזת **פעם בחודש**, על כל ההזמנות של החודש. עוברים לטאב "שוטף 30".',
    after: 'כאן מחכה **בית הזכוכית צפון**, עם 4 הזמנות. את הסימון "שוטף 30" עושה המנהל, פעם אחת, בניהול המשתמשים.', afterMark: '#custList .cust' });

  // ── ג. הדגמה מלאה
  r.chapter('אימות סקיצה לפני חשבונית');
  await r.click({ target: cust('בית הזכוכית צפון'), focus: '#pCustomers',
    text: 'לוחצים על הלקוח.',
    after: 'באמצע מופיעות ההזמנות שלו, כל אחת עם המצב שלה. **והמערכת פותחת לבד** את הראשונה שצריך לבדוק.',
    afterFocus: '#pOrders', afterMark: '#ordList', afterChip: { kind: 'system', t: '⚙ ההזמנה הראשונה נפתחה לבד' } });
  await r.show({ focus: '#gate', mark: '#gate', who: 'system',
    text: 'למטה: מונים, והכפתור **"הפק חשבונית בחשבשבת"**. הוא **נעול** 🔒 — ומתחתיו כתוב למה: נותרו 4 הזמנות לאימות.' });
  await r.show({ focus: '#pVerify', mark: '#vItems',
    text: 'הלב של התחנה. מימין — **הפריטים** שהוקלדו בהזמנה.' });
  await r.show({ focus: '#pVerify', mark: '#skBox',
    text: 'משמאל — **הסקיצה** של הלקוח. הייצור עבד לפי הסקיצה, ולכן **הסקיצה קובעת**.' });
  await r.click({ target: '[data-tick="0"]', focus: ['#vItems', '#skBox'],
    text: 'עוברים שורה אחרי שורה, ומחפשים כל מידה בסקיצה. מצאת? אפשר ללחוץ ✓ בסוף השורה.',
    after: 'הווי הזה **רק לעין שלך** — הוא לא נשמר ולא חובה. הוא עוזר לא לדלג על שורה.', afterMark: '[data-tick="0"]',
    afterChip: { kind: 'warn', t: '⚠ הווי לא נשמר' } });
  await r.click({ target: '[data-tick="1"]', focus: ['#vItems', '#skBox'], text: 'שורה 2 — 600 × 1985. תואם.', hold: 3 });
  await r.click({ target: '[data-tick="2"]', focus: ['#vItems', '#skBox'], text: 'שורה 3 — 885 × 300. תואם.', hold: 3 });
  await r.click({ target: '#skFull', focus: '#skBox', text: 'סקיצה צפופה? הכפתור בפינה פותח אותה **על כל המסך**.',
    after: 'המידות של כל השורות מופיעות בפס למטה. "סגור" מחזיר אותך.', afterMark: '#fullStrip', afterFocus: '#full' });
  await r.click({ target: '#fullClose', text: 'סוגרים.', hold: 2.4 });
  await r.click({ target: '#verifyBtn', focus: ['#vFoot', '#pOrders'],
    text: 'הכול תואם? לוחצים **"סקיצה מאומתת"**.',
    after: 'המערכת רושמת מי אימת ומתי, מסמנת את ההזמנה בירוק — **ופותחת לבד את ההזמנה הבאה**.',
    afterMark: [ord('L9301'), toast], afterFocus: ['#pOrders', '#pVerify'], afterChip: { kind: 'system', t: '⚙ עבר לבד להזמנה הבאה' } });
  // L9302 — matches; verified quickly
  await r.click({ target: '#verifyBtn', focus: ['#pVerify'], text: 'גם בהזמנה השנייה (L9302) הכול תואם לסקיצה. מאמתים.', hold: 4,
    after: 'L9302 אומתה. עכשיו נפתחה **L9303**.', afterMark: [ord('L9302'), '#vHead'], afterFocus: ['#pOrders', '#pVerify'] });
  // L9303 — row 3 mismatch
  await r.show({ focus: ['#vItems', '#skBox'], mark: [{ sel: '#vItems .item', nth: 2 }], chip: { kind: 'warn', t: '⚠ המידה לא תואמת לסקיצה' },
    text: 'בהזמנה השלישית יש בעיה: בשורה 3 כתוב **550** × 1885…' });
  await r.show({ focus: ['#vItems', '#skBox'], mark: [{ sel: '#vItems .item', nth: 2 }, '#skImg'], chip: { kind: 'warn', t: '⚠ המידה לא תואמת לסקיצה' },
    text: '…ובסקיצה, בזכוכית מספר 3, כתוב **585**. הסקיצה צודקת — אז **מתקנים את הפריט**.' });
  await r.click({ target: '[data-edit="2"]', focus: '#vItems', text: 'לוחצים על **העיפרון ✎** בשורה 3.',
    after: 'השורה נפתחת לעריכה: רוחב וגובה במילימטרים.', afterMark: '.item-editing' });
  await r.type({ target: '#edW', value: '585', focus: '#vItems', text: 'מקלידים את הרוחב הנכון: **585**.' });
  await r.click({ target: '#edSave', focus: '#vItems', text: 'ולוחצים על **הווי הירוק** כדי לשמור.',
    after: 'נשמר. בשורה כתוב עכשיו 585 × 1885 — **ומתחתיה נשאר רשום מה היה קודם, ומי תיקן**.',
    afterMark: [{ sel: '#vItems .item', nth: 2 }, toast], afterFocus: ['#vItems'] });
  r.card({ panel: true, kicker: '👤 ידני — בחשבשבת', title: 'תיקנת רק אצלנו. **בחשבשבת מתקנים ידנית — לפני שמפיקים חשבונית**',
    table: [['שורה 3 הישנה', '"**בטל יתרה לאספקה**" — לא מוחקים את השורה'], ['שורה חדשה', 'עם **אותו מספר, 3**, ובמידה הנכונה: 585 × 1885']],
    box: { kind: 'info', text: 'כך המספור בחשבשבת נשאר זהה למספור כאן, ורואים מה תוקן. (המחשה — לא מסך של חשבשבת)' } });
  await r.click({ target: '#verifyBtn', focus: ['#pVerify'], text: 'עכשיו הפריטים תואמים לסקיצה. מאמתים את L9303.', hold: 3.8,
    after: 'ונפתחת הרביעית — **L9304**, מראה אחת.', afterMark: ['#vHead'], afterFocus: ['#pOrders', '#pVerify'] });
  await r.click({ target: '#verifyBtn', focus: ['#pVerify'], text: '1200 × 800 — תואם. מאמתים.', hold: 3,
    after: 'כל 4 ההזמנות אומתו — **והכפתור נפתח**.', afterMark: '#gate', afterFocus: '#pOrders',
    afterChip: { kind: 'system', t: '⚙ השער נפתח' } });

  // scene 17: someone else edits L9302 after it was verified (the customer sent a correction: item + sketch)
  await r.show({ focus: '#pOrders', mark: '#ordList', text: 'רגע לפני ההפקה — שימו לב להזמנה השנייה…', hold: 2.8 });
  await r.exec(async (src) => {
    const o = ORDERS.find(x => x.orderNum === 'L9302');
    await lgReplaceSketch(o, src);
    await firebase.database().ref('orders/' + o.id + '/items/1').update({ w: 420 });
  }, L9302_V2());
  await r.show({ focus: '#pOrders', mark: [ord('L9302'), '#gate'], chip: { kind: 'system', t: '⚙ המערכת זיהתה שינוי אחרי אימות' },
    text: 'L9302 הפכה **אדומה**: מישהו במשרד שינה בה פריט **אחרי** שאימתת. המערכת תפסה את זה לבד — **והכפתור ננעל שוב**.' });
  await r.click({ target: ord('L9302'), focus: '#pOrders', text: 'פותחים אותה.',
    after: 'בפס האדום כתוב מי אימת ומתי. **המערכת לא מראה איזו שורה השתנתה** — לכן בודקים שוב את כל השורות מול הסקיצה.',
    afterMark: '#vBanner', afterFocus: '#pVerify' });
  await r.show({ focus: ['#vItems', '#skBox'], mark: [{ sel: '#vItems .item', nth: 1 }, '#skImg'],
    text: 'הלקוח שלח תיקון: שורה 2 היא עכשיו **420**, וגם הסקיצה עודכנה ל־420. הכול תואם.' });
  await r.click({ target: '#verifyBtn', focus: ['#pVerify'], text: 'מאמתים מחדש.', hold: 2.6,
    after: 'הכפתור נפתח שוב: כל 4 ההזמנות מאומתות.', afterMark: '#gate', afterFocus: '#pOrders' });

  r.chapter('הפקה ורישום');
  await r.click({ target: '#gateBtn', focus: '#gate', text: 'לוחצים **"הפק חשבונית בחשבשבת"**.',
    after: 'נפתח חלון עם **שלושה צעדים**. שימו לב: הכפתור **לא הפיק כלום** בחשבשבת.', afterMark: '#ovBox', afterFocus: '#ovBox',
    afterChip: { kind: 'warn', t: '⚠ הכפתור לא מפיק חשבונית' } });
  await r.show({ focus: '#ovBox', mark: '#ovBox .steps', chip: { kind: 'you', t: '👤 ידני — בחשבשבת' },
    text: '1. עוברים **לחשבשבת**. 2. מפיקים חשבונית ללקוח — בשוטף 30: **חשבונית אחת מרוכזת** על כל הזמנות החודש. 3. חוזרים לכאן ומקלידים את **מספר המסמך**.', hold: 10 });
  await r.show({ focus: '#ovBox', mark: '#ovBox .pick-list',
    text: 'אלה ההזמנות שייכנסו לרישום — כולן מסומנות. חשבונית שלא כוללת הזמנה מסוימת? מורידים לה את הסימון.' });
  await r.type({ target: '#docNum', value: '40517', focus: '#ovBox', text: 'מקלידים את מספר המסמך מחשבשבת…' });
  await r.show({ focus: '#ovBox', mark: '#docField', chip: { kind: 'warn', t: '⚠ חשבונית כפולה?' },
    text: 'הקלדת בטעות מספר של חשבונית קודמת? **המערכת עוצרת מיד**: המספר כבר רשום על הזמנה אחרת. בודקים בחשבשבת מה המספר הנכון.' });
  await r.type({ target: '#docNum', value: '40518', focus: '#ovBox', text: 'מקלידים את המספר הנכון: **40518**.' });
  await r.click({ target: '#markBtn', focus: '#ovBox',
    text: 'בודקים את המספר **לפני** הלחיצה — אין ביטול לרישום. לוחצים **"החשבונית הופקה"**.',
    after: 'המספר נרשם על ארבע ההזמנות, **והן יוצאות מהתחנה**. בית הזכוכית צפון כבר לא ברשימה.',
    afterMark: [toast, '#custList'], afterFocus: null, afterChip: { kind: 'system', t: '⚙ ההזמנות יצאו מהתחנה' } });

  await r.click({ target: '.scope[data-scope=daily]', focus: '#pCustomers', text: 'בטאב **"יומיות"** — אותו תהליך בדיוק.',
    after: 'כאן הלקוחות הרגילים. אפשר להפיק **חשבונית אחת על כמה הזמנות** של אותו לקוח — למשל שלוש הזמנות שנאספו באותו יום.', afterMark: '#custList' });
  await r.click({ target: cust('זגגות הגליל'), focus: '#pCustomers', text: 'זגגות הגליל — הזמנה אחת.', hold: 2.6,
    after: 'בודקים את שלוש השורות מול הסקיצה…', afterFocus: '#pVerify', afterMark: ['#vItems', '#skBox'] });
  await r.click({ target: '#verifyBtn', focus: ['#pVerify'], text: '…ומאמתים.', hold: 2.4,
    after: 'הכפתור נפתח: "ההזמנה אומתה". מכאן — בדיוק כמו קודם.', afterMark: '#gate', afterFocus: '#pOrders' });

  // ── ד. כשמשהו לא רגיל
  r.chapter('כשמשהו לא רגיל');
  await r.click({ target: cust('מקלחוני השרון'), focus: '#pCustomers', text: '**מקרה 1: טעות שמתגלה אחרי אימות.** מקלחוני השרון — L9201 כבר מאומתת (ירוק).', hold: 4.5 });
  await r.click({ target: ord('L9201'), focus: '#pOrders', text: 'פותחים אותה בכל זאת, כי שמנו לב למשהו.', hold: 3,
    after: 'אבל בשורה 2 כתוב **500**, ובסקיצה כתוב **520**.', afterFocus: ['#vItems', '#skBox'], afterMark: [{ sel: '#vItems .item', nth: 1 }, '#skImg'] });
  await r.click({ target: '[data-edit="1"]', focus: '#vItems', text: 'מתקנים באותו עיפרון ✎.', hold: 2.4 });
  await r.type({ target: '#edW', value: '52000', focus: '#vItems', text: 'נניח שהקלדת בטעות **52000**…' });
  await r.click({ target: '#edSave', focus: '#vItems', text: '…ולחצת שמור.',
    after: '**המערכת עוצרת**: המידה נראית שגויה, ושום דבר לא נשמר. השורה נשארת פתוחה לתיקון.', afterMark: [toast, '.item-editing'],
    afterChip: { kind: 'warn', t: '⚠ מידה לא הגיונית' } });
  await r.type({ target: '#edW', value: '520', focus: '#vItems', text: 'מקלידים **520**…' });
  await r.click({ target: '#edSave', focus: '#vItems', text: '…ושומרים.',
    after: 'ההזמנה **חזרה לאימות** — באדום, "השתנתה". מאמתים אותה שוב. וכמו קודם: מתקנים גם **בחשבשבת**.',
    afterMark: [toast, ord('L9201')], afterFocus: ['#pOrders', '#pVerify'], afterChip: { kind: 'system', t: '⚙ ההזמנה חזרה לאימות' } });
  await r.click({ target: '#verifyBtn', focus: ['#pVerify'], text: 'מאמתים שוב.', hold: 2.4,
    after: 'מאומתת. אפשר להפיק.', afterMark: '#gate', afterFocus: '#pOrders' });

  await r.click({ target: cust('אלומיניום דוד'), focus: '#pCustomers', text: '**מקרה 2: חשבונית על חלק מההזמנות.** אלומיניום דוד — 2 הזמנות מאומתות.', hold: 4.5 });
  await r.click({ target: '#gateBtn', focus: '#gate', text: 'פותחים את החלון.', hold: 2.2, afterFocus: '#ovBox' });
  await r.click({ target: '[data-pick="v9292"]', focus: '#ovBox', text: 'החשבונית בחשבשבת כוללת רק את L9291? **מורידים את הסימון** מ־L9292.',
    after: 'L9292 לא תירשם עכשיו.', afterMark: '#ovBox .pick-list' });
  await r.type({ target: '#docNum', value: '40519', focus: '#ovBox', text: 'מספר המסמך: 40519.' });
  await r.click({ target: '#markBtn', focus: '#ovBox', text: '"החשבונית הופקה".', hold: 2.4,
    after: 'נרשם על הזמנה אחת. **L9292 נשארת בתחנה**, מאומתת, ומחכה לחשבונית שלה.', afterMark: [toast, '#ordList'], afterFocus: '#pOrders' });

  r.card({ panel: true, kicker: 'מקרה 3', title: 'אימתת בטעות?', sub: 'לבטל אימות אתה לא יכול — **פנה למנהל**. רק למנהל יש כפתור **"בטל אימות"**, והוא חייב לכתוב סיבה. האימות הקודם נשאר רשום.',
    box: { kind: 'warn', text: 'רשמת מספר מסמך שגוי? בתחנה **אין ביטול לרישום** — פנה למנהל מיד.' } });

  // ── ה. סיכום
  r.chapter('סיכום');
  r.card({ title: 'סיכום · תחנת חשבוניות', bullets: [
    'הזמנה שסומנה **"נאסף"** מגיעה לכאן **לבד**',
    'בודקים כל שורה **מול הסקיצה** · מידה שגויה — מתקנים ב־✎ (וגם בחשבשבת)',
    'מאמתים כל הזמנה · שינוי אחרי אימות — **באדום**, מאמתים שוב',
    'מפיקים חשבונית **בחשבשבת** (שוטף 30: מרוכזת, פעם בחודש) ורושמים כאן את מספר המסמך',
  ], flow: [{ t: 'נאסף' }, { t: 'בדיקה מול סקיצה' }, { t: 'מאומתת' }, { t: '👤 חשבשבת' }, { t: 'מספר מסמך' }, { t: 'יוצאת מהתחנה', hot: true }] });
}
