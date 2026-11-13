vi.mock("next/headers", () => ({ headers: async () => new Headers() }))
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  scheduleWriteContext: vi.fn(), readWorkingSchedule: vi.fn(), findTask: vi.fn(),
  isOrganizationProject: vi.fn(), recalcCriticalPath: vi.fn(),
  persistScheduleDateUpdates: vi.fn(), taskUpdateQuery: vi.fn(),
  resetTaskAssigneesQuery: vi.fn(), recordActivityEvent: vi.fn(),
  revalidatePath: vi.fn(), batch: vi.fn(),
}))
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock("@/lib/activity-log", () => ({ recordActivityEvent: mocks.recordActivityEvent }))
vi.mock("@/lib/schedule/publication-history", () => ({ isScheduleShiftReasonRequired: async () => false }))
vi.mock("@/lib/schedule/record-shift", () => ({ recordScheduleShift: vi.fn() }))
vi.mock("@/lib/domain/schedule/date-move-rules", () => ({ scheduleDateMoveRules: async () => ({ reaskOnDateMove: true }) }))
vi.mock("@/lib/domain/schedule/access", () => ({
  canViewWorkingSchedule: vi.fn(), readProjectSchedule: vi.fn(), readWorkingSchedule: mocks.readWorkingSchedule,
  scheduleReadContext: vi.fn(), scheduleSwitcherProjects: vi.fn(),
  scheduleWriteContext: mocks.scheduleWriteContext, viewerProjects: vi.fn(),
}))
vi.mock("@/lib/domain/schedule/queries", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  findTask: mocks.findTask, isOrganizationProject: mocks.isOrganizationProject,
  resolveScheduleTaskPeople: async () => [], loadTaskPeople: async () => new Map(),
}))
vi.mock("@/lib/domain/schedule/store", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  recalcCriticalPath: mocks.recalcCriticalPath,
  persistScheduleDateUpdates: mocks.persistScheduleDateUpdates,
  taskUpdateQuery: mocks.taskUpdateQuery,
  resetTaskAssigneesQuery: mocks.resetTaskAssigneesQuery,
  clearTaskAssigneesQuery: vi.fn(), replaceTaskPeopleQueries: () => [],
}))

import { updateTask } from "@/app/actions/schedule"

const task = {
  id: "task-1", projectId: "project-1", title: "Framing", startDate: "2026-09-14",
  workdays: 3, endDateCalculated: "2026-09-16", status: "PENDING", percentComplete: 0,
  assignedTo: null, assignedUserId: null, confirmationRequired: false,
  startTime: null, endTime: null, proposedStartDate: null, proposedWorkdays: null,
}

beforeEach(() => {
  mocks.scheduleWriteContext.mockResolvedValue({
    success: true,
    data: { db: { batch: mocks.batch }, organizationId: "org-1", user: { id: "user-1" }, env: { DB: {} } },
  })
  mocks.findTask.mockResolvedValue(task)
  mocks.isOrganizationProject.mockResolvedValue(true)
  mocks.readWorkingSchedule.mockResolvedValue({ tasks: [task], dependencies: [], exceptions: [] })
})
afterEach(() => vi.clearAllMocks())

describe("updateTask critical path recalculation", () => {
  it.each([
    ["an assignee-only", { assignedTo: "Crew A" }],
    ["a notes-only", { notes: "Bring ladders" }],
  ])("does not recalculate the critical path for %s save", async (_label, data) => {
    await expect(updateTask("task-1", data)).resolves.toEqual({ success: true })
    expect(mocks.recalcCriticalPath).not.toHaveBeenCalled()
  })

  it.each([
    ["startDate", { startDate: "2026-09-21" }],
    ["workdays", { workdays: 5 }],
  ])("recalculates the critical path when %s changes", async (_label, data) => {
    await expect(updateTask("task-1", data)).resolves.toEqual({ success: true })
    expect(mocks.recalcCriticalPath).toHaveBeenCalledTimes(1)
    expect(mocks.recalcCriticalPath).toHaveBeenCalledWith(expect.anything(), "project-1")
  })
})
