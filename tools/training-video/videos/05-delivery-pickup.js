// סרטון 05 — הובלות ואיסוף. התסריט: docs/training-videos/scripts/04-05-graphic-delivery.md
// workday.html הטאב "הובלות" (showClientDeliveryPrompt → finalizeDelivery → _waDispatch),
// admin.html חלון ההזמנה ("📦 סיים והעבר לנאסף" → showCollectedPrompt / _lgBlockDeliveryFinish), ניהול משתמשים.
import { CLOCK, DAY, CLIENTS, users, item, sketch, order, SKUS, PRICES, locked } from '../lib/seedlib.js';

export const meta = { id: '05', file: '05 - הובלות ואיסוף', title: 'הובלות ואיסוף', viewport: { w: 1600, h: 900 } };

// a second delivery client, so the deliveries tab shows that every client is a card of its own
const CARMEL = { phone: '0500000105', name: 'זכוכית הכרמל', delivery: true };
const G_NAME = '10מ"מ שקוף גרפיקה מחוסם';
const gItem = (w, h) => ({ sku: '10SGMH', name: G_NAME, glassFullName: G_NAME, glass: 'שקוף', mm: 10, w, h, qty: 1, graphic: true, chisum: true });
// locked(items, at): the price fields, computed from the real price list (seedlib PRICES)

export function seed() {
  const I = {
    d9102: [gItem(900, 2000)],
    d9104: [item('8SMH', 780, 1950), item('8SMH', 400, 1950)],
    d9301: [item('10SMH', 1000, 2100)],
    r9101: [item('8SMH', 885, 1985), item('8SMH', 600, 1985)],
    b9201: [item('6SMH', 700, 1200)],
  };
  const P = items => items.map((i, n) => ({ w: i.w, h: i.h, n: n + 1 }));
  const sk = (title, c, num, items) => sketch({ title, client: c.name, num, panes: P(items) });
  const inDelivery = { stage: 'delivery', status: 'ממתין להובלה', date: '11.10.2026', hasSketch: true };
  const ready = { stage: 'done', status: 'מוכן לאיסוף', date: '11.10.2026', hasSketch: true };
  const orders = {
    d9102: order('d9102', 'L9102', 'sharon', { ...inDelivery, sketchName: 'דלת מקלחון', items: I.d9102, ...locked(I.d9102, CLOCK - DAY) }),
    d9104: order('d9104', 'L9104', 'sharon', { ...inDelivery, sketchName: 'מקלחון חזית', items: I.d9104, ...locked(I.d9104, CLOCK - DAY) }),
    d9301: order('d9301', 'L9301', CARMEL, { ...inDelivery, sketchName: 'ויטרינה', items: I.d9301, ...locked(I.d9301, CLOCK - DAY) }),
    r9101: order('r9101', 'L9101', 'galil', { ...ready, sketchName: 'מקלחון', items: I.r9101, ...locked(I.r9101, CLOCK - DAY) }),
    b9201: order('b9201', 'L9201', 'david', { ...ready, sketchName: 'חלון', items: I.b9201, ...locked(I.b9201, CLOCK - DAY) }),
  };
  const sketches = {
    d9102: sk('דלת מקלחון', CLIENTS.sharon, 'L9102', I.d9102),
    d9104: sk('מקלחון חזית', CLIENTS.sharon, 'L9104', I.d9104),
    d9301: sk('ויטרינה', CARMEL, 'L9301', I.d9301),
    r9101: sk('מקלחון', CLIENTS.galil, 'L9101', I.r9101),
    b9201: sk('חלון', CLIENTS.david, 'L9201', I.b9201),
  };
  const u = users({ worker: 'נועה', mainAdmin: true });
  u[CARMEL.phone] = { id: 'c9', name: CARMEL.name, businessName: CARMEL.name, role: 'client', phone: CARMEL.phone, customerId: '14309', isDelivery: true, monthlyBilling: false };
  return { __clock: CLOCK, __session: '0500000000',
    // the success path: the server accepts the message into the send queue (docs/training-videos/00-STANDARDS.md §6)
    __api: { 'whatsapp-dispatch': { ok: true, queued: true, orderNums: ['L9102', 'L9104'] } },
    db: { users: u, orders, sketches, skuCatalog: SKUS,
          prices: { global: PRICES },
          workday: { date: '12.10.2026', selected: [], inWork: [], inChisum: [] }, meta: { orderCounter: 9400 } } };
}

export async function script(r) {
  const dcard = id => `.stv-card:has(button[data-ids*="${id}"])`;
  const finish = id => `button[data-ids*="${id}"]`;

  r.card({ kind: 'title', title: 'הובלות ואיסוף', sub: 'נהג / מעמיס · איש משרד · איך הזמנה גמורה יוצאת מהמפעל',
    bullets: ['לסיים **הובלה** — במסך ההובלות', 'לסמן הזמנה שהלקוח **אסף בעצמו** — במסך הניהול', 'לאן ההזמנה ממשיכה אחר כך'] });

  // ── ב. סיור במסך
  r.chapter('סיור במסך · הובלות');
  await r.open('workday.html', { wait: '#tab-delivery' });
  await r.click({ target: '#tab-delivery', focus: '.phase-tabs',
    text: 'במסך יום העבודה לוחצים על הטאב **"הובלות"**.',
    after: 'כאן כל ההזמנות שמחכות להובלה: **"🚚 הובלות ממתינות"**.', afterMark: '#view-delivery', afterFocus: '#view-delivery' });
  await r.show({ focus: '#deliveryOrders', mark: '.stv-grand',
    text: 'למעלה — כמה **פריטים** יוצאים בסך הכול, בכמה הזמנות ולכמה לקוחות. את זה צריך לדעת לפני שמעמיסים.' });
  await r.show({ focus: dcard('d9102'), mark: [`${dcard('d9102')} .stv-sub`, finish('d9102')],
    text: 'כל כרטיס = **לקוח אחד**, עם כל ההזמנות שלו שמחכות להובלה. הכפתור למטה מסיים את **כל** ההזמנות שבכרטיס — יחד.' });

  // ── ג. הדגמה: סיום הובלה
  r.chapter('סיום הובלה');
  await r.click({ target: `${dcard('d9102')} summary`, focus: dcard('d9102'),
    text: 'לפני שיוצאים, פותחים **"פירוט"**…',
    after: '…ובודקים שכל ההזמנות שבכרטיס באמת עלו למשאית: **L9102** ו־**L9104**, עם הפריטים והסקיצות.',
    afterMark: `${dcard('d9102')} .stv-det`, afterFocus: dcard('d9102') });
  await r.show({ focus: dcard('d9102'), mark: finish('d9102'), chip: { kind: 'warn', t: '⚠ אין חלון אישור — הלחיצה מבצעת מיד' },
    text: 'הכול נמסר ללקוח? לוחצים **"🚚 סיים הובלה (2 הזמנות)"**. אין חלון "בטוח?".' });
  await r.click({ target: finish('d9102'), focus: dcard('d9102'), text: 'לוחצים.', hold: 2,
    after: 'שתי ההזמנות עברו ל**"נאסף"**, והכרטיס יצא מהרשימה. הן **ממתינות לחשבונית**.',
    afterMark: ['#toast', '#deliveryOrders'], afterFocus: null });
  await r.sleep(900);   // the page sends the customer message 1.2s after the stage is written
  await r.show({ wide: true, mark: '#toast', who: 'system',
    text: 'שנייה אחר כך המערכת מכניסה לתור **הודעה אחת** ללקוח: "ההובלה יצאה אליך", עם מספרי שתי ההזמנות. הודעה אחת ללקוח — לא אחת לכל הזמנה.', hold: 7 });
  await r.show({ focus: dcard('d9301'), mark: dcard('d9301'),
    text: 'זכוכית הכרמל **לא** השתנתה: כל לקוח מסיימים בכרטיס שלו, כשהמשאית אצלו.' });

  // ── ג2. איסוף עצמי
  r.chapter('לקוח שאסף בעצמו');
  await r.open('admin.html', { wait: '#tbody tr' });
  await r.click({ target: { sel: '.filters .fb', text: 'מוכן לאיסוף' }, focus: '.filters',
    text: 'לקוח רגיל בא לאסוף בעצמו. זה נעשה **במסך הניהול**. לוחצים על הסינון **"מוכן לאיסוף"**.',
    after: 'בטבלה נשארו רק ההזמנות שמחכות ללקוחות.', afterMark: '#tbody', afterFocus: ['.filters', '#tbody'] });
  await r.click({ target: `button[onclick="openMod('r9101')"]`, focus: '#tbody',
    text: 'מוצאים את ההזמנה של הלקוח שעומד מולך — זגגות הגליל, **L9101** — ולוחצים **"פרטים"**.',
    after: 'נפתח חלון ההזמנה: מספר, סטטוס "מוכן לאיסוף", הפריטים והסקיצה.', afterMark: '#ov .modal', afterFocus: '#ov .modal' });
  await r.click({ target: '#modalAdvBtn', focus: '#ov .mfoot',
    text: 'למטה — הכפתור הירוק **"📦 סיים והעבר לנאסף"**.',
    after: 'המערכת שואלת שוב, ומסבירה לאן ההזמנה הולכת: **לתור החשבוניות**.',
    afterMark: { sel: 'div[style*="z-index: 600"] > div' }, afterFocus: { sel: 'div[style*="z-index: 600"] > div' } });
  await r.click({ target: { sel: 'button', text: '✓ העבר לנאסף' }, focus: { sel: 'div[style*="z-index: 600"] > div' },
    text: 'בודקים שהשם והמספר נכונים, ולוחצים **"✓ העבר לנאסף"**.',
    after: 'ההזמנה ב**"נאסף"** ויצאה מהסינון. היא מחכה עכשיו **בתור החשבוניות**.',
    afterMark: ['#_lgToast', '#tbody'], afterFocus: null });
  r.card({ panel: true, kicker: '⚙ המערכת', title: 'כאן **לא** נשלחת הודעה ללקוח',
    sub: 'הוא כבר קיבל הודעה כשההזמנה הייתה מוכנה לאיסוף. ההזמנה עברה לתור החשבוניות — שם בודקים אותה מול הסקיצה ומפיקים חשבונית.' });

  // ── ד. כשמשהו לא רגיל
  r.chapter('כשמשהו לא רגיל');
  await r.click({ target: { sel: '.filters .fb', text: 'הובלות' }, focus: '.filters',
    text: '**מקרה 1: הזמנת הובלה מתוך מסך הניהול.** עוברים לסינון "הובלות".',
    after: 'כאן ההזמנה של זכוכית הכרמל, שעוד מחכה להובלה.', afterMark: '#tbody', afterFocus: ['.filters', '#tbody'] });
  await r.click({ target: `button[onclick="openMod('d9301')"]`, focus: '#tbody', text: 'פותחים "פרטים".', hold: 2.4,
    afterMark: '#modalAdvBtn', afterFocus: '#ov .modal' });
  await r.click({ target: '#modalAdvBtn', focus: '#ov .mfoot',
    text: 'גם כאן יש **"📦 סיים והעבר לנאסף"**. מה קורה אם לוחצים?',
    after: '**המערכת עוצרת**: "סיום הובלה נעשה ממסך ההובלות". רק משם הלקוח מקבל הודעה אחת על כל ההובלה.',
    afterMark: { sel: 'div[style*="z-index: 700"] > div' }, afterFocus: { sel: 'div[style*="z-index: 700"] > div' },
    afterChip: { kind: 'warn', t: '⚠ הובלה מסיימים רק ממסך ההובלות' } });
  await r.click({ target: '#dfbClose', focus: { sel: 'div[style*="z-index: 700"] > div' },
    text: 'סוגרים, ומסיימים את ההובלה **ביום עבודה ← "הובלות"**.', hold: 3.5 });
  r.card({ panel: true, kicker: 'מקרה 2', title: 'לא כל ההזמנות עלו למשאית?',
    sub: '"סיים הובלה" מסיים את **כל** ההזמנות שבכרטיס הלקוח, ואי אפשר לבחור רק חלק מהן. הזמנה אחת נשארה במפעל? **לא לוחצים — פונים למנהל.**',
    box: { kind: 'warn', text: 'הכפתור מסיים את כל הכרטיס.' } });

  // ── למנהלים
  r.chapter('למנהלים: לקוח הובלות');
  await r.exec(() => openUserMgmt());
  await r.show({ focus: '#userMgmtOv', mark: { sel: '#umListClients > div', text: 'זכוכית הכרמל' },
    text: '**למנהל הראשי:** בניהול המשתמשים, ליד לקוח הובלות כתוב **"🚚 הובלות"**.' });
  await r.show({ focus: '#userMgmtOv', mark: [`button[onclick*="umToggleDelivery('c0'"]`, `button[onclick*="umToggleDelivery('c9'"]`],
    text: 'הכפתור 🚚 בשורת הלקוח הופך אותו ללקוח הובלות. אחרי אישור — ההזמנות הקיימות שלו מסומנות כהובלה, והן יגיעו לטאב "הובלות" במקום ל"מוכן לאיסוף".', hold: 8 });

  // ── ה. סיכום
  r.chapter('סיכום');
  r.card({ title: 'סיכום · הובלות ואיסוף', bullets: [
    '**הובלה** — מסיימים ביום עבודה ← "הובלות" · כפתור אחד לכל לקוח, לכל ההזמנות שבכרטיס',
    'המערכת שולחת ללקוח **הודעה אחת** על ההובלה',
    '**איסוף עצמי** — במסך הניהול: "פרטים" ← "📦 סיים והעבר לנאסף" ← "✓ העבר לנאסף"',
    'בשני המקרים ההזמנה עוברת ל**"נאסף"** ומחכה **בתחנת החשבוניות** (סרטון 06)',
  ], flow: [{ t: 'מוכן לאיסוף / ממתין להובלה' }, { t: 'נאסף' }, { t: 'תחנת חשבוניות', hot: true }] });
}
