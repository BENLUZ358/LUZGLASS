// beats.json (recorder.js) → frames → MP4. Every frame is drawn by lib/compositor.html in a browser (real Hebrew, RTL),
// screenshotted, and piped to ffmpeg. A frame identical to the previous one is not redrawn — most of a training video
// is a held explanation, so this is where the speed comes from.
//
// Pace (Ben: "לא למהר"): an explanation stays up for 1.5 s + 0.34 s a word (min 2.8 s); every result is held ≥ 1.8 s;
// the camera moves in 0.9–1.6 s with ease-in-out, through a wider view when the next spot is far away.
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import puppeteer from 'puppeteer';
import ffmpeg from 'ffmpeg-static';

export const FPS = 30;
const W = 1920, H = 1080;
const ease = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
const lerp = (a, b, t) => a + (b - a) * t;
export const readT = (text, min = 2.8) => !text ? 0 : Math.max(min, 1.5 + String(text).split(/\s+/).filter(Boolean).length * 0.34);

export function buildFrames(beatsDoc, urlOf) {
  const { meta, beats } = beatsDoc;
  const VW = meta.VW, VH = meta.VH;
  // the whole page in a 16:9 frame. A page that is not 16:9 (a tablet, 1180×820) gets dark margins at the sides,
  // never a cropped bottom.
  const WW = Math.max(VW, VH * 16 / 9);
  const WIDE = { x: (VW - WW) / 2, y: 0, w: WW, h: WW * 9 / 16 };
  const frames = [];
  const marks = [];               // [{t, label}] — for QA sheets
  const clicks = [];              // seconds — for the click sound
  let cam = { ...WIDE }, A = null;
  let chapter = null, chapterN = 0, progress = null;
  let cursor = { x: VW * 0.62, y: VH * 0.62, a: 0 };
  const t = () => frames.length / FPS;
  const unionR = rs => { rs = (rs || []).filter(Boolean); if (!rs.length) return null;
    const x = Math.min(...rs.map(r => r.x)), y = Math.min(...rs.map(r => r.y));
    return { x, y, w: Math.max(...rs.map(r => r.x + r.w)) - x, h: Math.max(...rs.map(r => r.y + r.h)) - y }; };
  const n = s => Math.max(1, Math.round(s * FPS));

  // camera that shows `r` comfortably: padded, 16:9, zoom ≤ 2.3, focus sitting a little above centre (caption room)
  function camFor(r) {
    if (!r) return { ...WIDE };
    const padX = Math.max(60, r.w * 0.22), padY = Math.max(50, r.h * 0.3);
    let w = Math.max(r.w + 2 * padX, (r.h + 2 * padY) * 16 / 9, VW / 2.3);
    if (w >= WW * 0.86) return { ...WIDE };
    w = Math.min(w, WW);
    const h = w * 9 / 16;
    const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
    let x = cx - w / 2, y = cy - h * 0.44;
    if (w <= VW) x = Math.min(Math.max(0, x), VW - w); else x = Math.min(Math.max(WIDE.x, x), WIDE.x + WW - w);
    y = h >= VH ? 0 : Math.min(Math.max(0, y), VH - h);
    return { x, y, w, h };
  }
  const area = c => c.w * c.h;
  const isWide = c => c.w >= WW - 1;
  // the camera for a beat: its focus — unless that is too big to zoom on (a whole column), then the marked spots
  function camOf(focus, marks) {
    const c = camFor(focus);
    if (!isWide(c) || !marks || !marks.length) return c;
    const m = camFor(unionR(marks));
    return isWide(m) ? c : m;
  }
  const unionCam = (a, b) => { const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
    const r = { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y }; return camFor(r); };
  // is the rect (page px) under the bottom caption band, on screen, with camera c?
  function captionPos(c, rs) {
    const k = W / c.w;
    const band = H - 250;
    return (rs || []).some(r => r && ((r.y + r.h - c.y) * k > band) && ((r.y - c.y) * k < H)) ? 'top' : 'bottom';
  }

  // base frame state; `o` overrides
  let ui = { caption: null, chip: null, rings: [], spot: null, dialog: null, ripple: null, card: null, b: null, mix: 0 };
  function push(count, o = {}) {
    for (let i = 0; i < count; i++) {
      const f = typeof o === 'function' ? o(i / Math.max(1, count - 1), i) : o;
      frames.push({
        a: A ? urlOf(A) : null, b: (f.b ?? ui.b) ? urlOf(f.b ?? ui.b) : null, mix: f.mix ?? ui.mix,
        cam: f.cam || cam, rings: f.rings ?? ui.rings, spot: f.spot ?? ui.spot, dialog: f.dialog ?? ui.dialog,
        cursor: f.cursor || cursor, ripple: f.ripple ?? ui.ripple, caption: f.caption !== undefined ? f.caption : ui.caption,
        chip: f.chip !== undefined ? f.chip : ui.chip, chapter, progress, card: f.card !== undefined ? f.card : ui.card,
      });
    }
  }
  // fade a value 0→1 over the first `fade` s of a span
  const fadeIn = (p, total, fade = 0.35) => Math.min(1, (p * total) / fade);

  function moveCam(to, extra = {}) {
    const from = { ...cam };
    const same = Math.abs(from.x - to.x) + Math.abs(from.y - to.y) + Math.abs(from.w - to.w) < 4;
    if (same) { cam = to; return; }
    const far = from.w < WW && to.w < WW && area(unionCam(from, to)) > 3 * Math.max(area(from), area(to));
    const legs = far ? [unionCam(from, to), to] : [to];
    let cur = from;
    for (const leg of legs) {
      const d = Math.hypot(leg.x - cur.x, leg.y - cur.y) + Math.abs(leg.w - cur.w);
      const dur = Math.min(1.15, Math.max(0.75, d / 1000));
      const c0 = { ...cur };
      push(n(dur), p => { const e = ease(p); return { ...extra, cam: { x: lerp(c0.x, leg.x, e), y: lerp(c0.y, leg.y, e), w: lerp(c0.w, leg.w, e), h: lerp(c0.h, leg.h, e) } }; });
      cur = leg;
    }
    cam = to;
  }
  // cross-fade to another still at the current camera
  function toStill(file, dur = 0.3) {
    if (!file || file === A) return;
    if (!A) { A = file; return; }
    push(n(dur), p => ({ b: file, mix: ease(p) }));
    A = file; ui.b = null; ui.mix = 0;
  }
  function moveCursor(x, y, dur = 0.8) {
    const c0 = { ...cursor };
    if (c0.a < 1) { c0.x = x + (VW * 0.08); c0.y = y + VH * 0.12; }
    push(n(dur), p => { const e = ease(p); return { cursor: { x: lerp(c0.x, x, e), y: lerp(c0.y, y, e), a: Math.min(1, (c0.a || 0) + p * 3) } }; });
    cursor = { x, y, a: 1 };
  }
  function clickAt(x, y) {
    clicks.push(t());
    push(n(0.5), p => ({ cursor: { x, y, a: 1, down: p < 0.35 }, ripple: { x, y, p } }));
  }
  const chipOf = (who, chip) => chip ? chip
    : who === 'you' ? { kind: 'you', t: '👤 הפעולה שלך' }
    : who === 'system' ? { kind: 'system', t: '⚙ המערכת עושה את זה לבד' } : null;
  const fadeOutUi = (dur = 0.3) => {
    const r0 = ui.rings, s0 = ui.spot, c0 = ui.caption, h0 = ui.chip;
    if (!r0.length && !s0 && !c0) return;
    push(n(dur), p => ({ rings: r0.map(r => ({ ...r, a: r.a * (1 - p) })), spot: s0 ? { ...s0, a: s0.a * (1 - p) } : null,
      caption: c0 ? { ...c0, a: 1 - p } : null, chip: h0 ? { ...h0, a: 1 - p } : null }));
    ui.rings = []; ui.spot = null; ui.caption = null; ui.chip = null;
  };
  // show text (+chip) and rings, hold for reading
  function explain({ text, chip, rings, spotR, hold, minHold = 0 }) {
    const pos = captionPos(cam, [...(rings || []), spotR]);
    const total = Math.max(hold ?? readT(text), minHold);
    const cap = text ? { t: text, pos } : null;
    push(n(total), p => {
      const a = fadeIn(p, total);
      return { caption: cap ? { ...cap, a } : null, chip: chip ? { ...chip, a } : null,
        rings: (rings || []).map(r => ({ r, a })), spot: spotR ? { r: spotR, a: a * 0.9 } : null };
    });
    ui.caption = cap ? { ...cap, a: 1 } : null; ui.chip = chip ? { ...chip, a: 1 } : null;
    ui.rings = (rings || []).map(r => ({ r, a: 1 })); ui.spot = spotR ? { r: spotR, a: 0.9 } : null;
  }

  for (const b of beats) {
    marks.push({ t: t(), label: `${b.type}${b.text ? ': ' + String(b.text).slice(0, 50) : b.title ? ': ' + b.title : b.name ? ': ' + b.name : ''}` });
    if (b.type === 'chapter') {
      chapterN++;
      const c = { kind: 'chapter', kicker: `חלק ${chapterN}`, title: b.name };
      fadeOutUi();
      const dur = 2.6;
      push(n(dur), p => ({ card: { c, a: p < 0.15 ? p / 0.15 : p > 0.85 ? (1 - p) / 0.15 : 1 } }));
      chapter = { t: b.name, n: `${chapterN}`, a: 1 };
      continue;
    }
    if (b.type === 'progress') { progress = { stations: b.stations, cur: b.cur, done: b.done || [], skip: b.skip || [] }; continue; }
    if (b.type === 'card') {
      fadeOutUi();
      const words = [b.title, b.sub, ...(b.bullets || []), b.box && b.box.text, ...(b.table || []).flat(), ...(b.flow || []).map(f => f.t || f)].filter(Boolean).join(' ');
      const dur = b.dur || Math.max(4.5, 2.2 + words.split(/\s+/).length * 0.36);
      const c = { ...b }; delete c.type;
      const hide = b.kind === 'title' ? null : chapter;   // no chapter tag over the opening card
      const ch0 = chapter; chapter = hide;
      push(n(dur), p => ({ card: { c, a: p * dur < 0.45 ? (p * dur) / 0.45 : (1 - p) * dur < 0.45 ? ((1 - p) * dur) / 0.45 : 1 } }));
      chapter = ch0;
      continue;
    }
    // screen beats
    // a control is always framed with its row (b.context); a focus too big to zoom on falls back to that row
    const ctxR = b.type !== 'view' && b.context ? unionR([b.context, b.target]) : null;
    const want = b.focus && ctxR ? unionR([b.focus, ctxR]) : b.focus;
    const focusCam = want ? camOf(want, b.type === 'view' ? b.marks : [ctxR || b.target]) : { ...WIDE };
    if (b.type === 'view') {
      fadeOutUi(0.25);
      if (b.still !== A) toStill(b.still, 0.3);   // same page, same layout: cross-fade where we are, then fly
      moveCam(focusCam);
      const rings = b.marks || [];
      explain({ text: b.text, chip: chipOf(b.who, b.chip), rings, spotR: rings.length ? unionR(rings) : null, hold: b.hold, minHold: b.paper ? 4 : 0 });
      continue;
    }
    if (b.type === 'click' || b.type === 'typing') {
      fadeOutUi(0.25);
      if (b.still !== A) toStill(b.still, 0.3);   // same page, same layout: cross-fade where we are, then fly
      moveCam(focusCam);
      const tr = b.target;
      explain({ text: b.text, chip: chipOf(b.who, b.chip), rings: [tr], spotR: tr, hold: b.hold });
      const px = tr.x + tr.w / 2, py = tr.y + tr.h / 2;
      moveCursor(px, py);
      clickAt(px, py);
      if (b.type === 'typing') {
        // each key: a still
        for (const f of b.frames) { A = f; push(n(0.13)); }
        A = b.after; push(n(0.8));
        continue;
      }
      // a browser dialog appeared: show it, answer it
      for (const d of b.dialogs || []) {
        const r0 = ui.rings, s0 = ui.spot;
        ui.rings = []; ui.spot = null;
        const dCam = { ...WIDE };
        moveCam(dCam);
        const dlg = { msg: d.msg, a: 1 };
        const dtext = d.kind === 'confirm' ? `הדפדפן שואל לאישור: לוחצים **"אישור"** כדי להמשיך, או **"ביטול"** כדי לעצור.` : 'הודעה מהמערכת. לוחצים "אישור".';
        push(n(0.35), p => ({ dialog: { ...dlg, a: p }, caption: null, chip: null }));
        ui.dialog = dlg;
        explain({ text: dtext, chip: { kind: 'warn', t: '⚠ חלון אישור' }, hold: Math.max(readT(d.msg, 3.5), readT(dtext)) });
        // the OK button sits at the dialog's bottom-left (ltr button row)
        const okX = VW / 2 - 280 + 26 + 45, okY = 18 + 170;
        moveCursor(okX, okY, 0.7); clickAt(okX, okY);
        push(n(0.3), p => ({ dialog: { ...dlg, a: 1 - p } }));
        ui.dialog = null; void r0; void s0;
      }
      // the result
      const rs = b.afterMarks || [];
      ui.rings = []; ui.spot = null;
      toStill(b.after, 0.3);
      cursor = { ...cursor, a: 1 };
      if (b.afterText) {
        if (b.afterFocus) moveCam(camOf(b.afterFocus, rs));
        else if (rs.length) { const u = unionR(rs); const c2 = camFor(unionR([u, tr])); if (c2.w > cam.w * 1.02 || !(u.x >= cam.x && u.y >= cam.y && u.x + u.w <= cam.x + cam.w && u.y + u.h <= cam.y + cam.h)) moveCam(c2); }
        ui.caption = null; ui.chip = null;
        explain({ text: b.afterText, chip: b.afterChip || null, rings: rs, spotR: rs.length ? unionR(rs) : null, hold: b.afterHold, minHold: 2.2 });
      } else {
        push(n(b.afterHold || 1.8));
      }
      continue;
    }
  }
  fadeOutUi(0.4);
  if (cam.w < WW) moveCam({ ...WIDE });
  push(n(0.6));
  return { frames, marks, clicks, duration: frames.length / FPS };
}

// a quiet click: 12 ms of decaying filtered noise, 48 kHz mono, as a WAV of the whole video's length
function clickTrack(file, duration, clicks) {
  const SR = 48000, N = Math.ceil(duration * SR);
  const pcm = new Int16Array(N);
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  for (const c of clicks) {
    const s0 = Math.floor(c * SR); let lp = 0;
    for (let i = 0; i < SR * 0.03 && s0 + i < N; i++) {
      lp = lp * 0.55 + rnd() * 0.45;
      const env = Math.exp(-i / (SR * 0.004));
      pcm[s0 + i] = Math.max(-32767, Math.min(32767, pcm[s0 + i] + lp * env * 9000));
    }
  }
  const buf = Buffer.alloc(44 + N * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + N * 2, 4); buf.write('WAVE', 8); buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(N * 2, 40);
  Buffer.from(pcm.buffer).copy(buf, 44);
  fs.writeFileSync(file, buf);
}

export async function compose(outDir, { baseUrl = 'http://localhost:8899' } = {}) {
  const doc = JSON.parse(fs.readFileSync(path.join(outDir, 'beats.json'), 'utf8'));
  // the stills are served from outDir by request interception (they are not under the web root)
  const urlOf = f => `${baseUrl}/__stills/${f}`;
  const { frames, marks, clicks, duration } = buildFrames(doc, urlOf);
  fs.writeFileSync(path.join(outDir, 'timeline.json'), JSON.stringify({ duration, marks }, null, 1));
  const browser = await puppeteer.launch({ args: ['--font-render-hinting=none'] });
  const page = await browser.newPage();
  await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
  await page.setRequestInterception(true);
  page.on('request', req => {
    const u = req.url();
    if (u.startsWith(baseUrl + '/__stills/')) {
      const f = path.join(outDir, 'stills', path.basename(decodeURIComponent(u.split('/__stills/')[1])));
      return fs.existsSync(f) ? req.respond({ status: 200, contentType: 'image/png', body: fs.readFileSync(f) }) : req.respond({ status: 404, body: '' });
    }
    return req.continue();
  });
  await page.goto(`${baseUrl}/tools/training-video/lib/compositor.html`, { waitUntil: 'networkidle0' });
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate((w, h) => window.setup(w, h), doc.meta.VW, doc.meta.VH);

  const silent = path.join(outDir, 'video-noaudio.mp4');
  const ff = spawn(ffmpeg, ['-y', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-',
    '-c:v', 'libx264', '-preset', 'medium', '-tune', 'animation', '-crf', '17', '-pix_fmt', 'yuv420p', '-r', String(FPS), silent],
    { stdio: ['pipe', 'ignore', 'pipe'] });
  let ffErr = ''; ff.stderr.on('data', d => { ffErr = (ffErr + d).slice(-4000); });
  const write = buf => new Promise(res => { if (!ff.stdin.write(buf)) ff.stdin.once('drain', res); else res(); });
  let last = null, lastBuf = null, drawn = 0;
  const t0 = Date.now();
  for (let i = 0; i < frames.length; i++) {
    const key = JSON.stringify(frames[i]);
    if (key !== last) {
      await page.evaluate(s => window.render(s), frames[i]);
      lastBuf = await page.screenshot({ type: 'jpeg', quality: 94 });
      last = key; drawn++;
    }
    await write(lastBuf);
    if (i % 600 === 0) process.stdout.write(`  frame ${i}/${frames.length} (${drawn} drawn, ${((Date.now() - t0) / 1000).toFixed(0)} s)\n`);
  }
  ff.stdin.end();
  const code = await new Promise(res => ff.on('close', res));
  await browser.close();
  if (code !== 0) throw new Error('ffmpeg failed: ' + ffErr);
  // audio: the clicks
  const wav = path.join(outDir, 'clicks.wav');
  clickTrack(wav, duration, clicks);
  const final = path.join(outDir, 'video.mp4');
  const r = spawnSync(ffmpeg, ['-y', '-i', silent, '-i', wav, '-c:v', 'copy', '-c:a', 'aac', '-b:a', '96k', '-shortest', '-movflags', '+faststart', final], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error('mux failed: ' + r.stderr.slice(-2000));
  fs.rmSync(silent); fs.rmSync(wav);
  return { duration, frames: frames.length, drawn, file: final };
}

// a WhatsApp copy: 720p; if over 16 MB, a two-pass encode at the bitrate that fits
export function whatsapp(src, dst, duration) {
  const one = spawnSync(ffmpeg, ['-y', '-i', src, '-vf', 'scale=1280:720:flags=lanczos', '-c:v', 'libx264', '-preset', 'slow', '-crf', '27',
    '-tune', 'animation', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '64k', '-movflags', '+faststart', dst], { encoding: 'utf8' });
  if (one.status !== 0) throw new Error('whatsapp encode failed: ' + one.stderr.slice(-1500));
  const size = fs.statSync(dst).size;
  if (size <= 15.5 * 1024 * 1024) return size;
  const kbps = Math.floor((15 * 8192) / duration) - 64;
  const log = dst + '.2pass';
  spawnSync(ffmpeg, ['-y', '-i', src, '-vf', 'scale=1280:720:flags=lanczos', '-c:v', 'libx264', '-preset', 'slow', '-b:v', kbps + 'k', '-pass', '1', '-passlogfile', log, '-an', '-f', 'mp4', 'NUL']);
  const two = spawnSync(ffmpeg, ['-y', '-i', src, '-vf', 'scale=1280:720:flags=lanczos', '-c:v', 'libx264', '-preset', 'slow', '-b:v', kbps + 'k', '-pass', '2', '-passlogfile', log,
    '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '64k', '-movflags', '+faststart', dst], { encoding: 'utf8' });
  for (const f of fs.readdirSync(path.dirname(dst))) if (f.startsWith(path.basename(log))) fs.rmSync(path.join(path.dirname(dst), f));
  if (two.status !== 0) throw new Error('whatsapp 2-pass failed: ' + two.stderr.slice(-1500));
  return fs.statSync(dst).size;
}

// QA: a contact sheet — one frame from the middle of every beat, labelled with its time
export function qaSheets(outDir, video, marks, duration) {
  const dir = path.join(outDir, 'qa'); fs.mkdirSync(dir, { recursive: true });
  const pts = marks.map((m, i) => ({ t: Math.min(duration - 0.1, (m.t + (marks[i + 1]?.t ?? duration)) / 2 + 0.6), label: m.label }));
  pts.forEach((p, i) => {
    spawnSync(ffmpeg, ['-y', '-ss', p.t.toFixed(2), '-i', video, '-frames:v', '1', '-vf', 'scale=960:540', path.join(dir, `q${String(i).padStart(3, '0')}.jpg`)]);
  });
  // sheets of 12 (4×3)
  const files = fs.readdirSync(dir).filter(f => /^q\d+\.jpg$/.test(f)).sort();
  for (let s = 0; s * 12 < files.length; s++) {
    const part = files.slice(s * 12, s * 12 + 12);
    if (part.length === 1) { fs.copyFileSync(path.join(dir, part[0]), path.join(dir, `sheet-${s + 1}.jpg`)); continue; }
    const inputs = part.flatMap(f => ['-i', path.join(dir, f)]);
    const pads = part.map((_, i) => `[${i}:v]scale=640:360[v${i}]`).join(';');
    const lay = part.map((_, i) => `${(i % 4) * 640}_${Math.floor(i / 4) * 360}`).join('|');
    spawnSync(ffmpeg, ['-y', ...inputs, '-filter_complex', `${pads};${part.map((_, i) => `[v${i}]`).join('')}xstack=inputs=${part.length}:layout=${lay}:fill=black`,
      path.join(dir, `sheet-${s + 1}.jpg`)]);
  }
  fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify(pts, null, 1));
  return files.length;
}
