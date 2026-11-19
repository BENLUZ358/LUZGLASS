#!/usr/bin/env node
/** ברקוד לכל זכוכית — השרת (בן 17/11). Run: node scripts/test-glass-qr.js */
const path = require('path');
const { fakeDb } = require(path.join(__dirname, '_fake-db.js'));
process.env.FIREBASE_SERVICE_ACCOUNT = JSON.stringify({ private_key: 'test-key' });
delete process.env.LG_QR_SECRET;
const G = require(path.join(__dirname, '..', 'api', '_glass-qr.js'));
const Q = require(path.join(__dirname, '..', 'lg-qr.js'));
let fail = 0;
const check = (n, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fail++;
  console.log((ok ? 'ok   ' : 'FAIL ') + n + (ok ? '' : '\n       got ' + JSON.stringify(got) + '\n      want ' + JSON.stringify(want))); };

const orders = {
  o1: { id: 'o1', orderNum: 'L1300', orderClient: 'אסף זכוכית', sketchName: 'מקלחון אסף', clientPhone: '0501112222',
        total: 999, totalFinal: 999, phone: '0501112222', notes: 'פנימי',
        items: [{ w: 700, h: 1900, name: '8 מ"מ שקוף', price: 5 }, { w: 400, h: 1900, name: '8 מ"מ שקוף' }],
        attachments: { 0: { kind: 'hardware', at: 1 } } },
  o2: { id: 'o2', orderNum: 'X1300', orderClient: 'אחר', sketchName: 'אחר', items: [{ w: 1, h: 1 }] },
  o4: { id: 'o4', orderNum: 'L1310', stage: 'done', orderClient: 'נהג', sketchName: 'נאסף', items: [{ w: 1, h: 1 }, { w: 2, h: 2 }] },
  o5: { id: 'o5', orderNum: 'L1311', stage: 'chisum', orderClient: 'מוקדם', items: [{ w: 1, h: 1 }] },
  o6: { id: 'o6', orderNum: 'L1312', stage: 'delivery', orderClient: 'הובלה', items: [{ w: 1, h: 1 }] },
  o3: { id: 'o3', orderNum: 'L1301', orderClient: 'טקסט', sketchName: 'בלי סקיצה', items: [{ w: 500, h: 600, name: 'מראה' }] },
};
const db = fakeDb({ orders, sketches: { o1: 'data:image/png;base64,AAAA', o1__layer: '{"v":1}', o1__base: 'data:image/png;base64,BBBB', o1__att0: 'data:image/jpeg;base64,CCCC' } });
const admin = async () => ({ ok: true, role: 'admin', phone: '050' });
const client = async () => ({ ok: true, role: 'client', phone: '0501112222' });
const call = (req, verify) => G.handleGlass(Object.assign({ headers: { host: 'luzglass.vercel.app' } }, req), { db, verify: verify || admin });

(async () => {
  /* ── חתימה ── */
  const s1 = G.lgGlassSig('o1', 0, 'k'), s2 = G.lgGlassSig('o1', 1, 'k'), s3 = G.lgGlassSig('o1', 0, 'k2');
  check('G1 signature: 8 chars A-Z2-7, differs per glass and per secret', [/^[A-Z2-7]{8}$/.test(s1), s1 !== s2, s1 !== s3], [true, true, true]);
  check('G2 parse code and URL', [G.lgGlassParse('1300-2-ABCDEFGH'), G.lgGlassParse('https://luzglass.vercel.app/G/1300-2-abcdefgh')],
        [{ num: '1300', idx: 1, sig: 'ABCDEFGH' }, { num: '1300', idx: 1, sig: 'ABCDEFGH' }]);
  check('G3 parse rejects Avivi code / junk', [G.lgGlassParse('1247-3'), G.lgGlassParse('1300-0-ABCDEFGH'), G.lgGlassParse('x')], [null, null, null]);

  /* ── חתימה דרך השרת — מנהל בלבד ── */
  const sg = await call({ method: 'POST', body: { action: 'sign', items: [{ orderId: 'o1', idx: 1 }, { orderId: 'nope', idx: 0 }, { orderId: 'a/b', idx: 0 }] } });
  const url = sg.body.urls[0];
  check('S1 admin gets a URL per glass; unknown/bad id → empty', [sg.status, /^HTTPS:\/\/LUZGLASS\.VERCEL\.APP\/G\/1300-2-[A-Z2-7]{8}$/.test(url), sg.body.urls.slice(1)], [200, true, ['', '']]);
  check('S2 the URL fits the alphanumeric QR (version ≤ 3)', !!Q.lgQrMatrix(url, 'L') && Q.lgQrMatrix(url, 'L').length <= 29, true);
  check('S3 test site host kept', (await call({ method: 'POST', headers: { host: 'luzglass-test.vercel.app' }, body: { action: 'sign', items: [{ orderId: 'o1', idx: 0 }] } })).body.urls[0].startsWith('HTTPS://LUZGLASS-TEST.VERCEL.APP/G/'), true);
  check('S4 client cannot sign', (await call({ method: 'POST', body: { action: 'sign', items: [{ orderId: 'o1', idx: 0 }] } }, client)).status, 403);
  check('S5 not signed in cannot sign', (await call({ method: 'POST', body: { action: 'sign', items: [] } }, async () => ({ ok: false, status: 401 }))).status, 401);

  /* ── צפייה ציבורית ── */
  const code = url.split('/G/')[1];
  const v = await call({ method: 'GET', query: { c: code } }, async () => { throw new Error('view must not need auth'); });
  check('V1 public view: sketch name, the scanned glass, count, images', [v.status, v.body.sketchName, v.body.glass, v.body.count, v.body.images, v.body.glassNo],
        [200, 'מקלחון אסף', { w: 400, h: 1900, name: '8 מ"מ שקוף' }, 2, 2, 2]);
  const leaked = ['999', 'פנימי', '0501112222', 'price', 'total', 'notes', 'phone'].filter(k => JSON.stringify(v.body).includes(k));
  check('V2 no prices, phone or notes leave the server', leaked, []);
  const wrong = code.replace(/-([A-Z2-7]{8})$/, (m, s) => '-' + (s[0] === 'A' ? 'B' : 'A') + s.slice(1));
  check('V3 changed signature → not found', (await call({ method: 'GET', query: { c: wrong } })).status, 404);
  const other = code.replace(/^1300-2-/, '1300-1-');
  check('V4 same signature on another glass → not found', (await call({ method: 'GET', query: { c: other } })).status, 404);
  check('V5 same digits on another order (X1300 vs L1300) does not confuse', (await call({ method: 'GET', query: { c: '1300-1-' + G.lgGlassSig('o2', 0) } })).body.client, 'אחר');
  check('V6 garbage code → 400', (await call({ method: 'GET', query: { c: '../../x' } })).status, 400);

  /* ── התמונות: המקורית, לא שכבת העריכה ── */
  const i0 = await call({ method: 'GET', query: { c: code, img: '0' } });
  const i1 = await call({ method: 'GET', query: { c: code, img: '1' } });
  check('I1 image 0 = the original (__base), image 1 = attachment', [i0.image, i1.image], ['data:image/png;base64,BBBB', 'data:image/jpeg;base64,CCCC']);
  check('I2 out of range → 404', (await call({ method: 'GET', query: { c: code, img: '5' } })).status, 404);
  const t = await call({ method: 'GET', query: { c: '1301-1-' + G.lgGlassSig('o3', 0) } });
  check('I3 text order: no images, the glass list instead', [t.body.images, t.body.items], [0, [{ w: 500, h: 600, name: 'מראה' }]]);

  /* ── נהג הלקוח סורק ומסמן נאסף (בן, 19/11) — בלי כניסה ── */
  {
    const noAuth = async () => { throw new Error('collect must not need auth'); };
    const c4 = '1310-2-' + G.lgGlassSig('o4', 1);
    const r1 = await call({ method: 'POST', body: { action: 'collect', c: c4, name: '  משה הנהג  ' } }, noAuth);
    const o4 = (await db.ref('orders/o4').once('value')).val();
    check('C1 scan collects the whole order, no login', [r1.status, r1.body.ok, o4.stage, o4.status, o4.scanCollect.glassNo, o4.scanCollect.name, !!o4.scanCollect.early],
          [200, true, 'collected', 'נאסף', 2, 'משה הנהג', false]);
    const at1 = o4.scanCollect.at;
    const r2 = await call({ method: 'POST', body: { action: 'collect', c: c4 } }, noAuth);
    check('C2 second scan → already, first time kept', [r2.status, r2.body.code, r2.body.at, (await db.ref('orders/o4/scanCollect/at').once('value')).val()], [409, 'already', at1, at1]);
    const r3 = await call({ method: 'POST', body: { action: 'collect', c: '1311-1-' + G.lgGlassSig('o5', 0) } }, noAuth);
    check('C3 before ready → collected anyway, marked early', [r3.status, r3.body.early, (await db.ref('orders/o5/scanCollect/early').once('value')).val()], [200, true, true]);
    const r4 = await call({ method: 'POST', body: { action: 'collect', c: '1312-1-' + G.lgGlassSig('o6', 0) } }, noAuth);
    check('C4 our delivery → refused, stage unchanged', [r4.status, r4.body.code, (await db.ref('orders/o6/stage').once('value')).val()], [409, 'delivery', 'delivery']);
    const bad = c4.replace(/-([A-Z2-7]{8})$/, (m, s) => '-' + (s[0] === 'A' ? 'B' : 'A') + s.slice(1));
    check('C5 wrong signature → 404', (await call({ method: 'POST', body: { action: 'collect', c: bad } }, noAuth)).status, 404);
    await call({ method: 'POST', body: { action: 'collect', c: '1300-1-' + G.lgGlassSig('o1', 0), name: 'א'.repeat(60) } }, noAuth);
    check('C6 name cut to 40', ((await db.ref('orders/o1/scanCollect/name').once('value')).val() || '').length, 40);
    const v7 = await call({ method: 'GET', query: { c: c4 } }, noAuth);
    check('C7 view shows stage + scan record', [v7.body.stage, v7.body.scanCollect.at, v7.body.scanCollect.name], ['collected', at1, 'משה הנהג']);
    check('C8 bad code on collect → 400', (await call({ method: 'POST', body: { action: 'collect', c: 'x' } }, noAuth)).status, 400);
  }

  /* ── חזרה אחרי כניסה: רק דף פנימי ── */
  {
    const fs = require('fs');
    const L = fs.readFileSync(path.join(__dirname, '..', 'login.html'), 'utf8');
    const body = L.match(/function _lgNext\(\)\{[\s\S]*?\n\}/)[0];
    const run = q => new Function('location', 'URLSearchParams', body + '\nreturn _lgNext();')({ search: q }, URLSearchParams);
    check('N1 next: internal page with query kept', run('?next=' + encodeURIComponent('g.html?c=1300-2-ABCDEFGH&go=1')), 'g.html?c=1300-2-ABCDEFGH&go=1');
    check('N2 next: outside address / protocol / login loop refused',
      [run('?next=' + encodeURIComponent('https://evil.com/x.html')), run('?next=' + encodeURIComponent('//evil.com/a.html')),
       run('?next=javascript:alert(1)'), run('?next=login.html'), run('')], ['', '', '', '', '']);
  }

  console.log(fail ? `\n${fail} FAILED` : '\nall passed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
