# Buildertrend correspondence evidence report — 2026-09-05

## Disposition

The available Buildertrend correspondence evidence is **not ready for external publication**. This report records the evidence that can be quantified and the gaps that keep participant/project histories Partial or Held. It does not certify an exhaustive source denominator, restore a source bundle, grant access, send notifications, or write production data.

The offline reconciler is [`scripts/build-buildertrend-correspondence-evidence.mjs`](../../scripts/build-buildertrend-correspondence-evidence.mjs). It accepts a JSON source package with stable source IDs, explicit body evidence, original sender/recipient evidence, thread evidence, attachment transfer evidence, project mappings, and participant/project expected inventories. It emits counts and one `ready`/`partial`/`held` disposition per participant/project. The emitted report contains no body text, participant names/emails, or Bcc identities.

## Quantified evidence available

The retained September 3 payload-field audit reports one bounded set of **130 valid JSON rows**. It records **29 exact route/body/message/activity records** and **101 route-plus-generic page-text records**. The 101 generic rows are excerpt/page evidence only and must not be promoted as message bodies. The 29-row result is a bounded payload observation, not an all-message denominator. Artifact metadata: `artifacts/buildertrend-lead-message-payload-field-audit-2026-09-03.json`, SHA-256 `3437a59fcb1ded5610eb5661cf87e38bd0b9783148cde80981da023eceddcdae`.

The historical archive-only package describes **95 source activity IDs**, **39 exact route/body rows**, and **56 held rows**; **10** of those exact rows already existed as legacy interactive rows, leaving **29** exact rows in that package's additive archive observation set. Its recipient UI capture found **zero explicit To/Cc/Bcc/Recipient values** and one source-labeled attendee set. Attendees, assigned users, creators, and initiators are retained as source evidence only; they do not establish a sender, recipient, Compass account, or project grant.

The retained bounded Drive metadata search reports no named sealed lead-message source bundle, source activity register, or message archive filename. It found possible spreadsheets, but did not fetch their contents. This is a bounded search result, not a global absence claim. Artifact metadata: `artifacts/buildertrend-cutover-process-review-2026-09-05/source-bundle-drive-search.json`, SHA-256 `3c1d8d819b42537f46e97f3a8e7bebc2152605ed9f640b4e5535e0b8f3bd49c0`.

## Evidence classifications

The reconciler treats a body as `exact` only when the source package explicitly marks `bodyEvidence.kind: "exact"` (or the legacy `exactSource.exactBody` field) and verifies its optional SHA-256. `preview`, `fullText`, and generic `pageText` are classified as `excerpt`; missing values remain `missing`.

Stable source IDs are required for accounts, projects, conversations, messages, participants, and attachments. Duplicate IDs, whitespace/control characters, unknown references, cross-project message references, or mismatched attachment parents fail validation. Subject similarity, display names, company names, shared projects, email strings in bodies, and fuzzy aliases never grant access.

`ready` requires a proven canonical project mapping, proven participant identity and project entitlement, expected source messages present and visible through proven source recipient evidence, exact bodies, proven threading, and byte-verified expected attachments. A participant/project with a proven identity but body, recipient, threading, or attachment gaps is `partial`. Unproven identity, entitlement, or project mapping is `held`. Bcc evidence contributes only an aggregate count; Bcc identities are never emitted.

## Current holds and next evidence

- Restore or replace the sealed source bundle and reseal it against an exhaustive authenticated source scope. The 130-row audit and historical 95/39 package cannot supply that denominator.
- Capture original To/Cc/Bcc and source visibility per message. Do not infer recipients from authors, attendees, quoted text, page labels, or body content.
- Capture stable source thread/reply relationships and attachment IDs with verified preserved bytes. A retained Buildertrend URL is provenance and does not establish a usable body or file.
- Reconcile every source job/lead alias to a canonical project before participant previews. A staff archive or preview membership is not an external identity or entitlement check.
- Run the reconciler offline against a frozen source package, inspect every Partial/Held reason, and keep the output as a review artifact. No output is a publication manifest.

## Usable source formats

The utility currently accepts one explicit JSON source-package format. JSON Lines, CSV exports, screenshots, list/register previews, and HTML page text are not accepted as exact correspondence input unless converted into the package with explicit evidence classifications and stable IDs. Keep raw captures outside tracked reports; store only hashes, counts, classifications, and review reasons in the report.

### Rendered-message recapture intake mapping

The retained `buildertrend-rendered-message-recapture/v1` handoff contains two rendered records from one explicitly bounded message-list view. Its list-scope fields describe the selected folder, filters, page range, and denominator boundary; they do not establish a complete job history. Artifact metadata: `buildertrend-o58-message-recapture-20260905.json`, SHA-256 `ae60f0f9cfc1f05455f12475ba39b0c7796a889636326b2995d538a8125bea5b`.

The records can be held for review using this mapping:

| Recapture field | Evidence-package handling |
| --- | --- |
| `sourceMessageId` | Preserve as the stable message identifier. `sourceUrl` is provenance only. |
| `subject`, `fromDisplay`, `toDisplay`, `ccDisplay` | Retain as reviewed display evidence. Display names and header text do not establish Compass identities or grants. |
| `bodyText` | Candidate rendered-body evidence. Do not split quoted history into new messages or recipients; an exact-body classification still needs the reviewed capture/hash decision. |
| `sentDisplay` | Preserve the original label. It cannot populate normalized chronology until an explicit source timezone is proven. |
| `fromExpanded` | UI capture metadata only; it does not prove the sender account. |
| `quotedHistoryIncludedInBody` | Mark the body as containing quoted history. Treat quoted headers as body evidence, separate from the outer To/Cc/Bcc grant set. |
| `embeddedImageCount` | Count-only attachment evidence. Without stable attachment IDs and byte verification, attachments remain incomplete. |
| `listScope` | Scope metadata for reconciliation; it is not an exhaustive source denominator. |

There is no additional importer semantic blocker beyond the evidence gaps already identified, but this handoff cannot be passed directly to the current package validator. It lacks `sourceAccountId`, source project/conversation IDs, proven sender and per-message recipient identities, explicit Bcc status, timezone-bearing timestamps, proven thread relationships, attachment records, and participant/project entitlement expectations. An offline adapter may create a held review record for each capture, but it must not invent those fields, derive grants from quoted headers, or promote the records to `ready`/publication input until reviewed enrichment supplies them.

Source package shape (abridged):

```json
{
  "sourceAccountId": "account-1",
  "capturedAt": "2026-09-05T12:00:00Z",
  "projects": [{"sourceProjectId":"job-1","canonicalProjectId":"project-1","mappingStatus":"proven"}],
  "conversations": [{"sourceConversationId":"thread-1","sourceProjectId":"job-1","subject":"..."}],
  "messages": [{
    "sourceMessageId":"message-1",
    "sourceConversationId":"thread-1",
    "sourceProjectId":"job-1",
    "sender":{"sourceParticipantId":"staff-1","evidence":{"status":"proven"}},
    "bodyEvidence":{"kind":"exact","value":"..."},
    "recipientEvidence":{"status":"proven","to":[{"sourceParticipantId":"owner-1","evidence":{"status":"proven"}}],"cc":[],"bcc":[]},
    "threadEvidence":{"status":"proven","sourceThreadId":"thread-1"},
    "sourceAttachmentIds":[]
  }],
  "attachments": [],
  "participantProjects": [{
    "participant":{"sourceParticipantId":"owner-1","evidence":{"status":"proven"}},
    "sourceProjectId":"job-1",
    "projectEntitlementEvidence":{"status":"proven"},
    "expectedSourceMessageIds":["message-1"],
    "expectedSourceAttachmentIds":[]
  }]
}
```

The package is an offline inventory/reconciliation input. It performs no database, Drive, Buildertrend, invitation, notification, or publication operation. The retained status ledger used for gap context is `artifacts/buildertrend-cutover-status-2026-09-03.json`, SHA-256 `7ee029abfcc52ad649fa9939ce943cf7191e8df3b4c00346c682781346e678fc`.
