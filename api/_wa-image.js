// ═══════════════════════════════════════════════════════════════════
//  api/_wa-image.js — מה מותר לעשות לתמונה שהגיעה ב-WhatsApp.
//
//  עוזר משותף, לא route (קידומת _ מונעת מ-Vercel להפוך אותו לנתיב).
//
//  ─── הכלל (החלטות בן, אפיון §11.1) ────────────────────────────────
//
//  1. passthrough. הבייטים בדיוק כפי ש-GREEN API סיפקה — בלי resize ובלי
//     recompression. ב-spike, כל הוריאנטים המוקטנים היו קריאים באותה מידה,
//     ו-recompression באותם ממדים לא חסך כלום.
//  2. פלט WhatsApp רגיל מגיע בלי EXIF, ולכן הוא חוזר **אותו Buffer בדיוק**.
//     זה לא "כמעט אותו דבר" — הבדיקות משוות זהות.
//  3. רק כשמגיע metadata (בדרך כלל: נשלח "כמסמך") — APP1 (EXIF/GPS/XMP),
//     APP3–APP15 ו-COM יורדים. JFIF, פרופיל הצבע (APP2) וכל הטבלאות
//     נשארים, ונתוני ה-scan מועתקים כמו שהם. אם התמונה מסובבת, נכתב APP1
//     מינימלי עם תג ה-orientation בלבד — אחרת סקיצה שצולמה לאורך תוצג על
//     הצד.
//
//  בלי ספרייה ובלי תלות נייטיבית: זה מעבר על כותרות הסגמנטים, לא פענוח.
// ═══════════════════════════════════════════════════════════════════

//  זיהוי לפי הבייטים, לא לפי השם או ה-mimeType שהשולח הצהיר.
function sniffImage(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return 'image/jpeg';
  if (buf.readUInt32BE(0) === 0x89504E47 && buf.readUInt32BE(4) === 0x0D0A1A0A) return 'image/png';
  if (buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

//  הסגמנטים שלפני ה-scan. null = המבנה לא תקין, ואז לא נוגעים בכלום.
function _segments(buf) {
  const out = [];
  let i = 2;
  while (i + 4 <= buf.length) {
    if (buf[i] !== 0xFF) return null;
    const marker = buf[i + 1];
    if (marker === 0xDA) return { segs: out, scanAt: i };      // מכאן הכל נתוני תמונה
    const len = buf.readUInt16BE(i + 2);
    if (len < 2 || i + 2 + len > buf.length) return null;
    out.push({ marker, start: i, end: i + 2 + len });
    i += 2 + len;
  }
  return null;
}

//  Orientation מתוך סגמנט EXIF. 0 = אין.
function _exifOrientation(buf, s) {
  const p = s.start + 4;
  if (s.end - p < 14 || buf.toString('latin1', p, p + 6) !== 'Exif\0\0') return 0;
  const t = p + 6;
  const le = buf.toString('latin1', t, t + 2) === 'II';
  const u16 = o => le ? buf.readUInt16LE(o) : buf.readUInt16BE(o);
  const u32 = o => le ? buf.readUInt32LE(o) : buf.readUInt32BE(o);
  try {
    const ifd = t + u32(t + 4);
    const n = u16(ifd);
    for (let k = 0; k < n; k++) {
      const e = ifd + 2 + k * 12;
      if (e + 12 > s.end) return 0;
      if (u16(e) === 0x0112) { const v = u16(e + 8); return v >= 1 && v <= 8 ? v : 0; }
    }
  } catch (_) { /* מחוץ לגבולות — אין orientation */ }
  return 0;
}

//  APP1 מינימלי: TIFF little-endian, IFD0 עם רשומה אחת — Orientation.
function _orientationApp1(v) {
  const payload = Buffer.from([
    0x45, 0x78, 0x69, 0x66, 0, 0,              // "Exif\0\0"
    0x49, 0x49, 0x2A, 0, 8, 0, 0, 0,           // II*\0, IFD0 ב-8
    1, 0,                                      // רשומה אחת
    0x12, 0x01, 3, 0, 1, 0, 0, 0, v, 0, 0, 0,  // 0x0112 SHORT ×1 = v
    0, 0, 0, 0,                                // אין IFD הבא
  ]);
  const len = payload.length + 2;
  return Buffer.concat([Buffer.from([0xFF, 0xE1, len >> 8, len & 0xFF]), payload]);
}

const _isStripped = m => m === 0xE1 || (m >= 0xE3 && m <= 0xEF) || m === 0xFE;

//  מחזיר את אותו Buffer כשאין מה להסיר — passthrough אמיתי.
function stripJpegMeta(buf) {
  if (sniffImage(buf) !== 'image/jpeg') return buf;
  const parsed = _segments(buf);
  if (!parsed) return buf;                                   // שבור — לא "מתקנים"
  const { segs, scanAt } = parsed;
  if (!segs.some(s => _isStripped(s.marker))) return buf;

  let orientation = 0;
  for (const s of segs) if (s.marker === 0xE1 && !orientation) orientation = _exifOrientation(buf, s);

  const parts = [buf.subarray(0, 2)];
  let placed = false;
  for (const s of segs) {
    if (_isStripped(s.marker)) continue;
    parts.push(buf.subarray(s.start, s.end));
    // ה-EXIF בא מיד אחרי JFIF, כמו בכל קובץ מצלמה
    if (s.marker === 0xE0 && !placed && orientation > 1) { parts.push(_orientationApp1(orientation)); placed = true; }
  }
  if (orientation > 1 && !placed) parts.splice(1, 0, _orientationApp1(orientation));
  parts.push(buf.subarray(scanAt));
  return Buffer.concat(parts);
}

//  לבדיקות ולאבחון: ה-orientation של קובץ. 1 כשאין תג.
function jpegOrientation(buf) {
  const parsed = sniffImage(buf) === 'image/jpeg' && _segments(buf);
  if (!parsed) return 1;
  for (const s of parsed.segs) if (s.marker === 0xE1) { const v = _exifOrientation(buf, s); if (v) return v; }
  return 1;
}

module.exports = { sniffImage, stripJpegMeta, jpegOrientation };
