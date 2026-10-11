#!/usr/bin/env node
/**
 * שלב 6 — "הסקיצות טופלו" ללקוח (החלטות בן 2026-10-06, אפיון §16).
 *
 *   A. נוסח ההודעה — המילים של בן, ביחיד וברבים
 *   B. החותמת נכתבת ל-sketchAck, ולא דורסת את "מוכן לאיסוף" (whatsapp)
 *   C. השרת שולח רק מה שמותר: WhatsApp, טופל, לא עודכן, לא פיקטיבי,
 *      ולא נמצא כבר בהודעה פעילה / שנשלחה מאותו סוג
 *   D. הדפדפן: קיבוץ לפי לקוח, "יש עוד סקיצות", ומה ממתין לעדכון
 *   E. החיבור באדמין, והשומר "Admin לא שולח" מצומצם — לא מבוטל
 *
 * Run: node scripts/test-wa-sketch-ack.js
 */
const fs   = require('fs');
const path = require('path');
const vm   = require('vm');
const ROOT = path.join(__dirname, '..');
const { fakeDb } = require(path.join(__dirname, '_fake-db.js'));

let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));

(async () => {

// ═══ A. הנוסח ════════════════════════════════════════════════════════
{
  const { renderText } = require(path.join(ROOT, 'api', '_wa-provider.js'));
  const many = renderText({ kind: 'sketches-handled', clientName: 'המקום לאמבט', orderNums: ['L9012', 'L9013', 'L9014'] });
  check('A1 several: Ben\'s sentence, numbers in a row',
        many.includes('ההזמנות: L9012, L9013, L9014 עברו סינון ראשוני, מתחילים לעבוד עליהן.'), true);
  check('A1 opens with the client name', many.startsWith('שלום המקום לאמבט,'), true);
  check('A1 and signs like every other message', many.includes('לוז זגגות ומראות האחים בע"מ'), true);
  const one = renderText({ kind: 'sketches-handled', clientName: 'X', orderNums: ['L9012'] });
  check('A2 one: singular', one.includes('ההזמנה L9012 עברה סינון ראשוני, מתחילים לעבוד עליה.'), true);
  check('A3 never falls through to "ready for pickup"', /מוכנ/.test(many + one), false);
}

// ═══ B. איפה נרשמת החותמת ════════════════════════════════════════════
{
  const ob = require(path.join(ROOT, 'api', '_wa-outbox.js'));
  check('B1 sketches-handled stamps sketchAck', ob.lgWaStampField('sketches-handled'), 'sketchAck');
  check('B1 ready still stamps whatsapp', ob.lgWaStampField('ready'), 'whatsapp');
  check('B1 dispatched still stamps whatsappDispatch', ob.lgWaStampField('dispatched'), 'whatsappDispatch');
  check('B1 the new kind never overwrites "ready for pickup"', ob.lgWaStampField('sketches-handled') !== 'whatsapp', true);
  const DRAIN = fs.readFileSync(path.join(ROOT, 'api', 'whatsapp-drain.js'), 'utf8');
  check('B2 the drain uses the map, not the old two-way choice',
        /const field = lgWaStampField\(entry\.kind\);/.test(DRAIN), true);
  check('B3 a different kind is a different message', ob.lgWaMsgKey('sketches-handled', ['a']) !== ob.lgWaMsgKey('ready', ['a']), true);
}

// ═══ C. מה השרת מסכים לשלוח ══════════════════════════════════════════
{
  const sa = require(path.join(ROOT, 'api', '_wa-sketch-ack.js'));
  const ok = { source: 'whatsapp', sketchSeenAt: 5 };
  check('C1 a handled WhatsApp sketch is sent', sa.lgSketchAckSkip(ok, 'o1', new Set()), null);
  check('C2 a portal sketch is not (D3)', !!sa.lgSketchAckSkip({ ...ok, source: 'upload' }, 'o1', new Set()), true);
  check('C2 nor one not marked handled', !!sa.lgSketchAckSkip({ source: 'whatsapp' }, 'o1', new Set()), true);
  check('C2 nor one already updated', !!sa.lgSketchAckSkip({ ...ok, sketchAck: { sentAt: 9 } }, 'o1', new Set()), true);
  check('C2 a failed attempt is not "updated"', sa.lgSketchAckSkip({ ...ok, sketchAck: { sentAt: null, attemptedAt: 9 } }, 'o1', new Set()), null);
  check('C2 nor a test order', !!sa.lgSketchAckSkip({ ...ok, isTest: true }, 'o1', new Set()), true);
  check('C2 nor one already in a message on its way', !!sa.lgSketchAckSkip(ok, 'o1', new Set(['o1'])), true);

  const db = fakeDb({ waOutbox: {
    k1: { kind: 'sketches-handled', state: 'pending', orderIds: ['a', 'b'], createdAt: 1 },
    k2: { kind: 'sketches-handled', state: 'sent',    orderIds: ['c'],      createdAt: 2 },
    k3: { kind: 'sketches-handled', state: 'failed',  orderIds: ['d'], attempts: 1, createdAt: 3 },
    k4: { kind: 'sketches-handled', state: 'expired', orderIds: ['e'],      createdAt: 4 },
    k5: { kind: 'ready',            state: 'pending', orderIds: ['f'],      createdAt: 5 },
  } });
  const ids = [...await sa.lgSketchAckActiveIds(db)].sort();
  check('C3 orders in a pending, retrying or sent update are taken', ids, ['a', 'b', 'c', 'd']);
  check('C3 an expired one is free again — the customer never got it', ids.includes('e'), false);
  check('C3 another kind does not count', ids.includes('f'), false);

  const D = fs.readFileSync(path.join(ROOT, 'api', 'whatsapp-dispatch.js'), 'utf8');
  check('C4 dispatch accepts the new kind', /'sketches-handled'/.test(D), true);
  check('C4 and filters through lgSketchAckSkip', /lgSketchAckSkip\(/.test(D) && /lgSketchAckActiveIds\(/.test(D), true);
  check('C4 an unknown kind still falls back to dispatched, as before',
        /: 'dispatched'/.test(D), true);
}

// ═══ D. הדפדפן ════════════════════════════════════════════════════════
{
  const SRC = fs.readFileSync(path.join(ROOT, 'firebase-db.js'), 'utf8');
  const grab = n => (SRC.match(new RegExp('function ' + n + '[\\s\\S]*?\\n}')) || [''])[0];
  const ctx = {}; vm.createContext(ctx);
  vm.runInContext(['lgSketchAckClientKey', 'lgSketchAckPending', 'lgSketchAckUnseen'].map(grab).join('\n'), ctx);
  const O = [
    { id: '1', source: 'whatsapp', stage: '', customerId: '14201', orderClient: 'המקום לאמבט', sketchSeenAt: 5, orderNum: 'L1' },
    { id: '2', source: 'whatsapp', stage: '', customerId: '14201', orderClient: 'המקום לאמבט', sketchSeenAt: 6, orderNum: 'L2' },
    { id: '3', source: 'whatsapp', stage: '', customerId: '14201', orderClient: 'המקום לאמבט', orderNum: 'L3' },
    { id: '4', source: 'whatsapp', stage: '', customerId: '14201', orderClient: 'המקום לאמבט', sketchSeenAt: 7, sketchAck: { sentAt: 8 } },
    { id: '5', source: 'upload',   stage: '', customerId: '14201', orderClient: 'המקום לאמבט', orderNum: 'L5' },
    { id: '6', source: 'whatsapp', stage: '', clientPhone: '0533334444', waUnassigned: true, orderClient: 'לא מזוהה', sketchSeenAt: 9 },
    { id: '7', source: 'whatsapp', stage: 'chash', customerId: '14201', orderClient: 'המקום לאמבט', sketchSeenAt: 4 },
    { id: '8', source: 'whatsapp', stage: '', customerId: '14201', isTest: true, sketchSeenAt: 3 },
  ];
  const groups = JSON.parse(JSON.stringify(ctx.lgSketchAckPending(O)));
  const g = groups.find(x => x.key === 'c:14201');
  check('D1 handled, not yet updated, grouped per client — stage does not matter', g && g.ids.sort(), ['1', '2', '7']);
  check('D1 test orders and already-updated ones are left out', g.ids.includes('8') || g.ids.includes('4'), false);
  const u = groups.find(x => x.ids.includes('6'));
  check('D2 an unassigned sender is listed, but marked — it cannot be sent', u && u.unassigned, true);
  check('D3 unseen WhatsApp sketches of the same client, the open one excluded',
        JSON.parse(JSON.stringify(ctx.lgSketchAckUnseen(O, 'c:14201', '1'))).map(o => o.id), ['3']);
  check('D3 portal sketches do not count as "more"', ctx.lgSketchAckUnseen(O, 'c:14201', '1').some(o => o.id === '5'), false);
}

// ═══ E. האדמין ════════════════════════════════════════════════════════
{
  const A = fs.readFileSync(path.join(ROOT, 'admin.html'), 'utf8');
  const live = A.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '');
  const seen = (A.match(/function sqMarkSeen\(\)\{[\s\S]*?\n}/) || [''])[0];
  check('E1 marking handled hands over to the update flow', /_sqAfterSeen\(/.test(seen), true);
  check('E1 and the mark itself is still written first, on its own', /updateOrder\(id, \{ sketchSeenAt: now \}\)/.test(seen), true);
  const calls = [...live.matchAll(/_lgAuthPost\('\/api\/whatsapp-dispatch',\s*\{([^}]*)\}/g)].map(m => m[1]);
  check('E2 admin calls dispatch from exactly one place', calls.length, 1);
  check('E2 and only for sketches-handled', calls.every(c => /kind:\s*'sketches-handled'/.test(c)), true);
  check('E3 the "more sketches" question exists', /id="sqAckAsk"/.test(A) && /לטפל בהן עכשיו/.test(A), true);
  check('E4 the waiting-for-update strip exists', /id="sqAckPending"/.test(A), true);
}

  if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
  console.log('\nAll sketch-update checks passed.');
})().catch(e => { console.error('FAIL  crashed:', e && e.stack || e); process.exit(1); });
