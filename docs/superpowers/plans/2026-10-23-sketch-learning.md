# Approved sketch examples implementation plan

> Implementation: execute in the existing isolated sketch-reader worktree.

Goal: Future readings can consult one explicitly approved correction example from the same customer. No model training, copying dimensions, automatic order approval, accounting or WhatsApp action.

Architecture: Archive learning consent in the existing atomic order approval. A server-only, bounded per-customer index points to immutable source runs. Every retrieval revalidates consent, customer, source hash, corrected rows and catalog. Index publication failure must never make a successful order approval appear failed; idempotent approval retry repairs it. Missing examples do not prevent ordinary reading.

- [x] Add pure scope/selection helpers and tests: same customer only; exclude current order/image; valid approved corrected rows; one example maximum; no names/phones sent as metadata.
- [x] Publish approved examples with consent, add revocation API, retrieve a bounded list and validate authoritative approval on each read. Persist example IDs/version for audit; cache keyed by example digest.
- [x] Send prior image + original structured fields + corrected fields as labeled reference data before the target image. Instructions require extracting target alone and preserving uncertainty. Test actual request contract with mock provider.
- [x] Add approval consent, stored-example status/revocation and reading example count in existing UI; no paid call on approval/toggle.
- [x] Test API opt-in/out/retry/revoke/isolation; browser interaction; run regression suite. Review, deploy TEST only, enable server flag and verify live assets/API. No paid reads during development; quality improvement remains to be measured on unseen sketches.

Current client aliases and images are not proof of handwriting similarity. First version scopes by stable customer identity; no cross-customer/general promotion. Example adds image tokens/cost, included in measured usage. Historical approvals remain excluded unless explicitly enabled by administrator.

Verified: 140 scripts passed. Pending deployment readiness/live asset verification at commit time; no paid accuracy evaluation.
