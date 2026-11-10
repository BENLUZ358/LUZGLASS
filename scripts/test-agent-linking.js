#!/usr/bin/env node
/**
 * חדר הסוכנים — קישור אחרון (11/11): כל פעולה כותבת שורה בחדר בשם הסוכן האחראי.
 *  • צירוף / הפרדה של צרופה בידי בן → קולט info (att-room, אחרי שהשרת מוודא שזה באמת קרה)
 *  • "זו הזמנה" / "דוגמה — הוצא מהתור" → מרכזן info
 *  • "לא לשלוח עכשיו" / "החזר" בטיוטה לשרטט → קולט info
 *  • כרטיסי הסוכנים במסך: כמה שורות בחדר היום לכל סוכן
 * Run:  node scripts/test-agent-linking.js
 */
const path = require('path'), fs = require('fs'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
const { fakeDb } = require(path.join(__dirname, '_fake-db.js'));
const ATT = require(path.join(ROOT, 'api', '_order-attachments.js'));
const SS = require(path.join(ROOT, 'api', '_sample-suspect.js'));
const adm = require(path.join(ROOT, 'api', 'wa-inbound-drain.js'));
let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));

const NOW = Date.UTC(2026, 10, 10, 10, 0, 0), H = 3600 * 1000;
const ENV = { AGENT_SHADOW_ENABLED: 'true' };
const CFG = { agents: { markazan: 'shadow', okev: 'shadow', archive: 'shadow', price: 'shadow', kolet: 'shadow', manager: 'shadow' } };
const room = d => Object.values((d._data.waMeta || {}).agentRoom || {}).sort((a, b) => a.at - b.at).map(e => [e.agent, e.kind, e.text]);

(async () => {
  /* ── צרופות ── */
  const attDb = () => fakeDb({
    orders: {
      D1: { id: 'D1', orderNum: 'L3', orderClient: 'כהן', stage: 'opty',
            attachments: { 1: { kind: 'graphic', at: NOW, by: 'ben', from: { order: { id: 'S1', sketchName: 'חלבי' } } },
                           2: { kind: 'hardware', at: NOW, by: 'מרכזן', attachedBy: 'markazan', from: { order: { id: 'S2' } } } } },
      S9: { id: 'S9', stage: '' },
    },
    waMeta: { agentConfig: CFG },
  });
  {
    const d = attDb();
    const r = await ATT.lgAttRoomEvent(d, { op: 'merge', orderId: 'D1', srcId: 'S1' }, { env: ENV, now: NOW });
    check('merge by Ben → kolet info', [r.ok, room(d)], [true, [['kolet', 'info', 'בן צירף גרפיקה חלבי להזמנה L3 · כהן (מהתור)']]]);
    const r2 = await ATT.lgAttRoomEvent(d, { op: 'merge', orderId: 'D1', srcId: 'S2' }, { env: ENV, now: NOW });
    check('merge done by מרכזן itself → no second line (it posts its own)', [r2.ok, room(d).length], [false, 1]);
    const r3 = await ATT.lgAttRoomEvent(d, { op: 'merge', orderId: 'D1', srcId: 'S7' }, { env: ENV, now: NOW });
    check('merge that did not happen → refused, nothing posted', [r3.ok, r3.code, room(d).length], [false, 'not-merged', 1]);
  }
  {
    const d = attDb();
    d._data.orders.S9 = { id: 'S9', stage: '' };
    const r = await ATT.lgAttRoomEvent(d, { op: 'split', orderId: 'D1', srcId: 'S9' }, { env: ENV, now: NOW });
    check('split by Ben → kolet info', [r.ok, room(d)], [true, [['kolet', 'info', 'בן הפריד צרופה מהזמנה L3 · כהן — חזרה לתור הסקיצות']]]);
    const r2 = await ATT.lgAttRoomEvent(d, { op: 'split', orderId: 'D1', srcId: 'S1' }, { env: ENV, now: NOW });
    check('split that did not happen (still attached) → refused', [r2.ok, r2.code, room(d).length], [false, 'not-split', 1]);
    const r3 = await ATT.lgAttRoomEvent(d, { op: 'x', orderId: 'D1', srcId: 'S1' }, { env: ENV, now: NOW });
    check('bad op refused', r3.code, 'bad-op');
    const r4 = await ATT.lgAttRoomEvent(d, { op: 'merge', orderId: '../x', srcId: 'S1' }, { env: ENV, now: NOW });
    check('bad id refused', r4.code, 'bad-key');
  }
  {
    const d = attDb();
    const r = await adm.handleAdmin({ action: 'att-room', op: 'merge', orderId: 'D1', srcId: 'S1' }, { db: d, by: '052', now: NOW, env: ENV });
    check('drain: att-room action', [r.ok, room(d).length], [true, 1]);
    d._data.waMeta.agentConfig.agents.kolet = 'off';
    await adm.handleAdmin({ action: 'att-room', op: 'merge', orderId: 'D1', srcId: 'S1' }, { db: d, by: '052', now: NOW, env: ENV });
    check('drain: kolet off → nothing', room(d).length, 1);
  }
  {
    const JS = fs.readFileSync(path.join(ROOT, 'order-attachments.js'), 'utf8');
    check('browser: room helper posts att-room', /function roomEvent[\s\S]{0,300}action: 'att-room'/.test(JS), true);
    check('browser: merge reports to the room', /lgAttMerge = async[\s\S]*?roomEvent\('merge', dst\.id, src\.id\)[\s\S]*?lgAttSplit = async/.test(JS), true);
    check('browser: split reports to the room', /lgAttSplit = async[\s\S]*?roomEvent\('split', dstId, back\)/.test(JS), true);
  }

  /* ── דוגמה / הזמנה ── */
  {
    const d = fakeDb({ orders: { O1: { id: 'O1', orderNum: 'L8', orderClient: 'נאור', stage: '', sampleSuspect: true } }, waMeta: { agentConfig: CFG } });
    await SS.lgSampleDecide(d, { orderId: 'O1', decision: 'sample', by: 'ben' }, NOW, ENV);
    check('sample decision → markazan info', room(d), [['markazan', 'info', 'בן סימן: L8 · נאור — דוגמה, הוצאה מהתור']]);
    d._data.orders.O2 = { id: 'O2', sketchName: 'מקלחון', orderClient: 'נאור', stage: '', sampleSuspect: true };
    await adm.handleAdmin({ action: 'sample-decide', orderId: 'O2', decision: 'order' }, { db: d, by: '052', now: NOW + 1, env: ENV });
    check('drain passes env: order decision → markazan info', room(d)[1], ['markazan', 'info', 'בן סימן: מקלחון · נאור — זו הזמנה, נשארת בתור']);
  }

  /* ── טיוטה לשרטט: לא לשלוח עכשיו / החזר ── */
  {
    const d = fakeDb({ orders: { A4: { id: 'A4', orderNum: 'L4', orderClient: 'אגן', stage: 'chash', createdAt: NOW } }, waMeta: { agentConfig: CFG } });
    await adm.handleAdmin({ action: 'drafter-hold', id: 'A4', hold: true }, { db: d, by: '052', now: NOW, env: ENV });
    await adm.handleAdmin({ action: 'drafter-hold', id: 'A4', hold: false }, { db: d, by: '052', now: NOW + 1, env: ENV });
    check('hold / unhold → kolet info', room(d), [['kolet', 'info', 'הזמנה L4 · אגן — לא לשלוח עכשיו לשרטט'], ['kolet', 'info', 'הזמנה L4 · אגן חזרה לטיוטה לשרטט']]);
  }

  /* ── כרטיסי הסוכנים: שורות בחדר היום ── */
  {
    const ctx = { console, Date, Intl };
    vm.createContext(ctx);
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'agents-dash.js'), 'utf8'), ctx);
    const rm = {
      a: { at: NOW - H, agent: 'kolet', kind: 'info', text: 'x' },
      b: { at: NOW - 2 * H, agent: 'kolet', kind: 'ask', state: 'open', text: 'y' },
      c: { at: NOW - 30 * H, agent: 'kolet', kind: 'info', text: 'אתמול' },
      d: { at: NOW - H, agent: 'manager', kind: 'summary', text: 'בוקר טוב' },
      e: { at: NOW - H, agent: 'מרכזן', kind: 'info', text: 'נקלטו' },
    };
    const cards = JSON.parse(JSON.stringify(ctx.lgAgentCards(rm, {}, NOW)));
    const by = id => cards.find(c => c.id === id).room;
    check('cards: room events today per agent (summary counts for מנהל)', [by('kolet'), by('manager'), by('markazan'), by('archive')], [2, 1, 1, 0]);
    const HTML = fs.readFileSync(path.join(ROOT, 'agents.html'), 'utf8');
    check('agents.html shows the room count on the card', /בחדר היום: \$\{E\(c\.room\)\}/.test(HTML), true);
  }
  console.log(failed ? `\n${failed} FAILED` : '\nall ok');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
