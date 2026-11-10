#!/usr/bin/env node
/**
 * מרכזן — הצעת צרופות (בן, 10/11).
 * אפיון: docs/superpowers/specs/2026-11-10-markazan-intake-ack-design.md §2
 *
 *   A. האיחוד בשרת = אותו איחוד כמו בדפדפן (lgAttCanMerge / lgAttMergePlan)
 *   B. lgAttMergeServer — k מהמונה בטרנזקציה, עדכון אחד, attachedBy:'markazan'
 *   C. הסיווג — מודל הסוכנים, תמונה מוקטנת, סיווג בלבד; כל כשל → "לא בטוח"
 *   D. ההקטנה (512 פיקסלים, JPEG)
 *   E. לאיזו הזמנה מציעים — הסקיצה האחרונה של הלקוח לפניה (הסבב / 24 שעות)
 *   F. ההצעה על ההזמנה, החדר, העלות; 5 "צרף" ברצף → מצרף לבד
 *   G. צרף / לא → הלמידה; "לא" אחד מאפס
 *   H. הנתיב לאדמין (wa-inbound-drain, attach-answer)
 *   I. הדפדפן — התג בתור
 *   J. מחובר לקליטה (וואטסאפ), מאחורי ATTACH_SUGGEST_ENABLED
 *
 * Run: node scripts/test-attach-suggest.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.join(__dirname, '..');
const { fakeDb } = require(path.join(__dirname, '_fake-db.js'));

let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));
const J = x => JSON.parse(JSON.stringify(x));
const withEnv = async (vars, fn) => {
  const keep = {}; for (const k of Object.keys(vars)) { keep[k] = process.env[k]; if (vars[k] === undefined) delete process.env[k]; else process.env[k] = vars[k]; }
  try { return await fn(); }
  finally { for (const k of Object.keys(vars)) { if (keep[k] === undefined) delete process.env[k]; else process.env[k] = keep[k]; } }
};

//  הדפדפן (order-attachments.js) ב-vm
const ctx = { console };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'order-attachments.js'), 'utf8'), ctx);
const B = vm.runInContext('({ lgAttCanMerge, lgAttMergePlan, lgAttSlides, lgAttSuggestText: typeof lgAttSuggestText === "function" ? lgAttSuggestText : null })', ctx);

const S = require(path.join(ROOT, 'api', '_order-attachments.js'));
const AS = require(path.join(ROOT, 'api', '_attach-suggest.js'));

const NOW = 1762790000000;
const H = 3600 * 1000;
const IMG = 'data:image/jpeg;base64,' + Buffer.from('fake-jpeg').toString('base64');
const ord = (id, at, extra) => ({ id, orderNum: 'L' + id.replace(/\D/g, ''), orderClient: 'נאור', customerId: '9117', source: 'whatsapp',
  waMessageId: 'M' + id, waSender: '0501234567', waReceivedAt: at, createdAt: at, stage: '', hasSketch: true, sketchName: '', ...(extra || {}) });

(async () => {

// ═══ A. אותו איחוד ═══════════════════════════════════════════════════
{
  const src = ord('wa_2', NOW, { sketchName: 'גרפיקה', sketchSeenAt: 5, files: { f0: { name: 'x' } } });
  const dst = ord('wa_1', NOW - 1000, { sketchName: 'מקלחון רון', stage: 'workday', items: [{ code: '8CM' }],
                                         attachments: { 2: { kind: 'hardware', at: 1 } }, attNext: 4 });
  const cases = [[src, dst], [src, { ...dst, customerId: '14201' }], [{ ...src, stage: 'x' }, dst], [{ ...src, items: [{}] }, dst],
                 [{ ...src, hashavshevet: { a: 1 } }, dst], [src, src], [{ ...src, customerId: '' }, { ...dst, customerId: '' }]];
  check('A1 can-merge: server == browser on every case', cases.map(([a, b]) => J(S.lgAttCanMerge(a, b))), cases.map(([a, b]) => J(B.lgAttCanMerge(a, b))));
  check('A2 merge plan: server == browser', J(S.lgAttMergePlan(src, dst, 'graphic', IMG, { layer: 'L', base: null }, NOW, 'מרכזן', 7)),
                                            J(B.lgAttMergePlan(src, dst, 'graphic', IMG, { layer: 'L', base: null }, NOW, 'מרכזן', 7)));
  check('A3 merge plan without k: server == browser', J(S.lgAttMergePlan(src, dst, 'hardware', IMG, null, NOW, 'x')),
                                                      J(B.lgAttMergePlan(src, dst, 'hardware', IMG, null, NOW, 'x')));
}

// ═══ B. האיחוד בשרת ═════════════════════════════════════════════════
{
  const db = fakeDb({
    orders: { wa_1: ord('wa_1', NOW - 1000, { sketchName: 'מקלחון רון', attNext: 3, attachments: { 1: { kind: 'hardware', at: 1 } } }),
              wa_2: ord('wa_2', NOW, { files: { f0: { name: 'g.jpg' } } }) },
    sketches: { wa_1: IMG, wa_2: IMG, wa_2__layer: '{"v":1}' },
  });
  const r = await S.lgAttMergeServer(db, 'wa_2', 'wa_1', 'graphic', { by: 'מרכזן', now: NOW, attachedBy: 'markazan' });
  const d = db._data;
  check('B1 merged at the next k from the counter', [r.ok, r.k], [true, 3]);
  check('B2 counter moved on', d.orders.wa_1.attNext, 4);
  check('B3 the image moved', [d.sketches.wa_1__att3, d.sketches.wa_2, d.sketches.wa_2__layer], [IMG, undefined, undefined]);
  check('B4 the source left the queue', d.orders.wa_2, undefined);
  const a = d.orders.wa_1.attachments[3];
  check('B5 marked as done by the markazan', [a.kind, a.by, a.attachedBy], ['graphic', 'מרכזן', 'markazan']);
  check('B6 full copy for "split", minus the heavy fields', [a.from.order.id, a.from.order.waMessageId, 'files' in a.from.order, a.from.layer],
        ['wa_2', 'Mwa_2', false, '{"v":1}']);
  db._data.orders.wa_3 = ord('wa_3', NOW, { customerId: '14201' }); db._data.sketches.wa_3 = IMG;
  const no = await S.lgAttMergeServer(db, 'wa_3', 'wa_1', 'graphic', { by: 'מרכזן', now: NOW });
  check('B7 another customer → refused, nothing touched', [no.ok, typeof no.why, !!db._data.orders.wa_3], [false, 'string', true]);
  const gone = await S.lgAttMergeServer(db, 'wa_9', 'wa_1', 'graphic', { now: NOW });
  check('B8 missing order → refused', gone.ok, false);
}

// ═══ C. הסיווג ══════════════════════════════════════════════════════
{
  let seen = null;
  const reply = (obj, extra) => async (url, init) => { seen = { url, body: JSON.parse(init.body) };
    return { ok: true, json: async () => ({ status: 'completed', usage: { input_tokens: 900, output_tokens: 12 },
      output: [{ content: [{ type: 'output_text', text: JSON.stringify(obj) }] }], ...(extra || {}) }) }; };
  const r = await AS.lgAttachClassify({ dataUrl: IMG, caption: 'גרפיקה לחלבי', model: 'm-1', key: 'k', fetcher: reply({ kind: 'graphic' }) });
  check('C1 graphic', [r.kind, r.usage.input_tokens], ['graphic', 900]);
  check('C2 the agents\' provider and model', [seen.url, seen.body.model, seen.body.store], ['https://api.openai.com/v1/responses', 'm-1', false]);
  const img = seen.body.input[0].content.find(c => c.type === 'input_image');
  check('C3 the image goes at low detail', [!!img, img && img.detail, img && img.image_url.startsWith('data:image/jpeg;base64,')], [true, 'low', true]);
  check('C4 the caption is data, not instructions', JSON.stringify(seen.body.input).includes('גרפיקה לחלבי'), true);
  check('C5 classification only — the schema has nothing but the kind', Object.keys(seen.body.text.format.schema.properties), ['kind']);
  check('C5 kinds', seen.body.text.format.schema.properties.kind.enum, ['sketch', 'graphic', 'hardware', 'unsure']);
  check('C6 hardware', (await AS.lgAttachClassify({ dataUrl: IMG, model: 'm', key: 'k', fetcher: reply({ kind: 'hardware' }) })).kind, 'hardware');
  check('C7 an unknown answer → unsure', (await AS.lgAttachClassify({ dataUrl: IMG, model: 'm', key: 'k', fetcher: reply({ kind: 'logo' }) })).kind, 'unsure');
  check('C8 http error → unsure', (await AS.lgAttachClassify({ dataUrl: IMG, model: 'm', key: 'k', fetcher: async () => ({ ok: false }) })).kind, 'unsure');
  check('C9 a throw → unsure', (await AS.lgAttachClassify({ dataUrl: IMG, model: 'm', key: 'k', fetcher: async () => { throw new Error('x'); } })).kind, 'unsure');
  let called = false;
  check('C10 no key → unsure without calling', [(await AS.lgAttachClassify({ dataUrl: IMG, model: 'm', key: '', fetcher: async () => { called = true; } })).kind, called], ['unsure', false]);
}

// ═══ D. ההקטנה ══════════════════════════════════════════════════════
{
  const { createCanvas } = require('@napi-rs/canvas');
  const c = createCanvas(2000, 1000); const g = c.getContext('2d'); g.fillStyle = '#c00'; g.fillRect(0, 0, 2000, 1000);
  const big = c.toBuffer('image/png');
  const s = await AS.lgAttachShrink(big);
  const { loadImage } = require('@napi-rs/canvas');
  const im = await loadImage(s.buf);
  check('D1 JPEG, longest side 512', [s.mime, im.width, im.height], ['image/jpeg', 512, 256]);
  check('D2 small', s.buf.length < 60 * 1024, true);
}

// ═══ E. לאיזו הזמנה ═════════════════════════════════════════════════
{
  const db = fakeDb({ orders: {} });
  const add = async o => { db._data.orders[o.id] = o; await AS.lgAttachRecentNote(db, o, o.createdAt); };
  const old = ord('wa_old', NOW - 30 * H, { sketchName: 'ישן' });
  const day = ord('wa_day', NOW - 5 * H, { sketchName: 'מראה סלון' });
  const s1 = ord('wa_s1', NOW - 60000, { sketchName: 'מקלחון רון' });
  const g1 = ord('wa_g1', NOW);
  const after = ord('wa_after', NOW + 5000, { sketchName: 'אחרי' });
  for (const o of [old, day, s1, g1, after]) await add(o);
  check('E1 the latest sketch before it (same batch)', J(await AS.lgAttachTarget(db, g1, NOW)), { id: 'wa_s1', name: 'מקלחון רון', num: 'L1' });
  await AS.lgAttachRecentKind(db, s1, 'graphic');
  check('E2 one that is itself a graphic is skipped → the last 24h', (await AS.lgAttachTarget(db, g1, NOW)).id, 'wa_day');
  delete db._data.orders.wa_day;
  check('E3 a deleted order is skipped; older than 24h → none', await AS.lgAttachTarget(db, g1, NOW), null);
  check('E4 another customer\'s sketch never counts', await AS.lgAttachTarget(db, { ...g1, customerId: '14201' }, NOW), null);
  check('E5 older than 24h left the list', Object.keys(db._data.waMeta.attachRecent['9117']).includes('wa_old'), false);
  //  same email: page 2 → page 1 (same received time)
  const e1 = { ...ord('em_M_1', NOW), source: 'email', waReceivedAt: undefined, emailReceivedAt: NOW, emailPage: 1, sketchName: 'עמוד 1' };
  const e2 = { ...ord('em_M_2', NOW), source: 'email', waReceivedAt: undefined, emailReceivedAt: NOW, emailPage: 2 };
  const db2 = fakeDb({ orders: {} });
  for (const o of [e2, e1]) { db2._data.orders[o.id] = o; await AS.lgAttachRecentNote(db2, o, NOW); }
  check('E6 email pages: the earlier page of the same email', (await AS.lgAttachTarget(db2, e2, NOW)).id, 'em_M_1');
  check('E6 and never a later page', await AS.lgAttachTarget(db2, e1, NOW), null);
}

// ═══ F. ההצעה ═══════════════════════════════════════════════════════
const ENV = { ATTACH_SUGGEST_ENABLED: 'true', OPENAI_API_KEY: 'k', AGENT_MODEL: 'm-1', ATTACH_SUGGEST_MODEL: undefined };
const kindFetch = kind => async () => ({ ok: true, json: async () => ({ status: 'completed', usage: { input_tokens: 1000, output_tokens: 10 },
  output: [{ content: [{ type: 'output_text', text: JSON.stringify({ kind }) }] }] }) });
const shrink = async () => ({ mime: 'image/jpeg', buf: Buffer.from('small') });
const world = learn => {
  const s1 = ord('wa_s1', NOW - 60000, { sketchName: 'מקלחון רון' });
  const g1 = ord('wa_g1', NOW);
  const db = fakeDb({ orders: { wa_s1: s1, wa_g1: g1 }, sketches: { wa_s1: IMG, wa_g1: IMG },
                      waMeta: learn ? { attachLearn: { '9117': learn } } : {} });
  return { db, s1, g1 };
};
const room = db => Object.values((db._data.waMeta || {}).agentRoom || {}).map(r => r.text);

await withEnv(ENV, async () => {
  const { db, s1, g1 } = world();
  await AS.lgAttachRecentNote(db, s1, NOW - 60000);
  const r = await AS.lgAttachSuggestFor(db, g1, { now: NOW, fetcher: kindFetch('graphic'), shrink });
  const sg = db._data.orders.wa_g1.attachSuggest;
  check('F1 graphic → a suggestion on the order', [r.kind, r.suggested, sg && sg.kind, sg && sg.targetId, sg && sg.at], ['graphic', true, 'graphic', 'wa_s1', NOW]);
  check('F1 with the name to show', [sg.targetName, sg.targetNum], ['מקלחון רון', 'L1']);
  check('F2 nothing merged — only suggested', [!!db._data.orders.wa_g1, db._data.orders.wa_s1.attachments], [true, undefined]);
  check('F3 the room hears about it', room(db), ["הצעתי לצרף גרפיקה חלבי ל'מקלחון רון' (נאור)"]);
  const day = Object.values(db._data.waMeta.attachUsage)[0];
  check('F4 the cost is recorded', [day.calls, day.inTok, day.outTok], [1, 1000, 10]);
});
await withEnv(ENV, async () => {
  const { db, s1, g1 } = world();
  await AS.lgAttachRecentNote(db, s1, NOW - 60000);
  const r = await AS.lgAttachSuggestFor(db, g1, { now: NOW, fetcher: kindFetch('sketch'), shrink });
  check('F5 a sketch → nothing on the order', [r.kind, db._data.orders.wa_g1.attachSuggest], ['sketch', undefined]);
  const r2 = await AS.lgAttachSuggestFor(db, s1, { now: NOW, fetcher: kindFetch('hardware'), shrink });
  check('F6 hardware but no sketch before it → no suggestion', [r2.kind, r2.suggested, db._data.orders.wa_s1.attachSuggest], ['hardware', false, undefined]);
});
await withEnv(ENV, async () => {
  const { db, s1, g1 } = world({ streak: 4 });
  await AS.lgAttachRecentNote(db, s1, NOW - 60000);
  await AS.lgAttachSuggestFor(db, g1, { now: NOW, fetcher: kindFetch('graphic'), shrink });
  check('F7 4 approvals in a row → still only a suggestion', [!!db._data.orders.wa_g1, !!db._data.orders.wa_g1.attachSuggest], [true, true]);
});
await withEnv(ENV, async () => {
  const { db, s1, g1 } = world({ streak: 5 });
  await AS.lgAttachRecentNote(db, s1, NOW - 60000);
  const r = await AS.lgAttachSuggestFor(db, g1, { now: NOW, fetcher: kindFetch('graphic'), shrink });
  const a = ((db._data.orders.wa_s1 || {}).attachments || {})[1] || {};
  check('F8 5 in a row → attached on its own', [r.merged, db._data.orders.wa_g1, a.kind, a.attachedBy], [true, undefined, 'graphic', 'markazan']);
  check('F9 the copy remembers the suggestion (split brings it back with צרף / לא)', (a.from.order.attachSuggest || {}).targetId, 'wa_s1');
  check('F10 the room hears about it', room(db), ["צירפתי לבד גרפיקה חלבי ל'מקלחון רון' (נאור)"]);
  check('F11 the streak is not touched by the auto merge', db._data.waMeta.attachLearn['9117'].streak, 5);
});
await withEnv({ ...ENV, ATTACH_SUGGEST_ENABLED: undefined }, async () => {
  const { db, s1, g1 } = world();
  let called = false;
  const r = await AS.lgAttachSuggestFor(db, g1, { now: NOW, fetcher: async () => { called = true; }, shrink });
  check('F12 switch off → no call, nothing written', [r.reason, called, db._data.waMeta.attachRecent, db._data.orders.wa_g1.attachSuggest], ['off', false, undefined, undefined]);
});
await withEnv(ENV, async () => {
  const { db, g1 } = world();
  let called = false;
  await AS.lgAttachSuggestFor(db, { ...g1, waText: true }, { now: NOW, fetcher: async () => { called = true; }, shrink });
  await AS.lgAttachSuggestFor(db, { ...g1, poSupplier: 'avivi' }, { now: NOW, fetcher: async () => { called = true; }, shrink });
  await AS.lgAttachSuggestFor(db, { ...g1, customerId: '' }, { now: NOW, fetcher: async () => { called = true; }, shrink });
  check('F13 text order / purchase order / unknown customer → not classified', called, false);
});
await withEnv({ ...ENV, ATTACH_SUGGEST_MODEL: 'cheap-1' }, async () => {
  const { db, g1 } = world();
  let model = null;
  await AS.lgAttachSuggestFor(db, g1, { now: NOW, shrink, fetcher: async (u, init) => { model = JSON.parse(init.body).model; return { ok: false }; } });
  check('F14 an own model can be set (ATTACH_SUGGEST_MODEL), else AGENT_MODEL', model, 'cheap-1');
});

// ═══ G. צרף / לא ═════════════════════════════════════════════════════
await withEnv(ENV, async () => {
  const { db, s1, g1 } = world({ streak: 2, yes: 2, no: 0 });
  await AS.lgAttachRecentNote(db, s1, NOW - 60000);
  await AS.lgAttachSuggestFor(db, g1, { now: NOW, fetcher: kindFetch('graphic'), shrink });
  //  "צרף" in the browser = the existing merge; then the answer
  await S.lgAttMergeServer(db, 'wa_g1', 'wa_s1', 'graphic', { by: 'בן', now: NOW + 1 });
  const y = await AS.lgAttachAnswer(db, { answer: 'yes', orderId: 'wa_g1', targetId: 'wa_s1', by: 'בן' }, NOW + 2);
  check('G1 צרף → streak +1', [y.ok, db._data.waMeta.attachLearn['9117'].streak, db._data.waMeta.attachLearn['9117'].yes], [true, 3, 3]);
  const y2 = await AS.lgAttachAnswer(db, { answer: 'yes', orderId: 'wa_g1', targetId: 'wa_s1', by: 'בן' }, NOW + 3);
  check('G2 the same answer twice counts once', [y2.ok, db._data.waMeta.attachLearn['9117'].streak], [true, 3]);
  const bad = await AS.lgAttachAnswer(db, { answer: 'yes', orderId: 'wa_zz', targetId: 'wa_s1' }, NOW);
  check('G3 "yes" without a merge → refused, not counted', [bad.ok, db._data.waMeta.attachLearn['9117'].streak], [false, 3]);
});
await withEnv(ENV, async () => {
  const { db, s1, g1 } = world({ streak: 4, yes: 4, no: 1 });
  await AS.lgAttachRecentNote(db, s1, NOW - 60000);
  await AS.lgAttachSuggestFor(db, g1, { now: NOW, fetcher: kindFetch('hardware'), shrink });
  const n = await AS.lgAttachAnswer(db, { answer: 'no', orderId: 'wa_g1', by: 'בן' }, NOW + 5);
  const L = db._data.waMeta.attachLearn['9117'];
  check('G4 לא → streak back to 0', [n.ok, L.streak, L.no], [true, 0, 2]);
  check('G5 the suggestion leaves the row, and the "no" is remembered', [db._data.orders.wa_g1.attachSuggest, (db._data.orders.wa_g1.attachSuggestNo || {}).kind],
        [undefined, 'hardware']);
  const n2 = await AS.lgAttachAnswer(db, { answer: 'no', orderId: 'wa_g1', by: 'בן' }, NOW + 6);
  check('G6 nothing to answer any more → refused, not counted twice', [n2.ok, db._data.waMeta.attachLearn['9117'].no], [false, 2]);
  check('G7 an unknown answer → refused', (await AS.lgAttachAnswer(db, { answer: 'maybe', orderId: 'wa_g1' }, NOW)).ok, false);
});

// ═══ H. הנתיב לאדמין ═════════════════════════════════════════════════
await withEnv(ENV, async () => {
  const adm = require(path.join(ROOT, 'api', 'wa-inbound-drain.js'));
  const { db, s1, g1 } = world();
  await AS.lgAttachRecentNote(db, s1, NOW - 60000);
  await AS.lgAttachSuggestFor(db, g1, { now: NOW, fetcher: kindFetch('graphic'), shrink });
  const r = await adm.handleAdmin({ action: 'attach-answer', answer: 'no', orderId: 'wa_g1' }, { db, by: '0500000000', now: NOW + 9 });
  check('H1 attach-answer through the admin route', [r.ok, db._data.orders.wa_g1.attachSuggest], [true, undefined]);
  const bad = await adm.handleAdmin({ action: 'attach-answer', answer: 'no', orderId: 'a/b' }, { db, by: 'x', now: NOW });
  check('H2 a bad id is refused before touching the database', [bad.ok, bad.code], [false, 'bad-key']);
});

// ═══ I. הדפדפן ══════════════════════════════════════════════════════
{
  check('I1 the tag text', B.lgAttSuggestText && B.lgAttSuggestText({ attachSuggest: { kind: 'graphic', targetId: 'wa_1', targetName: 'מקלחון רון' } }),
        "נראה כמו גרפיקה חלבי — לצרף ל'מקלחון רון'?");
  check('I2 no name → the order number', B.lgAttSuggestText && B.lgAttSuggestText({ attachSuggest: { kind: 'hardware', targetId: 'wa_1', targetNum: 'L1090' } }),
        "נראה כמו שרטוט פרזול — לצרף ל'L1090'?");
  check('I3 nothing / unknown kind → empty', B.lgAttSuggestText ? [B.lgAttSuggestText({}), B.lgAttSuggestText({ attachSuggest: { kind: 'x', targetId: 'a' } })] : null, ['', '']);
  const slides = J(B.lgAttSlides({ id: 'wa_0', attachments: { 1: { kind: 'graphic', at: 1, attachedBy: 'markazan' }, 2: { kind: 'hardware', at: 2 } } }));
  check('I4 an attachment the markazan made says so', slides.map(s => s.label), ['סקיצה', 'גרפיקה חלבי · צורף ע"י המרכזן', 'שרטוט פרזול']);
  const ADMIN = fs.readFileSync(path.join(ROOT, 'admin.html'), 'utf8');
  const render = (ADMIN.match(/function sqRender\(\)[\s\S]*?\r?\n}\r?\n/) || [''])[0];
  check('I5 the queue row shows the suggestion', /_sqSuggestTag\(item\)/.test(render), true);
  const fn = (ADMIN.match(/async function sqSuggestAnswer[\s\S]*?\r?\n}\r?\n/) || [''])[0];
  check('I6 צרף = the existing merge (lgAttMerge with the suggested kind)', /lgAttMerge\(\s*id\s*,\s*s\.targetId\s*,\s*s\.kind\s*\)/.test(fn), true);
  check('I7 the answer goes to the server (learning lives in waMeta)', /attach-answer/.test(fn) && /_lgAuthPost\('\/api\/wa-inbound-drain'/.test(fn), true);
  check('I8 the buttons do not open the sketch under them', /stopPropagation/.test((ADMIN.match(/function _sqSuggestTag[\s\S]*?\r?\n}\r?\n/) || [''])[0]), true);
  const flip = (ADMIN.match(/function _sqAttFlip[\s\S]*?\r?\n}\r?\n/) || [''])[0];
  check('I9 splitting what the markazan attached is a "no"', /markazan/.test(flip) && /attach-answer/.test(flip + fn), true);
  const build = (ADMIN.match(/function buildSQItems\(\)[\s\S]*?\r?\n}\r?\n/) || [''])[0];
  check('I10 the queue row keeps the suggestion (buildSQItems whitelist)', /attachSuggest:\s*o\.attachSuggest/.test(build), true);
}

// ═══ J. מחובר לקליטה ═════════════════════════════════════════════════
{
  const inb = require(path.join(ROOT, 'api', '_wa-inbound.js'));
  const JPEG = Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0, 16]), Buffer.from('JFIF\0\x01\x01\0\0\x01\0\x01\0\0', 'binary'),
                              Buffer.from([0xFF, 0xDA, 0, 8, 1, 1, 0, 0, 63, 0, 0x12, 0x34, 0xFF, 0xD9])]);
  const okFetch = async () => ({ ok: true, status: 200, headers: { get: () => String(JPEG.length) },
                                 arrayBuffer: async () => JPEG.buffer.slice(JPEG.byteOffset, JPEG.byteOffset + JPEG.length) });
  const body = (id, ts, caption) => ({ typeWebhook: 'incomingMessageReceived', instanceData: { idInstance: 7100 }, timestamp: ts, idMessage: id,
    senderData: { chatId: '972501234567@c.us' },
    messageData: { typeMessage: 'imageMessage', fileMessageData: { downloadUrl: 'https://do-media.green-api.com/g.jpg', caption, mimeType: 'image/jpeg' } } });
  const run = env => withEnv({ ...ENV, ...env }, async () => {
    const db = fakeDb({ meta: { orderCounter: 1041 }, waSenders: { '0501234567': { customerId: '9117', customerName: 'נאור' } },
                        hashavshevetAccounts: { '9117': { key: '9117', name: 'נאור' } } });
    const kinds = { K1: 'sketch', K2: 'graphic' };
    for (const [id, ts] of [['K1', 1762789900], ['K2', 1762789960]]) {
      const p = inb.lgWaInboundParse(body(id, ts, id === 'K1' ? 'מקלחון רון' : 'חלבי'));
      await inb.lgWaInboundRecord(db, p.entry, NOW);
      await inb.lgWaInboundProcess(db, inb.lgWaInboundKey(id), { by: 'test', fetchImpl: okFetch, now: NOW,
                                                                  attach: { fetcher: kindFetch(kinds[id]), shrink } });
    }
    return db;
  });
  const on = await run({});
  check('J1 a graphic after a sketch from the same customer → suggestion on it', (on._data.orders.wa_K2_1.attachSuggest || {}).targetId, 'wa_K1_1');
  const off = await run({ ATTACH_SUGGEST_ENABLED: undefined });
  check('J2 switch off → nothing', [off._data.orders.wa_K2_1.attachSuggest, (off._data.waMeta || {}).attachRecent], [undefined, undefined]);
}

await withEnv({ ...ENV, EMAIL_ONLY_TO: 'dana@client.co.il' }, async () => {
  //  מייל עם שתי תמונות: סקיצה ואחריה גרפיקה → הצעה על השנייה, אל הראשונה
  const em = require(path.join(ROOT, 'api', '_email-inbound.js'));
  const PNG = Buffer.concat([Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex'), Buffer.alloc(40, 7)]);
  const db = fakeDb({ meta: { orderCounter: 1041 }, hashavshevetAccounts: { '07': { key: '07', name: 'פלג', email: 'dana@client.co.il' } },
                      waMeta: { emailSenders: { 'dana@client,co,il': { email: 'dana@client.co.il', customerId: '07', customerName: 'פלג' } } } });
  const parts = [];
  for (let i = 0; i < 2; i++) {
    await em.lgEmailPutChunk(db, { messageId: 'MA', idx: i, chunk: 0, chunks: 1, data: PNG.toString('base64') });
    parts.push({ idx: i, name: 's' + i + '.png', mime: 'image/png', size: PNG.length, chunks: 1 });
  }
  let n = 0;
  const fetcher = async (u, init) => kindFetch(n++ === 0 ? 'sketch' : 'graphic')(u, init);
  const r = await em.lgEmailCommit(db, { messageId: 'MA', threadId: 'T-MA', from: 'dana@client.co.il', subject: 'הזמנה + גרפיקה', date: NOW - 5000, parts },
                                   { by: 'gmail-script', now: NOW, attach: { fetcher, shrink } });
  const sg = (db._data.orders[r.orderIds[1]] || {}).attachSuggest || {};
  check('J3 email: page 2 graphic → suggested onto page 1', [sg.kind, sg.targetId], ['graphic', r.orderIds[0]]);
});

if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
console.log('\nAll attach-suggest checks passed.');
})().catch(e => { console.error(e); process.exit(1); });
