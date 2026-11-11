#!/usr/bin/env node
/**
 * השומרים (בן, 11/11) — api/_agent-guards.js: מוצאים מה נתקע, מעבירים לסוכן, שולחים שוב כשבטוח, שואלים את בן כשלא.
 * אפיון: docs/superpowers/specs/2026-11-11-agents-talk-design.md — סעיפים ו, ז, יא.
 * Run: node scripts/test-agent-guards.js
 */
const path = require('path');
const { fakeDb } = require(path.join(__dirname, '_fake-db.js'));
const G = require(path.join(__dirname, '..', 'api', '_agent-guards.js'));
const W = require(path.join(__dirname, '..', 'api', '_agent-watch.js'));
require(path.join(__dirname, '..', 'api', '_agent-morning.js')).lgAgentMorningRun = async () => ({ posted: false, skipped: 'test' });

let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));

const MIN = 60 * 1000, H = 60 * MIN;
//  שלישי 10.11.2026 10:00 בישראל (UTC+2)
const NOW = Date.UTC(2026, 10, 10, 8, 0, 0);
const YESTERDAY = NOW - 12 * H;            // שני 22:00 בישראל
const ENV = { AGENT_SHADOW_ENABLED: 'true' };
const CFG = (mode, extra) => ({ agents: { markazan: mode, okev: mode, archive: mode, price: 'shadow', kolet: mode, manager: mode, ...extra },
                                escalatePhone: '0547725552' });
const room = db => Object.values(((db._data.waMeta || {}).agentRoom) || {});
const probs = db => (((db._data.waMeta || {}).agentWatch) || {}).problems || {};
const mk = (data, cfg, wa) => fakeDb({ ...data, waMeta: { whatsapp: { state: wa || 'authorized' }, ...(data.waMeta || {}), ...(cfg ? { agentConfig: cfg } : {}) } });

//  דמה לשליחה: מסמן 'sent' (או נכשל) ומחזיר כמו drainNow
function drainSpy(outcome) {
  const calls = [];
  const fn = async (db, keys, by, opts) => {
    calls.push({ keys, by, budgetMs: opts && opts.budgetMs });
    const status = outcome || 'sent';
    for (const k of keys) {
      const cur = db._data.waOutbox[k];
      if (status === 'sent') db._data.waOutbox[k] = { ...cur, state: 'sent' };
      else if (status === 'error') db._data.waOutbox[k] = { ...cur, state: 'failed', attempts: 3, failureKind: 'network', lastError: 'timeout' };
    }
    return { results: keys.map(k => ({ key: k, status, reason: status === 'error' ? 'timeout' : null })) };
  };
  fn.calls = calls;
  return fn;
}
const pings = [];
G._notifyBen = async (db, a) => { pings.push(a.key); return { sent: 'skip' }; };
const run = (db, cfg, extra) => G.lgGuardRun(db, { env: ENV, now: NOW, cfg, deadline: Date.now() + 40 * 1000, ...extra });

const wa = (extra) => ({ kind: 'ready', to: '0501', clientName: 'מאור', orderNums: ['9117'], orderIds: ['o1'], state: 'pending',
                         attempts: 0, createdAt: NOW - 15 * MIN, ...extra });

(async () => {
  // ═══ lgGuardResendOk — טריות + כשל ברור ═══
  const R = (row, now) => G.lgGuardResendOk(row, now || NOW);
  check('resendOk: ready 30h old → not resent', R(wa({ state: 'failed', attempts: 3, failureKind: 'disconnected', createdAt: NOW - 30 * H })).ok, false);
  check('resendOk: ready 2h, failed disconnected → ok', R(wa({ state: 'failed', attempts: 3, failureKind: 'disconnected', createdAt: NOW - 2 * H })).ok, true);
  check('resendOk: rate / quota → ok', [R(wa({ state: 'failed', attempts: 3, failureKind: 'rate' })).ok, R(wa({ state: 'failed', attempts: 3, failureKind: 'quota' })).ok], [true, true]);
  check('resendOk: dispatched yesterday → not resent', R(wa({ kind: 'dispatched', createdAt: YESTERDAY })).ok, false);
  check('resendOk: dispatched this morning → ok', R(wa({ kind: 'dispatched', createdAt: NOW - 2 * H })).ok, true);
  check('resendOk: recipient / network / other / old row without failureKind → not clear',
    ['recipient', 'network', 'other', undefined].map(f => R(wa({ state: 'failed', attempts: 3, failureKind: f })).why),
    ['לא ברור אם יצאה', 'לא ברור אם יצאה', 'לא ברור אם יצאה', 'לא ברור אם יצאה']);
  check('resendOk: expired in queue without any attempt → ok (fresh)', R(wa({ kind: 'sketches-handled', state: 'expired', attempts: 0, createdAt: NOW - 3 * H })).ok, true);
  check('resendOk: sent → never', R(wa({ state: 'sent' })).ok, false);
  check('resendOk: invoice 40h → still ok; 50h → no', [R({ kind: 'invoice', state: 'pending', createdAt: NOW - 40 * H }).ok,
                                                      R({ kind: 'invoice', state: 'pending', createdAt: NOW - 50 * H }).ok], [true, false]);

  // ═══ lgGuardProblems — שורה לכל שורה בטבלה ═══
  const P = x => G.lgGuardProblems({ now: NOW, waState: 'authorized', ...x });
  const one = x => P(x).map(p => [p.key, p.finder, p.owner, p.level, p.fix ? p.fix.type : null]);
  check('row 1: WA pending >10 min → manager finds, okev fixes (send now)', one({ waOutbox: { a: wa() } }), [['wao_a', 'manager', 'okev', 'fix', 'wa-drain']]);
  check('row 1: pending 5 min / in flight → nothing',
    one({ waOutbox: { a: wa({ createdAt: NOW - 5 * MIN }), b: wa({ claimedAt: NOW - 30 * 1000 }) } }), []);
  check('row 1: pending >1h → Ben', one({ waOutbox: { a: wa({ createdAt: NOW - 90 * MIN }) } }).map(p => p[3]), ['ben']);
  check('row 13 (not here): WA disconnected → no WA problems at all', P({ waState: 'notAuthorized', waOutbox: { a: wa() } }), []);
  check('row 2: failed 3 times (disconnected) → resend once',
    one({ waOutbox: { a: wa({ state: 'failed', attempts: 3, failureKind: 'disconnected' }) } }), [['wao_a', 'manager', 'okev', 'fix', 'wa-resend']]);
  check('row 2: failed twice → queue still retrying, nothing', one({ waOutbox: { a: wa({ state: 'failed', attempts: 2, failureKind: 'network' }) } }), []);
  check('row 2: recipient failure → Ben, no fix', one({ waOutbox: { a: wa({ state: 'failed', attempts: 3, failureKind: 'recipient', lastError: 'מספר שגוי' }) } }),
    [['wao_a', 'manager', 'okev', 'ben', null]]);
  check('row 2: already resent once → Ben',
    one({ retried: { wao_a: { at: NOW - H } }, waOutbox: { a: wa({ state: 'failed', attempts: 3, failureKind: 'disconnected' }) } }).map(p => p[3]), ['ben']);
  check('row 4: "ready" expired (30h) → Ben; already collected → nothing',
    [one({ waOutbox: { a: wa({ state: 'expired', createdAt: NOW - 30 * H }) } }).map(p => p[3]),
     one({ waOutbox: { a: wa({ state: 'expired', createdAt: NOW - 30 * H }) }, orderStages: { o1: 'collected' } })], [['ben'], []]);
  check('row 5: "dispatched" from yesterday failed → only a room line (info), never a fix',
    one({ waOutbox: { a: wa({ kind: 'dispatched', state: 'failed', attempts: 3, failureKind: 'disconnected', createdAt: YESTERDAY }) } }),
    [['wao_a', 'manager', 'okev', 'info', null]]);
  check('owner by kind: "הסקיצות טופלו" → kolet, "פריט חזר" → okev, other → manager; late "נקלטו" → never',
    P({ waOutbox: { a: wa({ kind: 'sketches-handled' }), b: wa({ kind: 'broken-returned' }), c: wa({ kind: 'x' }), d: wa({ kind: 'sketches-received' }) } })
      .map(p => p.owner), ['kolet', 'okev', 'manager']);
  check('WA invoice rows are not here (row 3 owns them)', P({ waOutbox: { a: wa({ kind: 'invoice' }) } }), []);

  const inv = (dv, extra) => ({ state: 'ready', client: 'מאור', docNumber: '67550', createdAt: NOW - 2 * H, orderIds: ['o1'], delivery: dv, ...extra });
  check('row 3: invoice queued >1h (WA, never sent) → archive resends',
    one({ invoices: { k1: inv({ state: 'queued', channel: 'whatsapp', outboxKey: 'w1', at: NOW - 70 * MIN }) }, invOutbox: { k1: { state: 'pending', attempts: 0, createdAt: NOW - 70 * MIN } } }),
    [['deliv_k1', 'archive', 'archive', 'fix', 'invoice-redeliver']]);
  check('row 3: queued 30 min → nothing yet',
    one({ invoices: { k1: inv({ state: 'queued', channel: 'whatsapp', outboxKey: 'w1', at: NOW - 30 * MIN }) }, invOutbox: { k1: { state: 'pending' } } }), []);
  check('row 3: failed, provider timed out (network) → Ben ("may have gone out")',
    P({ invoices: { k1: inv({ state: 'failed', channel: 'whatsapp', outboxKey: 'w1', at: NOW - 10 * MIN }) },
        invOutbox: { k1: { state: 'failed', attempts: 3, failureKind: 'network', createdAt: NOW - H } } }).map(p => [p.level, /לא ברור/.test(p.text)]), [['ben', true]]);
  check('row 3: failed 40h ago, cleanly (rate) → still resent (window 48h)',
    one({ invoices: { k1: inv({ state: 'failed', channel: 'whatsapp', outboxKey: 'w1', at: NOW - 40 * H }, { createdAt: NOW - 40 * H }) },
          invOutbox: { k1: { state: 'failed', attempts: 3, failureKind: 'rate', createdAt: NOW - 40 * H } } }).map(p => p[4]), ['invoice-redeliver']);
  check('row 9: invoice blocked (no phone) → Ben',
    P({ invoices: { k1: inv({ state: 'blocked', channel: 'whatsapp', reason: 'אין נמען בוואטסאפ' }) } }).map(p => [p.level, /חסר נתון/.test(p.text)]), [['ben', true]]);
  check('row 3: email invoice still waiting for the Gmail script → not ours (alarm, task 4)',
    one({ invoices: { k1: inv({ state: 'queued', channel: 'email', outboxKey: 'e1', at: NOW - 2 * H }) }, invOutbox: { k1: { state: 'pending' } } }), []);

  const em = extra => ({ kind: 'sketches-handled', variant: 'po', clientName: 'אביבי', orderNums: ['L1'], orderIds: ['o9'], state: 'expired', attempts: 0, createdAt: NOW - 3 * H, ...extra });
  check('row 6: Avivi confirm mail expired without any attempt → kolet requeues',
    one({ emailOutbox: { e1: em() } }), [['emo_e1', 'kolet', 'kolet', 'fix', 'email-requeue']]);
  check('row 6: "ready" mail failed (script reported failure) → Ben',
    one({ emailOutbox: { e1: em({ kind: 'ready', variant: null, state: 'failed', attempts: 3 }) } }), [['emo_e1', 'okev', 'okev', 'ben', null]]);
  check('row 6: drafter batch mail / invoice mail → not here', P({ emailOutbox: { a: em({ kind: 'drafter-batch' }), b: em({ kind: 'invoice' }) } }), []);

  const win = extra => ({ state: 'dead', sender: '0509', createdAt: NOW - H, reason: 'הורדה נכשלה', ...extra });
  check('row 7: image dead (1h) → kolet retries', one({ waInbound: { m1: win() } }), [['win_m1', 'kolet', 'kolet', 'fix', 'inbound-retry']]);
  check('row 7: image dead 30h → Ben (file gone at the provider)', one({ waInbound: { m1: win({ createdAt: NOW - 30 * H }) } }).map(p => p[3]), ['ben']);
  check('row 7: received 1 min / processing (fresh claim) → nothing; received 5 min → fix',
    one({ waInbound: { a: win({ state: 'received', createdAt: NOW - MIN }), b: win({ state: 'processing', claimedAt: NOW - 30 * 1000 }),
                       c: win({ state: 'received', createdAt: NOW - 5 * MIN }) } }).map(p => p[0]), ['win_c']);
  check('row 8: email intake failed → kolet retries', one({ emailInbound: { x1: { state: 'failed', from: 'a@b.co', createdAt: NOW - H } } }),
    [['ein_x1', 'kolet', 'kolet', 'fix', 'inbound-retry']]);

  const orders = { o1: { orderNum: 'L1240', orderClient: 'מאור', hashavshevet: { httpOk: false, httpStatus: 400, sentAt: NOW - H } },
                   o2: { orderNum: 'L1241', hashavshevetInvoice: { httpOk: false, sentAt: NOW - H } },
                   o3: { orderNum: 'L1242', hashavshevet: { httpOk: true, sentAt: NOW - H } } };
  check('row 10: Hashavshevet refused order → okev asks Ben; refused invoice → archive asks Ben; never a fix',
    one({ orders }), [['hs_o1', 'okev', 'okev', 'ben', null], ['hsi_o2', 'archive', 'archive', 'ben', null]]);
  check('row 10: no orders given (not the hourly scan) → nothing', P({}), []);
  check('row 11: registered at the station >24h, not matched → archive asks Ben',
    one({ awaiting: { k5: { state: 'awaiting', docNumber: '67600', createdAt: NOW - 30 * H }, k6: { state: 'awaiting', createdAt: NOW - 2 * H } } }),
    [['await_k5', 'archive', 'archive', 'ben', null]]);
  check('row 12: label print unknown → kolet asks Ben (never reprints); reprinted → nothing',
    one({ printJobs: { j1: { state: 'unknown', client: 'מאור', createdAt: NOW - H }, j2: { state: 'failed', createdAt: NOW - H },
                       j3: { state: 'printed', reprintOf: 'j2', createdAt: NOW - 30 * MIN } } }), [['pjob_j1', 'kolet', 'kolet', 'ben', null]]);
  check('row 12א: unlinked number sent today → markazan, one key per day; linked / ignored → nothing',
    one({ sendersSeen: { '0501111111': { phone: '0501111111', count: 3, lastAt: NOW - H }, '0502222222': { phone: '0502222222', count: 1, lastAt: NOW - H },
                         '0503333333': { phone: '0503333333', count: 1, lastAt: NOW - H, ignored: { at: 1 } } },
          linkedSenders: { '0502222222': true } }), [['unl_2026-11-10', 'markazan', 'markazan', 'ben', null]]);

  // ═══ lgGuardRun — שיחה בחדר, מתגים, שליחה חוזרת ═══
  // off → nothing
  {
    const db = mk({ waOutbox: { a: wa() } }, CFG('off'));
    const drain = drainSpy();
    const r = await run(db, CFG('off'), { deps: { drain } });
    check('off → nothing (no room, no state, no send)', [r, room(db).length, Object.keys(probs(db)).length, drain.calls.length], [{ found: 0, fixed: 0, asked: 0 }, 0, 0, 0]);
  }
  // no config / master switch off → nothing
  {
    const db = mk({ waOutbox: { a: wa() } }, null);
    const drain = drainSpy();
    await G.lgGuardRun(db, { env: ENV, now: NOW, cfg: null, deps: { drain } });
    await G.lgGuardRun(db, { env: {}, now: NOW, cfg: CFG('reply'), deps: { drain } });
    check('no agentConfig / master off → nothing', [room(db).length, drain.calls.length], [0, 0]);
  }
  // shadow → would, no write to the outbox
  {
    const db = mk({ waOutbox: { a: wa({ state: 'failed', attempts: 3, failureKind: 'disconnected' }) } }, CFG('shadow'));
    const before = JSON.stringify(db._data.waOutbox);
    const drain = drainSpy();
    await run(db, CFG('shadow'), { deps: { drain } });
    check('shadow → thread: found (manager) → handoff (okev) → would "הייתי שולח שוב"',
      room(db).map(e => [e.agent, e.step, e.to || null]), [['manager', 'found', 'okev'], ['manager', 'handoff', 'okev'], ['okev', 'would', null]]);
    check('shadow → would text', /הייתי שולח שוב/.test(room(db)[2].text), true);
    check('shadow → no write to the outbox, no send, no retried memory',
      [JSON.stringify(db._data.waOutbox) === before, drain.calls.length, !!(db._data.waMeta.agentWatch.retried)], [true, 0, false]);
    await run(db, CFG('shadow'), { now: NOW + 10 * MIN, deps: { drain } });
    check('shadow: same problem next run → no second "would"', room(db).length, 3);
  }
  // row 1 in reply: send now → done, all in one thread; next run → nothing new
  {
    const db = mk({ waOutbox: { a: wa() } }, CFG('reply'));
    const drain = drainSpy();
    const r = await run(db, CFG('reply'), { deps: { drain } });
    const rows = room(db);
    check('reply row 1: drained once by the guard', [drain.calls.length, drain.calls[0].keys, drain.calls[0].by], [1, ['a'], 'agent-guard']);
    check('reply row 1: found → handoff → done ✓, one thread', [rows.map(e => e.step), new Set(rows.map(e => e.thread)).size, /✓/.test(rows[2].text)],
      [['found', 'handoff', 'done'], 1, true]);
    check('reply row 1: counts', r, { found: 1, fixed: 1, asked: 0 });
    check('reply row 1: drain budget stays under the heartbeat', drain.calls[0].budgetMs <= 20000 && drain.calls[0].budgetMs >= 16000, true);
    await run(db, CFG('reply'), { now: NOW + 10 * MIN, deps: { drain } });
    check('reply row 1: sent → problem gone quietly (already said ✓)', [room(db).length, Object.keys(probs(db)).length, drain.calls.length], [3, 0, 1]);
  }
  // same problem two runs → one thread; fixed by someone else → done in the same thread; comes back → new thread
  {
    const db = mk({ waOutbox: { a: wa({ state: 'failed', attempts: 3, failureKind: 'recipient' }) } }, CFG('shadow'));
    await run(db, CFG('shadow'));
    await run(db, CFG('shadow'), { now: NOW + 10 * MIN });
    check('same problem two runs → one thread', [room(db).filter(e => e.step === 'found').length, new Set(room(db).map(e => e.thread)).size], [1, 1]);
    const t1 = room(db)[0].thread;
    db._data.waOutbox.a.state = 'sent';
    await run(db, CFG('shadow'), { now: NOW + 20 * MIN });
    const last = room(db).slice(-1)[0];
    const ask = room(db).find(e => e.step === 'need-ben');
    check('fixed elsewhere → "נפתר ✓" in the same thread, Ben question closed', [last.step, last.thread === t1, ask.state], ['done', true, 'answered']);
    db._data.waOutbox.a = wa({ state: 'failed', attempts: 3, failureKind: 'recipient', createdAt: NOW + 25 * MIN });
    await run(db, CFG('shadow'), { now: NOW + 40 * MIN });
    const threads = [...new Set(room(db).map(e => e.thread))];
    check('came back after it was fixed → a new thread', threads.length, 2);
  }
  // recipient failure → Ben, not resent; Ben pinged once (reply)
  {
    pings.length = 0;
    const db = mk({ waOutbox: { a: wa({ state: 'failed', attempts: 3, failureKind: 'recipient', lastError: 'מספר שגוי' }) } }, CFG('reply'));
    const drain = drainSpy();
    await run(db, CFG('reply'), { deps: { drain } });
    await run(db, CFG('reply'), { now: NOW + 10 * MIN, deps: { drain } });
    const ask = room(db).find(e => e.step === 'need-ben');
    check('recipient failure → ben (yellow, internal), not resent', [ask.kind, ask.state, ask.internal, drain.calls.length], ['ask', 'open', true, 0]);
    check('recipient failure → Ben notified once (two runs)', pings, ['wao_a']);
  }
  // network failure → Ben; shadow → room only, no ping
  {
    pings.length = 0;
    const db = mk({ waOutbox: { a: wa({ state: 'failed', attempts: 3, failureKind: 'network' }) } }, CFG('shadow'));
    const drain = drainSpy();
    await run(db, CFG('shadow'), { deps: { drain } });
    check('network failure → ben in the room, no resend; shadow → no ping',
      [room(db).map(e => e.step), drain.calls.length, pings.length], [['found', 'handoff', 'need-ben'], 0, 0]);
  }
  // disconnected → no resend while WA is down
  {
    const db = mk({ waOutbox: { a: wa({ state: 'failed', attempts: 3, failureKind: 'disconnected' }), b: wa() } }, CFG('reply'), 'notAuthorized');
    const drain = drainSpy();
    await run(db, CFG('reply'), { deps: { drain } });
    check('WA disconnected → no resend, no thread (the alarm is task 4)', [drain.calls.length, room(db).length], [0, 0]);
    db._data.waMeta.whatsapp.state = 'authorized';
    await run(db, CFG('reply'), { now: NOW + 10 * MIN, deps: { drain } });
    check('WA back → guards resume (one action per run per channel)', drain.calls.length, 1);
  }
  // second failure after resend → Ben, no third try; retried written before acting
  {
    pings.length = 0;
    const db = mk({ waOutbox: { a: wa({ state: 'failed', attempts: 3, failureKind: 'disconnected' }) } }, CFG('reply'));
    const seen = [];
    const inner = drainSpy('error');
    const drain = async (d, keys, by, opts) => {
      const w = d._data.waMeta.agentWatch || {};
      seen.push([!!(w.retried && w.retried.wao_a), d._data.waOutbox.a.state, d._data.waOutbox.a.attempts]);
      return inner(d, keys, by, opts);
    };
    await run(db, CFG('reply'), { deps: { drain } });
    check('resend: retried written before acting; attempts reset to 0 and back to pending', seen, [[true, 'pending', 0]]);
    check('resend failed → need-ben in the same thread + ping', [room(db).map(e => e.step), pings], [['found', 'handoff', 'need-ben'], ['wao_a']]);
    await run(db, CFG('reply'), { now: NOW + 10 * MIN, deps: { drain } });
    await run(db, CFG('reply'), { now: NOW + 20 * MIN, deps: { drain } });
    check('second failure after resend → no third try, no new rows, no second ping', [seen.length, room(db).length, pings.length], [1, 3, 1]);
  }
  // ready 30h old → not resent (Ben); dispatched yesterday → not resent (room only)
  {
    const db = mk({ waOutbox: { a: wa({ state: 'expired', createdAt: NOW - 30 * H }),
                                b: wa({ kind: 'dispatched', state: 'failed', attempts: 3, failureKind: 'disconnected', createdAt: YESTERDAY, orderIds: ['o2'] }) },
                    orders: { o1: { stage: 'done' } } }, CFG('reply'));
    const drain = drainSpy();
    await run(db, CFG('reply'), { deps: { drain } });
    const steps = room(db).map(e => e.step);
    check('ready 30h old → not resent; dispatched yesterday → not resent', drain.calls.length, 0);
    check('ready 30h → need-ben; dispatched yesterday → done "רק רושם"',
      [steps.includes('need-ben'), room(db).filter(e => e.step === 'done').map(e => e.text)], [true, ['רק רושם — לא שולח']]);
    check('both are WA status messages → one grouped "stale" thread', [room(db).filter(e => e.step === 'found').length, /^grp_manager_wa-stale_/.test(room(db)[0].thread)], [1, true]);
  }
  // grouping: 3 pending messages of the same kind in one run → ONE thread, handoff per owner; one send per run
  {
    const db = mk({ waOutbox: { a: wa(), b: wa({ clientName: 'כהן', orderIds: ['o2'] }), c: wa({ kind: 'sketches-handled', clientName: 'לוי', orderIds: ['o3'] }) } }, CFG('reply'));
    const drain = drainSpy();
    await run(db, CFG('reply'), { deps: { drain } });
    const rows = room(db);
    check('grouping: one thread grp_<finder>_wa-pending_*, text "3 הודעות…"',
      [new Set(rows.map(e => e.thread)).size, /^grp_manager_wa-pending_/.test(rows[0].thread), /^3 הודעות וואטסאפ מחכות/.test(rows[0].text)], [1, true, true]);
    check('grouping: handoffs "עוקב, 2 שלך" + "קולט, אחת שלך"', rows.filter(e => e.step === 'handoff').map(e => e.text).sort(), ['עוקב, 2 שלך', 'קולט, אחת שלך']);
    check('grouping: one send action this run; per-item problem records share the thread',
      [drain.calls.length, new Set(Object.values(probs(db)).map(p => p.thread)).size, Object.keys(probs(db)).sort()], [1, 1, ['wao_a', 'wao_b', 'wao_c']]);
    await run(db, CFG('reply'), { now: NOW + 10 * MIN, deps: { drain } });
    check('grouping: the next one goes out next run, in the same thread', [drain.calls.length, new Set(room(db).map(e => e.thread)).size], [2, 1]);
  }
  // row 3: invoice queued >1h → lgInvoiceDeliver called once
  {
    const db = mk({ invoicePdf: { k1: inv({ state: 'queued', channel: 'whatsapp', outboxKey: 'w1', at: NOW - 70 * MIN }) },
                    waOutbox: { w1: { kind: 'invoice', state: 'pending', attempts: 0, createdAt: NOW - 70 * MIN } } }, CFG('reply'));
    const tries = [];
    const deliver = async (d, k, o) => { tries.push([k, typeof o.drain]); return { state: 'queued', channel: 'whatsapp' }; };
    await run(db, CFG('reply'), { deps: { deliver } });
    await run(db, CFG('reply'), { now: NOW + 10 * MIN, deps: { deliver } });
    check('invoice queued >1h → lgInvoiceDeliver called once (with a budgeted drain)', tries, [['k1', 'function']]);
    check('invoice: archive finds and fixes itself (no handoff)', room(db).map(e => [e.agent, e.step]), [['archive', 'found']]);
    db._data.invoicePdf.k1.delivery = { state: 'sent', channel: 'whatsapp', at: NOW + 15 * MIN };
    await run(db, CFG('reply'), { now: NOW + 20 * MIN, deps: { deliver } });
    check('invoice sent later → "נפתר ✓" closes the thread', room(db).slice(-1)[0].step, 'done');
  }
  // row 3: email invoice expired in the mail queue → delivery marked failed, then redelivered
  {
    const db = mk({ invoicePdf: { k1: inv({ state: 'queued', channel: 'email', outboxKey: 'e1', at: NOW - 30 * H }, { createdAt: NOW - 30 * H }) },
                    waMeta: { emailOutbox: { e1: { kind: 'invoice', state: 'expired', attempts: 0, createdAt: NOW - 30 * H } } } }, CFG('reply'));
    const seen = [];
    const deliver = async (d, k) => { seen.push(d._data.invoicePdf[k].delivery.state); return { state: 'queued', channel: 'email' }; };
    await run(db, CFG('reply'), { deps: { deliver } });
    check('email invoice expired → delivery set to failed before redeliver (fresh mail row)', seen, ['failed']);
  }
  // row 6 in reply: mail requeued once (fresh row), sent later → done
  {
    const db = mk({ waMeta: { emailOutbox: { e1: em() } } }, CFG('reply'));
    await run(db, CFG('reply'));
    const e = db._data.waMeta.emailOutbox.e1;
    check('row 6 reply: same row starts again (pending, attempts 0, fresh createdAt)', [e.state, e.attempts, e.createdAt, e.firstCreatedAt], ['pending', 0, NOW, NOW - 3 * H]);
    e.state = 'sent';
    await run(db, CFG('reply'), { now: NOW + 10 * MIN });
    check('row 6: sent → "נפתר ✓"', room(db).map(e2 => e2.step), ['found', 'done']);
  }
  // row 7 in reply: retry + process; failure → Ben
  {
    const db = mk({ waInbound: { m1: win() } }, CFG('reply'));
    const calls = [];
    const deps = { waInboundRetry: async (d, k) => { calls.push('retry:' + k); return { ok: true }; },
                   waInboundProcess: async (d, k) => { calls.push('process:' + k); return { ok: false, reason: 'הורדה נכשלה' }; } };
    await run(db, CFG('reply'), { deps });
    check('row 7 reply: retry then process', calls, ['retry:m1', 'process:m1']);
    check('row 7: failed again → Ben', room(db).map(e => e.step), ['found', 'need-ben']);
    await run(db, CFG('reply'), { now: NOW + 10 * MIN, deps });
    check('row 7: no second retry', calls.length, 2);
  }
  // row 10 only from the hourly orders scan
  {
    const db = mk({}, CFG('reply'));
    await run(db, CFG('reply'));
    check('row 10: without the scan orders → nothing', room(db).length, 0);
    await run(db, CFG('reply'), { orders });
    check('row 10: with the scan orders → two Ben questions (okev + archive)', room(db).filter(e => e.step === 'need-ben').map(e => e.agent).sort(), ['archive', 'okev']);
    await run(db, CFG('reply'), { now: NOW + 10 * MIN });
    check('row 10: a run without the scan does not "fix" them', [Object.keys(probs(db)).sort(), room(db).filter(e => e.step === 'done').length], [['hs_o1', 'hsi_o2'], 0]);
  }
  // row 12 run: print jobs read by key, only the last 48h
  {
    const k = t => t.toString(36) + 'ab12cd34';
    const db = mk({ waMeta: { printJobs: { [k(NOW - H)]: { state: 'unknown', client: 'מאור', createdAt: NOW - H },
                                          [k(NOW - 72 * H)]: { state: 'unknown', client: 'ישן', createdAt: NOW - 72 * H } } } }, CFG('shadow'));
    await run(db, CFG('shadow'));
    check('row 12 run: only the recent job → one Ben question (kolet), never a reprint',
      room(db).map(e => [e.agent, e.step]), [['kolet', 'found'], ['kolet', 'need-ben']]);
  }
  // a record from before threads (old _agent-watch deliv_), not escalated → may be resent once, "done" in a new thread
  {
    const db = mk({ invoicePdf: { k1: inv({ state: 'failed', channel: 'whatsapp', outboxKey: 'w1', at: NOW - 3 * H }) },
                    waOutbox: { w1: { kind: 'invoice', state: 'failed', attempts: 3, failureKind: 'disconnected', createdAt: NOW - 3 * H } },
                    waMeta: { agentWatch: { problems: { deliv_k1: { level: 'info', agent: 'archive', at: NOW - 3 * H, text: 'x', src: 'k1', roomKey: null, asked: false } } } } },
                  CFG('reply'));
    const tries = [];
    await run(db, CFG('reply'), { deps: { deliver: async (d, key) => { tries.push(key); return { state: 'sent' }; } } });
    check('old grey record without a thread → resent once, "done" written into a new thread',
      [tries, room(db).map(e => e.step), !!(room(db)[0] || {}).thread], [['k1'], ['done'], true]);
  }
  // IMPORTANT (review 1): an old yellow question to Ben (asked:true, no thread) → never resent; new thread found + need-ben; old question closed
  for (const [name, legacyRec] of [['asked:true', { level: 'ask', asked: true }], ['level ask only', { level: 'ask', asked: false }]]) {
    pings.length = 0;
    const db = mk({ invoicePdf: { k1: inv({ state: 'failed', channel: 'whatsapp', outboxKey: 'w1', at: NOW - 3 * H }) },
                    waOutbox: { w1: { kind: 'invoice', state: 'failed', attempts: 3, failureKind: 'disconnected', createdAt: NOW - 3 * H } },
                    waMeta: { agentRoom: { old1: { at: NOW - 3 * H, agent: 'archive', kind: 'ask', state: 'open', internal: true, text: 'x', question: 'x' } },
                              agentRoomOpen: { old1: { at: NOW - 3 * H, agent: 'archive', customer: '' } },
                              agentWatch: { problems: { deliv_k1: { agent: 'archive', at: NOW - 3 * H, text: 'x', src: 'k1', roomKey: 'old1', ...legacyRec } } } } },
                  CFG('reply'));
    const tries = [];
    const deps = { deliver: async (d, key) => { tries.push(key); return { state: 'sent' }; } };
    await run(db, CFG('reply'), { deps });
    await run(db, CFG('reply'), { now: NOW + 10 * MIN, deps });
    const rows = room(db).filter(e => e.thread);
    const opens = Object.keys(db._data.waMeta.agentRoomOpen || {});
    check('old yellow (' + name + ') → never resent automatically (two runs)', tries, []);
    check('old yellow (' + name + ') → new thread: found + need-ben, once', [rows.map(e => e.step), new Set(rows.map(e => e.thread)).size], [['found', 'need-ben'], 1]);
    check('old yellow (' + name + ') → Ben sees one open question, not two; no second ping',
      [opens.length, opens[0] !== 'old1', db._data.waMeta.agentRoom.old1.state === 'answered', pings.length], [1, true, true, 0]);
  }
  // escalated record (with a thread) is never resent, even if the row later looks clear
  {
    const db = mk({ waOutbox: { a: wa({ state: 'failed', attempts: 3, failureKind: 'disconnected' }) },
                    waMeta: { agentWatch: { problems: { wao_a: { level: 'ben', agent: 'okev', finder: 'manager', at: NOW - H, src: 'a', thread: 't1', roomKey: 'q1', asked: true, acted: true } } } } },
                  CFG('reply'));
    const drain = drainSpy();
    await run(db, CFG('reply'), { deps: { drain } });
    check('already with Ben (thread) → no resend, no new rows', [drain.calls.length, room(db).length], [0, 0]);
  }
  // IMPORTANT (review 2): rows older than 48h cause no reads of orders and are not even fetched
  {
    const db = mk({ waOutbox: { old: wa({ state: 'expired', createdAt: NOW - 30 * 24 * H, orderIds: ['oOld'] }),
                                old2: wa({ state: 'failed', attempts: 3, failureKind: 'network', createdAt: NOW - 5 * 24 * H, orderIds: ['oOld2'] }) },
                    waInbound: { d1: win({ createdAt: NOW - 10 * 24 * H }) }, emailInbound: { d2: { state: 'dead', createdAt: NOW - 10 * 24 * H } },
                    waMeta: { emailOutbox: { e1: em({ kind: 'ready', variant: null, state: 'failed', attempts: 3, createdAt: NOW - 9 * 24 * H, orderIds: ['oOld3'] }) } } },
                  CFG('shadow'));
    const reads = [];
    const real = db.ref.bind(db);
    db.ref = p => { const r = real(p), q = [], o = { ...r };
      for (const n of ['orderByChild', 'orderByKey', 'equalTo', 'startAt']) o[n] = (...a) => { q.push(n + ':' + a.join(',')); r[n](...a); return o; };
      o.once = async () => { reads.push(String(p) + (q.length ? '?' + q.join('&') : '')); return r.once(); };
      return o; };
    await run(db, CFG('shadow'));
    check('rows older than 48h → no orders/<id>/stage reads, nothing in the room', [reads.filter(r => r.startsWith('orders/')), room(db).length], [[], 0]);
    check('waOutbox / waInbound / emailInbound read by createdAt from 48h only (never all expired / dead by state)',
      reads.filter(r => /^(waOutbox|waInbound|emailInbound)/.test(r)).sort(),
      ['emailInbound?orderByChild:createdAt&startAt:' + (NOW - 48 * H), 'waInbound?orderByChild:createdAt&startAt:' + (NOW - 48 * H),
       'waOutbox?orderByChild:createdAt&startAt:' + (NOW - 48 * H)]);
  }
  // minor (b): a row the guard reset counts its age from the reset — not "stuck >1h" right after it
  check('reset row: age from guardResendAt → still a drain fix, not Ben',
    one({ waOutbox: { a: wa({ createdAt: NOW - 3 * H, guardResendAt: NOW - 15 * MIN }) } }).map(p => [p[3], p[4]]), [['fix', 'wa-drain']]);
  // minor (c): no raw provider text in the room / Ben text
  {
    const t = P({ waOutbox: { a: wa({ state: 'failed', attempts: 3, failureKind: 'network', lastError: 'AbortError: https://api.green-api.com/waInstance7100/x?token=SECRET' }),
                              b: wa({ state: 'failed', attempts: 3, failureKind: null, lastError: 'Error 466 something', orderIds: ['o2'] }) },
                  invoices: { k1: inv({ state: 'failed', channel: 'whatsapp', outboxKey: 'w1', reason: 'HTTP 500 {"error":"x"}', at: NOW - 10 * MIN }) },
                  invOutbox: { k1: { state: 'failed', attempts: 3, failureKind: 'other', createdAt: NOW - H } } }).map(p => p.text);
    check('no raw provider text: failureKind → Hebrew, unknown → "סיבה לא ידועה"',
      [t.some(x => /green-api|SECRET|AbortError|466|HTTP|error/.test(x)), /תקלת תקשורת/.test(t[0]), /סיבה לא ידועה/.test(t[1]), /סיבה לא ידועה/.test(t[2])],
      [false, true, true, true]);
    check('known system reason kept as a short phrase', /אין מספר טלפון ללקוח/.test(P({ invoices: { k1: inv({ state: 'blocked', reason: 'אין נמען בוואטסאפ' }) } })[0].text), true);
    check('resendOk why is Hebrew', [R(wa({ state: 'failed', attempts: 3, failureKind: 'rate' })).why], ['לא יצאה — יותר מדי הודעות בבת אחת']);
  }
  // inbound: changed meanwhile (already done) → not reported as a failure
  {
    const db = mk({ waInbound: { m1: win() } }, CFG('reply'));
    await run(db, CFG('reply'), { deps: { waInboundRetry: async () => ({ ok: false, code: 'done', message: 'כבר נוצרה הזמנה' }),
                                          waInboundProcess: async () => { throw new Error('should not process'); } } });
    check('row 7: already done meanwhile → ✓, not Ben', room(db).map(e => e.step), ['found', 'done']);
  }
  // dismissed (Ben pressed "סגור") → not raised again
  {
    const db = mk({ waOutbox: { a: wa({ state: 'failed', attempts: 3, failureKind: 'network' }) } }, CFG('shadow'));
    await run(db, CFG('shadow'));
    const askKey = Object.keys(db._data.waMeta.agentRoom).find(k => db._data.waMeta.agentRoom[k].step === 'need-ben');
    await W.lgWatchDismiss(db, askKey, { now: NOW + MIN, by: '0547725552' });
    await run(db, CFG('shadow'), { now: NOW + 10 * MIN });
    check('dismissed → not raised again', [room(db).length, probs(db).wao_a.dismissed], [3, true]);
  }
  // past the deadline → nothing
  {
    const db = mk({ waOutbox: { a: wa() } }, CFG('reply'));
    const drain = drainSpy();
    await run(db, CFG('reply'), { deadline: Date.now() - 1, deps: { drain } });
    check('past the deadline → no room, no send', [room(db).length, drain.calls.length], [0, 0]);
  }
  // agent off: its problem is not opened, and its old record is not "fixed"
  {
    const db = mk({ waOutbox: { a: wa() } }, CFG('shadow'));
    await run(db, CFG('shadow'));
    db._data.waOutbox.a.state = 'sent';
    await run(db, CFG('shadow', { okev: 'off' }), { now: NOW + 10 * MIN });
    check('owner off → record kept, no "נפתר"', [!!probs(db).wao_a, room(db).filter(e => e.step === 'done').length], [true, 0]);
  }

  // ═══ החיבור ל-_agent-watch ═══
  {
    const real = G.lgGuardRun;
    const calls = [];
    G.lgGuardRun = async (db, o) => { calls.push(o); return { found: 0, fixed: 0, asked: 0 }; };
    const hb = { at: NOW, pending: [], lastPrintError: null, version: 'v' };
    let db = mk({ waMeta: { invoiceWatcher: { A: hb } } }, null);
    await W.lgAgentWatchRun(db, { env: ENV, now: NOW });
    check('no agentConfig → lgGuardRun not called', calls.length, 0);
    db = mk({ waMeta: { invoiceWatcher: { A: { ...hb } } } }, CFG('shadow'));
    await W.lgAgentWatchRun(db, { env: ENV, now: NOW });
    db._data.waMeta.invoiceWatcher.A.at = NOW + 2 * MIN;
    await W.lgAgentWatchRun(db, { env: ENV, now: NOW + 2 * MIN });
    check('with config: called in the slow run only (once in two runs), with cfg and deadline',
      [calls.length, !!calls[0].cfg, calls[0].deadline > 0], [1, true, true]);
    //  אין שני מסלולים לאותה חשבונית: הבדיקות של _agent-watch כבר לא נוגעות ב-deliv
    const tries = [];
    db = mk({ invoicePdf: { k1: inv({ state: 'failed', channel: 'whatsapp', at: NOW - 10 * MIN }) }, waMeta: { invoiceWatcher: { A: { ...hb } } } }, CFG('reply'));
    await W.lgAgentWatchRun(db, { env: ENV, now: NOW, deliver: async (d, k) => { tries.push(k); }, sendPending: async () => {} });
    check('one path only: watch itself never retries an invoice (guards stubbed → nothing)', [tries, room(db).length], [[], 0]);
    //  (d): ארכיון לבד → סריקת השעה רצה, ו-orders עובר לשומרים (חשבשבת דחה חשבונית)
    calls.length = 0;
    db = mk({ orders: { o2: { orderNum: 'L1', hashavshevetInvoice: { httpOk: false, sentAt: NOW - H } } }, waMeta: { invoiceWatcher: { A: { ...hb } } } },
            { agents: { archive: 'shadow', okev: 'off', kolet: 'off' } });
    await W.lgAgentWatchRun(db, { env: ENV, now: NOW });
    check('only archive on → hourly orders scan runs and reaches the guards', [calls.length, !!(calls[0] && calls[0].orders && calls[0].orders.o2)], [1, true]);
    check('(e) the agentWatch node is passed in (no second read)', !!(calls[0] && calls[0].watchState && calls[0].watchState.problems), true);
    G.lgGuardRun = real;
  }

  if (failed) { console.error(`\n${failed} FAILED`); process.exit(1); }
  console.log('\nAll agent-guards checks passed.');
})().catch(e => { console.error(e); process.exit(1); });
