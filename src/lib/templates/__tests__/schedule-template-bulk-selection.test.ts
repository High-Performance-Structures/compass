import { describe, expect, it } from "vitest"

import {
  normalizeBulkScheduleTemplateOffsets,
  validateBulkScheduleTemplateSelection
} from "../schedule-template-bulk-selection"

const availableItemIds = new Set(["schedule-a", "schedule-b"])
const availableTodoIds = new Set(["todo-a", "todo-b"])

describe("validateBulkScheduleTemplateSelection", () => {
  it("keeps each selected to-do attached to one selected schedule item", () => {
    const result = validateBulkScheduleTemplateSelection({
      selections: [
        { templateItemId: "schedule-a", templateTodoIds: ["todo-a"] },
        { templateItemId: "schedule-b", templateTodoIds: ["todo-b"] }
      ],
      availableItemIds,
      availableTodoIds
    })

    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.itemIds).toEqual(["schedule-a", "schedule-b"])
    expect(result.data.todoIdsByItem.get("schedule-a")).toEqual(["todo-a"])
    expect(result.data.todoIdsByItem.get("schedule-b")).toEqual(["todo-b"])
  })

  it("rejects assigning the same to-do to more than one schedule item", () => {
    const result = validateBulkScheduleTemplateSelection({
      selections: [
        { templateItemId: "schedule-a", templateTodoIds: ["todo-a"] },
        { templateItemId: "schedule-b", templateTodoIds: ["todo-a"] }
      ],
      availableItemIds,
      availableTodoIds
    })

    expect(result).toEqual({
      success: false,
      error: "Each template to-do may only be assigned to one schedule item."
    })
  })

  it("rejects schedule items that are no longer published", () => {
    const result = validateBulkScheduleTemplateSelection({
      selections: [
        { templateItemId: "missing", templateTodoIds: [] }
      ],
      availableItemIds,
      availableTodoIds
    })

    expect(result).toEqual({
      success: false,
      error: "One or more selected schedule items are no longer available."
    })
  })
})

describe("normalizeBulkScheduleTemplateOffsets", () => {
  it("anchors the earliest selected item while preserving spacing", () => {
    const normalized = normalizeBulkScheduleTemplateOffsets([
      {
        id: "schedule-b",
        title: "Second selected item",
        startOffsetWorkdays: 12,
        workdays: 2,
        phase: "Build",
        displayColor: "blue",
        isMilestone: false,
        assigneePlaceholder: null,
        ownerVisible: true,
        subVendorVisible: true,
        sortOrder: 2
      },
      {
        id: "schedule-a",
        title: "First selected item",
        startOffsetWorkdays: 10,
        workdays: 1,
        phase: "Build",
        displayColor: "blue",
        isMilestone: false,
        assigneePlaceholder: null,
        ownerVisible: true,
        subVendorVisible: true,
        sortOrder: 1
      }
    ])

    expect(normalized.map((item) => item.startOffsetWorkdays)).toEqual([2, 0])
  })
})
