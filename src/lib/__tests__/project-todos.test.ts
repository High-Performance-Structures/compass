import { describe, expect, it } from "vitest"

import {
  defaultRecordStatusList,
  isSelectableRecordStatus,
  recordStatusFilterOptions,
  recordStatusKey,
  recordStatusLabel,
  recordStatusSortValue,
  resolveRecordStatuses,
  selectableRecordStatuses,
} from "@/lib/domain/record-statuses/rules"
import { isArchivedTodoStatus, isCompletedTodoStatus } from "@/lib/project-todo-statuses"
import {
  canonicalProjectTodoRecordType,
  isProjectTodoRecordType,
  projectTodoTypeLabel,
} from "@/lib/project-todos"

const TODO = defaultRecordStatusList("todo")
// A company that added "Waiting on owner" (Open), "Done by sub" (Closed) and "Cancelled by owner" (Void), and hid Blocked.
const COMPANY = resolveRecordStatuses("todo", [
  { statusKey: "open", label: "To do", color: "blue", statusGroup: "open", sortOrder: 0, showAsButton: true, hidden: false, builtIn: true },
  { statusKey: "waiting_on_owner", label: "Waiting on owner", color: "orange", statusGroup: "open", sortOrder: 1, showAsButton: true, hidden: false, builtIn: false },
  { statusKey: "in_progress", label: "In progress", color: "green", statusGroup: "open", sortOrder: 2, showAsButton: true, hidden: false, builtIn: true },
  { statusKey: "blocked", label: "Blocked", color: "orange", statusGroup: "open", sortOrder: 3, showAsButton: true, hidden: true, builtIn: true },
  { statusKey: "complete", label: "Complete", color: "gray", statusGroup: "closed", sortOrder: 4, showAsButton: true, hidden: false, builtIn: true },
  { statusKey: "done_by_sub", label: "Done by sub", color: "gray", statusGroup: "closed", sortOrder: 5, showAsButton: true, hidden: false, builtIn: false },
  { statusKey: "archived", label: "Archived", color: "gray", statusGroup: "void", sortOrder: 6, showAsButton: true, hidden: false, builtIn: true },
  { statusKey: "cancelled_by_owner", label: "Cancelled by owner", color: "red", statusGroup: "void", sortOrder: 7, showAsButton: false, hidden: false, builtIn: false },
])

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

  it("reads imported statuses through the default to-do statuses without losing archive semantics", () => {
    expect(recordStatusKey(TODO, "In Progress")).toBe("in_progress")
    expect(recordStatusKey(TODO, "closed")).toBe("complete")
    expect(isCompletedTodoStatus(TODO, "done")).toBe(true)
    expect(isArchivedTodoStatus(TODO, "archived")).toBe(true)
    expect(isArchivedTodoStatus(TODO, "cancelled")).toBe(true)
    expect(recordStatusLabel(TODO, "on-hold")).toBe("Blocked")
    expect(recordStatusKey(TODO, "something new")).toBe("open")
    expect(selectableRecordStatuses(TODO).map((option) => option.value)).toEqual([
      "open",
      "in_progress",
      "blocked",
      "complete",
      "archived",
    ])
  })

  it("follows the company's to-do statuses: groups, choices, buttons and sort", () => {
    expect(isCompletedTodoStatus(COMPANY, "done_by_sub")).toBe(true)
    expect(isArchivedTodoStatus(COMPANY, "cancelled_by_owner")).toBe(true)
    expect(isArchivedTodoStatus(COMPANY, "waiting_on_owner")).toBe(false)
    expect(recordStatusLabel(COMPANY, "open")).toBe("To do")
    // Hidden Blocked is not offered, except on a to-do that is already blocked.
    expect(isSelectableRecordStatus(COMPANY, "blocked")).toBe(false)
    expect(isSelectableRecordStatus(COMPANY, "blocked", "blocked")).toBe(true)
    expect(isSelectableRecordStatus(COMPANY, "waiting_on_owner")).toBe(true)
    const buttons = recordStatusFilterOptions(COMPANY, [{ status: "waiting_on_owner", count: 2 }, { status: "done_by_sub", count: 1 }])
    expect(buttons.map((option) => option.value)).toEqual([
      "open", "open_status", "waiting_on_owner", "in_progress", "complete", "done_by_sub", "archived", "all",
    ])
    expect(buttons[0]?.count).toBe(2)
    expect(recordStatusSortValue(COMPANY, "waiting_on_owner")).toBeLessThan(recordStatusSortValue(COMPANY, "in_progress"))
  })

  it("uses concise staff-facing type labels", () => {
    expect(projectTodoTypeLabel("schedule_task")).toBe("Schedule follow-up")
    expect(projectTodoTypeLabel("todo")).toBe("Staff")
  })
})
