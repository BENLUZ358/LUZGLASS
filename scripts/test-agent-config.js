#!/usr/bin/env node
/**
 * מתגי הסוכנים במסך (בן, 10/11) — waMeta/agentConfig, lgAgentMode, והפעולה
 * agent-config-set ב-/api/wa-inbound-drain. אפיון: docs/superpowers/specs/2026-11-10-agents-room-design.md
 * Run:  node scripts/test-agent-config.js
 */
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { fakeDb } = require(path.join(__dirname, '_fake-db.js'));
const C = require(path.join(ROOT, 'api', '_agent-config.js'));
const { handleAdmin } = require(path.join(ROOT, 'api', 'wa-inbound-drain.js'));
let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));

const NOW = 1792500000000;
const SH = { AGENT_SHADOW_ENABLED: 'true' };
const ALL = { AGENT_SHADOW_ENABLED: 'true', AGENT_REPLY_ENABLED: 'true' };

(async () => {
  check('the six agents', C.LG_AGENT_KEYS, ['markazan', 'okev', 'archive', 'price', 'kolet', 'manager']);
  check('modes', C.LG_AGENT_MODES, ['off', 'shadow', 'reply']);
  check('Ben\'s number is the default', C.AGENT_ESCALATE_DEFAULT, '0547725552');

  /* ── lgAgentModeOf: טהור ── */
  check('master switch off → off, whatever the screen says',
    ['okev', 'manager'].map(k => C.lgAgentModeOf({ agents: { okev: 'reply', manager: 'reply' } }, k, { AGENT_REPLY_ENABLED: 'true' })), ['off', 'off']);
  check('no config → shadow (reply env not set) — nothing changes on deploy', C.lgAgentModeOf(null, 'okev', SH), 'shadow');
  check('no config + AGENT_REPLY_ENABLED → reply, as today', C.lgAgentModeOf(null, 'okev', ALL), 'reply');
  check('config wins over AGENT_REPLY_ENABLED', [C.lgAgentModeOf({ agents: { okev: 'shadow' } }, 'okev', ALL),
    C.lgAgentModeOf({ agents: { okev: 'reply' } }, 'okev', SH), C.lgAgentModeOf({ agents: { okev: 'off' } }, 'okev', ALL)], ['shadow', 'reply', 'off']);
  check('bad stored value → the old behaviour for that agent', C.lgAgentModeOf({ agents: { okev: 'yes' } }, 'okev', SH), 'shadow');
  check('unknown agent key → the old behaviour', [C.lgAgentModeOf({ agents: {} }, '', ALL), C.lgAgentModeOf({ agents: {} }, 'x', SH)], ['reply', 'shadow']);
  check('escalate phone: stored / default / bad', [C.lgAgentEscalatePhone({ escalatePhone: '052-1234567' }), C.lgAgentEscalatePhone(null),
    C.lgAgentEscalatePhone({ escalatePhone: 'abc' })], ['0521234567', '0547725552', '0547725552']);

  /* ── lgAgentMode: קורא מה-DB ── */
  {
    const db = fakeDb({ waMeta: { agentConfig: { agents: { okev: 'reply', archive: 'off' } } } });
    check('lgAgentMode reads waMeta/agentConfig', [await C.lgAgentMode(db, 'okev', SH), await C.lgAgentMode(db, 'archive', ALL), await C.lgAgentMode(db, 'price', SH)],
      ['reply', 'off', 'shadow']);
    check('lgAgentMode — master switch', await C.lgAgentMode(db, 'okev', {}), 'off');
    check('lgAgentMode — no config', await C.lgAgentMode(fakeDb({}), 'okev', ALL), 'reply');
  }

  /* ── agent-config-set: אימות קפדני ── */
  {
    const db = fakeDb({});
    const run = (b, env) => C.lgAgentConfigSet(db, b, { by: '0501112222', now: NOW, env: env || SH });
    for (const [why, b] of [['unknown agent', { agent: 'boss', mode: 'reply' }], ['bad mode', { agent: 'okev', mode: 'on' }],
      ['proto key', { agent: '__proto__', mode: 'reply' }], ['nothing', {}], ['bad phone', { escalatePhone: '12345' }],
      ['agent without mode', { agent: 'okev' }], ['phone not a string', { escalatePhone: 547725552 }]]) {
      const r = await run(b);
      check('rejects ' + why, [r.ok, !!r.code, db._data.waMeta], [false, true, undefined]);
    }
    let r = await run({ agent: 'okev', mode: 'reply' });
    check('first write seeds every agent with what it does today, then the change', [r.ok, db._data.waMeta.agentConfig.agents],
      [true, { markazan: 'shadow', okev: 'reply', archive: 'shadow', price: 'shadow', kolet: 'shadow', manager: 'shadow' }]);
    check('who and when', [db._data.waMeta.agentConfig.updatedAt, db._data.waMeta.agentConfig.by], [NOW, '0501112222']);
    check('escalate phone seeded with Ben\'s number', db._data.waMeta.agentConfig.escalatePhone, '0547725552');
    r = await run({ agent: 'archive', mode: 'off' });
    check('second write changes only that agent', db._data.waMeta.agentConfig.agents,
      { markazan: 'shadow', okev: 'reply', archive: 'off', price: 'shadow', kolet: 'shadow', manager: 'shadow' });
    r = await run({ escalatePhone: '+972 52-123-4567' });
    check('phone normalised to local digits', [r.ok, db._data.waMeta.agentConfig.escalatePhone], [true, '0521234567']);
    const db2 = fakeDb({});
    await C.lgAgentConfigSet(db2, { agent: 'price', mode: 'shadow' }, { by: 'x', now: NOW, env: ALL });
    check('first write with AGENT_REPLY_ENABLED on → others stay reply', db2._data.waMeta.agentConfig.agents,
      { markazan: 'reply', okev: 'reply', archive: 'reply', price: 'shadow', kolet: 'reply', manager: 'reply' });
  }

  /* ── דרך ה-drain ── */
  {
    const db = fakeDb({});
    const saved = process.env.AGENT_SHADOW_ENABLED;
    process.env.AGENT_SHADOW_ENABLED = 'true';
    const r = await handleAdmin({ action: 'agent-config-set', agent: 'kolet', mode: 'reply' }, { db, by: '0501112222', now: NOW });
    check('drain agent-config-set', [r.ok, db._data.waMeta.agentConfig.agents.kolet], [true, 'reply']);
    const bad = await handleAdmin({ action: 'agent-config-set', agent: 'kolet', mode: 'loud' }, { db, by: 'x', now: NOW });
    check('drain rejects a bad mode', [bad.ok, bad.code], [false, 'bad-mode']);
    const st = await handleAdmin({ action: 'agent-status' }, { db, by: 'x', now: NOW });
    check('agent-status returns the switches as modes', [st.ok, st.config.agents.kolet, st.config.agents.okev, st.config.escalatePhone, st.config.saved],
      [true, 'reply', 'shadow', '0547725552', true]);
    const st2 = await handleAdmin({ action: 'agent-status' }, { db: fakeDb({}), by: 'x', now: NOW });
    check('agent-status with no config → modes from the old switches, saved:false', [st2.config.agents.okev, st2.config.saved], ['shadow', false]);
    if (saved === undefined) delete process.env.AGENT_SHADOW_ENABLED; else process.env.AGENT_SHADOW_ENABLED = saved;
  }

  if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
  console.log('\nAll agent-config checks passed.');
})().catch(e => { console.error(e); process.exit(1); });
