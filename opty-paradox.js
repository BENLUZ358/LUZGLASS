// ═══════════════════════════════════════════════════════════════════
//  opty-paradox.js — קורא טבלת "פרדוקס" של אופטי-ווי (בן, 16/11).
//  אופטי-ווי 8.2 שומר את החלקים ב-C:\Opty-Way\DBLITE\Pezzi.DB (רגיל) ו-PezziCan.DB
//  (טריפלקס). הקובץ רק נקרא — לא נכתב (הוא מגיע מהדיסק-און-קי של האופטימיזציות).
//  טהור: דפדפן וגם Node (scripts/test-opty-paradox.js). עברית = windows-1255.
//  אפיון: docs/superpowers/specs/2026-11-16-optyway-shape-link-design.md
// ═══════════════════════════════════════════════════════════════════

//  buf: ArrayBuffer / Uint8Array → { fields:[{name,type,size}], rows:[{FIELD: value}] }
function lgOptyReadTable(buf) {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (b.length < 0x80) throw new Error('הקובץ קצר מדי — זו לא טבלת אופטי-ווי');
  const recSize = dv.getUint16(0, true), headSize = dv.getUint16(2, true);
  const blockSize = b[5] * 1024, nFields = dv.getUint16(0x21, true), ver = b[0x39];
  if (!recSize || !headSize || !blockSize || !nFields || nFields > 255) throw new Error('הקובץ לא נראה כמו טבלת אופטי-ווי');
  const latin = new TextDecoder('latin1'), heb = new TextDecoder('windows-1255');
  const fields = [];
  let p = 0x78;
  for (let i = 0; i < nFields; i++, p += 2) fields.push({ type: b[p], size: b[p + 1] });
  p += 4 + 4 * nFields + (ver >= 12 ? 261 : 79);
  for (const f of fields) {
    let e = p; while (e < b.length && b[e] !== 0) e++;
    f.name = latin.decode(b.subarray(p, e)); p = e + 1;
  }
  const num = (o, n) => {                       // מספר שלם: big-endian, ביט הסימן הפוך; הכול 0 = ריק
    let any = false; for (let i = 0; i < n; i++) if (b[o + i]) { any = true; break; }
    if (!any) return null;
    let v = (b[o] ^ 0x80) << 24 >> 24;          // הבית הראשון עם סימן
    for (let i = 1; i < n; i++) v = v * 256 + b[o + i];
    return v;
  };
  const dbl = o => {                            // שבר: big-endian; חיובי = ביט עליון דולק
    let any = false; for (let i = 0; i < 8; i++) if (b[o + i]) { any = true; break; }
    if (!any) return null;
    const x = new Uint8Array(8);
    if (b[o] & 0x80) { x.set(b.subarray(o, o + 8)); x[0] ^= 0x80; }
    else for (let i = 0; i < 8; i++) x[i] = ~b[o + i] & 0xFF;
    return new DataView(x.buffer).getFloat64(0, false);
  };
  const rows = [];
  for (let off = headSize; off + 6 <= b.length; off += blockSize) {
    const add = dv.getInt16(off + 4, true);
    if (add < 0) continue;                      // בלוק ריק
    const n = Math.floor(add / recSize) + 1;
    for (let r = 0; r < n; r++) {
      let o = off + 6 + r * recSize;
      if (o + recSize > b.length) break;
      const row = {};
      for (const f of fields) {
        let v;
        if (f.type === 1) {                     // טקסט
          let e = o; const end = o + f.size; while (e < end && b[e] !== 0) e++;
          v = heb.decode(b.subarray(o, e)).trim();
        } else if (f.type === 3 || f.type === 4 || f.type === 0x16) v = num(o, f.size);
        else if (f.type === 6) v = dbl(o);
        else if (f.type === 2) {                // תאריך = ימים מ-1/1/0001
          const d = num(o, 4);
          const day1 = new Date(0); day1.setUTCFullYear(1, 0, 1);   // Date.UTC(1,…) היה נותן 1901
          v = d ? new Date(day1.getTime() + (d - 1) * 86400000).toISOString().slice(0, 10) : null;
        } else if (f.type === 9) v = b[o] ? !!(b[o] & 1) : null;
        else v = null;                          // סוגים שלא צריך (זמן, תזכיר…)
        row[f.name] = v;
        o += f.size;
      }
      rows.push(row);
    }
  }
  return { fields, rows };
}

if (typeof module !== 'undefined' && module.exports) module.exports = { lgOptyReadTable };
