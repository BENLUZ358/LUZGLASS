// ═══════════════════════════════════════════════════════════════════
//  lg-health.js — "בדיקת תקינות" (בן, 20/10/2026)
//
//  בודק את הנתונים ומחזיר רשימה בעברית של דברים שקטים שעלולים להפוך לבאג:
//  הזמנה שתקועה בשלב לא נכון, רשומות יתומות, הזמנה במפעל שלא נשלחה לחשבשבת,
//  וואטסאפ תקוע. רק קורא — פונקציה טהורה על נתונים שכבר נטענו, בלי כתיבה.
//  כל בדיקה נולדה מתקלה אמיתית (ר' scripts/test-health-check.js).
//
//  lgHealthCheck({orders, workday, waInbound, waOutbox, prices}, now)
//    → { problems: [{sev:'high'|'mid'|'low', title, items:[...] }], ok: [...], summary }
// ═══════════════════════════════════════════════════════════════════

function lgHealthCheck(d, now) {
  const arr = v => Array.isArray(v) ? v : Object.values(v || {});
  const O = (d && d.orders) || {}, wd = (d && d.workday) || {}, prices = (d && d.prices) || {};
  const real = Object.entries(O).filter(([, o]) => o && o.id);
  const os = real.map(([, o]) => o);
  const label = o => (o.orderNum || '?') + (o.sketchName ? ' (' + o.sketchName + ')' : '') + (o.orderClient ? ' · ' + o.orderClient : '');
  const problems = [], ok = [];
  const add = (sev, title, items, okText) => {
    if (items.length) problems.push({ sev, title, items: items.slice(0, 30), count: items.length });
    else if (okText) ok.push(okText);
  };
  const STAGES = { '': 'תור סקיצות', pending: 'תור סקיצות', chash: 'אצל שרטט', drafter: 'אצל שרטט', opty: 'מחכה ל-OptyWay',
    workday: 'ירד לביצוע', chisum: 'נשלח לחיסום', graphic: 'בגרפיקה', delivery: 'ממתין להובלה', done: 'מוכן לאיסוף', collected: 'נאסף' };

  // ── רשומות ──
  add('low', 'רשומות ריקות בלי מספר הזמנה (לא מוצגות בשום מקום)',
      Object.entries(O).filter(([, o]) => !o || !o.id).map(([k]) => k), 'אין רשומות ריקות');
  add('high', 'רשומה שהמפתח שלה שונה ממספר ההזמנה', real.filter(([k, o]) => String(o.id) !== k).map(([k, o]) => k + ' ≠ ' + o.id),
      'כל הרשומות במקום הנכון');
  const byNum = {};
  os.forEach(o => { if (o.orderNum) (byNum[o.orderNum] = byNum[o.orderNum] || []).push(o); });
  add('high', 'מספר הזמנה כפול', Object.keys(byNum).filter(n => byNum[n].length > 1).map(n => n + ' ×' + byNum[n].length), 'אין מספרי הזמנה כפולים');
  add('mid', 'שלב לא מוכר', os.filter(o => !((o.stage || '') in STAGES)).map(o => label(o) + ' — ' + o.stage), null);

  // ── יום עבודה ותחנת הבדיקה ──
  const inChisum = arr(wd.inChisum).map(String), inWork = arr(wd.inWork).map(String);
  add('high', 'ברשימת תחנת הבדיקה — אבל ההזמנה לא קיימת', inChisum.filter(id => !O[id] || !O[id].id), null);
  add('mid', 'בתחנת הבדיקה אבל השלב לא "ירד לביצוע"',
      inChisum.filter(id => O[id] && O[id].id && O[id].stage !== 'workday').map(id => label(O[id]) + ' — ' + (STAGES[O[id].stage || ''] || O[id].stage)),
      'כל מה שבתחנת הבדיקה בשלב הנכון');
  add('high', 'ביום העבודה — אבל ההזמנה לא קיימת', inWork.filter(id => !O[id] || !O[id].id), null);
  add('mid', 'סימוני בדיקה להזמנה שלא בתחנת הבדיקה',
      Object.keys(wd.checkState || {}).filter(id => !inChisum.includes(id)).map(id => O[id] && O[id].id ? label(O[id]) : id),
      'אין סימוני בדיקה תלויים');

  // ── מפעל ──
  const factory = os.filter(o => o.stage === 'chisum');
  add('mid', 'במפעל בלי דוח חיסום ובלי דוח טריפלקס', factory.filter(o => !o.chisumReportId && !o.triplexReportId).map(label),
      'כל מה שבמפעל שייך לדוח');
  add('mid', 'במפעל — ולא נשלחה לחשבשבת', factory.filter(o => !o.hashavshevet).map(label), 'כל מה שבמפעל נשלח לחשבשבת');
  add('mid', 'שליחה לחשבשבת שנכשלה', os.filter(o => o.hashavshevet && o.hashavshevet.httpOk === false).map(label), null);

  // ── פריטים ומחירים ──
  const noSku = [], noSize = [], noPrice = new Set();
  os.forEach(o => arr(o.items).forEach((it, i) => {
    if (!it) return;
    if (!it.sku) noSku.push(label(o) + ' · שורה ' + (i + 1));
    if (!(Number(it.w) > 0 && Number(it.h) > 0)) noSize.push(label(o) + ' · שורה ' + (i + 1));
    if (it.sku && !(Number(prices[String(it.sku).toUpperCase()]) > 0)) noPrice.add(String(it.sku).toUpperCase() + ' — ' + (o.orderNum || '?'));
  }));
  add('mid', 'פריט בלי מק"ט', noSku, 'לכל הפריטים יש מק"ט');
  add('mid', 'פריט בלי מידות', noSize, 'לכל הפריטים יש מידות');
  add('low', 'מק"ט שאין לו מחיר כללי (יישלח לחשבשבת ב-0)', [...noPrice], 'לכל המק"טים בהזמנות יש מחיר כללי');
  const past = ['opty', 'workday', 'chisum', 'graphic', 'delivery', 'done'];
  add('mid', 'עברה את השרטט בלי פריטים', os.filter(o => past.includes(o.stage) && !arr(o.items).length).map(label), null);
  add('mid', 'מחיר נעול בלי סכום סופי', os.filter(o => o.pricesLockedAt && !(Number(o.totalFinal) > 0)).map(label), null);

  // ── וואטסאפ ──
  const t = Number(now) || Date.now();
  const inb = arr(d && d.waInbound);
  add('high', 'וואטסאפ נכנס — הודעה תקועה או שנכשלה',
      inb.filter(e => e && (e.state === 'dead' || (e.state === 'processing' && t - (Number(e.claimedAt) || 0) > 10 * 60e3)))
         .map(e => (e.refNum || e.sender || '?') + ' — ' + e.state + (e.reason ? ' (' + e.reason + ')' : '')),
      'כל הודעות הוואטסאפ הנכנסות טופלו');
  const outb = arr(d && d.waOutbox);
  add('high', 'וואטסאפ יוצא — הודעה שנכשלה',
      outb.filter(e => e && /fail|dead|error/i.test(e.state || '')).map(e => (e.kind || 'הודעה') + ' — ' + (e.error || e.reason || e.state)),
      'כל הודעות הוואטסאפ היוצאות נשלחו');
  add('mid', 'וואטסאפ יוצא — ממתין יותר מחצי שעה',
      outb.filter(e => e && e.state === 'pending' && t - (Number(e.createdAt) || 0) > 30 * 60e3).map(e => (e.kind || 'הודעה') + ' — ' + new Date(e.createdAt).toLocaleString('he-IL')),
      null);

  const order = { high: 0, mid: 1, low: 2 };
  problems.sort((a, b) => order[a.sev] - order[b.sev]);
  const byStage = {};
  os.forEach(o => { const s = STAGES[o.stage || ''] || o.stage; byStage[s] = (byStage[s] || 0) + 1; });
  const summary = os.length + ' הזמנות — ' + Object.keys(byStage).map(s => s + ': ' + byStage[s]).join(' · ');
  return { problems, ok, summary };
}

if (typeof module !== 'undefined') module.exports = { lgHealthCheck };
