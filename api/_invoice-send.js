// ═══════════════════════════════════════════════════════════════════
//  api/_invoice-send.js — חבילת שליחה וארכיון להעתקים (DB-00004).
//
//  עוזר משותף, לא route. לוגיקה טהורה.
//
//  המודול בונה את החבילה ומחשב מפתח/נתיב. השליחה עצמה: _invoice-deliver.js.
// ═══════════════════════════════════════════════════════════════════

const crypto = require('crypto');

//  בן, 29/10: שולחים מיד — בלי חלון המתנה. (היה 5 דקות.)
const CANCEL_WINDOW_MS = 0;

//  מפתח שליחה דטרמיניסטי: אותו לקוח + אותו מספר מסמך = אותה שליחה.
function lgInvoiceSendKey(clientKey, docNumber) {
  return crypto.createHash('sha1')
    .update('invoice|' + String(clientKey) + '|' + String(docNumber)).digest('hex').slice(0, 20);
}

//  מפתח רשומת invoicePdf: דטרמיניסטי לפי קבוצת ההזמנות, כך שהפקה חוזרת
//  או רישום ידני של אותן הזמנות מגיעים לאותה רשומה.
function lgInvoicePdfKey(orderIds) {
  return crypto.createHash('sha1')
    .update('invoicePdf|' + [...orderIds].map(String).sort().join(',')).digest('hex').slice(0, 20);
}

//  שם בטוח לתיקייה/קובץ ב-Windows (גם בנתיב רשת).
function safeName(s) {
  const t = String(s || '').replace(/[\\/:*?"<>|\u0000-\u001F]/g, ' ')
    .replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '').slice(0, 60);
  return t || 'ללא שם';
}

//  שנה/חודש/לקוח/תאריך_מספר.pdf — יחסי לתיקייה השיתופית (הכלי מצרף שורש).
//  ⚠️ ההפרדה היא '/' בכוונה; הכלי ממיר למפריד של המערכת.
function lgInvoiceArchivePath(isoDate, customer, docNumber) {
  const m = String(isoDate || '').match(/^(\d{4})-(\d{2})-\d{2}$/);
  if (!m) return null;
  if (!/^\d{4,9}$/.test(String(docNumber || ''))) return null;
  return `${m[1]}/${m[2]}/${safeName(customer)}/${isoDate}_${docNumber}.pdf`;
}

//  רשימת מה לשלוח. עוצר (ok:false) אם חסרה סקיצה — אין שליחה חלקית.
//  sketches = מפת orderId → data URL מ-sketches/<id>.
function lgInvoiceBuildPackage(record, sketches) {
  const ids = (record && record.orderIds) || [];
  if (!ids.length) return { ok: false, code: 'no-orders' };
  const missing = ids.filter(id => !(sketches && sketches[id]));
  if (missing.length) return { ok: false, code: 'sketch-missing', orderIds: missing };
  return { ok: true, attachments: [{ kind: 'invoice-original' }, ...ids.map(id => ({ kind: 'sketch', orderId: id }))] };
}

function lgInvoiceSendAfter(now, windowMs) {
  return now + (windowMs == null ? CANCEL_WINDOW_MS : windowMs);
}

module.exports = { CANCEL_WINDOW_MS, lgInvoicePdfKey, lgInvoiceSendKey, safeName, lgInvoiceArchivePath, lgInvoiceBuildPackage, lgInvoiceSendAfter };
