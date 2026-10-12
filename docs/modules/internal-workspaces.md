# Internal workspaces

Some projects are not client jobs: the office (administrative duties), the
yard, and generic projects the field crew logs against. These are internal
workspaces (`projects.workspace_kind`):

- `office` — administrative duties (for example H-Office).
- `executive` — the owner's office (for example Woodland Park Home Office):
  office duties, with owner and CEO work queues.
- `field` — crew work at the yard, or generic order help where the crew
  doesn't know the order number.

Regular projects have no workspace kind.

## Duty log

`/dashboard/projects/{id}/duty-log`. Each entry is a date, the person, a duty,
optional hours, notes, and optionally the client project the work was for.

- Duties come from Settings (`internal-duties` feature settings). By default
  they are the company's Sage cost codes, so logged hours line up with how
  payroll is coded: 501 Sales Taxes, 502 Bank Reconciliations, 503 General
  Accounting & Bookkeeping, 504 Audits and Compliance, 507 Billing/Accounts
  Receivable, 508 Business Development, 509 Education and Training, 512
  Accounts Payable, 513 Office Housekeeping/Maintenance, 32 Administrative Fee
  for office workspaces; ICF Bracing Rental, Mobilization and Miscellaneous
  Costs for field workspaces.
- Daily logs written before the duty log are listed under "Daily logs waiting
  for a duty". Giving one a duty creates an entry linked to that log (the log
  is not changed, and its author stays the person who did the work). Deleting
  the entry puts the log back in the waiting list.
- Staff edit and delete their own entries; admins can edit any.
- Admins turn a project into an office or field workspace from the duty log
  page.

Internal workspaces are skipped by the project paper trail, since they have no
project folders.

## Recurring duties

Office workspaces have a recurring duties board on the duty log page, and the
Overview panel lists what needs attention.

- A duty has a name, an optional account (for reconciliations), a cadence
  (monthly, quarterly, yearly), a due day, the duty its time is logged under,
  and an owner. A period's work is due on the due day of the month after the
  period ends (an April reconciliation due the 15th is due May 15).
- Status: **behind** (periods past their due date, counted), **due soon**
  (the next period is due within a week), **current**, or **not started**
  until someone marks the most recent period done.
- **Mark done** records the period, the date, and optionally hours, which go
  on the duty log under the duty's cost code. **Undo last** removes a period
  marked by mistake, with its duty log entry.
- Admins add, edit and turn off duties. A duty that was never marked done can
  be deleted; one with history is turned off instead.
- H-Office starts with monthly reconciliations for FSB, FSB Project, PPCU
  Checking, PPCU Savings and Spark Credit Card (due the 15th), sales tax (due
  the 20th) and vendor statement review (due month end). FSB starts from April
  2026, reconciled on Sep 28.

## Work queues

On an internal workspace's Overview, the Role Dashboard shows the workspace's
own work queues instead of a client job's. Each queue links to where that work
happens and, where it applies, shows the Sage cost code its hours go under.
People drag queues into their own order, saved per workspace kind, and
**Reset order** returns to the default.

| Kind | Leads with |
| --- | --- |
| Office | Recurring duties, accounts payable (512), billing and receivables (507), staff messages, office alerts, payroll (505), audits and compliance (504) |
| Owner's office | Business development (508), new leads (41), managerial accounting (511), recurring duties, legal (510), human resources (514), marketing (506), planning and administration (42) |
| Field | Crew log, duty log |

An owner's office logs the same administrative duties as the office.

## Planned

- Saving each reconciliation PDF to the company Drive (07_Banking / account /
  year) when it is marked done.
- Insurance certificate expirations from vendor records.
- Settings editor for the duty list.
- Field crew log with orders tagged after the fact (Nu-Tech Labor Tracking).
- Checking logged hours against the Sage labor journal.
