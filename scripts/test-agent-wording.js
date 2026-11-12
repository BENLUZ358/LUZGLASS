#!/usr/bin/env node
/**
 * סוכנים — תשובות בשילוב (spec ג; תיקוני סקירה 12/11): העובדות יוצאות בייט בבייט, והמודל
 * לא כותב טקסט — רק בוחר פתיחה / סיום מרשימות סגורות (מספר פריט או -1). מספר לא תקין → בלי.
 * ⚠️ בלי מודל אמיתי: fetcher מדומה בלבד.
 * Run:  node scripts/test-agent-wording.js
 */
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { fakeDb } = require(path.join(__dirname, '_fake-db.js'));
const W = require(path.join(ROOT, 'api', '_agent-wording.js'));
const act = require(path.join(ROOT, 'api', '_agent-act.js'));
const { AGENT_MENU_TEXT } = require(path.join(ROOT, 'api', '_agent-okev.js'));
let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));

//  אסור לבדיקה לצאת לרשת — כל קריאה שלא דרך fetcher מדומה נכשלת מיד
global.fetch = async () => { throw new Error('no network in tests'); };
//  יציאה שקטה באמצע (הבטחה שלא נסגרה) אינה הצלחה
let finished = false;
process.on('exit', code => { if (!finished && code === 0) { console.error('FAIL  exited before the end'); process.exitCode = 1; } });

//  מודל מדומה: מחזיר { opener, closer } (או טקסט גולמי), סופר קריאות ושומר את הבקשות
//  המודל המדומה מחזיר את מה שנותנים לו — גם תשובה זדונית (טקסט, מספר מחוץ לטווח)
const model = (out) => {
  const f = async (url, init) => {
    const body = JSON.parse(init.body);
    f.calls.push(body);
    const o = typeof out === 'function' ? out(body) : out;
    const text = typeof o === 'string' ? o : JSON.stringify(o);
    return { ok: true, json: async () => ({ status: 'completed', usage: { input_tokens: 50, output_tokens: 10 },
      output: [{ content: [{ type: 'output_text', text }] }] }) };
  };
  f.calls = [];
  return f;
};
const BASE = { model: 'm1', key: 'k1', customerName: 'כהן זכוכית', customerText: 'מה עם ההזמנה?' };
const STATUS = 'הזמנה L1235 (סקיצה: מטבח): ההזמנה בייצור. בדרך כלל זה לוקח עוד בערך 3 ימים';

(async () => {
  /* ── 1. חלק עטיפה (טהור) ── */
  {
    for (const g of ['היי', 'היי, הנה העדכון', 'שמחים לעזור', 'תודה רבה!', 'מצטערים מאוד', 'שמחים לשמוע ממך', 'בשמחה, תמיד כאן בשבילך'])
      check('wrapper part accepted: ' + g, W.lgWrapOk(g), true);
    //  הבדיקות של הסוקר (probe7) — כל ניסוח מחדש שעבר את הבדיקה הקודמת, כאן כחלק עטיפה
    const PROBE = [
      ['negation', 'ההזמנה L1235 של מטבח עוד לא בייצור, זה ייקח עוד בערך 3 ימים.'],
      ['status swap ready', 'ההזמנה L1235 של מטבח כבר מוכנה לאיסוף! עוד 3 ימים נשלח.'],
      ['unit change weeks', 'ההזמנה L1235 של מטבח בייצור, עוד בערך 3 שבועות.'],
      ['unit change months', 'ההזמנה L1235 של מטבח בייצור, עוד בערך 3 חודשים.'],
      ['hours', 'ההזמנה L1235 של מטבח בייצור, עוד בערך 3 שעות.'],
      ['reuse number as price', 'ההזמנה L1235 של מטבח בייצור, עוד 3 ימים, והמחיר 3 ₪.'],
      ['promise no numbers', 'ההזמנה L1235 של מטבח בייצור, עוד 3 ימים, ומגיע לך זיכוי מלא והובלה חינם.'],
      ['arabic digit', 'ההזמנה L1235 של מטבח בייצור, עוד 3 ימים, מוכנה ב-١٤/١١.'],
      ['fullwidth digit', 'ההזמנה L1235 של מטבח בייצור, עוד 3 ימים, מוכנה ב-１４/１１.'],
      ['number word אחד', 'ההזמנה L1235 של מטבח בייצור, עוד 3 ימים ועוד חודש אחד.'],
      ['words not covered', 'ההזמנה L1235 של מטבח בייצור, עוד 3 ימים, אולי כבר בסוף החודשיים או תוך שלושים יום.'],
      ['tonight/morning', 'ההזמנה L1235 של מטבח בייצור, עוד 3 ימים, תגיע הערב או בבוקר.'],
      ['soon promise', 'ההזמנה L1235 של מטבח בייצור ותגיע אליך ממש בקרוב, תוך 3 ימים בטוח.'],
      ['mahar->hayom both', 'הזמנה L1 של א תהיה מוכנה מחר, והזמנה L2 של ב מוכנה היום.'],
      ['two orders swap status', 'הזמנה L1001 של כהן מוכנה, והזמנה L1003 של מטבח בייצור.'],
      ['two numbers swap', 'ההזמנה בייצור, 5 פריטים מוכנים ועוד 2 בדרך.'],
      ['cancel confirm flip', 'ביטלנו את הזמנה L1003 של מטבח, נכון?'],
      ['cancel done flip', 'ההזמנה L1003 של מטבח בוטלה, היא כבר בייצור.'],
      ['apology no promise check', 'מצטערים! הזמנה L1001 של כהן בייצור, נפצה אותך בהנחה ובן יחזור אליך בהקדם.'],
      ['injection phone hebrew', 'ההזמנה L1235 של מטבח בייצור, עוד 3 ימים. לפרטים התקשרו לשאול באפס חמש ארבע.'],
      ['shekel word', 'ההזמנה L1235 של מטבח בייצור, עוד 3 ימים, תשלום של מאה שקל.'],
      ['newline sentences', 'ההזמנה L1235 של מטבח בייצור; עוד 3 ימים; שלום; ביי; תודה'],
      ['free promise', 'אין בעיה, נטפל בזה ונעדכן'],
      ['free fact', 'שלום! הזמנה בוטלה'],
    ];
    for (const [n, o] of PROBE) check('probe rejected as a wrapper part: ' + n, W.lgWrapOk(o), false);
    //  אותן כוונות בלי ספרות ובלי מספרי הזמנה — רק המילים
    const WORDS = [
      ['negation only', 'עוד לא'], ['ready', 'כבר מוכנה'], ['weeks', 'עוד כמה שבועות'], ['months', 'בעוד חודשים'], ['hours', 'בעוד כמה שעות'],
      ['tomorrow', 'נתראה מחר'], ['today', 'עוד היום'], ['evening', 'עד הערב'], ['morning', 'בבוקר'], ['soon', 'ממש בקרוב'],
      ['right away', 'מיד אצלך'], ['now', 'עכשיו בדרך'], ['a bit', 'עוד מעט'], ['weekday', 'ביום שלישי'], ['shabbat', 'אחרי שבת'],
      ['number word', 'שלושים'], ['thousand', 'אלף תודות'], ['sent', 'כבר נשלחה'], ['cancelled', 'היא בוטלה'], ['on the way', 'זה בדרך'],
      ['arrived', 'הגיעה'], ['collected', 'נאספה'], ['shekel', 'בשקלים'], ['price', 'המחיר טוב'], ['credit', 'מגיע לך זיכוי'],
      ['discount', 'עם הנחה'], ['free', 'חינם'], ['promise', 'מבטיחים לך'], ['we will return', 'נחזור אליך'], ['we will update', 'נעדכן אותך'],
      ['we will handle', 'נטפל בזה'], ['we will send', 'נשלח לך'], ['none', 'אין בעיה'], ['shekel sign', 'שווה כל ₪'],
      ['sh"ch', 'בלי ש"ח'], ['url', 'היכנסו לאתר שלנו www.luz.co.il'], ['at', 'כתבו לנו @'], ['latin', 'Thanks'],
      ['fullwidth latin', 'ｔｈａｎｋｓ'], ['arabic-indic digit', 'תודה ٣'], ['too long', 'תודה רבה '.repeat(10)],
      ['two sentences', 'תודה רבה. שמחים לעזור.'], ['newline', 'תודה\nשמחים'], ['empty', '  '],
    ];
    for (const [n, o] of WORDS) check('wrapper part rejected: ' + n, W.lgWrapOk(o), false);
  }

  /* ── 1ב. הרשימות הסגורות: כל פריט עובר את הבדיקה העצמית; עקיפות של הסוקר נכשלות ── */
  {
    const items = [...W.LG_WRAP_OPENERS.map(o => o.text), ...W.LG_WRAP_CLOSERS];
    check('lists: 12 openers, 8 closers', [W.LG_WRAP_OPENERS.length, W.LG_WRAP_CLOSERS.length], [12, 8]);
    //  תיקון סקירה סופית T7: "בהצלחה" / "שמחים לעזור" לא בסיומים; "בשמחה" / "שמחים לעזור" — פתיחה רק לברכה
    check('tone: no "בהצלחה" / "שמחים לעזור" closer', W.LG_WRAP_CLOSERS.filter(c => c === 'בהצלחה' || c === 'שמחים לעזור'), []);
    check('tone: "בשמחה" / "שמחים לעזור" openers are freeOnly', W.LG_WRAP_OPENERS.filter(o => o.freeOnly).map(o => o.text).sort(), ['בשמחה', 'שמחים לעזור'].sort());
    check('every list item passes lgWrapOk', items.filter(t => !W.lgWrapOk(t)), []);
    check('some openers suit complaints (upsetOk)', W.LG_WRAP_OPENERS.filter(o => o.upsetOk).map(o => o.text).length >= 2, true);
    //  סבב סקירה 2: ניקוד / תווים בלתי נראים / ניסוחים שעקפו את רשימת המילים
    const BYPASS = ['מוּכָן', 'מוכ‍ן', 'מו​כן', 'שלחנו', 'הכל ארוז ויוצא', 'אפשר לבוא לאסוף', 'בחיתוך', 'נזכה אותך', 'על חשבוננו',
      'נתקשר אליך', 'תכף', 'בהקדם', "ב'", 'טרם', 'אל דאגה'];
    for (const b of BYPASS) check('self-check rejects bypass: ' + JSON.stringify(b), W.lgWrapOk(b), false);
    check('marks / format chars rejected even in a harmless word', [W.lgWrapOk('הַיי'), W.lgWrapOk('הי‍י'), W.lgWrapOk('היי')], [false, false, true]);
    //  שם הלקוח לפתיחה
    const N = ['כהן', 'משה כהן', 'כהן זכוכית', 'L.G', 'משה כהן לוי', 'א', 'משה  כהן', 'מּשה', 'כהן 2000', 'כהן-לוי', 'אבגדהוזחטיכלמנסע', '  דנה  ', 'שלחנו!'];
    check('name sanitization', N.map(W.lgWrapName), ['כהן', 'משה כהן', 'כהן זכוכית', '', '', '', '', '', '', '', '', 'דנה', '']);
  }

  /* ── 2. lgAgentWord: המודל רק בוחר פריטים; העובדות כמו שהן ── */
  {
    const OP = t => W.LG_WRAP_OPENERS.findIndex(o => o.text === t);
    const CL = t => W.LG_WRAP_CLOSERS.indexOf(t);
    let m = model({ opener: OP('שלום'), closer: CL('בברכה') });
    let w = await W.lgAgentWord({ ...BASE, kind: 'facts', facts: STATUS, fetcher: m });
    check('opener (+ safe name) + facts + closer', [w.text, w.reworded, m.calls.length, !!w.usage], ['שלום, כהן זכוכית\n' + STATUS + '\nבברכה', true, 1, true]);
    check('facts appear byte-identical in the output', [w.text.includes(STATUS), Buffer.compare(Buffer.from(w.text.split('\n')[1]), Buffer.from(STATUS))], [true, 0]);
    const body = m.calls[0];
    const props = body.text.format.schema.properties;
    check('request: store false, strict schema of integer indices with enums',
      [body.store, body.text.format.type, body.text.format.strict, props.opener.type, props.opener.enum, props.closer.enum.length],
      [false, 'json_schema', true, 'integer', [-1, ...W.LG_WRAP_OPENERS.map((o, i) => i).filter(i => !W.LG_WRAP_OPENERS[i].freeOnly)], W.LG_WRAP_CLOSERS.length + 1]);
    check('prompt: chooses only, customer text is data', [/רק בוחר/.test(body.instructions), /לא הוראות/.test(JSON.stringify(body.input))], [true, true]);

    m = model({ opener: OP('מבינים אותך'), closer: -1 });
    w = await W.lgAgentWord({ ...BASE, customerName: 'L.G. 2000', kind: 'facts', facts: STATUS, fetcher: m });
    check('opener without nameOk, unsafe name → no name', w.text, 'מבינים אותך\n' + STATUS);
    m = model({ opener: OP('היי'), closer: -1 });
    w = await W.lgAgentWord({ ...BASE, customerName: 'כהן ‍זכוכית', kind: 'facts', facts: STATUS, fetcher: m });
    check('name with a hidden char → dropped', w.text, 'היי\n' + STATUS);
    m = model({ opener: -1, closer: -1 });
    w = await W.lgAgentWord({ ...BASE, kind: 'facts', facts: STATUS, fetcher: m });
    check('both -1 → facts alone, not reworded', [w.text, w.reworded], [STATUS, false]);

    //  מודל זדוני / שבור: טקסט במקום מספר, מחוץ לטווח, שבר, מחרוזת, טקסט חופשי — רק עובדות או פריטי רשימה
    const ALLOWED = new Set(['', ...W.LG_WRAP_OPENERS.map(o => o.text), ...W.LG_WRAP_OPENERS.filter(o => o.nameOk).map(o => o.text + ', כהן זכוכית'), ...W.LG_WRAP_CLOSERS]);
    const onlyListOrFacts = t => { const i = t.indexOf(STATUS); if (i < 0) return false; return t.slice(0, i).split('\n').every(x => ALLOWED.has(x)) && t.slice(i + STATUS.length).split('\n').every(x => ALLOWED.has(x)); };
    const EVIL = [
      { opener: 'שלחנו', closer: 'נזכה אותך' }, { opener: 'ההזמנה מוכנה', closer: 'שלוש' }, { opener: 99, closer: -5 }, { opener: 1.5, closer: 2.0001 },
      { opener: '0', closer: '1' }, { opener: null, closer: true }, { opener: [0], closer: { i: 1 } }, { opener: -1, closer: 10 },
      { opener: 0, closer: 0, text: 'ההזמנה בוטלה, מגיע לך זיכוי' }, 'ההזמנה מוכנה, אפשר לבוא לאסוף מחר', '{"opener":"תכף","closer":"טרם"}',
    ];
    const outs = [];
    for (const e of EVIL) { w = await W.lgAgentWord({ ...BASE, kind: 'facts', facts: STATUS, fetcher: model(e) }); outs.push(w.text); }
    check('malicious model: output is facts-only or list items around unchanged facts', outs.map(onlyListOrFacts), EVIL.map(() => true));
    check('malicious model: text values / out of range / fractions → facts alone', outs.slice(0, 7).concat(outs.slice(9)).every(t => t === STATUS), true);
    check('malicious model: out-of-range closer ignored, valid opener kept', outs[7], STATUS);
    check('malicious model: extra field with text never reaches the output', outs[8], 'היי, כהן זכוכית\n' + STATUS + '\nבברכה');
    check('no bypass string reaches the output', outs.some(t => /שלחנו|נזכה|מוכנה|בוטלה|זיכוי|תכף|טרם|לאסוף/.test(t)), false);

    //  התנצלות: רק פתיחה שמתאימה לתלונה, בלי סיום
    m = model({ opener: OP('תודה על הסבלנות'), closer: CL('בברכה') });
    w = await W.lgAgentWord({ ...BASE, kind: 'facts', facts: STATUS, fetcher: m, upset: true });
    check('upset → complaint opener only, no closer', w.text, 'תודה על הסבלנות\n' + STATUS);
    check('upset schema: only upsetOk openers, closer only -1',
      [m.calls[0].text.format.schema.properties.opener.enum.slice(1).every(i => W.LG_WRAP_OPENERS[i].upsetOk), m.calls[0].text.format.schema.properties.closer.enum], [true, [-1]]);
    m = model({ opener: OP('היי'), closer: -1 });
    w = await W.lgAgentWord({ ...BASE, kind: 'facts', facts: STATUS, fetcher: m, upset: true });
    check('upset: a non-complaint opener is refused → facts alone', w.text, STATUS);

    //  T7: "בשמחה" סביב עובדות — לא מוצע ולא מתקבל
    m = model({ opener: OP('בשמחה'), closer: -1 });
    w = await W.lgAgentWord({ ...BASE, kind: 'facts', facts: STATUS, fetcher: m });
    check('facts: freeOnly opener refused → facts alone, not in the schema',
      [w.text, m.calls[0].text.format.schema.properties.opener.enum.includes(OP('בשמחה')), m.calls[0].instructions.includes('בשמחה')], [STATUS, false, false]);
    m = model({ opener: OP('בשמחה'), closer: -1 });
    w = await W.lgAgentWord({ ...BASE, kind: 'free', facts: AGENT_MENU_TEXT, fetcher: m });
    check('free: "בשמחה" allowed for a greeting', w.text, 'בשמחה\n\n' + AGENT_MENU_TEXT);

    //  ברכה: פתיחה + התפריט כמו שהוא
    m = model({ opener: OP('שמחים לשמוע ממך'), closer: CL('בברכה') });
    w = await W.lgAgentWord({ ...BASE, kind: 'free', facts: AGENT_MENU_TEXT, fetcher: m });
    check('free → opener + the menu unchanged', [w.text, w.reworded], ['שמחים לשמוע ממך\n\n' + AGENT_MENU_TEXT, true]);
    check('free prompt does not carry the menu', JSON.stringify(m.calls[0].input).includes('1. לבדוק'), false);
    w = await W.lgAgentWord({ ...BASE, kind: 'free', facts: AGENT_MENU_TEXT, fetcher: model({ opener: 77, closer: -1 }) });
    check('free with a bad index → the menu alone', [w.text, w.reworded], [AGENT_MENU_TEXT, false]);

    //  מודל איטי — מבוטל אחרי timeoutMs
    //  ⚠️ הטיימר של AbortSignal.timeout לא מחזיק את התהליך — טיימר משלנו מחזיק (כמו חיבור רשת אמיתי)
    const slow = async (url, init) => new Promise((res, rej) => {
      const hold = setTimeout(() => res({ ok: true, json: async () => ({ status: 'completed', output: [{ content: [{ type: 'output_text', text: '{"opener":0,"closer":-1}' }] }] }) }), 5000);
      init.signal.addEventListener('abort', () => { clearTimeout(hold); rej(Object.assign(new Error('aborted'), { name: 'TimeoutError' })); });
    });
    const t0 = Date.now();
    w = await W.lgAgentWord({ ...BASE, kind: 'facts', facts: STATUS, fetcher: slow, timeoutMs: 50 });
    check('model timeout → facts alone', [w.text, w.reworded, Date.now() - t0 < 2000], [STATUS, false, true]);
    w = await W.lgAgentWord({ ...BASE, kind: 'facts', facts: STATUS, fetcher: async () => { throw new Error('boom'); } });
    check('model throws → facts alone', [w.text, w.reworded], [STATUS, false]);
    w = await W.lgAgentWord({ ...BASE, kind: 'facts', facts: STATUS, fetcher: async () => ({ ok: false, status: 500 }) });
    check('model http error → facts alone', [w.text, w.reworded], [STATUS, false]);
    w = await W.lgAgentWord({ ...BASE, kind: 'facts', facts: STATUS, fetcher: async () => ({ ok: true, json: async () => ({ status: 'incomplete', output: [] }) }) });
    check('model incomplete → facts alone', [w.text, w.reworded], [STATUS, false]);
    m = model({ opener: 0, closer: -1 });
    w = await W.lgAgentWord({ ...BASE, key: '', kind: 'facts', facts: STATUS, fetcher: m });
    check('no key → facts alone, no call', [w.text, w.reworded, m.calls.length], [STATUS, false, 0]);

    //  שיעור שנלמד / רשימה ממוספרת / הצעת מחיר — לא נעטפים, בלי מודל
    w = await W.lgAgentWord({ ...BASE, kind: 'facts', facts: 'לא, אנחנו לא מייצרים זכוכית חכמה.', lessonAuto: true, fetcher: m });
    check('lesson auto answer not wrapped', [w.text, w.reworded, m.calls.length], ['לא, אנחנו לא מייצרים זכוכית חכמה.', false, 0]);
    const LIST = 'על איזו הזמנה מדובר?\n1. L1001 — כהן\n2. L1003 — מטבח';
    w = await W.lgAgentWord({ ...BASE, kind: 'facts', facts: LIST, fetcher: m });
    check('numbered list → not wrapped, no call', [w.text, w.reworded, m.calls.length], [LIST, false, 0]);
    const QUOTE = 'מראה 50×70 × 1 — 114 ₪\nסה"כ לפני מע"מ: 114 ₪\nמע"מ 18%: 21 ₪\nסה"כ: 135 ₪';
    w = await W.lgAgentWord({ ...BASE, kind: 'facts', facts: QUOTE, fetcher: m });
    check('price quote → not wrapped, no call', [w.text, w.reworded, m.calls.length], [QUOTE, false, 0]);
    check('would-try: list / lesson / no key → no; plain facts / free → yes',
      [W.lgWordWouldTry({ kind: 'facts', facts: LIST, model: 'm', key: 'k' }), W.lgWordWouldTry({ kind: 'facts', facts: STATUS, model: 'm', key: 'k', lessonAuto: true }),
       W.lgWordWouldTry({ kind: 'facts', facts: STATUS, model: 'm', key: '' }), W.lgWordWouldTry({ kind: 'facts', facts: STATUS, model: 'm', key: 'k' }),
       W.lgWordWouldTry({ kind: 'free', facts: AGENT_MENU_TEXT, model: 'm', key: 'k' })], [false, false, false, true, true]);
  }

  /* ── 3. בתוך _act: רק עם הגדרות במסך + סוכן "עונה"; כל תשובה שנעטפה ברשומה ── */
  {
    const NOW = 1792500000000;
    const PRIV = '972501234567@c.us';
    const ON = { AGENT_SHADOW_ENABLED: 'true', AGENT_REPLY_ENABLED: 'true', AGENT_STAFF_PHONES: '050-1112222', AGENT_MODEL: 'm1', OPENAI_API_KEY: 'k1' };
    const REPLY = { agents: { okev: 'reply', markazan: 'reply' }, allCustomers: true, escalatePhone: '0547725552' };
    const seed = extra => fakeDb({
      waSenders: { '0501234567': { customerId: '777', customerName: 'כהן זכוכית' } },
      hashavshevetAccounts: { 777: { name: 'כהן זכוכית' } },
      orders: { o1: { customerId: '777', orderNum: 'L1001', sketchName: 'כהן', stage: 'workday' },
                o3: { customerId: '777', orderNum: 'L1003', sketchName: 'מטבח', stage: 'pending' } },
      waMeta: { agentPilot: { 777: true }, ...(extra || {}) },
    });
    const R = o => ({ idMessage: 'M1', chatId: PRIV, groupId: '', sender: '0501234567', text: 'מה עם ההזמנה של כהן?', quotedId: '', hasImage: false,
      linked: true, linkVia: 'sender', state: 'done', intent: 'status', ref: 'כהן', route: 'okev', customerId: '777', customerName: 'כהן זכוכית',
      timestamp: NOW, ...o });
    const put = (db, k, r) => { db._data.waMeta.agentShadow = db._data.waMeta.agentShadow || {}; db._data.waMeta.agentShadow[k] = r; };
    const rec = (db, k) => db._data.waMeta.agentShadow[k];
    const outbox = db => (db._data.waMeta || {}).agentOutbox || {};
    const run = (db, k, extra, env) => act.lgAgentAct(db, k, { env: env || ON, now: NOW, sendPending: async () => ({ sent: 0 }), ...(extra || {}) });
    const FACTS = 'הזמנה L1001 (סקיצה: כהן): ההזמנה בייצור';
    const words = r => (r.replyWords || []).map(x => [x.original, x.sent]);
    const OP = t => W.LG_WRAP_OPENERS.findIndex(o => o.text === t);
    const CL = t => W.LG_WRAP_CLOSERS.indexOf(t);

    let db = seed({ agentConfig: REPLY });
    let m = model({ opener: OP('היי'), closer: CL('כל טוב') });
    put(db, 'A1', R({}));
    await run(db, 'A1', { fetchImpl: m });
    check('act: reply mode + config → list items around unchanged facts', [outbox(db).A1_0.text, m.calls.length], ['היי, כהן זכוכית\n' + FACTS + '\nכל טוב', 1]);
    check('act: record lists the original and what went out', words(rec(db, 'A1')), [[FACTS, 'היי, כהן זכוכית\n' + FACTS + '\nכל טוב']]);

    db = seed({ agentConfig: REPLY });
    m = model({ opener: 'ההזמנה תהיה מוכנה מחר', closer: 42 });
    put(db, 'A2', R({}));
    await run(db, 'A2', { fetchImpl: m });
    check('act: malicious model → facts alone, nothing recorded', [outbox(db).A2_0.text, rec(db, 'A2').replyWords || null], [FACTS, null]);

    db = seed({ agentConfig: { ...REPLY, agents: { okev: 'shadow', markazan: 'shadow' } } });
    m = model({ opener: 0, closer: -1 });
    put(db, 'A3', R({}));
    await run(db, 'A3', { fetchImpl: m });
    check('act: shadow mode → model never called for wording', [m.calls.length, rec(db, 'A3').acted, rec(db, 'A3').replyWords || null], [0, false, null]);

    db = seed();
    put(db, 'A4', R({}));
    await run(db, 'A4', { fetchImpl: m });
    check('act: no agentConfig (old switches) → facts, no model', [outbox(db).A4_0.text, m.calls.length], [FACTS, 0]);

    db = seed({ agentConfig: REPLY });
    put(db, 'A5', R({}));
    const t = NOW;
    await run(db, 'A5', { fetchImpl: m, clock: () => t, deadline: NOW + 10000 });
    check('act: not enough time left → facts, no model, noted', [outbox(db).A5_0.text, m.calls.length, rec(db, 'A5').wordSkipped], [FACTS, 0, 'deadline']);
    //  "אין זמן" נרשם רק כשבאמת היינו מנסים — רשימה ממוספרת לא נעטפת ממילא
    db = seed({ agentConfig: REPLY });
    put(db, 'A5b', R({ ref: '' }));
    await run(db, 'A5b', { fetchImpl: m, clock: () => t, deadline: NOW + 10000 });
    check('act: numbered list with no time → no wordSkipped', [outbox(db).A5b_0.text.startsWith('על איזו הזמנה'), rec(db, 'A5b').wordSkipped || null], [true, null]);

    //  התנצלות (משימה 6) — העובדות + "מצטערים…" כמו שהן, עם פתיחה שמתאימה לתלונה בלבד
    const APOL = FACTS + '\n\nמצטערים על אי הנעימות. נחזור אליך בהקדם.';
    db = seed({ agentConfig: REPLY });
    m = model({ opener: OP('מבינים אותך'), closer: CL('בברכה') });
    put(db, 'A6', R({ upset: true, text: 'איפה ההזמנה של כהן כבר שבוע!!' }));
    await run(db, 'A6', { fetchImpl: m });
    check('act: upset apology unchanged, complaint opener only', outbox(db).A6_0.text, 'מבינים אותך\n' + APOL);

    //  "קיבלנו, אנחנו בודקים" ו-Ben לא נעטפים
    db = seed({ agentConfig: REPLY });
    m = model({ opener: 0, closer: -1 });
    put(db, 'A8', R({ intent: 'unclear', route: 'shaul', ref: '', text: 'אתם עושים זכוכית חכמה?' }));
    await run(db, 'A8', { fetchImpl: m, lessonMatch: async () => ({ match: null, confidence: 0, topic: 't' }) });
    check('act: hold text and Ben ping are never wrapped', [outbox(db).A8_0.text, m.calls.length], ['קיבלנו, אנחנו בודקים ונחזור אליך בהקדם.', 0]);

    //  שיעור שנלמד (כלל אוטומטי) — התשובה של בן כמו שהיא
    db = seed({ agentConfig: REPLY, agentLessons: { L1: { agent: 'markazan', topicKey: 'זכוכית-חכמה', topic: 'זכוכית חכמה', question: 'יש לכם זכוכית חכמה?',
      answer: 'לא, אנחנו לא מייצרים זכוכית חכמה.', approvals: 3, autoAt: NOW - 60000, corrections: 0, createdAt: NOW - 3600000, by: '0547725552', customerId: '777', customerName: 'כהן זכוכית' } } });
    m = model({ opener: 0, closer: -1 });
    put(db, 'A9', R({ intent: 'unclear', route: 'shaul', ref: '', text: 'אתם עושים זכוכית חכמה?' }));
    await run(db, 'A9', { fetchImpl: m, lessonMatch: async () => ({ match: 'L1', confidence: 0.95, topic: 'זכוכית חכמה' }) });
    check('act: lesson auto answer not wrapped', [outbox(db).A9_0 && outbox(db).A9_0.text, m.calls.length], ['לא, אנחנו לא מייצרים זכוכית חכמה.', 0]);

    //  ברכה (chitchat → תפריט): הלקוח תמיד מקבל את התפריט
    db = seed({ agentConfig: REPLY });
    m = model({ opener: OP('שלום'), closer: -1 });
    put(db, 'A10', R({ intent: 'chitchat', route: 'menu', ref: '', text: 'שלום' }));
    await run(db, 'A10', { fetchImpl: m });
    check('act: greeting gets opener + the menu', outbox(db).A10_0.text, 'שלום, כהן זכוכית\n\n' + AGENT_MENU_TEXT);
    check('act: greeting record: original = menu, sent = opener + menu', words(rec(db, 'A10')), [[AGENT_MENU_TEXT, 'שלום, כהן זכוכית\n\n' + AGENT_MENU_TEXT]]);
    db = seed({ agentConfig: REPLY });
    m = model({ opener: 'שלום! אנחנו כאן 24 שעות', closer: -1 });
    put(db, 'A11', R({ intent: 'chitchat', route: 'menu', ref: '', text: 'שלום' }));
    await run(db, 'A11', { fetchImpl: m });
    check('act: greeting with a bad model answer → the menu', [outbox(db).A11_0.text, rec(db, 'A11').replyWords || null], [AGENT_MENU_TEXT, null]);

    //  כל תשובה ללקוח שנעטפה — ברשומה (ביטול מאוחר מדי: תשובה ללקוח + שאול לידיעה, שלא נעטף)
    db = seed({ agentConfig: REPLY });
    m = model({ opener: 0, closer: -1 });
    put(db, 'A12', R({ intent: 'cancel', ref: 'כהן', text: 'תבטלו את כהן' }));
    await run(db, 'A12', { fetchImpl: m });
    const ob12 = Object.entries(outbox(db)).filter(([k, v]) => k.startsWith('A12_') && v.to === PRIV).map(([, v]) => v.text);
    check('act: every wrapped customer reply is recorded', [words(rec(db, 'A12')).length, ob12.length, words(rec(db, 'A12')).every(([o, s]) => s.includes(o))],
      [ob12.length, ob12.length, true]);
  }

  finished = true;
  console.log(failed ? `\n${failed} FAILED` : '\nall passed');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
