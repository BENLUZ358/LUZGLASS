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

// catalog entries the pages read (sku-picker, glass filters) — the system's REAL codes and names (firebase-db.js LG_SKU_MAP)
export const SKUS = {
  '8SMH':   { code: '8SMH',   name: '8 מ"מ שקוף מחוסם',          glass: 'שקוף', mm: 8,  proc: 'chisum', active: true },
  '10SMH':  { code: '10SMH',  name: '10 מ"מ שקוף מחוסם',         glass: 'שקוף', mm: 10, proc: 'chisum', active: true },
  '6SMH':   { code: '6SMH',   name: '6 מ"מ שקוף מחוסם',          glass: 'שקוף', mm: 6,  proc: 'chisum', active: true },
  '8HMH':   { code: '8HMH',   name: '8 מ"מ חלבי מחוסם',          glass: 'חלבי', mm: 8,  proc: 'chisum', active: true },
  '8SM':    { code: '8SM',    name: '8 מ"מ שקוף מלוטש',          glass: 'שקוף', mm: 8,  proc: 'litush', active: true },
  '6SM':    { code: '6SM',    name: '6 מ"מ שקוף מלוטש',          glass: 'שקוף', mm: 6,  proc: 'litush', active: true },
  '10SM':   { code: '10SM',   name: '10 מ"מ שקוף מלוטש',         glass: 'שקוף', mm: 10, proc: 'litush', active: true },
  '4MIRM':  { code: '4MIRM',  name: 'מראה 4 מ"מ מלוטש',          glass: 'מראה', mm: 4,  proc: 'litush', active: true },
};
// Prices per m² — Ben's price list no. 6 in the Hashavshevet export (מחירונים.pdf, parsed by scripts/parse-pricelist-pdf.js):
// 8SMH 190 · 10SMH 210 · 8HMH 240 · 10SGMH 310 · 4MIRM 110 · 8SGMH 266 (list 4). 6SMH is not on list 6 → 160, the most
// common value on the other lists. Polished glass (…SM, 8SGM) is on no list in the export; it carries a working price
// only so the pages do not warn "לא תומחר", and no video shows those prices on screen.
export const PRICES = {
  '8SMH': 190, '10SMH': 210, '8HMH': 240, '10SGMH': 310, '4MIRM': 110, '8SGMH': 266, '6SMH': 160,
  '8SM': 150, '6SM': 120, '10SM': 180, '8SGM': 230,
};
const m2 = i => Math.max(0.001, (Number(i.w) || 0) * (Number(i.h) || 0) / 1e6);
// the price fields a locked order carries — computed from PRICES, like lgLockAndAdvance does from the price list
export function locked(items, at) {
  const lockedItems = items.map(i => ({ ...i, pricePerM2: PRICES[i.sku] || 0 }));
  const totalFinal = Math.round(lockedItems.reduce((s, i) => s + m2(i) * i.pricePerM2, 0));
  return { pricesLockedAt: at, totalFinal, lockedItems };
}

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

// a client's own sketch, as it arrives by upload or WhatsApp: pen on squared paper, photographed — wobbly lines,
// handwriting, a slight tilt. Used where a video must show "an uploaded sketch" next to the one the system draws.
export function handSketch({ title, panes, note }) {
  const W = 1200, H = 900;
  const maxH = Math.max(...panes.map(p => p.h)), sumW = panes.reduce((s, p) => s + p.w, 0);
  const k = Math.min(760 / (sumW + 140 * (panes.length - 1)), 520 / maxH);
  let x = (W - (sumW * k + 140 * k * (panes.length - 1))) / 2;
  const base = 700;
  const hand = "'Segoe Print','Comic Sans MS',cursive";
  const parts = panes.map(p => {
    const w = p.w * k, h = p.h * k, y = base - h;
    const s = `<path d="M${x} ${y + 3} L${x + w + 2} ${y} L${x + w} ${y + h + 2} L${x - 2} ${y + h} Z" fill="none" stroke="#1b2a6b" stroke-width="4" stroke-linejoin="round"/>
      <path d="M${x} ${y - 30} L${x + w} ${y - 32}" stroke="#1b2a6b" stroke-width="2"/>
      <text x="${x + w / 2}" y="${y - 44}" font-family="${hand}" font-size="40" text-anchor="middle" fill="#1b2a6b">${p.w}</text>
      <text x="${x + w + 16}" y="${y + h / 2}" font-family="${hand}" font-size="40" fill="#1b2a6b">${p.h}</text>`;
    x += w + 140 * k;
    return s;
  }).join('');
  const grid = Array.from({ length: 24 }, (_, i) => `<line x1="0" y1="${i * 40}" x2="${W}" y2="${i * 40}" stroke="#c9d8e8" stroke-width="1"/>`).join('')
             + Array.from({ length: 31 }, (_, i) => `<line x1="${i * 40}" y1="0" x2="${i * 40}" y2="${H}" stroke="#c9d8e8" stroke-width="1"/>`).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    <defs><filter id="wob"><feTurbulence type="fractalNoise" baseFrequency="0.02" numOctaves="2" seed="4"/><feDisplacementMap in="SourceGraphic" scale="6"/></filter>
      <radialGradient id="lt" cx="40%" cy="35%" r="80%"><stop offset="0" stop-color="#fffdf6"/><stop offset="1" stop-color="#ece5d3"/></radialGradient></defs>
    <rect width="${W}" height="${H}" fill="#6b6257"/>
    <g transform="rotate(-1.6 ${W / 2} ${H / 2})">
      <rect x="40" y="30" width="${W - 80}" height="${H - 60}" fill="url(#lt)"/>
      <clipPath id="paper"><rect x="40" y="30" width="${W - 80}" height="${H - 60}"/></clipPath>
      <g opacity=".7" clip-path="url(#paper)">${grid}</g>
      <g filter="url(#wob)">
        <text x="${W - 110}" y="120" font-family="${hand}" font-size="52" text-anchor="start" fill="#1b2a6b" direction="rtl" unicode-bidi="embed">${title}</text>
        ${parts}
        ${note ? `<text x="${W - 110}" y="${H - 90}" font-family="${hand}" font-size="34" text-anchor="start" fill="#1b2a6b" direction="rtl" unicode-bidi="embed">${note}</text>` : ''}
      </g>
    </g>
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
