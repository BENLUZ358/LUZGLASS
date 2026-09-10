#!/usr/bin/env node
/**
 * What the customer asks for, and what the system offers.
 *
 * Three things arrive here, and the important part is that they are three
 * DIFFERENT kinds of thing:
 *
 *   floor bracket  — an OFFER. Nothing holds the free end of a fixed pane
 *                    except the wall brackets, and on a wide one some
 *                    customers prefer a floor bracket. The system asks
 *                    once and obeys the answer. It never adds one itself
 *                    and never refuses a wide pane without one.
 *
 *   support bar
 *   black trim     — customer requests with NO rule behind them. They are
 *                    not offered and not questioned; they sit in the
 *                    hardware choice, and the engine only counts them.
 *
 *   seals          — PREPARATION ONLY. Every shower gets a floor wiper and
 *                    a magnet, corner or straight depending on the shower,
 *                    but that rule has not been written yet. So nothing is
 *                    guessed: what is passed explicitly is counted, and
 *                    what is absent produces no line at all.
 *
 * The trap all three share is the same one this project keeps hitting: a
 * screen that decides something the engine should decide, or an engine
 * that invents something the customer never asked for.
 *
 * Run: node scripts/test-extras-offer.js
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

/* ══ the engine ═══════════════════════════════════════════════════════ */
const eng = vm.createContext({ Math, JSON, Object, Array, String, Number, console });
['lg-shapes.js', 'lg-layout.js'].forEach(f =>
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), eng));

const shower = (panels, states, opts) => {
  eng.P = panels; eng.S = states; eng.O = Object.assign({ finish: 'shahor', quality: 'zamak' }, opts || {});
  return vm.runInContext('lgFromPanels(P,S,O)', eng);
};
const qty = (sh, type) => {
  eng.SH = sh;
  const line = vm.runInContext('lgBOM(SH)', eng).find(l => l.type === type);
  return line ? line.qty : 0;
};
/* a lone fixed leaning on one wall: Ben's own rule, two brackets */
const FIXED = [{ type: 'fixed', wallSide: 'right' }];
const W900  = { 0: { w: 900, h: 2000 } };

console.log('');

/* ── the floor bracket is an offer, and the engine keeps out of it ────── */
{
  check('a 900mm fixed gets no floor bracket on its own',
        qty(shower(FIXED, W900), 'bracket-floor'), 0);
  check('and it is still a valid shower — nothing is refused',
        (eng.SH = shower(FIXED, W900), vm.runInContext('lgValidate(SH)', eng)).length, 0);
  check('when the customer accepts, the bracket is counted',
        qty(shower(FIXED, { 0: { w: 900, h: 2000, floorBracket: true } }), 'bracket-floor'), 1);
  check('and the two wall brackets are unaffected either way',
        [qty(shower(FIXED, W900), 'bracket-wall'),
         qty(shower(FIXED, { 0: { w: 900, h: 2000, floorBracket: true } }), 'bracket-wall')],
        [2, 2]);
}

/* ── the two requests: counted, never invented ────────────────────────── */
{
  check('no support bar unless asked for',
        qty(shower(FIXED, W900), 'support-bar'), 0);
  check('no black trim unless asked for',
        qty(shower(FIXED, W900), 'black-trim'), 0);

  const both = shower(FIXED, W900, { supportBar: 1, blackTrim: 1 });
  check('a requested support bar is counted once', qty(both, 'support-bar'), 1);
  check('and a requested black trim once', qty(both, 'black-trim'), 1);

  /* they belong to the assembly, not to a pane: three panes, still one */
  const three = shower(
    [{ type: 'fixed', wallSide: 'right', carriesDoor: true },
     { type: 'door', hingeOnFixed: 'prev', handleSide: 'left' },
     { type: 'fixed', wallSide: 'left' }],
    { 0: { w: 900, h: 2000 }, 1: { w: 800, h: 1985 }, 2: { w: 900, h: 2000 } },
    { supportBar: 1, blackTrim: 1 });
  check('three panes still share one support bar', qty(three, 'support-bar'), 1);
  check('and one black trim', qty(three, 'black-trim'), 1);

  /* a number is taken as a count, so a big shower needs no engine change */
  check('a shower that asked for two gets two',
        qty(shower(FIXED, W900, { supportBar: 2 }), 'support-bar'), 2);
}

/* ── seals: prepared, not guessed ─────────────────────────────────────── */
{
  const bare = shower(FIXED, W900);
  ['seal-floor-wiper', 'seal-magnet-corner', 'seal-magnet-straight'].forEach(t =>
    check(`nothing invents a ${t}`, qty(bare, t), 0));

  const chosen = shower(FIXED, W900, { seals: { floorWiper: 1, magnet: 'corner' } });
  check('an explicit floor wiper is counted', qty(chosen, 'seal-floor-wiper'), 1);
  check('and the corner magnet that was named', qty(chosen, 'seal-magnet-corner'), 1);
  check('but not the straight one it is not', qty(chosen, 'seal-magnet-straight'), 0);

  /* the rule that would pick the magnet does not exist yet — so an
     unspecified magnet must produce NOTHING, not a default. A guessed
     magnet reads as a decision and reaches the picker as one. */
  const half = shower(FIXED, W900, { seals: { floorWiper: 1 } });
  check('a shower with no magnet named gets no magnet',
        [qty(half, 'seal-magnet-corner'), qty(half, 'seal-magnet-straight')], [0, 0]);
  check('and the source says so out loud',
        /החוקיות[^\n]*עוד לא נבנתה/
          .test(fs.readFileSync(path.join(ROOT, 'lg-shapes.js'), 'utf8')), true);
}

/* ══ the screen ═══════════════════════════════════════════════════════ */
/* enough browser for the offer to actually run */
function screen(panels, states, mode) {
  const open = new Set();
  const el = id => ({ id, innerHTML: '', textContent: '',
    classList: { add: c => open.add(id + '.' + c), remove: c => open.delete(id + '.' + c),
                 contains: c => open.has(id + '.' + c), toggle(){} },
    querySelector: () => ({ focus(){} }) });
  const ctx = vm.createContext({ Math, JSON, Object, Array, String, Number, console, Set,
    document: { getElementById: el, querySelector: () => (open.has('_othersheet') ? {} : null) } });
  vm.runInContext(
    'var appMode=' + JSON.stringify(mode || 'shape') + ';' +
    'var PANELS=' + JSON.stringify(panels) + ', STATES=' + JSON.stringify(states) + ';' +
    'function getPanels(){ return PANELS; }' +
    'function getPStates(){ return STATES; }' +
    'function getPS(pfx,i){ return STATES[i]; }' +
    'var DREW=0; function draw(){ DREW++; }' +
    'function renderPanelCtrl(){} function renderShapeUI(){}', ctx);
  /* the constants are statements, not functions */
  vm.runInContext(DEMO.match(/const LG_FLOOR_OFFER_MM = \d+;/)[0], ctx);
  vm.runInContext('const _fbAsked = new Set(); let _fbSeeded = false, _fbTarget = null;', ctx);
  ['_fbKey', '_fbCandidate', 'offerFloorBracket', 'offerAnswer'].forEach(n =>
    vm.runInContext(grab(n), ctx));
  return { run: e => vm.runInContext(e, ctx),
           shown: () => open.has('offerSheet.open'),
           other: on => on ? open.add('_othersheet') : open.delete('_othersheet'),
           dim:   on => on ? open.add('dimEditor.open') : open.delete('dimEditor.open') };
}
/* the first draw seeds, so tests that want the offer draw once first */
const armed = (panels, states, mode) => {
  const s = screen(panels, states, mode);
  s.run('offerFloorBracket()');           // seeding pass
  return s;
};

/* ── the threshold ────────────────────────────────────────────────────── */
{
  check('the offer threshold is 80cm', Number(DEMO.match(/LG_FLOOR_OFFER_MM = (\d+)/)[1]), 800);

  const at = armed([{ type: 'fixed', id: 'a' }], { 0: { w: 500 } });
  at.run('STATES[0].w = 800');
  at.run('offerFloorBracket()');
  check('exactly 80cm is not yet wide', at.shown(), false);

  at.run('STATES[0].w = 801');
  at.run('offerFloorBracket()');
  check('one millimetre over is', at.shown(), true);
}

/* ── who the offer is about ───────────────────────────────────────────── */
{
  const only = (type) => {
    const s = armed([{ type, id: 'x' }], { 0: { w: 500 } });
    s.run('STATES[0].w = 900'); s.run('offerFloorBracket()');
    return s.shown();
  };
  check('a wide fixed is offered one', only('fixed'), true);
  check('a door is not — it hangs on its hinges', only('door'), false);
  check('nor a mirror', only('mirror'), false);
  check('nor a free shape', only('shape'), false);

  const has = armed([{ type: 'fixed', id: 'x' }], { 0: { w: 500, floorBracket: true } });
  has.run('STATES[0].w = 900'); has.run('offerFloorBracket()');
  check('and not a pane that already has one', has.shown(), false);
}

/* ── the answer is obeyed, and asked once ─────────────────────────────── */
{
  const yes = armed([{ type: 'fixed', id: 'a' }], { 0: { w: 500 } });
  yes.run('STATES[0].w = 900'); yes.run('offerFloorBracket()');
  check('the question is up', yes.shown(), true);
  yes.run('offerAnswer(true)');
  check('yes adds the bracket', yes.run('STATES[0].floorBracket'), true);
  check('the sheet closes', yes.shown(), false);
  check('and the drawing is refreshed', yes.run('DREW') > 0, true);
  yes.run('offerFloorBracket()');
  check('and it is not asked again', yes.shown(), false);

  const no = armed([{ type: 'fixed', id: 'a' }], { 0: { w: 500 } });
  no.run('STATES[0].w = 900'); no.run('offerFloorBracket()');
  no.run('offerAnswer(false)');
  check('no leaves the pane alone', no.run('STATES[0].floorBracket'), undefined);
  check('and does not redraw for nothing', no.run('DREW'), 0);
  no.run('offerFloorBracket()');
  check('and it is never asked again either', no.shown(), false);

  /* the nag this guards against: re-asking every redraw until the
     customer says yes just to stop it — which is not consent */
  const nag = armed([{ type: 'fixed', id: 'a' }], { 0: { w: 500 } });
  nag.run('STATES[0].w = 900');
  nag.run('offerFloorBracket()'); nag.run('offerAnswer(false)');
  for (let i = 0; i < 20; i++) nag.run('offerFloorBracket()');
  check('twenty redraws later it is still silent', nag.shown(), false);
}

/* ── one question at a time, and never over an open window ────────────── */
{
  const busy = armed([{ type: 'fixed', id: 'a' }], { 0: { w: 500 } });
  busy.run('STATES[0].w = 900');

  busy.other(true);
  busy.run('offerFloorBracket()');
  check('it does not jump over an open sheet', busy.shown(), false);
  busy.other(false);
  busy.run('offerFloorBracket()');
  check('and asks once that sheet is gone', busy.shown(), true);
  busy.run('offerAnswer(false)');

  const typing = armed([{ type: 'fixed', id: 'b' }], { 0: { w: 500 } });
  typing.run('STATES[0].w = 900');
  typing.dim(true);
  typing.run('offerFloorBracket()');
  check('nor over someone typing a dimension', typing.shown(), false);
  /* and being skipped must not count as having been asked — otherwise
     the offer is lost for good the moment it collides with a window */
  typing.dim(false);
  typing.run('offerFloorBracket()');
  check('the skipped question comes back afterwards', typing.shown(), true);
}

/* ── a saved sketch does not open with a question ─────────────────────── */
{
  const loaded = screen([{ type: 'fixed', id: 'a' }], { 0: { w: 1200 } });
  loaded.run('offerFloorBracket()');
  check('opening a saved wide sketch asks nothing', loaded.shown(), false);
  loaded.run('offerFloorBracket()');
  check('and still nothing on the next draw', loaded.shown(), false);

  /* it is suppressed, not disabled: a pane the customer widens now still asks */
  loaded.run('PANELS.push({type:"fixed",id:"b"}); STATES[1]={w:900};');
  loaded.run('offerFloorBracket()');
  check('but a pane widened now does ask', loaded.shown(), true);
}

/* ── the wiring on the page ───────────────────────────────────────────── */
{
  const has = s => DEMO.indexOf(s) > -1;

  check('the offer hangs off one place only — the drawing',
        (DEMO.match(/offerFloorBracket\(\)/g) || []).length >= 2, true);
  check('and draw() is that place',
        /function draw\(\)\{\s*_drawFrame\(\);\s*offerFloorBracket\(\);\s*\}/.test(DEMO), true);

  check('the two requests reach the engine through the one shower builder',
        /_lgShowerOf[\s\S]{0,700}supportBar: selSupportBar[\s\S]{0,120}blackTrim:  selBlackTrim/.test(DEMO), true);
  check('there is no second place that builds a shower',
        (DEMO.match(/lgFromPanels\(/g) || []).length, 1);

  check('the support bar is offered in the hardware choice', has('setExtra(\'supportBar\''), true);
  check('and the black trim beside it', has('setExtra(\'blackTrim\''), true);
  check('neither is a question — no confirm, no prompt',
        /function setExtra[\s\S]{0,400}(confirm|prompt)\(/.test(DEMO), false);
  check('the boxes show the state rather than being it',
        /function renderExtras[\s\S]{0,240}checked=selSupportBar/.test(DEMO), true);

  ['support-bar', 'black-trim', 'seal-floor-wiper', 'seal-magnet-corner', 'seal-magnet-straight']
    .forEach(t => check(`  ${t} has a Hebrew name for the picking list`,
                        new RegExp("'" + t + "':'[\\u0590-\\u05FF]").test(DEMO), true));

  /* a choice that shows in the picking list and vanishes on save is worse
     than no choice: the customer is sure they ordered it */
  check('the order carries the two requests',
        /supportBar:selSupportBar, blackTrim:selBlackTrim/.test(DEMO), true);
  const DB = fs.readFileSync(path.join(ROOT, 'firebase-db.js'), 'utf8');
  check('and the normaliser is a whitelist that names them',
        /supportBar:\s+o\.supportBar[\s\S]{0,80}blackTrim:\s+o\.blackTrim/.test(DB), true);

  /* the sheets must sit above the full-screen layers, or advanced edit —
     whose whole purpose is to open one — hides its own window */
  const z = re => Number((DEMO.match(re) || [])[1]);
  const full = Math.max(z(/body\.sketch-full \.canvas-wrap\{[^}]*z-index:(\d+)/),
                        z(/body\.sketch-full #fullBar\{[^}]*z-index:(\d+)/));
  check('a sheet outranks everything full screen puts on top',
        z(/\.sheet\{[^}]*z-index:(\d+)/) > full, true);
  check('and so does its backdrop',
        z(/\.sheet-back\{[^}]*z-index:(\d+)/) > full, true);
}

if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
console.log('\nAll extras and offer checks passed.');
