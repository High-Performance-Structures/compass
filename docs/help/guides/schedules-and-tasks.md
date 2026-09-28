---
{
  "id": "schedule",
  "featureId": "schedule",
  "slug": "schedules-and-tasks",
  "title": "Schedules, Tasks, Predecessors, and Workdays",
  "summary": "Work with schedules, Gantt items, tasks, predecessors, baselines, and workday exceptions.",
  "contextSummary": "The project schedule is the shared source for timing. Relationships, calendars, and baselines explain why dates move and what changed.",
  "category": "Field & Project Work",
  "tags": ["schedule", "tasks", "Gantt", "critical path", "predecessors", "baseline", "workdays", "publish", "move to draft", "templates", "weather", "forecast", "concrete pour"],
  "audiences": ["staff"],
  "permissions": ["help:read", "schedule:read"],
  "routes": ["/dashboard/schedule", "/dashboard/projects/[id]/schedule"],
  "owner": "Scheduling operations",
  "lastReviewed": "2026-10-25"
}
---

## Open a Schedule {#open-schedule}

Use **Schedules & Calendar** for a cross-project entry point or open a project's **Schedule** for its detailed timeline. The project switcher can move between jobs while keeping schedule context. Available views and editing controls depend on role and screen size.

## Gantt View {#gantt}

The task list and timeline scroll together. The Gantt opens around **Today**; use **Today**, zoom, search, grouping, and color modes to focus the view. Selecting a row selects the schedule item without rebuilding the whole view or repeatedly jumping the timeline. Grouping by phase keeps list rows aligned with their bars. Colors are viewing aids; confirm actual phase, status, and completion data.

## Critical Path {#critical-path}

Critical Path highlights the linked activities currently controlling the schedule's finish. It helps the team focus on work where delay is most likely to affect completion.

The critical path is calculated from activity duration, dependencies, dates, and the work calendar. If it looks wrong, review missing or incorrect predecessors and constraints before manually forcing dates. A highlighted activity is schedule-critical, not automatically the highest business priority.

## Create or Edit a Schedule Item {#schedule-item}

Enter a clear title, start date, workday duration, phase, assignee, and any dependency details. Use **Notes** for additional activity context that belongs with the schedule item, then review calculated dates before saving. If an assignee lacks project access, grant only the project role and permissions their work requires.

- **End date or duration.** Type a duration in workdays, or pick an **End** date and Compass works out the duration from the project's workday calendar, skipping weekends and holidays. If you pick a day that isn't a workday, the item ends on the workday before it, and Compass tells you.
- **Time (optional).** Items are all day unless you add a **Start time**; an **End time** is optional too. A one-day item with a time shows at that time on My Compass and project Google calendars. A longer item stays all day there, with the time in its details.
- **Color.** Pick a palette color or **Custom**. The custom colors you used most recently appear under **Recent**, so you can match them again.
- **Delete.** Open the item and select **Delete schedule item**, or use the trash button on its row in the **List** view. Deleting also removes its dependencies and can't be undone.

## Predecessors {#predecessors}

A predecessor describes how one activity controls another. Choose the correct source activity and relationship, and add lag only when the delay is intentional. Review recalculated dates after saving.

Do not force a dependent item to an incompatible date until you know whether its relationship, lag, constraint, or work calendar is wrong. Preserve actual completion information for finished work.

## Publish a Schedule {#publish-schedule}

The first **Publish schedule** makes selected visible items available in owner and trade-partner workspaces and does not require a change reason. Later edits remain internal while viewers continue to see the last published version. Use **Publish changes** and enter a concise reason for another revision, including republishing a previously published schedule after it was hidden.

A schedule that has never been published is a draft: edit dates, predecessors, and workday exceptions freely, with no shift reason. Once a schedule has been published, including one later moved back to draft, any change that moves dates asks for a **Schedule shift reason**, which is saved in the schedule's activity history.

Authorized staff can choose **Move to draft** to hide the schedule from owners and subcontractors while retaining the internal tasks and publication history. Confirm the action and coordinate any commitments affected. Publish again when the schedule is ready. Item-level visibility changes also reach external workspaces only after publication.

Use audience preview after publishing or moving to draft to verify what external users can see.

## Workday Exceptions {#workday-exceptions}

Use a non-working exception for a holiday, closure, or shutdown and a working exception for an approved extra workday. Once the schedule has been published, add a reason. Because the calendar can recalculate several dependent activities, review the affected schedule after saving.

## Weather Warnings on Scheduled Work {#weather}

Compass checks schedule items starting in the next five days against the National Weather Service forecast for the job site's own area. An item is at risk when its title matches one of your company's weather rules (for example, a **pour** with a low below 40°F in the three days after it, or **roofing** with gusts over 30 mph), or when heavy snow, extreme cold or heat, or a weather warning falls on its days. The job's overview shows **Site weather** with the next three days and **Scheduled work at risk**; choose **Open in schedule** to move the item, or **Make to-do** for a linked, high-priority to-do due the day the weather turns. The item's assignee and the job's staff are notified once for each item, rule and day (turn this off in settings). Rules and limits are in **Settings → Workflows → Weather & fire alerts**. The forecast is a guide; confirm conditions on site before changing work.

## Baselines {#baselines}

A baseline is a saved snapshot for comparison. Create one before a major approved revision and use its overlay to compare prior planned dates with the live schedule. A baseline is historical evidence, not another editable live schedule.

## Schedule Templates {#schedule-templates}

To reuse a schedule, open the schedule's **⋯** menu and choose **Save schedule as template**. Compass saves every item with its workdays, spacing, phase, color, crew placeholder, owner and trade-partner visibility, notes, and predecessors (type and lag). Dates are stored as workdays from the first item, so the template can start on any date. Progress, confirmations, and named users stay with the original project. To update a saved schedule, choose **Save as a new version of a saved schedule**. Projects that already used an earlier version keep it.

To bring a saved schedule into a project, choose **Import schedule items**, pick the template, and set the first-item start date. A saved schedule comes in whole, with every item selected and its predecessors kept. Untick any items the project doesn't need. Imported items follow this project's workday calendar. Saved schedules appear in the **Template Library** as Schedule templates, where they can be set inactive or deleted.

## Tasks and To-Dos {#tasks}

A useful task has a clear action, project context, assignee, due date, source-record link when available, and current status. Personal calendar choices do not replace the project's operational schedule.

## Ask Jarvis to Help with the Schedule {#jarvis-schedule}

Ask Jarvis to read the project's tasks, dependencies, workday exceptions, overall progress, or critical path. It can propose creating, updating, or deleting tasks and adding or removing predecessor relationships. Every built-in schedule mutation waits for **Confirm** in chat and still checks your permissions. Review the exact project, task, date, duration, and dependency before confirming, then inspect the updated schedule and downstream dates. This does not publish a revised schedule automatically. See [Ask Jarvis](/dashboard/help/ask-jarvis#schedule-actions).

## Quick Check {#quick-check}

- [ ] The project, title, phase, assignee, dates, and duration are correct.
- [ ] Dependencies and lag represent the real sequence.
- [ ] I reviewed downstream dates after changes.
- [ ] Published schedule revisions include a change reason.
- [ ] On a published schedule, workday exceptions have a reason.
- [ ] I verified audience visibility after publishing or moving to draft.
- [ ] Completed work retains accurate history.
