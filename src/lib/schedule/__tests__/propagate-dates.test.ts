import { describe, expect, it } from "vitest"
import {
  propagateDates,
  recalculateScheduleDates,
} from "../propagate-dates"
import type {
  DependencyType,
  ScheduleTaskData,
  TaskDependencyData,
} from "../types"

function task(
  id: string,
  startDate: string,
  workdays: number,
  endDateCalculated: string
): ScheduleTaskData {
  return {
    id,
    projectId: "project-1",
    title: id,
    startDate,
    workdays,
    endDateCalculated,
    phase: "framing",
    displayColor: "blue",
    status: "PENDING",
    isCriticalPath: false,
    isMilestone: false,
    percentComplete: 0,
    assignedTo: null,
    sortOrder: 0,
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
  }
}

function dependency(
  type: DependencyType,
  lagDays = 0,
  predecessorId = "a",
  successorId = "b"
): TaskDependencyData {
  return {
    id: `${predecessorId}-${successorId}-${type}`,
    predecessorId,
    successorId,
    type,
    lagDays,
  }
}

describe("schedule dependency propagation", () => {
  it("propagates finish-to-start relationships through a chain", () => {
    const tasks = [
      task("a", "2026-07-20", 5, "2026-07-24"),
      task("b", "2026-07-20", 2, "2026-07-21"),
      task("c", "2026-07-20", 1, "2026-07-20"),
    ]
    const dependencies = [
      dependency("FS"),
      dependency("FS", 0, "b", "c"),
    ]

    expect(
      Object.fromEntries(
        propagateDates("a", tasks, dependencies).updatedTasks
      )
    ).toEqual({
      b: {
        startDate: "2026-07-27",
        endDateCalculated: "2026-07-28",
      },
      c: {
        startDate: "2026-07-29",
        endDateCalculated: "2026-07-29",
      },
    })
  })

  it("supports start-to-start lags and negative leads", () => {
    const tasks = [
      task("a", "2026-07-27", 5, "2026-07-31"),
      task("b", "2026-07-20", 1, "2026-07-20"),
    ]

    expect(
      propagateDates("a", tasks, [dependency("SS", -1)]).updatedTasks.get("b")
    ).toEqual({
      startDate: "2026-07-24",
      endDateCalculated: "2026-07-24",
    })
  })

  it("supports finish-to-finish and start-to-finish relationships", () => {
    const tasks = [
      task("a", "2026-07-20", 5, "2026-07-24"),
      task("b", "2026-07-20", 2, "2026-07-21"),
    ]

    expect(
      propagateDates("a", tasks, [dependency("FF")]).updatedTasks.get("b")
    ).toEqual({
      startDate: "2026-07-23",
      endDateCalculated: "2026-07-24",
    })
    expect(
      propagateDates("a", tasks, [dependency("SF")]).updatedTasks.get("b")
    ).toEqual({
      startDate: "2026-07-17",
      endDateCalculated: "2026-07-20",
    })
  })

  it("uses the latest constraint when a task has multiple predecessors", () => {
    const tasks = [
      task("a", "2026-07-20", 2, "2026-07-21"),
      task("x", "2026-07-20", 5, "2026-07-24"),
      task("b", "2026-07-20", 1, "2026-07-20"),
    ]
    const dependencies = [
      dependency("FS"),
      dependency("FS", 0, "x", "b"),
    ]

    expect(
      propagateDates("a", tasks, dependencies).updatedTasks.get("b")
    ).toEqual({
      startDate: "2026-07-27",
      endDateCalculated: "2026-07-27",
    })
  })

  it("does not pull a successor backward when the work calendar opens a day", () => {
    const tasks = [
      task("a", "2026-07-24", 2, "2026-07-27"),
      task("b", "2026-07-28", 1, "2026-07-28"),
    ]
    const workingSaturday = {
      id: "weekend",
      projectId: "project-1",
      title: "Weekend workday",
      startDate: "2026-07-25",
      endDate: "2026-07-25",
      type: "working" as const,
      category: "company_holiday" as const,
      recurrence: "one_time" as const,
      notes: null,
      createdAt: "2026-07-01T00:00:00.000Z",
      updatedAt: "2026-07-01T00:00:00.000Z",
    }

    expect(
      Object.fromEntries(
        recalculateScheduleDates(
          tasks,
          [dependency("FS")],
          [workingSaturday]
        ).updatedTasks
      )
    ).toEqual({
      a: {
        startDate: "2026-07-24",
        endDateCalculated: "2026-07-25",
      },
    })
  })

  it("preserves intentional schedule gaps when a holiday is added", () => {
    const tasks = [
      task("countertops", "2026-09-01", 5, "2026-09-07"),
      task("plumbing", "2026-09-21", 2, "2026-09-22"),
    ]
    const laborDay = {
      id: "labor-day",
      projectId: "project-1",
      title: "Labor Day",
      startDate: "2026-09-07",
      endDate: "2026-09-07",
      type: "non_working" as const,
      category: "national_holiday" as const,
      recurrence: "yearly" as const,
      notes: null,
      createdAt: "2026-07-01T00:00:00.000Z",
      updatedAt: "2026-07-01T00:00:00.000Z",
    }

    expect(
      Object.fromEntries(
        recalculateScheduleDates(
          tasks,
          [dependency("FS", 0, "countertops", "plumbing")],
          [laborDay]
        ).updatedTasks
      )
    ).toEqual({
      countertops: {
        startDate: "2026-09-01",
        endDateCalculated: "2026-09-08",
      },
    })
  })

  it("moves a successor forward when a holiday tightens its dependency", () => {
    const tasks = [
      task("a", "2026-09-01", 5, "2026-09-07"),
      task("b", "2026-09-08", 2, "2026-09-09"),
    ]
    const laborDay = {
      id: "labor-day",
      projectId: "project-1",
      title: "Labor Day",
      startDate: "2026-09-07",
      endDate: "2026-09-07",
      type: "non_working" as const,
      category: "national_holiday" as const,
      recurrence: "one_time" as const,
      notes: null,
      createdAt: "2026-07-01T00:00:00.000Z",
      updatedAt: "2026-07-01T00:00:00.000Z",
    }

    expect(
      Object.fromEntries(
        recalculateScheduleDates(
          tasks,
          [dependency("FS")],
          [laborDay]
        ).updatedTasks
      )
    ).toEqual({
      a: {
        startDate: "2026-09-01",
        endDateCalculated: "2026-09-08",
      },
      b: {
        startDate: "2026-09-09",
        endDateCalculated: "2026-09-10",
      },
    })
  })
})
