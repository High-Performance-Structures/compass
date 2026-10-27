---
{
  "id": "daily.logs",
  "featureId": "daily-logs",
  "slug": "daily-logs",
  "title": "Daily Logs, Weather, Photos, and Attachments",
  "summary": "Create, edit, review, and approve daily logs with weather, photos, and attachments.",
  "contextSummary": "Daily Logs are the factual project record of work, crews, conditions, issues, and next steps. Approval and owner visibility are separate decisions.",
  "category": "Field & Project Work",
  "tags": ["daily logs", "weather", "photos", "attachments", "field", "review", "to-dos", "client contact", "cost codes", "reminders"],
  "audiences": ["staff"],
  "permissions": ["help:read", "project:read"],
  "routes": ["/dashboard/projects/[id]/daily-logs"],
  "owner": "Field operations",
  "lastReviewed": "2026-10-26"
}
---

## Create a Daily Log {#create-log}

Open the project's **Daily Logs**, confirm the project and log date, and create a new log. Use **Fill weather** when available, then review the retrieved conditions. Record work completed, crews, materials, deliveries, inspections, delays, safety information, visitors, and specific next steps as applicable.

Write facts another team member can understand later. Avoid unexplained abbreviations, personal commentary, and unapproved promises.

## Choose Cost Codes {#cost-codes}

Job daily logs use the full company cost-code catalog also used by Estimates, RFQs, purchase orders, change orders, financial forms, project contacts, and shop tickets. When a job has a budget, its current budget codes are shown by default. With no budget, the full company list is shown. Type a code or description to search the full company list, including codes outside the job’s budget. A job's department or the shorter labor list does not restrict its browser choices.

Departments enabled for cost codes in Field Mode download that same full job catalog. Refresh Field Mode's downloaded data after catalog changes. Internal workspaces show their customized duty codes by default and also allow searching the full company catalog. In Field Mode, only duties marked **On phones** are included alongside the company catalog.

## To-dos and Client Contact on a Log {#todos-client-contact}

A new log ties into the job's to-dos and client contact:

- **Blocked to-dos** from earlier logs ask whether each is **Still blocked** or **Cleared today**.
- **Open to-dos on this job** lists the job's open to-dos. Tick what was worked on today. Ticking adds a note to the to-do's history and can move an Open to-do to In progress. It never marks a to-do finished; a person does that on the to-do. When a to-do has a cost code, ticking it adds a cost code line for its hours, so the hours add up on the to-do.
- **Issues** and **Notes / next steps**: write one item per line. Choose **Make to-do** on a line to create a staff, sub or supplier to-do from it, with an assignee and cost code if you know them.
- **After a log is saved**: each line of Issues and Notes / next steps has its own **Make to-do**, both on the saved log and in its edit form. A line that is already a to-do shows **To-do made**, so it can't be made twice. Editing a log never turns lines into to-dos by itself, even when new logs do.
- **Client contact**: if you talked with, texted or met the client, log it here. It is saved as a client interaction and counts as client contact for follow-up. When Visitors names a client contact, Compass offers to fill it in. Tick **Make a follow-up to-do from this** when something needs doing.

Each to-do's history shows the logs that created and worked on it and the hours logged against it. After several logs, the to-do asks whether it is finished. Admins choose these rules in **Settings → Workflows → Daily logs**.

## Missing Daily Log Reminders {#reminders}

On work days, staff who haven't written a daily log get a reminder at the company's time: one for office staff and one for field staff. A log on any job or workspace, or time entered on the duty log, counts. People on an Absence on the work calendar are skipped. Tapping the reminder opens a new log on the job you were scheduled on, or where you last logged.

When the company allows it, you can choose your own reminder time in **Settings → Preferences**. Admins see who didn't log on the last work day on their dashboard, and the last five work days under **Office alerts → Missing daily logs**. Admins set the times, work days and who is reminded in **Settings → Workflows → Daily logs**.

## Add Files {#add-files}

Save the log before adding files. Choose **Add files**, select photos or supported documents, add a useful caption when needed, and upload. Files are stored in the project's mapped Drive location and attached to the Compass record.

Uploads should remain internal until an authorized reviewer makes a separate audience decision.

## Edit and Review {#edit-review}

Use the log's edit action to correct the record. Saving a material change may return it to review so previously approved owner-facing information cannot change silently.

Before approval, verify the date, narrative, attachments, and professionalism. Approval establishes the project record; it does not necessarily make the log or its photos owner-visible.

## Delete a Daily Log {#delete-log}

Open a log with **Edit** and choose **Delete**, or tick several logs and choose **Delete selected**. Compass asks you to confirm first. Photos and files attached to a deleted log stay in the project's photos, and a copy of each deleted log is kept in the activity log.

You can delete a log you wrote until it is approved or shared with the owner. Admins can delete any log. A log used in an owner update, draft or published, must be removed from that update first.

## Draft an Owner Update {#draft-owner-update}

Filter logs to the intended reporting period, review the visible results, select only the appropriate entries, and choose **Draft owner update**. Review and edit the resulting client-facing draft before publishing.

## Quick Check {#quick-check}

- [ ] The project, date, and weather are correct.
- [ ] Work and next steps are specific.
- [ ] To-dos worked on are ticked, and follow-ups are made into to-dos.
- [ ] Client contact made today is logged.
- [ ] Files belong to this log and project.
- [ ] Approval and owner visibility were reviewed separately.

See [Photo visibility](/dashboard/help/photo-review-and-visibility) and [Owner updates](/dashboard/help/owner-updates).
