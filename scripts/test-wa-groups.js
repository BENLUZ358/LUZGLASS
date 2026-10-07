#!/usr/bin/env node
/**
 * קבוצות WhatsApp (בן, 06/10). המקום לאמבט שולחים סקיצות מקבוצה עם כמה
 * מספרים, ומספר העסק חבר בה. הקבוצה מיועדת להזמנות בלבד, והעדכון
 * "הסקיצות טופלו" יוצא לקבוצה.
 *
 *   • קבוצה מקושרת ללקוח אחד — כל תמונה בה נרשמת עליו, מכל מספר
 *   • קבוצה לא מקושרת — נשמר שם הקבוצה בלבד (לא תוכן), כדי שאפשר לקשר
 *   • הקישור הוא ההרשאה של קבוצה; GREENAPI_INBOUND_ALLOWED נשאר לפרטי
 *   • העדכון יוצא ל-chatId של הקבוצה, ובשער: GREENAPI_ONLY_TO יכול להכיל
 *     גם קבוצה — ב-TEST קבוצה שלא ברשימה חסומה
 *   • קישור / ניתוק — רק דרך endpoint אדמיני, עם audit
 *
 * Run: node scripts/test-wa-groups.js
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

const inb  = require(path.join(ROOT, 'api', '_wa-inbound.js'));
const rcp  = require(path.join(ROOT, 'api', '_wa-recipient.js'));
const env  = require(path.join(ROOT, 'api', '_env.js'));
const prov = require(path.join(ROOT, 'api', '_wa-provider.js'));
const hook = require(path.join(ROOT, 'api', 'wa-inbound.js'));
const adm  = require(path.join(ROOT, 'api', 'wa-inbound-drain.js'));

const GROUP = '120363041234567890@g.us';
const GKEY  = inb.lgWaInboundKey(GROUP);
const NOW = 1759650005000;
const JPEG = Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0, 16]), Buffer.from('JFIF\0\x01\x01\0\0\x01\0\x01\0\0', 'binary'),
                            Buffer.from([0xFF, 0xDA, 0, 8, 1, 1, 0, 0, 63, 0, 0x12, 0x34, 0xFF, 0xD9])]);
const okFetch = async () => ({ ok: true, status: 200, headers: { get: () => String(JPEG.length) },
                               arrayBuffer: async () => JPEG.buffer.slice(JPEG.byteOffset, JPEG.byteOffset + JPEG.length) });
const groupHook = (over = {}) => ({
  typeWebhook: 'incomingMessageReceived', instanceData: { idInstance: 7100 }, timestamp: 1759650000,
  idMessage: 'G1', senderData: { chatId: GROUP, sender: '972521112222@c.us', chatName: 'המקום לאמבט — הזמנות', senderName: 'יוסי' },
  messageData: { typeMessage: 'imageMessage', fileMessageData: { downloadUrl: 'https://do-media.green-api.com/g.jpg', caption: 'מקלחון', mimeType: 'image/jpeg' } },
  ...over,
});
const seed = (extra) => fakeDb({
  meta: { orderCounter: 1041 },
  users: { '0502222222': { name: 'המקום לאמבט', businessName: 'המקום לאמבט', customerId: '14201', role: 'client' } },
  hashavshevetAccounts: { '14201': { key: '14201', name: 'המקום לאמבט בע"מ', phone: '050-222-2222' } },
  ...(extra || {}),
});
const linked = () => ({ waGroups: { [GKEY]: { chatId: GROUP, name: 'המקום לאמבט — הזמנות', customerId: '14201', customerName: 'המקום לאמבט בע"מ' } } });

(async () => {

// ═══ 1. סינון ════════════════════════════════════════════════════════
{
  const p = inb.lgWaInboundParse(groupHook());
  check('1a an image in a group is recorded', p.action, 'record');
  check('1a with the group and who in it sent it',
        [p.entry.chatId, p.entry.groupId, p.entry.groupName, p.entry.sender], [GROUP, GROUP, 'המקום לאמבט — הזמנות', '0521112222']);
  check('1b text in a group is still ignored', inb.lgWaInboundParse(groupHook({ messageData: { typeMessage: 'textMessage' } })).action, 'ignore');
  const lid = inb.lgWaInboundParse(groupHook({ senderData: { chatId: GROUP, sender: '99887766@lid' } }));
  check('1c a hidden (lid) member still counts — the group is what identifies', [lid.action, lid.entry.sender], ['record', '']);
  check('1d a private chat has no group — and its record keeps its old shape',
        'groupId' in inb.lgWaInboundParse(groupHook({ senderData: { chatId: '972521112222@c.us' } })).entry, false);
}

// ═══ 2. ה-webhook ═════════════════════════════════════════════════════
const ENV = { FIREBASE_SERVICE_ACCOUNT: JSON.stringify({ project_id: 'luz-glass-test' }), GREENAPI_WEBHOOK_TOKEN: 'hs',
              GREENAPI_ID_INSTANCE: '7100', GREENAPI_INBOUND_ALLOWED: 'luz-glass-test:0547725552' };
const withEnv = async (vars, fn) => {
  const keep = {}; for (const k of Object.keys(vars)) { keep[k] = process.env[k]; process.env[k] = vars[k]; }
  try { return await fn(); } finally { for (const k of Object.keys(vars)) { if (keep[k] === undefined) delete process.env[k]; else process.env[k] = keep[k]; } }
};
const req = body => ({ method: 'POST', headers: { authorization: 'Bearer hs' }, body });
{
  const db = seed();
  const r = await withEnv(ENV, () => hook.handleInbound(req(groupHook()), { db, waitUntil: () => {}, now: NOW, fetchImpl: okFetch }));
  check('2a an unlinked group: 200 and nothing recorded', [r.status, db._data.waInbound], [200, undefined]);
  const seen = (db._data.waMeta || {}).groupsSeen || {};
  check('2a but the group is noted so it can be linked', seen[GKEY] && [seen[GKEY].chatId, seen[GKEY].name, seen[GKEY].count], [GROUP, 'המקום לאמבט — הזמנות', 1]);
  check('2a and only its name — no image, no link, no caption', Object.keys(seen[GKEY]).sort(), ['chatId', 'count', 'lastAt', 'name']);
  await withEnv(ENV, () => hook.handleInbound(req(groupHook({ idMessage: 'G2' })), { db, waitUntil: () => {}, now: NOW + 5 }));
  check('2b a second message counts up', db._data.waMeta.groupsSeen[GKEY].count, 2);
}
{
  const db = seed(linked());
  const later = [];
  const r = await withEnv(ENV, () => hook.handleInbound(req(groupHook()), { db, waitUntil: p => later.push(p), now: NOW, fetchImpl: okFetch }));
  await Promise.all(later);
  check('2c a linked group is recorded — its member needs no private allow-list entry', [r.status, !!(db._data.waInbound || {}).G1], [200, true]);
  const o = (db._data.orders || {}).wa_G1_1 || {};
  check('2d the sketch lands on the linked customer', [o.customerId, o.orderClient, o.waUnassigned], ['14201', 'המקום לאמבט בע"מ', undefined]);
  check('2d with its portal login, so it shows in their portal', o.clientPhone, '0502222222');
  check('2d and remembers the group, for the update', [o.waGroup, o.waGroupName, o.waSender], [GROUP, 'המקום לאמבט — הזמנות', '0521112222']);
  check('2e the intake log says how it was matched', db._data.waInbound.G1.clientMatch.via, 'group');
}

// ═══ 3. לאן יוצא העדכון ═══════════════════════════════════════════════
{
  const db = seed(linked());
  const GO = { waGroup: GROUP, customerId: '14201', clientPhone: '0502222222' };
  const g = await rcp.resolveRecipient(db, GO, 'sketches-handled');
  check('3a "sketches handled" on a group order goes to the group', g, { phone: GROUP, source: 'group', accountKey: '14201' });
  check('3a but "ready for pickup" on the same order stays private, as today',
        await rcp.resolveRecipient(db, GO, 'ready'), await rcp.resolvePhone(db, GO));
  const un = await rcp.resolveRecipient(fakeDb({}), { waGroup: GROUP, customerId: '14201' }, 'sketches-handled');
  check('3b a group that was unlinked gets nothing', [un.phone, un.source], ['', 'group-unlinked']);
  const priv = await rcp.resolveRecipient(db, { customerId: '14201', phone: '0502222222' });
  check('3c a private order resolves exactly as before', priv, await rcp.resolvePhone(db, { customerId: '14201', phone: '0502222222' }));

  check('3d the GREEN API chat id for a group is the group itself', prov.lgWaChatId(GROUP), GROUP);
  check('3d and a phone still becomes 972…@c.us', prov.lgWaChatId('0502222222'), '972502222222@c.us');
  check('3d anything else that claims to be a group is refused', prov.lgWaChatId('evil@g.us/x'), '');

  const gate = (only, phone) => withEnv({ FIREBASE_SERVICE_ACCOUNT: JSON.stringify({ project_id: 'luz-glass-test' }),
    WA_PROVIDER: 'green', GREENAPI_ID_INSTANCE: '1', GREENAPI_TOKEN: 't',
    GREENAPI_ALLOWED_ACCOUNTS: 'luz-glass-test:14201', GREENAPI_ONLY_TO: only },
    () => env.lgGreenApiGate({ phone, accountKey: '14201' }).allowed);
  check('3e TEST: a group on the ONLY_TO list may receive', await gate('0547725552,' + GROUP, GROUP), true);
  check('3e TEST: a group not on it may not', await gate('0547725552', GROUP), false);
  check('3e the private number on the same list still works', await gate('0547725552,' + GROUP, '0547725552'), true);
}

// ═══ 4. קישור קבוצה ללקוח ═══════════════════════════════════════════
{
  const db = seed({ waMeta: { groupsSeen: { [GKEY]: { chatId: GROUP, name: 'המקום לאמבט — הזמנות', count: 1, lastAt: NOW } } } });
  const act = body => adm.handleAdmin(body, { db, by: '0520000000', now: NOW + 10 });
  const r = await act({ action: 'link-group', key: GKEY, customerId: '14201' });
  const m = (db._data.waGroups || {})[GKEY];
  check('4a linking writes the mapping', [r.ok, m && m.customerId, m && m.customerName, m && m.chatId], [true, '14201', 'המקום לאמבט בע"מ', GROUP]);
  check('4a with who and when', [m.linkedBy, m.linkedAt], ['0520000000', NOW + 10]);
  check('4a and an audit line', Object.values(m.audit || {}).map(a => [a.action, a.by, a.customerId]), [['link', '0520000000', '14201']]);
  check('4b an unknown customer is refused', (await act({ action: 'link-group', key: GKEY, customerId: '99999' })).ok, false);
  check('4b a group never seen is refused', (await act({ action: 'link-group', key: 'nope', customerId: '14201' })).ok, false);
  const u = await act({ action: 'unlink-group', key: GKEY });
  check('4c unlinking removes the mapping', [u.ok, (db._data.waGroups || {})[GKEY]], [true, undefined]);
  check('4c but the group stays in the seen list, to link again', !!db._data.waMeta.groupsSeen[GKEY], true);
}

// ═══ 5. נתונים, חוקים, דפדפן ══════════════════════════════════════════
{
  const SRC = fs.readFileSync(path.join(ROOT, 'firebase-db.js'), 'utf8');
  const norm = SRC.match(/function lgNormalizeOrder[\s\S]*?\n}/)[0];
  check('5a the order carries the group to every screen', /waGroup:/.test(norm) && /waGroupName:/.test(norm), true);
  const ctx = {}; vm.createContext(ctx);
  vm.runInContext(SRC.match(/function lgSketchAckClientKey[\s\S]*?\n}/)[0], ctx);
  check('5b updates group by the WhatsApp group first', ctx.lgSketchAckClientKey({ waGroup: GROUP, customerId: '14201' }), 'g:' + GROUP);
  const RULES = JSON.parse(fs.readFileSync(path.join(ROOT, 'database.rules.json'), 'utf8')).rules;
  check('5c the group mapping: admin-read, no browser writes', [!!RULES.waGroups, RULES.waGroups && RULES.waGroups['.write']], [true, false]);
  check('5c a client cannot point an order at a group', RULES.orders.$orderId['.write'].includes("!newData.hasChild('waGroup')"), true);
  const D = fs.readFileSync(path.join(ROOT, 'api', 'whatsapp-dispatch.js'), 'utf8');
  const DR = fs.readFileSync(path.join(ROOT, 'api', 'whatsapp-drain.js'), 'utf8');
  check('5d dispatch and drain both resolve through resolveRecipient, with the kind',
        /resolveRecipient\(db, x\.order, kind\)/.test(D) && /resolveRecipient\(db, order, entry\.kind\)/.test(DR), true);
  const P = fs.readFileSync(path.join(ROOT, 'wa-inbound-panel.js'), 'utf8');
  check('5e the intake panel lists groups to link', /link-group/.test(P) && /waMeta\/groupsSeen/.test(P), true);
  /* 07/10 (בן באייפון): "לא נותן אופציה לבחור לקוח". datalist ב-iOS מציג
     הצעות רק מעל המקלדת ורק כשיש התאמה — ונראה כמו שדה שלא עושה כלום. */
  check('5f the customer is chosen from a visible list, not a datalist', /datalist/.test(P), false);
  check('5f the list sits under the field', /wain-acc-list/.test(P), true);
  check('5f no match says so, instead of silence', /לא נמצא כרטיס/.test(P), true);
  check('5f typing is not wiped by a live refresh', /activeElement/.test(P), true);
}

  if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
  console.log('\nAll WhatsApp group checks passed.');
})().catch(e => { console.error('FAIL  crashed:', e && e.stack || e); process.exit(1); });
