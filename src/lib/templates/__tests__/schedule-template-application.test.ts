import { describe, expect, it } from "vitest"

import { buildScheduleTemplateApplication } from "../schedule-template-application"
import type { WorkdayExceptionData } from "@/lib/schedule/types"

const noExceptions: readonly WorkdayExceptionData[] = []

describe("buildScheduleTemplateApplication", () => {
  it("anchors items by relative workday offsets and preserves dependencies", () => {
    let next = 0
    const result = buildScheduleTemplateApplication({
      anchorDate: "2026-08-03",
      items: [
        {
          id: "form",
          title: "Form footings",
          startOffsetWorkdays: 0,
          workdays: 2,
          phase: "Foundation",
          displayColor: "blue",
          isMilestone: false,
          assigneePlaceholder: "Concrete trade",
          ownerVisible: true,
          subVendorVisible: true,
          sortOrder: 0,
        },
        {
          id: "pour",
          title: "Pour footings",
          startOffsetWorkdays: 2,
          workdays: 1,
          phase: "Foundation",
          displayColor: "green",
          isMilestone: true,
          assigneePlaceholder: null,
          ownerVisible: true,
          subVendorVisible: false,
          sortOrder: 1,
        },
      ],
      dependencies: [
        {
          id: "dep-1",
          predecessorItemId: "form",
          successorItemId: "pour",
          type: "FS",
          lagDays: 0,
        },
      ],
      exceptions: noExceptions,
      nextId: () => `generated-${++next}`,
      firstSortOrder: 10,
    })

    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.tasks).toMatchObject([
      {
        id: "generated-1",
        startDate: "2026-08-03",
        endDateCalculated: "2026-08-04",
        assignedTo: "Concrete trade",
        sortOrder: 10,
      },
      {
        id: "generated-2",
        startDate: "2026-08-05",
        endDateCalculated: "2026-08-05",
        sortOrder: 11,
      },
    ])
    expect(result.data.dependencies).toEqual([
      {
        id: "generated-3",
        predecessorId: "generated-1",
        successorId: "generated-2",
        type: "FS",
        lagDays: 0,
      },
    ])
  })

  it("rejects dependency cycles", () => {
    const item = (id: string) => ({
      id,
      title: id,
      startOffsetWorkdays: 0,
      workdays: 1,
      phase: "General",
      displayColor: "blue",
      isMilestone: false,
      assigneePlaceholder: null,
      ownerVisible: true,
      subVendorVisible: false,
      sortOrder: 0,
    })
    const result = buildScheduleTemplateApplication({
      anchorDate: "2026-08-03",
      items: [item("a"), item("b")],
      dependencies: [
        {
          id: "one",
          predecessorItemId: "a",
          successorItemId: "b",
          type: "FS",
          lagDays: 0,
        },
        {
          id: "two",
          predecessorItemId: "b",
          successorItemId: "a",
          type: "FS",
          lagDays: 0,
        },
      ],
      exceptions: noExceptions,
      nextId: crypto.randomUUID,
      firstSortOrder: 0,
    })

    expect(result).toEqual({
      success: false,
      error: "The template contains a dependency cycle.",
    })
  })
})
