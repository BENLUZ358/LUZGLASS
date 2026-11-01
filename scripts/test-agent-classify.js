#!/usr/bin/env node
/**
 * מרכזן — סיווג הודעה במודל (מצב שקט, fetcher מזויף).
 * Run:  node scripts/test-agent-classify.js
 */
const path = require('path');
const { AGENT_INTENTS, lgAgentClassify } = require(path.join(__dirname, '..', 'api', '_agent-classify.js'));
let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));

const UNCLEAR = { intent: 'unclear', ref: '' };
const strip = r => ({ intent: r.intent, ref: r.ref });
const okBody = txt => ({ status: 'completed', output: [{ content: [{ type: 'output_text', text: txt }] }], usage: { input_tokens: 10, output_tokens: 5 } });
const mk = (body, ok = true) => {
  const calls = [];
  const fetcher = async (url, opts) => { calls.push({ url, opts }); return { ok, json: async () => body }; };
  return { fetcher, calls };
};
const base = { text: 'מוכן?', hasImage: false, model: 'm1', key: 'k1' };

(async () => {
  check('intents', AGENT_INTENTS, ['order', 'status', 'cancel', 'change', 'document', 'quote', 'chitchat', 'thanks', 'unclear']);

  // בקשה
  const a = mk(okBody('{"intent":"status","ref":"כהן"}'));
  const r = await lgAgentClassify({ ...base, text: 'מוכן ההזמנה של כהן?', quotedText: 'ציטוט', fetcher: a.fetcher });
  check('תשובה תקינה', strip(r), { intent: 'status', ref: 'כהן' });
  check('usage מוחזר', r.usage, { input_tokens: 10, output_tokens: 5 });
  check('קריאה אחת', a.calls.length, 1);
  const req = a.calls[0];
  const body = JSON.parse(req.opts.body);
  check('url', req.url, 'https://api.openai.com/v1/responses');
  check('method', req.opts.method, 'POST');
  check('auth', req.opts.headers.Authorization, 'Bearer k1');
  check('store', body.store, false);
  check('model', body.model, 'm1');
  check('max_output_tokens', body.max_output_tokens, 300);
  check('format.type', body.text.format.type, 'json_schema');
  check('strict', body.text.format.strict, true);
  check('schema intent enum', body.text.format.schema.properties.intent.enum, AGENT_INTENTS);
  check('schema ref', body.text.format.schema.properties.ref.type, 'string');
  check('schema required', body.text.format.schema.required, ['intent', 'ref']);
  check('schema additionalProperties', body.text.format.schema.additionalProperties, false);
  check('instructions בעברית', /[א-ת]/.test(body.instructions), true);
  const sent = JSON.stringify(body.input);
  check('הטקסט נשלח', sent.includes('מוכן ההזמנה של כהן?'), true);
  check('הציטוט נשלח', sent.includes('ציטוט'), true);

  // כשלים — לא זורק
  const bad = async (name, m, extra) => {
    const x = await lgAgentClassify({ ...base, fetcher: m.fetcher, ...(extra || {}) });
    check(name, strip(x), UNCLEAR);
    check(name + ' usage', 'usage' in x, true);
  };
  await bad('intent לא ידוע', mk(okBody('{"intent":"hack","ref":""}')));
  await bad('JSON שבור', mk(okBody('{nope')));
  await bad('לא completed', mk({ ...okBody('{"intent":"status","ref":""}'), status: 'incomplete' }));
  await bad('refusal', mk({ status: 'completed', output: [{ content: [{ type: 'refusal', refusal: 'no' }] }] }));
  await bad('HTTP 500', mk({}, false));
  await bad('ref לא מחרוזת', mk(okBody('{"intent":"status","ref":5}')));
  await bad('fetcher זורק', { fetcher: async () => { throw new Error('boom'); } });

  // קיצורי דרך בלי קריאה
  const n1 = mk(okBody('{"intent":"status","ref":""}'));
  const img = await lgAgentClassify({ ...base, text: '', hasImage: true, fetcher: n1.fetcher });
  check('תמונה בלי טקסט → order', img.intent, 'order');
  check('תמונה בלי fetch', n1.calls.length, 0);
  const n2 = mk(okBody('{"intent":"status","ref":""}'));
  const nk = await lgAgentClassify({ ...base, key: '', fetcher: n2.fetcher });
  check('key ריק', strip(nk), UNCLEAR);
  check('key ריק בלי fetch', n2.calls.length, 0);
  const n3 = mk(okBody('{"intent":"status","ref":""}'));
  const nt = await lgAgentClassify({ ...base, text: '   ', hasImage: false, fetcher: n3.fetcher });
  check('טקסט ריק', strip(nt), UNCLEAR);
  check('טקסט ריק בלי fetch', n3.calls.length, 0);

  if (failed) { console.error(`\n${failed} failed`); process.exit(1); }
  console.log('\nall ok');
})();
