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

  // 4. שליחה ללקוח שנכשלה: ניסיון חוזר אחד, ואז צהוב
  {
    const inv = { k1: { state: 'ready', client: 'פלג', docNumber: '67600', createdAt: NOW - H, orderIds: ['o1'],
                        delivery: { state: 'failed', channel: 'whatsapp', reason: 'מנותק' } } };
    const db = mk({ invoicePdf: inv, waMeta: { invoiceWatcher: { A: hb([]) } } }, CFG('reply'));
    const tries = [];
    const deliver = async (d, key) => { tries.push(key); };
    await W.lgAgentWatchRun(db, { env: ENV, now: NOW, deliver, sendPending: async () => {} });
    check('delivery failed: retried once via deliver, grey line', [tries, room(db).map(e => e.kind)], [['k1'], ['info']]);
    db._data.waMeta.invoiceWatcher.A.at = NOW + 2 * MIN;
    await W.lgAgentWatchRun(db, { env: ENV, now: NOW + 2 * MIN, deliver, sendPending: async () => {} });
    check('still failing: no second retry, yellow now', [tries.length, room(db).map(e => e.kind + '/' + (e.state || ''))], [1, ['info/', 'ask/open']]);
    db._data.invoicePdf.k1.delivery = { state: 'sent' };
    db._data.waMeta.invoiceWatcher.A.at = NOW + 4 * MIN;
    await W.lgAgentWatchRun(db, { env: ENV, now: NOW + 4 * MIN, deliver, sendPending: async () => {} });
    check('sent later: question closed, "תוקן"', [room(db)[1].state, /תוקן/.test(room(db)[2].text)], ['answered', true]);
  }

  // 5. הדפסה שמחכה לרישום יותר משעה — רק ללקוח שיש לו משתמש
  {
    const P1 = { state: 'printed', docNumber: '67700', createdAt: NOW - 2 * H, text: 'חשבונית מס 67700 מפתח 1231 מקור' };
    const P2 = { state: 'printed', docNumber: '67701', createdAt: NOW - 2 * H, text: 'חשבונית מס 67701 מפתח 9999 מקור' };
    const P3 = { state: 'printed', docNumber: '67702', createdAt: NOW - 10 * MIN, text: 'חשבונית מס 67702 מפתח 1231 מקור' };
    const db = mk({ invoicePdf: { p1: P1, p2: P2, p3: P3 }, users: { '050': { customerId: '1231' } },
                    waMeta: { invoiceWatcher: { A: hb([]) } } }, CFG('shadow'));
    await W.lgAgentWatchRun(db, { env: ENV, now: NOW });
    check('printed >1h, customer in the system → yellow; unknown customer / fresh → nothing',
      room(db).map(e => [e.kind, /67700/.test(e.text)]), [['ask', true]]);
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

  // 8. שורת הדופק לסיכום היומי
  check('silent line: fresh heartbeat → none', W.lgWatcherSilentLine({ A: { at: NOW - 5 * MIN } }, NOW), '');
  check('silent line: 45 min in working hours', W.lgWatcherSilentLine({ A: { at: NOW - 45 * MIN } }, NOW), 'כלי החשבוניות במשרד לא ענה 45 דקות');
  check('silent line: never heard', W.lgWatcherSilentLine({}, NOW), 'כלי החשבוניות במשרד עוד לא שלח דופק');
  check('silent line: outside working hours → none', W.lgWatcherSilentLine({}, Date.UTC(2026, 10, 13, 8, 0)), '');

  if (failed) { console.error(`\n${failed} FAILED`); process.exit(1); }
  console.log('\nAll agent-watch checks passed.');
})().catch(e => { console.error(e); process.exit(1); });
