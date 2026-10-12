// סרטון 00 — הדרך של הזמנה במפעל. התסריט: docs/training-videos/scripts/00-overview.md
// הזמנה אחת (L9101 · זגגות הגליל: 2 זכוכיות 8 מ"מ שקוף מחוסם + מראה מלוטשת) עוברת את כל התחנות, על הדפים
// האמיתיים. המצב עובר מדף לדף; הלחיצות האמיתיות הן שמקדמות אותה. הסרטון מראה את התמונה הגדולה, לא כל לחיצה.
import { CLOCK, DAY, CLIENTS, users, item, sketch, order, SKUS, PRICES, locked } from '../lib/seedlib.js';

export const meta = { id: '00', file: '00 - הדרך של הזמנה במפעל', title: 'הדרך של הזמנה במפעל', viewport: { w: 1600, h: 900 } };

const ST = ['קליטה', 'שרטט', 'יום עבודה', 'בדיקה וחיסום', 'גרפיקה', 'הובלה / איסוף', 'חשבונית'];
const GRAPHIC = 4;

export function seed() {
  const I = {
    o9101: [item('8SMH', 885, 1985), item('8SMH', 600, 1985), item('4MIRM', 700, 900)],
    o9102: [item('8SMH', 900, 2000), item('8SMH', 500, 2000)],
    o9103: [item('10SMH', 1250, 655)],
    o9104: [item('6SM', 600, 400)],
  };
  const P = items => items.map((i, n) => ({ w: i.w, h: i.h, n: n + 1, mirror: i.glass === 'מראה' }));
  const sketches = {
    ord_9101: sketch({ title: 'מקלחון ומראה', client: CLIENTS.galil.name, num: 'L9101', panes: P(I.o9101) }),
    ord_9102: sketch({ title: 'מקלחון נישה', client: CLIENTS.sharon.name, num: 'L9102', panes: P(I.o9102) }),
    ord_9103: sketch({ title: 'ויטרינה', client: CLIENTS.david.name, num: 'L9103', panes: P(I.o9103) }),
  };
  const orders = {
    // the hero: just arrived, the office has not looked at it yet
    ord_9101: order('ord_9101', 'L9101', 'galil', { stage: '', status: 'ממתין לאישור', source: 'whatsapp', waPage: 1, waPages: 1, customerId: '14300', sketchName: 'מקלחון ומראה',
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
    __api: { 'hashavshevet-order': { ok: true, reference: '10915' }, 'whatsapp-dispatch': { ok: true, queued: true, clientName: CLIENTS.galil.name } },
    db: { users: users({ worker: 'נועה' }), orders, sketches, skuCatalog: SKUS,
          prices: { global: PRICES },
          // the client cards from Hashavshevet — where the "ready" WhatsApp number comes from (customerId = 14300 + i, seedlib)
          hashavshevetAccounts: Object.fromEntries(Object.values(CLIENTS).map((c, i) => [String(14300 + i), { key: String(14300 + i), name: c.name, phone: c.phone, active: true }])),
          workday: {}, meta: { orderCounter: 9200, chisumCounter: 214 } },
  };
}

export async function script(r) {
  const prog = (cur, done) => r.progress({ stations: ST, cur, done, skip: cur > GRAPHIC || cur === null ? [GRAPHIC] : [] });

  // ── פתיחה
  r.card({ kind: 'title', dur: 3.6, title: 'הדרך של הזמנה במפעל', sub: 'מהקליטה ועד החשבונית · לכל עובד חדש',
    bullets: ['נעקוב אחרי **הזמנה אחת** בכל התחנות', 'בכל תחנה **מישהו אחר** אחראי', 'בסוף כל תחנה **המערכת** אומרת לאן ההזמנה ממשיכה'] });
  r.progress({ stations: ST, cur: -1, done: [], skip: [] });
  r.card({ dur: 5.5, title: 'הזמנת הדוגמה: **L9101 · זגגות הגליל**', table: [
    ['2 זכוכיות', '8 מ"מ שקוף **מחוסם** — נוסעות למפעל החיסום'],
    ['1 מראה', '4 מ"מ **מלוטשת** — נחתכת ומלוטשת אצלנו'],
    ['הלקוח', 'לקוח רגיל, **אוסף בעצמו**'],
  ], box: { kind: 'info', text: 'הסרטון הזה לא מלמד לחיצות. הוא מראה את הדרך. את הלחיצות לומדים בסרטון של התחנה שלך.' } });

  // ── 1. קליטה
  prog(0, []);
  await r.open('admin.html', { wait: '.stat-link' });
  await r.exec(() => { [...document.querySelectorAll('.stat-link')].find(e => /תור סקיצות/.test(e.textContent)).click(); });
  await r.click({ target: { sel: '.sq-item', text: 'L9101' }, focus: '#sqListPanel',
    text: 'הכול מתחיל כשלקוח שולח הזמנה — מהאתר, או **סקיצה בוואטסאפ**. היא נוחתת ב**"תור סקיצות"**.', hold: 4.6,
    after: 'המשרד מסתכל על **הסקיצה** של הלקוח: מה הוא רוצה, ובאילו מידות.', afterFocus: '#sqDetailPanel', afterMark: '#sqImgWrap' });
  await r.click({ target: '#sqBtnSeen', focus: '#sqDetailPanel', settle: 1200,
    text: 'עברו על הסקיצה? לוחצים **"✓ סקיצה טופלה"**.', hold: 3,
    after: 'הסקיצה מסומנת כטופלה — **והלקוח מקבל לבד הודעת וואטסאפ** שהסקיצה שלו התקבלה וטופלה.',
    afterMark: '#_lgToast', afterFocus: '#_lgToast', afterChip: { kind: 'system', t: '⚙ נשלח עדכון בוואטסאפ ללקוח' } });
  // "נראה" → the order again, where the items are entered: unseen here, taught in video 01
  await r.exec(() => { document.getElementById('sqTabSeen').click(); });
  await r.exec(() => { [...document.querySelectorAll('.sq-item')].find(e => /L9101/.test(e.textContent)).click(); });
  await r.type({ target: '#sqNotes', value: 'דלת נפתחת ימינה, ידית עגולה', focus: '#sqNotesWrap',
    text: 'הערה לשרטט? כותבים אותה ב**"הערות"** — והיא **קופצת לשרטט מיד**.' });
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
  await r.click({ target: '#drNotePopup button', focus: '#drNotePopup > div', who: 'system',
    text: 'אצל **השרטט** ההערה מתור הסקיצות **קופצת מיד** כשההזמנה נפתחת. קורא, ולוחץ **"הבנתי"**.', hold: 4.6 });
  await r.click({ target: '.btn-finish', focus: ['#sketchCanvas', '#btmBar'],
    text: 'השרטט מכין את הסקיצה לחיתוך, ולוחץ **"✓ סיים סקיצה — שלח ל-OptyWay"**.', hold: 4,
    after: 'ההזמנה עברה ל**OptyWay**, תוכנת החיתוך. מעכשיו היא מוכנה לרצפה. הסקיצה הבאה נטענת לבד.',
    afterMark: '#doneBanner', afterFocus: '#sketchCanvas', settle: 500, afterChip: { kind: 'system', t: '⚙ מחכה ל-OptyWay' } });

  // ── 3. יום עבודה — the overview shows the key moments; the clicks in between run unseen (r.exec)
  prog(2, [0, 1]);
  await r.open('workday.html', { wait: '#bvOrders' });
  await r.exec(() => { document.getElementById('bvOrders').click(); });
  await r.exec(() => { addWholeOrder('ord_9101'); document.getElementById('draftPreviewBtn').click(); });
  await r.click({ target: 'button[onclick="commitDraftToWork()"]', focus: '#draftOverlay > div',
    text: 'ברצפה בונים את **יום העבודה**: בוחרים הזמנות, ולוחצים **"▶ הורד לעבודה"**.', hold: 4,
    after: 'וכאן ההזמנה **מתפצלת**: את המראה מלטשים ברצפה, ואת הזכוכיות המחוסמות המערכת שולחת **לבד** לתחנת הבדיקה.',
    afterMark: '#toast', afterFocus: null, afterChip: { kind: 'system', t: '⚙ ההזמנה התפצלה' } });
  await r.click({ target: '#finishBtn', text: 'בסוף היום: **"✅ סיים יום עבודה"**.', hold: 2.6,
    afterFocus: '#finishOv .modal', afterMark: '#finishBody',
    after: 'החלון אומר **לאן כל הזמנה ממשיכה**. כאן: המראה גמורה, אבל **אין הודעה ללקוח עדיין** — החיסום שלו עוד לא חזר.' });
  await r.exec(() => { document.querySelector('#finishOv .btn-green').click(); });

  // ── 4. בדיקה וחיסום
  prog(3, [0, 1, 2]);
  await r.open('check-station.html', { wait: { sel: '.order-card', text: 'זגגות הגליל' } });
  await r.click({ target: { sel: '.order-card', text: 'זגגות הגליל' },
    text: 'בתחנת **הבדיקה** בודקים כל זכוכית מחוסמת **לפני** שהיא יוצאת למפעל החיסום.', hold: 4.4,
    settle: 900, afterFocus: '#notePopup .np-ok', afterMark: '#npText', after: 'וגם כאן — **ההערה מתור הסקיצות קופצת**: "הערה חשובה!". היא נוסעת עם ההזמנה לכל תחנה.',
    afterChip: { kind: 'system', t: '⚙ ההערה עוברת עם ההזמנה' } });
  await r.click({ target: '#notePopup .np-ok', text: 'קוראים, ולוחצים **"הבנתי ✓"**.', hold: 2.4,
    afterFocus: '#sketchView', afterMark: '#skArea', after: 'L9101: שתי זכוכיות לחיסום. המראה כבר לוטשה ברצפה.' });
  await r.exec(() => { document.getElementById('finishBtn').click(); });
  await r.exec(() => { document.getElementById('tabDone').click(); });
  await r.click({ target: 'button[onclick="sendAllToFactory()"]', focus: '#listView',
    text: 'בסוף היום שולחים את כל ההזמנות יחד: **"🔥 סיים יום — שלח … לחיסום והוצא דוח"**.', settle: 1200, hold: 4,
    after: 'ההזמנות יצאו למפעל, ויוצא **דוח** להדפסה שנוסע עם הזכוכיות.', afterMark: '#toast', afterFocus: null,
    afterChip: { kind: 'system', t: '⚙ נשלח למפעל · יצא דוח' } });

  // ── 4ב. חזרה מהחיסום
  await r.open('workday.html', { wait: '#tab-chisum' });
  await r.exec(() => { document.getElementById('tab-chisum').click(); });
  await r.exec(() => { [...document.querySelectorAll('button')].find(b => /קיבלתי את הדוח/.test(b.textContent)).click(); });
  await r.exec(() => { document.getElementById('chisumArrivedOk').click(); });
  await r.exec(() => { [...document.querySelectorAll('button')].find(b => /סמן הכל/.test(b.textContent) && b.offsetParent).click(); });
  await r.click({ target: '#chisumArrivedBar .btn-purple', focus: '#view-chisum',
    text: 'למחרת הזכוכיות חוזרות. בטאב **"חיסום"** מסמנים מה הגיע, ולוחצים **"✓ סיום בדיקה ואיפוס רשימה"**.', hold: 4.6,
    after: 'L9101 הושלמה — ותצא הודעה ללקוח. משהו עוד לא חזר? הוא **נשאר בחיסום ומחכה**.',
    afterFocus: { sel: 'button', text: 'אשר סיום בדיקה' }, afterMark: { sel: 'div', text: 'סקיצות הושלמו' } });
  await r.click({ target: { sel: 'button', text: 'אשר סיום בדיקה' }, text: 'מאשרים: **"✓ אשר סיום בדיקה"**.', hold: 2.4, settle: 2400,
    after: 'L9101 **מוכנה לאיסוף** — **והמערכת שולחת לבד ללקוח הודעת וואטסאפ** שההזמנה מוכנה.',
    afterMark: '#toast', afterFocus: '#toast', afterChip: { kind: 'system', t: '⚙ הודעת וואטסאפ ללקוח' } });
  r.card({ title: 'מתי הלקוח מקבל **וואטסאפ**? — המערכת שולחת לבד', table: [
    ['סקיצה מוואטסאפ טופלה', '"✓ סקיצה טופלה" בתור הסקיצות'],
    ['ההזמנה **מוכנה לאיסוף**', 'בסוף יום עבודה, בחזרה מחיסום, או בסיום גרפיקה'],
    ['**ההובלה יצאה**', '"🚚 סיים הובלה" — הודעה אחת לכל לקוח'],
  ], box: { kind: 'info', text: 'אין צורך לשלוח ידנית. אם הודעה לא נשלחה — המסך מציג אזהרה, ומעדכנים את המנהל.' } });

  // ── 5. גרפיקה — דילוג
  prog(GRAPHIC, [0, 1, 2, 3]);
  r.progress({ stations: ST, cur: GRAPHIC, done: [0, 1, 2, 3], skip: [GRAPHIC] });
  r.card({ title: 'אחרי יום העבודה — **המערכת** מחליטה לאן', sub: 'אין צורך לזכור את זה בעל־פה.',
    table: [
      ['יש בה **חיסום**', '← בדיקה וחיסום'],
      ['אין חיסום, יש **גרפיקה או חלבי**', '← גרפיקה'],
      ['אחרת', '← **מוכן לאיסוף** · ולקוח הובלות ← **הובלות**'],
    ],
    box: { kind: 'info', text: 'ב־L9101 אין גרפיקה, ולכן היא **מדלגת** על תחנת הגרפיקה.' } });

  // ── 6. איסוף
  prog(5, [0, 1, 2, 3]);
  await r.open('admin.html', { wait: { sel: '.fb', text: 'מוכן לאיסוף' } });
  await r.exec(() => { [...document.querySelectorAll('.fb')].find(b => /מוכן לאיסוף/.test(b.textContent)).click(); });
  await r.exec(() => { [...document.querySelectorAll('tr')].find(t => /L9101/.test(t.textContent)).querySelector('.cb-btn').click(); });
  await r.click({ target: '#modalAdvBtn', focus: '#ov',
    text: 'הלקוח בא לאסוף. במסך הראשי פותחים את ההזמנה ולוחצים **"📦 סיים והעבר לנאסף"**.', hold: 4.4 });
  await r.click({ target: { sel: 'button', text: '✓ העבר לנאסף' }, text: '"✓ העבר לנאסף".', hold: 1.6,
    after: 'ההזמנה **נאספה** ועברה לבד לתור החשבוניות. (לקוח **הובלות** מסתיים ממסך ההובלות.)',
    afterMark: '#_lgToast', afterFocus: null, afterChip: { kind: 'system', t: '⚙ עבר לתור החשבוניות' } });

  // ── 7. חשבונית
  prog(6, [0, 1, 2, 3, 5]);
  await r.open('invoices.html', { wait: '#custList .cust' });
  await r.click({ target: { sel: '#custList .cust', text: 'זגגות הגליל' }, focus: '#pCustomers',
    text: 'בתחנת **החשבוניות** בודקים לפני חשבונית את **הפריטים מול הסקיצה**.', hold: 4,
    after: 'הכול תואם? מאמתים.', afterFocus: '#pVerify', afterMark: ['#vItems', '#skBox'] });
  await r.exec(() => { document.getElementById('verifyBtn').click(); });
  await r.click({ target: '#gateBtn', focus: '#gate', text: 'ואז **"הפק חשבונית בחשבשבת"**.', hold: 2.4,
    after: 'הכפתור **לא מפיק כלום**: את החשבונית מפיקים **ידנית, בחשבשבת**, וחוזרים לרשום כאן את מספר המסמך. ההזמנה **סגורה**.',
    afterMark: '#ovBox .steps', afterFocus: '#ovBox', afterChip: { kind: 'you', t: '👤 ידני — בחשבשבת' } });

  // ── סיכום
  r.progress({ stations: ST, cur: -1, done: [0, 1, 2, 3, 5, 6], skip: [GRAPHIC] });
  r.chapter('סיכום');
  r.card({ title: 'זו כל הדרך. עכשיו: **הסרטון של התחנה שלך**', sub: 'שם עוברים על כל לחיצה, וגם על מה עושים כשמשהו לא רגיל.',
    bullets: ['01 · קליטת הזמנה ושרטט', '02 · יום עבודה', '03 · תחנת בדיקה וחיסום', '04 · גרפיקה', '05 · הובלות ואיסוף', '06 · תחנת חשבוניות'],
    flow: ST.filter((_, i) => i !== GRAPHIC).map((t, i, a) => ({ t, hot: i === a.length - 1 })) });
}
