// node tools/training-video/render.js 06            — record + compose + WhatsApp copy + QA sheets for video 06
// node tools/training-video/render.js 06 --compose  — compose only (re-use the recording)
// Needs the static server on :8899 (.claude/launch.json "static-site").
// Output: %LOCALAPPDATA%/lg-training-video/out/<id>/ (work files) and docs/training-videos/output/ (the deliverables).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { record } from './lib/recorder.js';
import { compose, whatsapp, qaSheets } from './lib/compose.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(ROOT, '../..');
const DELIV = path.join(REPO, 'docs', 'training-videos', 'output');
const [id, ...flags] = process.argv.slice(2);
const file = fs.readdirSync(path.join(ROOT, 'videos')).find(f => f.startsWith(id + '-') && f.endsWith('.js'));
if (!file) { console.error('no video ' + id); process.exit(1); }
const video = await import('./videos/' + file);
// work files live outside OneDrive (it locks thousands of fresh PNGs while syncing them)
const OUT_ROOT = path.join(process.env.LOCALAPPDATA || ROOT, 'lg-training-video', 'out');
const out = path.join(OUT_ROOT, id);
const t0 = Date.now();

if (!flags.includes('--compose')) {
  console.log(`[${id}] recording…`);
  const r = await record(video, out);
  console.log(`[${id}] recorded ${r.beats} beats, ${r.stills} stills`);
  if (r.pageErrors.length) console.log(`[${id}] page errors:\n  ` + r.pageErrors.join('\n  '));
}
if (flags.includes('--record')) process.exit(0);
console.log(`[${id}] composing…`);
const c = await compose(out);
console.log(`[${id}] ${c.duration.toFixed(1)} s, ${c.frames} frames (${c.drawn} drawn)`);
fs.mkdirSync(DELIV, { recursive: true });
fs.mkdirSync(path.join(DELIV, 'whatsapp'), { recursive: true });
const name = video.meta.file;
fs.copyFileSync(c.file, path.join(DELIV, name + '.mp4'));
const wa = whatsapp(c.file, path.join(DELIV, 'whatsapp', name + ' (וואטסאפ).mp4'), c.duration);
const tl = JSON.parse(fs.readFileSync(path.join(out, 'timeline.json'), 'utf8'));
const q = qaSheets(out, c.file, tl.marks, c.duration);
console.log(`[${id}] done in ${((Date.now() - t0) / 60000).toFixed(1)} min · ${(fs.statSync(c.file).size / 1048576).toFixed(1)} MB · WhatsApp ${(wa / 1048576).toFixed(1)} MB · ${q} QA frames`);
