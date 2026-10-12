---
{
  "id": "projects.navigation",
  "featureId": "project-hub",
  "slug": "navigating-projects",
  "title": "Navigating Projects and Keeping Context",
  "summary": "Find jobs on the dashboard map and pipelines, track follow-up, change statuses, and preserve project context.",
  "contextSummary": "The active project controls where new records, messages, uploads, and edits are saved. Confirm it before every consequential action.",
  "category": "Start Here",
  "tags": ["projects", "navigation", "dashboard", "portfolio map", "pipeline", "Nu-Tech Sales", "project aging", "follow-up", "status", "project switcher", "duplicate review", "project family", "phase", "sorting", "sidebar"],
  "audiences": ["staff"],
  "permissions": ["help:read", "project:read"],
  "routes": ["/dashboard", "/dashboard/projects", "/dashboard/client-follow-up", "/dashboard/executive-admin/project-archive"],
  "owner": "Compass product team",
  "lastReviewed": "2026-10-10"
}
---

## Scrolling Long Pages and Forms {#scrolling-long-pages}

A scrollbar appears when a page, document editor, form, or panel has more content than fits on screen. You can drag the scrollbar to return to earlier content; it stays available without hovering over the page. Wide tables and navigation rows also show a horizontal scrollbar when there is more content to the side. When you open an estimate line editor or move between fields, only the content scrolls; the workspace frame stays in place. You should not need to refresh to get back to earlier content.

## Open a Project {#open-project}

Select **Projects**, choose the appropriate department and status view, then search by project number, client, name, or address. The project overview and navigation show only the tools allowed by your role and assignment.

## Find Project Financials {#project-financials}

Expand **Projects** in the left menu, then expand **Project Financials** to reach Financial Overview, Estimates, Project Budget, Bills & Pay Applications, Purchase Orders, and Change Orders. If several menu sections are open, scroll inside the left menu to reach later sections. Opening another section keeps the remaining menu items reachable. The Compass icon at the bottom opens a compact drawer: hover over it or click/tap it to see your photo, **Help**, **Feedback**, **Settings**, and communication controls. Choose **Pin** to leave the drawer open, or **Unpin** to return to a temporary drawer. The pin preference is remembered in this browser. Select the photo to change or reset it. The photo stays compact with crisp edges when you widen the sidebar, and the menu scrollbar remains available above the drawer.

## Arrange Your Role Dashboard {#role-dashboard-order}

On a project's Overview, the **Role dashboard** lists the work queues for your role. To change their order, drag an item by the handle on its left or use its small up and down arrows. Your order is saved for you, separately for each role, and applies to every project. Choose **Reset order** to go back to the role's default order.

## Keep Project Context {#keep-context}

The active project determines where Compass saves records and uploads. When a project switcher is available inside a workflow, use it to move to the same tool on another job. Before saving, sending, approving, or uploading, verify the project number and name shown on the page.

## Global and Project Views {#global-vs-project}

Global pages such as Schedules, RFIs, Purchase Orders, Conversations, Contacts, and Files may show work from several projects. A project page narrows that tool to one job. Use the project selector when a global entry point asks you to choose context.

## Use Help Without Losing Context {#help-beacons}

The Help icon in the main header opens the searchable guide drawer without leaving the current page. Small compass-and-question-mark beacons appear beside selected tools that need extra explanation. Hover or focus a beacon for a short tooltip, click or tap it for a compact Help card, or double-click it to open the matching full guide. The guide opens in Compass with **Close help** so you can return to the page you were using.

## Project Status {#project-status}

Status controls how a job appears in the Project Hub. Open the status selector and choose either a lifecycle view—**All**, **Active**, **Warranty**, **Complete**, **Inactive**, **Archive**, or **Other**—or an exact job status. Search the selector when the status list is long. Counts show how many projects match each choice, and approved job statuses remain listed even when their current count is zero.

Lifecycle views group related job statuses for browsing; an exact job status narrows the list to that one value. The Project Hub opens on **Active**. Use **All** when a project may have moved to another lifecycle, and use **Clear filters** to reset both department and status. Only authorized users should change a project's underlying status, and historical projects should be retained rather than recreated.

## Change Several Project Statuses at Once {#bulk-status}

On **All Projects**, open a department (or search) and choose **Select**. Tick the project cards to change, or use **Select all shown**, then choose the new status in the bar at the bottom and click **Change status**. Each project is checked and recorded the same way as a single status change. Any project you can't change stays selected so you can review it. Choose **Done** to stop selecting.

## Group Long-Running Work into Phases {#project-phases}

Use a project family when one overall client effort receives separately
funded scopes months or years apart. The original project is Phase 1 and keeps
its unsuffixed number. Later phases use the same base number with `-1`, `-2`,
and so on. Each phase remains a normal Compass project with its own contract,
change orders, status, Sage review, and project records.

Authorized registry managers can plan a future phase or link an existing
project as a phase. Linking preserves the existing project and its records; it
does not merge the projects' financial or operational data. If Compass changes
the existing number to the canonical family phase number, the old number is
retained as a historical alias and the Drive/tracker update workflow is queued.
Only use this path when the existing project is genuinely a separately funded
scope within the same overall project family.

From an estimate, use **Duplicate estimate** to copy it into another activated
phase in the same family. Leave the new version number blank to use the next
available version. Planned phases need a Compass project before they can hold
an estimate.

## Review Duplicate Projects and Registry Cleanup {#duplicate-projects}

Authorized registry managers can use **Scan for duplicates** in the Project Hub, then **Review and resolve** any possible match. Compare the project number, client, address, and the reasons Compass flagged the pair before deciding. If they are separate projects, mark them **Not duplicates**; when they share a department-sequence number, keep both and assign one a new approved number instead. The old number remains a historical alias.

If two records truly represent the same project, select the project to keep and review the inventory of linked records before confirming **Merge projects**. Compass transfers the linked records together; if a record cannot move safely, it keeps both projects unchanged. The other registry record is archived for recovery. Do not merge merely because names or numbers look similar.

**Merge or remove project** provides a manual cleanup path for authorized managers. **Remove from registry** leaves a recoverable record in **Restricted Workflows → Project Archive** and retires its number; it does not transfer linked work. Staff granted Project Archive access in Settings > Permissions can view the archive; approval access permits restoration and permanent deletion. Permanent deletion is available only when no linked project records remain, and it does not make a retired number reusable.

## Wrong Project Active {#wrong-project}

Stop before saving. Switch to the correct job and confirm its number and client. If the record was already saved, notify a project administrator so it can be corrected or removed with an audit trail; do not immediately create a duplicate.

## Use the Portfolio Map and Pipelines {#portfolio-map}

On **Dashboard**, the portfolio window brings together the project map and pipelines, including **Nu-Tech Sales**. Select a job to open its detail panel, then use **Open job** or the available shortcuts. The construction pipeline runs through **Intake**, **Design**, **Estimating**, **Negotiation**, **Permitting**, **Under construction**, and **Closeout**. The map is a summary of included jobs; use **All Projects** to find work outside that view.

Authorized staff can use **MOVE TO** in a job panel to choose a status within the available phase or sales stage. This saves a real job-status change. To close a job as complete, inactive, or bid refused, use its job page. Any single job can be added with **Add a project to the map** or removed with **Hide from map**; jobs you hid are listed below the map with **Show on map**. Map visibility does not grant project access.

**INTERNAL** shows the company's own offices and yards (the internal workspaces) on their own map and list, apart from client projects. Select one to open its overview or duty log, or to add its address so it is placed on the map.

Admins choose which job statuses and departments appear by default, and the phase each status falls in, in **Settings → Workflows → Portfolio map**.

Turn on **Messages** to see your unread items stacked on jobs and listed in the selected job panel. Opening and reading the linked item clears the corresponding notification. **Zone charges** and **Mountain charge** show travel-charge information; the key below the map explains the layers. A map marker or suggested location should be checked against the actual job address before using it for travel or pricing.

## Track Client Follow-Up {#project-follow-up}

Follow-up flags appear on the map, pipelines, and tracker for job statuses that require client contact. **Follow-up due** is amber and **Overdue** is red. Aging is counted in business days since the last logged client contact, so record the actual contact in the job's follow-up workflow. Schedule lateness can also flag a construction job; inspect the panel to understand the reason.

**Log contact** opens the client interaction record, which is also at the top of the project's **Information** page. Choose the client contact, how you reached them (call, email, text, meeting, site visit, or your own type), who reached out, and when, then describe what happened and the next step. Only a completed record counts as client contact and resets the clock. **Snooze** moves the next follow-up date but does not count as contact.

By default, a job with no client contact logged shows **No contact logged**. When an admin turns on **Flag jobs with no logged contact** in **Settings → Workflows → Project aging**, those jobs start aging from the day it's turned on (or from when the job was created, if later). They then turn due and overdue on the same thresholds and send reminders like any other job.

Admins set every status's thresholds in one place: **Settings → Workflows → Project aging**. This includes statuses your organization added, and leaving both values blank means a status isn't followed up. **Settings → Workflows → Client contact records** sets how much a record must describe and how far back it may be dated. Changing a threshold changes when jobs are flagged; it does not record a client response or complete a follow-up.

## Use the Client Follow-Up Page {#client-follow-up-page}

**Client follow-up** in the sidebar brings every followed-up job together in one place:

- **Counts:** how many jobs are overdue, due, or have no logged contact, and how many contacts were logged in the period.
- **Team client contact:** a leaderboard of towers, one per person, sized by logged contacts and colored by type. Streaks count consecutive business days with logged contact.
- **Jobs by follow-up:** a tower for each job, colored by its follow-up level, so neglected jobs stand out in red.
- **Lists:** jobs needing follow-up, and every logged client interaction across all jobs.

Choose the period at the top. Click a person or a job to filter everything below it. A selected job shows its follow-up details with **Log contact**, plus links to show it on the dashboard map or pipeline and to open the job. **Log contact** at the top of the page lets you pick any job and record an interaction. On the dashboard map, a job's follow-up panel links back here with **Client follow-up**.

When a job's follow-up turns **Overdue**, the person responsible gets one urgent reminder. That's its follow-up owner; if no owner is set, whoever last logged contact; and if neither, the department's **Default follow-up owner** chosen in **Settings → Workflows → Project aging**. Their **Client follow-up** link in the sidebar turns red with a count of their overdue jobs, and the bell turns red until the reminder is read. Logging a client contact on the job, including an email sent from Compass or an inbound client email or text, clears the reminder. If the job goes overdue again later, it sends one new reminder. Admins can turn these reminders off in **Settings → Workflows → Project aging**.

Only completed interaction records count, so the numbers reflect real client contact. Admins choose what the page shows, including the leaderboard, streaks, the leader highlight, the opening period, and whether emails sent from Compass count, in **Settings → Workflows → Client follow-up page**.

## Search, Sort, and Page Through Lists {#list-controls}

Use searchable pickers to find projects, contacts, cost codes, statuses, and other long option lists. In lists with sortable headings, select a column heading to change the order and select it again to reverse it. Use the page controls to review additional rows. Confirm the current filter, page, and selected records before a batch action; a visible page is not necessarily the complete queue.

## Quick Check {#quick-check}

- [ ] I verified the project number and department.
- [ ] I searched the queue before creating a record.
- [ ] I used the project switcher to preserve workflow context.
- [ ] I know the small compass-and-question-mark beacons provide contextual Help.
- [ ] I reviewed possible duplicate projects and their linked records before any registry cleanup.
- [ ] I stopped and reported anything saved to the wrong job.
