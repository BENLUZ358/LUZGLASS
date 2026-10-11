// Demo data for the training videos — invented clients and orders only (docs/training-videos/00-STANDARDS.md §7).
// Order numbers 9xxx like the TEST environment; phones 050-00001xx that belong to nobody.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const DB_SRC = fs.readFileSync(path.join(REPO, 'firebase-db.js'), 'utf8');
const fnSrc = name => (DB_SRC.match(new RegExp('\\nfunction ' + name + '\\([\\s\\S]*?\\n\\}')) || [''])[0];
const ctx = {}; vm.createContext(ctx);
['lgItemsHash'].forEach(n => vm.runInContext(fnSrc(n), ctx));
// the station compares this fingerprint; a seed "verified" with any other hash would show as "changed" at once
export const itemsHash = items => ctx.lgItemsHash(items);

// a fixed, believable clock: Monday 12.10.2026, 10:40 Israel time
export const CLOCK = Date.UTC(2026, 9, 12, 7, 40, 0);
export const DAY = 24 * 3600e3, HOUR = 3600e3;

export const CLIENTS = {
  galil:   { phone: '0500000101', name: 'זגגות הגליל' },
  sharon:  { phone: '0500000102', name: 'מקלחוני השרון', delivery: true },
  tzafon:  { phone: '0500000103', name: 'בית הזכוכית צפון', monthly: true },
  david:   { phone: '0500000104', name: 'אלומיניום דוד' },
};
export function users({ worker = 'נועה', mainAdmin = false } = {}) {
  const u = { '0500000000': { id: 'u0', name: worker, role: 'admin', phone: '0500000000', isMainAdmin: !!mainAdmin } };
  Object.values(CLIENTS).forEach((c, i) => {
    u[c.phone] = { id: 'c' + i, name: c.name, businessName: c.name, role: 'client', phone: c.phone, customerId: String(14300 + i),
                   isDelivery: !!c.delivery, monthlyBilling: !!c.monthly };
  });
  return u;
}

// catalog entries the pages read (sku-picker, glass filters)
export const SKUS = {
  '8SMH':  { code: '8SMH',  name: '8 מ"מ שקוף מחוסם', glass: 'שקוף', mm: 8, proc: 'chisum', active: true },
  '10SMH': { code: '10SMH', name: '10 מ"מ שקוף מחוסם', glass: 'שקוף', mm: 10, proc: 'chisum', active: true },
  '6SMH':  { code: '6SMH',  name: '6 מ"מ שקוף מחוסם', glass: 'שקוף', mm: 6, proc: 'chisum', active: true },
  '8HMH':  { code: '8HMH',  name: '8 מ"מ חלבי מחוסם', glass: 'חלבי', mm: 8, proc: 'chisum', active: true },
  '8SL':   { code: '8SL',   name: '8 מ"מ שקוף מלוטש', glass: 'שקוף', mm: 8, proc: 'litush', active: true },
  '6SL':   { code: '6SL',   name: '6 מ"מ שקוף מלוטש', glass: 'שקוף', mm: 6, proc: 'litush', active: true },
  'M4':    { code: 'M4',    name: 'מראה 4 מ"מ מלוטשת', glass: 'מראה', mm: 4, proc: 'litush', active: true },
};
// a glass item as the pages store it
export function item(sku, w, h, extra = {}) {
  const s = SKUS[sku];
  return { sku, name: s.name, glassFullName: s.name, glass: s.glass, mm: s.mm, w, h, qty: 1,
           chisum: s.proc === 'chisum', litush: s.proc === 'litush', ...extra };
}

// a clean technical sketch: the panes side by side, width above, height beside, a number on each
export function sketch({ title, client, num, panes, note }) {
  const maxH = Math.max(...panes.map(p => p.h)), sumW = panes.reduce((s, p) => s + p.w, 0);
  const W = 1200, H = 850, areaW = 980, areaH = 560;
  const k = Math.min(areaW / (sumW + 120 * (panes.length - 1)), areaH / maxH);
  let x = (W - (sumW * k + 120 * k * (panes.length - 1))) / 2;
  const base = 150 + areaH;
  const parts = panes.map((p, i) => {
    const w = p.w * k, h = p.h * k, y = base - h;
    const s = `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${p.mirror ? '#dfe7ee' : '#e9f4fb'}" stroke="#1d3c58" stroke-width="3"/>
      <line x1="${x}" y1="${y - 26}" x2="${x + w}" y2="${y - 26}" stroke="#7a8a99" stroke-width="2"/>
      <text x="${x + w / 2}" y="${y - 36}" font-size="30" font-weight="700" text-anchor="middle" fill="#a3281c">${p.w}</text>
      <text x="${x + w + 14}" y="${y + h / 2}" font-size="30" font-weight="700" fill="#a3281c" transform="rotate(-90 ${x + w + 14} ${y + h / 2})" text-anchor="middle" dy="22">${p.h}</text>
      <circle cx="${x + w / 2}" cy="${y + h / 2}" r="24" fill="#1d3c58"/><text x="${x + w / 2}" y="${y + h / 2 + 10}" font-size="28" font-weight="800" text-anchor="middle" fill="#fff">${p.n ?? i + 1}</text>
      ${p.label ? `<text x="${x + w / 2}" y="${base + 40}" font-size="22" text-anchor="middle" fill="#445">${p.label}</text>` : ''}`;
    x += w + 120 * k;
    return s;
  }).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Arial, sans-serif">
    <rect width="${W}" height="${H}" fill="#fff"/>
    <rect x="16" y="16" width="${W - 32}" height="${H - 32}" fill="none" stroke="#c9d3dc" stroke-width="2"/>
    <text x="${W - 40}" y="72" font-size="38" font-weight="800" text-anchor="start" fill="#1d3c58" direction="rtl" unicode-bidi="embed">${title}</text>
    <text x="40" y="${H - 40}" font-size="30" font-weight="700" fill="#1d3c58">${num}</text>
    ${parts}
    <text x="${W - 40}" y="${H - 40}" font-size="26" text-anchor="start" fill="#556" direction="rtl" unicode-bidi="embed">${client}${note ? ' · ' + note : ''}</text>
  </svg>`;
  return 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
}

// an order record as the system stores it
export function order(id, num, client, extra = {}) {
  const c = typeof client === 'string' ? CLIENTS[client] : client;
  return { id, orderNum: num, refNum: num, orderClient: c.name, client: c.name, businessName: c.name,
    phone: c.phone, clientPhone: c.phone, stage: '', status: 'ממתין לאישור', source: 'upload',
    date: '08.10.2026', time: '09:15', createdAt: CLOCK - 4 * DAY, updatedAt: CLOCK - 2 * DAY,
    paymentStatus: 'unpaid', hasSketch: false, deliveryClient: !!c.delivery, monthlyBilling: !!c.monthly, ...extra };
}
