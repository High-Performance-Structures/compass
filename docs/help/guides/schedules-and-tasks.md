---
{
  "id": "schedule",
  "featureId": "schedule",
  "slug": "schedules-and-tasks",
  "title": "Schedules, Tasks, Predecessors, and Workdays",
  "summary": "Work with schedules, Gantt items, tasks, predecessors, baselines, and workday exceptions.",
  "contextSummary": "The project schedule is the shared source for timing. Relationships, calendars, and baselines explain why dates move and what changed.",
  "category": "Field & Project Work",
  "tags": ["schedule", "tasks", "Gantt", "critical path", "predecessors", "baseline", "workdays", "publish", "move to draft"],
  "audiences": ["staff"],
  "permissions": ["help:read", "schedule:read"],
  "routes": ["/dashboard/schedule", "/dashboard/projects/[id]/schedule"],
  "owner": "Scheduling operations",
  "lastReviewed": "2026-10-12"
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

## Predecessors {#predecessors}

A predecessor describes how one activity controls another. Choose the correct source activity and relationship, and add lag only when the delay is intentional. Review recalculated dates after saving.

Do not force a dependent item to an incompatible date until you know whether its relationship, lag, constraint, or work calendar is wrong. Preserve actual completion information for finished work.

## Publish a Schedule {#publish-schedule}

The first **Publish schedule** makes selected visible items available in owner and trade-partner workspaces and does not require a change reason. Later edits remain internal while viewers continue to see the last published version. Use **Publish changes** and enter a concise reason for another revision, including republishing a previously published schedule after it was hidden.

Authorized staff can choose **Move to draft** to hide the schedule from owners and subcontractors while retaining the internal tasks and publication history. Confirm the action and coordinate any commitments affected. Publish again when the schedule is ready. Item-level visibility changes also reach external workspaces only after publication.

Use audience preview after publishing or moving to draft to verify what external users can see.

## Workday Exceptions {#workday-exceptions}

Use a non-working exception for a holiday, closure, or shutdown and a working exception for an approved extra workday. Add a reason. Because the calendar can recalculate several dependent activities, review the affected schedule after saving.

## Baselines {#baselines}

A baseline is a saved snapshot for comparison. Create one before a major approved revision and use its overlay to compare prior planned dates with the live schedule. A baseline is historical evidence, not another editable live schedule.

## Tasks and To-Dos {#tasks}

A useful task has a clear action, project context, assignee, due date, source-record link when available, and current status. Personal calendar choices do not replace the project's operational schedule.

## Ask Jarvis to Help with the Schedule {#jarvis-schedule}

Ask Jarvis to read the project's tasks, dependencies, workday exceptions, overall progress, or critical path. It can propose creating, updating, or deleting tasks and adding or removing predecessor relationships. Every built-in schedule mutation waits for **Confirm** in chat and still checks your permissions. Review the exact project, task, date, duration, and dependency before confirming, then inspect the updated schedule and downstream dates. This does not publish a revised schedule automatically. See [Ask Jarvis](/dashboard/help/ask-jarvis#schedule-actions).

## Quick Check {#quick-check}

- [ ] The project, title, phase, assignee, dates, and duration are correct.
- [ ] Dependencies and lag represent the real sequence.
- [ ] I reviewed downstream dates after changes.
- [ ] Published schedule revisions include a change reason.
- [ ] I verified audience visibility after publishing or moving to draft.
- [ ] Workday exceptions have a reason.
- [ ] Completed work retains accurate history.
