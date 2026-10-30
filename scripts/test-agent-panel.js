#!/usr/bin/env node
/** לשונית "סוכנים · ניסיון" בקליטות — תצוגה בלבד. Run: node scripts/test-agent-panel.js */
const path = require('path'), fs = require('fs'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
let failed = 0;
const check = (name, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
  ? console.log('ok    ' + name)
  : (failed++, console.error(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));

const ctx = { console, Date, Intl };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'wa-inbound-panel.js'), 'utf8'), ctx);
const A = fs.readFileSync(path.join(ROOT, 'admin.html'), 'utf8');
const P = fs.readFileSync(path.join(ROOT, 'wa-inbound-panel.js'), 'utf8');

const rec = (over) => ({ idMessage: 'M1', chatId: 'c', linked: true, customerName: 'דנה', text: 'איפה ההזמנה שלי?',
  intent: 'status', route: 'okev', wouldReply: 'קיבלנו, ההזמנה בבדיקה', state: 'done', createdAt: 1759650005000, ...over });

// תוויות
check('intent labels', ['status','cancel','change','document','quote','order','chitchat','thanks','unclear','zzz']
  .map(ctx.lgAgIntentLabel), ['איפה ההזמנה','ביטול','שינוי','מסמך','הצעת מחיר','הזמנה','שיחה','תודה','לא ברור','zzz']);
check('route labels', ['okev','kolet','archive','quote','menu','none','ignore','shaul','silent-human']
  .map(ctx.lgAgRouteLabel), ['עוקב','קולט','ארכיון','מחירון','תפריט','בלי תשובה','מתעלם','לשאול','שותק (ענו ידנית)']);

// שורה
const h = ctx.lgAgRowHtml('K1', rec());
check('row shows customer, text, intent, route, would-reply',
  ['דנה','איפה ההזמנה שלי?','איפה ההזמנה','עוקב','היה עונה:','קיבלנו, ההזמנה בבדיקה'].every(s => h.includes(s)), true);
check('row has two verdict buttons with key', [/data-agv="1"/.test(h), /data-agv="0"/.test(h), /data-key="K1"/.test(h)], [true, true, true]);
check('no red flag for plain status', h.includes('נקלטה גם כהזמנה'), false);
check('unlinked → "לא מקושר", no text', (() => { const x = ctx.lgAgRowHtml('K2', rec({ linked: false, text: undefined, customerName: undefined, route: 'shaul', intent: 'unclear', wouldReply: undefined }));
  return [x.includes('לא מקושר'), x.includes('לשאול'), x.includes('היה עונה:')]; })(), [true, true, false]);
// האדום משקף קליטה אמיתית: רשומת waInbound באותו מפתח, לא נדחתה; intakeKind לבד לא מספיק
const RED = 'נקלטה גם כהזמנה';
const ib = { 'M1': { state: 'done' }, 'P_1': { state: 'rejected', kind: 'pdf' }, 'C1': { state: 'closed', closedFrom: 'rejected' },
             'C2': { state: 'closed', closedFrom: 'failed' } };
check('free text dropped by intake (no waInbound) → no red', ctx.lgAgRowHtml('K3', rec({ idMessage: 'T9', intakeKind: 'text' }), ib).includes(RED), false);
check('intakeKind alone (no intake map) → no red', ctx.lgAgRowHtml('K3', rec({ intakeKind: 'image', idMessage: 'M1' })).includes(RED), false);
check('waInbound record exists + non-order intent → red', ctx.lgAgRowHtml('K3', rec({ intakeKind: 'image' }), ib).includes(RED), true);
check('waInbound record + order intent → no red', ctx.lgAgRowHtml('K4', rec({ intakeKind: 'image', intent: 'order' }), ib).includes(RED), false);
check('pdf rejected → no red', ctx.lgAgRowHtml('K8', rec({ idMessage: 'P.1', intakeKind: 'pdf' }), ib).includes(RED), false);
check('closed after rejected → no red', ctx.lgAgRowHtml('K9', rec({ idMessage: 'C1', intakeKind: 'pdf' }), ib).includes(RED), false);
check('closed after failed → red', ctx.lgAgRowHtml('K10', rec({ idMessage: 'C2', intakeKind: 'image' }), ib).includes(RED), true);
check('agents tab passes waInbound map to the row', /lgAgRowHtml\(r\.key,\s*r,\s*raw\.whatsapp\)/.test(P), true);
const x = ctx.lgAgRowHtml('K5', rec({ text: '<img src=x onerror=1>"', customerName: '<b>x</b>', wouldReply: '<script>' }));
check('message text, name and reply are escaped', [x.includes('<img'), x.includes('<b>x'), x.includes('<script>'), x.includes('&lt;img')], [false, false, false, true]);
check('verdict shown, buttons still there', (() => { const v = ctx.lgAgRowHtml('K6', rec({ verdict: { ok: true } })); return [v.includes('נכון ✓'), /data-agv/.test(v)]; })(), [true, true]);
check('verdict false shown', ctx.lgAgRowHtml('K7', rec({ verdict: { ok: false } })).includes('לא נכון ✗'), true);

// רשימה: 100 אחרונות, חדש למעלה
const map = {}; for (let i = 0; i < 120; i++) map['k' + i] = rec({ createdAt: 1000 + i });
const rows = ctx.lgAgRows(map);
check('100 latest, newest first', [rows.length, rows[0].key, rows[99].key], [100, 'k119', 'k20']);
check('empty map', ctx.lgAgRows(null), []);

// חיווט
check('admin.html has third tab', /data-tab="agents"[^>]*>[^<]*סוכנים · ניסיון/.test(A), true);
check('panel listens to waMeta/agentShadow', /ref\(\s*['"`]waMeta\/agentShadow['"`]\s*\)/.test(P), true);
check('panel posts agent-verdict via drain only', [/action:\s*'agent-verdict'/.test(P), /ref\(['"]waMeta\/agentShadow[^)]*\)\.(set|update|remove|push)/.test(P)], [true, false]);
check('no raw innerHTML of message text in agent code', /lgAgRowHtml/.test(P) && !/innerHTML\s*=\s*[^;]*\.text/.test(P), true);

if (failed) { console.error(`\n${failed} FAILED`); process.exit(1); }
console.log('\nAll agent-tab checks passed.');
