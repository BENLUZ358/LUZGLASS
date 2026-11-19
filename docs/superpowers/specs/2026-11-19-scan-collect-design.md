# Scan to mark collected (בן, 19/11)

## Why
The customer's driver collects glass and nobody marks "נאסף" in time, so tracking lags.
After tempering, Ben sticks the customer label (it already carries a signed QR, see the
2026-11-17 glass-barcode spec). The driver scans it, sees the sketch and taps
"הזמנה נאספה". The order moves to collected and the system records when and how.

## Decisions (Ben)
- The scanner is the **customer's driver**, who is not signed in. The button works without a login.
- One scan marks the **whole order** collected.
- Approach **א**: a button on the existing scan page `g.html`. Security comes from the signed
  QR (HMAC over orderId|idx); a typed confirmation code was rejected.
- The record must be kept: when it was collected, that it was by scan, and which glass.

## Approaches considered
- **א (chosen):** a button on `g.html`. The server checks the signature and writes the stage.
  Lowest friction, and it reuses the existing page and API.
- ב: as א, plus the driver types the last 4 digits of the customer's phone. Rejected:
  it slows the driver and the signature already proves he holds the glass.
- Login-only: impossible, since the driver has no user.

## Design
- **Server.** In `api/_glass-qr.js`, add a POST action `collect` to `handleGlass`.
  - It verifies the code like the view does (`lgGlassParse` + `lgGlassFind`). Bad or missing code → 404.
  - It writes `orders/<id>`: `stage:'collected'`, `status:'נאסף'`, `updatedAt`, and
    `scanCollect:{at, glassNo, name?, early?}`.
  - `name` is optional and is cut to 40 characters.
- **Already collected.** The server writes nothing and returns `already`, with the time.
- **Stage before ready** (still in production or tempering, i.e. not `done` or `delivery`):
  - Ben did not answer this; my call, as proposed in the conversation: **mark collected anyway**
    and set `scanCollect.early=true`, so the driver is never stuck.
  - Admin shows "⚠ נאסף בסריקה לפני מוכן" on that order.
  - No WhatsApp alert, to avoid noise. Easy to add later.
- **Page `g.html`.**
  - Add a big green "✓ הזמנה נאספה" button above "כנס לראות", with an optional "שם הנהג" field.
  - Ask once to confirm: "לסמן את כל ההזמנה (N זכוכיות) כנאספה?"
  - After the tap, show "✓ נרשם שנאסף · HH:MM".
  - If the order is already collected, show "כבר נאסף ב־… " and no button.
  - The view response (GET) adds `stage` and `scanCollect`, so the page knows what to show.
- **Admin.**
  - The order modal and board show "📱 נאסף בסריקה HH:MM (שם)".
  - Undo uses the existing stage change back to מוכן. It also clears `scanCollect`.
- **Untouched.** Prices, the portal, the invoice queue rules (collected orders flow into
  invoicing as today), and the brokenChisum records. Open broken pieces keep their own
  redo flow.

## Left to the builder
- Exact styling.
- Tests: signature required; already collected; early flag; name trimming; GET exposes no
  prices and no phone.
