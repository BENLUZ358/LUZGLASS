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

// ─── חישוב השלב הבא — לוגיקה דינמית לפי פריטים + לקוח הובלות ──────
//  שני מקורות לזיהוי לקוח הובלות (OR — מספיק שאחד מהם נכון):
//    1. order.deliveryClient = true  (denormalized על ההזמנה)
//    2. isDelivery = true            (מה-cache של משתמשים בworkday.html)
function lgNextStage(order, isDelivery) {
  const items      = order.items || [];
  const hasChisum  = items.some(i => !!i.chisum);
  const hasGraphic = items.some(i => _lgItemHasGraphic(i));
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

async function saveOrder(data) {
  const id     = data.id || ('ord_' + Date.now());
  const stage  = data.stage ?? lgStatusToStage(data.status || '') ?? '';
  const status = lgStageToStatus(stage);
  const normPhone = _lgNormalizePhone(data.phone || '');
  const record = _lgClean({
    ...data, id, stage, status,
    phone:         normPhone,
    clientPhone:   normPhone,
    paymentStatus: data.paymentStatus || 'unpaid',
    source:        data.source        || 'sketch',
    date:          data.date          || _lgToday(),
    createdAt:     data.createdAt     || Date.now(),
    updatedAt:     Date.now()
  });
  await _lgDb.ref('orders/' + id).set(record);
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
  const record = _lgClean({
    ...data,
    id,
    stage:         '',
    status:        lgStageToStatus(''),
    phone:         normPhone,
    clientPhone:   normPhone,
    paymentStatus: 'unpaid',
    source:        'upload',
    date:          now.toLocaleDateString('he-IL'),
    time:          now.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' }),
    createdAt:     Date.now(),
    updatedAt:     Date.now(),
    files:         Object.keys(filesObj).length ? filesObj : undefined,
  });

  await _lgDb.ref('orders/' + id).set(record);
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
function listenAllOrders(callback) {
  const ref     = _lgDb.ref('orders');
  const handler = snap => {
    if (!snap.exists()) { callback([]); return; }
    callback(Object.values(snap.val()).map(lgNormalizeOrder).filter(Boolean));
  };
  ref.on('value', handler);
  return () => ref.off('value', handler);
}

// האזנה לפי לקוח — לפורטל
// מסנן client-side (לא server-side) כדי שעדכוני status בזמן אמת יגיעו תמיד
function listenClientOrders(clientName, callback) {
  const ref     = _lgDb.ref('orders');
  const handler = snap => {
    if (!snap.exists()) { callback([]); return; }
    const all = Object.values(snap.val()).map(lgNormalizeOrder).filter(Boolean);
    callback(all.filter(o => o.orderClient === clientName));
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

async function saveWorkDay(data) {
  await _lgDb.ref('workday').set(_lgClean({ ...data, updatedAt: Date.now() }));
}

// ─── 7. לקוחות ────────────────────────────────────────────────────────

async function getAllClients() {
  const snap = await _lgDb.ref('clients').once('value');
  if (!snap.exists()) return [];
  return Object.values(snap.val());
}

async function saveClient(data) {
  const id = data.id || ('c_' + Date.now());
  await _lgDb.ref('clients/' + id).set({ ...data, id });
  return id;
}

async function getClientByPhone(phone) {
  const snap = await _lgDb.ref('clients').orderByChild('phone').equalTo(phone).once('value');
  if (!snap.exists()) return null;
  return Object.values(snap.val())[0];
}

// ─── 8. Session ───────────────────────────────────────────────────────

function lgGetSession()      { try { return JSON.parse(sessionStorage.getItem('lgSession') || '{}'); } catch(e) { return {}; } }
function lgSetSession(data)  { sessionStorage.setItem('lgSession', JSON.stringify(data)); }
function lgClearSession()    { sessionStorage.removeItem('lgSession'); }
function lgRequireAuth(role) {
  const s = lgGetSession();
  if (!s.role) { window.location.href = 'login.html'; return null; }
  if (role && s.role !== role && s.role !== 'admin') { window.location.href = 'login.html'; return null; }
  return s;
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
    source:        o.source       || 'sketch',
    urgent:        o.urgent       || false,
    sketch:        o.sketch       || null,
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
    chisumArrivedIdxs: o.chisumArrivedIdxs
      ? Object.keys(o.chisumArrivedIdxs).map(Number)
      : [],
    deliveryClient: !!o.deliveryClient,
    createdAt:     o.createdAt    || 0,
    updatedAt:     o.updatedAt    || 0,
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

function _lgNormalizePhone(p){ return String(p||'').replace(/[-\s]/g,''); }

// אתחל אדמין ראשי (נקרא בעמוד login בלבד)
async function lgInitMainAdmin() {
  const phone = LG_MAIN_ADMIN_PHONE;
  const snap  = await _lgDb.ref('users/' + phone).once('value');
  const ex    = snap.val();
  if (!ex || ex.role !== 'admin' || !ex.isMainAdmin || ex.password !== '781578') {
    await _lgDb.ref('users/' + phone).set({
      id:          phone,
      name:        'בן לוז',
      phone,
      password:    '781578',
      role:        'admin',
      isMainAdmin: true,
      createdAt:   ex?.createdAt || Date.now(),
      updatedAt:   Date.now()
    });
    console.log('[LuzGlass] אדמין ראשי נכתב / עודכן');
  }
}

// התחברות — GET ישיר לפי טלפון, ללא סריקה
async function lgLoginByPhone(phone, password) {
  const p    = _lgNormalizePhone(phone);
  const snap = await _lgDb.ref('users/' + p).once('value');
  if (!snap.exists()) return null;
  const u = snap.val();
  return String(u.password) === String(password) ? u : null;
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

// מחיקת משתמש (אדמין ראשי מוגן)
async function lgDeleteUser(id) {
  const phone = _lgNormalizePhone(id);
  if (!phone || phone === LG_MAIN_ADMIN_PHONE)
    throw new Error('לא ניתן למחוק את האדמין הראשי');
  await _lgDb.ref('users/' + phone).remove();
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

function _lgPriceKey(name){ return String(name||'').replace(/[.#$\[\]\/]/g,'_'); }

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
  const map={4:'cl-4-pol',5:'cl-5-pol',6:'cl-6-pol',8:'cl-8-pol',10:'cl-10-pol',12:'cl-12-pol'};
  return map[mm]||'cl-8-pol';
}

// מחשב מ"ר כולל של כל פריטי ההזמנה
function lgCalcOrderM2(order){
  return Math.round(((order.items||[]).reduce((s,item)=>{
    return s + ((item.w||0)/100)*((item.h||0)/100);
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
    const pid  = lgFindPriceItem(name);
    if(!pid) return;
    const ppm2 = parseFloat(cp[pid]||gp[pid]||0);
    if(!ppm2) return;
    priced++;
    const area = ((item.w||0)/100)*((item.h||0)/100);
    total += area * ppm2;
  });
  if(!priced) return order.total||0;
  return Math.round(total);
}

// ── lgLockAndAdvance: מעביר stage + נועל מחיר — write אטומי אחד ──────────
// זהו ה-API המומלץ לכל מעבר ל-done/delivery.
// מבטיח: אין מצב שבו done ללא totalFinal, ולא totalFinal בשלב הלא נכון.
async function lgLockAndAdvance(orderId, order, globalP, clientP, nextStage){
  const status = lgStageToStatus(nextStage);
  const update = { stage: nextStage, status, updatedAt: Date.now() };
  // נעל מחיר רק אם עדיין לא נעול
  if(!order.totalFinal){
    const cp = (clientP||{})[order.orderClient||'']||{};
    const gp = globalP||{};
    let total=0, priced=0;
    const items = order.items||[];
    const lockedItems = [];
    items.forEach(item=>{
      const name = item.glassFullName||item.name||'';
      const pid  = lgFindPriceItem(name);
      if(!pid) return;
      const ppm2 = parseFloat(cp[pid]||gp[pid]||0);
      if(!ppm2) return;
      priced++;
      const area = Math.round(((item.w||0)/100)*((item.h||0)/100)*1000)/1000;
      const lineTotal = Math.round(area*ppm2);
      total += lineTotal;
      lockedItems.push({ name, sku: item.sku||pid, w:item.w||0, h:item.h||0, area, pricePerM2:ppm2, lineTotal });
    });
    // תמיד נועל totalFinal — גם אם המחיר 0 (אין תמחור) כדי שהשדה תמיד יהיה ב-Firebase
    const finalTotal = (priced && total) ? total : (lgCalcOrderTotal(order, gp, cp) || order.total || 0);
    update.totalFinal     = finalTotal;
    update.totalM2        = lgCalcOrderM2(order);
    update.pricesLockedAt = Date.now();
    if(lockedItems.length) update.lockedItems = lockedItems;
  }
  await _lgDb.ref('orders/'+orderId).update(update);
}

// lgLockPrice — שומר תאימות לאחור; מומלץ להשתמש ב-lgLockAndAdvance
async function lgLockPrice(orderId, order, globalP, clientP){
  if(order.totalFinal) return;
  const total = lgCalcOrderTotal(order, globalP, clientP);
  if(!total) return;
  const m2 = lgCalcOrderM2(order);
  await _lgDb.ref('orders/'+orderId).update({
    totalFinal:      total,
    totalM2:         m2,
    pricesLockedAt:  Date.now()
  });
}

async function savePricesGlobal(prices){
  await _lgDb.ref('prices/global').set(prices||{});
}

async function saveClientPrices(clientName, prices){
  const key = _lgPriceKey(clientName);
  await _lgDb.ref('prices/clients/'+key).set(prices||{});
  await _lgDb.ref('prices/clientKeys/'+key).set(clientName);
}

function listenAllPrices(callback){
  _lgDb.ref('prices').on('value', snap=>{
    const data = snap.val()||{};
    const globalP  = data.global||{};
    const rawClients = data.clients||{};
    const keyMap   = data.clientKeys||{};
    const clientP  = {};
    for(const [key, prices] of Object.entries(rawClients)){
      const name = keyMap[key]||key;
      clientP[name] = prices;
    }
    callback(globalP, clientP);
  });
}

async function getAllPrices(){
  const snap = await _lgDb.ref('prices').once('value');
  const data  = snap.val()||{};
  const globalP  = data.global||{};
  const rawClients = data.clients||{};
  const keyMap   = data.clientKeys||{};
  const clientP  = {};
  for(const [key, prices] of Object.entries(rawClients)){
    const name = keyMap[key]||key;
    clientP[name] = prices;
  }
  return { globalP, clientP };
}

// ─── הודעת טעינה ─────────────────────────────────────────────────────
console.log('%c[LuzGlass] firebase-db.js v2.6 ✓', 'color:#b8922a;font-weight:bold');
console.log('  לבדיקת חיבור: lgTest()');
