#!/usr/bin/env node
/**
 * The builder draws each glass the way it is cut (Task 5, 16/11).
 *
 * Every shower glass that lgCuts gives a template to is painted with the
 * real cuts — the hinge window contour, the angle (closed Ø20 / open
 * notch), the harmonica pairs, the handle — mapped mm → px at the scale
 * the engine used for that glass. The old symbolic markers are dropped on
 * those glasses only; a mirror, or a glass with no template, keeps the
 * drawing it had. The panel sheet of a fixed glass has a "זווית פתוחה"
 * toggle that writes bracketType and redraws; 'normal' is the default.
 *
 * Runs the real drawFromEngine / engPaint / renderShapeSheet code from
 * sketch-demo.html in a vm against a canvas stub that logs every call.
 *
 * Run: node scripts/test-exact-glass-ui.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const DEMO = fs.readFileSync(path.join(ROOT, 'sketch-demo.html'), 'utf8');

let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));

const grab = n => {
  const i = DEMO.indexOf('function ' + n + '(');
  if (i < 0) throw new Error('missing ' + n);
  let d = 0, j = i;
  for (; j < DEMO.length; j++) {
    if (DEMO[j] === '{') d++; else if (DEMO[j] === '}') { d--; if (!d) break; }
  }
  return DEMO.slice(i, j + 1);
};
const grabConst = n => {
  const m = DEMO.match(new RegExp('const ' + n + '\\s*=\\s*\\{[\\s\\S]*?\\};'));
  if (!m) throw new Error('missing const ' + n);
  return m[0];
};

/* a canvas that remembers every call */
const logCx = () => {
  const log = [], c = { log };
  ['save', 'restore', 'beginPath', 'moveTo', 'lineTo', 'closePath', 'stroke', 'fill', 'arc',
   'rect', 'roundRect', 'translate', 'rotate', 'scale', 'setTransform', 'clearRect', 'fillRect',
   'strokeRect', 'fillText', 'setLineDash'].forEach(k => { c[k] = (...a) => { log.push([k].concat(a)); }; });
  c.createLinearGradient = () => ({ addColorStop() {} });
  c.measureText = t => ({ width: String(t).length * 6 });
  return c;
};

function sandbox() {
  const ctx = vm.createContext({ Math, JSON, Object, Array, String, Number, console, Set });
  ['lg-shapes.js', 'lg-layout.js', 'lg-cuts.js'].forEach(f =>
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx));
  ctx.cx = logCx();
  ctx.document = { body: { classList: { contains: () => false } } };
  vm.runInContext([
    'var dimHits=[], lastL=null, selQ="zamak", selMM=8, selG=null, selWork="", selSupportBar=false, selBlackTrim=false;',
    'var DOOR_H_MM=1985, HANDLE_EDGE_CM=6, TOWEL_SPACING_CM=40;',
    'function _availCanvasBox(){ return {w:0,h:0}; }',
    'function setupCanvas(){} function drawGrid(){} function paintPick(){} function drawTitleBar(){} function updateSpecs(){}',
    grabConst('ENG_FIELD'), grabConst('KIND_HE'),
    (DEMO.match(/function kindName\(k\)\{[^}]*\}/) || [''])[0],
    DEMO.match(/const LG_HINGE_COLOR=\{[^}]*\};/)[0],
    DEMO.match(/const LG_HINGE_HE\s*=\{[^}]*\};/)[0],
    DEMO.match(/const LG_LEGEND_LH=\d+;/)[0], DEMO.match(/const ENG_CUT_MIN_R=[\d.]+;/)[0],
    grabConst('ENG_CUT_COLOR'),
    ['mkPS', '_lgShowerOf', 'engDim', 'engHardware', 'engHingeLegend', 'engTag', 'engLegendRows',
     'engLegendHeight', 'engLegend', 'engCutsOf', '_engCutReplaces', '_engCutPts', 'engPaintCuts',
     'engPaint', 'drawFromEngine'].map(grab).join('\n'),
  ].join('\n'), ctx);
  return ctx;
}

/* paint a shower through the real drawFromEngine; returns {L, cuts, log} */
function paint(P, S, cW) {
  const ctx = sandbox();
  ctx.P = P; ctx.S = S;
  vm.runInContext('drawFromEngine(P,S,1,' + (cW || 1200) + ',"combo")', ctx);
  const L = ctx.lastL;
  const cuts = vm.runInContext('lgCuts(_lgShowerOf(P,S))', ctx);
  return { L, cuts, log: ctx.cx.log, ctx };
}

/* the paths drawn: each beginPath … stroke, as points + arcs */
function paths(log) {
  const out = []; let cur = null;
  for (const e of log) {
    if (e[0] === 'beginPath') cur = { pts: [], arcs: [], rr: [], closed: false };
    else if (!cur) continue;
    else if (e[0] === 'moveTo' || e[0] === 'lineTo') cur.pts.push([e[1], e[2]]);
    else if (e[0] === 'arc') cur.arcs.push(e.slice(1));
    else if (e[0] === 'roundRect' || e[0] === 'rect') cur.rr.push(e.slice(1));
    else if (e[0] === 'closePath') cur.closed = true;
    else if (e[0] === 'stroke' || e[0] === 'fill') {
      if (e[0] === 'stroke') cur.stroked = true;
      if (out[out.length - 1] !== cur) out.push(cur);
    }
  }
  return out;
}
const near = (a, b, tol) => Math.abs(a - b) <= (tol || 0.05);
const mapper = (L, i) => {
  const s = L.shapes[i], sc = L.scale;
  return (x, y) => [s.x + (x - 1) * sc, s.y + s.h - (y - 1) * sc];
};

console.log('');

/* ── defaults ───────────────────────────────────────────────────────────── */
{
  const ctx = sandbox();
  check('mkPS: bracketType defaults to normal', vm.runInContext('mkPS({type:"fixed"}).bracketType', ctx), 'normal');
  check('LG_BUILDER_VERSION is 2', vm.runInContext('LG_BUILDER_VERSION', ctx), 2);
  check('sketch-demo loads lg-cuts.js after lg-layout.js',
        DEMO.indexOf('<script src="lg-cuts.js"></script>') > DEMO.indexOf('<script src="lg-layout.js"></script>') &&
        DEMO.indexOf('<script src="lg-layout.js"></script>') > -1, true);
}

/* ── fixed + door: the real cuts at the scale of each glass ─────────────── */
const FD_P = [{ type: 'fixed', wallSide: 'left', carriesDoor: true }, { type: 'door', hingeSide: 'left', hingeOnFixed: 'prev' }];
function cutsDrawn(P, S, label) {
  const { L, cuts, log } = paint(P, S);
  const ps = paths(log), sc = L.scale;
  cuts.forEach(g => {
    if (!g.key) return;
    const M = mapper(L, g.idx);
    g.cuts.forEach((c, k) => {
      const name = label + ': glass ' + g.idx + ' ' + c.kind + ' #' + k;
      if (c.dia) {
        const p = M(c.x, c.y);
        check(name + ' — circle at its centre, radius dia/2 at the glass scale',
              ps.some(q => q.arcs.some(a => near(a[0], p[0]) && near(a[1], p[1]) && near(a[2], c.dia / 2 * sc))), true);
      } else {
        //  every segment endpoint of the contour lands on the drawn path
        const ends = c.contour.filter(s => s[0] === 0).map(s => [M(s[1], s[2]), M(s[3], s[4])]).flat();
        check(name + ' — the contour is drawn (every line end on the path)',
              ps.some(q => ends.every(e => q.pts.some(p => near(p[0], e[0], 0.1) && near(p[1], e[1], 0.1)))), true);
      }
    });
  });
  return { L, cuts, ps, log };
}
{
  const { L, cuts, ps } = cutsDrawn(FD_P, { 0: { w: 500, h: 2000 }, 1: { w: 700, h: 1985 } }, 'fixed+door normal');
  check('fixed+door normal: templates', cuts.map(g => g.key), ['fixed-closed-door', 'door']);
  //  the hinge window: 39×80 mm (+ closure) at the scale of the glass
  const sc = L.scale, hinge = cuts[1].cuts.find(c => c.kind === 'hinge');
  const M = mapper(L, 1), c0 = M(hinge.x, hinge.y);
  const win = ps.find(q => q.closed && q.pts.length > 10 &&
    q.pts.every(p => Math.abs(p[0] - c0[0]) <= 20 * sc && Math.abs(p[1] - c0[1]) <= 41 * sc));
  check('the hinge window is a closed path of the real size', !!win, true);
  if (win) {
    const xs = win.pts.map(p => p[0]), ys = win.pts.map(p => p[1]);
    check('39 mm wide', near(Math.max(...xs) - Math.min(...xs), 39 * sc, 0.6), true);
    check('80 mm tall', near(Math.max(...ys) - Math.min(...ys), 80 * sc, 0.6), true);
  }
  //  the old symbols are gone from glasses with a template
  check('no old 24px hinge rectangle', ps.some(q => q.rr.some(r => near(r[2], 24))), false);
  check('closed angle cuts only (no open notch)', cuts[0].cuts.map(c => c.kind).sort(),
        ['closed', 'closed', 'hinge', 'hinge']);
  //  dimension lines still drawn
  check('dimension targets still recorded', paint(FD_P, { 0: { w: 500, h: 2000 }, 1: { w: 700, h: 1985 } }).ctx.dimHits.length > 0, true);
}
{
  const { cuts, ps, L } = cutsDrawn(FD_P, { 0: { w: 500, h: 2000, bracketType: 'open' }, 1: { w: 700, h: 1985 } }, 'fixed+door open');
  check('fixed+door open: templates', cuts.map(g => g.key), ['fixed-open-door', 'door']);
  //  the open notch is not closed along the glass edge
  const M = mapper(L, 0), o = cuts[0].cuts.find(c => c.kind === 'open');
  const s0 = o.contour[0], a = M(s0[1], s0[2]);
  const notch = ps.find(q => q.stroked && q.pts.some(p => near(p[0], a[0], 0.1) && near(p[1], a[1], 0.1)) && q.arcs.length === 0 && q.pts.length > 3);
  check('the open notch is stroked open to the edge', !!notch && !notch.closed, true);
}

/* ── door + harmonica: the cut positions (27 mm), not the old 36 ────────── */
const DH_P = [{ type: 'door', hingeSide: 'left', harmonicaSide: 'right' }, { type: 'door', hingeSide: 'left', harmonicaSide: 'left' }];
{
  const { cuts, ps, L } = cutsDrawn(DH_P, { 0: { w: 700, h: 1985 }, 1: { w: 400, h: 1985 } }, 'door+harmonica');
  check('door+harmonica: both glasses have a template', cuts.every(g => !!g.key), true);
  const sc = L.scale, s0 = L.shapes[0];
  //  no circle at the old 36 mm inset from the seam
  const harm = L.hardware.find(h => h.variant === 'harmonica');
  const old36 = ps.some(q => q.arcs.some(a => harm && near(Math.abs(a[0] - harm.x), 36 * sc, 0.2)));
  check('no harmonica hole at the old 36 mm', old36, false);
  check('harmonica holes drawn 27 mm from the seam (cut size −1)',
        ps.some(q => q.arcs.some(a => harm && near(Math.abs(a[0] - harm.x), 26 * sc, 0.2))), true);
}

/* ── a mirror keeps the old drawing exactly ─────────────────────────────── */
{
  const P = [{ type: 'mirror' }], S = { 0: { w: 600, h: 800 } };
  const a = paint(P, S).log;
  const ctx = sandbox(); ctx.P = P; ctx.S = S;
  vm.runInContext('var L=lgLayout(_lgShowerOf(P,S),{canvasW:1200}); engPaint(L,"combo",0,null);', ctx);
  check('mirror: drawing identical to the drawing without cuts', JSON.stringify(a), JSON.stringify(ctx.cx.log));
}
/* and a shower glass with no template keeps its markers */
{
  const P = [{ type: 'fixed', wallSide: 'both' }], S = { 0: { w: 600, h: 2000 } };
  const r = paint(P, S);
  check('lone fixed with two wall edges: no template', r.cuts[0].key, null);
  const ctx = sandbox(); ctx.P = P; ctx.S = S;
  vm.runInContext('var L=lgLayout(_lgShowerOf(P,S),{canvasW:1200}); engPaint(L,"combo",0,null);', ctx);
  check('…and its drawing is unchanged', JSON.stringify(r.log), JSON.stringify(ctx.cx.log));
}

/* ── the panel sheet: "זווית פתוחה" ─────────────────────────────────────── */
function sheet(kind, ps) {
  const ctx = vm.createContext({ Math, JSON, Object, Array, String, Number, console });
  const els = {};
  ctx.document = { getElementById: id => (els[id] || (els[id] = { innerHTML: '' })) };
  vm.runInContext([
    'var sheetPfx="combo", PS=' + JSON.stringify(ps) + ', DRAWN=0, NOTCH_DEF={notchW:200,notchH:500}, HANDLE_EDGE_CM=6, TOWEL_SPACING_CM=40;',
    'function _sheetIdx(){ return 0; }',
    'function _sheetMeta(){ return {kind:' + JSON.stringify(kind) + ', label:"x"}; }',
    'function getPS(){ return PS; }',
    'function _sheetResolved(){ return {}; } function _notchAskHtml(){ return ""; }',
    'function _shHoles(){ return ""; } function _shEsc(s){ return String(s); }',
    'function _dimToUnit(v){ return v; } function _dimUnitLabel(){ return "מ\\"מ"; }',
    'function _harmonicaHeightSync(){}',
    'function renderShapeUI(){} function draw(){ DRAWN++; }',
    grabConst('KIND_HE'), (DEMO.match(/function kindName\(k\)\{[^}]*\}/) || [''])[0],
    ['isFreeGlass', '_shSeg', '_shNum', 'sheetSet', 'renderShapeSheet'].map(grab).join('\n'),
  ].join('\n'), ctx);
  vm.runInContext('renderShapeSheet()', ctx);
  return { ctx, html: els.shapeSheetBody.innerHTML };
}
const toggleOf = html => {
  const m = html.match(/<label class="sh-tog"><input type="checkbox" ([^>]*)>זווית פתוחה<\/label>/);
  return m && { checked: /^checked\b/.test(m[1]), onchange: (m[1].match(/onchange="([^"]*)"/) || [])[1] };
};
{
  const f = sheet('fixed', { w: 500, h: 2000, bracketType: 'normal' });
  const t = toggleOf(f.html);
  check('fixed sheet has a "זווית פתוחה" toggle', !!t && !!t.onchange, true);
  check('…off by default', t && t.checked, false);
  if (t) {
    vm.runInContext('var T={checked:true}; (function(){' + t.onchange.replace(/this\./g, 'T.') + '})()', f.ctx);
    check('ticking it writes bracketType open', f.ctx.PS.bracketType, 'open');
    check('…and redraws', f.ctx.DRAWN > 0, true);
    check('the repainted sheet shows it ticked', toggleOf(f.ctx.document.getElementById('shapeSheetBody').innerHTML).checked, true);
    vm.runInContext('var T={checked:false}; (function(){' + t.onchange.replace(/this\./g, 'T.') + '})()', f.ctx);
    check('un-ticking writes normal back', f.ctx.PS.bracketType, 'normal');
  }
  const old = sheet('fixed', { w: 500, h: 2000 });
  check('an old sketch with no value shows it off', toggleOf(old.html) && toggleOf(old.html).checked, false);
  check('door sheet has no "זווית פתוחה"', /זווית פתוחה/.test(sheet('door', { w: 800, h: 1985 }).html), false);
  check('mirror sheet has no "זווית פתוחה"', /זווית פתוחה/.test(sheet('mirror', { w: 600, h: 800 }).html), false);
}

/* ── the open choice reaches the drawing ────────────────────────────────── */
{
  const n = paint(FD_P, { 0: { w: 500, h: 2000, bracketType: 'normal' }, 1: { w: 700, h: 1985 } });
  const o = paint(FD_P, { 0: { w: 500, h: 2000, bracketType: 'open' }, 1: { w: 700, h: 1985 } });
  check('normal and open draw differently', JSON.stringify(n.log) !== JSON.stringify(o.log), true);
}

/* ── the corner (folded) view paints the same cuts through its transform ── */
{
  const ctx = sandbox();
  vm.runInContext(grab('_lgFoldedDimPush') + '\n' + grab('engPaintFolded'), ctx);
  ctx.P = FD_P; ctx.S = { 0: { w: 500, h: 2000 }, 1: { w: 700, h: 1985 } };
  vm.runInContext('var SH=_lgShowerOf(P,S), L=lgLayout(SH,{canvasW:1200}), C=engCutsOf(SH);' +
                  'engPaintFolded(L,function(x,y){return [x+5,y+7];},"combo",false,L.scale,null,C);', ctx);
  const L = vm.runInContext('L', ctx), C = vm.runInContext('C', ctx), ps = paths(ctx.cx.log);
  const c = C[0].cuts.find(q => q.kind === 'closed'), p = mapper(L, 0)(c.x, c.y);
  check('folded view: closed angle drawn through the transform',
        ps.some(q => q.arcs.some(a => near(a[0], p[0] + 5) && near(a[1], p[1] + 7) && near(a[2], 10 * L.scale))), true);
  check('folded view: no old hinge rectangle', ps.some(q => q.rr.some(r => near(r[2], 24))), false);
  ctx.cx.log.length = 0;
  vm.runInContext('engPaintFolded(L,function(x,y){return [x,y];},"combo",false,L.scale,null);', ctx);
  check('folded view without cuts: old markers as before', paths(ctx.cx.log).some(q => q.rr.some(r => near(r[2], 24))), true);
}

/* ── issues show in the warnings strip ──────────────────────────────────── */
{
  const warn = (P, S) => {
    const ctx = sandbox(), el = { hidden: true, innerHTML: '' };
    ctx.document.getElementById = id => (id === 'geoWarn' ? el : null);
    vm.runInContext('function _shEsc(s){ return String(s); }\n' + grab('renderGeoWarn'), ctx);
    ctx.P = P; ctx.S = S;
    vm.runInContext('renderGeoWarn(P,S)', ctx);
    return el;
  };
  const lone = warn([{ type: 'fixed', wallSide: 'both' }], { 0: { w: 600, h: 2000 } });
  check('a glass with no template is named in the warnings strip',
        !lone.hidden && lone.innerHTML.includes('אין תבנית חיתוך לזכוכית הזו'), true);
  const ok = warn(FD_P, { 0: { w: 500, h: 2000 }, 1: { w: 700, h: 1985 } });
  check('fixed+door: no cut warning', ok.hidden, true);
  const inset = warn(FD_P, { 0: { w: 500, h: 2000, bracketType: 'open', bracketInset: 40 }, 1: { w: 700, h: 1985 } });
  check('open angle with a typed distance: warned, with the glass name',
        inset.innerHTML.includes('זכוכית 1: זווית פתוחה עם מרחק מהפאה שהוקלד'), true);
}

console.log('');
if (failed) { console.error(failed + ' failed'); process.exit(1); }
console.log('all passed');
