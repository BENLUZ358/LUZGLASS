// Records one training video: drives the REAL LuzGlass pages (through harness/harness.html, on an in-memory Firebase)
// and writes, per step, sharp stills (2×) plus where everything is on the page. compose.js turns that into the video.
//
// A video file (videos/NN-*.js) exports meta, seed() and script(r). script() calls the methods below; each call adds
// "beats" to out/<id>/beats.json. Nothing here invents UI: every highlighted element is found in the live page, and a
// step whose element is missing FAILS the recording (no silent skip).
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer';

const BASE = 'http://localhost:8899';
const ALLOWED = [/^http:\/\/localhost:8899\//, /^https:\/\/fonts\.googleapis\.com\//, /^https:\/\/fonts\.gstatic\.com\//, /^data:/, /^blob:/, /^about:/];

export async function record(video, outDir) {
  const { meta } = video;
  const VW = meta.viewport?.w || 1600, VH = meta.viewport?.h || 900;
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(outDir, 'stills'), { recursive: true });

  let state = JSON.parse(JSON.stringify(video.seed()));
  const browser = await puppeteer.launch({ args: ['--lang=he-IL', '--font-render-hinting=none'] });
  const page = await browser.newPage();
  await page.setViewport({ width: VW, height: VH, deviceScaleFactor: 2 });
  page.setDefaultTimeout(15000);
  const blocked = [];
  const pageErrors = [];
  await page.setRequestInterception(true);
  page.on('request', req => {
    const url = req.url();
    if (url.startsWith(BASE + '/__seed.json')) {
      return req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(state) });
    }
    if (ALLOWED.some(re => re.test(url))) return req.continue();
    blocked.push(url);                       // a real database, Vercel, WhatsApp… — never
    return req.abort();
  });
  page.on('pageerror', e => pageErrors.push(String(e && e.message || e)));
  page.on('console', m => { if (m.type() === 'error') pageErrors.push('console: ' + m.text()); });

  const beats = [];
  let stillN = 0;
  let lastStill = null;
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  async function snap(tag = '') {
    const f = `s${String(++stillN).padStart(4, '0')}${tag ? '-' + tag : ''}.png`;
    await page.screenshot({ path: path.join(outDir, 'stills', f), type: 'png' });
    lastStill = f;
    return f;
  }
  // the element's box in page px (viewport coordinates); scrolls it into view first if needed
  async function rectOf(target, { scroll = true, required = true } = {}) {
    if (!target) return null;
    if (typeof target === 'object' && 'x' in target) return target;           // a literal rect
    const h = await handle(target, required);
    if (!h) return null;
    if (scroll) {
      await h.evaluate(el => {
        const r = el.getBoundingClientRect();
        if (r.top < 60 || r.bottom > innerHeight - 20) el.scrollIntoView({ block: 'center' });
      });
      await sleep(120);
    }
    const r = await h.boundingBox();
    if (!r && required) throw new Error('not visible: ' + JSON.stringify(target));
    return r && { x: r.x, y: r.y, w: r.width, h: r.height };
  }
  // target: a CSS selector, or { sel, text } — the first visible match whose text includes `text`
  async function handle(target, required = true) {
    const t = typeof target === 'string' ? { sel: target } : target;
    const deadline = Date.now() + (t.timeout || 6000);
    while (Date.now() < deadline) {
      const h = await page.evaluateHandle(({ sel, text, nth }) => {
        const vis = el => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
          return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
        const all = [...document.querySelectorAll(sel)].filter(vis)
          .filter(el => !text || el.textContent.replace(/\s+/g, ' ').includes(text));
        return all[nth || 0] || null;
      }, t);
      const el = h.asElement();
      if (el) return el;
      await sleep(150);
    }
    if (required) throw new Error('element not found: ' + JSON.stringify(t));
    return null;
  }
  const union = rs => {
    rs = rs.filter(Boolean); if (!rs.length) return null;
    const x = Math.min(...rs.map(r => r.x)), y = Math.min(...rs.map(r => r.y));
    return { x, y, w: Math.max(...rs.map(r => r.x + r.w)) - x, h: Math.max(...rs.map(r => r.y + r.h)) - y };
  };
  async function rects(list, opts) { const out = []; for (const t of [].concat(list || [])) out.push(await rectOf(t, opts)); return out.filter(Boolean); }
  const dialogsNow = () => page.evaluate(() => (window.__dialogs || []).length);
  const dialogsSince = n => page.evaluate(k => (window.__dialogs || []).slice(k), n);

  const r = {
    page, sleep, state: () => state,
    // load a page of the system (state carries over from the previous page)
    async open(file, { wait, settle = 900 } = {}) {
      if (r._opened) state.db = await page.evaluate(() => JSON.parse(JSON.stringify(window.__store)));
      r._opened = true;
      await page.goto(`${BASE}/tools/training-video/harness/harness.html?p=${encodeURIComponent(file)}`, { waitUntil: 'networkidle0' });
      await page.waitForFunction(() => document.title && !/training harness/.test(document.title));
      await page.evaluate(() => document.fonts && document.fonts.ready);
      if (wait) await handle(wait);
      await sleep(settle);
      await page.addStyleTag({ content: '#lgEnvBadge{display:none!important} *{caret-color:transparent}' });
    },
    // run code in the page (setup that is not shown — e.g. a change made "elsewhere")
    async exec(fn, ...args) { const v = await page.evaluate(fn, ...args); await sleep(500); return v; },
    async node(fn) { return fn(page); },
    // ── beats ───────────────────────────────────────────────────────────
    card(c) { beats.push({ type: 'card', ...c }); },
    chapter(name) { beats.push({ type: 'chapter', name }); },
    progress(p) { beats.push({ type: 'progress', ...p }); },
    // look at an area: zoom to `focus`, ring around `mark`, hold while the text is read
    async show({ focus, mark, text, who = null, chip = null, hold, wide = false }) {
      const fr = wide ? null : union(await rects(focus || mark));
      const mr = await rects(mark);
      const still = await snap();
      beats.push({ type: 'view', still, focus: fr, marks: mr, text, who, chip, hold });
    },
    // click: zoom, ring, explain, cursor, click (the real one), then the result
    async click({ target, focus, text, after, afterMark, afterFocus, who = 'you', chip = null, afterChip = null, hold, afterHold,
                  settle = 650, noClick = false, dialogAnswerText = 'אישור' }) {
      const tr = await rectOf(target);
      const fr = union([...(await rects(focus)), tr]);
      const before = await snap();
      const d0 = await dialogsNow();
      if (!noClick) {
        const h = await handle(target);
        await h.click();
      }
      await sleep(settle);
      const dlg = await dialogsSince(d0);
      const afterStill = await snap('after');
      let ar = await rects(afterMark, { required: false });
      const afr = afterFocus ? union(await rects(afterFocus, { required: false })) : null;
      beats.push({ type: 'click', still: before, after: afterStill, focus: fr, target: tr, text, who, chip,
                   dialogs: dlg, dialogAnswerText, afterText: after, afterMarks: ar, afterFocus: afr, afterChip, hold, afterHold });
    },
    // type into a field, one key at a time (a still every key)
    async type({ target, value, focus, text, who = 'you', clear = true, settle = 300 }) {
      const tr = await rectOf(target);
      const fr = union([...(await rects(focus)), tr]);
      const h = await handle(target);
      const first = await snap();
      await h.click();
      if (clear) { await page.keyboard.down('Control'); await page.keyboard.press('KeyA'); await page.keyboard.up('Control'); await page.keyboard.press('Backspace'); }
      const frames = [];
      for (const ch of String(value)) { await page.keyboard.type(ch); await sleep(40); frames.push(await snap('k')); }
      await sleep(settle);
      const done = await snap('typed');
      beats.push({ type: 'typing', still: first, frames, after: done, focus: fr, target: tr, text, who });
    },
    // a still of whatever a print window received (the chisum report)
    async showPrinted({ text, focus, who = 'system', chip }) {
      const html = await page.evaluate(() => { const w = (window.__opened || []).slice(-1)[0]; return w ? w.document.html : ''; });
      if (!html) throw new Error('no print window was opened');
      const p2 = await browser.newPage();
      await p2.setViewport({ width: VW, height: VH, deviceScaleFactor: 2 });
      await p2.setContent(html, { waitUntil: 'networkidle0' }).catch(() => {});
      await sleep(400);
      const f = `s${String(++stillN).padStart(4, '0')}-print.png`;
      await p2.screenshot({ path: path.join(outDir, 'stills', f) });
      await p2.close();
      beats.push({ type: 'view', still: f, focus: focus || null, marks: [], text, who, chip, paper: true });
    },
  };

  try {
    await video.script(r);
  } finally {
    await browser.close();
  }
  const real = pageErrors.filter(e => !/favicon|Failed to load resource: net::ERR_FAILED|ERR_BLOCKED/.test(e));
  fs.writeFileSync(path.join(outDir, 'beats.json'), JSON.stringify({ meta: { ...meta, VW, VH }, beats }, null, 1));
  fs.writeFileSync(path.join(outDir, 'record-log.json'), JSON.stringify({ blocked, pageErrors: real }, null, 1));
  const ext = blocked.filter(u => !/favicon/.test(u));
  if (ext.length) throw new Error('requests outside localhost were attempted (blocked): ' + ext.slice(0, 5).join(', '));
  return { beats: beats.length, stills: stillN, pageErrors: real };
}
