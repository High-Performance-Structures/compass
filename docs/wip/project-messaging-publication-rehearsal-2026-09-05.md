# Buildertrend correspondence publication rehearsal — 2026-09-05

The publication builder is an **offline rehearsal generator**. It does not read Buildertrend, Compass, Drive, or D1 and never executes its generated SQL. It accepts a reviewed canonical manifest and produces a transaction SQL package, a rollback SQL package, and a reconciliation report.

Use [`scripts/build-buildertrend-correspondence-publication.mjs`](../../scripts/build-buildertrend-correspondence-publication.mjs) with:

```bash
node scripts/build-buildertrend-correspondence-publication.mjs reviewed-manifest.json rehearsal-package.json
```

Keep the package outside tracked artifacts when it contains real message bodies. Tests use only synthetic bodies and execute SQL against an in-memory SQLite fixture created from [`drizzle/0151_project_correspondence.sql`](../../drizzle/0151_project_correspondence.sql).

The reviewed manifest must provide:

- a stable Buildertrend source account, source thread/message/attachment IDs, canonical organization/project, and a proven project mapping;
- a reviewed record with reviewer ID, review timestamp, SHA-256 reference hash, `identityEntitlementsProven: true`, and `quoteReview: "complete"`;
- full `exactBody`, original author presentation and timestamp for every message; excerpt, preview, and page-text fields are rejected;
- current conversation participants with live user IDs, exact name/email/role, and proven identity/project entitlement evidence;
- per-message proven account grants. Grants are message-specific and are never unioned across a thread. Bcc evidence holds the entire message in this first-phase builder;
- attachments only when their bytes are verified, a restricted Drive file ID is supplied, and the attachment owner is a current participant.

Generated publication SQL uses deterministic IDs and collision-safe hash source keys derived from the JSON tuple `[sourceAccountId, sourceMessageId]`. Timestamps must carry an explicit timezone and are normalized to UTC before SQL generation. A guard row checks the live organization/project, active organization membership, current project membership and role, exact participant name/email, source-message body/timestamp/author/request hash, exact baseline grant set, and attachment metadata before any insert. A failed assertion violates the guard table check and rolls back the local SQLite rehearsal transaction. A future D1 publisher must execute the statements through D1 batch semantics; the generated `BEGIN IMMEDIATE` wrapper is for offline SQLite only. Replaying the same manifest is idempotent. A changed body or grant set under the same source key fails closed rather than editing immutable evidence.

Imported rows use `source='buildertrend'`, preserve `authorName`, leave `authorUserId` nullable when the original author is not a current Compass account, set every imported grant `baseline=1` with `openedAt=NULL`, and write no outbox or notification rows. Native replies use source keys that are null and are therefore preserved by rollback. Rollback removes only imported Buildertrend messages, their baseline grants, and their imported attachments when the original message body and request hash plus attachment metadata still match; changed rows remain for controlled reconciliation. It leaves the conversation and any native replies available.

The package report is `REHEARSAL_ONLY`. It is not a publication manifest, production postflight, participant access certificate, or completeness claim. The current evidence baseline still holds the 101 generic/page-text payload rows, lacks complete original To/Cc/Bcc evidence, and has no exhaustive source denominator or restored sealed message bundle. No external historical publication is authorized by this rehearsal.
