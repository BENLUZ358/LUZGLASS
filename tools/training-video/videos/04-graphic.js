// סרטון 04 — תחנת הגרפיקה (גרפיקה וחלבי). התסריט: docs/training-videos/scripts/04-05-graphic-delivery.md
// workday.html, הטאב "גרפיקה". מנוע התצוגה: LG_STAGE_VIEW.graphic + completeGraphic (workday.html).
import { CLOCK, DAY, CLIENTS, users, item, sketch, order, SKUS } from '../lib/seedlib.js';

export const meta = { id: '04', file: '04 - גרפיקה', title: 'תחנת הגרפיקה', viewport: { w: 1180, h: 820 } };

// פריט גרפיקה כפי שהוא נשמר (השמות מ-LG_SKU_MAP באדמין)
const G_NAMES = { '8SGM': '8מ"מ שקוף גרפיקה מלוטש', '10SGMH': '10מ"מ שקוף גרפיקה מחוסם' };
const gItem = (sku, w, h, extra = {}) => ({ sku, name: G_NAMES[sku], glassFullName: G_NAMES[sku], glass: 'שקוף',
  mm: parseInt(sku, 10), w, h, qty: 1, graphic: true, chisum: /H$/.test(sku), litush: !/H$/.test(sku), ...extra });

export function seed() {
  const G = CLIENTS.galil.name, S = CLIENTS.sharon.name;
  const I = {
    g9101: [gItem('8SGM', 800, 1900), gItem('8SGM', 600, 1900), item('8SL', 400, 1900)],   // the 3rd is plain glass
    g9102: [gItem('10SGMH', 900, 2000)],
    g9103: [item('8HMH', 700, 1800, { chalavi: true })],
  };
  const inGraphic = { stage: 'graphic', status: 'בגרפיקה', date: '12.10.2026' };
  const orders = {
    g9101: order('g9101', 'L9101', 'galil', { ...inGraphic, sketchName: 'מקלחון עם גרפיקה', items: I.g9101, hasSketch: true, createdAt: CLOCK - 3 * DAY }),
    g9102: order('g9102', 'L9102', 'sharon', { ...inGraphic, sketchName: 'דלת מקלחון', items: I.g9102, hasSketch: true, createdAt: CLOCK - 2 * DAY }),
    g9103: order('g9103', 'L9103', 'david', { ...inGraphic, sketchName: 'חלון אמבטיה', items: I.g9103, hasSketch: false, createdAt: CLOCK - DAY }),
  };
  const sketches = {
    g9101: sketch({ title: 'מקלחון עם גרפיקה', client: G, num: 'L9101',
      panes: [{ w: 800, h: 1900, n: 1, label: 'גרפיקה' }, { w: 600, h: 1900, n: 2, label: 'גרפיקה' }, { w: 400, h: 1900, n: 3, label: 'שקוף' }] }),
    g9102: sketch({ title: 'דלת מקלחון', client: S, num: 'L9102', panes: [{ w: 900, h: 2000, n: 1, label: 'גרפיקה' }] }),
  };
  return { __clock: CLOCK, __session: '0500000000',
    db: { users: users({ worker: 'נועה' }), orders, sketches, skuCatalog: SKUS,
          prices: { global: { '8SGM': 420, '10SGMH': 560, '8HMH': 380, '8SL': 300 } },
          workday: { date: '12.10.2026', selected: [], inWork: [], inChisum: [] }, meta: { orderCounter: 9400 } } };
}

export async function script(r) {
  const card = id => `.stv-card:has([data-sketch-for="${id}"], [onclick*="'${id}'"])`;
  const toast = '#toast';

  r.card({ kind: 'title', title: 'תחנת הגרפיקה', sub: 'עובד גרפיקה והתזת חול (חלבי) · יום עבודה ← "גרפיקה"',
    bullets: ['אילו הזמנות מגיעות אליך', 'איך רואים מה לעשות בכל הזמנה', 'איך מסיימים ולאן ההזמנה ממשיכה'] });

  // ── ב. סיור במסך
  r.chapter('סיור במסך');
  await r.open('workday.html', { wait: '#tab-graphic' });
  await r.click({ target: '#tab-graphic', focus: '.phase-tabs',
    text: 'במסך יום העבודה לוחצים על הטאב **"גרפיקה"**. המספר הירוק על הטאב = כמה הזמנות מחכות לך עכשיו.',
    after: 'זו הרשימה: **"🖼 הזמנות בגרפיקה"**. כל כרטיס הוא לקוח אחד.', afterMark: '#view-graphic', afterFocus: '#view-graphic' });
  await r.show({ focus: card('g9101'), mark: [`${card('g9101')} .stv-sub`, `${card('g9101')} .stv-chip`],
    text: 'מתחת לשם הלקוח: כמה **פריטי גרפיקה** יש לו, ובכמה הזמנות. ללקוח עם כמה הזמנות בגרפיקה — כולן באותו כרטיס.' });
  r.card({ panel: true, kicker: '⚙ המערכת עושה את זה לבד', title: 'איך הזמנה מגיעה לגרפיקה?',
    sub: 'לא מעבירים לכאן הזמנות ביד. הזמנה שיש בה פריט **גרפיקה** או **חלבי** מגיעה לכאן **לבד**, כשהחיתוך ביום העבודה — או החיסום — שלה הסתיים.',
    flow: [{ t: 'יום עבודה' }, { t: 'חיסום (אם יש)' }, { t: 'גרפיקה', hot: true }] });

  // ── ג. הדגמה מלאה
  r.chapter('הדגמה: זגגות הגליל');
  await r.click({ target: `${card('g9101')} summary`, focus: card('g9101'),
    text: 'כדי לראות את העבודה, לוחצים על **"פירוט"**.',
    after: 'נפתחת ההזמנה **L9101**: פריטי הגרפיקה, כל אחד עם המידות שלו.', afterMark: `${card('g9101')} .stv-items`, afterFocus: card('g9101') });
  await r.show({ focus: card('g9101'), mark: `${card('g9101')} .stv-ord-top`, chip: { kind: 'system', t: '⚙ מוצגים רק פריטי הגרפיקה' },
    text: 'שימו לב: בהזמנה יש גם זכוכית **שקופה רגילה** (400 × 1900). היא **לא מופיעה** כאן — היא לא העבודה של התחנה.' });
  await r.show({ focus: card('g9101'), mark: `${card('g9101')} img.stv-sk.is-loaded`,
    text: 'מתחת לפריטים — **הסקיצה** של הלקוח. לפיה בודקים איפה הגרפיקה ובאיזו צורה.' });
  await r.click({ target: `${card('g9101')} img.stv-sk.is-loaded`, focus: card('g9101'),
    text: 'לוחצים על הסקיצה כדי לראות אותה **בגדול**.',
    after: 'הסקיצה על כל המסך. לחיצה נוספת — בכל מקום — סוגרת אותה.', afterFocus: null });
  await r.click({ target: '[style*="zoom-out"]', text: 'סוגרים.', hold: 2.2 });
  await r.show({ focus: card('g9101'), mark: `button[onclick*="completeGraphic('g9101')"]`,
    text: 'סיימת את העבודה על **כל** הפריטים? הכפתור הירוק אומר לאן ההזמנה תלך: **"✅ גרפיקה הושלמה — מוכן לאיסוף"**.' });
  await r.click({ target: `button[onclick*="completeGraphic('g9101')"]`, focus: card('g9101'),
    chip: { kind: 'warn', t: '⚠ אין חלון אישור — הלחיצה מבצעת מיד' },
    text: 'לוחצים רק כשהעבודה **גמורה**: אין חלון "בטוח?", והלחיצה מבצעת מיד.',
    after: 'ההזמנה עברה ל**"מוכן לאיסוף"** ויצאה מהרשימה שלך. המספר על הטאב ירד.',
    afterMark: [toast, '#cnt-graphic'], afterFocus: null });
  await r.sleep(900);   // the page sends the customer message 1.2s after the click
  await r.show({ wide: true, mark: toast, who: 'system',
    text: 'ובאותו רגע המערכת עשתה **לבד** שני דברים: **נעלה את המחיר** של ההזמנה, והכניסה לתור השליחה **הודעה ללקוח** שההזמנה מוכנה לאיסוף.', hold: 6 });
  r.card({ panel: true, kicker: 'לחצת בטעות?', title: 'פונים **מיד** למנהל',
    sub: 'רק המנהל יכול להחזיר הזמנה לשלב קודם. שימו לב: המחיר כבר ננעל, וההודעה ללקוח כבר בדרך.' });

  // ── ד. כשמשהו לא רגיל
  r.chapter('כשמשהו לא רגיל');
  await r.click({ target: `${card('g9102')} summary`, focus: card('g9102'),
    text: '**מקרה 1: לקוח הובלות.** מקלחוני השרון — לקוח שאנחנו מביאים אליו את הסחורה. פותחים "פירוט".',
    after: 'כאן הכפתור **כחול**: **"🚚 העבר להובלה"**.', afterMark: `button[onclick*="completeGraphic('g9102')"]`, afterFocus: card('g9102'),
    afterChip: { kind: 'warn', t: '⚠ כפתור כחול = ההזמנה הולכת להובלה' } });
  await r.click({ target: `button[onclick*="completeGraphic('g9102')"]`, focus: card('g9102'),
    text: 'מסיימים בדיוק אותו דבר — לוחצים.',
    after: 'ההזמנה עברה ל**"ממתין להובלה"** — לטאב "הובלות". **הלקוח עוד לא מקבל הודעה**: היא תצא כשמסיימים את ההובלה.',
    afterMark: [toast, '#cnt-delivery'], afterFocus: null, afterChip: { kind: 'system', t: '⚙ המחיר ננעל · אין הודעה עדיין' } });
  await r.click({ target: `${card('g9103')} summary`, focus: card('g9103'),
    text: '**מקרה 2: אין סקיצה.** אלומיניום דוד — פותחים "פירוט".',
    after: 'במקום תמונה כתוב **"אין סקיצה להזמנה"**. זו לא תקלה במסך.', afterMark: `${card('g9103')} .stv-nosk`, afterFocus: card('g9103'),
    afterChip: { kind: 'warn', t: '⚠ אין סקיצה? שואלים במשרד' } });
  await r.show({ focus: card('g9103'), mark: `${card('g9103')} .stv-nosk`,
    text: 'הפריטים לא מספיקים כדי לדעת מה לעשות? **לא מנחשים** — שואלים במשרד לפני שמתחילים.' });
  await r.show({ focus: card('g9103'), mark: [`${card('g9103')} .stv-items`, `${card('g9103')} .stv-sub`],
    text: '**מקרה 3: חלבי.** הפריט כאן הוא **"8 מ"מ חלבי מחוסם"** — התזת חול, לא גרפיקה. הוא מגיע לאותה תחנה, ונספר בכרטיס כ"פריטי גרפיקה".' });
  await r.click({ target: `button[onclick*="completeGraphic('g9103')"]`, focus: card('g9103'),
    text: 'מסיימים אותו עם **אותו כפתור**.',
    after: 'הרשימה ריקה: **"אין הזמנות בגרפיקה כרגע"**.', afterMark: ['#graphicOrders', toast], afterFocus: null });

  // ── ה. סיכום
  r.chapter('סיכום');
  r.card({ title: 'סיכום · תחנת הגרפיקה', bullets: [
    'הזמנה עם **גרפיקה או חלבי** מגיעה לכאן **לבד**',
    'פותחים **"פירוט"** — עובדים לפי הפריטים והסקיצה · אין סקיצה? שואלים במשרד',
    'לוחצים רק כשהעבודה גמורה — **אין חלון אישור**',
    '**ירוק** ← מוכן לאיסוף (המערכת שולחת ללקוח הודעה) · **כחול** ← הובלות',
  ], flow: [{ t: 'גרפיקה' }, { t: '✅ מוכן לאיסוף', hot: true }, { t: 'או 🚚 ממתין להובלה', hot: true }] });
}
