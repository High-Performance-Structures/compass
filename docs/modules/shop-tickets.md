# Shop tickets

A shop ticket bills a project for the company's own labor and machine hours at
set rates. It replaces a spreadsheet ticket that was filled in by hand and
saved as a PDF into the draw's receipts folder.

## How it works

- **Where:** each project's Shop Tickets page (sidebar → Financial →
  Shop Tickets, or `/dashboard/projects/{id}/shop-tickets`).
- **Lines:** each line is a cost code from the Sage cost code list, a rate
  chosen by name from Settings → Rate book (its active Labor and Machine
  entries, such as one per machine) and hours. Staff can add, edit and remove
  lines on a draft.
- **Rates:** every line bills hours × the rate it names. When the rate book
  has only one active rate of a kind, lines use it without asking; otherwise
  each line must choose, and a line whose rate was retired must choose again.
  Type a different rate in the line's Rate box to override the rate book for
  that line; clear it (or use the "Rate book $…" link) to go back.
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

## Hours from Sage

On a draft, set the labor dates and choose **Get hours from Sage**. The Sage
bridge (read-only) checks for requests every minute and returns the job's
timecard hours in those dates, by cost code, with who worked and when. Pay
rates are never read.

- **Which job:** the project's Sage job number when Compass has it; otherwise
  the Sage job whose name starts with the project number ("O-215-660-..."). A
  phase job such as "O-215-660-1-..." is a different job.
- **No double billing:** hours already on another ticket (not void) are not
  offered again. Choosing **Add to ticket as labor** adds a labor line per cost
  code (or adds to an existing one), and saving the ticket records which
  timecard hours it bills. Voiding a ticket frees its hours; removing a labor
  line drops its Sage hours.
- **Cost codes:** Sage's code is read from its name ("03 31 00 - Structural
  Concrete") or its number (3310000 is 03 31 00). Hours with no matching code
  can't be added until the code is fixed in Sage.
- **Machine hours** are not on Sage timecards; enter them by hand.

## On the pay application

A pay application's page lists the shop tickets billed on it, the issued
total, and the issued amounts by cost code to carry into the matching lines.
Draft and void tickets are listed but not counted.
