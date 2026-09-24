# Shared contact directory and Sage field map

Status: implementation in progress. A guarded HPS Test API write/readback
validation passed on 2026-09-24. Sage contact-write claims remain disabled,
and the queue migration has not been applied to production.

## Authority and record boundaries

Sage 100 Contractor is authoritative for synchronized values. Compass stores one
organization-scoped client company, vendor company, or internal employee; client
and vendor people are separate child records. `project_contacts` records
project assignment, role, visibility, and portal access, not another copy of
contact identity. A person may be assigned to many projects, and a client or
vendor may have many people. A Compass login is optional and distinct from the
directory person.

Account Settings edits only WorkOS sign-in name/email and the local account
identity. It no longer broadcasts login/profile values into company, person,
invitation, or project-contact records. Phone and address changes belong in
Contacts and, for Sage-linked records, the reviewed proposal path. The project
contact editor now treats any linked directory identity as canonical; it edits
assignment metadata only and does not write identity values back to the
directory. Legacy unlinked project snapshots remain locally editable.

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
API XML element name. The API elements below were checked against the installed
`mbxml.xsd`; runtime behavior still needs controlled validation.

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

### Installed API schema check (2026-09-23)

Read-only inspection of the installed
`C:\Program Files (x86)\Sage\Sage 100 Contractor SQL\mbxml.xsd`
(file dated 2026-04-14) confirms these XML names. This is schema evidence,
not a successful write or proof of Sage's runtime update behavior.

| API type/request | Confirmed elements relevant to contact sync |
| --- | --- |
| `ClientModRq` / `ClientModType` | `ObjectRef` (`ClientKeyType`), `Addr1`, `Addr2`, `City`, `State`, `PostalCode`, `BillingAddr1`, `BillingAddr2`, `BillingCity`, `BillingState`, `BillingPostalCode` |
| `ClientContactAdd` / `ClientContactMod` within `ClientModRq` | `ContactName`, `JobTitle`, `Phone`, `Extension`, `Email`, `Mobile`; modification uses `ObjectRef` (`ClientContactKeyType`) with `LineID` |
| `VendorModRq` / `VendorModType` | `ObjectRef` (`VendorKeyType`), `OwnerName`, `Addr1`, `Addr2`, `City`, `State`, `PostalCode`, `Email`, `PrimaryEmail` |
| `VendorContactAdd` / `VendorContactMod` within `VendorModRq` | `ContactName`, `JobTitle`, `Phone`, `Extension`, `Email`, `Mobile`; modification uses `ObjectRef` (`VendorContactKeyType`) with `LineID` |
| `EmployeeModRq` / `EmployeeModType` | `ObjectRef` (`EmployeeKeyType`), `Addr1`, `Addr2`, `City`, `State`, `PostalCode`, `Phone`, `Mobile`, `Email` |

The installed request list also contains `ClientQryRq`, `VendorQryRq`, and
`EmployeeQryRq`. Sage's XML `LineID` must still be reconciled with the SQL
child `_idnum` versus `linnum` before modifying an existing person. The XSD
confirms a vendor `PrimaryEmail` API field, but does not establish whether the
specific General Information UI field binds to it or to `Email`; client
Other Addresses > Primary Email likewise needs a runtime mapping check.
A separate authorized
non-production or carefully controlled validation must confirm request/response
behavior, stable child IDs and ordering, blank/null semantics, conflict
detection, and read-back before any contact-write route is enabled. No Sage
records were changed during this schema check.

### HPS Test read-only validation (2026-09-24)

The proposed C# contact writer compiled on the Sage host. Read-only queries
against the **HPS Test** company confirmed that every SQL column used by its
client-company, vendor-company, client/vendor-person, and employee mappings
exists. Company and employee records use a `uniqueidentifier` `_idnum` plus a
numeric `recnum`; child contact rows also have `_idref` (parent GUID),
`linnum`, and numeric `recnum`. The runtime meaning of the XML child `LineID`
is **not** established by these column checks.

`--contact-schema-test` validated generated XML for all five record kinds and
all mapped fields against the Sage host's installed `mbxml.xsd` without
submitting a request. It passed. `--contact-test` from a temporary executable
then reached Sage API initialization but stopped at `IsApplicationAllowed`
with code `-1`. The configured API user exists in HPS Test, belongs to the
exact `API` group, and that group has Save permission. The same temporary
executable failed the production-company `--diagnose` check with `-1`, while
the **installed** production writer at its approved path passed `--diagnose`
immediately afterward (2026-09-24). This points to the executable's
application approval/identity, not HPS Test credentials or license capacity,
as the explanation for the temporary binary's denial. None of these
diagnostics modified Sage records. The subsequent installed-path validation
below established that HPS Test API login works.

Sage's application approval is bound to the installed writer identity; do not
interpret a `-1` from a newly compiled temporary-path binary as a test-company
authentication result. On 2026-09-24, an elevated maintenance session held
the production scheduled task, backed up the approved executable, substituted
the candidate at that filename, and ran only `--contact-test`. It returned
`CONTACT_TEST_SCHEMA_AND_ACCESS_OK` with exit code 0 against HPS Test. The
original executable was restored with the same SHA-256 hash, the task returned
to Ready, and the restored production writer passed `--diagnose` with exit
code 0. No Sage records were changed. Keep this guarded procedure for future
API validation: never bypass the task pause while production client/project
writes are enabled, and never leave a candidate executable installed.

### HPS Test write/readback validation (2026-09-24)

The guarded installed-path test used HPS Test client 2890, vendor 2883, and
employee 17, with one named child contact under each company. It changed one
safe mapped field per record kind, read each value back through the Sage API,
and restored the original mapped value. All five paths passed:
`client_company`, `vendor_company`, `client_person`, `vendor_person`, and
`employee`. The test printed `CONTACT_WRITE_TEST_OK` and
`HPS_TEST_CONTACT_WRITE_AND_RESTORE_OK` with exit code 0. The original
production executable was restored with the same SHA-256 hash, the scheduled
production writer returned to `Ready`, and its read-only `--diagnose` passed.
No production contact was edited and contact synchronization was not enabled.

The test's requirement for a populated City and exactly one named child
contact was a disposable-record selection guard, **not** a Compass or Sage
production requirement. Optional contact fields may be blank. This test does
not establish blank/null update semantics, revision-conflict behavior, every
mapped field, primary-email behavior, or adding child contacts. Those remain
separate release gates before production contact writes are enabled.

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
Migration `0169` adds nullable `user_id` foreign keys to client and vendor
people, with organization/role triggers and immutable link events. Contacts
offers an explicit account-picker action to link a known person; it does not
infer identity from email or name. A reviewed backfill and invite/activation
link maintenance are still required before claiming that every existing
account is connected to a canonical person. External users cannot browse the
shared directories; self-service reads only exact linked person IDs.
Directory-granted staff edits must not reach the legacy Sage email-fill queue
without the existing stronger authorization; the reviewed Sage contact
proposal/approval path remains a release gate.

The new person-account links and Sage proposal fields remain outside the
Project Registry and Google Apps Script handoff contracts: those still carry
project-level identifiers/intake values, not person or employee address IDs.
The Tracker's single owner slot continues to project the canonical selected
owner without changing the sheet layout. A future contact-aware handoff must
carry an explicit canonical person ID and be reviewed as a separate contract
change; no Apps Script payload should infer a person from a free-text name.

Every proposed change needs a verified Sage company/entity ID, a field
allowlist, a snapshot/revision, an authorized reviewer, an immutable approval
record, idempotency, and a read-back receipt. A changed Sage value between
proposal and approval is a conflict, never a silent overwrite. Invite status
and project access are Compass-only and must not ride along with contact data.
No direct SQL update is permitted.

The existing production Sage writer handles client/job creation and guarded
filling of a blank client email. A separate, opt-in contact mode now has
allowlisted client/vendor/employee modifications and child-contact
modification code and passed the guarded HPS Test write/readback check above.
It has not been installed as the production writer. Child-contact adds,
primary-email edits, blank/null updates, and reviewed linking/import of
existing Sage people remain outside the enabled path. The Contacts UI can
request a fresh Sage read and submit/review a proposal for an already-linked
record; approval is refused while the production write flag is disabled.
Private employee address access and approval must
be individual staff permissions in Compass
Settings > Permissions, with Executive Admin the initial default. Employees
may propose changes to their own record but cannot approve them. No employee
address proposal, review, or write route is enabled by the foundation migration.
The migration seeds today's Executive Admin people as editable grants once for
employee private contact access, CHERISH review, greeting-card approval and
release, and Project Archive. All four are individual staff permissions in
Settings > Permissions; there is no runtime email allowlist. A grant can be
added, changed, or revoked there, with an audit event.
