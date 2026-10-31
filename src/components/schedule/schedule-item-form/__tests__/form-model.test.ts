import { describe, expect, it } from "vitest"
import type { ScheduleTaskData, TaskDependencyData } from "@/lib/schedule/types"
import type { ProjectTaskAssigneeOption } from "@/lib/domain/contacts/types"
import {
  CUSTOM_PHASE_VALUE,
  confirmationStatusLabel,
  editingTaskValues,
  matchingAssigneeOptionId,
  percentForStatusChange,
  predecessorEditChanged,
  predecessorEditsFor,
  predecessorPickerOptions,
  scheduleShiftRequested,
  schedulePhasePickerOptions,
  statusForPercentChange,
  toggleSelectedId,
  withSavedPhaseOption,
} from "../form-model"
import { withAssignee } from "../assignees-field"

function task(overrides: Partial<ScheduleTaskData> = {}): ScheduleTaskData {
  return {
    id: "task-1",
    projectId: "project-1",
    title: "Framing",
    startDate: "2026-11-02",
    workdays: 5,
    endDateCalculated: "2026-11-06",
    phase: "framing",
    displayColor: null,
    status: "PENDING",
    isCriticalPath: false,
    isMilestone: false,
    percentComplete: 0,
    assignedTo: null,
    sortOrder: 0,
    createdAt: "2026-10-01",
    updatedAt: "2026-10-01",
    ...overrides,
  }
}

function dependency(overrides: Partial<TaskDependencyData> = {}): TaskDependencyData {
  return {
    id: "dep-1",
    predecessorId: "task-0",
    successorId: "task-1",
    type: "FS",
    lagDays: 0,
    ...overrides,
  }
}

describe("schedule item form model", () => {
  it("labels predecessor options with start date and phase", () => {
    expect(predecessorPickerOptions([task()])).toEqual([
      { value: "task-1", label: "Framing", description: "2026-11-02 · framing" },
    ])
  })

  it("dedupes phases, keeps the current phase and ends with the custom entry", () => {
    const options = schedulePhasePickerOptions(
      [
        { id: null, value: "framing", label: "Framing", source: "default" },
        { id: "a", value: "framing", label: "Framing again", source: "saved" },
      ],
      "legacy"
    )
    expect(options.map((option) => option.value)).toEqual(["framing", "legacy", CUSTOM_PHASE_VALUE])
    expect(options[1]).toMatchObject({ description: "Current phase" })
    expect(schedulePhasePickerOptions([], "").map((option) => option.value)).toEqual([CUSTOM_PHASE_VALUE])
  })

  it("replaces a saved phase with the same name ignoring case and spaces", () => {
    const saved = { id: "b", value: "Punch", label: "Punch", source: "saved" as const }
    const next = withSavedPhaseOption(
      [{ id: "a", value: " punch ", label: "punch", source: "saved" }],
      saved
    )
    expect(next).toEqual([saved])
  })

  it("fills edit values with defaults for missing optional fields", () => {
    const values = editingTaskValues(task({ startTime: "08:00", notes: null }))
    expect(values).toMatchObject({
      startTime: "08:00",
      endTime: "",
      ownerVisible: true,
      subVendorVisible: false,
      confirmationRequired: false,
      notes: "",
      shiftReason: "",
    })
  })

  it("matches the assignee option by trimmed, case-insensitive name", () => {
    const options: readonly ProjectTaskAssigneeOption[] = [
      ["c1", "Jane Doe"],
      ["c2", "Bob"],
    ].map(([id, name]) => ({
      id,
      name,
      label: name,
      companyName: null,
      email: null,
      phone: null,
      contactType: "owner",
      source: "project",
      projectContactId: id,
      directoryContactId: null,
      projectAccess: true,
    }))
    expect(matchingAssigneeOptionId(options, "  jane doe ")).toBe("c1")
    expect(matchingAssigneeOptionId(options, null)).toBeNull()
  })

  it("detects changed saved predecessors and new chosen ones", () => {
    const saved = dependency()
    const edits = predecessorEditsFor([saved, dependency({ id: "other", successorId: "x" })], "task-1")
    expect(edits).toEqual({ "dep-1": { taskId: "task-0", type: "FS", lagDays: 0 } })
    expect(predecessorEditChanged(saved, edits["dep-1"])).toBe(false)
    expect(predecessorEditChanged(saved, undefined)).toBe(false)
    expect(predecessorEditChanged(saved, { taskId: "task-0", type: "FS", lagDays: 2 })).toBe(true)

    const base = {
      editingTask: task(),
      values: { startDate: "2026-11-02", workdays: 5 },
      existingPredecessors: [saved],
      existingPredecessorEdits: edits,
      pendingPredecessors: [{ taskId: "", type: "FS" as const, lagDays: 0 }],
    }
    expect(scheduleShiftRequested(base)).toBe(false)
    expect(scheduleShiftRequested({ ...base, values: { startDate: "2026-11-03", workdays: 5 } })).toBe(true)
    expect(scheduleShiftRequested({ ...base, editingTask: null, values: { startDate: "2026-11-03", workdays: 9 } })).toBe(false)
    expect(
      scheduleShiftRequested({ ...base, pendingPredecessors: [{ taskId: "t", type: "SS", lagDays: 0 }] })
    ).toBe(true)
  })

  it("keeps status and progress in step", () => {
    expect(percentForStatusChange("COMPLETE", 20)).toBe(100)
    expect(percentForStatusChange("IN_PROGRESS", 100)).toBe(50)
    expect(percentForStatusChange("PENDING", 100)).toBe(0)
    expect(percentForStatusChange("BLOCKED", 40)).toBeNull()
    expect(statusForPercentChange(100, "IN_PROGRESS")).toBe("COMPLETE")
    expect(statusForPercentChange(100, "COMPLETE")).toBeNull()
    expect(statusForPercentChange(40, "COMPLETE")).toBe("IN_PROGRESS")
    expect(statusForPercentChange(0, "COMPLETE")).toBe("PENDING")
    expect(statusForPercentChange(40, "PENDING")).toBeNull()
  })

  it("formats confirmation status and toggles ids", () => {
    expect(confirmationStatusLabel(undefined)).toBe("Not requested")
    expect(confirmationStatusLabel("change_proposed")).toBe("Change proposed")
    const ids = ["a"]
    expect(toggleSelectedId(ids, "a", true)).toBe(ids)
    expect(toggleSelectedId(ids, "b", true)).toEqual(["a", "b"])
    expect(toggleSelectedId(ids, "a", false)).toEqual([])
  })
})

describe("schedule item assignees in the form", () => {
  const options: readonly ProjectTaskAssigneeOption[] = [
    {
      id: "team:u-ann",
      name: "Ann Lee",
      label: "Ann Lee",
      companyName: null,
      email: null,
      phone: null,
      contactType: "internal",
      source: "project",
      projectContactId: null,
      directoryContactId: null,
      projectAccess: true,
    },
  ]

  it("loads every saved person and matches each to its picker option", () => {
    const values = editingTaskValues(
      task({
        assignedTo: "Ann Lee, Framing Crew",
        people: [
          { name: "Ann Lee", assignedUserId: "u-ann", projectContactId: null },
          { name: "Framing Crew", assignedUserId: null, projectContactId: null },
        ],
      }),
      options
    )
    expect(values.assignees).toEqual([
      { name: "Ann Lee", optionId: "team:u-ann" },
      { name: "Framing Crew", optionId: null },
    ])
  })

  it("loads an item that only has the single stored name", () => {
    expect(editingTaskValues(task({ assignedTo: "Ann Lee" }), options).assignees).toEqual([
      { name: "Ann Lee", optionId: "team:u-ann" },
    ])
    expect(editingTaskValues(task()).assignees).toEqual([])
  })

  it("adds a person once and ignores blanks", () => {
    const one = withAssignee([], " Ann Lee ", "team:u-ann")
    expect(one).toEqual([{ name: "Ann Lee", optionId: "team:u-ann" }])
    expect(withAssignee(one, "ann lee", null)).toEqual(one)
    expect(withAssignee(one, "  ", null)).toEqual(one)
    expect(withAssignee(one, "Bo Diaz", null)).toEqual([...one, { name: "Bo Diaz", optionId: null }])
  })
})
