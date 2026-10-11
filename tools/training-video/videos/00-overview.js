// סרטון 00 — הדרך של הזמנה במפעל. התסריט: docs/training-videos/scripts/00-overview.md
// הזמנה אחת (L9101 · זגגות הגליל: 2 זכוכיות 8 מ"מ שקוף מחוסם + מראה מלוטשת) עוברת את כל התחנות, על הדפים
// האמיתיים. המצב עובר מדף לדף; הלחיצות האמיתיות הן שמקדמות אותה. הסרטון מראה את התמונה הגדולה, לא כל לחיצה.
import { CLOCK, DAY, CLIENTS, users, item, sketch, order, SKUS } from '../lib/seedlib.js';

export const meta = { id: '00', file: '00 - הדרך של הזמנה במפעל', title: 'הדרך של הזמנה במפעל', viewport: { w: 1600, h: 900 } };

const ST = ['קליטה', 'שרטט', 'יום עבודה', 'בדיקה וחיסום', 'גרפיקה', 'הובלה / איסוף', 'חשבונית'];
const GRAPHIC = 4;

export function seed() {
  const I = {
    o9101: [item('8SMH', 885, 1985), item('8SMH', 600, 1985), item('M4', 700, 900)],
    o9102: [item('8SMH', 900, 2000), item('8SMH', 500, 2000)],
    o9103: [item('10SMH', 1250, 655)],
    o9104: [item('6SL', 600, 400)],
  };
  const P = items => items.map((i, n) => ({ w: i.w, h: i.h, n: n + 1, mirror: i.glass === 'מראה' }));
  const sketches = {
    ord_9101: sketch({ title: 'מקלחון ומראה', client: CLIENTS.galil.name, num: 'L9101', panes: P(I.o9101) }),
    ord_9102: sketch({ title: 'מקלחון נישה', client: CLIENTS.sharon.name, num: 'L9102', panes: P(I.o9102) }),
    ord_9103: sketch({ title: 'ויטרינה', client: CLIENTS.david.name, num: 'L9103', panes: P(I.o9103) }),
  };
  const orders = {
    // the hero: just arrived, the office has not looked at it yet
    ord_9101: order('ord_9101', 'L9101', 'galil', { stage: '', status: 'ממתין לאישור', source: 'upload', sketchName: 'מקלחון ומראה',
      items: I.o9101, hasSketch: true, date: '12.10.2026', time: '08:05', createdAt: CLOCK - 3 * 3600e3 }),
    // background traffic, so the screens are not empty
    ord_9102: order('ord_9102', 'L9102', 'sharon', { stage: '', status: 'ממתין לאישור', source: 'upload', sketchName: 'מקלחון נישה',
      items: I.o9102, hasSketch: true, date: '12.10.2026', time: '09:20', createdAt: CLOCK - 2 * 3600e3 }),
    ord_9103: order('ord_9103', 'L9103', 'david', { stage: 'chash', status: 'אצל שרטט', sketchName: 'ויטרינה',
      items: I.o9103, hasSketch: true, date: '11.10.2026', sketchSeenAt: CLOCK - DAY }),
    ord_9104: order('ord_9104', 'L9104', 'tzafon', { stage: 'opty', status: 'מחכה ל-OptyWay', sketchName: 'מדפים',
      items: I.o9104, date: '11.10.2026', sketchSeenAt: CLOCK - DAY }),
  };
  return {
    __clock: CLOCK, __session: '0500000000',
    __api: { 'hashavshevet-order': { ok: true, reference: '10915' } },
    db: { users: users({ worker: 'נועה' }), orders, sketches, skuCatalog: SKUS,
          prices: { global: { '8SMH': 420, '10SMH': 520, '6SL': 260, 'M4': 380 } },
          // the client cards from Hashavshevet — where the "ready" WhatsApp number comes from (customerId = 14300 + i, seedlib)
          hashavshevetAccounts: Object.fromEntries(Object.values(CLIENTS).map((c, i) => [String(14300 + i), { key: String(14300 + i), name: c.name, phone: c.phone, active: true }])),
          workday: {}, meta: { orderCounter: 9200, chisumCounter: 214 } },
  };
}

export async function script(r) {
  const prog = (cur, done) => r.progress({ stations: ST, cur, done, skip: cur > GRAPHIC || cur === null ? [GRAPHIC] : [] });

  // ── פתיחה
  r.card({ kind: 'title', title: 'הדרך של הזמנה במפעל', sub: 'מהקליטה ועד החשבונית · לכל עובד חדש',
    bullets: ['נעקוב אחרי **הזמנה אחת** בכל התחנות', 'בכל תחנה **מישהו אחר** אחראי', 'בסוף כל תחנה **המערכת** אומרת לאן ההזמנה ממשיכה'] });
  r.progress({ stations: ST, cur: -1, done: [], skip: [] });
  r.card({ title: 'הזמנת הדוגמה: **L9101 · זגגות הגליל**', table: [
    ['2 זכוכיות', '8 מ"מ שקוף **מחוסם** — נוסעות למפעל החיסום'],
    ['1 מראה', '4 מ"מ **מלוטשת** — נחתכת ומלוטשת אצלנו'],
    ['הלקוח', 'לקוח רגיל, **אוסף בעצמו**'],
  ], box: { kind: 'info', text: 'הסרטון הזה לא מלמד לחיצות. הוא מראה את הדרך. את הלחיצות לומדים בסרטון של התחנה שלך.' } });

  // ── 1. קליטה
  prog(0, []);
  await r.open('admin.html', { wait: '.stat-link' });
  await r.click({ target: { sel: '.stat-link', text: 'תור סקיצות' }, text: 'הכול מתחיל כשלקוח שולח הזמנה: מהאתר, או בסקיצה בוואטסאפ. ההזמנה נוחתת ב**"תור סקיצות"**.',
    after: 'L9101 מחכה בטאב **"עוד לא נראה"**.', afterFocus: '#sqListPanel', afterMark: { sel: '.sq-item', text: 'L9101' } });
  await r.click({ target: { sel: '.sq-item', text: 'L9101' }, focus: '#sqListPanel', text: 'פותחים אותה.', hold: 2,
    after: 'המשרד מסתכל על **הסקיצה** של הלקוח: מה הוא רוצה, ובאילו מידות.', afterFocus: '#sqDetailPanel', afterMark: '#sqImgWrap' });
  await r.click({ target: '#sqBtnSeen', focus: '#sqDetailPanel', text: 'עברו על הסקיצה? לוחצים **"✓ סקיצה טופלה"**.', hold: 3,
    after: 'הסקיצה עוברת לטאב **"נראה"**.', afterMark: '#sqTabSeen', afterFocus: '#sqTopBar' });
  await r.click({ target: '#sqTabSeen', focus: '#sqTopBar', text: 'עוברים לטאב "נראה".', hold: 2 });
  await r.click({ target: { sel: '.sq-item', text: 'L9101' }, focus: '#sqListPanel', text: 'ופותחים שוב את L9101.', hold: 2 });
  await r.show({ focus: '#sqItemsWrap', mark: '#sqItemsWrap', who: 'you',
    text: 'כאן מקלידים את **הפריטים**: איזו זכוכית, איזו מידה, כמה יחידות. בדוגמה הם כבר הוקלדו: 2 זכוכיות מחוסמות ומראה.' });
  await r.click({ target: '#sqBtnChash', focus: '#sqActions',
    text: 'הפריטים מוכנים? לוחצים **"📋 הועבר לחשבשבת"**.',
    after: 'המערכת **פותחת לבד הזמנת סוכן בחשבשבת**, וההזמנה יוצאת מהתור וממשיכה **לשרטט**.',
    afterMark: 'div[style*="bottom:80px"]', afterFocus: null, settle: 280,
    afterChip: { kind: 'system', t: '⚙ נפתחה הזמנה בחשבשבת · עברה לשרטט' } });
  // what the server writes back on the order when the agent order opens (fake API — nothing real is sent)
  await r.exec(() => firebase.database().ref('orders/ord_9101').update({ hashavshevet: { reference: '10915', httpOk: true, sentAt: Date.now() } }));

  // ── 2. שרטט
  prog(1, [0]);
  await r.open('drafter.html', { wait: '.sb-item' });
  await r.show({ wide: true, text: 'אצל **השרטט**: הסקיצות שעברו לחשבשבת מחכות כאן בתור. L9101 בראש הרשימה.', who: 'you' });
  await r.click({ target: '.btn-finish', focus: ['#sketchCanvas', '#btmBar'],
    text: 'השרטט מכין את הסקיצה לחיתוך. כשסיים — **"✓ סיים סקיצה — שלח ל-OptyWay"**.',
    after: 'ההזמנה עברה ל**OptyWay**, תוכנת החיתוך. מעכשיו היא מוכנה לרצפה. הסקיצה הבאה נטענת לבד.',
    afterMark: '#doneBanner', afterFocus: '#sketchCanvas', settle: 500, afterChip: { kind: 'system', t: '⚙ מחכה ל-OptyWay' } });

  // ── 3. יום עבודה
  prog(2, [0, 1]);
  await r.open('workday.html', { wait: '#bvOrders' });
  await r.click({ target: '#bvOrders', focus: '#view-build',
    text: 'ברצפה בונים את **יום העבודה**: בוחרים הזמנות מתוך "בנה יום עבודה". עוברים לתצוגת **"הזמנות"**.', hold: 4,
    after: 'L9101 כאן, מחכה לביצוע.', afterMark: { sel: 'button[onclick="addWholeOrder(\'ord_9101\')"]', nth: 0 } });
  await r.click({ target: { sel: 'button[onclick="addWholeOrder(\'ord_9101\')"]', nth: 0 }, focus: '#view-build',
    text: 'לוחצים **"+ הוסף הזמנה שלמה"**.', hold: 2.4,
    after: 'ההזמנה נכנסה ל**טיוטה**.', afterMark: '#draftPreviewBtn', afterFocus: '#draftPreviewBtn' });
  await r.click({ target: '#draftPreviewBtn', text: 'פותחים את הטיוטה…', hold: 2,
    afterFocus: '#draftOverlay > div', after: 'שלושת הפריטים של L9101.' });
  await r.click({ target: 'button[onclick="commitDraftToWork()"]', focus: '#draftOverlay > div',
    text: '…ולוחצים **"▶ הורד לעבודה"**.',
    after: 'וכאן ההזמנה **מתפצלת**: את המראה מלטשים כאן ברצפה, ואת הזכוכיות המחוסמות המערכת שולחת **לבד** לתחנת הבדיקה.',
    afterMark: '#toast', afterFocus: null, afterChip: { kind: 'system', t: '⚙ ההזמנה התפצלה' } });
  await r.click({ target: '#finishBtn', text: 'המראה נחתכה ולוטשה. בסוף היום לוחצים **"✅ סיים יום עבודה"**.', hold: 3,
    afterFocus: '#finishOv .modal', afterMark: '#finishBody',
    after: 'החלון אומר מה יקרה: המראה גמורה, אבל **אין הודעה ללקוח עדיין** — החיסום שלו עוד לא חזר.' });
  await r.click({ target: '#finishOv .btn-green', focus: '#finishOv .modal', text: 'מאשרים.', hold: 2,
    after: 'הליטוש של L9101 הסתיים. ההזמנה מחכה לחיסום.', afterMark: '#toast', afterFocus: null });

  // ── 4. בדיקה וחיסום
  prog(3, [0, 1, 2]);
  await r.open('check-station.html', { wait: { sel: '.order-card', text: 'זגגות הגליל' } });
  await r.show({ wide: true, mark: { sel: '.order-card', text: 'זגגות הגליל' }, who: 'you',
    text: 'בתחנת **הבדיקה** מחכה L9101 עם **2 פריטי חיסום**. המראה לא נבדקת כאן — היא כבר לוטשה ברצפה.' });
  await r.click({ target: { sel: '.order-card', text: 'זגגות הגליל' }, text: 'פותחים את הסקיצה, ובודקים כל זכוכית **לפני** שהיא יוצאת למפעל החיסום.', hold: 4,
    afterFocus: '#sketchView', afterMark: '#skArea' });
  await r.click({ target: '#finishBtn', text: 'הכול תקין? **"סיים סקיצה"**.', hold: 2.4,
    after: 'הסקיצה עברה לטאב "הושלמו".', afterMark: '#tabDone', afterFocus: '#tabsBar' });
  await r.click({ target: '#tabDone', text: 'בסוף היום, בטאב **"✅ הושלמו"**…', hold: 2.4,
    afterMark: 'button[onclick="sendAllToFactory()"]', afterFocus: '#listView' });
  await r.click({ target: 'button[onclick="sendAllToFactory()"]', focus: '#listView',
    text: '…שולחים את כל ההזמנות יחד: **"🔥 סיים יום — שלח … לחיסום והוצא דוח"**.', settle: 1200,
    after: 'ההזמנות יצאו למפעל החיסום.', afterMark: '#toast', afterFocus: null, afterChip: { kind: 'system', t: '⚙ נשלח למפעל · יצא דוח' } });
  await r.showPrinted({ text: 'ויוצא **דוח** להדפסה, שנוסע עם הזכוכיות למפעל.' });

  // ── 4ב. חזרה מהחיסום
  // harness gap: real Firebase drops an empty object, the fake keeps {} — and workday.html then calls forEach on it
  await r.exec(() => firebase.database().ref('workday/selected').remove());
  await r.open('workday.html', { wait: '#tab-chisum' });
  await r.click({ target: '#tab-chisum', text: 'למחרת הזכוכיות חוזרות. ביום העבודה, בטאב **"חיסום"**.', hold: 3,
    afterFocus: '#view-chisum', afterMark: { sel: 'button', text: 'קיבלתי את הדוח' } });
  await r.click({ target: { sel: 'button', text: 'קיבלתי את הדוח' }, focus: '#view-chisum', text: 'לוחצים **"📦 קיבלתי את הדוח"**…', hold: 2.4,
    afterFocus: '#chisumArrivedOk', after: 'ומאשרים.' });
  await r.click({ target: '#chisumArrivedOk', text: '"✓ כן, קיבלתי".', hold: 1.6, afterFocus: '#view-chisum', afterMark: { sel: 'button', text: 'סמן הכל' },
    after: 'עכשיו מסמנים **מה הגיע**.' });
  await r.click({ target: { sel: 'button', text: 'סמן הכל' }, focus: '#view-chisum', text: 'הכול הגיע — **"✓ סמן הכל"**.', hold: 2.4,
    after: 'משהו עוד לא חזר? הוא פשוט **נשאר בחיסום ומחכה** — לא מאבדים אותו. על זה יש הסבר בסרטון של התחנה.',
    afterFocus: '#view-chisum', afterChip: { kind: 'warn', t: '⚠ חסר? נשאר בחיסום' } });
  await r.click({ target: '#chisumArrivedBar .btn-purple', focus: '#view-chisum', text: 'לוחצים **"✓ סיום בדיקה ואיפוס רשימה"**.', hold: 2.4,
    after: 'החלון אומר **לאן ההזמנה ממשיכה**: L9101 הושלמה, ותישלח הודעה ללקוח.', afterFocus: { sel: 'button', text: 'אשר סיום בדיקה' },
    afterMark: { sel: 'div', text: 'סקיצות הושלמו' } });
  await r.click({ target: { sel: 'button', text: 'אשר סיום בדיקה' }, text: '"✓ אשר סיום בדיקה".', hold: 2,
    after: 'L9101 **מוכנה לאיסוף**, והלקוח קיבל הודעה.', afterMark: '#toast', afterFocus: null,
    afterChip: { kind: 'system', t: '⚙ מוכן לאיסוף · הודעה ללקוח' } });

  // ── 5. גרפיקה — דילוג
  prog(GRAPHIC, [0, 1, 2, 3]);
  r.progress({ stations: ST, cur: GRAPHIC, done: [0, 1, 2, 3], skip: [GRAPHIC] });
  r.card({ title: 'אחרי יום העבודה — **המערכת** מחליטה לאן', sub: 'אותה החלטה בכל הזמנה. אין צורך לזכור אותה בעל־פה.',
    table: [
      ['יש בה **חיסום**', '← בדיקה וחיסום'],
      ['אין חיסום, יש **גרפיקה או חלבי**', '← גרפיקה'],
      ['אחרת', '← **מוכן לאיסוף** · ולקוח הובלות ← **הובלות**'],
    ],
    box: { kind: 'info', text: 'L9101 אין בה עבודת גרפיקה, ולכן היא **מדלגת** על תחנת הגרפיקה. המערכת יודעת את זה לבד.' } });

  // ── 6. איסוף
  prog(5, [0, 1, 2, 3]);
  await r.open('admin.html', { wait: { sel: '.fb', text: 'מוכן לאיסוף' } });
  await r.click({ target: { sel: '.fb', text: 'מוכן לאיסוף' }, text: 'הלקוח בא לאסוף. במסך הראשי, ב**"מוכן לאיסוף"**…', hold: 3,
    afterMark: { sel: 'tr', text: 'L9101' } });
  await r.click({ target: { sel: 'tr .cb-btn', text: 'פרטים' }, focus: { sel: 'tr', text: 'L9101' }, text: '…פותחים את L9101 ("פרטים").', hold: 1.8,
    afterFocus: '#ov', afterMark: '#modalAdvBtn' });
  await r.click({ target: '#modalAdvBtn', text: 'לוחצים **"📦 סיים והעבר לנאסף"**.', hold: 2.4,
    afterFocus: { sel: 'button', text: '✓ העבר לנאסף' }, after: 'ההזמנה תעבור לתור החשבוניות.' });
  await r.click({ target: { sel: 'button', text: '✓ העבר לנאסף' }, text: '"✓ העבר לנאסף".', hold: 1.6,
    after: 'ההזמנה **נאספה** ועברה לבד לתור החשבוניות. לקוח **הובלות** לא עובר כאן: אצלו זה קורה ממסך ההובלות, כשהנהג מסיים.',
    afterMark: '#_lgToast', afterFocus: null, afterChip: { kind: 'system', t: '⚙ עבר לתור החשבוניות' } });

  // ── 7. חשבונית
  prog(6, [0, 1, 2, 3, 5]);
  await r.open('invoices.html', { wait: '#custList .cust' });
  await r.click({ target: { sel: '#custList .cust', text: 'זגגות הגליל' }, focus: '#pCustomers', text: 'בתחנת **החשבוניות**: זגגות הגליל.', hold: 2.4,
    after: 'לפני חשבונית בודקים את **הפריטים מול הסקיצה**, שורה אחרי שורה.', afterFocus: '#pVerify', afterMark: ['#vItems', '#skBox'] });
  await r.click({ target: '#verifyBtn', focus: '#pVerify', text: 'הכול תואם? **"סקיצה מאומתת"**.', hold: 2.4,
    after: 'הכפתור **"הפק חשבונית בחשבשבת"** נפתח.', afterMark: '#gate', afterFocus: '#pOrders' });
  await r.click({ target: '#gateBtn', focus: '#gate', text: 'לוחצים עליו.', hold: 1.6,
    after: 'הכפתור **לא מפיק כלום**. את החשבונית עצמה מפיקים **ידנית, בחשבשבת**, וחוזרים לכאן עם מספר המסמך.',
    afterMark: '#ovBox .steps', afterFocus: '#ovBox', afterChip: { kind: 'you', t: '👤 ידני — בחשבשבת' } });
  await r.type({ target: '#docNum', value: '40521', focus: '#ovBox', text: 'מקלידים את **מספר המסמך** מחשבשבת…' });
  await r.click({ target: '#markBtn', focus: '#ovBox', text: '…ולוחצים **"החשבונית הופקה"**.',
    after: 'המספר נרשם, וההזמנה **סגורה**. זה סוף הדרך.', afterMark: '.toast', afterFocus: null,
    afterChip: { kind: 'ok', t: '✓ ההזמנה סגורה' } });

  // ── סיכום
  r.progress({ stations: ST, cur: -1, done: [0, 1, 2, 3, 5, 6], skip: [GRAPHIC] });
  r.chapter('סיכום');
  r.card({ title: 'זו כל הדרך. עכשיו: **הסרטון של התחנה שלך**', sub: 'שם עוברים על כל לחיצה, וגם על מה עושים כשמשהו לא רגיל.',
    bullets: ['01 · קליטת הזמנה ושרטט', '02 · יום עבודה', '03 · תחנת בדיקה וחיסום', '04 · גרפיקה', '05 · הובלות ואיסוף', '06 · תחנת חשבוניות'],
    flow: ST.filter((_, i) => i !== GRAPHIC).map((t, i, a) => ({ t, hot: i === a.length - 1 })) });
}
