// One-off verification (kept with the tools): a click AND a touch in the middle of each drawn glass panel in
// check-station.html must check it. Uses the training harness (in-memory Firebase). node verify-check-tap.mjs
import puppeteer from 'puppeteer';
const seed = { __clock: Date.now(), __session: '0500000000', __api: {}, db: {
  users: { '0500000000': { name: 'בדיקה', role: 'admin', phone: '0500000000', isMainAdmin: true } },
  orders: { ord_c1: { id: 'ord_c1', orderNum: 'L9601', orderClient: 'בדיקת נגיעה', client: 'בדיקת נגיעה', phone: '0509990002', stage: 'workday', status: 'ירד לביצוע',
    createdAt: Date.now(), hasSketch: false, items: [{ name: '8 שקוף מחוסם', w: 800, h: 1900, chisum: true }, { name: '8 שקוף מחוסם', w: 600, h: 1900, chisum: true }] } },
  workday: { inChisum: { 0: 'ord_c1' }, inWork: {}, itemsSel: {} } } };
const b = await puppeteer.launch();
const results = {};
for (const mode of ['click', 'touch']) {
  const p = await b.newPage();
  await p.setViewport({ width: 1180, height: 820, hasTouch: mode === 'touch', isMobile: mode === 'touch' });
  await p.setRequestInterception(true);
  p.on('request', r => r.url().includes('/__seed.json') ? r.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(seed) })
    : /^http:\/\/localhost:8899|fonts\.g/.test(r.url()) ? r.continue() : r.abort());
  await p.goto('http://localhost:8899/tools/training-video/harness/harness.html?p=check-station.html', { waitUntil: 'networkidle0' });
  await new Promise(r => setTimeout(r, 1200));
  const card = await p.evaluateHandle(() => [...document.querySelectorAll('[onclick]')].find(e => /L9601/.test(e.textContent)));
  await card.asElement().click();
  await new Promise(r => setTimeout(r, 700));
  const n = await p.$$eval('#skWrap rect[data-idx]', rs => rs.length);
  const out = [];
  for (let i = 0; i < n; i++) {
    const r = (await p.$$('#skWrap rect[data-idx]'))[i];
    await r.evaluate(e => e.scrollIntoView({ block: 'center' }));
    const bb = await r.boundingBox();
    const x = bb.x + bb.width / 2, y = bb.y + bb.height / 2;
    const top = await p.evaluate((x, y) => { const e = document.elementFromPoint(x, y); return e && e.tagName; }, x, y);
    if (mode === 'touch') await p.touchscreen.tap(x, y); else await p.mouse.click(x, y);
    await new Promise(r => setTimeout(r, 400));
    out.push({ topElement: top, progress: await p.evaluate(() => (document.body.innerText.match(/(\d+)\s*\/\s*(\d+)/) || [''])[0]) });
  }
  results[mode] = out;
  await p.close();
}
await b.close();
console.log(JSON.stringify(results));
