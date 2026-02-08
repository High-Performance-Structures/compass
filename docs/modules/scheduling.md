Scheduling Module
===

The scheduling module is a construction-specific project scheduling system with Gantt charts, critical path analysis, dependency management, workday exception calendars, and baseline tracking. It's the most computation-heavy module in Compass -- most of the logic lives in pure functions in `src/lib/schedule/` rather than in the server actions.


data model
---

The scheduling data lives in four tables defined in the core schema (`src/db/schema.ts`):

**`schedule_tasks`** -- individual tasks within a project. Each task has a title, start date, workday count (not calendar days), a calculated end date, a construction phase, status, completion percentage, and sort order. The `isCriticalPath` flag is recomputed by the system, not set manually.

**`task_dependencies`** -- relationships between tasks. Each dependency has a predecessor, successor, type (FS/SS/FF/SF), and lag in days. Dependencies drive both date propagation and critical path analysis.

**`workday_exceptions`** -- non-working days per project. Holidays, vacation days, weather days. These are excluded from business-day calculations. Exceptions can be one-time or yearly recurring, and are categorized (national holiday, state holiday, vacation, company holiday, weather day).

**`schedule_baselines`** -- named snapshots of the schedule at a point in time. Stores a JSON blob of all tasks and dependencies, used for tracking schedule drift.

The type system (`src/lib/schedule/types.ts`) models construction phases explicitly:

```typescript
export type ConstructionPhase =
  | "preconstruction" | "sitework" | "foundation" | "framing"
  | "roofing" | "electrical" | "plumbing" | "hvac"
  | "insulation" | "drywall" | "finish" | "landscaping"
  | "closeout"
```

This is construction-specific by design. A different industry module would define its own phase vocabulary.


business day calculations
---

`src/lib/schedule/business-days.ts` handles the mapping between workdays and calendar dates. The core function is `calculateEndDate`:

```typescript
export function calculateEndDate(
  startDate: string,
  workdays: number,
  exceptions: WorkdayExceptionData[] = []
): string
```

It walks forward from the start date, counting only days that aren't weekends or exception days. This means a 10-workday task starting on a Friday will end more than two calendar weeks later if there are holidays in between.

The module also exports `countBusinessDays` (how many workdays between two dates) and `addBusinessDays` (move a date forward or backward by N business days). All three functions respect the project's workday exception calendar.


dependency validation
---

`src/lib/schedule/dependency-validation.ts` prevents circular dependencies using DFS. When a user tries to add a new dependency, `wouldCreateCycle` builds the adjacency graph from existing dependencies, adds the proposed edge, and checks if the successor can reach the predecessor through the graph:

```typescript
export function wouldCreateCycle(
  existingDeps: TaskDependencyData[],
  newPredecessorId: string,
  newSuccessorId: string
): boolean
```

Self-references are caught immediately (`predecessorId === successorId`). For everything else, it runs a DFS traversal from the successor node. If the traversal reaches the predecessor, the dependency would create a cycle and is rejected.


date propagation
---

`src/lib/schedule/propagate-dates.ts` handles cascading date changes through the dependency graph. When a task's dates change, all downstream successors need their dates recalculated.

The algorithm uses BFS from the changed task through finish-to-start (FS) dependencies. Only FS dependencies propagate dates -- other dependency types (SS, FF, SF) are tracked but don't currently trigger automatic date shifts. This is a deliberate simplification; full multi-type propagation introduces significant complexity for a feature that construction schedulers rarely use.

```typescript
// successor starts after predecessor ends + lag
const newStart = addBusinessDays(
  current.endDateCalculated,
  1 + dep.lagDays,
  exceptions
)
const newEnd = calculateEndDate(newStart, successor.workdays, exceptions)
```

The propagation respects workday exceptions, so if pushing a successor forward lands it on a holiday week, the dates adjust accordingly.


critical path analysis
---

`src/lib/schedule/critical-path.ts` implements the Critical Path Method (CPM), the standard algorithm for identifying which tasks directly affect the project completion date.

The implementation:

1. Topological sort of all tasks (returns `null` if there's a cycle)
2. Forward pass: compute earliest start and finish for each task
3. Backward pass: compute latest start and finish from the project end date
4. Total float = late start - early start
5. Tasks with zero float (within floating-point tolerance of 0.001) are on the critical path

```typescript
const critical = new Set<string>()
for (const [id, node] of nodes) {
  if (Math.abs(node.totalFloat) < 0.001) {
    critical.add(id)
  }
}
```

Only FS dependencies are used for CPM calculation. The critical path is recalculated automatically after any task creation, update, deletion, or dependency change.


server actions
---

`src/app/actions/schedule.ts` provides:

- `getSchedule(projectId)` -- returns all tasks, dependencies, and exceptions for a project
- `createTask(projectId, data)` -- creates a task with calculated end date, recalculates critical path
- `updateTask(taskId, data)` -- updates a task, propagates dates to downstream successors, recalculates critical path
- `deleteTask(taskId)` -- deletes a task, recalculates critical path
- `reorderTasks(projectId, items)` -- reorder tasks (drag-and-drop in the UI)
- `createDependency(data)` -- creates a dependency with cycle validation, propagates dates
- `deleteDependency(depId, projectId)` -- deletes a dependency, recalculates critical path
- `updateTaskStatus(taskId, status)` -- change task status (PENDING, IN_PROGRESS, COMPLETE, BLOCKED)

`src/app/actions/baselines.ts` provides:

- `getBaselines(projectId)` -- list all baselines for a project
- `createBaseline(projectId, name)` -- snapshot current tasks and dependencies as JSON
- `deleteBaseline(baselineId)` -- delete a baseline

`src/app/actions/workday-exceptions.ts` provides:

- `getWorkdayExceptions(projectId)` -- list exceptions for a project
- `createWorkdayException(projectId, data)` -- create an exception
- `updateWorkdayException(exceptionId, data)` -- update an exception
- `deleteWorkdayException(exceptionId)` -- delete an exception


UI components
---

`src/components/schedule/` contains 13 components:

- `schedule-view.tsx` -- main container that manages which sub-view is active
- `schedule-gantt-view.tsx` -- Gantt chart view with the frappe-gantt integration
- `gantt-chart.tsx` -- wrapper component for the Gantt rendering
- `gantt.css` -- custom styles for the Gantt chart
- `schedule-list-view.tsx` -- table/list view of all tasks
- `schedule-calendar-view.tsx` -- calendar visualization of task dates
- `schedule-baseline-view.tsx` -- baseline comparison view
- `schedule-mobile-view.tsx` -- simplified view for mobile devices
- `schedule-toolbar.tsx` -- view switcher, filters, add task button
- `task-form-dialog.tsx` -- create/edit task form with phase selection, date picker, dependency config
- `dependency-dialog.tsx` -- add/remove dependency dialog
- `workday-exceptions-view.tsx` -- exception calendar management
- `workday-exception-form-dialog.tsx` -- create/edit exception form


known issues
---

**Gantt chart vertical panning.** Horizontal zoom and pan work correctly. Vertical panning (scrolling through tasks) conflicts with frappe-gantt's container sizing model. The chart renders at a fixed height based on task count, and the container handles overflow. A proper fix would require a transform-based rendering approach with a fixed header, which is a non-trivial change to the third-party library integration.
