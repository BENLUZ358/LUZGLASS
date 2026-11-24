// ═══════════════════════════════════════════════════════════════════
//  portal-cards.js — כניסה אחת לכמה כרטיסים (בן, 24/11: "אותו המשתמש של המקום לאמבט
//  ומבפנים לעשות סינון של הר מקלחונים / המקום לאמבט / כתר מקלחונים").
//  users/<טלפון>/portalCards = { '<כרטיס>': '<שם>' } — ההזמנות של הכרטיסים האלה נרשמות
//  על הטלפון הזה (api/_wa-recipient.js lgLoginForCard), והפורטל מציג כפתור לכל כרטיס.
//  טהור: דפדפן וגם Node (scripts/test-portal-family.js).
// ═══════════════════════════════════════════════════════════════════

//  כפתור לכל כרטיס: { id, name, n } — הכי הרבה הזמנות קודם. כרטיס אחד בלבד → [] (בלי סינון).
function lgPortalCards(orders, portalCards) {
  const by = {};
  (orders || []).forEach(o => {
    const id = String((o && o.customerId) || '');
    if (!id) return;
    const c = by[id] || (by[id] = { id, name: '', n: 0 });
    c.n++;
    if (!c.name && o.orderClient) c.name = String(o.orderClient);
  });
  Object.keys(portalCards || {}).forEach(id => {
    const c = by[id] || (by[id] = { id, name: '', n: 0 });
    if (!c.name) c.name = String(portalCards[id] || '');
  });
  const list = Object.values(by).map(c => Object.assign(c, { name: c.name || ('כרטיס ' + c.id) }));
  if (list.length < 2) return [];
  return list.sort((a, b) => b.n - a.n || a.name.localeCompare(b.name, 'he'));
}

//  ההזמנות של כרטיס אחד; '' או כרטיס שכבר אין לו הזמנות → הכל
function lgPortalPick(orders, card) {
  const all = orders || [];
  const id = String(card || '');
  if (!id || !all.some(o => String((o && o.customerId) || '') === id)) return all.slice();
  return all.filter(o => String((o && o.customerId) || '') === id);
}

if (typeof module !== 'undefined' && module.exports) module.exports = { lgPortalCards, lgPortalPick };
