#!/usr/bin/env node
/** Harness: loads gmail-intake.gs with stubs and checks the outbox exactly-once behaviour.
 *  Run: node scripts/test-gmail-intake-outbox.js */
const fs = require('fs'), path = require('path'), vm = require('vm');
let fails = 0;
const check = (n, a, e) => { const ok = JSON.stringify(a) === JSON.stringify(e); if (!ok) { fails++; console.log('FAIL', n, JSON.stringify(a), '!=', JSON.stringify(e)); } else console.log('ok  ', n); };
const src = fs.readFileSync(path.join(__dirname, 'gmail-intake.gs'), 'utf8');

function world(opts) {
  const store = opts.store || {}, log = [], calls = [], logs = [];
  const sandbox = {
    PropertiesService: { getScriptProperties: () => ({
      getProperties: () => Object.assign({}, store),
      setProperty: (k, v) => { log.push('set ' + k); store[k] = String(v); },
      deleteProperty: k => { delete store[k]; } }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    Session: { getEffectiveUser: () => ({ getEmail: () => 'me@x.com' }) },
    Logger: { log: m => logs.push(m) },
    Utilities: { base64Encode: () => '' },
    GmailApp: {
      search: () => [], getMessagesForThreads: () => [],
      //  ⚠️ שרשור: reply שלו עונה למי ששלח את ההודעה האחרונה — אסור להשתמש בו
      getThreadById: id => ({ reply: () => { log.push('thread-reply'); } }),
      getMessageById: id => {
        log.push('get ' + id);
        if (opts.noMessage) throw new Error('nf');
        return { getFrom: () => opts.from || 'Client <client@shop.co.il>', getReplyTo: () => opts.replyTo || '',
                 reply: () => { log.push('reply'); if (opts.replyThrows) throw new Error('boom'); } };
      }
    },
    UrlFetchApp: { fetch: (url, o) => {
      const p = JSON.parse(o.payload); calls.push(p); log.push(p.op + (p.op === 'outbox-done' ? ':' + p.ok : ''));
      const r = opts.server(p);
      return { getResponseCode: () => r.code, getContentText: () => JSON.stringify(r.body) };
    } }
  };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  store.ENDPOINT = 'http://x'; store.TOKEN = 't';
  return { run: () => vm.runInContext('emRun()', sandbox), store, log, calls, logs };
}
const item = { key: 'k1', thread: 't1', messageId: 'm1', email: 'client@shop.co.il', text: 'hi', leaseToken: 'L' };
const claimOk = p => p.op === 'outbox-claim' ? { code: 200, body: { ok: true, items: [item] } } : { code: 200, body: { ok: true } };

// 1. mark before done
let w = world({ server: claimOk });
w.run();
check('mark before done', w.log, ['outbox-claim', 'get m1', 'set u_k1', 'reply', 'set s_k1', 'outbox-done:true']);
check('u_ cleared, s_ kept', [('u_k1' in w.store), ('s_k1' in w.store)], [false, true]);

// 2. lost ack: server lost done -> reissues; no second reply
let lost = true;
w = world({ server: p => (p.op === 'outbox-done' && lost) ? { code: 500, body: null } : claimOk(p) });
w.run(); lost = false; w.log.length = 0; w.run();
check('lost ack: no second reply', w.log, ['outbox-claim', 'outbox-done:true']);

// 3. reply throws -> done ok:false, no resend next run
w = world({ replyThrows: true, server: claimOk });
w.run();
check('reply throws -> done false', w.log, ['outbox-claim', 'get m1', 'set u_k1', 'reply', 'outbox-done:false']);
w.log.length = 0; w.run();
check('no resend after throw', w.log, ['outbox-claim', 'outbox-done:false']);

// 4. message lookup throws -> done false, nothing marked
w = world({ noMessage: true, server: claimOk });
w.run();
check('message missing -> done false', w.log, ['outbox-claim', 'get m1', 'outbox-done:false']);

// 4b. ⚠️ the reply goes to the customer's own message, never thread.reply
//     (the thread's last message may be our own notice or Ben's manual reply)
w = world({ server: claimOk });
w.run();
check('never thread.reply', w.log.includes('thread-reply'), false);

// 4c. Reply-To points elsewhere -> nothing sent, done false, nothing marked
w = world({ replyTo: 'Someone <other@else.com>', server: claimOk });
w.run();
check('reply-to elsewhere -> no send, done false', w.log, ['outbox-claim', 'get m1', 'outbox-done:false']);
check('reply-to elsewhere -> no marks', [('u_k1' in w.store), ('s_k1' in w.store)], [false, false]);

// 4d. From is a different address (e.g. our own) -> no send
w = world({ from: 'ordersluz@gmail.com', server: claimOk });
w.run();
check('from someone else -> no send', w.log, ['outbox-claim', 'get m1', 'outbox-done:false']);

// 4e. item without messageId from the server -> never sent
w = world({ server: p => p.op === 'outbox-claim' ? { code: 200, body: { ok: true, items: [{ ...item, messageId: '' }] } } : { code: 200, body: { ok: true } } });
w.run();
check('no messageId -> not sent', w.log.filter(x => /reply|get /.test(x)), []);

// 5. 401 on claim stops the step
w = world({ server: () => ({ code: 401, body: null }) });
w.run();
check('401 claim stops', w.log, ['outbox-claim']);

// 6. no message text in logs
const wl = world({ replyThrows: true, server: claimOk }); wl.run();
check('logs carry no text', wl.logs.length > 0 && wl.logs.some(l => /hi|boom/.test(l)), false);

if (fails) { console.log(fails + ' failed'); process.exit(1); }
console.log('all passed');
