# Historical change-order initiation and approval

## Interim boundary

Buildertrend imports currently carry a project-level requester name and a hardcoded owner requester type. Those fields do not establish who initiated an individual change order. Approval, signature, audience, title, free-text reason, and budget treatment must not be used to infer initiation or a structured change purpose.

Shared list and detail views therefore show imported records with “Initiator: Not verified from Buildertrend” and “Purpose: Not classified.” The existing Buildertrend approval display remains separate. Historical import events say “Historical record imported.” Native request attribution and workflow remain unchanged. Stored scope, reason, requester, money, status, signature, budget, and accounting data are not rewritten by this patch.

## Read and future-import contract

The read model accepts `requester_type = unknown` only when `source_type = buildertrend_import`. This is a recorded data state, not an authenticated creator role or access grant. Existing authorization continues to use viewer identity, requester user ID, publication status, and audience.

For the existing supported captures, the future import generator emits `unknown` and a neutral requester name. Import history metadata retains the former project-level name as `projectAssociation` with `scope = project_level_import_association` and `sourceVerifiedForChangeOrder = false`. `initiatorProvenance.status = unknown` explains the absent independent initiator evidence. Existing sealed captures and generated packages are not regenerated. The generator retains its existing bounded project allowlist; the presentation fix applies to every Buildertrend-imported change order.

Do not apply newly generated unknown-requester rows to an older runtime that rejects that value. No migration is needed for the existing text column. Existing generated packages continue to contain legacy attribution until separately reviewed; this patch does not repair them or production data.

## Later source-backed repair

Verified initiator, approver/signature history, and change purpose need separate reviewed provenance before the UI can assert them. Unknown remains unknown. A cost variance or budget reallocation must not be presented as owner-requested scope merely because the owner accepted it. Preserve original evidence and existing enriched scope/reason; do not classify all records from one example. The Cutover task owns the source audit and any guarded production repair. This patch performs no production writes or deployment.
