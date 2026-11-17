#!/usr/bin/env node
/**
 * מרכז הדפסות — עבודות הדפסה (בן, 3/11). api/_print-jobs.js
 *
 *   A. אדמין יוצר עבודת מדבקות → בתור, ברשימה; מעל 70 מדבקות / ריקה / לא אדמין → נדחה.
 *   B. הכלי במחשב (טוקן) מושך את הוותיקה בתור, עם התמונות; בזמן הנעילה — לא שוב.
 *   C. הודפס → printed, התמונות נמחקות. מדפסת כבויה → חוזר לתור, אחרי 3 → failed.
 *   D. נתקע ב"printing" אחרי הנעילה → unknown, ולעולם לא מודפס שוב לבד.
 *   E. כל משיכה מעדכנת "המחשב במשרד מחובר". טוקן שגוי → 401.
 *   F. עבודות מעל 90 יום נמחקות כשנוצרת עבודה חדשה.
 *
 * Run: node scripts/test-print-jobs.js
 */
const path = require('path');
const { fakeDb } = require(path.join(__dirname, '_fake-db.js'));
const P = require(path.join(__dirname, '..', 'api', '_print-jobs.js'));

let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));

const TOKEN = 'x'.repeat(40);
const env = { INVOICE_UPLOAD_TOKEN: TOKEN };
const admin = async () => ({ ok: true, role: 'admin', phone: '0547725552' });
const client = async () => ({ ok: true, role: 'client', phone: '0501111111' });
const L = n => Array.from({ length: n }, (_, i) => ({ title: 'המקום לאמבט', dims: '500 × ' + (2000 + i), sketchName: 'אסף', orderNum: 'L1200' }));
const BM = Buffer.alloc(39200, 0xFF).toString('base64');
const B = n => Array.from({ length: n }, () => BM);

(async () => {
  const db = fakeDb({ users: { '0547725552': { name: 'בן לוז' } } });
  let now = 1000000;
  const call = (body, verify, auth) => P.handlePrint({ method: 'POST', body, headers: auth ? { authorization: auth } : {} },
                                                    { db, now, env, verify: verify || admin });
  const tool = body => call(body, admin, 'Bearer ' + TOKEN);

  /* A */
  const c1 = await call({ action: 'create', kind: 'labels', printer: 'labels', client: 'המקום לאמבט', orderIds: ['o1'], labels: L(3), bitmaps: B(3) });
  check('A1 created', [c1.status, c1.body.ok, typeof c1.body.id], [200, true, 'string']);
  const l1 = await call({ action: 'list' });
  check('A2 in the list, queued, count 3', l1.body.items.map(x => [x.state, x.count, x.client, x.createdBy]), [['queued', 3, 'המקום לאמבט', 'בן לוז']]);
  check('A3 the list carries no bitmaps', JSON.stringify(l1.body).includes(BM.slice(0, 40)), false);
  check('A3b a bitmap of the wrong size is refused', (await call({ action: 'create', kind: 'labels', printer: 'labels', client: 'x', orderIds: [], labels: L(1), bitmaps: ['AAAA'] })).status, 400);
  check('A4 more than 70 labels refused', (await call({ action: 'create', kind: 'labels', printer: 'labels', client: 'x', orderIds: [], labels: L(71), bitmaps: B(71) })).status, 400);
  check('A5 empty refused', (await call({ action: 'create', kind: 'labels', printer: 'labels', client: 'x', orderIds: [], labels: [], bitmaps: [] })).status, 400);
  check('A6 labels and bitmaps must match', (await call({ action: 'create', kind: 'labels', printer: 'labels', client: 'x', orderIds: [], labels: L(2), bitmaps: B(1) })).status, 400);
  check('A7 a customer cannot create', (await call({ action: 'create', kind: 'labels', printer: 'labels', client: 'x', orderIds: [], labels: L(1), bitmaps: B(1) }, client)).status, 403);
  const g = await call({ action: 'get', id: c1.body.id });
  check('A8 get returns the label text', g.body.job.labels.length, 3);
  {   //  מדבקת לוח i/N (בן, 17/11) — השדות נשמרים; כמות לא חוקית → 0
    const mk = await call({ action: 'create', kind: 'labels', printer: 'labels', client: 'אופטי-ווי', orderIds: [],
      labels: [{ marker: 'לוח 1/4', mat: '10S · 10 שקוף', pieces: 7, job: 'M00337' }, { marker: 'לוח 2/4', pieces: -3 }, { marker: 'x', pieces: 'x' }], bitmaps: B(3) });
    const gm = await call({ action: 'get', id: mk.body.id });
    const lb = gm.body.job.labels;
    await db.ref('waMeta/printQueue/' + mk.body.id).set(null);   // לא להפריע לבדיקות התור שאחרי
    check('A9 marker label fields kept', [lb[0].marker, lb[0].mat, lb[0].pieces, lb[0].job], ['לוח 1/4', '10S · 10 שקוף', 7, 'M00337']);
    check('A10 bad piece count → 0', [lb[1].pieces, lb[2].pieces], [0, 0]);
  }

  /* E */
  check('E1 wrong token → 401', (await call({ action: 'agent-claim' }, admin, 'Bearer nope')).status, 401);
  check('E2 no token → 401', (await call({ action: 'agent-claim' }, admin)).status, 401);

  /* B */
  now += 1000;
  const c2 = await call({ action: 'create', kind: 'labels', printer: 'labels', client: 'נאור', orderIds: ['o2'], labels: L(1), bitmaps: B(1) });
  now += 1000;
  const k1 = await tool({ action: 'agent-claim' });
  check('B1 the oldest job first, with its bitmaps', [k1.body.job.id, k1.body.job.bitmaps.length], [c1.body.id, 3]);
  check('B2 it is now printing', db._data.waMeta.printJobs[c1.body.id].state, 'printing');
  check('E3 the office PC is seen', db._data.waMeta.printAgent.lastSeenAt, now);
  const k2 = await tool({ action: 'agent-claim' });
  check('B3 next claim takes the next job, not the leased one', k2.body.job && k2.body.job.id, c2.body.id);
  const k3 = await tool({ action: 'agent-claim' });
  check('B4 nothing left', k3.body.job, null);

  /* C */
  await tool({ action: 'agent-done', id: c1.body.id, ok: true });
  check('C1 printed', db._data.waMeta.printJobs[c1.body.id].state, 'printed');
  check('C2 bitmaps deleted', (db._data.waMeta.printJobBlobs || {})[c1.body.id], undefined);
  await tool({ action: 'agent-done', id: c2.body.id, ok: false, retryable: true, error: 'ECONNREFUSED' });
  check('C3 printer off → back to the queue', db._data.waMeta.printJobs[c2.body.id].state, 'queued');
  check('C3b and it waits before the next try (printer off)', (await tool({ action: 'agent-claim' })).body.job, null);
  for (let i = 0; i < 2; i++) {
    now += 10 * 60000;
    const k = await tool({ action: 'agent-claim' });
    await tool({ action: 'agent-done', id: k.body.job.id, ok: false, retryable: true, error: 'ECONNREFUSED' });
  }
  check('C4b only active jobs are listed for the office PC', Object.keys(db._data.waMeta.printQueue || {}).includes(c2.body.id), false);
  check('C4 after 3 attempts → failed', db._data.waMeta.printJobs[c2.body.id].state, 'failed');
  check('C5 with the reason', db._data.waMeta.printJobs[c2.body.id].error, 'ECONNREFUSED');
  check('C6 a done for an unknown job is refused', (await tool({ action: 'agent-done', id: 'nope', ok: true })).status, 404);

  /* D */
  const c3 = await call({ action: 'create', kind: 'labels', printer: 'labels', client: 'x', orderIds: [], labels: L(1), bitmaps: B(1) });
  await tool({ action: 'agent-claim' });
  now += 3 * 60000;
  const k4 = await tool({ action: 'agent-claim' });
  check('D1 a stuck print is not taken again', k4.body.job, null);
  check('D2 it is marked unknown', db._data.waMeta.printJobs[c3.body.id].state, 'unknown');
  check('D2b its images are dropped (a reprint draws again)', (db._data.waMeta.printJobBlobs || {})[c3.body.id], undefined);
  await tool({ action: 'agent-done', id: c3.body.id, ok: true });
  check('D3 a late "done" after unknown still records printed', db._data.waMeta.printJobs[c3.body.id].state, 'printed');

  /* G — עמודי לוחות למדפסת הרגילה (בן, 17/11) */
  const JPG = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 1, 2, 3, 0xFF, 0xD9]).toString('base64');
  const g1 = await call({ action: 'create', kind: 'sheets', printer: 'a4', client: 'אופטי-ווי M00322', orderIds: [], pages: [JPG, JPG] });
  check('G1 a sheets job with 2 pages is queued', [g1.status, db._data.waMeta.printJobs[g1.body.id].count, db._data.waMeta.printJobs[g1.body.id].kind], [200, 2, 'sheets']);
  check('G2 no pages / not a picture / labels to a4 → refused', [
    (await call({ action: 'create', kind: 'sheets', printer: 'a4', client: 'x', pages: [] })).status,
    (await call({ action: 'create', kind: 'sheets', printer: 'a4', client: 'x', pages: ['AAAA'] })).status,
    (await call({ action: 'create', kind: 'sheets', printer: 'labels', client: 'x', pages: [JPG] })).status,
    (await call({ action: 'create', kind: 'labels', printer: 'a4', client: 'x', labels: L(1), bitmaps: B(1) })).status], [400, 400, 400, 400]);
  check('G3 more than 12 pages refused', (await call({ action: 'create', kind: 'sheets', printer: 'a4', client: 'x', pages: Array(13).fill(JPG) })).status, 400);
  const gk = await tool({ action: 'agent-claim' });
  check('G4 the office PC gets it with printer a4 and the pages', gk.body.job && [gk.body.job.id, gk.body.job.printer, gk.body.job.bitmaps.length], [g1.body.id, 'a4', 2]);
  await tool({ action: 'agent-done', id: g1.body.id, ok: true });
  check('G5 printed, pages dropped', [db._data.waMeta.printJobs[g1.body.id].state, (db._data.waMeta.printJobBlobs || {})[g1.body.id]], ['printed', undefined]);

  /* F */
  now += 91 * 24 * 3600 * 1000;
  await call({ action: 'create', kind: 'labels', printer: 'labels', client: 'new', orderIds: [], labels: L(1), bitmaps: B(1) });
  check('F1 jobs older than 90 days are gone', Object.values(db._data.waMeta.printJobs).map(j => j.client), ['new']);

  if (failed) { console.error('\n' + failed + ' failed'); process.exit(1); }
  console.log('\nall passed');
})().catch(e => { console.error(e); process.exit(1); });
