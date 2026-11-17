# Avivi Wrap Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** לשונית "אביבי" ב-workday.html: לא מוכן / מוכן לפי סימון עטיפה לכל זכוכית, חיפוש לפי סוף PO או מידה, "יוצאים להובלה".
**Architecture:** לוגיקה טהורה ב-`avivi-wrap.js` (נטען בדף ונבדק ב-node). התצוגה ב-workday.html, ליד לשונית הובלות. שמירה: `orders/<id>/avWrap/<idx> = ts` דרך `updateOrder`.
**Tech Stack:** JS רגיל, Firebase RTDB compat, בדיקות node עם vm.
**Spec:** docs/superpowers/specs/2026-11-17-avivi-wrap-tab-design.md

## Global Constraints
- אביבי = `String(customerId)==='450'` או שם הלקוח מכיל "אביבי".
- מספר ה-PO נמצא ב-`o.sketchName` (למשל `PO26H016504`).
- אין שינוי בחוקי ההרשאות, בחשבוניות או בהודעות. "יוצאים להובלה" = `finalizeDelivery` לכל הזמנה מוכנה.
- הכל מתחיל ב"לא מוכן" (אין כתיבה חד-פעמית).

## Review Focus
- הזמנה בלי פריטים: לעולם לא "מוכנה" (לא נשלחת בטעות).
- `avWrap` עם אינדקס שכבר לא קיים (פריט נמחק): לא נספר.
- חיפוש מידה הפוכה ועם `x`/`*`/`×`/רווח.
- חיפוש מספר בודד: סוף PO או צלע של זכוכית.
- "יוצאים להובלה" לא נוגע בהזמנות לא מוכנות.

### Task 1: avivi-wrap.js + בדיקות
**Files:** Create `avivi-wrap.js`, `scripts/test-avivi-wrap.js`
**Produces:** `lgAvIsAvivi(o)→bool`, `lgAvWrappedIdxs(o)→number[]`, `lgAvIsReady(o)→bool`, `lgAvSplit(orders)→{notReady,ready,inWork}` (ready/notReady = stage 'delivery'; inWork = stage לא 'delivery'/'done'/'collected'), `lgAvMatch(o, q)→{hit:bool, idxs:number[]}`.
- [ ] בדיקות לכל אחד מה-Review Focus + הפרדה בין שלבים → נכשלות
- [ ] מימוש → עוברות → commit

### Task 2: הלשונית ב-workday.html
- [ ] לשונית `tab-avivi` + `view-avivi`, ב-setTab / renderAll / מונה (`notReady.length`); מסתירים כפתור סיום וסרגל סיכום.
- [ ] `_renderStageTab('delivery')` מדלג על הזמנות אביבי; גם המונה של הובלות.
- [ ] תצוגה: חיפוש (שומר את הטקסט בין ציורים), שני חלקים, כפתור לכל זכוכית + "עטפתי את כל ההזמנה", "יוצאים להובלה (N)" עם אישור.
- [ ] בדיקה בדפדפן מקומית עם נתונים מזויפים → commit.

### Task 3: שחרור
- [ ] כל הבדיקות של הנושא עוברות; push ל-main (fast-forward), בדיקה ב-luzglass.vercel.app.
