import { describe, expect, it } from "vitest"

import {
  canonicalProjectTodoRecordType,
  isArchivedProjectTodoStatus,
  isCompletedProjectTodoStatus,
  isProjectTodoRecordType,
  isProjectTodoStatus,
  normalizeProjectTodoStatus,
  projectTodoStatusLabel,
  projectTodoTypeLabel,
} from "@/lib/project-todos"

describe("project to-do normalization", () => {
  it("includes canonical and legacy to-do record types", () => {
    expect(isProjectTodoRecordType("staff_task")).toBe(true)
    expect(isProjectTodoRecordType("schedule_task")).toBe(true)
    expect(isProjectTodoRecordType("todo")).toBe(true)
    expect(isProjectTodoRecordType("purchase_order")).toBe(false)
  })

  it("maps legacy types to an editable Compass type", () => {
    expect(canonicalProjectTodoRecordType("todo")).toBe("staff_task")
    expect(canonicalProjectTodoRecordType("supplier_task")).toBe(
      "supplier_task"
    )
  })

  it("normalizes imported statuses without losing archive semantics", () => {
    expect(normalizeProjectTodoStatus("In Progress")).toBe("in_progress")
    expect(normalizeProjectTodoStatus("closed")).toBe("complete")
    expect(isCompletedProjectTodoStatus("done")).toBe(true)
    expect(isArchivedProjectTodoStatus("archived")).toBe(true)
    expect(projectTodoStatusLabel("on-hold")).toBe("Blocked")
    expect(isProjectTodoStatus("in_progress")).toBe(true)
    expect(isProjectTodoStatus("archived")).toBe(false)
  })

  it("uses concise staff-facing type labels", () => {
    expect(projectTodoTypeLabel("schedule_task")).toBe("Schedule follow-up")
    expect(projectTodoTypeLabel("todo")).toBe("Staff")
  })
})
