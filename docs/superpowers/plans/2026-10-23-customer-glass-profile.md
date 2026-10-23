# Customer glass recognition profiles

Goal: Make each verified uploading customer's profile visible and improve glass/type/thickness/processing recognition using that customer's approved notation-to-SKU mappings.

Architecture: Extend the existing consented per-customer archive/index. Optional `glassNotation` per corrected row captures the actual wording on the sketch, explicitly entered/confirmed by the admin. Derive at most12 unambiguous notation mappings from the last20 consented approvals; do not infer a default product from frequency. Use current catalog definitions only when archive catalogHash matches. Conflicting notation/SKU mappings remain conflicts and never pick a winning default. Examples and glossary are isolated by verified identity, exclude same target order/source, honor revocation and participate in cache/pre-dispatch checks. Existing one-image example budget remains unchanged.

- [x] Failing tests for notation validation, customer isolation, revocation, SKU meaning changes and conflicting definitions.
- [x] Add bounded context/profile derivation and include explicit glass metadata with approved corrections. Save catalogHash in approvals.
- [x] Label glossary as untrusted data in model instructions; require a visible local matching notation/attributes in target before suggesting SKU, null otherwise.
- [x] Add compact per-customer profile and optional glass-notation field to reader, preserve it across edits/renders and explicit approval.
- [x] Test provider request, API lifecycle and WebKit mobile. Review, run regression suite, deploy TEST only, verify live.

No model fine-tuning, automatic SKU replacement, paid development reads, historical backfill, accounting or WhatsApp actions. This extends mechanisms; accuracy on unseen sketches must still be measured.

Validation: 141 script files passed; review complete. Deployment verification follows commit; no paid accuracy evaluation.
