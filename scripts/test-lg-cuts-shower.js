#!/usr/bin/env node
/**
 * lg-cuts — מהמקלחון של המנוע לחיתוכים לכל זכוכית (lgTemplateOf / lgCuts).
 * המקלחונים נבנים עם lgFromPanels, כמו במסך.
 * Run:  node scripts/test-lg-cuts-shower.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.join(__dirname, '..');
const { lgCuts, lgTemplateOf } = require(path.join(ROOT, 'lg-cuts.js'));

let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));
const near = (a, b, t = 0.5) => Math.abs(a - b) <= t;

//  המנוע במקום נפרד — רק כדי לבנות מקלחונים ולמדוד גבהים מוחלטים לבדיקה
const eng = vm.createContext({ Math, JSON, Object, Array, String, Number, console });
['lg-shapes.js', 'lg-layout.js'].forEach(f => vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), eng));
const shower = (P, S) => { eng.P = P; eng.S = S; return vm.runInContext('lgFromPanels(P,S,{finish:"shahor",quality:"zamak"})', eng); };
//  כמה מ"מ תחתית הזכוכית מעל הרצפה (דלת תלויה 15 מעל)
const lifts = sh => { eng.SH = sh; const L = vm.runInContext('lgLayout(SH,{canvasW:1000})', eng);
  const floor = Math.max(...L.shapes.map(s => s.y + s.h)); return L.shapes.map(s => (floor - s.y - s.h) / L.scale); };
const of = (g, k) => g.cuts.filter(c => c.kind === k).sort((a, b) => a.y - b.y);

// ── קבוע + דלת (קבוע בשמאל, על הקיר; הדלת תלויה עליו) ───────────────
const FD_P = [{ type: 'fixed', wallSide: 'left', carriesDoor: true }, { type: 'door', hingeSide: 'left', hingeOnFixed: 'prev' }];
const FD_S = { 0: { w: 500, h: 2000 }, 1: { w: 700, h: 1985 } };
{
  const sh = shower(FD_P, FD_S);
  const G = lgCuts(sh);
  check('fixed+door: keys', G.map(g => g.key), ['fixed-closed-door', 'door']);
  check('fixed+door: lgTemplateOf', [lgTemplateOf(sh, 0), lgTemplateOf(sh, 1)], ['fixed-closed-door', 'door']);
  check('fixed+door: cut size = sketch + 2', G.map(g => [g.w, g.h]), [[502, 2002], [702, 1987]]);
  check('fixed+door: outline = cut box', G.map(g => g.outline), [[[0, 0], [502, 0], [502, 2002], [0, 2002]], [[0, 0], [702, 0], [702, 1987], [0, 1987]]]);
  check('fixed+door: idx', G.map(g => g.idx), [0, 1]);
  check('fixed+door: no issues', G.map(g => g.issues), [[], []]);
  //  bracketType חסר → זווית רגילה (סגורה, Ø20), בצלע הקיר (שמאל), 201 מכל קצה
  const cl = of(G[0], 'closed');
  check('fixed: bracketType missing → closed, wall edge', cl.map(c => [c.x, c.y]), [[26, 201], [26, 1801]]);
  check('fixed: no open cuts', of(G[0], 'open').length, 0);
  //  חלונות הציר בקבוע — בצלע של הדלת, ובגובה של צירי הדלת (הדלת 15 מעל הרצפה)
  const fh = of(G[0], 'hinge'), dh = of(G[1], 'hinge');
  check('fixed: hinge windows on the door edge', fh.map(c => c.x), [472.5, 472.5]);
  check('door: hinge windows on the fixed edge', dh.map(c => c.x), [29.5, 29.5]);
  const lf = lifts(sh);
  check('fixed hinge centres = door hinge centres in absolute height (±0.5)',
    fh.map((c, i) => near(c.y + lf[0], dh[i].y + lf[1])), [true, true]);
  check('fixed: bottom window 176 from its end, top 161 (real files)', [fh[0].y - 40, G[0].h - fh[1].y - 40], [176, 161]);
  check('door: windows at template 161', [dh[0].y - 40, G[1].h - dh[1].y - 40], [161, 161]);
  const hd = of(G[1], 'handle');
  check('door: knob opposite the hinges, 61 from the edge, at half the cut height', hd.map(c => [c.x, c.y, c.dia]), [[641, 993.5, 12]]);
}
// ‏bracketType 'open' → שקע פתוח
{
  const sh = shower(FD_P, FD_S);
  sh.shapes[0].bracketType = 'open';
  const G = lgCuts(sh);
  check('open: key', G[0].key, 'fixed-open-door');
  check('open: open cuts, no closed', [of(G[0], 'open').map(c => [c.x, c.y]), of(G[0], 'closed').length], [[[26, 201], [26, 1801]], 0]);
  sh.shapes[0].bracketType = 'normal';
  check('normal → closed', lgCuts(sh)[0].key, 'fixed-closed-door');
}
// ‏bracketType מגיע מהמסך (מצב הלוח) דרך lgFromPanels
{
  const G = lgCuts(shower(FD_P, { 0: { w: 500, h: 2000, bracketType: 'open' }, 1: { w: 700, h: 1985 } }));
  check('panel state bracketType open → lgFromPanels → open cuts', [G[0].key, of(G[0], 'open').length, of(G[0], 'closed').length], ['fixed-open-door', 2, 0]);
  const N = lgCuts(shower(FD_P, { 0: { w: 500, h: 2000, bracketType: 'normal' }, 1: { w: 700, h: 1985 } }));
  check('panel state bracketType normal → closed', [N[0].key, of(N[0], 'closed').length], ['fixed-closed-door', 2]);
}
// ‏ידית בדיוק בחצי גובה החיתוך (נתוני המפעל) — בלי תקרת המטר של המנוע; מרחק שהוזן ביד גובר
{
  const P2 = (d) => lgCuts(shower(FD_P, { 0: { w: 500, h: 2215 }, 1: Object.assign({ w: 700, h: 2200 }, d) }))[1];
  check('2200-high door: knob at (2200+2)/2', of(P2({}), 'handle').map(c => c.y), [1101]);
  check('typed handleDist 1200 → engine height + 1', of(P2({ handleDist: 1200 }), 'handle').map(c => c.y), [1201]);
}
// ‏קבוע לבד בין שני קירות → זוויות בשני הצדדים, אין תבנית — חסום עם הסבר
{
  const sh = shower([{ type: 'fixed', wallSide: 'both' }], { 0: { w: 800, h: 2000 } });
  const g = lgCuts(sh)[0];
  check('fixed between two walls: no template, an issue', [g.key, g.issues.length > 0], [null, true]);
}
// ‏ידית "בלי" → בלי חור ידית; ציר שהוזן ביד עובר גם לקבוע
{
  const S = { 0: { w: 500, h: 2000 }, 1: { w: 700, h: 1985, handleType: 'none', hingeBot: 250 } };
  const G = lgCuts(shower(FD_P, S));
  check('handleType none → no handle cut', of(G[1], 'handle').length, 0);
  check('hingeBot override → door window centre 251, fixed 266', [of(G[1], 'hinge')[0].y, of(G[0], 'hinge')[0].y], [251, 266]);
}
// ‏ידית ורטיקל = זוג חורים זה מעל זה (תבנית towel); מגבת = זוג באותו גובה
{
  const v = lgCuts(shower(FD_P, { 0: { w: 500, h: 2000 }, 1: { w: 700, h: 1985, handleType: 'vertical', towelSpacing: 30 } }))[1];
  check('vertical → two holes, same x, 300 apart', of(v, 'handle').map(c => [c.x, c.y]), [[641, 843.5], [641, 1143.5]]);
  const t = lgCuts(shower(FD_P, { 0: { w: 500, h: 2000 }, 1: { w: 700, h: 1985, handleType: 'towel', towelSpacing: 30 } }))[1];
  check('towel → two holes, same height, 300 apart inward', of(t, 'handle').map(c => [c.x, c.y]).sort((a, b) => a[0] - b[0]), [[341, 993.5], [641, 993.5]]);
  const c = lgCuts(shower(FD_P, { 0: { w: 500, h: 2000 }, 1: { w: 700, h: 1985, handleType: 'towel-center' } }))[1];
  check('towel-center → one hole 61 from each edge', of(c, 'handle').map(c => [c.x, c.y]).sort((a, b) => a[0] - b[0]), [[61, 993.5], [641, 993.5]]);
}
// ‏דלת צרה של 200 עם מגבת של 55 ס"מ — החור השני מחוץ לזכוכית
{
  const g = lgCuts(shower(FD_P, { 0: { w: 500, h: 2000 }, 1: { w: 200, h: 1985, handleType: 'towel' } }))[1];
  check('200-wide door: an issue (cut outside the glass)', g.issues.includes('חיתוך יוצא מהזכוכית'), true);
}

// ── מראה: לא זכוכית מקלחון — null, קו מתאר בלבד ───────────────────────
{
  const sh = shower([{ type: 'mirror' }], { 0: { w: 600, h: 800 } });
  check('mirror: lgTemplateOf null', lgTemplateOf(sh, 0), null);
  const g = lgCuts(sh)[0];
  check('mirror: key null, outline, no cuts, no issues', [g.key, g.w, g.h, g.cuts.length, g.issues], [null, 602, 802, 0, []]);
}

// ── דלת + כנף הרמוניקה (הדלת על הקיר בשמאל; הכנף הקצה החופשי) ─────────
const DH_P = [{ type: 'door', hingeSide: 'left', harmonicaSide: 'right' }, { type: 'door', hingeSide: 'left', harmonicaSide: 'left' }];
{
  const sh = shower(DH_P, { 0: { w: 400, h: 1970, handleType: 'none' }, 1: { w: 252, h: 1900 } });
  const G = lgCuts(sh);
  check('door+leaf: keys', G.map(g => g.key), ['door-harm', 'harm-handle']);
  check('door+leaf: 252-wide harmonica leaf has no issue', G[1].issues, []);
  check('door+leaf: door has no issue', G[0].issues, []);
  check('door: hinge windows on the wall edge', of(G[0], 'hinge').map(c => c.x), [29.5, 29.5]);
  check('door: harm holes on the leaf edge, 27 in', of(G[0], 'harm').map(c => c.x), [375, 375, 375, 375]);
  check('leaf: harm holes on the door edge, 27 in', of(G[1], 'harm').map(c => c.x), [27, 27, 27, 27]);
  check('leaf: handle on the free edge', of(G[1], 'handle').map(c => c.x), [193]);
  //  הכנף נמוכה מהדלת — החורים מתיישרים בגובה מוחלט, לא 181/221 קבוע
  const lf = lifts(sh), a = of(G[0], 'harm'), b = of(G[1], 'harm');
  check('door/leaf harm holes line up in absolute height (±0.5)', a.map((c, i) => near(c.y + lf[0], b[i].y + lf[1])), [true, true, true, true]);
  check('door harm pair at template 181/221 bottom', a.slice(0, 2).map(c => c.y), [181, 221]);
}
// ‏הדלת עם ידית (לא 'none') → door-harm-handle; כנף בלי ידית → harm
{
  const G = lgCuts(shower(DH_P, { 0: { w: 400, h: 1970, handleType: 'knob' }, 1: { w: 300, h: 1970, handleType: 'none' } }));
  check('door with handle → door-harm-handle; leaf without → harm', G.map(g => g.key), ['door-harm-handle', 'harm']);
}
// ‏דלת+הרמוניקה צרה מדי — חורי ההרמוניקה נוגעים בחלון הציר
{
  const g = lgCuts(shower(DH_P, { 0: { w: 80, h: 1970, handleType: 'none' }, 1: { w: 300, h: 1970 } }))[0];
  check('80-wide door-harm: cuts too close', g.issues.includes('חיתוכים קרובים מדי'), true);
}

// ── מראה של המקלחון: דלת + קבוע, הכל בצלע השנייה ─────────────────────
{
  const A = lgCuts(shower(FD_P, FD_S));
  const B = lgCuts(shower([{ type: 'door', hingeSide: 'right', hingeOnFixed: 'next' }, { type: 'fixed', wallSide: 'right', carriesDoor: true }],
    { 0: { w: 700, h: 1985 }, 1: { w: 500, h: 2000 } }));
  check('mirrored: keys', B.map(g => g.key), ['door', 'fixed-closed-door']);
  const flip = (g, W) => g.cuts.map(c => [c.kind, Math.round((W - c.x) * 100) / 100, c.y]).sort();
  const same = (g) => g.cuts.map(c => [c.kind, c.x, c.y]).sort();
  check('mirrored fixed: every cut on the other edge', same(B[1]), flip(A[0], A[0].w));
  check('mirrored door: every cut on the other edge', same(B[0]), flip(A[1], A[1].w));
}

// ── שיפוע בתחתית הדלת: החיתוכים נמדדים מהקו הנטוי ─────────────────────
{
  const S = { 0: { w: 500, h: 2000 }, 1: { w: 700, h: 1985, hasSlope: true, slopeH1: 1985, slopeH2: 1965, slopeSideH: 'bottom' } };
  const g = lgCuts(shower(FD_P, S))[1];
  check('sloped door: no issues', g.issues, []);
  check('sloped door: outline has 4 corners, cut box 702 wide', [g.outline.length, g.w], [4, 702]);
}

if (failed) { console.error(failed + ' failed'); process.exit(1); }
console.log('all passed');
