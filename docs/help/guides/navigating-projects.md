---
{
  "id": "projects.navigation",
  "featureId": "project-hub",
  "slug": "navigating-projects",
  "title": "Navigating Projects and Keeping Context",
  "summary": "Find projects, switch jobs without losing your workflow, and confirm project context.",
  "contextSummary": "The active project controls where new records, messages, uploads, and edits are saved. Confirm it before every consequential action.",
  "category": "Start Here",
  "tags": ["projects", "navigation", "status", "project switcher", "context", "help beacon", "tooltip", "duplicate review", "project archive", "project family", "phase"],
  "audiences": ["staff"],
  "permissions": ["help:read", "project:read"],
  "routes": ["/dashboard/projects", "/dashboard/executive-admin/project-archive"],
  "owner": "Compass product team",
  "lastReviewed": "2026-10-06"
}
---

## Scrolling Long Pages and Forms {#scrolling-long-pages}

A scrollbar appears when a page, document editor, form, or panel has more content than fits on screen. You can drag the scrollbar to return to earlier content; it stays available without hovering over the page. Wide tables and navigation rows also show a horizontal scrollbar when there is more content to the side. When you open an estimate line editor or move between fields, only the content scrolls; the workspace frame stays in place. You should not need to refresh to get back to earlier content.

## Open a Project {#open-project}

Select **Projects**, choose the appropriate department and status view, then search by project number, client, name, or address. The project overview and navigation show only the tools allowed by your role and assignment.

## Find Project Financials {#project-financials}

Expand **Projects** in the left menu, then expand **Project Financials** to reach Financial Overview, Estimates, Project Budget, Bills & Pay Applications, Purchase Orders, and Change Orders. If several menu sections are open, scroll inside the left menu to reach later sections. Opening another section keeps the remaining menu items reachable. The Compass icon at the bottom opens a compact drawer: hover over it or click/tap it to see your photo, **Help**, **Feedback**, **Settings**, and communication controls. Choose **Pin** to leave the drawer open, or **Unpin** to return to a temporary drawer. The pin preference is remembered in this browser. Select the photo to change or reset it. The photo stays compact with crisp edges when you widen the sidebar, and the menu scrollbar remains available above the drawer.

## Keep Project Context {#keep-context}

The active project determines where Compass saves records and uploads. When a project switcher is available inside a workflow, use it to move to the same tool on another job. Before saving, sending, approving, or uploading, verify the project number and name shown on the page.

## Global and Project Views {#global-vs-project}

Global pages such as Schedules, RFIs, Purchase Orders, Conversations, Contacts, and Files may show work from several projects. A project page narrows that tool to one job. Use the project selector when a global entry point asks you to choose context.

## Use Help Without Losing Context {#help-beacons}

The Help icon in the main header opens the searchable guide drawer without leaving the current page. Small compass-and-question-mark beacons appear beside selected tools that need extra explanation. Hover or focus a beacon for a short tooltip, click or tap it for a compact Help card, or double-click it to open the matching full guide. The guide opens in Compass with **Close help** so you can return to the page you were using.

## Project Status {#project-status}

Status controls how a job appears in the Project Hub. Open the status selector and choose either a lifecycle view—**All**, **Active**, **Warranty**, **Complete**, **Inactive**, **Archive**, or **Other**—or an exact job status. Search the selector when the status list is long. Counts show how many projects match each choice, and approved job statuses remain listed even when their current count is zero.

Lifecycle views group related job statuses for browsing; an exact job status narrows the list to that one value. The Project Hub opens on **Active**. Use **All** when a project may have moved to another lifecycle, and use **Clear filters** to reset both department and status. Only authorized users should change a project's underlying status, and historical projects should be retained rather than recreated.

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

## Quick Check {#quick-check}

- [ ] I verified the project number and department.
- [ ] I searched the queue before creating a record.
- [ ] I used the project switcher to preserve workflow context.
- [ ] I know the small compass-and-question-mark beacons provide contextual Help.
- [ ] I reviewed possible duplicate projects and their linked records before any registry cleanup.
- [ ] I stopped and reported anything saved to the wrong job.
