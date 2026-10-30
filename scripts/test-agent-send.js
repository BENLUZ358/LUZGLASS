#!/usr/bin/env node
/**
 * תור השליחה של הסוכנים — waMeta/agentOutbox. טקסט חופשי, קבצים (העתק
 * חשבונית, סקיצה) והעברת הודעה, דרך אותו ספק, אותו חלון ואותו שער.
 * Run:  node scripts/test-agent-send.js
 */
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { fakeDb } = require(path.join(__dirname, '_fake-db.js'));
const A = require(path.join(ROOT, 'api', '_agent-send.js'));
let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));

const GROUP = '120363000000@g.us';
const GKEY  = GROUP.replace(/[.#$[\]/]/g, '_');
const b64 = s => Buffer.from(s).toString('base64');
const ENV = { AGENT_SHADOW_ENABLED: 'true', AGENT_REPLY_ENABLED: 'true',
              AGENT_STAFF_PHONES: '050-1112222, +972531234567' };

const seed = () => fakeDb({
  waGroups:  { [GKEY]: { customerId: '888', customerName: 'קבוצת לוי' } },
  waSenders: { '0501234567': { customerId: '777' }, '0507777777': { customerId: '999' } },
  waMeta:    { agentPilot: { 777: true, 888: true } },
  invoicePdf: { inv1: { state: 'ready', accountKey: '888', docNumber: '34472' },
                inv2: { state: 'ready', accountKey: '777', docNumber: '50000' } },
  invoicePdfBlobs: { inv1: { original: b64('ORIG'), copy: b64('COPY') }, inv2: { original: b64('O2'), copy: b64('C2') } },
  orders:   { o1: { customerId: '888', orderNum: 'L1001' }, o2: { customerId: '777', orderNum: 'L1002' } },
  sketches: { o1: 'data:image/png;base64,' + b64('PNG'), o2: 'data:image/jpeg;base64,' + b64('JPG') },
});

//  ספק מזויף: שער כמו האמיתי בעיקרו — רק linked:true עובר.
function fakeProvider(o = {}) {
  const p = {
    name: 'fake', configured: true, globalSlot: true, maxPerRun: 10, checksState: true,
    nextGap: () => 0, state: o.state || 'authorized',
    texts: [], fileSends: [], forwards: [], gates: [], order: [],
    async getState() { return { ok: true, state: p.state, reason: '' }; },
    gate(ctx) { p.gates.push(ctx); return ctx.linked === true ? { allowed: true, reason: '' } : { allowed: false, reason: 'לא מורשה' }; },
    async sendText(f) {
      p.texts.push(f); p.order.push('text');
      if (o.fail) return { ok: false, httpStatus: 400, failureKind: o.fail, reason: 'Bad request' };
      return { ok: true, httpStatus: 200, messageId: 'T' + p.texts.length };
    },
    async sendFiles(f) {
      p.fileSends.push({ to: f.to, caption: f.caption, files: f.files.map(x => ({ name: x.name, mime: x.mime, buf: x.buf.toString() })) });
      p.order.push('files');
      return { ok: true, httpStatus: 200, messageId: 'F' + p.fileSends.length };
    },
    async forward(f) { p.forwards.push(f); p.order.push('forward'); return { ok: true, httpStatus: 200, messageId: 'W' + p.forwards.length }; },
  };
  return p;
}
const ob = (db, k) => db._data.waMeta.agentOutbox[k];
const run = (db, provider, env) => A.lgAgentSendPending(db, { provider, env: env || ENV });

(async () => {
  {
    const db = seed(); await A.lgAgentEnqueue(db, { key: 'b0', to: '0501112222', text: 'x' });
    const p = fakeProvider();
    const r = await A.lgAgentSendPending(db, { provider: p, env: ENV, budgetMs: 0 });
    check('budgetMs 0 is 0: nothing sent, entry untouched', [r.sent, p.texts.length, ob(db, 'b0').state], [0, 0, 'pending']);
  }
  check('constant', A.AGENT_OUTBOX, 'waMeta/agentOutbox');
  check('staff normalized to local digits', A.lgAgentStaff(ENV), ['0501112222', '0531234567']);
  check('staff empty', A.lgAgentStaff({}), []);

  /* טקסט לקבוצה מקושרת — פעם אחת */
  {
    const db = seed(), p = fakeProvider();
    const q1 = await A.lgAgentEnqueue(db, { key: 'r1_0', to: GROUP, customerId: '888', text: 'שלום', reason: 'reply' });
    const q2 = await A.lgAgentEnqueue(db, { key: 'r1_0', to: GROUP, customerId: '888', text: 'אחר', reason: 'reply' });
    check('enqueue → queued, twice → not', [q1, q2], [{ key: 'r1_0', queued: true }, { key: 'r1_0', queued: false }]);
    check('second enqueue did not overwrite', ob(db, 'r1_0').text, 'שלום');
    const r = await run(db, p);
    await run(db, p);
    check('group text sent once', [r.sent, r.failed, p.texts], [1, 0, [{ to: GROUP, text: 'שלום' }]]);
    check('gate saw live link', p.gates[0], { phone: GROUP, accountKey: '888', linked: true });
    const e = ob(db, 'r1_0');
    check('state sent + messageId', [e.state, e.messageId, e.attempts], ['sent', 'T1', 1]);
  }

  /* הקישור הוסר אחרי ההכנסה לתור */
  {
    const db = seed(), p = fakeProvider();
    await A.lgAgentEnqueue(db, { key: 'r2', to: GROUP, customerId: '888', text: 'x' });
    delete db._data.waGroups[GKEY];
    const r = await run(db, p);
    check('unlinked group → blocked, not sent', [ob(db, 'r2').state, p.texts.length, r.blocked], ['blocked', 0, 1]);
    //  קבוצה שקושרה ללקוח אחר
    const db2 = seed(), p2 = fakeProvider();
    await A.lgAgentEnqueue(db2, { key: 'r2b', to: GROUP, customerId: '777', text: 'x' });
    await run(db2, p2);
    check('group linked to another customer → blocked', [ob(db2, 'r2b').state, p2.texts.length], ['blocked', 0]);
  }

  /* צוות בלי קישור */
  {
    const db = seed(), p = fakeProvider();
    await A.lgAgentEnqueue(db, { key: 'r3', to: '050-111-2222', customerId: '', text: 'לשאול' });
    const r = await run(db, p);
    check('staff phone sent without link', [r.sent, p.texts], [1, [{ to: '0501112222', text: 'לשאול' }]]);
    check('staff gate linked', [p.gates[0].linked, p.gates[0].phone], [true, '0501112222']);
  }

  /* פרטי: לא-צוות לא-מקושר / מקושר / לא בפיילוט / מתגים כבויים */
  {
    const db = seed(), p = fakeProvider();
    await A.lgAgentEnqueue(db, { key: 'r4', to: '0549999999', customerId: '777', text: 'x' });
    await A.lgAgentEnqueue(db, { key: 'r5', to: '972501234567@c.us', customerId: '777', text: 'y' });
    await A.lgAgentEnqueue(db, { key: 'r6', to: '0507777777', customerId: '999', text: 'z' });
    await run(db, p);
    check('non-staff unlinked → blocked', ob(db, 'r4').state, 'blocked');
    check('linked private sent (local phone)', [ob(db, 'r5').state, p.texts], ['sent', [{ to: '0501234567', text: 'y' }]]);
    check('linked but not in pilot → blocked', ob(db, 'r6').state, 'blocked');

    for (const env of [{ ...ENV, AGENT_REPLY_ENABLED: '' }, { ...ENV, AGENT_SHADOW_ENABLED: 'false' }]) {
      const d = seed(), q = fakeProvider();
      await A.lgAgentEnqueue(d, { key: 's1', to: GROUP, customerId: '888', text: 'x' });
      await A.lgAgentEnqueue(d, { key: 's2', to: '0501112222', customerId: '', text: 'x' });
      await run(d, q, env);
      check('switch off → blocked, nothing sent', [ob(d, 's1').state, ob(d, 's2').state, q.texts.length], ['blocked', 'blocked', 0]);
    }
  }

  /* לא מחובר → נשאר בתור, ניסיון לא נספר */
  {
    const db = seed(), p = fakeProvider({ state: 'notAuthorized' });
    await A.lgAgentEnqueue(db, { key: 'r7', to: GROUP, customerId: '888', text: 'x' });
    const r = await run(db, p);
    const e = ob(db, 'r7');
    check('not authorized → pending, attempts 0', [e.state, e.attempts, p.texts.length, r.sent], ['pending', 0, 0, 0]);
    p.state = 'authorized';
    await run(db, p);
    check('after reconnect → sent', ob(db, 'r7').state, 'sent');
  }

  /* העתק חשבונית */
  {
    const db = seed(), p = fakeProvider();
    await A.lgAgentEnqueue(db, { key: 'r8', to: GROUP, customerId: '888', text: 'מצורף', files: [{ kind: 'invoice-copy', invoiceKey: 'inv1' }] });
    await run(db, p);
    check('invoice-copy sends copy PDF, text as caption', p.fileSends,
          [{ to: GROUP, caption: 'מצורף', files: [{ name: 'חשבונית 34472.pdf', mime: 'application/pdf', buf: 'COPY' }] }]);
    check('no separate text', p.texts.length, 0);
    check('invoice sent state', [ob(db, 'r8').state, ob(db, 'r8').messageId], ['sent', 'F1']);
    //  חשבונית של לקוח אחר / לא מוכנה
    await A.lgAgentEnqueue(db, { key: 'r9', to: GROUP, customerId: '888', text: 'מצורף', files: [{ kind: 'invoice-copy', invoiceKey: 'inv2' }] });
    db._data.invoicePdf.inv1.state = 'awaiting';
    await A.lgAgentEnqueue(db, { key: 'r10', to: GROUP, customerId: '888', text: 'מצורף', files: [{ kind: 'invoice-copy', invoiceKey: 'inv1' }] });
    await run(db, p);
    check('foreign / not-ready invoice → blocked', [ob(db, 'r9').state, ob(db, 'r10').state, p.fileSends.length], ['blocked', 'blocked', 1]);
  }

  /* סקיצה */
  {
    const db = seed(), p = fakeProvider();
    await A.lgAgentEnqueue(db, { key: 'r11', to: GROUP, customerId: '888', text: 'מצורף', files: [{ kind: 'sketch', orderId: 'o1' }] });
    await A.lgAgentEnqueue(db, { key: 'r12', to: GROUP, customerId: '888', text: 'מצורף', files: [{ kind: 'sketch', orderId: 'o2' }] });
    await run(db, p);
    check('sketch data-URL sent as image', p.fileSends,
          [{ to: GROUP, caption: 'מצורף', files: [{ name: 'סקיצה L1001.png', mime: 'image/png', buf: 'PNG' }] }]);
    check('sketch of another customer → blocked', ob(db, 'r12').state, 'blocked');
  }

  /* העברת הודעה לשאול ואחריה טקסט */
  {
    const db = seed(), p = fakeProvider();
    await A.lgAgentEnqueue(db, { key: 'r13', to: '0501112222', customerId: '888', text: 'בקשת מחיר #1',
                                 files: [{ kind: 'forward', fromChat: GROUP, idMessage: 'WAM1' }] });
    await run(db, p);
    check('forward then text', [p.order, p.forwards], [['forward', 'text'], [{ to: '0501112222', fromChat: GROUP, idMessages: ['WAM1'] }]]);
    check('messageId = the text after forward', ob(db, 'r13').messageId, 'T1');
  }

  /* כשל ספק */
  {
    const db = seed(), p = fakeProvider({ fail: 'other' });
    const SECRET = 'טקסט-ההודעה-הסודי';
    await A.lgAgentEnqueue(db, { key: 'r14', to: GROUP, customerId: '888', text: SECRET });
    const r = await run(db, p);
    const e = ob(db, 'r14');
    check('provider failure → failed', [e.state, e.attempts, r.failed], ['failed', 1, 1]);
    check('lastError without message text', [!!e.lastError, String(e.lastError).includes(SECRET)], [true, false]);
    //  ניתוק באמצע → חוזר לתור בלי לספור ניסיון
    const d = seed(), q = fakeProvider({ fail: 'disconnected' });
    await A.lgAgentEnqueue(d, { key: 'r15', to: GROUP, customerId: '888', text: 'x' });
    await run(d, q);
    check('disconnected mid-run → pending, attempts 0', [ob(d, 'r15').state, ob(d, 'r15').attempts], ['pending', 0]);
  }

  /* תיקון סקירה 1: העברה ללקוח — רק מצ'אט שלו */
  {
    const db = seed(), p = fakeProvider();
    await A.lgAgentEnqueue(db, { key: 'f1', to: '0501234567', customerId: '777', text: 'x',
                                 files: [{ kind: 'forward', fromChat: GROUP, idMessage: 'WAM9' }] });          // קבוצה של 888
    await A.lgAgentEnqueue(db, { key: 'f2', to: GROUP, customerId: '888', text: 'x',
                                 files: [{ kind: 'forward', fromChat: '972501234567@c.us', idMessage: 'WAM8' }] }); // מספר של 777
    await A.lgAgentEnqueue(db, { key: 'f3', to: '0501234567', customerId: '777', text: 'x',
                                 files: [{ kind: 'forward', fromChat: '972501234567@c.us', idMessage: 'WAM7' }] }); // שלו
    await run(db, p);
    check('forward from foreign chat to non-staff → blocked', [ob(db, 'f1').state, ob(db, 'f2').state], ['blocked', 'blocked']);
    check('forward from own chat → sent', [ob(db, 'f3').state, p.forwards.map(f => f.idMessages[0])], ['sent', ['WAM7']]);
  }

  /* תיקון סקירה 2: חריגה בבדיקה → failed, הסבב ממשיך */
  {
    const db = seed(), p = fakeProvider();
    let n = 0;
    p.gate = ctx => { if (n++ === 0) throw new TypeError('boom'); return { allowed: ctx.linked === true, reason: '' }; };
    await A.lgAgentEnqueue(db, { key: 'g1', to: GROUP, customerId: '888', text: 'a' });
    db._data.waMeta.agentOutbox.g1.createdAt -= 1000;   // ראשונה בתור
    await A.lgAgentEnqueue(db, { key: 'g2', to: GROUP, customerId: '888', text: 'b' });
    const r = await run(db, p);
    const e = ob(db, 'g1');
    check('throw in gate → failed, not claimed, run continues',
          [e.state, e.claimedAt, String(e.lastError).includes('TypeError'), ob(db, 'g2').state, r.failed, r.sent],
          ['failed', null, true, 'sent', 1, 1]);
  }

  /* תיקון סקירה 3: רשומה שנחסמת לא מזמינה חלון שליחה */
  {
    const db = seed(), p = fakeProvider();
    await A.lgAgentEnqueue(db, { key: 'b1', to: '0549999999', customerId: '777', text: 'x' });
    await A.lgAgentEnqueue(db, { key: 'b2', to: GROUP, customerId: '888', text: 'x', files: [{ kind: 'invoice-copy', invoiceKey: 'inv2' }] });
    await run(db, p);
    check('blocked entries never touch waMeta/sendSlot', [ob(db, 'b1').state, ob(db, 'b2').state, db._data.waMeta.sendSlot], ['blocked', 'blocked', undefined]);
    await A.lgAgentEnqueue(db, { key: 'b3', to: GROUP, customerId: '888', text: 'x' });
    await run(db, p);
    check('a real send does reserve the slot', [ob(db, 'b3').state, !!db._data.waMeta.sendSlot], ['sent', true]);
    //  החלון תפוס → חוזרת לתור בלי ניסיון
    const d = seed(), q = fakeProvider();
    q.nextGap = () => 60 * 1000;
    d._data.waMeta.sendSlot = { nextAllowedAt: Date.now() + 5 * 60 * 1000 };
    await A.lgAgentEnqueue(d, { key: 'b4', to: GROUP, customerId: '888', text: 'x' });
    await run(d, q);
    check('slot busy → pending, attempts 0, not sent', [ob(d, 'b4').state, ob(d, 'b4').attempts, q.texts.length], ['pending', 0, 0]);
  }

  /* תיקון סקירה 4: סקיצה בסוג שאינו נתמך */
  {
    const db = seed(), p = fakeProvider();
    db._data.sketches.o1 = 'data:application/octet-stream;base64,' + b64('X');
    await A.lgAgentEnqueue(db, { key: 'm1', to: GROUP, customerId: '888', text: 'x', files: [{ kind: 'sketch', orderId: 'o1' }] });
    await run(db, p);
    await run(db, p);
    const e = ob(db, 'm1');
    check('unsupported sketch mime → failed, final, nothing sent',
          [e.state, e.lastError, e.attempts, p.fileSends.length], ['failed', 'סוג קובץ לא נתמך', 3, 0]);
  }

  /* הספק האמיתי: sendText, forward, כיתוב ב-sendFiles — fetch מדומה */
  {
    const saved = { ...process.env }, savedFetch = global.fetch;
    Object.assign(process.env, { WA_PROVIDER: 'green', GREENAPI_ID_INSTANCE: '7107000001', GREENAPI_TOKEN: 'TOK-secret' });
    ['api/_env.js', 'api/_wa-recipient.js', 'api/_wa-provider.js'].forEach(m => { delete require.cache[require.resolve(path.join(ROOT, m))]; });
    const calls = [];
    global.fetch = async (url, init) => {
      calls.push({ url, body: typeof init.body === 'string' ? JSON.parse(init.body) : init.body });
      const body = /forwardMessages/.test(url) ? { messages: ['FW1'] } : { idMessage: 'ID1' };
      return { status: 200, text: async () => JSON.stringify(body) };
    };
    try {
      const g = require(path.join(ROOT, 'api', '_wa-provider.js')).lgWaProvider();
      const t = await g.sendText({ to: '0501112222', text: 'חופשי' });
      check('sendText posts sendMessage with the free text', [t.ok, t.messageId, calls[0].url.replace('TOK-secret', '***'), calls[0].body],
            [true, 'ID1', 'https://api.green-api.com/waInstance7107000001/sendMessage/***', { chatId: '972501112222@c.us', message: 'חופשי' }]);
      const f = await g.forward({ to: '0501112222', fromChat: GROUP, idMessages: ['WAM1'] });
      check('forward posts forwardMessages', [f.ok, f.messageId, calls[1].url.replace('TOK-secret', '***'), calls[1].body],
            [true, 'FW1', 'https://api.green-api.com/waInstance7107000001/forwardMessages/***',
             { chatId: '972501112222@c.us', chatIdFrom: GROUP, messages: ['WAM1'] }]);
      const s = await g.sendFiles({ to: GROUP, caption: 'מצורף', files: [{ name: 'a.pdf', mime: 'application/pdf', buf: Buffer.from('x') }] });
      check('sendFiles caption override', [s.ok, calls[2].body.get('caption')], [true, 'מצורף']);
      const bad = await g.sendText({ to: 'nope@x', text: 'x' });
      check('sendText bad recipient', [bad.ok, bad.failureKind], [false, 'recipient']);
      global.fetch = async () => ({ status: 400, text: async () => JSON.stringify({ message: 'bad at /x/TOK-secret' }) });
      const e = await g.sendText({ to: '0501112222', text: 'x' });
      check('sendText failure redacts token', [e.ok, String(e.reason).includes('TOK-secret')], [false, false]);
    } finally { process.env = saved; global.fetch = savedFetch; }
  }

  console.log(failed ? `\n${failed} FAILED` : '\nall passed');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
