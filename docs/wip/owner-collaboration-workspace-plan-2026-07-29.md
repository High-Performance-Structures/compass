# Owner Collaboration Workspace Plan

Date: 2026-07-29

## Outcome

The owner workspace should be a guarded project collaboration portal for
people who are financially and personally invested in an ORC or Design
project. It should not be a read-only preview, and it should not expose the
internal Compass application by hiding a few menu items.

Owners should be able to understand the project, make decisions, provide
information, and keep durable copies of the records they are entitled to see.
Every read and write must remain scoped to the owner's project membership and
to the audience of the individual record.

## Owner workspace information architecture

1. **Home**
   - Project photo, current phase, next update, decisions needed, and project
     team.
   - Clear alerts for assigned to-dos, RFIs awaiting a response, selections,
     and new pay applications.
2. **Updates**
   - Current and historical published owner updates.
   - Print and save as PDF.
3. **Schedule**
   - Published schedule only, using the project's item or phase publication
     setting.
   - List, calendar, and read-only Gantt views.
   - Print/save a dated published snapshot rather than attempting to print the
     interactive Gantt canvas.
4. **Financials**
   - Current approved budget and G703.
   - Chronological pay-application history with period, status, amount, and
     immutable PDF.
   - Print/save current G703 and every prior published application.
   - Change orders and owner approvals can be added after their visibility and
     approval rules are formalized.
5. **To-Dos and Decisions**
   - Only owner-visible items or items assigned to the signed-in owner.
   - Owner can update their own response/status and add an attachment.
   - Staff retains control of project-wide status, assignment, and internal
     notes.
6. **RFIs**
   - View owner/public RFIs.
   - Create an owner-originated RFI and respond when assigned.
   - Attach files and photos.
   - Internal routing, internal notes, and draft answers remain staff-only.
7. **Plans and Documents**
   - Published plans, specifications, selections, contracts, and other
     approved document versions.
   - Downloadable current and superseded versions with clear version status.
   - A controlled owner upload inbox; uploads are reviewed before being moved
     into the official project record.
8. **Photos**
   - Approved project photos and owner-update photos.
   - Owner uploads enter a review queue unless the destination explicitly
     permits immediate sharing.
9. **Conversations**
   - Project-scoped channels with the internal project team.
   - Owners do not discover or message unrelated external participants.
10. **Selections and Approvals**
    - Particularly important for ORC and Design clients.
    - Due dates, alternatives, documents, decisions, and immutable approval
      history.
11. **Warranty**
    - Appears when the project enters the warranty stage.
    - Submit a claim with location, category, description, priority, photos or
      video.
    - Track acknowledgment, scheduled visit, work status, resolution, and
      owner confirmation.
12. **Project Team**
    - Approved internal project contacts with direct project messaging.

## Authorization model

Access is the intersection of all of the following:

1. The authenticated user belongs to the requested project.
2. Their project-member role permits the owner workspace.
3. The record is published or explicitly marked owner-visible.
4. A write is permitted for that record and relationship, such as creator,
   assignee, approver, or warranty claimant.
5. The action never exposes staff-only fields.

This needs project-specific capabilities rather than granting an external role
general `project.update` or `document.create` permission.

Examples:

- An owner may create an RFI for their own project. The server forces the
  audience and initial status; the owner cannot choose an internal audience.
- An owner may respond to a to-do assigned to their user ID. They cannot query
  all project operations or reassign the item.
- An owner may download a published document through a project-specific route.
  A raw Google Drive file ID is never sufficient authorization.
- An owner upload enters a controlled project inbox. It does not grant write
  access to an internal Drive folder.

## Data and security prerequisites

### Project access

All owner-facing actions and routes must use `assertProjectAccess` and, for an
external viewer, verify the project membership role. Organization membership
alone is not project access.

The existing RFI and project-operation actions need this audit before their
features are linked into the owner workspace.

### Record-level participation

The current to-do model stores an assignee name but not an assigned user ID or
owner audience. Add explicit assignee/audience fields (or a relation) before
owners can safely view and update to-dos.

RFIs already have an audience field, but owner-specific create/respond actions
must force safe values and enforce creator/assignee rules.

### Documents

Create a project-document publication index rather than exposing the internal
Google Drive browser. Suggested fields:

- project ID and category
- display title and description
- storage ID kept server-side
- version and current/superseded status
- owner-visible, downloadable, and uploadable flags
- published timestamp and publisher
- review status for external uploads
- source document ID and checksum where available

The general Google Drive download endpoint must remain internal-only.
External downloads need project- and record-specific authorization.

### Financial snapshots

A published pay application is a durable record:

- application header
- frozen G702/G703 line snapshot
- generated or imported PDF
- publication timestamp and publisher
- owner visibility

Later Sage or source-system synchronization must not rewrite a prior published
owner document.

Sage 100 Contractor is the financial system of record. The owner workflow
should use a read-only Sage import for job/contract values, approved change
orders, progress-billing lines, prior certificates, deposits/credits,
retainage, current billing, and balance to finish. Compass should normalize
that data into a draft pay-application package, reconcile the G702 header to
the G703 Schedule of Values, require staff review when any difference remains,
then publish an immutable owner snapshot and PDF. A future write back to Sage
must remain approval-gated, idempotent, and audited.

Loomis currently has archived PDFs for pay applications 1, 2, and 3. Only pay
application 3 has imported G703 lines, so Compass can safely show the current
interactive G703 and all three original PDFs. It must not use pay application
3 lines to fabricate historical G703 detail for applications 1 or 2.

The current Loomis source records do not fully reconcile: the certified G702
contract total differs from the imported G703 line total, and the G702 includes
deposit/payment behavior that the current Compass schema does not model.
Compass must surface that condition to staff and preserve the certified PDF
while the Sage progress-billing import is completed.

## Delivery sequence

### Stage 0 — Guardrails

- Audit every owner/sub route and server action for project membership.
- Restrict generic file download paths to internal users.
- Add regression tests proving one external project member cannot access
  another project by changing an ID.
- Record owner actions in the existing activity log.

### Stage 1 — Durable read experience

- Build the read-only Sage progress-billing import and reconciliation gate.
- Complete Budget/G703 display, project totals, pay-app history, and print/save.
- Add printable published schedule snapshots.
- Add the published document index and owner plans/specifications library.
- Complete project-team and conversation visibility.

### Stage 2 — Assigned participation

- Owner-assigned to-dos and decisions.
- Owner RFI creation and assigned responses.
- File/photo attachments and notifications.
- Selection review and approval history.

### Stage 3 — Owner submissions

- Controlled document upload inbox.
- Owner photo contributions with review.
- Warranty claim workflow, stage-gated by project status.

### Stage 4 — Operational polish

- Mobile and offline submission queues where appropriate.
- Notification preferences and delivery receipts.
- Activity history visible to staff and a limited “your activity” history for
  owners.
- Accessibility, print, tablet, and phone regression coverage.

## Immediate Budget/G703 acceptance criteria

- The dedicated owner financial page shows every approved budget category; it
  does not silently stop after six.
- The G703 has a project-total row for original contract, changes, adjusted
  contract, prior, current, completed/stored, percentage, and balance.
- Prior costs appear on category rows.
- Every owner-visible archived pay application is listed.
- Archived PDFs open and download only after project and owner-role checks.
- Current G703 can be printed or saved as a landscape PDF with project
  department branding.
- A G702/G703 mismatch is visible to staff and cannot be silently represented
  as reconciled Sage data.
- Internal notes, vendor identity, raw storage URLs, and staff-only lines
  remain absent.
- Tablet layout supports horizontal table navigation without constraining the
  category list to a hidden fixed-height area.

## Regression coverage

- Owner, sub/vendor, unrelated external user, and internal preview role tests.
- Direct-ID access tests for pay applications, documents, RFIs, to-dos,
  photos, and conversations.
- Current vs historical financial snapshot tests.
- Printed G703 visual test in Chromium at Letter landscape.
- Schedule print visual test at list and published-phase levels.
- Tablet and phone owner navigation, table scrolling, downloads, and uploads.
- Activity-log assertions for every external write.
