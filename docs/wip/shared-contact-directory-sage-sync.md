# Shared contact directories and reviewed Sage synchronization

Status: design for implementation; do not deploy the interim cross-project copy picker.

## Decision

Sage is the authoritative source for Sage-mapped contact information. Compass
may accept proposed contact changes from authorized staff or the linked person,
but those proposals do not replace Sage values until a reviewed, audited Sage
write succeeds and is read back. Project Contacts are project assignments, not
independent person/company records. A Compass login is a separate, optional
identity. Internal people map to Sage employee records; clients map to Sage
receivable clients; vendors map to Sage vendors. A project assignment or Compass
invitation never creates an employee, client, or vendor in Sage by itself.

## Canonical records

| Directory | Canonical record | Project-specific record |
| --- | --- | --- |
| Internal | One organization-scoped internal person | Project role, visibility, assignment, and access |
| Clients | Existing `customers` record | Owner/client role, visibility, assignment, and access |
| Vendors | Existing `vendors` company and optional `vendor_contacts` person | Supplier/subcontractor role, trade, CSI codes, visibility, assignment, and access |

Project contact displays read name and contact details from the canonical
record. Project-specific fields remain on `project_contacts`. A cached project
snapshot may support imports and offline use, but must not be independently
editable or win over a linked canonical value. A successful Sage refresh of one
directory record should update every project view that references it. A
Compass-submitted change remains a visible pending proposal until then.

The internal directory must not be populated from Settings users alone.
Existing active internal project contacts are candidate source records.
Identity reconciliation must preserve their source IDs and put uncertain
matches in review; matching on email alone is unsafe because addresses can be
shared or recycled. A Compass user may be linked to an internal person after
identity verification, but the user account does not own the internal directory.
The project picker should show the whole directory, marking people already
assigned to this project instead of silently omitting them.

## Database invariants

- Scope every canonical record and project assignment to one organization.
- Use typed foreign keys for canonical relationships. `project_contacts` already
  has vendor and vendor-person IDs; add internal-person and client IDs rather
  than relying on a polymorphic `source_entity_id` for new relationships.
- Index organization plus directory search fields and project plus canonical
  IDs. Do not make email globally unique or use a name as a foreign key.
- Store external Sage identity by Sage company, entity type, and stable Sage ID;
  never infer it from a display name or email. Preserve source/provenance links
  separately from the editable canonical contact.
- Prevent two active assignments to the same canonical contact on one project,
  while allowing one contact on many projects.
- Delete/deactivate project assignments independently of the directory.
  Directory deletion needs dependency review and recovery safeguards.

## Migration and reconciliation

1. Add the internal directory and typed project references without removing
   legacy columns or snapshots.
2. Seed candidate internal people from existing active project contacts and
   any verified Sage employee import. Reuse a canonical ID only when a stable
   source identifier proves the match; otherwise retain separate candidates
   for review. Do not auto-merge by email or name.
3. Link reviewed project assignments to canonical IDs. Keep unlinked legacy
   rows visible until resolved, and report reconciliation counts.
4. Move add/edit flows to directory-first selection. New internal people are
   created once in the directory, then assigned to projects. Existing client
   and vendor flows must likewise always select their canonical records.
5. After backfill and UI verification, make linked directory fields read-only
   in project forms and remove project-to-directory identity writeback.

## Sage synchronization

Sage employee records include payroll/HR information, so the bridge must use a
strict allowlist of contact fields and never read or write payroll fields for
this workflow. Before enabling writes, verify the installed Sage API schema,
company mapping, employee permissions, and exact field mapping on the Sage
host. The existing client/project writer only supports client creation and a
guarded blank-email fill; it is not a general contact editor. Vendor and
employee contact modifications need their own validated bridge operations.
Business phone/email fields must not be confused with private home contact
fields. A self-service Compass user can propose changes only to their own
verified directory person; staff permissions may propose changes to other
contacts. Both paths use the same review and conflict checks.

Each edit destined for Sage follows: save a proposed change without overwriting
the authoritative directory value -> compute a field-level diff against the
last Sage read model -> authorized review and approval -> immutable operation
with idempotency key -> server-side Sage bridge write -> read-back by stable
Sage ID -> update the canonical directory and record success or conflict.
Never treat a queued or approved operation as synchronized. If Sage is
unavailable, Compass retains the proposal and an explicit pending/failed status
for retry.
Reject a write when the Sage record changed since review or the mapping is
ambiguous. Only approved contact fields are sent; project membership and portal
access remain Compass-only.

## Release gate

Do not migrate or deploy until the internal directory, legacy reconciliation,
single-edit project views, and reviewed Sage contact operation are implemented
and tested. The vendor-invitation visibility change can remain separate if
needed, but the copy-based internal-contact picker must not ship.
