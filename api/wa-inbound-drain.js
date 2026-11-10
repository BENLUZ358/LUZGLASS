// ═══════════════════════════════════════════════════════════════════
//  POST /api/wa-inbound-drain — צד האדמין של קליטות WhatsApp.
//
//    { action:'drain' }               עיבוד מה שממתין (רשת ביטחון)
//    { action:'retry', key }          "נסה שוב" על קליטה קיימת
//    { action:'close', key, note }    "טופל ידנית" — סימון + audit
//
//    { action:'agent-verdict', key, ok, note }  סימון נכון/לא נכון על רשומת צל
//                                     של סוכני הלקוחות (30/10; ללא channel — לא שייך לערוץ)
//    { action:'agent-pilot', customerId, on }  הדלקה/כיבוי של פיילוט הסוכנים ללקוח
//                                     (waMeta/agentPilot/<customerId> === true; 31/10)
//    { action:'agent-cancel-done', key }  "בוצע בחשבשבת" על ביטול מהסוכן
//                                     (waMeta/agentCancels/<key>; דף תיקון הזמנות, 31/10)
//    { action:'agent-status' }        לוח הבקרה: אילו מתגים / משתנים מוגדרים — בוליאנים בלבד
//    { action:'agent-dismiss', kind, key, ver }  "טופל" על כרטיס בלוח הבקרה
//                                     (waMeta/agentDash/dismissed/<kind>_<key>; agents.html, 31/10)
//
//  'drain' משלים גם רשומות צל תקועות (waMeta/agentShadow) — רק כש-
//  AGENT_SHADOW_ENABLED === 'true', עד BATCH, בתוך אותו תקציב. התוצאה בשדה נפרד
//  agentShadow:{processed,failed}; כשל שם לא משנה את שאר התשובה.
//
//  channel:'email' (20/10) — אותן שלוש פעולות על התור של המייל
//  (emailInbound, api/_email-inbound.js). בלי channel — WhatsApp, כמו תמיד.
//  קישור קבוצות נשאר של WhatsApp בלבד.
//
//  ─── למה זו רשת ביטחון ולא מנגנון שני ──────────────────────────────
//
//  ה-webhook מעבד ב-waitUntil, וזה בדרך כלל מספיק. אבל waitUntil אינו
//  ערובה: פונקציה שמתה באמצע משאירה רשומה ב-received / processing. כשאדמין
//  פתוח, הדף קורא לכאן, וזה עובר על **אותו תור** (waInbound) דרך **אותה
//  פונקציה** (lgWaInboundProcess) ו**אותה תפיסה** בטרנזקציה. אין כאן שום
//  לוגיקת עיבוד משלו — ולכן webhook + שתי לשוניות + retry במקביל מתנגשים
//  בטרנזקציה, ורק אחד מהם עובד על כל קליטה.
//
//  פונקציה אחת לשלוש הפעולות בכוונה: Vercel Hobby מגביל ל-12 פונקציות.
//  אפיון: docs/superpowers/specs/2026-10-04-whatsapp-sketch-intake-design.md §2.2, §2.5
// ═══════════════════════════════════════════════════════════════════

const { lgWaInboundKey, lgWaInboundPending, lgWaInboundProcess,
        lgWaInboundRetry, lgWaInboundClose } = require('./_wa-inbound');
const { lgAgentShadowPending, lgAgentShadowProcess, lgAgentShadowVerdict } = require('./_agent-shadow');
const { AGENT_CANCELS } = require('./_agent-act');
const { lgEmailKey } = require('./_email-recipient');
const { lgEmailInboundKey, lgEmailInboundPending, lgEmailInboundProcess,
        lgEmailInboundRetry, lgEmailInboundClose } = require('./_email-inbound');

// כמה קליטות בקריאה אחת, ותקציב זמן — מתחת ל-maxDuration (60) עם מרווח
const BATCH = 5;
const BUDGET_MS = 40 * 1000;
// R14: נמדד מול מגבלת 60ש׳ של הפונקציה מתחילת ה-drain. רשומת צל (סיווג 20ש׳ + הצעה 20ש׳ +
// שליחה) מתחילה רק אם עברו ≤10ש׳; שליחה מתחילה רק אם נשארו ≥35ש׳. הגבול עצמו — הדדליין
// המוחלט למטה (תיקון סופי 1), לא "מה שנשאר פחות 30ש׳".
const FN_LIMIT_MS = 60 * 1000;
const AGENT_SHADOW_MAX_ELAPSED_MS = 10 * 1000;
const AGENT_SEND_MIN_LEFT_MS = 35 * 1000;
// תיקון סופי 1: דדליין מוחלט אחד לכל עבודת הסוכן ב-drain (צל → act → שליחה),
// 50ש׳ מתחילת ה-drain — מתחת ל-60 עם מרווח. R14 נשאר: הוא מתי *מתחילים*.
const AGENT_CHAIN_MS = 50 * 1000;

const _keyOk = k => typeof k === 'string' && k.length > 0 && k.length <= 200 && lgWaInboundKey(k) === k;
//  סוגי הכרטיסים ב"דורש טיפול" שאפשר להסתיר — כמו lgAdExceptions ב-agents-dash.js.
//  ביטול (cancel) לא ברשימה: הוא נסגר רק ב-agent-cancel-done, אחרי שבוטל בחשבשבת.
const AGENT_DISMISS_KINDS = ['quote', 'send', 'dead', 'unclear', 'wrong'];

//  ⚠️ lgEmailInboundProcess מחזיר { state, reason? } ולא { ok, claimed } —
//  מתורגם כאן לצורה של WhatsApp, כדי שהדף לא יצטרך לדעת מאיזה ערוץ הגיע.
//  לא נתפס = מצב שאינו סופי ואינו failed (מישהו אחר מעבד, או ממתין).
//  ⚠️ הסיבה מגיעה לבן כמו שהיא ("נסה שוב" מציג אותה) — מצב לא סופי מתורגם
//  למשפט בעברית ולא יוצא כ-"processing". סיבה ישנה על רשומה כזו לא רלוונטית.
const _EM_WAIT = {
  processing: 'בעיבוד ממש עכשיו — לנסות שוב בעוד דקה',
  received:   'ממתין לעיבוד',
  missing:    'הקליטה לא נמצאה',
};
const _emResult = r => {
  const ok = r.state === 'done';
  const wait = Object.prototype.hasOwnProperty.call(_EM_WAIT, r.state) ? _EM_WAIT[r.state] : '';
  return { ok, claimed: !wait,
           reason: ok ? '' : (wait || r.reason || 'העיבוד נכשל'), orderIds: r.orderIds };
};
const _emProcess = async (db, key, opts) => _emResult(await lgEmailInboundProcess(db, key, opts));

//  הפונקציות של כל ערוץ — אותו חוזה בדיוק
const CHANNELS = {
  whatsapp: { keyOf: lgWaInboundKey, pending: lgWaInboundPending, process: lgWaInboundProcess,
              retry: lgWaInboundRetry, close: lgWaInboundClose },
  email:    { keyOf: lgEmailInboundKey, pending: lgEmailInboundPending, process: _emProcess,
              retry: lgEmailInboundRetry, close: lgEmailInboundClose },
};

//  הליבה, בלי Vercel ובלי אימות — כדי שאפשר לבדוק אותה.
//  deps: { db, by, now?, fetchImpl? }
async function handleAdmin(body, deps) {
  const b = body || {};
  const action = b.action || 'drain';
  const chName = b.channel || 'whatsapp';
  // hasOwnProperty — 'constructor' / '__proto__' אינם ערוץ
  const ch = Object.prototype.hasOwnProperty.call(CHANNELS, chName) ? CHANNELS[chName] : null;
  if (!ch) return { ok: false, code: 'bad-channel', message: 'ערוץ לא מוכר' };
  const keyOk = k => typeof k === 'string' && k.length > 0 && k.length <= 200 && ch.keyOf(k) === k;
  const opts = { by: 'admin:' + (deps.by || ''), fetchImpl: deps.fetchImpl, now: deps.now };

  if (action === 'drain') {
    const started = Date.now();
    // ⚠️ דדליין מוחלט לכל ה-drain: מייל שמרנדר PDF בודק אותו לפני כל קובץ ועמוד,
    //    ולא פותח 40 שניות חדשות משלו (שהיו נערמות מעבר ל-maxDuration של 60)
    const deadline = started + BUDGET_MS;
    const keys = await ch.pending(deps.db, BATCH, deps.now, { includeExhausted: true });
    const results = [];
    for (const key of keys) {
      if (Date.now() > deadline) break;
      const r = await ch.process(deps.db, key, { ...opts, deadline });
      results.push({ key, ok: r.ok, claimed: r.claimed !== false, reason: r.ok ? '' : r.reason });
    }
    const remaining = (await ch.pending(deps.db, BATCH + 1, deps.now)).length;
    const out = { ok: true, processed: results.filter(r => r.claimed).length, results, remaining };
    // ─── רשומות צל של הסוכנים (30/10): אחרי הקליטות, אותו דדליין ───────────
    //  ⚠️ כשל כאן לעולם לא משנה את השדות הקיימים — רק agentShadow.failed.
    if (process.env.AGENT_SHADOW_ENABLED === 'true') {
      const ag = { processed: 0, failed: 0 };
      const agentDeadline = started + AGENT_CHAIN_MS;
      try {
        const sKeys = await lgAgentShadowPending(deps.db, BATCH, deps.now);
        for (const key of sKeys) {
          if (Date.now() - started > AGENT_SHADOW_MAX_ELAPSED_MS) break;
          try {
            const p = await lgAgentShadowProcess(deps.db, key, { now: deps.now, fetchImpl: deps.fetchImpl, provider: deps.provider, deadline: agentDeadline });
            if (p.ok) ag.processed++; else ag.failed++;
          } catch (_) { ag.failed++; }
        }
      } catch (_) { ag.failed++; }
      //  תור ההודעות של הסוכנים: רשומות pending שנתקעו (act שנקטע, חלון תפוס…).
      //  ⚠️ כשל כאן לא משנה את התגובה; הספירה תחת agentShadow.sent.
      const left = FN_LIMIT_MS - (Date.now() - started);
      if (left >= AGENT_SEND_MIN_LEFT_MS) {
        try {
          ag.sent = await require('./_agent-send').lgAgentSendPending(deps.db,
            { deadline: agentDeadline, provider: deps.provider });
        } catch (_) { ag.sendFailed = true; }
      }
      out.agentShadow = ag;
    }
    return out;
  }

  if (action === 'retry' || action === 'close') {
    if (!keyOk(b.key)) return { ok: false, code: 'bad-key', message: 'מזהה קליטה לא תקין' };
    if (action === 'close') return ch.close(deps.db, b.key, deps.by, b.note, deps.now);

    const rt = await ch.retry(deps.db, b.key, deps.by, deps.now);
    if (!rt.ok) return rt;
    const p = await ch.process(deps.db, b.key, opts);
    return p.ok ? { ok: true, code: '', message: '', orderIds: p.orderIds }
                : { ok: false, code: 'failed', message: p.reason };
  }

  // ─── סימון נכון/לא נכון על רשומת צל (30/10) ───────────────────────────
  //  לא תלוי בערוץ — המפתח נבדק כמו בשאר הפעולות.
  if (action === 'agent-verdict') {
    if (!_keyOk(b.key)) return { ok: false, code: 'bad-key', message: 'מזהה רשומה לא תקין' };
    return lgAgentShadowVerdict(deps.db, b.key, { ok: b.ok, note: b.note, by: String(deps.by || '') }, deps.now);
  }

  // ─── פיילוט הסוכנים ללקוח (31/10) ─────────────────────────────────────
  //  waMeta לא נכתב מהדפדפן — ולכן כאן. on:true → true; on:false → מוסר.
  if (action === 'agent-pilot') {
    const cid = typeof b.customerId === 'string' ? b.customerId.trim() : '';
    if (!cid || !_keyOk(cid)) return { ok: false, code: 'bad-key', message: 'מזהה לקוח לא תקין' };
    if (typeof b.on !== 'boolean') return { ok: false, code: 'bad-on', message: 'חסר ערך הדלקה/כיבוי' };
    await deps.db.ref('waMeta/agentPilot/' + cid).set(b.on ? true : null);
    return { ok: true, code: '' };
  }

  // ─── "סקיצה שנמחקה — פעיל" (בן, 3/11) ─────────────────────────────────
  //  מתג נפרד: רק הפעולה הזו פועלת, לכל לקוח מקושר, גם כשהתשובות כבויות.
  if (action === 'agent-delete-live') {
    if (typeof b.on !== 'boolean') return { ok: false, code: 'bad-on', message: 'חסר ערך הדלקה/כיבוי' };
    await deps.db.ref('waMeta/agentDeleteLive').set(b.on ? true : null);
    return { ok: true, code: '' };
  }

  // ─── לוח הבקרה לסוכנים (agents.html, 31/10) ────────────────────────────
  //  agent-status: אילו משתני סביבה מוגדרים — בוליאנים בלבד, אף ערך לא חוזר לדפדפן.
  // ─── משלוחים לשרטט (בן, 10/11) — api/_drafter-batch.js ───────────────
  //  הנמען קבוע בשרת; שום שדה מהבקשה מלבד action לא נקרא.
  if (action === 'drafter-status' || action === 'drafter-send' || action === 'drafter-done' || action === 'drafter-resend') {
    const DB = require('./_drafter-batch');
    const who = { by: String(deps.by || ''), now: deps.now };
    if (action === 'drafter-resend') {
      const n = Number(b.n);
      if (!Number.isInteger(n) || n < 1) return { ok: false, code: 'bad-n', message: 'מספר משלוח לא תקין' };
      const r = await DB.lgDrafterResend(deps.db, n, who);
      return r.ok ? { ok: true, code: '' } : { ok: false, code: r.code || 'failed', message: 'השליחה החוזרת נכשלה' };
    }
    if (action === 'drafter-status') return { ok: true, code: '', ...(await DB.lgDrafterStatus(deps.db)) };
    if (action === 'drafter-done') return { code: '', ...(await DB.lgDrafterDone(deps.db, who)) };
    const r = await DB.lgDrafterSend(deps.db, who);
    if (!r.ok) return { ok: false, code: r.code, message: 'הסל ריק' };
    const st = r.email && r.email.key ? ((await deps.db.ref('waMeta/emailOutbox/' + r.email.key + '/state').once('value')).val() || '') : '';
    return { ok: true, code: '', n: r.n, orderIds: r.orderIds, emailState: st };
  }
  if (action === 'agent-status') {
    const e = process.env;
    return { ok: true, code: '', status: {
      shadow: e.AGENT_SHADOW_ENABLED === 'true', reply: e.AGENT_REPLY_ENABLED === 'true',
      model: !!e.AGENT_MODEL, key: !!e.OPENAI_API_KEY, staff: !!e.AGENT_STAFF_PHONES,
      summary: !!e.AGENT_SUMMARY_TO, cron: !!e.CRON_SECRET } };
  }
  //  agent-dismiss: "טופל" על כרטיס ב"דורש טיפול" — הסתרה בלבד, הרשומה עצמה לא
  //  משתנה. ver = מתי הרשומה השתנתה; השתנתה שוב → הכרטיס חוזר (lgAdExceptions).
  if (action === 'agent-dismiss') {
    if (!AGENT_DISMISS_KINDS.includes(b.kind)) return { ok: false, code: 'bad-kind', message: 'סוג לא מוכר' };
    if (!_keyOk(b.key)) return { ok: false, code: 'bad-key', message: 'מזהה לא תקין' };
    if (typeof b.ver !== 'number' || !Number.isFinite(b.ver)) return { ok: false, code: 'bad-ver', message: 'חסר זמן עדכון' };
    await deps.db.ref('waMeta/agentDash/dismissed/' + b.kind + '_' + b.key)
      .set({ ver: b.ver, at: deps.now || Date.now(), by: String(deps.by || '') });
    return { ok: true, code: '' };
  }

  // ─── "בוצע בחשבשבת" על ביטול מהסוכן (31/10) ───────────────────────────
  //  waMeta לא נכתב מהדפדפן (rules) — ולכן דרך כאן, מאחורי verifyAdmin.
  if (action === 'agent-cancel-done') {
    if (!_keyOk(b.key)) return { ok: false, code: 'bad-key', message: 'מזהה ביטול לא תקין' };
    const t = deps.now || Date.now(), by = String(deps.by || '');
    // null-first: null → null (לא כותבים כלום); אין רשומה אמיתית → 'missing'.
    // כבר סומן → ok, ומי/מתי הראשונים נשארים (לחיצה כפולה / שתי לשוניות)
    let already = false;
    const tx = await deps.db.ref(AGENT_CANCELS + '/' + b.key).transaction(cur => {
      already = false;
      if (cur === null) return null;
      if (cur.done) { already = true; return; }
      return { ...cur, done: true, doneAt: t, doneBy: by };
    });
    if (already) return { ok: true, code: '' };
    const v = tx.committed && tx.snapshot && tx.snapshot.val();
    if (!v) return { ok: false, code: 'missing', message: 'הביטול לא נמצא' };
    return { ok: true, code: '' };
  }

  // ─── קבוצות (בן, 06/10): קישור קבוצת WhatsApp ללקוח ───────────────────
  //  רק קבוצה שכבר נראתה (waMeta/groupsSeen — נכתב ב-webhook) ורק לכרטיס
  //  חשבשבת קיים. הקישור הוא ההרשאה של הקבוצה, ולכן נכתב רק מכאן.
  if (chName === 'whatsapp' && (action === 'link-group' || action === 'unlink-group')) {
    if (!_keyOk(b.key)) return { ok: false, code: 'bad-key', message: 'מזהה קבוצה לא תקין' };
    const db = deps.db, t = deps.now || Date.now(), by = String(deps.by || '');
    const seen = (await db.ref('waMeta/groupsSeen/' + b.key).once('value')).val();
    if (!seen || !seen.chatId) return { ok: false, code: 'unknown-group', message: 'הקבוצה עוד לא שלחה תמונה — אין מה לקשר' };

    if (action === 'unlink-group') {
      const cur = (await db.ref('waGroups/' + b.key).once('value')).val();
      if (!cur) return { ok: false, code: 'not-linked', message: 'הקבוצה לא מקושרת' };
      const upd = {};
      upd['waGroups/' + b.key] = null;
      upd['waMeta/groupsSeen/' + b.key + '/unlinked'] = { at: t, by, customerId: String(cur.customerId || '') };
      await db.ref().update(upd);
      return { ok: true, code: '', message: '' };
    }

    const cid = String(b.customerId || '').trim();
    const acc = cid && _keyOk(cid) ? (await db.ref('hashavshevetAccounts/' + cid).once('value')).val() : null;
    if (!acc) return { ok: false, code: 'unknown-customer', message: 'כרטיס הלקוח לא נמצא' };
    await db.ref('waGroups/' + b.key).transaction(cur => {
      const prev = cur || {};
      return {
        chatId: seen.chatId, name: seen.name || '', customerId: cid, customerName: String(acc.name || ''),
        linkedAt: t, linkedBy: by,
        audit: { ...(prev.audit || {}), [t + '_link']: { at: t, by, action: 'link', customerId: cid, from: prev.customerId || '' } },
      };
    });
    return { ok: true, code: '', message: '' };
  }

  // ─── מספרים פרטיים (בן, 26/10): אותו דבר כמו קבוצה, למספר בודד ─────────
  //  רק מספר שכבר שלח (waMeta/sendersSeen — נכתב ב-webhook) ורק לכרטיס קיים.
  //  הוספה ידנית (בן, 3/11): link-sender עם manual:true — בן מקליד מספר/כתובת
  //  שעוד לא שלחו, כדי שגם ההודעה הראשונה תיכנס. נרשמת שורת "נראה" עם count 0
  //  ו-manual {at, by}, כדי שניתוק / הסתרה יעבדו אחר כך כמו לכל שולח.
  //  הקישור הוא ההרשאה של המספר — לקליטה וגם להודעות שחוזרות אליו.
  //  כתובות מייל (בן, 26/10): אותו דבר בדיוק, בנתיבים של המייל — המפתח הוא
  //  הכתובת עם פסיק במקום נקודה, ונשמרת הכתובת המפוענחת.
  const SENDER_ACTS = ['link-sender', 'unlink-sender', 'ignore-sender', 'unignore-sender'];
  const SENDER_CFG = {
    whatsapp: {
      valid: k => /^0\d{7,11}$/.test(k), decode: k => k, field: 'phone',
      seen: 'waMeta/sendersSeen/', link: 'waSenders/',
      msg: { badKey: 'מספר לא תקין', unknown: 'המספר עוד לא שלח הודעה — אין מה לקשר',
             notLinked: 'המספר לא מקושר', linked: 'המספר מקושר — נתק קודם' },
    },
    email: {
      valid: k => lgEmailKey(k.replace(/,/g, '.')) === k, decode: k => k.replace(/,/g, '.'), field: 'email',
      seen: 'waMeta/emailSendersSeen/', link: 'waMeta/emailSenders/',
      msg: { badKey: 'כתובת לא תקינה', unknown: 'הכתובת עוד לא שלחה מייל — אין מה לקשר',
             notLinked: 'הכתובת לא מקושרת', linked: 'הכתובת מקושרת — נתק קודם' },
    },
  };
  if (SENDER_CFG[chName] && SENDER_ACTS.includes(action)) {
    const cfg = SENDER_CFG[chName];
    if (typeof b.key !== 'string' || !b.key || b.key.length > 200 || !cfg.valid(b.key)) return { ok: false, code: 'bad-key', message: cfg.msg.badKey };
    const db = deps.db, t = deps.now || Date.now(), by = String(deps.by || '');
    const seenRef = cfg.seen + b.key, linkRef = cfg.link + b.key;
    let seen = (await db.ref(seenRef).once('value')).val();
    const manual = !seen && action === 'link-sender' && b.manual === true;
    if (!seen && !manual) return { ok: false, code: 'unknown-sender', message: cfg.msg.unknown };
    const cur = (await db.ref(linkRef).once('value')).val();
    //  הוספה ידנית של מה שכבר מקושר — לא מעבירים בשקט ללקוח אחר (נתק קודם)
    if (action === 'link-sender' && b.manual === true && cur && cur.customerId) return { ok: false, code: 'linked', message: cfg.msg.linked };

    if (action === 'unlink-sender') {
      if (!cur) return { ok: false, code: 'not-linked', message: cfg.msg.notLinked };
      await db.ref().update({ [linkRef]: null, [seenRef + '/unlinked']: { at: t, by, customerId: String(cur.customerId || '') } });
      return { ok: true, code: '', message: '' };
    }
    if (action === 'ignore-sender' || action === 'unignore-sender') {
      if (cur) return { ok: false, code: 'linked', message: cfg.msg.linked };
      await db.ref(seenRef + '/ignored').set(action === 'ignore-sender' ? { at: t, by } : null);
      return { ok: true, code: '', message: '' };
    }

    const cid = String(b.customerId || '').trim();
    const acc = cid && _keyOk(cid) ? (await db.ref('hashavshevetAccounts/' + cid).once('value')).val() : null;
    if (!acc) return { ok: false, code: 'unknown-customer', message: 'כרטיס הלקוח לא נמצא' };
    //  ⚠️ רק אחרי שהכרטיס נמצא — הוספה שנדחתה לא משאירה שורה
    if (manual) await db.ref(seenRef).transaction(cur => cur || { [cfg.field]: cfg.decode(b.key), count: 0, manual: { at: t, by } });
    await db.ref(linkRef).transaction(prevRaw => {
      const prev = prevRaw || {};
      return {
        [cfg.field]: cfg.decode(b.key), customerId: cid, customerName: String(acc.name || ''), linkedAt: t, linkedBy: by,
        audit: { ...(prev.audit || {}), [t + '_link']: { at: t, by, action: 'link', customerId: cid, from: prev.customerId || '' } },
      };
    });
    await db.ref(seenRef + '/ignored').set(null);
    return { ok: true, code: '', message: '' };
  }

  // ─── הזמנות מטקסט חופשי (בן, 26/10): אילו לקוחות מורשים ─────────────────
  //  לפי מפתח כרטיס. ההודעה נבדקת מול הרשימה ב-webhook; נכתב רק מכאן.
  if (chName === 'whatsapp' && (action === 'text-customer-add' || action === 'text-customer-remove')) {
    const db = deps.db, t = deps.now || Date.now(), by = String(deps.by || '');
    const cid = String(b.customerId || '').trim();
    const ref = 'waMeta/textCustomers/' + cid;
    if (action === 'text-customer-remove') {
      if (!cid || !_keyOk(cid) || !(await db.ref(ref).once('value')).val()) return { ok: false, code: 'not-enabled', message: 'הלקוח לא מוגדר' };
      await db.ref(ref).set(null);
      return { ok: true, code: '', message: '' };
    }
    const acc = cid && _keyOk(cid) ? (await db.ref('hashavshevetAccounts/' + cid).once('value')).val() : null;
    if (!acc) return { ok: false, code: 'unknown-customer', message: 'כרטיס הלקוח לא נמצא' };
    await db.ref(ref).set({ customerName: String(acc.name || ''), addedAt: t, addedBy: by });
    return { ok: true, code: '', message: '' };
  }

  // ─── חשבוניות לפרטי (בן, 2/11): החשבונית יוצאת למספר שבכרטיס, לא לקבוצה ───
  //  נקרא ב-resolveRecipientWa (רק חשבונית). כרטיס בלי טלפון — לא מאפשרים לסמן.
  if (chName === 'whatsapp' && (action === 'invoice-private-add' || action === 'invoice-private-remove')) {
    const db = deps.db, t = deps.now || Date.now(), by = String(deps.by || '');
    const cid = String(b.customerId || '').trim();
    const ref = 'waMeta/invoiceToPrivate/' + cid;
    if (action === 'invoice-private-remove') {
      if (!cid || !_keyOk(cid) || !(await db.ref(ref).once('value')).val()) return { ok: false, code: 'not-enabled', message: 'הלקוח לא מוגדר' };
      await db.ref(ref).set(null);
      return { ok: true, code: '', message: '' };
    }
    const acc = cid && _keyOk(cid) ? (await db.ref('hashavshevetAccounts/' + cid).once('value')).val() : null;
    if (!acc) return { ok: false, code: 'unknown-customer', message: 'כרטיס הלקוח לא נמצא' };
    if (!String(acc.phone || '').replace(/\D/g, '')) return { ok: false, code: 'no-phone', message: 'אין מספר טלפון בכרטיס הלקוח' };
    await db.ref(ref).set({ customerName: String(acc.name || ''), addedAt: t, addedBy: by });
    return { ok: true, code: '', message: '' };
  }

  return { ok: false, code: 'bad-action', message: 'פעולה לא מוכרת' };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'method not allowed' }); return; }
  try {
    const { verifyAdmin } = require('./_verifyAdmin');
    const auth = await verifyAdmin(req);
    if (!auth.ok) { res.status(auth.status).json({ error: auth.error }); return; }

    const { getApps } = require('firebase-admin/app');
    const { getDatabase } = require('firebase-admin/database');
    // verifyAdmin כבר אתחל את האפליקציה עם הכתובת של הסביבה
    const db = getDatabase(getApps()[0]);

    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch (_) { body = {}; } }
    const r = await handleAdmin(body, { db, by: auth.phone });
    res.status(200).json(r);
  } catch (e) {
    console.error('wa-inbound-drain: unexpected', e && e.name);
    res.status(500).json({ error: 'internal error' });
  }
};
module.exports.handleAdmin = handleAdmin;
module.exports._emResult = _emResult;   // לבדיקות
module.exports._CHANNELS = CHANNELS;    // לבדיקות — להחליף process בכפיל
