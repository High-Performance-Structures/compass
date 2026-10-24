# Owner and vendor preview access plan

Status: approved joint Codex and Claude design, implemented and validated locally on `codex/external-preview-access`, 2026-10-24. The implementation is deployed to the isolated demo environment only. Production remains unchanged; authenticated parity remains a rollout check.

Owner and vendor previews should use the same authorization rules as the selected external person. Staff authorization should determine whether an employee may open a preview; it must not determine the records, messages, or files shown inside it.

## Confirmed causes

These access behaviors are present in the inspected checkout at `d25ebd816` and in local `origin/main`, `64f2edd337`. The change-order action file also has unrelated differences between those revisions; its relevant audience-context and capability behavior remains the same.

Real external accounts already use the same `/preview/projects/[id]/{owner,sub-vendor}` pages, through the redirects in `src/app/dashboard/projects/[id]/page.tsx`. The divergence is inside authentication-dependent loaders and controls. Changes to these readers therefore require regression coverage for real external sessions as well as staff preview.

| Surface | Current behavior | Relevant source |
| --- | --- | --- |
| Viewer identity | The preview retains the authenticated employee's identity and internal status. | `src/app/actions/project-audience-preview.ts`, `verifyProjectAccess` |
| Messages and email | The audience Conversations section calls the normal personal inbox action using staff authentication. It explicitly labels that inbox as the employee's staff inbox. | `src/components/projects/project-audience-preview.tsx`, `AudienceConversationSection`; `src/lib/correspondence/access.ts`, `correspondenceContext` |
| Vendor RFQs | Internal preview skips the recipient match. | `src/app/actions/project-audience-preview.ts`, `audienceRfqs` |
| Vendor commitments | Internal preview tests records against multiple external contacts and bypasses explicit purchase order delivery emails. | `src/app/actions/project-audience-preview.ts`, `portalOperationContacts`, `audienceOperations` |
| Vendor selections | Procurement links reuse the broader preview RFQ and purchase order sets. | `src/app/actions/selection-decisions-read.ts`, `partnerOperations` |
| Schedule | Internal viewers can preview unpublished working rows and receive broader assignee response data. | `src/app/actions/project-audience-preview.ts`; `src/lib/schedule/audience-publication.ts` |
| Earlier conversations | Channel membership and message reads use the employee's account. Loading preview can reconcile or create audience channel membership. | `src/app/actions/project-audience-preview.ts`; `src/components/projects/project-audience-conversation.tsx` |
| Owner warranty | The owner wrapper loads the warranty workspace under staff authentication, including internal notes, broader attachments/events, staff assignee choices, and access outside the warranty stage. | `src/components/projects/project-audience-warranty.tsx`; `src/app/actions/project-warranty.ts`, `getProjectWarrantyWorkspace` |
| Vendor warranty | Internal preview returns claims assigned to any contact or vendor rather than one external viewer. | `src/app/actions/project-warranty-vendor.ts`, `vendorWarrantyContext` |
| Change orders | Audience override retains the employee's ID, so requester exceptions and capabilities can still use the employee. | `src/lib/change-orders/access.ts`, `canViewChangeOrder`; `src/app/actions/project-change-orders.ts`, `audiencePreviewContext`, `getProjectChangeOrderCapabilities` |
| Owner budget | Reconciliation explanations and differences branch on internal status. | `src/app/preview/projects/[id]/owner/budget/page.tsx` |
| Shared controls | The preview layout builds Quick Add and help access from the authenticated employee. Notification controls also use the employee's account. | `src/app/preview/layout.tsx`; `src/components/projects/project-audience-header-controls.tsx` |

These findings establish misleading internal previews. They do not, by themselves, establish that an actual external account can read internal data.

## Proposed user experience

Owner preview and vendor preview should offer a person selector for the current project. The selector must identify the person and company so that two contacts at the same company remain distinguishable. A persistent banner should state, for example, "Previewing as [person] · Owner · Read only."

An exact preview requires an active external account with the matching project assignment. A directory contact or pending invitation alone does not establish login access or message grants. Such contacts should be identified as not yet activated, without inventing an account or granting access.

The initial implementation requires selecting an assigned person before opening workspace sections. Generic preview does not load personal records. A future generic shared-content view must show only genuinely shared, published audience content. Never combine multiple people's private records into a generic owner or vendor preview, and never fall back to the employee's inbox.

Available actions should reflect the external person's capabilities. In preview, explain that actions are disabled because the view is read only. Viewing a preview must not send email, save drafts, mark messages or notifications read, change preferences, submit approvals, or provision conversation membership. Personal unsent drafts are excluded from preview.

## Authorization design

Keep the authenticated staff actor separate from the effective external viewer. Do not change the employee's WorkOS identity, active organization cookie, or global authentication helpers to simulate another account.

Introduce one server-owned project viewer resolver with separate live and preview modes. Its result should carry the authenticated actor, effective external viewer, project, organization, audience, and read-only mode. Do not accept an arbitrary client-provided role or trust a referrer header as authorization.

For each preview request, the resolver must verify:

1. The actor is authorized to preview the project and the requested external scope.
2. The selected account is active, has access to the project's organization, and has a current project assignment for the requested audience.
3. The selected account is an external participant rather than an internal employee with an owner-like project assignment.
4. Any contact association needed for vendor records satisfies the same rules used by the actual external workspace.

Invalid, removed, or mismatched targets must fail closed. Do not substitute the actor or another person. A preview may never grant access to the selected person or claim a pending invitation on their behalf.

Thread the validated context into existing readers. Where a loader authenticates internally, separate context resolution from the reusable read so both the real external workspace and staff preview apply the same policy. Do not fork the readers or maintain a second copy of external visibility policy for preview.

The employee's own permissions may further limit which external scopes they may inspect. They must never widen what the selected external person can see.

Inspecting another person's messages requires an explicit preview permission, not ordinary project-read access alone. Record the actor, selected person, project, and preview access in the security audit trail. This audit entry must not change the selected person's inbox, read state, or project records.

## Messages and files

Existing correspondence readers already enforce current conversation participation and per-message recipient grants. Reuse those rules with the effective external viewer. Retain To/Cc/Bcc privacy and the same attachment authorization; an audience label alone is insufficient.

The context must persist through inbox refreshes, detail reads, search, pagination, polling, legacy conversations, printable output, attachment previews, and downloads. Preview requests must not invoke the staff project-history scope. A download URL must revalidate the target and its grant before fetching the file.

Use explicit read-only preview actions or endpoints. The preview client should not wire normal staff send, draft, state, read-receipt, upload, or approval actions into the view. Server boundaries must reject preview-scoped writes as well. Ordinary staff tabs keep their normal authorization.

## Whole workspace coverage

Apply the same viewer context to the dashboard, schedule, RFIs, RFQs, purchase orders, selections, change orders, budget and deposit requests, warranty, photos, documents, project team, help, notifications, and Quick Add. Existing audience-aware readers are starting points; their identity-dependent branches still need checking.

Keep navigation and links inside the selected project and audience. If project switching is supported, validate the person's assignment on the destination project before rendering it. A manually opened detail or download route must enforce the same access as the list view.

Key client state and any permissible caches by project, audience, selected person, and preview mode. On a person change, clear prior content immediately and ignore late responses from the previous selection. Sensitive responses should remain private and uncached. Do not store authorization in a browser-global preference that changes another staff tab.

## Implementation sequence

0. Contain misleading generic previews: apply no personal grants when no person is selected; remove staff-only widening, inbox/composer/draft fallback, internal reconciliation details, and channel provisioning. Show person-specific sections as unavailable until the selector exists. Treat this as containment rather than complete exact-person preview.
1. Establish the validated viewer resolver and person selector. Preserve current staff authentication and actual external login behavior.
2. Complete messages, search, legacy conversations, and attachment reads as one coherent slice, with no staff inbox fallback or preview side effects.
3. Apply the resolver to remaining workspace readers and shared controls. Remove internal-only widening from external preview reads while preserving any separately named staff planning tools.
4. Compare real external sessions with their matching staff previews before describing the preview as accurate across the workspace.

Do not label a partially converted workspace as an exact external preview. During conversion, clearly mark unsupported sections as unavailable in preview.

Claude independently audited the source and collaborated on the design. Codex completed the implementation across the resolver, correspondence, domain readers, and shell in one isolated branch after sending an ownership update to avoid competing edits. Final structured implementation review used Codex; Claude has not yet reviewed the completed patch.

## Vendor RFI access decision

Approved policy, 2026-10-24: vendors may see only RFIs involving their own company. Apply this restriction to actual vendor access and the matching preview, including lists, dashboard counts, search, detail pages, printable output, and associated attachments. A vendor-audience label by itself must not authorize another company's RFI.

Use verified project contact and company associations to establish involvement. An unresolved or ambiguous association must not broaden access to all vendor RFIs. Existing records may need association review before they become visible under this rule.

The current real vendor workspace still returns all RFIs published to the vendor audience without a per-company filter. The restriction is implemented locally using reviewed active RFI participant grants and stable company/contact links, including native vendor-created RFIs and notification visibility. It has not been deployed to production.

## Acceptance criteria

| Scenario | Required result |
| --- | --- |
| Owner A real login versus preview as Owner A | Same authorized records, published schedule, messages, visible recipient information, and files. Preview writes are disabled. |
| Vendor A versus Vendor B | Neither preview contains the other's private RFQs, purchase orders, correspondence, or attachments. |
| Vendor RFI company scope | A real vendor and its matching preview can access RFIs involving their company and cannot discover another company's RFIs through lists, counts, search, details, print, or attachments. |
| Message grant absent | No message body, search excerpt, recipient metadata, or attachment access. |
| Unpublished schedule or internal warranty content | Excluded exactly as in the real external workspace. |
| No selected person | No private inbox, recipient-specific records, or employee fallback. |
| Target removed, deactivated, or changed to another audience | The next request is denied; cached content is cleared. |
| Target changed during a pending request | The old person's response cannot populate the new person's view. |
| Staff tab alongside preview | Staff authentication and ordinary authorized work continue independently. |
| Preview navigation and file requests | No sends, autosaves, read receipts, notification-state changes, approvals, preference changes, or membership provisioning. |

## Baseline verification

The existing historical source audience, historical search, attachment access, audience conversation reconciliation, and preview route suites pass: 25 tests in five files. These tests verify selected existing authorization behavior; they do not establish preview parity or live browser behavior. New coverage must exercise both real external access and staff preview against the same fixtures, including direct routes and negative access cases.


## Local validation

The implementation includes a dedicated person selector, a request-scoped external viewer resolver, read-only message and notification views, scoped conversation and attachment reads, external-policy domain readers, and company-scoped vendor RFIs. The actor remains authenticated as staff; selected-person reads do not claim invitations or reconcile conversation membership.

Browser verification uses the real selector, navigation scope wrapper, read-only correspondence view, message cards, and attachment components with isolated action boundaries. It covers switching people, clearing prior content, retaining download and navigation scope, search, and desktop/mobile layout. It does not exercise production authentication.

Existing RFIs without a reviewed company/contact association are withheld from vendors. Unsent personal drafts are excluded. Raw internal print-source readers reject preview scope; reports assembled from already authorized workspace data remain available through the workspace print flow.

## Validation results

- Focused permission, correspondence, schedule, notification, RFI, and file regressions: **315 tests in 41 files passed** using `node node_modules/vitest/vitest.mjs run` with the affected suites.
- `node scripts/verify-audience-person-preview.mjs`: passed selection, stale-content clearing, scoped navigation/download, read-only messages, search, and desktop/mobile layout checks. Desktop and mobile screenshots were inspected.
- Changed-file ESLint, `bun run ui:check`, and `git diff --check HEAD`: passed.
- `bun run build`: passed compilation, TypeScript, and production route generation.
- `node scripts/verify-external-dashboard.mjs`: cannot bundle its existing isolated fixture because server dependencies reach its browser bundle. The same failure was reproduced from unchanged base `64f2edd337`; the dedicated person-preview browser proof above passes.
- Manual whole-repository `tsc --noEmit` includes unrelated existing test typing failures. The standard production build's TypeScript check passes.

Final structured source review command:

```sh
$AUTOREVIEW --mode local --model gpt-6.1-sol --no-web-search --stream-engine-output --prompt 'Review the approved exact-person external preview implementation. Focus on concrete introduced authorization, resource-scope, read-only, and live external regressions within the same preview boundary. Previously accepted inbound RFI email, cross-project channel, alias scope, task assignee, and typing findings have been fixed with regression tests. Read-only polling must not clean typing state. Preview downloads use no-store. Return code_location.file_path using repository-relative paths only, never absolute paths. Do not broaden into unrelated cleanup or speculative architecture changes.' --json-output /tmp/compass-preview-review-closeout.json
```

The helper exited 0 with no findings: `autoreview clean: no accepted/actionable findings reported`. Earlier findings were accepted because they exposed concrete gaps in the same preview boundary: inbound RFI emails retaining staff identity, channel discovery escaping the project, legacy project aliases losing scope, schedule assignee reads escaping the project, and typing mutations in preview. Each was fixed and covered by focused regressions. Related polling cleanup and signed-document cache behavior were checked at the same boundary. After the two-cycle scope pause, remaining findings were explicitly classified as in-scope blockers; no schema migration, new external protocol, or broader permission redesign was added.

Before rollout, compare authorized real owner/vendor WorkOS sessions with matching staff previews on a staging deployment. The local browser fixture does not prove production authentication or inbox delivery. Review company/contact links for older RFIs before making them visible to vendors.

## Demo deployment and remaining validation

On 2026-10-24, explicit approval was received to create five isolated WorkOS test accounts and apply the nine pending existing main-branch migrations to `compass-demo-db`, then deploy only `compass-demo`. A database rollback snapshot was saved before changes. All nine migrations were applied; the final migration check reports none pending.

The branch was rebased without conflicts onto main `f283768d`; the implementation commit is now `ea51a0f9` (formerly `4dd2968a`). The full OpenNext demo build and Wrangler deployment dry run pass, along with 33 focused permission regressions after the rebase.

Deployed demo Worker version: `bf58f3a0-65e2-4b8c-b0c4-03dc91523484`. Deployment history and bindings were re-read after deployment. The three WorkOS secret bindings remain present. The database binding points to `compass-demo-db`; self-reference points to `compass-demo`; global correspondence remains disabled, with only synthetic project `preview-qa-20261024` temporarily allowlisted through `COMPASS_CORRESPONDENCE_PROJECT_IDS`. Subsequent demo deployments must intentionally preserve or remove that temporary QA allowlist.

The additive fixture contains one staff user, two owners, two vendor companies, six distinct sent emails with per-person grants, four private drafts, published schedule items plus an unpublished negative control, an owner budget with an internal-note negative control, and company-specific RFIs plus internal/unlinked negative controls. It was checked twice against a local snapshot before application, then read back from the demo database. No existing demo projects were reset.

Demo login and mobile health return HTTP 200; anonymous owner/vendor previews redirect to sign-in. Baseline QA message read receipts are zero and private draft count is four. **Authenticated owner/vendor-versus-preview parity has not yet been completed.** The approved `example.com` identities trigger WorkOS's test SSO policy; a proposed change to a reserved `.example` domain was blocked by automatic approval review pending explicit authorization for that different address domain. No domain, password, or SSO-policy changes were applied.

The demo has no private correspondence Drive storage, so positive file-byte download parity remains unverified. Do not connect production storage or claim attachment download parity on the basis of these health checks.

A read-only production audit found two vendor-visible RFIs with placeholder company labels and no verified company grants or stable activity evidence. Their associations remain unchanged. They will be withheld under the approved company rule until reviewed; company labels alone must never be used to backfill access. No production writes, merge, or production deployment occurred.
