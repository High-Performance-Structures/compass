# Historical RFQ response viewing

This release makes recovered vendor responses available to authorized internal
staff on the project's RFQ page. It is one cutover stage, not certification of
complete source recovery or a replacement for operational RFQ normalization.

## Behavior contract

- Keep native RFQ cards, approvals, selection-procurement links and estimate
  imports unchanged. Show recovered responses in a separate history section.
- Show drafts, submitted bids, unpriced or incomplete responses, and explicit
  evidence holds. Missing or unsupported evidence must not look like no history.
- Group by exact Buildertrend package identity, not vendor name or project title.
  Missing or ambiguous operational parents remain visible without guessed links.
- Preserve captured line fields, vendor notes, source status and date displays.
  Show a separately captured submitter name when present; do not infer a person
  from the vendor company, date string, or current Compass user.
- Keep original money strings and distinguish captured from derived amounts.
  Submitted, selected or historically approved evidence does not create a new
  Compass approval or an accounting/budget transaction.
- Emit an attachment link only when its exact source identity, source/destination
  bytes and checksums, canonical project ancestry, and persisted viewability
  proof agree. Otherwise show the filename and hold reason without a link.
  Never use a Buildertrend page or preview as the attachment fallback.
- Paginate source records rather than observations, retaining the current RFQ
  filter and exact encoded project route. An empty later page links to page one.

## Access and storage boundaries

The server action is authoritative: require active, non-demo internal staff,
RFQ read permission, organization scope and project access before reading source
rows. Match each record to its exact immutable source observation. The page's
visibility check does not replace those server checks.

The staff DTO excludes raw captures, source URLs, email addresses and recipient
lists. Do not reuse this reader in owner or vendor portals: participant-specific
history requires a separate authorized read model so competing bids cannot leak.

This stage uses existing staging tables. It introduces no migration, approval
action, upload, private-file download service, sharing change, invitation,
notification, budget import or Sage write. Existing Google Drive permissions
still govern linked files; internal verification is not recipient-access proof.

## Release and remaining work

Review this history-only diff on current main, exercise its authorization and
database predicates, and verify the rendered project page before certification.
Local fixtures are not a complete source inventory or a live user journey.

The separate full historical RFQ workflow retains approval snapshots and tests.
It still needs confirmation controls, immutable approval/recovery audit history,
downstream estimate/procurement dependency handling, schema certification and
recipient-specific workflows. No part of that work is declared complete here.

The earlier six-file capture-readiness external-review hold and the private
historical-message download authorization hold remain separate and unresolved.
This viewer must not be used to bypass either hold or export their pending scope.
