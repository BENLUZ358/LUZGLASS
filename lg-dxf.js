// ═══════════════════════════════════════════════════════════════════
//  lg-dxf.js — קובץ DXF (R12, מ"מ) לכל זכוכית, מתוך lgCuts. טהור: דפדפן וגם Node.
//  "עדיף בלי קובץ מקובץ שגוי": זורק שגיאה אם יש בעיה בזכוכית או מספר לא תקין.
// ═══════════════════════════════════════════════════════════════════

function _dxfNum(v) {
  if (typeof v !== 'number' || !isFinite(v)) throw new Error('DXF: ערך לא תקין ' + v);
  let s = (Math.round(v * 1000) / 1000).toFixed(3);
  s = s.replace(/\.?0+$/, '');
  return (s === '-0' || s === '') ? '0' : s;
}
const _dxfDeg = r => { let d = (r * 180 / Math.PI) % 360; if (d < 0) d += 360; return d >= 360 ? 0 : d; };

function lgDxf(g) {
  if (!g || !g.outline || !g.outline.length) throw new Error('DXF: אין מתאר לזכוכית');
  if (g.issues && g.issues.length) throw new Error('DXF: בזכוכית יש בעיות — ' + g.issues.join('; '));
  const N = _dxfNum, ents = [];
  const ent = (type, layer, items) => {
    ents.push('0', type, '8', layer);
    items.forEach(([c, v]) => ents.push(String(c), String(v)));
  };
  const line = (layer, x1, y1, x2, y2) =>
    ent('LINE', layer, [[10, N(x1)], [20, N(y1)], [30, 0], [11, N(x2)], [21, N(y2)], [31, 0]]);
  const arc = (layer, cx, cy, r, a0, a1) => {
    const s = a1 < a0 ? a1 : a0, e = a1 < a0 ? a0 : a1;   // DXF: תמיד נגד כיוון השעון
    ent('ARC', layer, [[10, N(cx)], [20, N(cy)], [30, 0], [40, N(r)], [50, N(_dxfDeg(s))], [51, N(_dxfDeg(e))]]);
  };
  const circle = (layer, cx, cy, r) => ent('CIRCLE', layer, [[10, N(cx)], [20, N(cy)], [30, 0], [40, N(r)]]);

  const o = g.outline;
  for (let i = 0; i < o.length; i++) { const a = o[i], b = o[(i + 1) % o.length]; line('OUTLINE', a[0], a[1], b[0], b[1]); }
  for (const c of g.cuts || []) {
    if (c.dia != null) circle('CUTS', c.x, c.y, c.dia / 2);
    else if (c.contour) for (const s of c.contour) {
      if (s[0] === 0) line('CUTS', s[1], s[2], s[3], s[4]); else arc('CUTS', s[1], s[2], s[3], s[4], s[5]);
    } else throw new Error('DXF: חיתוך בלי צורה (' + c.kind + ')');
  }

  const head = [], p = (c, v) => head.push(String(c), String(v));
  p(0, 'SECTION'); p(2, 'HEADER'); p(9, '$ACADVER'); p(1, 'AC1009'); p(9, '$INSUNITS'); p(70, 4); p(0, 'ENDSEC');
  p(0, 'SECTION'); p(2, 'TABLES'); p(0, 'TABLE'); p(2, 'LAYER'); p(70, 2);
  [['OUTLINE', 7], ['CUTS', 1]].forEach(([n, col]) => { p(0, 'LAYER'); p(2, n); p(70, 0); p(62, col); p(6, 'CONTINUOUS'); });
  p(0, 'ENDTAB'); p(0, 'ENDSEC');
  p(0, 'SECTION'); p(2, 'ENTITIES');
  return head.concat(ents, ['0', 'ENDSEC', '0', 'EOF']).join('\n') + '\n';
}

function lgDxfName(orderNum, itemNo, g, qty) {
  return orderNum + '-' + itemNo + '_' + Math.round(g.w) + 'x' + Math.round(g.h) + (qty > 1 ? '_x' + qty : '') + '.dxf';
}

// שם בטוח למערכת הקבצים: בלי / \ : * ? " < > |
function lgDxfSafe(s) { return String(s == null ? '' : s).replace(/[\/\\:*?"<>|\u0000-\u001f]/g, '').trim(); }

// הורדה בדפדפן (אין תלות חיצונית). זורק אם אין דפדפן.
function lgDxfSave(name, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/dxf' }));
  const a = document.createElement('a');
  a.download = name; a.href = url;
  if (document.body && document.body.appendChild) document.body.appendChild(a);
  a.click();
  if (a.remove) a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// כל הקבצים אחד אחרי השני (בלי ספריית zip). done(errs) נקרא אחרי הקובץ האחרון; ריק = הכול ירד.
function lgDxfSaveAll(files, gapMs, done) {
  const errs = [], gap = gapMs == null ? 350 : gapMs;
  if (!files.length) { if (done) done(errs); return; }
  files.forEach((f, i) => setTimeout(() => {
    try { lgDxfSave(f.name, lgDxf(f.cut)); } catch (e) { errs.push(e.message); }
    if (i === files.length - 1 && done) done(errs);
  }, i * gap));
}

if (typeof module !== 'undefined' && module.exports) module.exports = { lgDxf, lgDxfName, lgDxfSafe, lgDxfSave, lgDxfSaveAll };
