---
{
  "id": "settings.company",
  "featureId": "help-resources",
  "slug": "company-settings",
  "title": "Company Settings, Workflow Rules, and Drive Filing",
  "summary": "Maintain department identity, follow-up rules, Nu-Tech email settings, travel charges, record statuses, list columns, and the project paper trail.",
  "contextSummary": "Settings changes affect company-wide workflows and future outputs. Review permissions, save deliberately, and verify the actual document, mailbox, or Drive copy.",
  "category": "Start Here",
  "tags": ["settings", "data health", "drift", "Company", "email domains", "other email addresses", "Departments", "Workflows", "paper trail", "Drive", "trusted addresses", "project aging", "travel", "zone charges", "statuses", "status filters", "Lists", "columns", "sheets"],
  "audiences": ["staff"],
  "permissions": ["help:read"],
  "routes": ["/dashboard/settings"],
  "owner": "Compass product team",
  "lastReviewed": "2026-11-13"
}
---

## Maintain Department Identity {#departments}

Open **Settings → Company → Departments** and select the department. The company owner can save its Compass name, document/email and legal names, contact details, mailing address, license number, website, office hours, logo, and Workspace sending address and sender name. Documents, emails, portals, and print views read this identity. Use a PNG logo under 300 KB; a transparent background works best.

Save before choosing **Check sending mailbox**. This asks Google whether Compass may send as the saved address and sends no email. A successful check verifies mailbox authorization, not delivery to a particular recipient. Inspect the next generated document or email before sharing it. **Reset to defaults** restores built-in department values; it does not rewrite files already sent or saved.

## Set Follow-Up and Ordering Rules {#workflows}

Admins use **Settings → Workflows** for **Staff Message Desk** thresholds, stale reminders, **Project aging**, **Nu-Tech emails**, the catalog link, and **Project paper trail**. Follow-up thresholds use business days. Project aging measures time since logged client contact and must have an overdue threshold later than its follow-up-due threshold.

Nu-Tech settings supply manufacturer, warehouse, dealer, and template details. Department profiles supply the sending mailbox and office identity. Use [Conversations and notifications](/dashboard/help/conversations-and-notifications#message-desk), [Navigating projects](/dashboard/help/navigating-projects#project-follow-up), and [Nu-Tech orders](/dashboard/help/nutech-orders) for the operational steps.

## Set Up Certificate Requests and W-9 Delivery {#job-emails}

Open **Settings → Workflows → Job emails**. Enter the insurance agent's email address, upload the company's W-9 as a PDF (up to 1 MB), and choose **Save delivery settings**. Replace an outdated PDF by uploading the new one, or choose **Remove W-9** to clear the attachment. Clear and save the agent address to disable certificate requests.

In the same section, choose the scope-of-work department to edit the subject and message for each email. **Reset to built-in wording** resets templates and keeps the delivery settings.

## Staff Email Addresses and Company Domains {#staff-email}

Open a staff member in **Settings > Team** to see **Other email addresses**: addresses they also write from, such as an old company domain or a mailbox they own. They are never used to sign in. Compass uses them to recognize the person on imported messages (**Contacts > Needs review**) and offers them as extra send-to choices next to the person's usual address, which stays the default. Administrators add and remove them; removing one asks for confirmation. An address that is anyone's sign-in email, or another staff member's other address, is refused. Each change is recorded in Activity.

**Settings > Workflows > Sage contact review** decides whether a staff member with Sage review approve access may approve the Sage contact changes and new Sage people they asked for themselves (the default), or whether **Require a second person to approve Sage contact changes** makes someone else approve them.

**Settings > Workflows > Company email domains** lists your company's own domains, old ones included. Addresses on them are never matched to a vendor by domain, and imported messages from them are matched to the staff member with the same name before the @ (for example name@old-domain.com to name@current-domain.com). Shared mailboxes such as accounting@ stay for review unless a staff member lists them as an other address. Never list a free email service such as gmail.com.

## Choose List Columns {#lists}

Admins open **Settings → Lists** to set how each sheet looks for the whole company: purchase orders (a job's and all jobs), RFQs, RFIs, to-dos, billed items and received payments, vendors, clients, and contacts to review. Pick a sheet on the left, then:

- tick **Show** for the columns the sheet shows, and drag a column by its handle (or use the up and down arrows) to change the order. The column that names the record is always shown, because it opens the record;
- choose the **Default sort** column and direction, or **The list's own order**. Only shown columns can be the sort; a person who hides the sort column sees the sheet in its built-in sort;
- for sheets with status filter buttons, choose the filter it **Opens on**, such as Open or All. A link that names a filter still opens on that filter.

The **Preview** shows the resulting headers. **Save** applies the layout for everyone in the company, and the change is recorded in Activity. **Use the built-in columns** goes back to the columns Compass ships with. Other staff can view this page but not change it.

Every sheet also has a **Columns** button above it. Anyone can use it to hide or show columns for themselves only; **Reset to company default** drops their own choices. Their choice is saved for them and does not change what anyone else sees. A column that Compass adds later appears on its own.

## Review Travel Charges and Rates {#travel}

**Settings → Zone charges** controls travel-charge assumptions shown on the portfolio map. Authorized staff can also make per-job adjustments to zone and mountain charges. Review the location, rate, and job adjustment before using a suggested charge in pricing. **Settings → Rate book** manages accepted estimating rates; see [Financial workflows](/dashboard/help/financial-workflows#rate-book). Neither map layers nor a settings edit independently adds an approved accounting charge.

**Settings → Workflows → Portfolio map** sets the **Map state** the dashboard map shows (any of the 50 states), along with where each department's jobs appear. The map state also decides which state's weather and wildfires are gathered, which state client and trade partner maps show, and which state an address without one is looked up in. See [Navigating projects](/dashboard/help/navigating-projects#portfolio-map).

**Settings → Workflows → Field app** decides which jobs appear in the field app on **Automatic** (the field app phases, using the same job status → phase mapping as the portfolio map, and the departments left out), and whether active Sage employees see every field app job without being added to each one. Below the rules, a sheet lists every job that isn't closed with its **Field app** choice (Automatic, Always show or Hide) and whether it is in the field app now. See [Offline Field Mode](/dashboard/help/offline-field-mode#which-jobs).

**Settings → Workflows → Weather & fire alerts** sets when the dashboard map's Weather and Fire & smoke layers flag a job: heavy snow or rain in 24 hours, wind gusts, extreme cold or heat, how close an active wildfire must be, the smoke density (light, medium or heavy) and the air quality index (AQI; 151 is where "Unhealthy" starts) that flag a job. Each company sets its own limits. The same page holds the rules for scheduled work: which item titles each rule matches, what it checks (a low or high temperature, gusts, rain or snow), the limit, and how many days after the item to keep checking, plus whether at-risk items notify the assignee and the job's staff. See [Schedules and tasks](/dashboard/help/schedules-and-tasks#weather).

## Manage Record Statuses {#statuses}

**Settings → Statuses** holds each record type's statuses: purchase orders, RFQs, RFIs, and to-dos. Pick a record type on the left. The order of the list is the order of the status filter buttons above that record type's lists and the order a Status column sorts in; drag a row by its handle or use the up and down arrows. For each status you can change its **Name** and **Color**, choose what it **Counts as** (Open, Closed, or Void; the **Open** filter button shows every record whose status counts as Open), and choose whether it shows as a **Filter button**. The preview shows the buttons the lists will show: Open, each shown status, then All.

Statuses marked **Built-in** are the ones Compass relies on, such as a P.O.'s Draft, Approved, Sent, Received, Closed, and Void. You can rename, recolor, reorder, or **Hide** them, but not delete them. A hidden status leaves the filter buttons and status choices; records that already have it keep it and still count by its group. **Add status** creates your company's own status. **Delete** removes one only while no record uses it; otherwise Compass explains how many records use it and offers **Hide** instead. Choose **Save statuses** to apply your changes; **Discard changes** returns to the saved list. Admins can change statuses, and every change is recorded in the company's activity history. Until your company changes a record type's statuses, Compass uses its standard list. The Open group also drives counts such as a job's open P.O.s and RFIs, and an RFI gets its answered date when its status counts as Closed.

## Check Data Health {#data-health}

Every morning Compass runs a read-only **data health** check. It looks for records whose status is one their status list doesn't allow (for example a change order or Sage request in a status Compass never sets, or a to-do, RFQ, or P.O. in a spelling **Settings → Statuses** doesn't recognize), and for tables or columns the database has that Compass doesn't expect, or the reverse. The check never changes any record.

In **Settings → Workflows → Data health**, admins choose whether to **Send Data health notices** and who gets them; with nobody chosen, every administrator does. A notice arrives at the bell only when the check first finds drift, when what it finds changes, and once more when it clears; a count that grows day to day does not send a new notice. **Check now** runs the same check on demand and lists what it found for your company. To fix a status, edit the record or add the spelling to **Settings → Statuses**; schema differences need a developer.

## Enable the Project Paper Trail {#paper-trail}

In **Settings → Workflows → Project paper trail**, choose **Off**, **Test projects only**, or **All projects**. Test mode needs selected projects before anything saves. Choose which supported record types to save: purchase orders, estimates, RFIs, and change orders. Set the quiet period after an edit and whether milestone copies are retained. Start with test projects and verify folder placement and privacy before expanding.

The working PDFs go to the mapped purchasing, working-estimate, communications, and change-order folders. Supported milestone events retain dated copies; later working edits replace the working copy. Records show their save state and an **Open copy** link. If a mapped folder is missing or a save fails, fix the mapping or reported error and verify a successful read-back. The paper trail begins Off by default and covers only the enabled project/type combination.

## Review Outside Drive Access {#trusted-access}

**Company email domains and trusted addresses** defines which recipients count as inside the company for paper-trail folder checks. The connected Google account's domain always counts. Add a company domain or a specific trusted personal address only after verifying who owns it and why it belongs in the internal audience; this is not a way to hide unintended sharing.

When the normal folder has other outside access, a copy is held in **Compass Records (internal)** and the warning identifies the outside access to review. This check changes where Compass files the copy; it does not revoke an existing Drive share. Correct inappropriate sharing in Drive and inspect the resulting copy. Deleting a Compass record preserves its last filed copy.
