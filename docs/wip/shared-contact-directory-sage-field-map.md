# Shared contact directory and Sage field map

Status: implementation design; no Sage contact-write route or production migration is enabled.

## Authority and record boundaries

Sage 100 Contractor is authoritative for synchronized values. Compass stores one
organization-scoped client company, vendor company, or internal employee; client
and vendor people are separate child records. `project_contacts` records
project assignment, role, visibility, and portal access, not another copy of
contact identity. A person may be assigned to many projects, and a client or
vendor may have many people. A Compass login is optional and distinct from the
directory person.

Compass edits are proposals. A reviewer sees a field-level diff against the
latest Sage read, approves it, and a narrowly scoped server-side worker sends
the change with an idempotency key. The worker checks the Sage identity and
base revision, uses Sage's installed API (never direct SQL writes), reads back
the updated record, and only then updates the canonical Compass record. Failed
or conflicted proposals remain visibly pending for review.

## Verified Sage 2026 record structure

The labels below were observed in the installed Sage screens. The table and
column names were read from the installed company's SQL metadata using the
existing read-only Sage bridge login; no contact rows were fetched. The SQL
map identifies read-model fields, **not** permission to write a column or the
API XML element name. API request fields must be validated against the
installed `mbxml.xsd`; the check below is partial.

| Compass record | Sage table and stable key | Fields shown in Sage | SQL columns |
| --- | --- | --- | --- |
| Client company | `reccln._idnum`, number `recnum` | Address 1/2, City, State, Zip | `addrs1`, `addrs2`, `ctynme`, `state_`, `zipcde` |
| Client billing | same client | Bill Address 1/2, Bill City/State/Zip | `bilad1`, `bilad2`, `bilcty`, `bilste`, `bilzip` |
| Client primary email | `clncnt` line 1 under the client, per the existing Sage-to-Square bridge | Other Addresses > Primary Email | `clncnt.e_mail` where `linnum = 1` in the existing bridge; verify current Sage UI/API binding before write |
| Client person | `clncnt._idnum`, parent `_idref` | Contact Name, Job Title, Phone, Extension, Email, Cell | `cntnme`, `jobttl`, `phnnum`, `phnext`, `e_mail`, `cllphn` |
| Vendor company | `actpay._idnum`, number `recnum` | Owner, Address 1/2, City, State, Zip | `ownnme`, `addrs1`, `addrs2`, `ctynme`, `state_`, `zipcde` |
| Vendor primary email | same vendor | General Information > Primary Email | likely `prmeml`; confirm API/UI binding before write |
| Vendor person | `vndcnt._idnum`, parent `_idref` | Contact Name, Job Title, Phone, Extension, Email, Cell | `cntnme`, `jobttl`, `phnnum`, `phnext`, `e_mail`, `cllphn` |
| Employee | `employ._idnum`, number `recnum` | Address 1/2, City, State, Zip, Phone, Cell, Email | `addrs1`, `addrs2`, `ctynme`, `state_`, `zipcde`, `phnnum`, `cllphn`, `e_mail` |

Aggregate metadata checks confirmed all 9 `clncnt` rows link to a `reccln`
parent and all 579 `vndcnt` rows link to an `actpay` parent via
`_idref = parent._idnum`. These are point-in-time counts, not a migration
estimate. In particular, do not infer that a Sage client has only one contact
from the current row count. `reccln` and `actpay` also contain legacy
inline contact/email columns; do not update those in place of the child
contact rows without checking the API's mirroring rules.
The existing Sage-to-Square invoice bridge explicitly reads client primary
email from `clncnt.e_mail` on line 1 and falls back to `reccln.e_mail` for
General Information email. It does not use `reccln.stmeml` for that purpose.
This is a verified read-path mapping, not authorization to write or reorder
the first contact. Vendor `actpay.prmeml` remains a candidate, not a verified
UI/API binding.

### Installed API schema check (2026-09-22)

Read-only inspection of the installed
`C:\Program Files (x86)\Sage\Sage 100 Contractor SQL\mbxml.xsd`
(file dated 2026-04-14) confirms these XML names. This is schema evidence,
not a successful write or proof of Sage's runtime update behavior.

| API type/request | Confirmed elements relevant to contact sync |
| --- | --- |
| `ClientModRq` / `ClientModType` | `ObjectRef` (`ClientKeyType`), `Addr1`, `Addr2`, `City`, `State`, `PostalCode`, `BillingAddr1`, `BillingAddr2`, `BillingCity`, `BillingState`, `BillingPostalCode` |
| `EmployeeModRq` / `EmployeeModType` | `ObjectRef` (`EmployeeKeyType`), `Addr1`, `Addr2`, `City`, `State`, `PostalCode`, `Phone`, `Mobile`, `Email` |
| `VendorContactAddType` | `ContactName`, `JobTitle`, `Phone`, `Extension`, `Email`, `Mobile`; a vendor add sequence contains `VendorContactAdd` |
| `VendorContactModType` | `ObjectRef` (`VendorContactKeyType`); the key type has `LineID` |

The installed request list also contains `ClientQryRq`. Still to inspect in
the installed XSD: vendor company modification fields, client child-contact
add/modify fields, client and vendor primary-email fields, and the rest of the
vendor child-contact modification field definitions. A separate authorized
non-production or carefully controlled validation must confirm request/response
behavior, stable child IDs and ordering, blank/null semantics, conflict
detection, and read-back before any contact-write route is enabled. No Sage
records were changed during this schema check.

## Compass storage and privacy

- Existing `customers` and `vendors` become canonical company records with
  structured address, billing/primary-email, and stable Sage keys.
- Add `customer_contacts` and extend `vendor_contacts` for multiple people,
  each with a stable Sage child `_idnum` and a parent company key.
- Add `internal_contacts` linked optionally to a Compass `users` account
  and independently to the stable Sage employee ID. The project picker reads
  this directory, not the Settings-team list. Existing active staff are
  bootstrapped once by user ID. New active staff are provisioned on invite or
  account activation, and project intake links assignments to the same record.
  Later Settings profile edits do not overwrite directory values. Sage employee
  import/linking still needs implementation before release.
- Keep employee address fields in a separate private one-to-one record,
  excluded from project-contact and ordinary directory queries. Only the
  employee and staff explicitly granted confidential-contact access in
  Compass Settings > Permissions can see a proposed or synchronized address.
  Staff project lists may show only approved business phone, cell, and email.
- Project assignments use typed client/company, client-person, vendor/company,
  vendor-person, or internal-person IDs. Do not deduplicate people by name or
  email; ambiguous legacy matches require review.
- Buildertrend import identities must resolve to these same canonical IDs using
  an organization-scoped source mapping. Buildertrend evidence remains immutable;
  neither `users` nor a copied project-contact name/email row is a substitute
  for the employee/person directory. The foundation migration guards new
  assignment links against cross-organization and wrong-parent matches. A
  future Buildertrend promotion ledger should hold typed source-to-assignment
  links. Do not impose blanket one-to-one uniqueness on source records: an
  imported parent can produce multiple lines or attachments, while distinct
  source occurrences can resolve to one verified asset. Retain historical
  assignment snapshots as snapshots, but use the canonical person record for
  current linked identity. Backfill and validate legacy mappings before adding
  stronger tenant or uniqueness constraints. Existing `project_external_links`
  should be audited for extension before introducing a competing identity table.
- The first Sage grid contact has a special primary/reporting meaning. That
  ordering is not a uniqueness constraint: Compass must allow multiple owner
  and vendor contacts and preserve their Sage line ordering on import.

## Project registry and Google automation boundary

The Compass Project Registry stores project identifiers and external links,
not contact identities; this directory change does not add a Registry column.
The current Google Project Manager and generic Apps Script handoff contracts
send project number and project-level intake fields, not a canonical person ID.
Do not infer or merge a customer person from their free-text `clientName`.
Those handoff payloads and deployed scripts do not need a contract change for
the directory-linking slice. A future contact-aware handoff must carry an
explicit, organization-scoped canonical contact ID or be held for review.

Compass's existing Tracker/Registry row refresh still has one legacy contact
slot. For an owner assignment linked to a `customer_contacts` row, it now
projects the current canonical person's name, email, and phone into those
cells while preserving the sheet layout. Multiple project owners remain in
Compass; the tracker continues to represent only the selected primary owner.

## Write safety and release gate

### Contacts and Compass access boundary

Contacts is the sole navigation point for Internal, Vendors, and Clients.
Settings > Permissions controls those three directories independently, with
role/team baselines and named-staff directory overrides. The access manager
within Contacts is for invitations, roles, and project memberships—not a
second contact directory. Bulk project grants use selected Compass account
IDs and validate every account and project against the current organization;
existing project assignments are left unchanged.
Named-staff directory overrides stop at Create / Edit; deletion remains
limited by the existing underlying account-role gate until dependency-aware,
audited directory deletion is designed.

The internal directory has an explicit `internal_contacts.user_id` link.
Vendor and client person records do **not** yet have equivalent account
foreign keys. Their access-manager grouping is role-based, so it must not be
presented as a verified person-to-account match or used to sync identity by
email. Add explicit nullable links, a reviewed backfill, and invite/activation
link maintenance before claiming one canonical person across those views.
Directory-granted staff edits must not reach the legacy Sage email-fill queue
without the existing stronger authorization; the reviewed Sage contact
proposal/approval path remains a release gate.

These navigation, permission, and project-membership changes do not alter
project registry fields or Google Apps Script payloads. Recheck both when
account links or Sage contact synchronization fields are introduced.

Every proposed change needs a verified Sage company/entity ID, a field
allowlist, a snapshot/revision, an authorized reviewer, an immutable approval
record, idempotency, and a read-back receipt. A changed Sage value between
proposal and approval is a conflict, never a silent overwrite. Invite status
and project access are Compass-only and must not ride along with contact data.
No direct SQL update is permitted.

The current Sage writer only handles client/job creation and guarded filling
of a blank client email. General client/vendor/employee modification and child
contact add/modify operations must be implemented and tested against the
installed Sage API schema before this directory is deployed. Private employee
address access and approval must be individual staff permissions in Compass
Settings > Permissions, with Executive Admin the initial default. Employees
may propose changes to their own record but cannot approve them. No employee
address proposal, review, or write route is enabled by the foundation migration.
The migration seeds today's Executive Admin people as editable grants once for
employee private contact access, CHERISH review, greeting-card approval and
release, and Project Archive. All four are individual staff permissions in
Settings > Permissions; there is no runtime email allowlist. A grant can be
added, changed, or revoked there, with an audit event.
