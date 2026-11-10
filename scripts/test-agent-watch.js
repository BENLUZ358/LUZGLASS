#!/usr/bin/env node
/**
 * חדר הסוכנים שלב ב׳ — הבדיקות שהדופק מכלי החשבוניות מריץ (api/_agent-watch.js).
 * ארכיון: קובץ שמחכה בתיקייה, שגיאת הדפסה, הדפסה שלא נרשמה, שליחה שנכשלה.
 * קולט: מייל משלוח לשרטט שנכשל, משלוח שתקוע אצל השרטט.
 * Run: node scripts/test-agent-watch.js
 */
const path = require('path');
const { fakeDb } = require(path.join(__dirname, '_fake-db.js'));
const W = require(path.join(__dirname, '..', 'api', '_agent-watch.js'));
//  סיכום הבוקר של המנהל (11/11) נבדק ב-test-agent-morning.js — כאן הוא כבוי כדי שהספירות של החדר יישארו של הבדיקות בלבד
require(path.join(__dirname, '..', 'api', '_agent-morning.js')).lgAgentMorningRun = async () => ({ posted: false, skipped: 'test' });

let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));

const MIN = 60 * 1000, H = 60 * MIN;
//  שלישי 10.11.2026 10:00 בישראל (UTC+2)
const NOW = Date.UTC(2026, 10, 10, 8, 0, 0);
const ENV = { AGENT_SHADOW_ENABLED: 'true' };
const CFG = mode => ({ agents: { markazan: 'shadow', okev: 'shadow', archive: mode, price: 'shadow', kolet: mode, manager: 'shadow' },
                       escalatePhone: '0547725552' });
const room = db => Object.values(((db._data.waMeta || {}).agentRoom) || {}).sort((a, b) => a.at - b.at);
const openIdx = db => Object.keys(((db._data.waMeta || {}).agentRoomOpen) || {});
const outbox = db => Object.values(((db._data.waMeta || {}).agentOutbox) || {});
const hb = (pending, extra) => ({ at: NOW, pending, lastPrintError: null, version: 'v', ...extra });

(async () => {
  // ─── טהור ───
  check('working hours: Tuesday 10:00 Israel', W.lgIsWorkingHours(NOW), true);
  check('working hours: Tuesday 06:59', W.lgIsWorkingHours(Date.UTC(2026, 10, 10, 4, 59)), false);
  check('working hours: Tuesday 18:00', W.lgIsWorkingHours(Date.UTC(2026, 10, 10, 16, 0)), false);
  check('working hours: Friday 10:00', W.lgIsWorkingHours(Date.UTC(2026, 10, 13, 8, 0)), false);
  check('working hours: Sunday 07:00', W.lgIsWorkingHours(Date.UTC(2026, 10, 8, 5, 0)), true);

  const c = W.lgWatchHeartbeatClean({ pc: 'OFFICE/PC.1', version: 'x'.repeat(100),
    pending: [...Array(80)].map((_, i) => ({ name: 'f' + i + '.pdf', ageSec: i })).concat([{ name: 5 }, null]),
    lastPrintError: { at: 5, message: 'm'.repeat(900), file: 'a.pdf' } });
  check('clean: pc made key-safe', c.pc, 'OFFICE_PC_1');
  check('clean: pending capped, junk dropped', [c.pending.length, c.pending[0]], [50, { name: 'f0.pdf', ageSec: 0 }]);
  check('clean: long fields cut', [c.version.length, c.lastPrintError.message.length], [40, 300]);
  check('clean: no pc → refused', W.lgWatchHeartbeatClean({ pending: [] }), null);
  check('clean: no print error → null', W.lgWatchHeartbeatClean({ pc: 'A' }).lastPrintError, null);

  const P = W.lgWatchProblems({ now: NOW, watchers: { A: hb([{ name: 'x.pdf', ageSec: 5 * 60 }, { name: 'y.pdf', ageSec: 11 * 60 }, { name: 'z.pdf', ageSec: 31 * 60 }]) } });
  check('problems: file ≤10 min ignored, >10 info, >30 ask', P.map(p => [p.agent, p.level, /y\.pdf|z\.pdf/.exec(p.text)[0]]),
        [['archive', 'info', 'y.pdf'], ['archive', 'ask', 'z.pdf']]);
  const stale = W.lgWatchProblems({ now: NOW, watchers: { A: hb([{ name: 'z.pdf', ageSec: 31 * 60 }], { at: NOW - 20 * MIN }) } });
  check('problems: silent PC (no heartbeat 10 min) — its old report is not used', stale, []);
  check('diff: new + upgraded open, gone clears, same level stays quiet',
    W.lgWatchDiff({ a: { level: 'info' }, b: { level: 'ask' }, c: { level: 'info' } },
                  [{ key: 'a', level: 'ask' }, { key: 'b', level: 'ask' }, { key: 'd', level: 'info' }]),
    { open: ['a', 'd'], clear: ['c'] });

  // ─── הרצה ───
  const mk = (data, cfg) => fakeDb({ ...data, waMeta: { ...(data.waMeta || {}), ...(cfg ? { agentConfig: cfg } : {}) } });

  // 1. בלי agentConfig (פרודקשן היום): בחדר כאפור, אף פעם לא צהוב ולא לבן
  {
    const db = mk({ waMeta: { invoiceWatcher: { A: hb([{ name: 'y.pdf', ageSec: 11 * 60 }]) } } });
    let r = await W.lgAgentWatchRun(db, { env: ENV, now: NOW });
    check('no config: file >10 min → one grey line', room(db).map(e => [e.agent, e.kind, e.state || null]), [['archive', 'info', null]]);
    r = await W.lgAgentWatchRun(db, { env: ENV, now: NOW + 20 * 1000 });
    check('throttle: second run within a minute does nothing', [r.skipped, room(db).length], ['throttled', 1]);
    await W.lgAgentWatchRun(db, { env: ENV, now: NOW + 2 * MIN });
    check('dedupe: same problem a minute later — no second line', room(db).length, 1);
    db._data.waMeta.invoiceWatcher.A = hb([{ name: 'y.pdf', ageSec: 31 * 60 }], { at: NOW + 4 * MIN });
    await W.lgAgentWatchRun(db, { env: ENV, now: NOW + 4 * MIN });
    check('no config: >30 min is still grey (no yellow, no open index, nothing to Ben)',
      [room(db).map(e => e.kind), openIdx(db).length, outbox(db).length], [['info', 'info'], 0, 0]);
    db._data.waMeta.invoiceWatcher.A = hb([], { at: NOW + 6 * MIN });
    await W.lgAgentWatchRun(db, { env: ENV, now: NOW + 6 * MIN });
    check('cleared → short "תוקן" line, state forgotten', [room(db).length, /תוקן/.test(room(db)[2].text),
      Object.keys(db._data.waMeta.agentWatch.problems || {}).length], [3, true, 0]);
  }

  // 2. ארכיון "עונה": שגיאת הדפסה → צהוב + התראה לבן; תוקן → נסגר
  {
    const db = mk({ waMeta: { invoiceWatcher: { A: hb([], { lastPrintError: { at: NOW, message: 'printer off', file: 'a.pdf' } }) } } }, CFG('reply'));
    let sends = 0;
    await W.lgAgentWatchRun(db, { env: ENV, now: NOW, sendPending: async () => { sends++; } });
    const ask = room(db)[0];
    check('reply: print error → yellow open question', [ask.agent, ask.kind, ask.state, /printer off/.test(ask.text)], ['archive', 'ask', 'open', true]);
    check('reply: in the open index, marked internal', [openIdx(db).length, ask.internal], [1, true]);
    const ob = outbox(db);
    check('reply: Ben pinged once (agent-ask, his number, archive agent)', ob.map(o => [o.to, o.reason, o.agent]), [['0547725552', 'agent-ask', 'archive']]);
    check('reply: send attempted', sends, 1);
    db._data.waMeta.invoiceWatcher.A = hb([], { at: NOW + 2 * MIN });
    await W.lgAgentWatchRun(db, { env: ENV, now: NOW + 2 * MIN, sendPending: async () => {} });
    const after = room(db);
    check('fixed: question closes by itself, leaves the open index, "תוקן" posted',
      [after[0].state, after[0].answeredBy, openIdx(db).length, after[1].kind, /תוקן/.test(after[1].text), outbox(db).length],
      ['answered', 'auto', 0, 'info', true, 1]);
  }

  // 3. "שקט": צהוב בחדר בלי התראה; "כבוי": כלום; בלי המתג העליון: כלום
  {
    const pe = { invoiceWatcher: { A: hb([], { lastPrintError: { at: NOW, message: 'x' } }) } };
    let db = mk({ waMeta: { ...pe } }, CFG('shadow'));
    await W.lgAgentWatchRun(db, { env: ENV, now: NOW, sendPending: async () => { throw new Error('should not send'); } });
    check('shadow: yellow in the room, no ping', [room(db).map(e => e.kind + '/' + e.state), outbox(db).length], [['ask/open'], 0]);
    db = mk({ waMeta: { ...pe } }, CFG('off'));
    await W.lgAgentWatchRun(db, { env: ENV, now: NOW });
    check('off: nothing at all', [room(db).length, outbox(db).length], [0, 0]);
    db = mk({ waMeta: { ...pe } }, CFG('reply'));
    await W.lgAgentWatchRun(db, { env: {}, now: NOW });
    check('master switch off: nothing', room(db).length, 0);
  }

  // 4. שליחה ללקוח שנכשלה, ארכיון "עונה": ניסיון חוזר אחד, ואז צהוב (בדיקות החשבוניות — פעם ב-10 דק')
  {
    const inv = { k1: { state: 'ready', client: 'פלג', docNumber: '67600', createdAt: NOW - H, orderIds: ['o1'],
                        delivery: { state: 'failed', channel: 'whatsapp', reason: 'מנותק', at: NOW - 10 * MIN } } };
    const db = mk({ invoicePdf: inv, waMeta: { invoiceWatcher: { A: hb([]) } } }, CFG('reply'));
    const tries = [];
    const deliver = async (d, key) => { tries.push(key); };
    const at = m => { db._data.waMeta.invoiceWatcher.A.at = NOW + m * MIN; return { env: ENV, now: NOW + m * MIN, deliver, sendPending: async () => {} }; };
    await W.lgAgentWatchRun(db, { env: ENV, now: NOW, deliver, sendPending: async () => {} });
    check('delivery failed: retried once via deliver, grey line', [tries, room(db).map(e => e.kind)], [['k1'], ['info']]);
    await W.lgAgentWatchRun(db, at(2));
    check('invoice checks wait 10 minutes: nothing new a minute later', [tries.length, room(db).length], [1, 1]);
    await W.lgAgentWatchRun(db, at(11));
    check('still failing: no second retry, yellow now', [tries.length, room(db).map(e => e.kind + '/' + (e.state || ''))], [1, ['info/', 'ask/open']]);
    db._data.invoicePdf.k1.delivery = { state: 'queued', channel: 'email', at: NOW + 12 * MIN };
    await W.lgAgentWatchRun(db, at(22));
    check('I1: delivery only queued → not "תוקן", problem kept', [room(db).length, !!db._data.waMeta.agentWatch.problems.deliv_k1], [2, true]);
    db._data.invoicePdf.k1.delivery = { state: 'sent', at: NOW + 25 * MIN };
    await W.lgAgentWatchRun(db, at(33));
    check('sent later: question closed, "תוקן"', [room(db)[1].state, /תוקן/.test(room(db)[2].text)], ['answered', true]);
    check('I1: retried kept after the fix', !!db._data.waMeta.agentWatch.retried.k1, true);
    db._data.invoicePdf.k1.delivery = { state: 'failed', channel: 'whatsapp', reason: 'שוב', at: NOW + 40 * MIN };
    await W.lgAgentWatchRun(db, at(44));
    check('I1: same invoice fails again → never retried twice, straight to yellow', [tries.length, room(db).slice(-1)[0].kind], [1, 'ask']);
    db._data.invoicePdf.k1.createdAt = NOW + 15 * 24 * H;   // שתישאר בחלון
    await W.lgAgentWatchRun(db, at(15 * 24 * 60));
    check('I1: retried forgotten after 14 days', ((db._data.waMeta.agentWatch || {}).retried || {}).k1, undefined);
  }

  // 4b. C1: ניסיון חוזר רק ב"עונה", רק לכשל מהשעתיים האחרונות, לא לרשומה שפג תוקפה
  {
    const fail = (extra, dv) => ({ invoicePdf: { k1: { state: 'ready', client: 'פלג', docNumber: '67600', createdAt: NOW - H, orderIds: ['o1'],
      delivery: { state: 'failed', channel: 'whatsapp', reason: 'מנותק', at: NOW - 10 * MIN, ...dv } } },
      waMeta: { invoiceWatcher: { A: hb([]) } }, ...extra });
    for (const [name, cfg, dv, extra, kind] of [
      ['C1: no agentConfig → no deliver, grey line only', null, {}, {}, 'info'],
      ['C1: shadow → no deliver, yellow', CFG('shadow'), {}, {}, 'ask'],
      ['C1: reply but failed 3h ago → no deliver, yellow', CFG('reply'), { at: NOW - 3 * H }, {}, 'ask'],
      ['C1: reply but outbox entry expired → no deliver (never reset), yellow', CFG('reply'), { outboxKey: 'w1' }, { waOutbox: { w1: { state: 'expired' } } }, 'ask'],
    ]) {
      const db = mk(fail(extra, dv), cfg);
      const tries = [];
      await W.lgAgentWatchRun(db, { env: ENV, now: NOW, deliver: async (d, k) => { tries.push(k); }, sendPending: async () => {} });
      db._data.waMeta.invoiceWatcher.A.at = NOW + 11 * MIN;
      await W.lgAgentWatchRun(db, { env: ENV, now: NOW + 11 * MIN, deliver: async (d, k) => { tries.push(k); }, sendPending: async () => {} });
      check(name, [tries.length, room(db).map(e => e.kind), ((db._data.waOutbox || {}).w1 || {}).state || null],
        [0, [kind], extra.waOutbox ? 'expired' : null]);
    }
  }

  // 4c. C2: נרשם לפני שפועלים; ניסיון אחד לכל ריצה; עצירה בזמן; ריצה שנהרגה לא חוזרת על הניסיון
  {
    const two = { invoicePdf: {
      k1: { state: 'ready', docNumber: '1', createdAt: NOW - H, delivery: { state: 'failed', at: NOW - 5 * MIN } },
      k2: { state: 'ready', docNumber: '2', createdAt: NOW - H, delivery: { state: 'failed', at: NOW - 5 * MIN } } },
      waMeta: { invoiceWatcher: { A: hb([]) } } };
    let db = mk(two, CFG('reply'));
    const seen = [];
    const deliver = async (d, k) => { const w = d._data.waMeta.agentWatch || {};
      seen.push([k, !!(w.retried && w.retried[k] && w.retried[k].at), !!(w.problems && w.problems['deliv_' + k])]); };
    await W.lgAgentWatchRun(db, { env: ENV, now: NOW, deliver, sendPending: async () => {} });
    check('C2: retried + problem written before deliver; one retry per run', seen, [['k1', true, true]]);
    db._data.waMeta.invoiceWatcher.A.at = NOW + 11 * MIN;
    await W.lgAgentWatchRun(db, { env: ENV, now: NOW + 11 * MIN, deliver, sendPending: async () => {} });
    check('C2: the other invoice is retried on the next run', seen.map(x => x[0]), ['k1', 'k2']);

    db = mk(two, CFG('reply'));
    const n0 = seen.length;
    await W.lgAgentWatchRun(db, { env: ENV, now: NOW, deliver, deadline: Date.now() - 1, sendPending: async () => {} });
    check('C2: past the deadline → stops, nothing done', [seen.length - n0, room(db).length], [0, 0]);

    //  ריצה שנהרגה אחרי כתיבת retried (כאן: הכתיבה הבאה — רשומת הבעיה — זורקת)
    db = mk({ invoicePdf: { k1: two.invoicePdf.k1 }, waMeta: two.waMeta }, CFG('reply'));
    const real = db.ref.bind(db);
    let armed = true;
    db.ref = p => { const r = real(p); if (armed && /agentWatch\/problems\//.test(String(p))) r.set = async () => { armed = false; throw new Error('killed'); }; return r; };
    const tries = [];
    let threw = false;
    try { await W.lgAgentWatchRun(db, { env: ENV, now: NOW, deliver: async (d, k) => { tries.push(k); }, sendPending: async () => {} }); } catch (_) { threw = true; }
    db._data.waMeta.invoiceWatcher.A.at = NOW + 11 * MIN;
    await W.lgAgentWatchRun(db, { env: ENV, now: NOW + 11 * MIN, deliver: async (d, k) => { tries.push(k); }, sendPending: async () => {} });
    check('C2: killed run after the retried write → next run does not retry', [threw, tries], [true, []]);
  }

  // 5. הדפסה שמחכה לרישום יותר משעה — רק ללקוח שיש לו משתמש (known נשמר בהעלאה)
  {
    const P1 = { state: 'printed', docNumber: '67700', createdAt: NOW - 2 * H, known: true };
    const P2 = { state: 'printed', docNumber: '67701', createdAt: NOW - 2 * H, known: false };
    const P3 = { state: 'printed', docNumber: '67702', createdAt: NOW - 10 * MIN, known: true };
    const P4 = { state: 'printed', docNumber: '67703', createdAt: NOW - 20 * 24 * H, known: true };
    const R1 = { state: 'ready', docNumber: '67704', createdAt: NOW - 50 * H, delivery: { state: 'failed', at: NOW - 5 * MIN } };
    const db = mk({ invoicePdf: { p1: P1, p2: P2, p3: P3, p4: P4, r1: R1 }, users: { '050': { customerId: '1231' } },
                    waMeta: { invoiceWatcher: { A: hb([]) } } }, CFG('shadow'));
    const reads = [];
    const real = db.ref.bind(db);
    db.ref = p => { const r = real(p), q = [];
      const o = { ...r };
      for (const n of ['orderByChild', 'equalTo', 'startAt', 'limitToFirst']) o[n] = (...a) => { q.push(n + ':' + a.join(',')); r[n](...a); return o; };
      o.once = async () => { reads.push(String(p) + (q.length ? '?' + q.join('&') : '')); return r.once(); };
      return o; };
    await W.lgAgentWatchRun(db, { env: ENV, now: NOW });
    check('printed >1h, known customer → yellow (even old); unknown / fresh → nothing; failure older than 48h → not looked at',
      room(db).map(e => [e.kind, (/677\d\d/.exec(e.text) || [])[0]]).sort(), [['ask', '67700'], ['ask', '67703']]);
    check('I2: users never read', reads.filter(r => r.startsWith('users')), []);
    check('I2: invoicePdf read only by state=printed and createdAt from 48h',
      reads.filter(r => r.startsWith('invoicePdf?')).sort(), ['invoicePdf?orderByChild:createdAt&startAt:' + (NOW - 48 * H), 'invoicePdf?orderByChild:state&equalTo:printed']);
    //  I2: בדיקות החשבוניות פעם ב-10 דק'; I3: נעלמה מהשאילתה ≠ תוקנה
    db._data.invoicePdf.p1.state = 'ready';
    db._data.waMeta.invoiceWatcher.A.at = NOW + 2 * MIN;
    await W.lgAgentWatchRun(db, { env: ENV, now: NOW + 2 * MIN });
    check('I2: fast run (2 min) does not touch invoice problems', room(db).length, 2);
    db._data.waMeta.invoiceWatcher.A.at = NOW + 11 * MIN;
    await W.lgAgentWatchRun(db, { env: ENV, now: NOW + 11 * MIN });
    check('slow run: registered → "תוקן"', room(db).filter(e => /תוקן/.test(e.text)).map(e => /67700/.test(e.text)), [true]);
  }

  // 5b. I3: שליחה שנכשלה ויצאה מחלון 48 השעות — לא "תוקן"
  {
    const db = mk({ invoicePdf: { k1: { state: 'ready', docNumber: '67600', createdAt: NOW - H, delivery: { state: 'failed', at: NOW - 5 * MIN } } },
                    waMeta: { invoiceWatcher: { A: hb([]) } } }, CFG('shadow'));
    await W.lgAgentWatchRun(db, { env: ENV, now: NOW });
    const T = NOW + 49 * H;
    db._data.waMeta.invoiceWatcher.A.at = T;
    await W.lgAgentWatchRun(db, { env: ENV, now: T });
    check('I3: fell out of the window, still failing → kept, no "תוקן"',
      [room(db).length, room(db)[0].state, !!db._data.waMeta.agentWatch.problems.deliv_k1], [1, 'open', true]);
  }

  // 6. קולט: מייל שנכשל → צהוב פעם אחת; משלוח פתוח יותר מ-30 שעות → אפור פעם אחת
  {
    const data = { waMeta: { invoiceWatcher: { A: hb([]) },
      drafterBatches: { _next: 4, 1: { n: 1, at: NOW - 31 * H, count: 3, emailKey: 'e1' },
                        2: { n: 2, at: NOW - 2 * H, count: 2, emailKey: 'e2' },
                        3: { n: 3, at: NOW - 40 * H, count: 1, emailKey: 'e3', doneAt: NOW - 5 * H } },
      emailOutbox: { e1: { state: 'sent' }, e2: { state: 'failed' }, e3: { state: 'failed' } } } };
    const db = mk(data, CFG('shadow'));
    await W.lgAgentWatchRun(db, { env: ENV, now: NOW });
    const rows = room(db).map(e => [e.agent, e.kind, e.text]);
    check('kolet: failed mail → yellow; >30h → grey; done batch ignored', rows.map(r => [r[0], r[1]]).sort(),
      [['kolet', 'ask'], ['kolet', 'info']]);
    check('kolet: wording', rows.map(r => r[2]).sort(), ['המייל למשלוח 2 לשרטט נכשל — לחץ שלח שוב', 'משלוח 1 אצל השרטט כבר יותר מיום'].sort());
    db._data.waMeta.invoiceWatcher.A.at = NOW + 2 * MIN;
    await W.lgAgentWatchRun(db, { env: ENV, now: NOW + 2 * MIN });
    check('kolet: once only', room(db).length, 2);
    //  משלוח ארוך שפשוט הסתיים → "משלוח 1 הסתיים" (בריצת הבדיקות האיטית הבאה)
    db._data.waMeta.drafterBatches[1].doneAt = NOW + 5 * MIN;
    db._data.waMeta.invoiceWatcher.A.at = NOW + 11 * MIN;
    await W.lgAgentWatchRun(db, { env: ENV, now: NOW + 11 * MIN });
    check('kolet: long batch finished → "משלוח 1 הסתיים"', room(db).slice(-1)[0].text, 'תוקן: משלוח 1 הסתיים');
    // קולט כבוי, ארכיון פעיל
    const db2 = mk({ waMeta: { ...data.waMeta, invoiceWatcher: { A: hb([], { lastPrintError: { at: NOW, message: 'x' } }) } } },
                   { agents: { archive: 'shadow', kolet: 'off' } });
    await W.lgAgentWatchRun(db2, { env: ENV, now: NOW });
    check('kolet off, archive on: only archive', room(db2).map(e => e.agent), ['archive']);
  }

  // 7. אירוע ידני (פעולות השרטט) לפי המתג
  {
    let db = mk({}, CFG('shadow'));
    await W.lgAgentEvent(db, 'kolet', { kind: 'info', text: 'משלוח 5 נשלח לשרטט — 3 הזמנות' }, { env: ENV, now: NOW });
    check('event: posted when agent on', room(db).map(e => [e.agent, e.text]), [['kolet', 'משלוח 5 נשלח לשרטט — 3 הזמנות']]);
    db = mk({}, CFG('off'));
    await W.lgAgentEvent(db, 'kolet', { kind: 'info', text: 'x' }, { env: ENV, now: NOW });
    check('event: nothing when agent off', room(db).length, 0);
  }

  // 9. I4: "סגור" על שאלה פנימית צהובה; מחשב בלי דופק 7 ימים נמחק
  {
    const { handleAdmin } = require(path.join(__dirname, '..', 'api', 'wa-inbound-drain.js'));
    const db = mk({ waMeta: { invoiceWatcher: { A: hb([], { lastPrintError: { at: NOW, message: 'printer off', file: 'a.pdf' } }) } } }, CFG('shadow'));
    await W.lgAgentWatchRun(db, { env: ENV, now: NOW });
    const ask = Object.entries(db._data.waMeta.agentRoom).find(([, e]) => e.kind === 'ask');
    check('print error text: stays until the next good print', /עד ההדפסה המוצלחת הבאה/.test(ask[1].text), true);
    check('dismiss: bad key refused', (await handleAdmin({ action: 'agent-room-close', key: 'a/b' }, { db, by: '050', now: NOW })).code, 'bad-key');
    const info = Object.keys(db._data.waMeta.agentRoom).find(k => db._data.waMeta.agentRoom[k].kind === 'info');
    const r = await handleAdmin({ action: 'agent-room-close', key: ask[0] }, { db, by: '0547725552', now: NOW + MIN });
    const e = db._data.waMeta.agentRoom[ask[0]];
    check('dismiss: closed by Ben, out of the open index, problem marked dismissed',
      [r.ok, e.state, e.answeredBy, openIdx(db).length, db._data.waMeta.agentWatch.problems.print_A.dismissed], [true, 'answered', 'ben', 0, true]);
    db._data.waMeta.invoiceWatcher.A.at = NOW + 2 * MIN;
    await W.lgAgentWatchRun(db, { env: ENV, now: NOW + 2 * MIN });
    check('dismiss: same problem still there → not raised again', room(db).length, 1);
    db._data.waMeta.invoiceWatcher.A = hb([], { at: NOW + 4 * MIN });
    await W.lgAgentWatchRun(db, { env: ENV, now: NOW + 4 * MIN });
    check('dismissed then fixed → forgotten quietly (no "תוקן")', [room(db).length, (db._data.waMeta.agentWatch.problems || {}).print_A], [1, undefined]);
    check('dismiss: an info line is not a question', (await handleAdmin({ action: 'agent-room-close', key: info || 'zz' }, { db, by: '050', now: NOW })).ok, false);

    //  מחשב שלא שלח דופק שבוע — נמחק, יחד עם הבעיות שלו (והצהוב נסגר)
    const db2 = mk({ waMeta: { invoiceWatcher: { OLD: hb([], { at: NOW, lastPrintError: { at: NOW, message: 'x' } }), A: hb([]) } } }, CFG('shadow'));
    await W.lgAgentWatchRun(db2, { env: ENV, now: NOW });
    const T = NOW + 8 * 24 * H;
    db2._data.waMeta.invoiceWatcher.A.at = T;
    await W.lgAgentWatchRun(db2, { env: ENV, now: T });
    check('prune: PC silent 7 days removed with its problems, its question closed',
      [Object.keys(db2._data.waMeta.invoiceWatcher), (db2._data.waMeta.agentWatch.problems || {}).print_OLD, openIdx(db2).length, room(db2).length],
      [['A'], undefined, 0, 1]);
  }

  // 8. שורת הדופק לסיכום היומי
  check('silent line: fresh heartbeat → none', W.lgWatcherSilentLine({ A: { at: NOW - 5 * MIN } }, NOW), '');
  check('silent line: 45 min in working hours', W.lgWatcherSilentLine({ A: { at: NOW - 45 * MIN } }, NOW), 'כלי החשבוניות במשרד לא ענה 45 דקות');
  check('silent line: never heard', W.lgWatcherSilentLine({}, NOW), 'כלי החשבוניות במשרד עוד לא שלח דופק');
  check('silent line: outside working hours → none', W.lgWatcherSilentLine({}, Date.UTC(2026, 10, 13, 8, 0)), '');

  if (failed) { console.error(`\n${failed} FAILED`); process.exit(1); }
  console.log('\nAll agent-watch checks passed.');
})().catch(e => { console.error(e); process.exit(1); });
