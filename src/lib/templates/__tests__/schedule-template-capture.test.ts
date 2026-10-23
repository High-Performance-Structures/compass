import { describe, expect, it } from "vitest"

import { buildScheduleTemplateApplication } from "@/lib/templates/schedule-template-application"
import {
  captureScheduleTemplate,
  workdayOffset,
  type CapturableScheduleTask,
} from "@/lib/templates/schedule-template-capture"

function task(
  id: string,
  startDate: string,
  workdays: number,
  sortOrder: number
): CapturableScheduleTask {
  return {
    id,
    title: `Item ${id}`,
    notes: null,
    startDate,
    workdays,
    phase: "Foundation",
    displayColor: "blue",
    isMilestone: false,
    assignedTo: "Concrete crew",
    ownerVisible: true,
    subVendorVisible: false,
    sortOrder,
  }
}

function ids(): () => string {
  let next = 0
  return () => `id-${++next}`
}

describe("workdayOffset", () => {
  it("counts workdays after the first item, skipping weekends", () => {
    // Friday 2026-10-23 → Monday 2026-10-26 is one workday later.
    expect(workdayOffset("2026-10-23", "2026-10-26", [])).toBe(1)
    expect(workdayOffset("2026-10-23", "2026-10-23", [])).toBe(0)
    expect(workdayOffset("2026-10-19", "2026-10-30", [])).toBe(9)
  })
})

describe("captureScheduleTemplate", () => {
  it("keeps spacing, placeholders and predecessors", () => {
    const result = captureScheduleTemplate({
      tasks: [
        task("b", "2026-10-26", 3, 1),
        task("a", "2026-10-23", 1, 0),
        task("c", "2026-10-29", 2, 2),
      ],
      dependencies: [
        { predecessorId: "a", successorId: "b", type: "FS", lagDays: 0 },
        { predecessorId: "b", successorId: "c", type: "SS", lagDays: 2 },
        { predecessorId: "b", successorId: "c", type: "SS", lagDays: 2 },
        { predecessorId: "other-project", successorId: "c", type: "FS", lagDays: 0 },
      ],
      exceptions: [],
      nextId: ids(),
    })

    expect(result.success).toBe(true)
    if (!result.success) return
    expect(
      result.data.items.map((item) => [item.title, item.startOffsetWorkdays, item.workdays])
    ).toEqual([
      ["Item a", 0, 1],
      ["Item b", 1, 3],
      ["Item c", 4, 2],
    ])
    expect(result.data.items[0].assigneePlaceholder).toBe("Concrete crew")
    expect(result.data.dependencies).toHaveLength(2)
    expect(result.data.dependencies[1]).toEqual(
      expect.objectContaining({ type: "SS", lagDays: 2 })
    )
  })

  it("rebuilds the same dates when applied at the original start", () => {
    const tasks = [task("a", "2026-10-23", 1, 0), task("b", "2026-10-26", 3, 1)]
    const capture = captureScheduleTemplate({
      tasks,
      dependencies: [{ predecessorId: "a", successorId: "b", type: "FS", lagDays: 0 }],
      exceptions: [],
      nextId: ids(),
    })
    if (!capture.success) throw new Error(capture.error)

    const applied = buildScheduleTemplateApplication({
      anchorDate: "2026-10-23",
      items: capture.data.items,
      dependencies: capture.data.dependencies,
      exceptions: [],
      nextId: ids(),
      firstSortOrder: 0,
    })
    expect(applied.success).toBe(true)
    if (!applied.success) return
    expect(applied.data.tasks.map((item) => item.startDate)).toEqual([
      "2026-10-23",
      "2026-10-26",
    ])
    expect(applied.data.dependencies).toHaveLength(1)
  })

  it("refuses an empty schedule", () => {
    expect(
      captureScheduleTemplate({ tasks: [], dependencies: [], exceptions: [], nextId: ids() })
    ).toEqual({ success: false, error: "This schedule has no items to save." })
  })
})
