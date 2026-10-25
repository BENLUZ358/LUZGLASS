# DevBrain relay text pilot

Implementation scope: LuzGlass server side only, managed isolated worktree based on main (98ada106). DevBrain local client is implemented separately. GREEN webhook URL remains unchanged.

The feature defaults OFF. No live configuration was enabled. No deployment, push, provider requests, secrets access, or live database access is part of this change. Local processing runs only while the PC is on and the local worker is running. This is a text pilot: raw media events are not archived by the relay and continue through the original customer pipeline.

## Capture and isolation

After existing GREEN token and instance authentication, intercept only incoming owner private textMessage, extendedTextMessage, and quotedMessage current text. Store the original JSON event, never headers, under server-only devBrainRelay. idMessage must be a nonempty string of at most 200 characters; instance must contain 5..20 digits; current text must be nonblank. Canonical JSON nesting is limited to depth 32 and invalid/deep input returns 400. Text over 20,000 characters or whole JSON over 65,536 UTF-8 bytes is rejected, never truncated. Other senders, groups, outgoing and media retain the existing pipeline.

Enable only with DEV_BRAIN_RELAY_ENABLED exactly true, a normalized Israeli mobile DEV_BRAIN_RELAY_OWNER (05 plus eight digits, or 9725 plus eight digits; formatting accepted, arbitrary characters rejected), random lowercase 64-hex DEV_BRAIN_RELAY_TOKEN, and DEV_BRAIN_RELAY_PROJECT matching FIREBASE_SERVICE_ACCOUNT project_id (lussglass or luz-glass-test). Identifiable owner text with invalid enabled configuration returns 503. Storage failure returns 500 for GREEN retry. Duplicate event keys are create-once; changed content at the same key returns 409.

## Exact local protocol

POST /api/devbrain-relay requires Authorization: Bearer <hex64 token> and X-DevBrain-Project: <projectId>.

Claim body: {action:'claim',workerId:<8..100 letters/digits/underscore/hyphen>}.
Response: {projectId,entry:null|{key,sourceHash,raw,leaseToken,leaseUntil,decision:null|'customer'|'development'|'review'}}.
Key is SHA256(JSON.stringify([projectId,String(idInstance),String(idMessage)])). sourceHash is SHA256 of recursive sorted-object-key canonical JSON; array order and ordinary JSON primitives are preserved.

Claim scans availableAt ordered limit 50 and atomically leases one eligible valid owner/project/instance record for 60 seconds with a cryptorandom token. Transactions support Firebase null-first cache probes. Terminal availableAt is Number.MAX_SAFE_INTEGER.

ACK body: {action:'ack',key,leaseToken,decision}. No arbitrary path, raw replacement, URL, or recipient is accepted. Frozen customer decisions are returned on future claims and cannot be changed. A customer ACK persists handoff_pending before calling the extracted original post-auth customer handler, keeping its allowlist and existing create-once inbox. A recorded:boolean response completes with durable handoff:{disposition:'inbox'}. An explicit 200 {ok:true,ignored:<known reason>} completes with durable state:'done' and handoff:{disposition:'manual',reason:<fixed bounded original parser/filter reason>}; this acknowledges the original manual/business path, not an inbox insertion. The allowlist and parser are preserved. Failed or unexpected callbacks return 500 and retain handoff_pending. Successful ACK responses are {projectId,ok:true,state:'done',decision}; customer receipts also include disposition:'inbox'|'manual'. Terminal retries return the persisted disposition. All route responses set Cache-Control: no-store. Replay has no externally supplied bypass flag. Every mutation is lease fenced; late callbacks cannot finalize a newer lease. Same terminal decision and retained lease identity make lost-response ACK retries idempotent. Development/review decisions are terminal without order processing.

No AI or WhatsApp outbound calls are added. Only LuzGlass holds its existing database credentials. No business-data copies are supplied to DevBrain. Database rules add only a denied devBrainRelay namespace and availableAt index.

## Verification and limits

Offline tests use scripts/_fake-db.js with null-first transactions. Coverage includes auth, defaults/config/scope, owner and text boundaries, sizes, identifiers, duplicate/collision/hash, concurrent claims, expiry/stale leases, frozen and failed handoffs, lost ACK, callback races, allowlist, external bypass attempts, and original customer processing. Initial red: AssertionError: relay implementation must exist. This is a baseline existence red, not an assertion that every later behavior was individually observed failing first.

No live Firebase or provider integration was tested. Original customer text parsing, including its existing order recognition and length behavior, remains unchanged. A customer classification ignored by the original parser or allowlist receives a durable manual receipt, never an inbox insertion claim. The parent local inbox surfaces manual customer receipts for operator mark-handled only, and must never promote a frozen customer decision into a development task. Truly failed or unexpected handoffs remain pending.
