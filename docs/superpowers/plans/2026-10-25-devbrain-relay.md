# DevBrain relay implementation plan

**Goal:** Deliver only the default-off LuzGlass text relay and preserve the exact parent client protocol.

**Architecture:** Pure handleRelay(req,deps) and maybeCaptureOwner(raw,deps), lazy Firebase route wrapper, and a minimal post-auth inbound hook. Replay reuses the extracted original customer handler and its durable create-once inbox.

**Tech stack:** CommonJS Node.js, built-in crypto, existing Firebase Admin and fake database.

**Spec:** ../specs/2026-10-25-devbrain-relay-design.md

## Scope and execution record

- [x] Confirm isolated worktree HEAD equals main at 98ada106; inspect relevant source and fake database. No AGENTS.md found in relevant worktree/ancestor locations.
- [x] Write/run initial failing test before source implementation (missing relay module assertion).
- [x] Implement api/_devbrain-relay.js capture, canonical identity, bounded claims, lease fencing, frozen durable handoff and idempotent ACK.
- [x] Implement api/devbrain-relay.js with lazy server-only database initialization and scope check.
- [x] Modify api/wa-inbound.js only to intercept after auth and reuse extracted post-auth customer logic.
- [x] Add only denied devBrainRelay namespace with availableAt index in database.rules.json.
- [x] Expand scripts/test-devbrain-relay.js with offline protocol, race, failure and original customer integration coverage.
- [x] Run relay, wa-inbound, env-isolation, wa-text-inbound and wa-text-order tests.
- [ ] Parent review. Do not commit, deploy, push, enable configuration, call providers, or access live database.

There is no root npm test script. Targeted existing scripts are used for relevant verification. No dependencies or files outside the approved write set are changed. The local DevBrain repository remains read-only. This is a text pilot; raw media is not archived. Local processing requires the PC and worker to be on. No live configuration is enabled.

## Parent review fixes

- [x] Exact ACK completion fields state:'done' and frozen decision on every successful ACK, including terminal retries.
- [x] Strict mobile owner, string message ID <=200, 5..20-digit instance, nonblank text, canonical depth <=32 and safe capture400.
- [x] Cache-Control: no-store on route responses.
- [x] Persist manual versus inbox customer receipt before successful ACK; preserve disposition on lost-ACK retry. Original ignored sender/not-a-sketch paths remain unchanged and create no inbox or order.
- [x] Failed or unexpected callbacks retain frozen handoff_pending and return500. Parent local inbox displays manual customer receipt with mark-handled only; customer decision cannot become development.

Review regression initial red: successful ACK state was undefined instead of done. Expanded offline coverage includes real original-parser and allowlist manual receipts.
