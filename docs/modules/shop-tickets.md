# Shop tickets

A shop ticket bills a project for the company's own labor and machine hours at
set rates. It replaces a spreadsheet ticket that was filled in by hand and
saved as a PDF into the draw's receipts folder.

## How it works

- **Where:** each project's Shop Tickets page (sidebar → Financial →
  Shop Tickets, or `/dashboard/projects/{id}/shop-tickets`).
- **Lines:** each line is a cost code from the Sage cost code list, a type
  (Labor or Machine) and hours. Staff can add, edit and remove lines on a
  draft.
- **Rates:** every line bills hours × the set rate from Settings → Rate book
  (the most recently updated active entry in the Labor or Machine category).
  The rate is copied onto the line, so changing a rate never alters an issued
  ticket.
- **Budget check:** when the project has budget lines, a cost code that is not
  in the budget is flagged on its line. Issuing such a ticket requires
  changing the code, starting a change order, or confirming the lines were
  reviewed; Compass records who confirmed.
- **Numbering:** Compass assigns the next number (prefix and starting number
  in Settings → Workflows → Shop tickets). Numbers are never reused once a
  ticket is issued.
- **Statuses:** drafts can be edited or deleted. Issued tickets can only be
  voided, with a reason; a voided ticket keeps its number and its PDF is
  reprinted marked VOID.
- **Permissions:** the "Shop Tickets" permission (finance resource). Office
  staff, office managers and project managers can create, issue and void by
  default; field roles cannot.

## Drive copy

Issued and voided tickets are saved by the project paper trail (record type
`shop_ticket`, switch "Shop tickets" in Settings → Workflows → Project paper
trail). The copy goes in the project's pay requests folder, inside the draw's
folder and its receipts folder:

`03_PayRequests / PayApplication-07-September-2026 / ExpensesReceipts`

The draw folder follows the department template name. An existing draw folder
named "September 2026", or a "Receipts" folder, is used instead when present.
Missing draw folders are created; the category folder itself must exist.

## Planned

- Prefilling hours from Sage labor for the ticket's labor dates (read-only),
  with hours already billed on another ticket excluded.
- Linking each ticket's total into its pay application's expense summary.
