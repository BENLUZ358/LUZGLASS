// סרטון 01 — קליטת הזמנה ושרטט. התסריט: docs/training-videos/scripts/01-intake-drafter.md
// בלי קריינות: הטקסט על המסך הוא ההסבר. הקוד ב־test קובע כשהתסריט סותר אותו (ר' הדוח).
import { CLOCK, DAY, CLIENTS, users, item, sketch, order, SKUS } from '../lib/seedlib.js';

export const meta = { id: '01', file: '01 - קליטת הזמנה ושרטט', title: 'קליטת הזמנה ושרטט', viewport: { w: 1600, h: 900 } };

const PRICES = { '8SMH': 310, '10SMH': 360, '6SMH': 260, '8HMH': 340, '8SL': 290, '6SL': 240, 'M4': 220 };

export function seed() {
  const G = CLIENTS.galil, S = CLIENTS.sharon, D = CLIENTS.david;
  const today = (h, m) => ({ date: '12.10.2026', time: h, createdAt: CLOCK - m * 60e3, updatedAt: CLOCK - m * 60e3 });
  const wa = { source: 'whatsapp', waPage: 1, waPages: 1 };
  // "לא מזוהה" — מספר שאין לו משתמש במערכת, ולכן גם אין לו כרטיס בחשבשבת
  const UNKNOWN = { phone: '0530000199', name: 'לא מזוהה · 053-0000199' };
  // פריט שנכנס בקוד ישן: נראה רגיל, אבל אין עליו sku
  const noSku = { name: '8 מ"מ שקוף מחוסם', glassFullName: '8 מ"מ שקוף מחוסם', glass: 'שקוף', mm: 8, w: 900, h: 2100, qty: 1, chisum: true, litush: false };

  const orders = {
    sub_9101_0: order('sub_9101_0', 'L9101', 'galil', { ...today('08:10', 150), hasSketch: true, sketchName: '', customerId: '14300',
      notes: 'דלת נפתחת ימינה, ידית עגולה' }),
    sub_9102_0: order('sub_9102_0', 'L9102', 'david', { ...today('08:25', 135), hasSketch: true, sketchName: '' }),
    sub_9103_0: order('sub_9103_0', 'L9103', 'david', { ...today('08:40', 120), type: 'measure', sketchName: 'מראה לאמבטיה',
      items: [item('M4', 600, 800)] }),
    wa_9104_1: order('wa_9104_1', 'L9104', 'sharon', { ...today('08:55', 105), ...wa, hasSketch: true, sketchName: '', customerId: '14301' }),
    wa_9105_1: order('wa_9105_1', 'L9105', 'sharon', { ...today('08:56', 104), ...wa, hasSketch: true, sketchName: '', customerId: '14301' }),
    wa_9106_1: order('wa_9106_1', 'L9106', UNKNOWN, { ...today('09:05', 95), ...wa, waUnassigned: true, hasSketch: true,
      sketchName: 'ויטרינה', sketchSeenAt: CLOCK - 80 * 60e3, items: [item('8SL', 1200, 900)] }),
    sub_9107_0: order('sub_9107_0', 'L9107', 'david', { ...today('09:20', 80), hasSketch: true, sketchName: 'מחיצת מקלחת',
      sketchSeenAt: CLOCK - 70 * 60e3, items: [item('10SMH', 900, 1950), item('10SMH', 400, 1950)] }),
    sub_9108_0: order('sub_9108_0', 'L9108', 'david', { ...today('09:40', 60), hasSketch: true, sketchName: 'דלת זכוכית למשרד',
      sketchSeenAt: CLOCK - 50 * 60e3, items: [noSku, item('8SMH', 400, 2100)] }),
    // כבר אצל השרטט / אחריו
    ord_9095: order('ord_9095', 'L9095', 'david', { date: '11.10.2026', stage: 'chash', status: 'אצל שרטט', hasSketch: true,
      sketchName: 'חלון ראווה', sketchSeenAt: CLOCK - DAY, items: [item('8SL', 1500, 1100)] }),
    ord_9096: order('ord_9096', 'L9096', 'sharon', { date: '11.10.2026', stage: 'chash', status: 'אצל שרטט', hasSketch: true,
      sketchName: 'מקלחון ניקוי', sketchSeenAt: CLOCK - DAY, items: [item('8SMH', 700, 1900), item('8SMH', 500, 1900)] }),
    ord_9090: order('ord_9090', 'L9090', 'david', { date: '11.10.2026', stage: 'opty', status: 'מחכה ל-OptyWay', hasSketch: true,
      sketchName: 'מראה כניסה', sketchSeenAt: CLOCK - DAY, items: [item('M4', 800, 1600)] }),
  };
  const sk = (title, client, num, panes) => sketch({ title, client, num, panes });
  const sketches = {
    sub_9101_0: sk('מקלחון — דלת + קבוע', G.name, 'L9101', [{ w: 800, h: 2000, n: 1, label: 'דלת' }, { w: 600, h: 2000, n: 2, label: 'קבוע' }]),
    sub_9102_0: sk('מחיצה למטבח', D.name, 'L9102', [{ w: 1400, h: 600, n: 1 }]),
    wa_9104_1: sk('מקלחון חזית', S.name, 'L9104', [{ w: 900, h: 1950, n: 1 }, { w: 450, h: 1950, n: 2 }]),
    wa_9105_1: sk('מקלחון פינתי', S.name, 'L9105', [{ w: 800, h: 1950, n: 1 }, { w: 700, h: 1950, n: 2 }]),
    wa_9106_1: sk('ויטרינה', UNKNOWN.name, 'L9106', [{ w: 1200, h: 900, n: 1 }]),
    sub_9107_0: sk('מחיצת מקלחת', D.name, 'L9107', [{ w: 900, h: 1950, n: 1 }, { w: 400, h: 1950, n: 2 }]),
    sub_9108_0: sk('דלת זכוכית למשרד', D.name, 'L9108', [{ w: 900, h: 2100, n: 1, label: 'דלת' }, { w: 400, h: 2100, n: 2 }]),
    ord_9095: sk('חלון ראווה', D.name, 'L9095', [{ w: 1500, h: 1100, n: 1 }]),
    ord_9096: sk('מקלחון ניקוי', S.name, 'L9096', [{ w: 700, h: 1900, n: 1 }, { w: 500, h: 1900, n: 2 }]),
    ord_9090: sk('מראה כניסה', D.name, 'L9090', [{ w: 800, h: 1600, n: 1, mirror: true }]),
  };
  return {
    __clock: CLOCK, __session: '0500000000',
    // נקבע מחדש לפני כל לחיצה (hsAnswer למטה), לפי מה שבאמת יש בהזמנה באותו רגע
    __api: { 'hashavshevet-order': { ok: true }, 'whatsapp-dispatch': { queued: true, clientName: S.name } },
    db: { users: users({ worker: 'נועה' }), orders, sketches, skuCatalog: SKUS, prices: { global: PRICES }, meta: { orderCounter: 9110 } },
  };
}

// התשובה של api/hashavshevet-order.js, בנויה מהנתונים שבהזמנה כרגע — אותם כללים כמו buildLines בשרת:
// אין מפתח חשבון → 422 עם hint; פריט בלי sku / בלי מחיר → skipped; אין אף שורה → "אין אף פריט לשליחה".
// (ב־/api המדומה הסטטוס תמיד 200; המסך מציג "לא נשלח" לפי data.error, בדיוק כמו ב־422.)
function hsAnswer(id, dry) {
  const st = window.__store, o = st.orders[id];
  const phone = String(o.clientPhone || o.phone || '').replace(/[-\s]/g, '');
  const u = (st.users || {})[phone];
  const accountKey = u && u.customerId;
  const reference = String(Number(String(o.orderNum).replace(/\D/g, '')));
  let ans;
  if (!accountKey) {
    ans = { error: `ללקוח ${o.orderClient || phone} אין מפתח חשבון (customerId) במערכת`, hint: 'סנכרן לקוחות מחשבשבת, או הגדר מפתח חשבון בניהול משתמשים' };
  } else {
    const gp = (st.prices || {}).global || {};
    const preview = [], skipped = [];
    const items = Array.isArray(o.items) ? o.items : Object.values(o.items || {});
    items.forEach((it, i) => {
      const name = it.glassFullName || it.name || `פריט ${i + 1}`;
      if (!it.sku) { skipped.push({ name, reason: 'אין מק"ט (sku) על הפריט' }); return; }
      const qty = Math.round((it.w || 0) * (it.h || 0) / 1000) / 1000;
      const ppm2 = parseFloat(gp[it.sku] || 0);
      if (!ppm2) { skipped.push({ name, sku: it.sku, reason: 'אין מחיר למק"ט הזה — לא במחירון הלקוח ולא בגלובלי' }); return; }
      const n = preview.length + 1;
      preview.push({ name, sku: it.sku, qty: qty.toFixed(3), ppm2, hsLine: n, text: n + ') ' + Math.round(it.w) + 'x' + Math.round(it.h) });
    });
    if (!preview.length) ans = { error: 'אין אף פריט לשליחה', skipped };
    else if (dry) ans = { ok: true, dryRun: true, isTest: false, reference, accountKey, documentId: '31', documentName: "הזמ' סוכן", agent: '1',
      lineCount: preview.length, lines: [], preview, skipped };
    else ans = { ok: true, dryRun: false, simulated: false, reference, accountKey, lineCount: preview.length, skipped, warn: null,
      response: { apiRes: { status: 'ok' }, actionType: 'imovein', messType: 'apiReplay' } };
  }
  window.__LG_SEED.__api['hashavshevet-order'] = ans;
}

export async function script(r) {
  const row = num => ({ sel: '#sqList .sq-item', text: num });
  const toast = '#_lgToast';
  const greenToast = { sel: 'body > div', text: 'נשלח לחשבשבת' };
  const hb = '#sqHbOv .modal';

  r.card({ kind: 'title', title: 'קליטת הזמנה ושרטט', sub: 'עובד המשרד בתור הסקיצות · השרטט',
    bullets: ['מאיפה הזמנה מגיעה אלינו', 'תור הסקיצות: בדיקה, שם, פריטים — ו**"📋 הועבר לחשבשבת"**', 'תחנת השרטט: מסיימים ומעבירים ל־**OptyWay**'] });

  // ── איך הזמנה מגיעה
  r.chapter('איך הזמנה מגיעה אלינו');
  r.state().__session = CLIENTS.galil.phone;          // הפורטל — כפי שהלקוח רואה אותו
  await r.open('new-order.html', { wait: '.order-card' });
  await r.show({ focus: '.cards', mark: '.order-card', who: null, chip: { kind: 'you', t: '👤 הלקוח, בפורטל' },
    text: 'דרך 1 · הלקוח ממלא בפורטל **"הזמנת זכוכית לפי מידה"**: סוג זכוכית ומידות.' });
  await r.open('upload.html', { wait: '#dropZone' });
  await r.show({ focus: '#formPage', mark: ['#dropZone', '#submitBtn'], chip: { kind: 'you', t: '👤 הלקוח, בפורטל' },
    text: 'דרך 2 · **"העלאת סקיצה"**: הלקוח מצלם שרטוט ביד, מוסיף הערות ולוחץ **"שלח סקיצה ←"**.' });
  r.card({ panel: true, kicker: '⚙ המערכת עושה את זה לבד', title: 'דרך 3 · **WhatsApp**',
    sub: 'הלקוח שולח תמונה של שרטוט בוואטסאפ. המערכת קולטת אותה ופותחת הזמנה **לבד**.',
    box: { kind: 'info', text: 'שלוש הדרכים מגיעות לאותו מקום: **תור הסקיצות**. התגית על כל הזמנה אומרת מאיפה היא באה: "העלאה", "WhatsApp" או "מערכת".' } });
  r.state().__session = '0500000000';

  // ── סיור במסך
  r.chapter('סיור במסך');
  await r.open('admin.html', { wait: '#stats .stat-link' });
  await r.show({ wide: true, text: 'זה המסך הראשי של המשרד. בשורת הכרטיסים למעלה יש קיצור דרך לתור הסקיצות.', hold: 4 });
  await r.click({ target: { sel: '#stats .stat-link', text: 'תור סקיצות' }, focus: '#stats',
    text: 'בכרטיס **"תור סקיצות"** רואים כמה הזמנות בתור, ומתחת: כמה **"עוד לא נראו"**. לוחצים עליו.',
    after: 'התור נפתח: מימין רשימת ההזמנות, משמאל ההזמנה שבחרת.', afterFocus: null });
  await r.show({ focus: '#sqListPanel', mark: '#sqList',
    text: 'כל שורה היא הזמנה: הלקוח, שם הסקיצה ומספר ההזמנה. סקיצה בלי שם מסומנת **"ללא שם"**.' });
  await r.show({ focus: ['#sqListPanel', '#sqTopBar'], mark: { sel: '#sqList .sq-tag', text: 'WhatsApp' }, who: 'system',
    text: 'התגית אומרת מאיפה ההזמנה הגיעה. כאן — **WhatsApp**: המערכת קלטה את התמונה ופתחה הזמנה לבד.' });
  await r.show({ focus: '#sqTopBar', mark: '.sq-seen-tabs',
    text: 'שתי לשוניות: **"עוד לא נראה"** — הזמנות שאף אחד עוד לא בדק. **"נראה"** — נבדקו, ושם מכניסים פריטים.' });
  await r.show({ focus: '#sqTopBar', mark: '#waInBtn',
    text: 'בכפתור **"קליטות"** מופיעות הודעות וואטסאפ שלא הפכו להזמנה תקינה, או שצריכות עין.' });

  // ── הדגמה: בדיקה ראשונה
  r.chapter('בדיקה ראשונה של סקיצה');
  await r.click({ target: row('L9101'), focus: '#sqListPanel',
    text: 'הגיעה הזמנה מ**זגגות הגליל**, עדיין "ללא שם". לוחצים עליה.',
    after: 'הסקיצה נפתחת. בודקים שהיא **ברורה** ושייכת **ללקוח הנכון**.', afterFocus: '#sqDetailPanel', afterMark: ['#sqDClient', '#sqImgWrap'] });
  await r.show({ focus: '#sqDetailPanel', mark: '#sqNameWrap',
    text: 'לסקיצה עוד אין שם, ולכן השדה **"שם הסקיצה"** מסומן. השם ילווה את ההזמנה בכל המפעל.' });
  await r.type({ target: '#sqNameInput', value: 'מקלחון חדר הורים', focus: '#sqNameWrap', text: 'מקלידים שם קצר וברור…' });
  await r.node(p => p.keyboard.press('Enter'));
  await r.sleep(500);
  await r.show({ focus: ['#sqListPanel', '#sqNameWrap'], mark: [row('L9101'), '#sqNameInput'],
    text: '…ולוחצים **Enter**. השם נשמר, והוא מופיע עכשיו גם בשורה ברשימה.', hold: 3.6 });
  await r.click({ target: '#sqBtnSeen', focus: ['#sqActions', '#sqTopBar'],
    text: 'הכול תקין? לוחצים **"✓ סקיצה טופלה"**.',
    after: 'ההזמנה עברה ללשונית **"נראה"** (המונה עלה ב־1). היא **עדיין בתור** — רק עברה שלב.',
    afterMark: ['.sq-seen-tabs', toast], afterFocus: ['#sqTopBar', '#sqListPanel'], afterChip: { kind: 'system', t: '⚙ עברה ל"נראה" לבד' } });

  // ── הכנסת פריטים
  r.chapter('הכנסת פריטים');
  await r.click({ target: '#sqTabSeen', focus: '#sqTopBar', text: 'עוברים ללשונית **"נראה"**.', hold: 2.6 });
  await r.click({ target: row('L9101'), focus: '#sqListPanel', text: 'ופותחים שוב את ההזמנה של זגגות הגליל.',
    after: 'בלשונית "נראה" מופיע **מסך העבודה המלא**: שטח, סכום, ואזור **"פריטים"**.', afterFocus: '#sqDetailPanel', afterMark: ['#sqInfoGrid', '#sqItemsWrap'] });
  await r.show({ focus: '#sqDetailPanel', mark: '#sqNotesWrap',
    text: 'למטה, ב**"הערות"**, מופיע מה שהלקוח כתב: "דלת נפתחת ימינה, ידית עגולה".', hold: 4 });
  await r.type({ target: '#iwCode', value: '8 שקוף חיסום', focus: '#sqItemsWrap',
    text: 'בשדה הקוד כותבים **בעברית** — למשל "8 שקוף חיסום" — או את הקוד עצמו.' });
  await r.click({ target: { sel: '#iwSkuList .sku-opt', text: '8SMH' }, focus: '#sqItemsWrap',
    text: 'נפתחת רשימת מק"טים מתאימים. בוחרים **8 מ"מ שקוף מחוסם · 8SMH**.',
    after: 'הקוד נכנס לשדה, והסמן עבר לרוחב.', afterMark: ['#iwCode', '#iwPreview'] });
  await r.type({ target: '#iwW', value: '80', focus: '#sqItemsWrap', text: 'רוחב: **80**.' });
  await r.type({ target: '#iwH', value: '200', focus: '#sqItemsWrap', text: 'גובה: **200**.' });
  await r.show({ focus: '#sqItemsWrap', mark: ['#iwWPrev', '#iwHPrev'], chip: { kind: 'warn', t: '⚠ מספר עד 300 = סנטימטרים' },
    text: 'המספר הזהוב מראה איך המערכת הבינה: **800 מ"מ** ו־**2000 מ"מ**. מספר עד 300 נחשב סנטימטרים. בודקים אותו תמיד.' });
  await r.click({ target: '.iw-add', focus: ['#sqItemsWrap', '#sqInfoGrid'], text: 'לוחצים **"+ הוסף"**.',
    after: 'הפריט נכנס לרשימה ו**נשמר לבד**. השטח והסכום מתעדכנים.', afterMark: ['#iwList', '#sqInfoGrid'],
    afterChip: { kind: 'system', t: '⚙ נשמר וחושב לבד' } });
  await r.click({ target: { sel: '#iwSkuList .sku-opt', text: '8SMH' }, focus: '#sqItemsWrap',
    text: 'הפריט השני: בשדה הריק מופיעים **המק"טים האחרונים**. בוחרים שוב 8SMH.', hold: 3.4 });
  await r.type({ target: '#iwW', value: '60', focus: '#sqItemsWrap', text: 'רוחב 60…' });
  await r.type({ target: '#iwH', value: '200', focus: '#sqItemsWrap', text: '…גובה 200.' });
  await r.click({ target: '.iw-add', focus: ['#sqItemsWrap', '#sqInfoGrid'], text: '"+ הוסף".', hold: 2,
    after: 'שני פריטים. ברשימה המידות מוצגות **במטרים**: 0.8 × 2 ו־0.6 × 2. השטח: 2.8 מ"ר.', afterMark: ['#iwList', '#sqInfoGrid'] });

  // ── העברה לחשבשבת
  r.chapter('העברה לחשבשבת');
  await r.exec(hsAnswer, 'sub_9101_0', true);
  await r.click({ target: '#sqBtnPreview', focus: '#sqActions',
    text: 'לפני השליחה בודקים: **"הצג מה יישלח"**. שום דבר לא נשלח בלחיצה הזו.',
    after: '**"תצוגה מקדימה — טרם נשלח"**: כל שורה בדיוק כמו שתיכנס לחשבשבת — מק"ט, כמות במ"ר ומחיר למ"ר.',
    afterMark: hb, afterFocus: hb });
  await r.show({ focus: hb, mark: { sel: hb + ' .mgrid .mf', text: 'סוג מסמך' },
    text: 'סוג המסמך: **הזמנת סוכן** (31). האסמכתא היא מספר ההזמנה, 9101.' });
  await r.click({ target: { sel: hb + ' button', text: 'ביטול' }, focus: hb, text: 'הכול נכון. סוגרים ב**"ביטול"**.', hold: 2.4 });
  await r.exec(hsAnswer, 'sub_9101_0', false);
  await r.click({ target: '#sqBtnChash', focus: '#sqActions', chip: { kind: 'warn', t: '⚠ אין חלון אישור' },
    text: 'לוחצים **"📋 הועבר לחשבשבת"**. אין חלון אישור — ולכן בודקים **לפני**.',
    after: 'המערכת **פתחה לבד הזמנת סוכן בחשבשבת**, והעבירה את ההזמנה לשרטט ("אצל שרטט"). בהודעה הירוקה — מספר האסמכתא.',
    afterMark: greenToast, afterFocus: null, afterChip: { kind: 'system', t: '⚙ המערכת עשתה את זה לבד' } });
  await r.show({ wide: true, mark: '#sqDetailPanel', who: 'system',
    text: 'L9101 יצאה מהתור, והמסך **עבר לבד** להזמנה הבאה.', hold: 3.4 });

  // ── תחנת שרטט
  r.chapter('תחנת שרטט');
  await r.open('drafter.html', { wait: '#sbList .sb-item' });
  // L9101 is first in the queue and carries the client's note — the drafter opens it with the note on top
  await r.show({ focus: '#drNotePopup > div', mark: '#drNotePopup > div', who: 'system',
    text: 'זו **"תחנת שרטט"**. ההזמנה הראשונה בתור נפתחת לבד — ואם הלקוח כתב **הערה**, היא קופצת מיד: **"💬 הערה על ההזמנה"**.' });
  await r.click({ target: '#drNotePopup button', focus: '#drNotePopup > div', text: 'קוראים את ההערה ולוחצים **"הבנתי"**.',
    after: 'מאחורי ההערה — הסקיצה של **זגגות הגליל**, ולמעלה הפריטים שהוכנסו בתור.', afterFocus: '.sketch-area', afterMark: ['#sketchMeta'] });
  await r.show({ focus: '.sidebar', mark: '.sidebar',
    text: 'מימין — **"סקיצות בתור"**: כל ההזמנות שנשלחו לחשבשבת ומחכות לשרטט. לוחצים על הזמנה כדי לפתוח אותה.' });
  await r.show({ focus: '.sketch-area', mark: '.btn-edit',
    text: 'ב**"✏️ עריכה"** אפשר לצייר ולכתוב על הסקיצה. הסימון נשמר ומוצג בתחנת השרטט.' });
  await r.click({ target: '.btn-finish', focus: '.sketch-area',
    text: 'כשהשרטוט גמור לוחצים **"✓ סיים סקיצה — שלח ל-OptyWay"**.',
    after: 'ההזמנה עברה **לבד** ל**"מחכה ל-OptyWay"**, והסקיצה הבאה נטענת.', afterMark: '#doneBanner', afterFocus: '.sketch-area',
    afterChip: { kind: 'system', t: '⚙ המערכת עשתה את זה לבד' } });
  await r.show({ wide: true, mark: '.sidebar', text: 'L9101 יצאה מהתור של השרטט. נשארו ההזמנות הבאות.', hold: 3 });

  // ── כשמשהו לא רגיל
  r.chapter('כשמשהו לא רגיל');
  await r.open('admin.html', { wait: '#stats .stat-link' });
  await r.exec(() => { openSketchQueue(); sqSetSeenTab('seen'); });

  // מקרה 1 — פריט בלי מק"ט
  await r.click({ target: row('L9108'), focus: '#sqListPanel', chip: { kind: 'warn', t: 'מקרה 1' },
    text: '**מקרה 1: פריט בלי מק"ט.** אלומיניום דוד, L9108. שני הפריטים נראים רגיל.', hold: 4,
    after: 'הפריט הראשון נכנס בקוד ישן, ולא נבחר מהרשימה. על המסך אי אפשר לראות את זה.', afterFocus: '#sqDetailPanel', afterMark: '#iwList' });
  await r.exec(hsAnswer, 'sub_9108_0', true);
  await r.click({ target: '#sqBtnPreview', focus: '#sqActions', text: 'לוחצים **"הצג מה יישלח"**.', hold: 2.4,
    after: 'תחת **"לא ייכללו (1)"**, באדום: אין מק"ט על הפריט. **הוא לא ייכנס לחשבשבת.**',
    afterMark: { sel: hb + ' .sec-title', text: 'לא ייכללו' }, afterFocus: hb, afterChip: { kind: 'warn', t: '⚠ פריט בלי מק״ט לא נכנס לחשבשבת' } });
  await r.click({ target: { sel: hb + ' button', text: 'ביטול' }, focus: hb, text: '"ביטול".', hold: 1.8 });
  await r.click({ target: { sel: '#iwList .iw-item-del', nth: 0 }, focus: '#sqItemsWrap',
    text: 'מוחקים את הפריט ב**✕**…', hold: 2.4, after: '…ומוסיפים אותו מחדש **מהרשימה**.', afterMark: '#iwList' });
  await r.type({ target: '#iwCode', value: '8 שקוף', focus: '#sqItemsWrap', text: '"8 שקוף"…' });
  await r.click({ target: { sel: '#iwSkuList .sku-opt', text: '8SMH' }, focus: '#sqItemsWrap', text: '…8SMH…', hold: 1.8 });
  await r.type({ target: '#iwW', value: '90', focus: '#sqItemsWrap', text: '90…' });
  await r.type({ target: '#iwH', value: '210', focus: '#sqItemsWrap', text: '…210.' });
  await r.click({ target: '.iw-add', focus: '#sqItemsWrap', text: '"+ הוסף".', hold: 1.8 });
  await r.exec(hsAnswer, 'sub_9108_0', true);
  await r.click({ target: '#sqBtnPreview', focus: '#sqActions', text: 'בודקים שוב.', hold: 1.8,
    after: 'עכשיו **שתי השורות** ייכנסו לחשבשבת, ואין "לא ייכללו".', afterMark: hb + ' table', afterFocus: hb });
  await r.exec(() => _sqHbClose());

  // מקרה 2 — "לא נשלח"
  await r.click({ target: row('L9106'), focus: '#sqListPanel', chip: { kind: 'warn', t: 'מקרה 2' },
    text: '**מקרה 2: "לא נשלח".** ההזמנה הגיעה בוואטסאפ ממספר **לא מזוהה**.', hold: 3.6, afterFocus: '#sqDetailPanel' });
  await r.exec(hsAnswer, 'wa_9106_1', false);
  await r.click({ target: '#sqBtnChash', focus: '#sqActions', text: 'לוחצים **"📋 הועבר לחשבשבת"**…', hold: 2.4,
    after: '…ונפתח החלון **"לא נשלח"**: ללקוח **אין כרטיס בחשבשבת**, ולכן לא נפתח שם כלום.',
    afterMark: hb, afterFocus: hb, afterChip: { kind: 'warn', t: '⚠ לא נפתח כלום בחשבשבת' } });
  await r.show({ focus: hb, mark: { sel: hb + ' button', text: 'נסה שוב' }, chip: { kind: 'warn', t: '⚠ ההזמנה כבר אצל השרטט' },
    text: 'שימו לב: ההזמנה **כבר עברה לשרטט** ויצאה מהתור. סוגרים את החלון — ואין ממנו "נסה שוב". לכן **לא סוגרים**: פונים למנהל.' });
  await r.show({ focus: hb, mark: { sel: hb + ' button', text: 'נסה שוב' },
    text: 'המנהל מגדיר ללקוח מפתח חשבון. אחרי התיקון לוחצים **"נסה שוב"**.', hold: 4 });
  await r.exec(() => { _sqHbClose(); sqSetSeenTab('unseen'); });

  // מקרה 3 — כמה סקיצות WhatsApp מאותו לקוח
  await r.click({ target: row('L9104'), focus: '#sqListPanel', chip: { kind: 'warn', t: 'מקרה 3' },
    text: '**מקרה 3: כמה סקיצות WhatsApp מאותו לקוח.** למקלחוני השרון יש שתיים בתור: L9104 ו־L9105.', hold: 4.5, afterFocus: '#sqDetailPanel' });
  await r.click({ target: '#sqBtnSeen', focus: '#sqActions',
    text: 'בסקיצה מוואטסאפ, **"✓ סקיצה טופלה"** גם שולח ללקוח הודעה שהיא טופלה.',
    after: 'יש ללקוח עוד סקיצה בתור, ולכן המערכת **שואלת**: לטפל בה עכשיו, כדי שתישלח הודעה אחת על הכול?',
    afterMark: '#sqAckAsk .sqack-box', afterFocus: '#sqAckAsk .sqack-box', afterChip: { kind: 'system', t: '⚙ המערכת שואלת לבד' } });
  await r.click({ target: '#sqAckYes', focus: '#sqAckAsk .sqack-box', text: 'עונים **"כן, נטפל עכשיו"**.',
    after: 'נפתחה לבד **L9105**, הסקיצה השנייה של אותו לקוח.', afterMark: '#sqDClient', afterFocus: '#sqDetailPanel' });
  await r.click({ target: '#sqBtnSeen', focus: '#sqActions', text: 'בודקים אותה ומסמנים **"✓ סקיצה טופלה"**.', hold: 3,
    after: 'עכשיו נשלחת ללקוח **הודעה אחת** על שתי הסקיצות.', afterMark: toast, afterFocus: null,
    afterChip: { kind: 'system', t: '⚙ ההודעה נשלחה לבד' } });
  await r.show({ focus: '#sqListPanel', mark: '.sqack-row', chip: { kind: 'warn', t: '⚠ לקוח לא מזוהה: אין הודעה' },
    text: 'ובראש הרשימה: הלקוח הלא מזוהה ממקרה 2 — **"לא משויך — אין למי לשלוח"**. לו לא נשלחת הודעה.' });

  // מקרה 4 — Enter בתחנת השרטט
  await r.open('drafter.html', { wait: '#sbList .sb-item' });
  await r.show({ focus: '.btm-bar', mark: '.btn-finish', chip: { kind: 'warn', t: '⚠ Enter = סיים סקיצה' },
    text: '**מקרה 4: בתחנת השרטט, מקש Enter** שווה ל"סיים סקיצה" — בלי חלון אישור ובלי דרך חזרה.' });
  await r.click({ target: '.btn-skip', focus: '.btm-bar', text: 'רוצים לעבור הזמנה **בלי** לסיים? לוחצים **"דלג ←"**.',
    after: 'נפתחה ההזמנה הבאה. הקודמת נשארה בתור.', afterFocus: null, afterMark: ['.sidebar', '#sketchMeta'] });

  // ── סיכום
  r.chapter('סיכום');
  r.card({ title: 'סיכום · קליטת הזמנה ושרטט', bullets: [
    'הזמנה מגיעה מהפורטל, מהעלאת סקיצה או מ־WhatsApp — **לתור הסקיצות**',
    '"עוד לא נראה": בודקים, נותנים **שם**, ולוחצים **"✓ סקיצה טופלה"**',
    '"נראה": מכניסים פריטים **מרשימת המק"טים** · בודקים ב"הצג מה יישלח"',
    '**"📋 הועבר לחשבשבת"** פותח הזמנת סוכן ומעביר לשרטט',
    'השרטט לוחץ **"✓ סיים סקיצה — שלח ל-OptyWay"**',
  ], flow: [{ t: 'פורטל / העלאה / WhatsApp' }, { t: 'עוד לא נראה' }, { t: 'נראה' }, { t: '📋 חשבשבת' }, { t: 'שרטט' }, { t: 'מחכה ל-OptyWay', hot: true }] });
}
