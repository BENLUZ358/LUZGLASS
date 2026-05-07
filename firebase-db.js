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
  'done':      'מוכן לאיסוף',
  'collected': 'נאסף'
};

const LG_STATUS_TO_STAGE = {
  'ממתין לאישור':   '',
  'הזמנה חדשה':     '',
  'התקבלה':         '',
  'בתור שרטט':      'chash',
  'אצל שרטט':       'drafter',
  'מחכה ל-OptyWay': 'opty',
  'ב-OptyWay':      'opty',
  'ירד לביצוע':     'workday',
  'ביום עבודה':     'workday',
  'נשלח לחיסום':    'chisum',
  'בתחנת בדיקה':    'chisum',
  'חזר מחיסום':     'chisum',
  'מוכן לאיסוף':    'done',
  'נאסף':           'collected'
};

function lgStageToStatus(stage)  { return LG_STAGE_TO_STATUS[stage]  ?? LG_STAGE_TO_STATUS['']; }
function lgStatusToStage(status) { return LG_STATUS_TO_STAGE[status] ?? ''; }

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
  const record = _lgClean({
    ...data, id, stage, status,
    source:    data.source    || 'sketch',
    date:      data.date      || _lgToday(),
    createdAt: data.createdAt || Date.now(),
    updatedAt: Date.now()
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

  const record = _lgClean({
    ...data,
    id,
    stage:     '',
    status:    lgStageToStatus(''),
    source:    'upload',
    date:      now.toLocaleDateString('he-IL'),
    time:      now.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' }),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    // files כ-object (לא array)
    files:     Object.keys(filesObj).length ? filesObj : undefined,
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
function listenClientOrders(clientName, callback) {
  const ref     = _lgDb.ref('orders').orderByChild('orderClient').equalTo(clientName);
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
    workdayStatus: o.workdayStatus|| '',
    readyStatus:   o.readyStatus  || '',
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

// ─── כלי עזר פנימיים ─────────────────────────────────────────────────

function _lgClean(obj) {
  const r = {};
  for (const [k, v] of Object.entries(obj)) { if (v !== undefined) r[k] = v; }
  return r;
}

function _lgToday() { return new Date().toLocaleDateString('he-IL'); }

// ─── הודעת טעינה ─────────────────────────────────────────────────────
console.log('%c[LuzGlass] firebase-db.js v2.0 ✓', 'color:#b8922a;font-weight:bold');
console.log('  לבדיקת חיבור: lgTest()');
