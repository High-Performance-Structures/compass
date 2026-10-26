---
{
  "id": "internal.workspaces",
  "featureId": "project-hub",
  "slug": "internal-workspaces-and-duties",
  "title": "Internal Workspaces, Duty Logs, and Recurring Work",
  "summary": "Use office, executive, and field workspaces to record duties, finish recurring work, and arrange role-specific queues.",
  "contextSummary": "Internal workspaces are company locations rather than client jobs. Record the person, date, duty, and related client project when applicable, and keep recurring work current without losing its history.",
  "category": "Field & Project Work",
  "tags": ["internal workspace", "duty log", "recurring duties", "work queue", "office", "executive", "field", "legacy daily logs"],
  "audiences": ["staff"],
  "permissions": ["help:read", "project:read"],
  "routes": ["/dashboard/projects/[id]", "/dashboard/projects/[id]/duty-log"],
  "owner": "Compass product team",
  "lastReviewed": "2026-10-26"
}
---

## Recognize an Internal Workspace {#recognize-workspace}

The **Internal** map and list contain company offices and yards, separate from client projects. An internal workspace can be configured for office, executive, or field work. Its Overview shows this week's hours by duty and person, a recurring-duty attention list, waiting logs, and the work queues appropriate to that workspace type. The full recurring-duty board is on **Duty Log**. The project paper trail is for client projects and does not run for internal workspaces.

Confirm the workspace name before recording work. When an internal duty supports a client job, link the client project on the duty entry rather than opening the client project's daily log as a substitute.

Administrators can convert a regular project with **Make it an office workspace**, **Make it an owner's office workspace**, or **Make it a field workspace**. Confirm that the record is truly a company location before converting it because the choice changes its Overview and operational queues.

## Create and Configure a Workspace {#create-workspace}

Authorized staff can open the **Internal Project Hub**, choose **New internal workspace**, and select the office, owner's-office, or field workspace type. Choose the correct parent department, add an optional workspace number when the company uses one, and confirm the name before creating it. Use a client project instead when the work belongs to a customer job.

Administrators can use **Settings → Company → Internal department** to change the company-wide Project Hub tab name and description for all internal workspaces. To change one workspace's type or whether it is listed under that department, open the workspace's **Information** page and use **Job or internal workspace**. Update the individual workspace's project details through its authorized project controls. Treat the department relationship and workspace type as operational configuration: review the Overview and Duty Log after a change so queues, duties, and reporting still appear in the intended place.

## Record a Duty {#duty-log}

Open the internal workspace and choose **Log duty** or **Duty Log**. Add the work date, duty, optional hours and notes, and the related client project when applicable. A new entry uses the signed-in person. Duty choices come from the configured internal-duty list, whose defaults mirror the company's Sage cost codes, so select the code that best describes the work rather than inventing a similar label.

The current-month view summarizes hours by duty. Staff can edit or delete their own entries; administrators can correct any entry. Check the person, date, hours, and client-project link before using the immediate delete action because the removal affects the duty history.

## Classify Legacy Daily Logs {#legacy-daily-logs}

Older internal daily logs without a duty appear as waiting for classification and in the Overview's attention count. Assign the correct duty to turn the legacy record into a duty-log entry while preserving the original author. Deleting that generated duty entry returns the original log to the waiting list so it can be classified again; it does not silently discard the source record.

## Complete Recurring Duties {#recurring-duties}

The recurring-duty board shows the duty name, account, cadence, due day, owner, and the duty used when hours are logged. The due day applies to the following month. Statuses distinguish **Behind**, **Due soon**, **Current**, and **Not started**. Use **Mark done** only after the work is actually complete. Compass always records the completion; it also creates a duty-log entry when hours are entered and the recurring item has a duty code. The person who marked the completion, or an administrator, can use **Undo last** when it was recorded by mistake.

Administrators can add, edit, or turn off recurring duties. A duty with no completion history can be deleted; once it has history, turn it off so the record remains explainable. Use **Show turned off** when historical duties need review.

## Arrange Work Queues {#work-queues}

The Overview queues and their default emphasis differ for office, owner's-office, and field workspaces. Drag a queue by its handle or use its move controls to change the order. Compass saves the order for you and that workspace type. Use **Reset order** to restore the default arrangement; this changes presentation, not the underlying duties or records.

## Quick Check {#quick-check}

- [ ] I am in the correct internal workspace.
- [ ] The person, date, duty, hours, and client-project link are accurate.
- [ ] I classified legacy work without deleting its source history.
- [ ] I marked recurring work done only after completing it.
- [ ] I used queue order only to organize the view.

See [Navigating projects](/dashboard/help/navigating-projects#portfolio-map) and [Daily logs](/dashboard/help/daily-logs) for related project workflows.
