---
{
  "id": "schedule",
  "featureId": "schedule",
  "slug": "schedules-and-tasks",
  "title": "Schedules, Tasks, Predecessors, and Workdays",
  "summary": "Work with schedules, Gantt items, tasks, predecessors, baselines, and workday exceptions.",
  "contextSummary": "The project schedule is the shared source for timing. Relationships, calendars, and baselines explain why dates move and what changed.",
  "category": "Field & Project Work",
  "tags": ["schedule", "tasks", "Gantt", "critical path", "predecessors", "baseline", "workdays"],
  "audiences": ["staff"],
  "permissions": ["help:read", "schedule:read"],
  "routes": ["/dashboard/schedule", "/dashboard/projects/[id]/schedule"],
  "owner": "Scheduling operations",
  "lastReviewed": "2026-09-05"
}
---

## Open a Schedule {#open-schedule}

Use **Schedules & Calendar** for a cross-project entry point or open a project's **Schedule** for its detailed timeline. The project switcher can move between jobs while keeping schedule context. Available views and editing controls depend on role and screen size.

## Gantt View {#gantt}

The task list and timeline move together. Select an item to bring its date into view, use **Today** and zoom controls to navigate, and use grouping or color modes as viewing aids. Colors do not replace phase, status, or completion data.

## Critical Path {#critical-path}

Critical Path highlights the linked activities currently controlling the schedule's finish. It helps the team focus on work where delay is most likely to affect completion.

The critical path is calculated from activity duration, dependencies, dates, and the work calendar. If it looks wrong, review missing or incorrect predecessors and constraints before manually forcing dates. A highlighted activity is schedule-critical, not automatically the highest business priority.

## Create or Edit a Schedule Item {#schedule-item}

Enter a clear title, start date, workday duration, phase, assignee, and any dependency details. Review calculated dates before saving. If an assignee lacks project access, grant only the project role and permissions their work requires.

## Predecessors {#predecessors}

A predecessor describes how one activity controls another. Choose the correct source activity and relationship, and add lag only when the delay is intentional. Review recalculated dates after saving.

Do not force a dependent item to an incompatible date until you know whether its relationship, lag, constraint, or work calendar is wrong. Preserve actual completion information for finished work.

## Workday Exceptions {#workday-exceptions}

Use a non-working exception for a holiday, closure, or shutdown and a working exception for an approved extra workday. Add a reason. Because the calendar can recalculate several dependent activities, review the affected schedule after saving.

## Baselines {#baselines}

A baseline is a saved snapshot for comparison. Create one before a major approved revision and use its overlay to compare prior planned dates with the live schedule. A baseline is historical evidence, not another editable live schedule.

## Tasks and To-Dos {#tasks}

A useful task has a clear action, project context, assignee, due date, source-record link when available, and current status. Personal calendar choices do not replace the project's operational schedule.

## Quick Check {#quick-check}

- [ ] The project, title, phase, assignee, dates, and duration are correct.
- [ ] Dependencies and lag represent the real sequence.
- [ ] I reviewed downstream dates after changes.
- [ ] Workday exceptions have a reason.
- [ ] Completed work retains accurate history.
