// ═══════════════════════════════════════════════════════════════════
//  firebase-db.js  —  LuzGlass · מקור אמת מרכזי
//  גרסה: 2.0
//
//  כיצד להשתמש בכל קובץ HTML:
//  ──────────────────────────────
//  1. הוסף לפני </head>:
//       <script src="https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js"></script>
//       <script src="https://www.gstatic.com/firebasejs/9.23.0/firebase-database-compat.js"></script>
//       <script src="firebase-db.js"></script>
//
//  2. קרא לפונקציות — אל תגע ב-Firebase ישירות.
//
//  פונקציות עיקריות:
//  ─────────────────────────────────────────────
//  updateStage(id, stage)         ← שינוי סטטוס (הפונקציה המרכזית)
//  saveOrder(data)                ← הזמנה חדשה
//  saveSubmission(data)           ← העלאת לקוח
//  updateOrder(id, fields)        ← עדכון שדות
//  deleteOrder(id)                ← מחיקה
//  getAllOrders()                  ← קריאה חד-פעמית
//  listenAllOrders(cb)            ← זמן אמת — דשבורד
//  listenClientOrders(name, cb)   ← זמן אמת — פורטל לקוח
//  getWorkDay() / saveWorkDay()   ← יום עבודה
//  lgTest()                       ← בדיקת חיבור מהקונסול
//
//  כלי מידות (כל המערכת עובדת במ"מ שלמים):
//  ─────────────────────────────────────────────
//  lgParseDimensionInput(str)     ← קלט חופשי → { ok, mm } | { ok:false, error }
//  lgMmToMeterStr(mm)             ← 885 → "0.885"  (לשדות עריכה)
//  lgDimPreviewText(raw)          ← "195" → "195 → 1950 מ"מ"  (תצוגה חיה)
//  lgCalcAreaM2(wMm, hMm)        ← 1900,800 → 1.52  (מ"ר, 3 ספרות)
//  lgFormatMm(mm)                 ← 885 → "885"  (לתצוגה בכרטיסים)
// ═══════════════════════════════════════════════════════════════════

'use strict';

// ─── 1. הגדרת Firebase ──────────────────────────────────────────────
const LG_CONFIG = {
  apiKey:            'AIzaSyD7hylVJlzCACQVLtmJPRhYvkArSDE4xz4',
  authDomain:        'lussglass.firebaseapp.com',
  databaseURL:       'https://lussglass-default-rtdb.europe-west1.firebasedatabase.app',
  projectId:         'lussglass',
  storageBucket:     'lussglass.firebasestorage.app',
  messagingSenderId: '493589302388',
  appId:             '1:493589302388:web:4e5dc00e9590eb41415521'
};

if (!firebase.apps.length) firebase.initializeApp(LG_CONFIG);
const _lgDb = firebase.database();

// ─── 2. מפות stage ↔ status ─────────────────────────────────────────
const LG_STAGE_TO_STATUS = {
  '':          'ממתין לאישור',
  'pending':   'ממתין לאישור',
  'chash':     'אצל שרטט',
  'drafter':   'אצל שרטט',
  'opty':      'מחכה ל-OptyWay',
  'workday':   'ירד לביצוע',
  'chisum':    'נשלח לחיסום',
  'graphic':   'בגרפיקה',
  'delivery':  'ממתין להובלה',
  'done':      'מוכן לאיסוף',
  'collected': 'נאסף'
};

const LG_STATUS_TO_STAGE = {
  'ממתין לאישור':    '',
  'הזמנה חדשה':      '',
  'התקבלה':          '',
  'בתור שרטט':       'chash',
  'אצל שרטט':        'drafter',
  'מחכה ל-OptyWay':  'opty',
  'ב-OptyWay':       'opty',
  'ירד לביצוע':      'workday',
  'ביום עבודה':      'workday',
  'נשלח לחיסום':     'chisum',
  'בתחנת בדיקה':     'chisum',
  'חזר מחיסום':      'chisum',
  'בגרפיקה':         'graphic',
  'ממתין להובלה':    'delivery',
  'מוכן לאיסוף':     'done',
  'נאסף':            'collected'
};

function lgStageToStatus(stage)  { return LG_STAGE_TO_STATUS[stage]  ?? LG_STAGE_TO_STATUS['']; }
function lgStatusToStage(status) { return LG_STATUS_TO_STAGE[status] ?? ''; }

// ─── זיהוי פריט גרפיקה — flag ישיר או שם המכיל "גרפיקה" (תאימות לאחור) ──
function _lgItemHasGraphic(item) {
  if (!!item.graphic) return true;
  const n = (item.name || item.glassFullName || '').toLowerCase();
  return n.includes('גרפיקה');
}

// ─── חלבי וטריפלקס ─────────────────────────────────────────────────────
//
//  שניהם נגזרים מהמק"ט בקטלוג, עם נפילה חזרה לשם הפריט — פריטים שנוצרו
//  לפני שהדגלים היו קיימים נושאים רק שם. אותו דפוס כמו גרפיקה למעלה.

// חלבי = התזת חול. אינו סוג זכוכית: "8 מ''מ חלבי" הוא 8 שקוף שעוד חייב
// מעבר במתיז. טריפלקס חלבי מגיע כבר חלבי מהספק ולא עובר שם — ולכן הדגל
// שם נכתב false במפורש, וה-false הזה חייב לגבור על ניחוש לפי השם.
function _lgItemHasChalavi(item) {
  if (!item) return false;
  if (item.chalavi === true)  return true;
  if (item.chalavi === false) return false;
  const n = item.name || item.glassFullName || '';
  return n.includes('חלבי') && !n.includes('טריפלקס');
}

function _lgItemIsTriplex(item) {
  if (!item) return false;
  if (item.triplex) return true;
  return (item.name || item.glassFullName || '').includes('טריפלקס');
}

// טריפלקס נוסע למפעל רק כשהוא מחוסם — שם מדביקים אותו, והוא חוזר אחרי כמה
// ימים ולא למחרת כמו שאר החיסום. טריפלקס שאינו מחוסם נחתך אצלנו ומוכן מיד,
// בדיוק כמו מראה.
function _lgItemIsLaminatedTriplex(item) {
  return _lgItemIsTriplex(item) && !!item.chisum;
}

// עבודת פנים = גרפיקה או התזת חול. שתיהן מתבצעות באותה תחנה ובאותו שלב,
// ולכן חלבי לא מקבל שלב משלו אלא נכנס ל-graphic הקיים.
function _lgItemHasSurfaceWork(item) {
  return _lgItemHasGraphic(item) || _lgItemHasChalavi(item);
}

// ─── סוג הזכוכית של פריט, לתצוגה ולסינון ───────────────────────────────
//
//  "8 שקוף" — עובי וסוג, בלי המק"ט ובלי חלק העיבוד שבשם ("חתוך"/"מלוטש"/
//  "מחוסם"). זה מה שמופיע ברשימת הסינון.
//
//  מקור: הפריט עצמו אם הוא נושא glass ו-mm (כך נוצרים פריטים באדמין),
//  אחרת דרך המק"ט בקטלוג (workday לא שומר את השדות האלה על הפריט).
//  פריט בלי מק"ט ובלי השדות — מוחזר null ולא משתתף בסינון.
function lgGlassLabelOf(item, skuCatalogMap) {
  if (!item) return null;
  let glass = item.glass, mm = item.mm;
  if ((!glass || !mm) && item.sku && skuCatalogMap) {
    const e = skuCatalogMap[String(item.sku).toUpperCase().trim()];
    if (e) { glass = glass || e.glass; mm = mm || e.mm; }
  }
  if (!glass || !mm) return null;
  return mm + ' ' + glass;
}

// רשימת הסוגים שקיימים בפועל בהזמנות שנתונות, עם כמה פריטים בכל אחד.
// נבנית מהנתונים ולא מרשימה קשיחה, כך שאופציה שתחזיר ריק לא מוצעת בכלל.
// itemFilter מאפשר לצמצם לפריטים הרלוונטיים לשלב (למשל רק פריטי חיסום).
function lgGlassTypesInOrders(orders, skuCatalogMap, itemFilter) {
  const counts = {};
  (orders || []).forEach(o => {
    const items = Array.isArray(o.items) ? o.items : Object.values((o && o.items) || {});
    items.forEach(it => {
      if (itemFilter && !itemFilter(it, o)) return;
      const label = lgGlassLabelOf(it, skuCatalogMap);
      if (!label) return;
      counts[label] = (counts[label] || 0) + 1;
    });
  });
  return Object.entries(counts)
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => {
      const am = parseInt(a.label, 10), bm = parseInt(b.label, 10);
      if (am !== bm) return am - bm;
      return a.label.localeCompare(b.label, 'he');
    });
}

// האם בהזמנה יש ולו פריט אחד מסוג הזכוכית שנבחר.
// הזמנה נשארת ברשימה גם אם רוב פריטיה מסוג אחר — הצמצום למה שנבחר נעשה
// בתצוגה של הפריטים עצמם, לא בהסתרת ההזמנה.
function lgOrderHasGlass(order, label, skuCatalogMap) {
  if (!label) return true;
  const items = Array.isArray(order && order.items)
    ? order.items : Object.values((order && order.items) || {});
  return items.some(it => lgGlassLabelOf(it, skuCatalogMap) === label);
}

// רשימת הלקוחות שקיימים בהזמנות שנתונות.
function lgClientsInOrders(orders) {
  return [...new Set((orders || []).map(o => o && o.orderClient).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'he'));
}

// בונה תוכן ל-select סינון ושומר את הבחירה הקיימת אם היא עדיין רלוונטית.
// בלי שמירת הבחירה, כל רענון נתונים היה מאפס את הסינון תוך כדי עבודה.
// `options` — מחרוזות, או {label, count}.
function lgFillFilterSelect(sel, options, placeholder) {
  if (!sel) return;
  const keep = sel.value;
  const norm = (options || []).map(o => (typeof o === 'string' ? { label: o } : o));
  const esc  = v => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;')
                             .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  sel.innerHTML = `<option value="">${esc(placeholder)}</option>` +
    norm.map(o => `<option value="${esc(o.label)}">${esc(o.label)}` +
                  `${o.count != null ? ' (' + o.count + ')' : ''}</option>`).join('');
  sel.value = norm.some(o => o.label === keep) ? keep : '';
}

// ─── פענוח chisumArrivedIdxs ───────────────────────────────────────────
//
//  נכתב כ-{0:true, 1:true} ומוחזר מ-Firebase כמערך בוליאנים כשהמפתחות
//  צפופים: [true,true,true]. אינדקסים דלילים חוזרים כאובייקט, ומערך דליל
//  חוזר עם null-ים באמצע: [true,true,null,null,true].
//
//  הקוד עשה (raw||[]).map(Number) — שממפה את הערכים ולא את המיקומים.
//  [true,true,true] הפך ל-[1,1,1], כלומר "רק פריט 1 הגיע", בכל הזמנה
//  ובכל דוח. Number(null) הוא 0, אז מערך דליל הוסיף גם 0 מדומה.
//  התוצאה: תיבות סימון על הפריטים הלא נכונים וספירות שגויות.
//
//  שלוש הצורות מפוענחות כאן, במקום אחד.
function lgArrivedIdxs(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw.map((v, i) => (v ? i : -1)).filter(i => i >= 0);
  }
  return Object.keys(raw)
    .filter(k => raw[k])
    .map(Number)
    .filter(n => Number.isInteger(n) && n >= 0);
}

// מראה לא נוסעת למפעל. הגוון חלק מהסוג — מראה, מראה אפורה, מראה ברונזה —
// ולכן די בבדיקת התחילית. נפילה לשם רק לפריטים ישנים בלי glass.
function _lgItemIsMirror(item) {
  if (!item) return false;
  if (String(item.glass || '').startsWith('מראה')) return true;
  return (item.name || item.glassFullName || '').includes('מראה');
}

// מה מתוך ההזמנה באמת נוסע למפעל, ולאיזה משני התהליכים.
//
//  chisum   — חיסום רגיל. חוזר למחרת.
//  triplex  — הדבקת טריפלקס. חוזר אחרי כמה ימים, בלי לדעת כמה.
//
// שני התהליכים מתבצעים באותו מפעל אבל הם עבודות שונות, ולכן הדוח הפיזי
// שנוסע לשם חייב להיות מופרד — אחרת במפעל לא יודעים מה לשלוח לאן.
// מראות וטריפלקס לא-מחוסם לא נוסעים כלל: הם נחתכים אצלנו ומוכנים מיד.
function lgSplitFactoryItems(items) {
  const chisum = [], triplex = [];
  (items || []).forEach((item, idx) => {
    if (!item || !item.chisum) return;
    if (_lgItemIsMirror(item)) return;
    (_lgItemIsLaminatedTriplex(item) ? triplex : chisum).push({ item, idx });
  });
  return { chisum, triplex };
}

// ─── חישוב השלב הבא — לוגיקה דינמית לפי פריטים + לקוח הובלות ──────
//  שני מקורות לזיהוי לקוח הובלות (OR — מספיק שאחד מהם נכון):
//    1. order.deliveryClient = true  (denormalized על ההזמנה)
//    2. isDelivery = true            (מה-cache של משתמשים בworkday.html)
function lgNextStage(order, isDelivery) {
  const items      = order.items || [];
  // טריפלקס רגיל אינו מסומן chisum מלכתחילה, ולכן הוא כבר לא נכנס לכאן —
  // הוא נחתך אצלנו ומוכן אחרי יום העבודה, כמו מראה. רק טריפלקס מחוסם נוסע
  // למפעל, ושם הוא גם מודבק וחוזר אחרי ימים.
  const hasChisum  = items.some(i => !!i.chisum);
  // עבודת פנים = גרפיקה או חלבי. אותו שלב, אותה תחנה, ולכן שם אחד.
  const hasGraphic = items.some(i => _lgItemHasSurfaceWork(i));
  // OR בין שני המקורות — לא מאפשרים ל-false מה-cache לדרוס deliveryClient=true על ההזמנה
  const deliveryFl = !!order.deliveryClient || (isDelivery === true);
  const finalStage = deliveryFl ? 'delivery' : 'done';

  switch (order.stage || '') {
    case 'workday':
      if (hasChisum)  return 'chisum';
      if (hasGraphic) return 'graphic';
      return finalStage;
    case 'chisum':
      if (hasGraphic) return 'graphic';
      return finalStage;
    case 'graphic':
      return finalStage;
    case 'done':
    case 'delivery':
      return 'collected';
    default:
      return null;
  }
}

// ─── 3. updateStage — הפונקציה המרכזית לשינוי סטטוס ────────────────
//  כל שינוי סטטוס במערכת חייב לעבור כאן בלבד
async function updateStage(id, stage) {
  if (!id || id === 'null' || id === 'undefined') throw new Error('updateStage: id לא תקין — ' + id);
  const status = lgStageToStatus(stage);
  await _lgDb.ref('orders/' + id).update({ stage, status, updatedAt: Date.now() });
  return { id, stage, status };
}

// ─── 4. CRUD — הזמנות ────────────────────────────────────────────────

// מזהה חשבשבת של הלקוח, לפי הטלפון שאיתו הוא מחובר. תוספתי בלבד —
// orderClient נשאר כפי שהוא, שום סינון קיים לא משתנה.
async function _lgLookupClientMeta(phone) {
  const p = _lgNormalizePhone(phone || '');
  if (!p) return {};
  try {
    const snap = await _lgDb.ref('users/' + p).once('value');
    const u = snap.val();
    if (!u) return {};
    return { customerId: u.customerId || '', businessName: lgClientDisplayName(u) };
  } catch (e) {
    console.warn('[firebase-db] _lgLookupClientMeta:', e);
    return {};
  }
}

// ─── הסקיצה יוצאת מרשומת ההזמנה ─────────────────────────────────────────
//
//  היום התמונה נשמרת כ-base64 בתוך orders/<id>/sketch. נמדד: 23 הזמנות =
//  4.6MB, מהם 99% סקיצות. וארבעה דפים מאזינים ל-orders דרך on('value'),
//  שמשדר מחדש את *כל* תת-העץ בכל שינוי — כלומר כל סימון וי בתחנת הבדיקה
//  מוריד 4.6MB מחדש. בפי עשרה הזמנות זה 46MB, בכל לחיצה.
//
//  היעד: התמונה בצומת נפרד, וברשומה נשאר סימן בלבד. הרשימה יורדת ל-45KB
//  והתמונה נטענת רק כשפותחים אותה.
//
//  המעבר בארבעה שלבים, כדי שבשום רגע לא יהיה נתון שקיים במקום אחד בלבד:
//    1. כתיבה כפולה — לכאן ולשדה הישן.        ← אנחנו כאן
//    2. קריאה מהחדש עם נפילה לישן.
//    3. העברת הקיים, עם ריצה יבשה.
//    4. מחיקת השדה הישן — ורק אז הרווח בפועל.
//
//  שים לב: שלבים 1–2 אינם מזרזים כלום בעצמם. החיסכון מגיע רק כשהשדה הישן
//  עוזב את orders. הם קיימים כדי ששלב 4 יהיה בטוח.
async function lgSaveSketch(orderId, dataUrl) {
  if (!orderId || !dataUrl) return false;
  try {
    await _lgDb.ref('sketches/' + orderId).set(dataUrl);
    return true;
  } catch (e) {
    // כישלון כאן לא נוגע בשדה הישן, שכבר נשמר — ולכן אינו מאבד כלום
    console.warn('[firebase-db] lgSaveSketch:', e && e.message);
    return false;
  }
}

// קריאת סקיצה בודדת, לשלב 2. נופלת לשדה הישן כשהחדש עוד לא קיים.
async function lgGetSketch(orderId) {
  if (!orderId) return null;
  if (_lgSketchCache.has(orderId)) return _lgSketchCache.get(orderId);
  let val = null;
  try {
    const snap = await _lgDb.ref('sketches/' + orderId).once('value');
    if (snap.exists()) val = snap.val();
  } catch (e) { console.warn('[firebase-db] lgGetSketch:', e && e.message); }
  if (val === null) {
    try {
      const old = await _lgDb.ref('orders/' + orderId + '/sketch').once('value');
      if (old.exists()) val = old.val();
    } catch (e) { /* אין — מוחזר null */ }
  }
  if (val !== null) _lgSketchCache.set(orderId, val);
  return val;
}

// ─── שלב 2 · קריאה ──────────────────────────────────────────────────────
//
//  השדה הישן עדיין קיים ועדיין יורד עם ההזמנה, ולכן ברירת המחדל היא לקחת
//  אותו — הוא כבר בזיכרון, וקריאה נוספת הייתה בזבוז נטו.
//
//  אבל אז הצומת החדש אינו נבדק עד שלב 4, שהוא היחיד שמוחק. לכן יש מתג:
//  הרצה של המערכת כולה מול הצומת החדש, בלי למחוק בייט אחד, וחזרה מיידית
//  אם משהו לא עובד. זו כל תכליתו של שלב 2 — להפוך את שלב 4 למשעמם.
//
//  לבדיקה, ב-console של כל דף:   lgSketchSource('new')
//  לחזרה:                        lgSketchSource('old')
//  הבחירה נשמרת ב-localStorage ושורדת רענון.
const _lgSketchCache = new Map();

function lgSketchSource(mode) {
  if (mode === 'new' || mode === 'old') {
    try { localStorage.setItem('lgSketchSource', mode); } catch (e) {}
    _lgSketchCache.clear();
    console.log('[firebase-db] מקור הסקיצות:', mode, '— רענן את הדף');
  }
  try { return localStorage.getItem('lgSketchSource') || 'old'; } catch (e) { return 'old'; }
}

// המקור היחיד לתמונת סקיצה בכל המסכים. מחזיר Promise תמיד, כדי שהקוראים
// לא יצטרכו להשתנות שוב כשהשדה הישן ייעלם.
async function lgLoadSketch(order) {
  if (!order) return null;
  const inline = order.sketch || (order.files && order.files.f0 && order.files.f0.data) || null;
  if (lgSketchSource() === 'old' && inline) return inline;
  const fromNode = await lgGetSketch(order.id);
  return fromNode || inline;
}

// מציב סקיצה ב-<img>. מה שכבר בזיכרון מוצג מיד, ומה שמגיע מהצומת מחליף
// אותו — כדי שלא יהיה רגע שבו המסך ריק. אם המשתמש עבר להזמנה אחרת בינתיים,
// התשובה המאחרת נזרקת ולא דורסת את מה שהוא מסתכל עליו עכשיו.
function lgSketchIntoImg(imgEl, order, onSrc) {
  if (!imgEl || !order) return;
  const inline = order.sketch || (order.files && order.files.f0 && order.files.f0.data) || null;
  const done = src => { imgEl.src = src; if (onSrc) onSrc(src); };
  if (inline && lgSketchSource() === 'old') { imgEl.dataset.lgFor = String(order.id); done(inline); return; }
  if (inline) done(inline);
  imgEl.dataset.lgFor = String(order.id);
  const want = String(order.id);
  lgLoadSketch(order).then(src => {
    if (!src || imgEl.dataset.lgFor !== want) return;
    if (src !== imgEl.src) done(src);
  }).catch(() => {});
}

async function saveOrder(data) {
  const id     = data.id || ('ord_' + Date.now());
  const stage  = data.stage ?? lgStatusToStage(data.status || '') ?? '';
  const status = lgStageToStatus(stage);
  const normPhone = _lgNormalizePhone(data.phone || '');
  const meta = await _lgLookupClientMeta(normPhone);
  const record = _lgClean({
    ...meta, ...data, id, stage, status,
    phone:         normPhone,
    clientPhone:   normPhone,
    paymentStatus: data.paymentStatus || 'unpaid',
    source:        data.source        || 'sketch',
    hasSketch:     !!data.sketch,
    date:          data.date          || _lgToday(),
    createdAt:     data.createdAt     || Date.now(),
    updatedAt:     Date.now()
  });
  await _lgDb.ref('orders/' + id).set(record);
  // שלב 1 — כתיבה כפולה. השדה הישן נשמר כרגיל למעלה; זו תוספת בלבד.
  if (record.sketch) await lgSaveSketch(id, record.sketch);
  return id;
}

async function saveSubmission(data) {
  const id  = 'sub_' + Date.now();
  const now = new Date();

  // המר files מ-array ל-object (Firebase Realtime DB לא שומר arrays אמינות)
  // התמונה עוברת כ-sketch (string) ישירות — לא בתוך array
  const filesObj = {};
  if (data.files && data.files.length) {
    data.files.forEach((f, i) => { filesObj['f' + i] = f; });
  }

  const normPhone = _lgNormalizePhone(data.phone || '');
  const meta = await _lgLookupClientMeta(normPhone);
  const record = _lgClean({
    ...meta,
    ...data,
    id,
    stage:         '',
    status:        lgStageToStatus(''),
    phone:         normPhone,
    clientPhone:   normPhone,
    paymentStatus: 'unpaid',
    source:        'upload',
    hasSketch:     !!data.sketch,
    date:          now.toLocaleDateString('he-IL'),
    time:          now.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' }),
    createdAt:     Date.now(),
    updatedAt:     Date.now(),
    files:         Object.keys(filesObj).length ? filesObj : undefined,
  });

  await _lgDb.ref('orders/' + id).set(record);
  if (record.sketch) await lgSaveSketch(id, record.sketch);
  console.log('[firebase-db] saveSubmission saved:', id, 'hasSketch:', !!record.sketch, 'sketchLen:', record.sketch ? record.sketch.length : 0);
  return id;
}

async function updateOrder(id, fields) {
  if (!id || id === 'null' || id === 'undefined') throw new Error('updateOrder: id לא תקין — ' + id);
  const update = _lgClean({ ...fields, updatedAt: Date.now() });
  if (fields.stage !== undefined) update.status = lgStageToStatus(fields.stage);
  await _lgDb.ref('orders/' + id).update(update);
}

async function deleteOrder(id) {
  if (!id) throw new Error('deleteOrder: id חסר');
  await _lgDb.ref('orders/' + id).remove();
}

// ─── 5. קריאה ────────────────────────────────────────────────────────

async function getAllOrders() {
  const snap = await _lgDb.ref('orders').once('value');
  if (!snap.exists()) return [];
  return Object.values(snap.val()).map(lgNormalizeOrder).filter(Boolean);
}

// האזנה בזמן אמת — מחזיר פונקציית ניתוק
//   const off = listenAllOrders(orders => { ... });
//   off(); // לניתוק
// onError אופציונלי — בלעדיו כשל הרשאה/רשת נבלע בשקט והדף נשאר בטעינה לנצח.
function listenAllOrders(callback, onError) {
  const ref     = _lgDb.ref('orders');
  const handler = snap => {
    if (!snap.exists()) { callback([]); return; }
    callback(Object.values(snap.val()).map(lgNormalizeOrder).filter(Boolean));
  };
  ref.on('value', handler, err => {
    console.error('[firebase-db] listenAllOrders failed:', err);
    if (typeof onError === 'function') onError(err);
  });
  return () => ref.off('value', handler);
}

// האזנה לפי לקוח — לפורטל. מסוננת בשאילתת Firebase עצמה לפי clientPhone
// (לא קריאת-כל-ההזמנות + סינון בצד הלקוח) — כי ברגע שחוקי Firebase ננעלים,
// לקוח לא יורשה לקרוא הזמנות של אחרים בכלל. clientPhone הוא הזיהוי היציב
// שכל הזמנה מקבלת אוטומטית (saveOrder/saveSubmission), לא orderClient
// (מחרוזת שם שיכולה להשתנות ולנתק היסטוריה).
function listenClientOrders(clientPhone, callback) {
  const phone = _lgNormalizePhone(clientPhone || '');
  if (!phone) { callback([]); return () => {}; }
  const ref     = _lgDb.ref('orders').orderByChild('clientPhone').equalTo(phone);
  const handler = snap => {
    if (!snap.exists()) { callback([]); return; }
    callback(Object.values(snap.val()).map(lgNormalizeOrder).filter(Boolean));
  };
  ref.on('value', handler);
  return () => ref.off('value', handler);
}

// ─── 6. יום עבודה ────────────────────────────────────────────────────

async function getWorkDay() {
  const snap = await _lgDb.ref('workday').once('value');
  if (!snap.exists()) return { date: _lgToday(), inWork: [], inChisum: [], itemsSel: {} };
  return snap.val();
}

// update ולא set — set היה מוחק כל מפתח שלא נכלל ב-data, ובפרט את
// workday/checkState (התקדמות הבדיקה בתחנה) ואת inChisum (תור התחנה), שנכתבים
// על-ידי check-station.html ולא מופיעים באובייקט של הקורא. workday.html כבר
// נכווה מזה ומגדיר לעצמו גרסה מקומית עם update; זה מיישר גם את הגרסה המשותפת.
async function saveWorkDay(data) {
  await _lgDb.ref('workday').update(_lgClean({ ...data, updatedAt: Date.now() }));
}

// ─── 8. Session / Auth ──────────────────────────────────────────────
//
//  sessionStorage הוא כאן מטמון-תצוגה בלבד (שם/role להצגה מיידית) —
//  לא מקור ההרשאה. מקור ההרשאה האמיתי הוא Firebase Authentication
//  (firebase.auth().currentUser), נבדק ב-lgRequireAuthAsync בכל דף מוגן.
//  אי אפשר "לזייף" גישה יותר דרך קונסולת הדפדפן — צריך session אמיתי
//  שנוצר רק דרך lgLoginByPhone (סעיף 11 למטה).

// הטלפון של המשתמש המחובר = המפתח ב-users/. נגזר מהאימייל המלאכותי
// ({phone}@luzglass.local) ולא מ-uid: משתמשים שנוצרו דרך Admin SDK קיבלו
// uid == טלפון, אבל createUserWithEmailAndPassword בדפדפן לא מאפשר לקבוע
// uid — Firebase מגריל אותו. האימייל הוא המזהה היחיד שנכון בשני המקרים.
function _lgPhoneFromAuthUser(fbUser) {
  const fromEmail = String(fbUser && fbUser.email || '').split('@')[0];
  return _lgNormalizePhone(fromEmail || (fbUser && fbUser.uid) || '');
}

function lgGetSession()      { try { return JSON.parse(sessionStorage.getItem('lgSession') || '{}'); } catch(e) { return {}; } }
function lgSetSession(data)  { sessionStorage.setItem('lgSession', JSON.stringify(data)); }
function lgClearSession()    { sessionStorage.removeItem('lgSession'); }

async function lgLogout() {
  lgClearSession();
  try { await firebase.auth().signOut(); } catch(e) { console.warn('[Auth] signOut:', e); }
  window.location.href = 'login.html';
}

// שער הרשאה אמיתי — לקרוא בתחילת כל דף מוגן:
//   await lgRequireAuthAsync('admin');   // או 'client', וכו'
// ממתין שFirebase יקבע אם יש משתמש מחובר בפועל, שולף role טרי מ-Firebase
// (לא סומך על sessionStorage), ומפנה ל-login.html אם אין התאמה.
//  הדף נקשר לזהות אחת ונשאר קשור אליה.
//
//  onAuthStateChanged אינו אירוע חד-פעמי — הוא ממשיך לירות לכל אורך חיי הדף.
//  Firebase Auth שומר את המשתמש ב-localStorage, שמשותף לכל הלשוניות של אותו
//  אתר, בעוד lgSession יושב ב-sessionStorage ששייך ללשונית אחת. לכן התחברות
//  בלשונית אחת שינתה בשקט את הזהות בכל השאר: לשונית פורטל שהייתה פתוחה על
//  לקוח קיבלה את המשתמש החדש, כתבה אותו ל-lgSession, והמסך התחיל לומר
//  "שלום בן לוז". גרוע מכך — upload.html קורא את lgSession ברגע השליחה,
//  ולכן הסקיצה נרשמה על שם המשתמש שהוחלף ולא על הלקוח שהעלה אותה.
//
//  עכשיו: הרענון הרגיל של הטוקן (אותו uid) לא נוגע בכלום, והחלפת משתמש
//  אמיתית מסיימת את הסשן בלשונית הזו במקום לאמץ אותה בשקט. עדיף להחזיר
//  אותך למסך ההתחברות מאשר להמשיך לעבוד בזהות שלא ביקשת.
function lgRequireAuthAsync(role) {
  return new Promise((resolve) => {
    let boundUid = null;   // ה-uid שהדף הזה נקשר אליו
    firebase.auth().onAuthStateChanged(async (fbUser) => {
      if (!fbUser) { lgClearSession(); window.location.href = 'login.html'; resolve(null); return; }

      if (boundUid) {
        if (fbUser.uid === boundUid) return;   // חידוש טוקן — אותו אדם, אין מה לעשות
        lgClearSession();
        window.location.href = 'login.html?switched=1';
        return;
      }

      try {
        const phone = _lgPhoneFromAuthUser(fbUser);
        const snap  = await _lgDb.ref('users/' + phone).once('value');
        const u     = snap.val();
        if (!u || (role && u.role !== role && u.role !== 'admin')) {
          lgClearSession();
          window.location.href = 'login.html';
          resolve(null);
          return;
        }
        const session = {
          id:          u.id,
          name:        (u.businessName || '').trim() || u.name,
          role:        u.role,
          phone:       u.phone || phone,
          isMainAdmin: !!u.isMainAdmin,
          uid:         fbUser.uid,   // כדי שכתיבה תוכל לאמת מול מי שבאמת מחובר
          loginTime:   Date.now()
        };
        boundUid = fbUser.uid;
        lgSetSession(session);
        window._lgSession = session; // תאימות לאחור — דפים ישנים קוראים ישירות מהמשתנה הזה
        resolve(session);
      } catch(e) {
        console.error('[Auth] lgRequireAuthAsync:', e);
        window.location.href = 'login.html';
        resolve(null);
      }
    });
  });
}

//  מי מחובר עכשיו באמת, לפי Firebase Auth ולא לפי מטמון התצוגה.
//  כל כתיבה שנרשמת על שם מישהו חייבת לעבור כאן: lgSession הוא מטמון, והוא
//  זה שהחליף זהות מתחת לידיים והכניס סקיצות של לקוח על שם בן לוז.
//  מחזיר null אם אין משתמש, או אם הוא אינו זה שהדף נקשר אליו.
function lgVerifiedSession() {
  const sess   = lgGetSession();
  const fbUser = (typeof firebase !== 'undefined' && firebase.auth) ? firebase.auth().currentUser : null;
  if (!fbUser || !sess || !sess.phone) return null;
  if (sess.uid && sess.uid !== fbUser.uid) return null;
  if (_lgPhoneFromAuthUser(fbUser) !== _lgNormalizePhone(sess.phone)) return null;
  return sess;
}

// ─── 9. נרמול הזמנה ──────────────────────────────────────────────────

function lgNormalizeOrder(o) {
  if (!o || !o.id) return null;
  const stage  = o.stage ?? lgStatusToStage(o.status || '') ?? '';
  return {
    id:            o.id,
    stage,
    status:        lgStageToStatus(stage),
    orderClient:   o.orderClient  || o.client     || '—',
    orderNum:      o.orderNum     || o.refNum      || '',
    sketchName:    o.sketchName   || o.type        || o.desc || '',
    // תאריך האיסוף שהלקוח קובע בפורטל. confirmPick כתב אותו ל-Firebase מאז
    // ומתמיד, אבל הוא לא היה ברשימה כאן — ולכן נמחק בדרך חזרה לכל מסך,
    // כולל הפורטל שכתב אותו וכולל לוח האיסופים באדמין. אותה תבנית כמו
    // chisumArrivedIdxs ו-itemType.
    pickedDate:    o.pickedDate    || '',
    pickupDateRaw: o.pickupDateRaw || '',
    // סיכום החשבונית — ולא הרשומה המלאה. hashavshevetInvoice מחזיקה גם
    // response באורך 4000 תווים ו-requestSample, וזה נכפל בכל הזמנה בצומת
    // שכל דף מוריד במלואו. ר' scripts/test-sketch-storage.js.
    // מי שצריך את הגולמי קורא אותו נקודתית מ-orders/<id>/hashavshevetInvoice.
    invoice:       o.hashavshevetInvoice ? {
      reference:  o.hashavshevetInvoice.reference || '',
      total:      Number(o.hashavshevetInvoice.total) || 0,
      sentAt:     Number(o.hashavshevetInvoice.sentAt) || 0,
      documentId: o.hashavshevetInvoice.documentId || '',
      simulated:  !!o.hashavshevetInvoice.simulated,
      httpOk:     !!o.hashavshevetInvoice.httpOk,
    } : null,
    glass:         o.glass        || '',
    glassFullName: o.glassFullName|| o.glass       || '',
    finish:        o.finish       || '',
    area:          o.area         || '',
    total:         Number(o.total)|| 0,
    date:          o.date         || '',
    phone:         o.phone        || '',
    items:         Array.isArray(o.items) ? o.items
                   : (o.items && typeof o.items === 'object') ? Object.values(o.items)
                   : [],
    panels:        o.panels       || [],
    notes:         o.notes        || '',
    // תת-שלב ויזואלי בתוך תור הסקיצות, לא שלב. מסומן כשמי שעובר על
    // הסקיצות אישר אותה, ונקרא רק בתור הסקיצות ובפורטל. stage לא מושפע.
    sketchSeenAt:  o.sketchSeenAt || 0,
    source:        o.source       || 'sketch',
    urgent:        o.urgent       || false,
    sketch:        o.sketch       || null,
    // סימן בלבד — מאפשר למסך לדעת שיש סקיצה בלי להוריד אותה
    hasSketch:     !!(o.hasSketch || o.sketch),
    files:         o.files        || [],
    type:          o.type         || '',
    cat:           o.cat          || '',
    quality:       o.quality      || '',
    sand:          o.sand         || false,
    workdayStatus:  o.workdayStatus  || '',
    readyStatus:    o.readyStatus    || '',
    chisumArrived:     o.chisumArrived   || false,
    chisumReportId:    o.chisumReportId  || null,
    chisumReportNum:   o.chisumReportNum || null,
    chisumSentAt:      o.chisumSentAt    || null,
    // גולמי, בדיוק כפי ש-Firebase החזיר. הפענוח קורה במקום אחד בלבד —
    // lgArrivedIdxs — ושתי הצורות אינן תואמות: Object.keys מחזיר מערך של
    // אינדקסים ([0,7]), ואילו lgArrivedIdxs מפרש מערך כמערך בוליאנים לפי
    // מיקום. הנרמול הזה הפך "רק פריט 3 הגיע" ל"פריטים 1,2,3 הגיעו",
    // ו"רק פריט 0 הגיע" ל"כלום לא הגיע" — בכל דף ובכל הזמנה.
    chisumArrivedIdxs: o.chisumArrivedIdxs ?? null,
    // דוח הטריפלקס. השדות האלה נכתבים בתחנת הבדיקה ונקראים ביום עבודה,
    // אבל נשמטו מהרשימה כאן — ולכן חזרו undefined לכל דף. טאב הטריפלקס
    // מסנן לפי triplexReportId, ומעולם לא היה יכול להציג שורה אחת.
    triplexArrived:    o.triplexArrived   || false,
    triplexReportId:   o.triplexReportId  || null,
    triplexReportNum:  o.triplexReportNum || null,
    triplexSentAt:     o.triplexSentAt    || null,
    // גולמי, כמו chisumArrivedIdxs ומאותה סיבה — lgArrivedIdxs הוא המפענח היחיד
    triplexArrivedIdxs: o.triplexArrivedIdxs ?? null,
    // פאנלים שנסגרו ב"סיום בדיקה" — ירדו מהרשימה ולא חוזרים אליה
    chisumClosedIdxs:   o.chisumClosedIdxs   ?? null,
    triplexClosedIdxs:  o.triplexClosedIdxs  ?? null,
    // הזמנת בדיקה — רצה בכל התהליך הרגיל אבל לא נפתחת בחשבשבת. חייב לעבור
    // כאן, אחרת אף מסך לא יוכל לסמן אותה ככזו והיא תיראה כמו הזמנה אמיתית.
    isTest:         !!o.isTest,
    deliveryClient: !!o.deliveryClient,
    // שוטף 30 — הלקוח אוסף לאורך החודש ומחויב פעם אחת בסופו. מסומן על
    // ההזמנה ולא רק על הלקוח, כדי שהזמנה תזכור באיזה משטר היא נפתחה גם
    // אם ההגדרה של הלקוח תשתנה מאוחר יותר.
    monthlyBilling: !!o.monthlyBilling,
    createdAt:     o.createdAt    || 0,
    updatedAt:     o.updatedAt    || 0,
    // שדות "נעילת מחיר" ולקוח — היו נמחקים בשקט כאן, ולכן הנעילה מעולם לא
    // באמת עבדה (lgLockAndAdvance בודק !order.totalFinal על אובייקט שעבר
    // כאן, ותמיד קיבל undefined). totalFinal/pricesLockedAt נשארים בלי
    // ברירת מחדל מאולצת — 0 הוא ערך נעילה אמיתי אפשרי, שונה מ"לא ננעל".
    totalFinal:    o.totalFinal,
    totalM2:       o.totalM2      || 0,
    pricesLockedAt:o.pricesLockedAt || null,
    lockedItems:   Array.isArray(o.lockedItems) ? o.lockedItems : [],
    customerId:    o.customerId   || '',
    businessName:  o.businessName || '',
    clientPhone:   o.clientPhone  || '',
    vatId:         o.vatId        || '',
    paymentStatus: o.paymentStatus|| 'unpaid',
    _isSub:        String(o.id).startsWith('sub_')
  };
}

// ─── 10. lgTest — בדיקת חיבור מהקונסול ──────────────────────────────
//   פתח קונסול בדפדפן (F12) והקלד: lgTest()
async function lgTest() {
  console.group('🔥 LuzGlass Firebase Test');
  let ok = 0;
  try {
    // א. כתיבה
    const tid = '_test_' + Date.now();
    await _lgDb.ref('_test/' + tid).set({ v: 'hello', ts: Date.now() });
    console.log('✓ כתיבה');
    ok++;

    // ב. קריאה
    const snap = await _lgDb.ref('_test/' + tid).once('value');
    if (snap.val()?.v === 'hello') { console.log('✓ קריאה'); ok++; }
    else console.error('✗ קריאה — ערך שגוי');

    // ג. מחיקה
    await _lgDb.ref('_test/' + tid).remove();
    console.log('✓ מחיקה');
    ok++;

    // ד. updateStage
    const oid = '_test_order_' + Date.now();
    await _lgDb.ref('orders/' + oid).set({ id: oid, stage: '', status: lgStageToStatus(''), createdAt: Date.now() });
    await updateStage(oid, 'opty');
    const s2  = await _lgDb.ref('orders/' + oid).once('value');
    const ord = s2.val();
    if (ord?.stage === 'opty' && ord?.status === 'מחכה ל-OptyWay') {
      console.log('✓ updateStage:', ord.stage, '→', ord.status);
      ok++;
    } else {
      console.error('✗ updateStage — תוצאה לא צפויה', ord);
    }
    await _lgDb.ref('orders/' + oid).remove();

  } catch(err) {
    console.error('✗ שגיאה:', err.message);
    console.warn('בדוק שהרשאות Firebase הוגדרו כ: ".read": true, ".write": true');
  }

  if (ok === 4) {
    console.log('%c✅ ' + ok + '/4 בדיקות עברו — Firebase מוכן!', 'color:green;font-weight:bold;font-size:14px');
  } else {
    console.warn('⚠️ ' + ok + '/4 בדיקות עברו');
  }
  console.groupEnd();
}

// ─── 11. ניהול משתמשים ───────────────────────────────────────────────
//
//  ארכיטקטורה: מספר הטלפון המנורמל הוא ה-ID של המסמך.
//  users/0547725552  →  אדמין ראשי
//  users/0548000775  →  לקוח א.מ מראות
//
//  יתרונות:
//  · אין כפילויות — אותו טלפון = אותו מסמך (כתיבה מחדש)
//  · התחברות = GET ישיר, לא סריקה
//  · ללא תלות ב-Firebase index

const LG_MAIN_ADMIN_PHONE = '0547725552';
const LG_EMAIL_DOMAIN     = 'luzglass.local'; // דומיין מלאכותי — Firebase Auth דורש "אימייל", לא נשלח אליו כלום אמיתי

function _lgNormalizePhone(p){ return String(p||'').replace(/[-\s]/g,''); }
function _lgSyntheticEmail(phone){ return `${_lgNormalizePhone(phone)}@${LG_EMAIL_DOMAIN}`; }

// מגבלת זמן לפעולת רשת.
//
// למה זה נחוץ: כשחיבור ה-Realtime Database לא מצליח להיווצר, קריאות כמו
// .once('value') לא נפתרות ולא נדחות — הן פשוט תלויות לנצח. המשתמש נשאר מול
// ספינר בלי שום הודעה, וזה בדיוק מה שקרה כשה-CSP חסם את ה-long-polling.
// עטיפה בזמן קצוב הופכת תקיעה שקטה לשגיאה שאפשר להציג ולהתאושש ממנה.
const LG_NET_TIMEOUT_MS = 15000;

function _lgWithTimeout(promise, ms = LG_NET_TIMEOUT_MS, label = 'פעולת רשת') {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const err = new Error(`${label}: חלף זמן ההמתנה (${ms}ms)`);
      err.code  = 'lg/timeout';
      reject(err);
    }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// התחברות אמיתית — Firebase Authentication (לא השוואת סיסמה גלויה).
// דורש שהמשתמש כבר קיים ב-Firebase Auth (ראה scripts/migrate-users-to-auth.js).
// זורק שגיאה אם הפרטים שגויים — הקורא (login.html) תופס ומציג הודעה למשתמש.
async function lgLoginByPhone(phone, password) {
  const p     = _lgNormalizePhone(phone);
  const email = _lgSyntheticEmail(p);
  await _lgWithTimeout(
    firebase.auth().signInWithEmailAndPassword(email, password), // זורק על פרטים שגויים
    LG_NET_TIMEOUT_MS, 'אימות'
  );
  // הקריאה הזו היא שנתקעה בבאג ה-CSP — הזמן הקצוב הוא רשת הביטחון שלה
  const snap = await _lgWithTimeout(
    _lgDb.ref('users/' + p).once('value'),
    LG_NET_TIMEOUT_MS, 'טעינת פרטי משתמש'
  );
  if (!snap.exists()) {
    await firebase.auth().signOut().catch(()=>{});
    throw new Error('לא נמצאה רשומת משתמש תואמת');
  }
  return snap.val();
}

// שמירת משתמש — הטלפון הוא ה-ID, כפילויות בלתי אפשריות
async function lgSaveUser(data) {
  if (!data.phone) throw new Error('lgSaveUser: phone חסר');
  const phone  = _lgNormalizePhone(data.phone);
  const record = _lgClean({
    ...data,
    id:        phone,          // phone = document id
    phone,
    customerId: data.customerId || '',
    createdAt:  data.createdAt || Date.now(),
    updatedAt:  Date.now()
  });
  await _lgDb.ref('users/' + phone).set(record);
  return phone;
}

// קבלת כל המשתמשים
async function lgGetAllUsers() {
  const snap = await _lgDb.ref('users').once('value');
  if (!snap.exists()) return [];
  return Object.values(snap.val());
}

// השם העסקי הקנוני של לקוח — businessName כשקיים, אחרת name
// זהו השם שמשמש ב-orderClient, מחירונים, פורטל, וחשבשבת API
function lgClientDisplayName(user){
  return (user && (user.businessName||'').trim()) || (user && user.name) || '';
}

// קבלת לקוחות פעילים בלבד — active !== false (backwards compat: חסר = פעיל)
// זהו ה-API שיש להשתמש בו בכל מקום שמציג רשימות עבודה / מחירונים
// לעתיד: כשיתווסף חיבור חשבשבת, לקוחות מסונכרנים יגיעו עם active:false עד שמפעילים אותם ידנית
async function lgGetActiveClients() {
  const users = await lgGetAllUsers();
  return users.filter(u => u.role === 'client' && u.active !== false);
}

// מחיקת משתמש (אדמין ראשי מוגן)
async function lgDeleteUser(id) {
  const phone = _lgNormalizePhone(id);
  if (!phone || phone === LG_MAIN_ADMIN_PHONE)
    throw new Error('לא ניתן למחוק את האדמין הראשי');
  await _lgDb.ref('users/' + phone).remove();
}

// ─── 11ב. יצירת התחברות ללקוח מתוך כרטיס חשבשבת ────────────────────
//
//  createUserWithEmailAndPassword מחבר אוטומטית כמשתמש החדש ומנתק את
//  האדמין מהסשן שלו. לכן היצירה רצה על מופע Firebase שני ונפרד, שמצב
//  ה-auth שלו אינו קשור למופע הראשי — האדמין נשאר מחובר.

let _lgProvisionApp = null;
function _lgProvisionAuth() {
  if (!_lgProvisionApp) _lgProvisionApp = firebase.initializeApp(LG_CONFIG, 'lgProvision');
  return _lgProvisionApp.auth();
}

// מחזיר את המשתמש שכבר נוצר עבור מפתח חשבשבת מסוים, או null
async function lgFindUserByCustomerId(customerId) {
  const c = String(customerId || '').trim();
  if (!c) return null;
  const users = await lgGetAllUsers();
  return users.find(u => u.customerId === c) || null;
}

// יצירת לקוח חדש מכרטיס חשבשבת: חשבון Firebase Auth + רשומת users/{phone}.
// הסיסמה נשמרת אך ורק ב-Firebase Auth — לא נכתב שדה password ל-RTDB.
async function lgProvisionClientFromHashavshevet({ customerId, name, phone, password, vatId }) {
  const p = _lgNormalizePhone(phone);
  const c = String(customerId || '').trim();
  if (!p) throw new Error('מספר טלפון חסר');
  if (!c) throw new Error('מפתח חשבשבת חסר');
  if (!name) throw new Error('שם לקוח חסר');

  const users = await lgGetAllUsers();
  if (users.some(u => _lgNormalizePhone(u.phone || u.id) === p))
    throw new Error('כבר קיים משתמש עם מספר הטלפון הזה');
  if (users.some(u => u.customerId === c))
    throw new Error('כבר נוצר משתמש עבור כרטיס החשבשבת הזה');

  try {
    await _lgProvisionAuth().createUserWithEmailAndPassword(_lgSyntheticEmail(p), password || p);
  } catch (e) {
    if (e && e.code === 'auth/email-already-in-use')
      throw new Error('קיים חשבון התחברות ישן עם הטלפון הזה — יש להריץ את סקריפט הניקוי');
    if (e && e.code === 'auth/weak-password')
      throw new Error('הסיסמה קצרה מדי — נדרשים לפחות 6 תווים');
    throw e;
  } finally {
    await _lgProvisionAuth().signOut().catch(()=>{});
  }

  await lgSaveUser({
    id: p, phone: p,
    name, businessName: name,
    customerId: c, hashavshevetCode: c,
    vatId: vatId || '',
    role: 'client', active: true,
    source: 'hashavshevet', linkedAt: Date.now()
  });
  return p;
}

// יצירת אדמין חדש: חשבון Firebase Auth אמיתי + רשומת users/{phone}.
// אותו דפוס בדיוק כמו lgProvisionClientFromHashavshevet — בלי זה אדמין
// חדש נראה נוצר בהצלחה אבל לא מסוגל להתחבר בכלל (signInWithEmailAndPassword
// נכשל כי אין חשבון Auth תואם). שוב — אין שדה password ב-RTDB.
async function lgProvisionAdmin({ name, phone, password }) {
  const p = _lgNormalizePhone(phone);
  if (!p) throw new Error('מספר טלפון חסר');
  if (!name) throw new Error('שם חסר');

  const users = await lgGetAllUsers();
  if (users.some(u => _lgNormalizePhone(u.phone || u.id) === p))
    throw new Error('כבר קיים משתמש עם מספר הטלפון הזה');

  try {
    await _lgProvisionAuth().createUserWithEmailAndPassword(_lgSyntheticEmail(p), password);
  } catch (e) {
    if (e && e.code === 'auth/email-already-in-use')
      throw new Error('קיים חשבון התחברות ישן עם הטלפון הזה');
    if (e && e.code === 'auth/weak-password')
      throw new Error('הסיסמה קצרה מדי — נדרשים לפחות 6 תווים');
    throw e;
  } finally {
    await _lgProvisionAuth().signOut().catch(()=>{});
  }

  await lgSaveUser({ id: p, phone: p, name, role: 'admin', isMainAdmin: false });
  return p;
}

// ─── 12. מק"ט → שם פריט (מקור יחיד לכל המערכת) ─────────────────────

const LG_SKU_MAP = {
  // שקוף (S)
  '4SM':'4 מ"מ שקוף מלוטש',   '4SMH':'4 מ"מ שקוף מחוסם',
  '5SM':'5 מ"מ שקוף מלוטש',   '5SMH':'5 מ"מ שקוף מחוסם',
  '6SM':'6 מ"מ שקוף מלוטש',   '6SMH':'6 מ"מ שקוף מחוסם',
  '8SM':'8 מ"מ שקוף מלוטש',   '8SMH':'8 מ"מ שקוף מחוסם',
  '10SM':'10 מ"מ שקוף מלוטש', '10SMH':'10 מ"מ שקוף מחוסם',
  '12SM':'12 מ"מ שקוף מלוטש', '12SMH':'12 מ"מ שקוף מחוסם',
  '15SM':'15 מ"מ שקוף מלוטש', '15SMH':'15 מ"מ שקוף מחוסם',
  // קליר (C)
  '6CM':'6 מ"מ קליר מלוטש',   '6CMH':'6 מ"מ קליר מחוסם',
  '8CM':'8 מ"מ קליר מלוטש',   '8CMH':'8 מ"מ קליר מחוסם',
  '10CM':'10 מ"מ קליר מלוטש', '10CMH':'10 מ"מ קליר מחוסם',
  '12CM':'12 מ"מ קליר מלוטש', '12CMH':'12 מ"מ קליר מחוסם',
  '15CM':'15 מ"מ קליר מלוטש', '15CMH':'15 מ"מ קליר מחוסם',
  // אסיד (A)
  '6AM':'6 מ"מ אסיד מלוטש',   '6AMH':'6 מ"מ אסיד מחוסם',
  '8AM':'8 מ"מ אסיד מלוטש',   '8AMH':'8 מ"מ אסיד מחוסם',
  '10AM':'10 מ"מ אסיד מלוטש', '10AMH':'10 מ"מ אסיד מחוסם',
  // אסיד קליר (AC)
  '6ACM':'6 מ"מ אסיד קליר מלוטש',   '6ACMH':'6 מ"מ אסיד קליר מחוסם',
  '8ACM':'8 מ"מ אסיד קליר מלוטש',   '8ACMH':'8 מ"מ אסיד קליר מחוסם',
  '10ACM':'10 מ"מ אסיד קליר מלוטש', '10ACMH':'10 מ"מ אסיד קליר מחוסם',
  // אפור (GR)
  '6GRM':'6 מ"מ אפור מלוטש',  '6GRMH':'6 מ"מ אפור מחוסם',
  '8GRM':'8 מ"מ אפור מלוטש',  '8GRMH':'8 מ"מ אפור מחוסם',
  // ברונזה (B)
  '8BM':'8 מ"מ ברונזה מלוטש',  '8BMH':'8 מ"מ ברונזה מחוסם',
  '10BM':'10 מ"מ ברונזה מלוטש','10BMH':'10 מ"מ ברונזה מחוסם',
  // גרניט (G)
  '6GM':'6 מ"מ גרניט מלוטש',  '6GMH':'6 מ"מ גרניט מחוסם',
  '8GM':'8 מ"מ גרניט מלוטש',  '8GMH':'8 מ"מ גרניט מחוסם',
  // גרפיקה שקוף (SG) — מלוטש + גרפיקה  /  מחוסם + גרפיקה
  '6SGM': '6 מ"מ שקוף גרפיקה מלוטש',  '6SGMH': '6 מ"מ שקוף גרפיקה מחוסם',
  '8SGM': '8 מ"מ שקוף גרפיקה מלוטש',  '8SGMH': '8 מ"מ שקוף גרפיקה מחוסם',
  '10SGM':'10 מ"מ שקוף גרפיקה מלוטש', '10SGMH':'10 מ"מ שקוף גרפיקה מחוסם',
  // גרפיקה קליר (CG)
  '6CGM': '6 מ"מ קליר גרפיקה מלוטש',  '6CGMH': '6 מ"מ קליר גרפיקה מחוסם',
  '8CGM': '8 מ"מ קליר גרפיקה מלוטש',  '8CGMH': '8 מ"מ קליר גרפיקה מחוסם',
  '10CGM':'10 מ"מ קליר גרפיקה מלוטש', '10CGMH':'10 מ"מ קליר גרפיקה מחוסם',
  // פיפטה (P)
  '8PM':'8 מ"מ פיפטה מלוטש',  '8PMH':'8 מ"מ פיפטה מחוסם',
  // גלינה (GL)
  '8GLM':'8 מ"מ גלינה מלוטש',    '8GLMH':'8 מ"מ גלינה מחוסם',
  '8GLCM':'8 מ"מ גלינה קליר מלוטש',  '8GLCMH':'8 מ"מ גלינה קליר מחוסם',
  '10GLCM':'10 מ"מ גלינה קליר מלוטש','10GLCMH':'10 מ"מ גלינה קליר מחוסם',
  // מראות (MIR)
  '4MIRM':'מראה 4 מ"מ מלוטש', '4MIRH':'מראה 4 מ"מ חתוך',
  '5MIRM':'מראה 5 מ"מ מלוטש', '5MIRH':'מראה 5 מ"מ חתוך',
  '6MIRM':'מראה 6 מ"מ מלוטש', '6MIRH':'מראה 6 מ"מ חתוך',
  '5MIRBM':'מראה ברונזה מלוטש','5MIRBH':'מראה ברונזה חתוך',
  '5MIRAM':'מראה אפור מלוטש',
};

// ממיר מק"ט לשם מלא — מקור אמת יחיד לכל המערכת
// אם המק"ט לא קיים — מחזיר את הערך המקורי (לא שובר)
function lgSkuToName(sku) {
  if (!sku) return '';
  const upper = String(sku).toUpperCase().trim();
  return LG_SKU_MAP[upper] || sku;
}

// ─── אבטחה — הגנת XSS ────────────────────────────────────────────────
//  לכל ערך שמגיע מ-Firebase/משתמש ומוזרק ל-innerHTML חובה לעטוף ב-lgEsc().
//  שימוש:  el.innerHTML = `<div>${lgEsc(o.orderClient)}</div>`
function lgEsc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

//  לערכים שמוזרקים בתוך onclick="fn('${...}')" (מחרוזת JS במרכאות בודדות,
//  בתוך attribute במרכאות כפולות) — lgEsc לבד לא מספיק כאן: הדפדפן מפענח
//  HTML entities לפני שהוא מריץ את ה-JS, כך ש-&#39; חוזר להיות ' ושובר את המחרוזת.
//  שימוש:  onclick="fn('${lgJsStr(clientName)}')"
function lgJsStr(str) {
  return String(str ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\r?\n/g, '\\n')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ─── כלי עזר פנימיים ─────────────────────────────────────────────────

function _lgClean(obj) {
  const r = {};
  for (const [k, v] of Object.entries(obj)) { if (v !== undefined) r[k] = v; }
  return r;
}

function _lgToday() { return new Date().toLocaleDateString('he-IL'); }

// ─── 13. מספרי הזמנות — מונה רץ ב-Firebase ──────────────────────────────

// מחזיר מספר הזמנה רץ ייחודי (L1000, L1001, ...)
// runTransaction מבטיח אטומיות — אין כפילויות גם אם שני לקוחות שולחים בו-זמנית
async function lgNextOrderNum() {
  const ref = _lgDb.ref('meta/orderCounter');
  const result = await ref.transaction(current => {
    return Math.max(current || 0, 999) + 1;
  });
  return 'L' + result.snapshot.val();
}

// ─── 14. מחירים — Firebase כמקור אמת ──────────────────────────────────

const LG_PRICE_ITEMS = [
  {cat:'מראות',        id:'mir-5-pol',    name:'מראה 5מ"מ מלוטש'},
  {cat:'מראות',        id:'mir-5-gray',   name:'מראה אפורה 5מ"מ מלוטש'},
  {cat:'מראות',        id:'mir-5-brnz',   name:'מראה ברונזה 5מ"מ מלוטש'},
  {cat:'מראות',        id:'mir-5-shape',  name:'מראה 5מ"מ צורתית'},
  {cat:'שקוף מלוטש',   id:'cl-4-pol',    name:'שקוף 4מ"מ מלוטש'},
  {cat:'שקוף מלוטש',   id:'cl-5-pol',    name:'שקוף 5מ"מ מלוטש'},
  {cat:'שקוף מלוטש',   id:'cl-6-pol',    name:'שקוף 6מ"מ מלוטש'},
  {cat:'שקוף מלוטש',   id:'cl-8-pol',    name:'שקוף 8מ"מ מלוטש'},
  {cat:'שקוף מלוטש',   id:'cl-10-pol',   name:'שקוף 10מ"מ מלוטש'},
  {cat:'שקוף מלוטש',   id:'cl-12-pol',   name:'שקוף 12מ"מ מלוטש'},
  {cat:'מחוסם',        id:'tmp-6',        name:'מחוסם 6מ"מ שקוף'},
  {cat:'מחוסם',        id:'tmp-8',        name:'מחוסם 8מ"מ שקוף'},
  {cat:'מחוסם',        id:'tmp-8-klir',   name:'מחוסם 8מ"מ קליר'},
  {cat:'מחוסם',        id:'tmp-8-granit', name:'מחוסם 8מ"מ גרניט'},
  {cat:'מחוסם',        id:'tmp-10',       name:'מחוסם 10מ"מ קליר'},
  {cat:'מחוסם',        id:'tmp-10-gray',  name:'מחוסם 10מ"מ אפור'},
  {cat:'מחוסם',        id:'tmp-15-klir',  name:'מחוסם 15מ"מ קליר'},
];

function lgFindPriceItem(glassName){
  if(!glassName) return null;
  const n = glassName.toLowerCase().replace(/"/g,'');
  if(n.includes('מראה')||n.includes('mir')){
    if(n.includes('ברונז')||n.includes('brnz')) return 'mir-5-brnz';
    if(n.includes('אפור')||n.includes('gray')||n.includes('gr')) return 'mir-5-gray';
    return 'mir-5-pol';
  }
  const mmM = n.match(/(\d+)\s*מ/)||n.match(/^(\d+)/);
  const mm  = mmM ? parseInt(mmM[1]) : 8;
  const isTmp    = n.includes('מחוסם')||n.includes('smh')||n.endsWith('mh')||n.includes('חיסום');
  const isKlir   = n.includes('קליר')||n.includes('klir')||n.includes('cm');
  const isAfor   = n.includes('אפור')||n.includes('gray');
  const isGranit = n.includes('גרניט')||n.includes('granit');
  if(isTmp){
    if(isGranit) return 'tmp-8-granit';
    if(mm<=6) return 'tmp-6';
    if(mm>=15&&isKlir) return 'tmp-15-klir';
    if(mm>=10&&isAfor) return 'tmp-10-gray';
    if(isKlir) return mm>=10?'tmp-10':'tmp-8-klir';
    return mm>=10?'tmp-10':'tmp-8';
  }
  // עובי לא מוכר (למשל 7/9/11/13+) — עדיף להחזיר null (לא מתומחר, גלוי) מאשר
  // לנחש "8 מ"מ קליר" בשקט; ניחוש שגוי כאן היה מוביל לנעילת מחיר שגוי, לא רק חסר.
  const map={4:'cl-4-pol',5:'cl-5-pol',6:'cl-6-pol',8:'cl-8-pol',10:'cl-10-pol',12:'cl-12-pol'};
  return map[mm]||null;
}

// ─── 14ב. קטלוג מק"טים — Firebase, מקור אמת עתידי (מחליף בהדרגה LG_SKU_MAP/IW_CODES/LG_PRICE_ITEMS) ──
//
//  skuCatalog/{CODE}  (CODE = מק"ט, לדוגמה "8SGMH")
//    שדות עסקיים   — מותר לסנכרון מחשבשבת לעדכן: name, hashavshevetCode, active, source
//    שדות תפעוליים — בבעלות המערכת שלנו בלבד, סנכרון לעולם לא נוגע בהם: glass, mm, proc, graphic
//
//  שלב 1 (נוכחי): תוספתי בלבד. כל מקום שמשתמש ב-IW_CODES/LG_SKU_MAP/LG_PRICE_ITEMS ממשיך
//  לעבוד בדיוק כמו היום — קודם בודקים skuCatalog, ורק אם אין שם רשומה נופלים חזרה לישן.
//  שלב 2 (עתידי, אחרי שכל המק"טים יעברו ויאומתו): הסרה הדרגתית של הקטלוגים הישנים.

const LG_SKU_BUSINESS_FIELDS    = ['name', 'hashavshevetCode', 'active', 'source'];
const LG_SKU_OPERATIONAL_FIELDS = ['glass', 'mm', 'proc', 'graphic', 'chalavi', 'triplex'];

// ניחוש שדות תפעוליים מתוך שם הפריט בחשבשבת (למשל '8 מ"מ שקוף מחוסם') — משמש רק כברירת מחדל
// חד-פעמית בסנכרון ראשון של מק"ט חדש (ר' syncSkuCatalogFromHashavshevet). לעולם לא דורס ערך
// תפעולי קיים — עריכה ידנית שכבר בוצעה תמיד גוברת על הניחוש.
// סוגי הזכוכית — מה החומר הוא, ותו לא.
//
// מסודר מהארוך לקצר, וזה קריטי: 'אסיד קליר' חייב להיבדק לפני 'אסיד', אחרת
// "10 מ''מ אסיד קליר" יזוהה כ'אסיד' ויאבד את הצירוף. אותו דבר ל'לקובל שחור'
// מול 'לקובל'.
//
// חלבי אינו ברשימה בכוונה — הוא לא סוג זכוכית אלא התזת חול. "8 מ''מ חלבי
// חתוך" נחתך כ-8 שקוף, הוא 8 שקוף בכל המערכת, ורק נושא דגל שאומר שהוא עוד
// חייב מעבר במתיז. אותו דבר לטריפלקס ולדלתות נגרים.
// מראה ושלושת גווניה מטופלים בנפרד למטה, ולכן אינם ברשימה הזו.
const LG_GLASS_TYPES_BY_LENGTH = [
  'לקובל שחור', 'לקובל לבן', 'מאסטר ליין',
  'אסיד קליר', 'גלינה שקוף', 'גלינה קליר',
  'צנצילה', 'פפיטה', 'ברונזה', 'גרניט', 'סבתא',
  'שקוף', 'קליר', 'אפור', 'אסיד'
];

// כשהשם מתאר גימור ולא חומר, החומר שמתחת הוא שקוף — כך הזכוכית נחתכת
// ובזה היא מנוהלת עד שהיא מגיעה לטיפול. צנצילה חלבי הוא החריג היחיד:
// שם החומר כן נאמר, וההתאמה לעיל תופסת אותו לפני שנגיע לכאן.
const LG_GLASS_DEFAULT_BASE = 'שקוף';
const LG_IMPLIES_BASE_GLASS = ['חלבי', 'דלתות נגרים'];

function lgGuessOperationalFromName(name) {
  const n = String(name || '');
  const guess = {};

  // עובי: "8 מ''מ" ‏· או צורת הטריפלקס "3+3" / "4+4", שהיא סכום השכבות
  const mmMatch = n.match(/(\d+)\s*מ["'׳״]{1,2}מ/);
  if (mmMatch) {
    guess.mm = parseInt(mmMatch[1], 10);
  } else {
    const lam = n.match(/(\d+)\s*\+\s*(\d+)/);
    if (lam) guess.mm = parseInt(lam[1], 10) + parseInt(lam[2], 10);
  }

  // מראה היא סוג בפני עצמו והגוון חלק ממנו: מראה רגילה, מראה אפורה, מראה
  // ברונזה. אי אפשר לחפש את הצירוף כמחרוזת כי השמות בחשבשבת לא עקביים —
  // "5 מ''מ מראה אפורה חתוך" מכיל אותו, "מראה 5 מ''מ אפורה עגולה" לא. לכן
  // בודקים את שתי המילים בנפרד. בלי זה מראה אפורה נופלת תחת "אפור" יחד עם
  // זכוכית אפורה רגילה, וזה מה שקרה עד עכשיו.
  if (n.includes('מראה')) {
    if (n.includes('אפור'))        guess.glass = 'מראה אפורה';
    else if (n.includes('ברונזה')) guess.glass = 'מראה ברונזה';
    else                           guess.glass = 'מראה';
  } else {
    const glass = LG_GLASS_TYPES_BY_LENGTH.find(g => n.includes(g));
    if (glass) guess.glass = glass;
    else if (LG_IMPLIES_BASE_GLASS.some(w => n.includes(w))) guess.glass = LG_GLASS_DEFAULT_BASE;
    // טריפלקס שלא נאמר בשמו מאיזו זכוכית הוא — שקוף, כמו כל השאר
    else if (n.includes('טריפלקס')) guess.glass = LG_GLASS_DEFAULT_BASE;
  }

  if (n.includes('מחוסם')) guess.proc = 'chisum';
  else if (n.includes('מלוטש')) guess.proc = 'litush';

  if (n.includes('גרפיקה')) guess.graphic = true;

  // התזת חול. טריפלקס חלבי מגיע כבר חלבי מהספק ולא עובר במתיז — הדגל נשאר
  // false שם, וזו בדיוק הסיבה שטריפלקס חייב להיות דגל ולא מילה בשם.
  if (n.includes('חלבי')) guess.chalavi = !n.includes('טריפלקס');

  if (n.includes('טריפלקס')) guess.triplex = true;

  return guess;
}

async function getSkuCatalog() {
  const snap = await _lgDb.ref('skuCatalog').once('value');
  return snap.exists() ? Object.values(snap.val()) : [];
}

// האזנה בזמן אמת — מחזיר פונקציית ניתוק, אותו דפוס כמו listenAllPrices
function listenSkuCatalog(callback) {
  const ref     = _lgDb.ref('skuCatalog');
  const handler = snap => callback(snap.exists() ? Object.values(snap.val()) : []);
  ref.on('value', handler);
  return () => ref.off('value', handler);
}

// עריכה ידנית מלאה (מסך ניהול באדמין) — אדם, לא סנכרון אוטומטי, רשאי לגעת בכל שדה כולל תפעוליים.
async function saveSkuCatalogItem(code, fields) {
  const c = String(code || '').toUpperCase().trim();
  if (!c) throw new Error('saveSkuCatalogItem: קוד מק"ט חסר');
  const snap     = await _lgDb.ref('skuCatalog/' + c).once('value');
  const existing = snap.val() || {};
  const record   = _lgClean({
    ...existing, ...fields,
    code:      c,
    source:    fields.source || existing.source || 'manual',
    createdAt: existing.createdAt || Date.now(),
    updatedAt: Date.now()
  });
  await _lgDb.ref('skuCatalog/' + c).set(record);
  return c;
}

async function deleteSkuCatalogItem(code) {
  const c = String(code || '').toUpperCase().trim();
  if (!c) return;
  await _lgDb.ref('skuCatalog/' + c).remove();
}

// עתידי — ייקרא מפונקציית סנכרון חשבשבת כשתחובר. נוגע אך ורק בשדות עסקיים —
// גם אם businessFields יכיל בטעות glass/mm/proc/graphic, הם מסוננים ולא נכתבים.
async function syncSkuCatalogFromHashavshevet(code, businessFields) {
  const c = String(code || '').toUpperCase().trim();
  if (!c) return;
  const safe = {};
  LG_SKU_BUSINESS_FIELDS.forEach(k => { if (businessFields && businessFields[k] !== undefined) safe[k] = businessFields[k]; });
  safe.source = 'hashavshevet';
  const snap     = await _lgDb.ref('skuCatalog/' + c).once('value');
  const existing = snap.val() || {};
  // ברירת מחדל לשדות תפעוליים מתוך שם הפריט — רק לשדה שעדיין לא הוגדר בכלל (לא דורס עריכה קיימת).
  // זהו ניחוש טקסטואלי, לא ודאי — מסומן ב-opAuto כדי שיוצג כ"לא מאומת" עד לבדיקה ידנית (ר' saveSkuCatalogItem).
  const guess = lgGuessOperationalFromName(safe.name || existing.name || '');
  const opFill = {};
  LG_SKU_OPERATIONAL_FIELDS.forEach(k => { if (existing[k] === undefined && guess[k] !== undefined) opFill[k] = guess[k]; });
  if (Object.keys(opFill).length) opFill.opAuto = true;
  const record   = _lgClean({
    ...existing, ...safe, ...opFill,
    code:      c,
    createdAt: existing.createdAt || Date.now(),
    updatedAt: Date.now()
  });
  await _lgDb.ref('skuCatalog/' + c).set(record);
  return c;
}

// רזולוציה מאוחדת של קוד מק"ט מול קטלוג טעון-מראש (map: CODE -> record).
// null אם לא נמצא — הקורא נופל חזרה לקטלוג הישן שלו (IW_CODES וכו').
function lgResolveSkuCode(code, skuCatalogMap) {
  const c = String(code || '').toUpperCase().trim();
  const e = skuCatalogMap && skuCatalogMap[c];
  // בלי proc תפעולי אין מה להציג בבטחה — נופלים לקטלוג הישן (IW_CODES) אם יש שם הגדרה תקינה
  if (!e || e.active === false || !e.proc) return null;
  return {
    glass: e.glass, mm: e.mm, proc: e.proc,
    graphic: !!e.graphic,
    chalavi: !!e.chalavi,   // התזת חול — טיפול פנים, כמו גרפיקה
    triplex: !!e.triplex,   // משנה את המסלול: ר' lgNextStage
    label: e.name, sku: c, _fromCatalog: true
  };
}

// ─── 14ג. כרטיסי לקוח חשבשבת (hashavshevetAccounts) — תוספתי, מקביל ל-skuCatalog ──
//
//  hashavshevetAccounts/{KEY}  (KEY = "מפתח" הלקוח בחשבשבת, לדוגמה "14201")
//  עתידי: יתמלא מסנכרון דוח "כרטיסי לקוח" מחשבשבת (טלפון/מפתח/שם) — לא ידני.
//  ריק כברירת מחדל עד שהדוח יחובר.

async function getHashavshevetAccounts() {
  const snap = await _lgDb.ref('hashavshevetAccounts').once('value');
  return snap.exists() ? Object.values(snap.val()) : [];
}

function listenHashavshevetAccounts(callback) {
  const ref     = _lgDb.ref('hashavshevetAccounts');
  const handler = snap => callback(snap.exists() ? Object.values(snap.val()) : []);
  ref.on('value', handler);
  return () => ref.off('value', handler);
}

// עתידי — ייקרא מסנכרון דוח כרטיסי הלקוח. שדות עסקיים בלבד (שם/טלפון/מפתח/פעיל).
// ─── קריאות ל-API שלנו עם זהות המשתמש ───────────────────────────────────
//
//  ה-API בצד השרת בודק בעצמו שהקורא הוא אדמין (api/_verifyAdmin.js), ולכן
//  כל קריאה חייבת לשאת את ה-ID token. היו כאן רק ב-admin.html; משעה שגם
//  workday שולח וואטסאפ הם משותפים, כדי שלא ייווצר עותק שני שיתפצל.
async function _lgAuthFetch(url){
  const token = await (firebase.auth().currentUser && firebase.auth().currentUser.getIdToken());
  return fetch(url, { headers: token ? { Authorization: 'Bearer ' + token } : {} });
}

async function _lgAuthPost(url, payload){
  const token = await (firebase.auth().currentUser && firebase.auth().currentUser.getIdToken());
  return fetch(url, {
    method: 'POST',
    headers: Object.assign(
      { 'Content-Type': 'application/json' },
      token ? { Authorization: 'Bearer ' + token } : {}
    ),
    body: JSON.stringify(payload || {}),
  });
}

// ─── לאיזה מספר יוצאת ההודעה ללקוח ──────────────────────────────────────
//
//  מקור האמת הוא הטלפון בכרטיס הלקוח בחשבשבת. שם הוא מתוחזק, ומשם הוא
//  מסונכרן ל-hashavshevetAccounts.
//
//  order.phone הוא מה שהועתק להזמנה ביום שהיא נפתחה. הוא אינו מתעדכן כשהלקוח
//  מחליף מספר, ובהגשה מהפורטל הוא יכול להיות של מי שהעלה את הסקיצה ולא של
//  החשבון שמחויב. הודעה היא פעולה שיוצאת החוצה ואי אפשר להחזיר אותה, ולכן
//  היא צריכה לצאת למספר שבכרטיס.
//
//  מחזיר גם את המקור, כדי שהמסך יוכל להראות לפי מה נבחר המספר במקום להסתיר
//  את ההחלטה.
function lgResolveClientPhone(order, accountsMap, customerIdByPhone) {
  const normalize = p => String(p || '').replace(/[-\s]/g, '');
  const account   = k => (accountsMap || {})[String(k || '').trim()];

  // 1. מפתח החשבון שרשום על ההזמנה עצמה
  let acc = account(order && order.customerId);

  // 2. דרך המשתמש שמאחורי טלפון ההתחברות — אותה שרשרת שבה
  //    api/hashavshevet-order.js מוצא את מפתח החשבון
  if (!acc || !acc.phone) {
    const key = (customerIdByPhone || {})[normalize(order && (order.clientPhone || order.phone))];
    if (key) acc = account(key);
  }

  if (acc && acc.phone) {
    return { phone: normalize(acc.phone), source: 'hashavshevet', accountKey: acc.key || null };
  }

  // 3. אין כרטיס או שאין בו טלפון — נופלים למה שעל ההזמנה, ואומרים זאת
  const own = normalize(order && order.phone);
  return { phone: own, source: own ? 'order' : 'none', accountKey: null };
}

async function syncHashavshevetAccount(key, businessFields) {
  const k = String(key || '').trim();
  if (!k) return;
  const safe = {};
  ['name', 'phone', 'hashavshevetCode', 'active'].forEach(f => { if (businessFields && businessFields[f] !== undefined) safe[f] = businessFields[f]; });
  safe.source = 'hashavshevet';
  const snap     = await _lgDb.ref('hashavshevetAccounts/' + k).once('value');
  const existing = snap.val() || {};
  const record   = _lgClean({
    ...existing, ...safe,
    key:       k,
    createdAt: existing.createdAt || Date.now(),
    updatedAt: Date.now()
  });
  await _lgDb.ref('hashavshevetAccounts/' + k).set(record);
  return k;
}

// מחשב מ"ר כולל של כל פריטי ההזמנה (w,h במ"מ שלמים)
function lgCalcOrderM2(order){
  return Math.round(((order.items||[]).reduce((s,item)=>{
    return s + lgCalcAreaM2(item.w||0, item.h||0);
  }, 0)) * 100) / 100;
}

// globalP = { 'mir-5-pol': 200, ... }
// clientP = { 'clientName': { 'mir-5-pol': 180, ... }, ... }
function lgCalcOrderTotal(order, globalP, clientP){
  // מחיר נעול — ההזמנה כבר עברה ל-done/delivery/collected, המחיר קבוע
  if(order.totalFinal) return order.totalFinal;
  if(!(order.items||[]).length) return order.total||0;
  const cp = (clientP||{})[order.orderClient||'']||{};
  const gp = globalP||{};
  let total = 0;
  let priced = 0;
  (order.items||[]).forEach(item=>{
    const name = item.glassFullName||item.name||'';
    // item.sku מוטבע רק כשהפריט נוצר דרך skuCatalog (המקור החדש) — תמחור מדויק לפי מק"ט.
    // בלי sku (כל פריט קיים/ישן) — ממשיך בדיוק כמו היום, ניחוש קטגוריה לפי שם חופשי.
    const pid  = item.sku || lgFindPriceItem(name);
    if(!pid) return;
    const ppm2 = parseFloat(cp[pid]||gp[pid]||0);
    if(!ppm2) return;
    priced++;
    const area = lgCalcAreaM2(item.w||0, item.h||0);
    total += area * ppm2;
  });
  if(!priced) return order.total||0;
  return Math.round(total);
}

// ── lgLockAndAdvance: מעביר stage + נועל מחיר — write אטומי אחד ──────────
// זהו ה-API המומלץ לכל מעבר ל-done/delivery.
// מבטיח: אין מצב שבו done ללא totalFinal, ולא totalFinal בשלב הלא נכון.
// מחזיר { locked, unpricedNames } — unpricedNames מפורט רק כשהנעילה בפועל
// רצה עכשיו (הזמנה שכבר נעולה מחזירה locked:false, unpricedNames:[]).
// הקורא יכול להציג אזהרה אם unpricedNames לא ריק — במקום שהמחיר הנמוך-מדי
// ישקוט בשקט בתוך totalFinal בלי שאף אחד ידע שחלק מהפריטים לא תומחרו.
async function lgLockAndAdvance(orderId, order, globalP, clientP, nextStage){
  const status = lgStageToStatus(nextStage);
  const update = { stage: nextStage, status, updatedAt: Date.now() };
  const result = { locked: false, unpricedNames: [] };
  // נעל מחיר רק אם עדיין לא נעול. בודקים pricesLockedAt ולא totalFinal —
  // totalFinal יכול להיות באמת 0 (הזמנה שננעלה בלי אף פריט מתומחר), ואז
  // בדיקת !order.totalFinal הייתה מזהה זאת בטעות כ"עדיין לא ננעל" ונועלת שוב.
  if(!order.pricesLockedAt){
    result.locked = true;
    const cp = (clientP||{})[order.orderClient||'']||{};
    const gp = globalP||{};
    let total=0, priced=0;
    // מקבצים לפי quantityGroupId — כך שהזמנת "3 יחידות" (3 שורות זהות
    // מ-lgMakeQuantityGroup) ננעלת כשורה אחת עם quantity:3, לא 3 שורות נפרדות.
    const groups = lgGroupByQuantityId(order.items||[]);
    const lockedItems = [];
    groups.forEach(({quantityGroupId, items})=>{
      const rep  = items[0];
      const qty  = items.length;
      const name = rep.glassFullName||rep.name||'';
      const pid  = rep.sku || lgFindPriceItem(name); // item.sku (מ-skuCatalog) גובר כשקיים
      const ppm2 = pid ? parseFloat(cp[pid]||gp[pid]||0) : 0;
      if(!pid || !ppm2){ result.unpricedNames.push(name||'(ללא שם)'); return; }
      priced++;
      const area      = lgCalcAreaM2(rep.w||0, rep.h||0);
      const lineTotal = Math.round(area*ppm2*qty);
      total += lineTotal;
      lockedItems.push({ name, sku: rep.sku||pid, w:rep.w||0, h:rep.h||0, area, quantity:qty, quantityGroupId, pricePerM2:ppm2, lineTotal });
    });
    // תמיד נועל totalFinal — גם אם המחיר 0 (אין תמחור) כדי שהשדה תמיד יהיה ב-Firebase
    const finalTotal = (priced && total) ? total : (lgCalcOrderTotal(order, gp, cp) || order.total || 0);
    update.totalFinal     = finalTotal;
    update.totalM2        = lgCalcOrderM2(order);
    update.pricesLockedAt = Date.now();
    if(lockedItems.length) update.lockedItems = lockedItems;
  }
  await _lgDb.ref('orders/'+orderId).update(update);
  return result;
}

async function savePricesGlobal(prices){
  await _lgDb.ref('prices/global').set(prices||{});
}

function _buildClientP(rawClients, keyMap){
  const clientP = {};
  // לקוחות עם מחירים שמורים
  for(const [key, prices] of Object.entries(rawClients||{})){
    const name = keyMap[key]||key;
    clientP[name] = prices||{};
  }
  // לקוחות שנרשמו ב-clientKeys אך אין להם מחירים עדיין — מופיעים עם {} ריק
  for(const [key, name] of Object.entries(keyMap||{})){
    if(!clientP[name]) clientP[name] = {};
  }
  return clientP;
}

function listenAllPrices(callback){
  _lgDb.ref('prices').on('value', snap=>{
    const data = snap.val()||{};
    callback(data.global||{}, _buildClientP(data.clients, data.clientKeys));
  });
}

// לפורטל בלבד — קורא רק prices/global, לא את כל prices (שכולל היום גם
// צמתים אדמין-בלבד ב-Firebase Rules). אין יותר מחירי-לקוח מיוחדים, אז cp
// תמיד ריק — אותה התנהגות בפועל, בלי שהלקוח יזדקק להרשאת קריאה רחבה יותר.
function listenGlobalPrices(callback){
  _lgDb.ref('prices/global').on('value', snap => callback(snap.val()||{}, {}));
}

async function getAllPrices(){
  const snap = await _lgDb.ref('prices').once('value');
  const data  = snap.val()||{};
  return { globalP: data.global||{}, clientP: _buildClientP(data.clients, data.clientKeys) };
}

// ─── כלי מידות — חוק הפירוש המאושר ─────────────────────────────────────────
//
//  חוק הפירוש (מאושר):
//  • קלט עם נקודה  → מטרים × 1000   (.885 → 885,   1.95 → 1950, 3.5 → 3500)
//  • שלם ≤ 300     → ס"מ × 10        (195  → 1950,  44   → 440,  300 → 3000)
//  • שלם > 300     → מ"מ ישיר        (445  → 445,   885  → 885,  1957 → 1957)
//
//  הגבול 300 הוא לפירוש הקלט בלבד, לא גבול עסקי.
//  ולידציה עסקית כברירת מחדל: 1–5000 מ"מ.
//  שדות ספציפיים (ידית, ציר, recess) מגדירים גבולות משלהם בנפרד.

function lgParseDimensionInput(rawStr) {
  const s = String(rawStr ?? '').trim().replace(',', '.');
  if (!s) return { ok: false, error: 'יש להזין מידה' };

  const hasDecimal = s.includes('.');
  const n = parseFloat(s);

  if (isNaN(n) || !isFinite(n)) return { ok: false, error: 'יש להזין מספר תקין' };
  if (n <= 0) return { ok: false, error: 'יש להזין מידה חיובית' };

  let mm;
  if (hasDecimal) {
    mm = Math.round(n * 1000);
  } else {
    const intVal = Math.trunc(n);
    mm = intVal <= 300 ? intVal * 10 : intVal;
  }

  if (mm < 1)    return { ok: false, error: `מידה קטנה מדי (${mm} מ"מ)` };
  if (mm > 5000) return { ok: false, error: `מידה גדולה מדי — ${mm} מ"מ (מקסימום 5000 מ"מ)` };

  return { ok: true, mm };
}

// 885 → "0.885" / 1900 → "1.9" / 2000 → "2"  (לשדות עריכה — ללא trailing zeros)
function lgMmToMeterStr(mm) {
  if (mm == null || mm === '') return '';
  return (mm / 1000).toString();
}

// חישוב שטח — הפונקציה היחידה בכל המערכת (קלט: מ"מ שלמים, פלט: מ"ר ל-3 ספרות)
// lgCalcAreaM2(1900, 800) → 1.52    lgCalcAreaM2(885, 1200) → 1.062
function lgCalcAreaM2(widthMm, heightMm) {
  return Math.round((widthMm || 0) * (heightMm || 0) / 1000) / 1000;
}

// עיצוב מ"מ לתצוגה בכרטיסים (ללא יחידה — הקורא מוסיף " מ"מ")
function lgFormatMm(mm) { return String(mm || 0); }

// "195" → "195 → 1950 מ"מ"  /  "abc" → הודעת שגיאה  /  "" → ""
function lgDimPreviewText(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  const r = lgParseDimensionInput(s);
  return r.ok ? s + ' → ' + r.mm + ' מ"מ' : r.error;
}

// ─── כמות — יצירה וקיבוץ ────────────────────────────────────────────

// יוצר מערך של qty פריטים מ-baseItem עם quantityGroupId משותף.
// קרא רק בזמן יצירת פריטים חדשים — אל תקרא לפונקציה זו בעת עדכון/שינוי סטטוס/עריכה.
function lgMakeQuantityGroup(baseItem, qty) {
  const n = Math.max(1, Math.min(500, Math.round(Number(qty) || 1)));
  const groupId = 'grp_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
  const result = [];
  for (let i = 1; i <= n; i++) {
    result.push({ ...baseItem, quantityGroupId: groupId, originalQuantity: n, groupIndex: i });
  }
  return result;
}

// מקבל מערך פריטים, מחזיר מערך קבוצות לתצוגה בלבד — לא משנה את המקור.
// כל קבוצה: { quantityGroupId, items, rep } כאשר rep הוא הפריט הראשון.
// פריטים ללא quantityGroupId (ישן/ידני) מוצגים כקבוצה של יחידה אחת.
function lgGroupByQuantityId(items) {
  const groups = [];
  const seen = Object.create(null); // groupId → index in groups
  (items || []).forEach((item, rawIdx) => {
    const gid = item.quantityGroupId || ('__solo_' + rawIdx);
    if (gid in seen) {
      groups[seen[gid]].items.push(item);
    } else {
      seen[gid] = groups.length;
      groups.push({ quantityGroupId: item.quantityGroupId || null, items: [item], rep: item });
    }
  });
  return groups;
}

// ─── הודעת טעינה ─────────────────────────────────────────────────────
console.log('%c[LuzGlass] firebase-db.js v2.10 ✓', 'color:#b8922a;font-weight:bold');
console.log('  לבדיקת חיבור: lgTest()');
