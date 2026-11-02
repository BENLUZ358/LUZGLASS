#!/usr/bin/env node
/**
 * הכלי במחשב במשרד מדפיס מדבקות (tools/invoice-watcher/watcher.js). בן, 3/11.
 *   A. TSPL: SIZE 70×70, GAP, CLS, BITMAP 70×560 עם 39200 בתים, PRINT לכל מדבקה.
 *   B. סבב: מושך עבודה → שולח למדפסת (TCP) → מדווח "הודפס".
 *   C. מדפסת לא עונה (חיבור נדחה) → מדווח retryable — השרת יחזיר לתור.
 *   D. אין עבודה → לא מתחברים למדפסת.
 * Run: node scripts/test-print-agent.js
 */
const net = require('net');
const path = require('path');
const W = require(path.join(__dirname, '..', 'tools', 'invoice-watcher', 'watcher.js'));

let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));

const BM = Buffer.alloc(39200, 0xFF); BM[0] = 0x00;
const B64 = BM.toString('base64');

(async () => {
  /* A */
  const t = W.tsplForBitmap(B64);
  const head = t.subarray(0, 120).toString('latin1');
  check('A1 label size', head.startsWith('SIZE 70 mm,70 mm\r\n'), true);
  check('A2 gap, clear, bitmap header', /GAP 3 mm,0 mm\r\n/.test(head) && /CLS\r\n/.test(head) && /BITMAP 0,0,70,560,0,/.test(head), true);
  const at = t.indexOf('BITMAP 0,0,70,560,0,') + 'BITMAP 0,0,70,560,0,'.length;
  check('A3 the 39200 raw bytes follow', t.subarray(at, at + 39200).equals(BM), true);
  check('A4 then print one', t.subarray(at + 39200).toString('latin1'), '\r\nPRINT 1,1\r\n');
  check('A5 a wrong-size bitmap is refused', (() => { try { W.tsplForBitmap(Buffer.alloc(10).toString('base64')); return 'no'; } catch (e) { return 'refused'; } })(), 'refused');

  /* B */
  const got = [];
  const srv = net.createServer(s => { const parts = []; s.on('data', d => parts.push(d)); s.on('end', () => got.push(Buffer.concat(parts))); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  const calls = [];
  const post = job => async body => { calls.push(body); return body.action === 'agent-claim' ? { status: 200, body: { ok: true, job } } : { status: 200, body: { ok: true } }; };
  const cfg = { labelPrinter: { host: '127.0.0.1', port } };
  await W.printOnce(cfg, post({ id: 'j1', printer: 'labels', bitmaps: [B64, B64] }));
  await new Promise(r => setTimeout(r, 100));
  check('B1 one connection with both labels', [got.length, got[0] && (got[0].toString('latin1').match(/PRINT 1,1/g) || []).length], [1, 2]);
  check('B2 reported printed', calls.map(c => [c.action, c.id, c.ok]), [['agent-claim', undefined, undefined], ['agent-done', 'j1', true]]);

  /* C */
  calls.length = 0;
  const closed = net.createServer(); await new Promise(r => closed.listen(0, '127.0.0.1', r));
  const deadPort = closed.address().port; await new Promise(r => closed.close(r));
  await W.printOnce({ labelPrinter: { host: '127.0.0.1', port: deadPort } }, post({ id: 'j2', printer: 'labels', bitmaps: [B64] }));
  const d = calls.find(c => c.action === 'agent-done');
  check('C1 printer not answering → retryable failure', [d.ok, d.retryable, /ECONNREFUSED/.test(d.error)], [false, true, true]);

  /* E — a printer that keeps the connection open after receiving everything: printed, not failed */
  calls.length = 0;
  const sticky = net.createServer(sk => { sk.on('data', () => {}); sk.on('end', () => {}); /* never closes */ });
  sticky.allowHalfOpen = true;
  await new Promise(r => sticky.listen(0, '127.0.0.1', r));
  const out = await W.sendLabels({ host: '127.0.0.1', port: sticky.address().port, timeoutMs: 300 }, [B64]);
  check('E1 all data sent, printer silent → printed', out.ok, true);
  sticky.close();

  /* F — a failed round stops; the loop does not hammer the next job at once */
  calls.length = 0;
  const more = await W.printOnce({ labelPrinter: { host: '127.0.0.1', port: deadPort } }, post({ id: 'j3', printer: 'labels', bitmaps: [B64] }));
  check('F1 a failed round reports not-ok (the loop waits)', more && more.ok, false);

  /* D */
  calls.length = 0; got.length = 0;
  await W.printOnce(cfg, post(null));
  await new Promise(r => setTimeout(r, 100));
  check('D1 nothing to print → no connection, no report', [got.length, calls.length], [0, 1]);

  srv.close();
  if (failed) { console.error('\n' + failed + ' failed'); process.exit(1); }
  console.log('\nall passed');
})().catch(e => { console.error(e); process.exit(1); });
