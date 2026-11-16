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
  if (g.key == null) throw new Error('DXF: לזכוכית אין תבנית חיתוך — לבדוק ביד');
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

// ── zip מינימלי (store, בלי דחיסה, בלי תלות) ─────────────────────────
// Chrome חוסם הורדה שנייה מאותו לחיצה, ולכן "כל ה-DXF" = קובץ zip אחד.
// שמות בעברית: UTF-8 + ביט 11 בדגלים, כדי ש-Windows יפתח אותם נכון.
function _zipUtf8(s) {
  const out = [];
  for (const ch of String(s)) {
    const c = ch.codePointAt(0);
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | c >> 6, 0x80 | c & 63);
    else if (c < 0x10000) out.push(0xe0 | c >> 12, 0x80 | c >> 6 & 63, 0x80 | c & 63);
    else out.push(0xf0 | c >> 18, 0x80 | c >> 12 & 63, 0x80 | c >> 6 & 63, 0x80 | c & 63);
  }
  return out;
}
let _zipCrcT = null;
function _zipCrc(b) {
  if (!_zipCrcT) {
    _zipCrcT = [];
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; _zipCrcT[n] = c >>> 0; }
  }
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = _zipCrcT[(c ^ b[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
// entries: [{ name, data: string | bytes }] → Uint8Array של קובץ zip
function lgZip(entries) {
  const out = [], cd = [];
  const u16 = (a, v) => a.push(v & 255, v >>> 8 & 255), u32 = (a, v) => a.push(v & 255, v >>> 8 & 255, v >>> 16 & 255, v >>> 24 & 255);
  const d = new Date(), time = d.getHours() << 11 | d.getMinutes() << 5 | d.getSeconds() >> 1;
  const date = (Math.max(1980, d.getFullYear()) - 1980) << 9 | (d.getMonth() + 1) << 5 | d.getDate();
  for (const e of entries) {
    const name = _zipUtf8(e.name), data = typeof e.data === 'string' ? _zipUtf8(e.data) : Array.from(e.data);
    const crc = _zipCrc(data), off = out.length;
    //  local file header
    u32(out, 0x04034b50); u16(out, 20); u16(out, 0x0800); u16(out, 0); u16(out, time); u16(out, date);
    u32(out, crc); u32(out, data.length); u32(out, data.length); u16(out, name.length); u16(out, 0);
    for (const x of name) out.push(x);
    for (const x of data) out.push(x);
    //  central directory entry
    u32(cd, 0x02014b50); u16(cd, 20); u16(cd, 20); u16(cd, 0x0800); u16(cd, 0); u16(cd, time); u16(cd, date);
    u32(cd, crc); u32(cd, data.length); u32(cd, data.length); u16(cd, name.length); u16(cd, 0); u16(cd, 0);
    u16(cd, 0); u16(cd, 0); u32(cd, 0); u32(cd, off);
    for (const x of name) cd.push(x);
  }
  const cdOff = out.length;
  for (const x of cd) out.push(x);
  u32(out, 0x06054b50); u16(out, 0); u16(out, 0); u16(out, entries.length); u16(out, entries.length);
  u32(out, cd.length); u32(out, cdOff); u16(out, 0);
  return new Uint8Array(out);
}

// הורדה בדפדפן של הרבה קבצי DXF בקובץ zip אחד. כל הקבצים נכתבים לפני ההורדה — שגיאה באחד זורקת ולא יורד כלום.
// files: [{ name, cut }]
function lgDxfSaveZip(zipName, files) {
  const entries = files.map(f => ({ name: f.name, data: lgDxf(f.cut) }));
  const url = URL.createObjectURL(new Blob([lgZip(entries)], { type: 'application/zip' }));
  const a = document.createElement('a');
  a.download = zipName; a.href = url;
  if (document.body && document.body.appendChild) document.body.appendChild(a);
  a.click();
  if (a.remove) a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

if (typeof module !== 'undefined' && module.exports) module.exports = { lgDxf, lgDxfName, lgDxfSafe, lgDxfSave, lgZip, lgDxfSaveZip };
