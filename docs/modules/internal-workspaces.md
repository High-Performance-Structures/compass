# Internal workspaces

Some projects are not client jobs: the office (administrative duties), the
yard, and generic projects the field crew logs against. These are internal
workspaces (`projects.workspace_kind`):

- `office` — administrative duties (for example H-Office).
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

## Planned

- Recurring duties board (monthly bank and card reconciliations per account,
  sales tax, vendor statements, insurance certificate expirations), with
  what's behind highlighted.
- Settings editor for the duty list.
- Field crew log with orders tagged after the fact (Nu-Tech Labor Tracking).
- Checking logged hours against the Sage labor journal.
