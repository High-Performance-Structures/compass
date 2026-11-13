vi.mock("next/headers", () => ({ headers: async () => new Headers() }))
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  scheduleWriteContext: vi.fn(), readWorkingSchedule: vi.fn(), findTask: vi.fn(),
  isOrganizationProject: vi.fn(), recalcCriticalPath: vi.fn(),
  persistScheduleDateUpdates: vi.fn(), taskUpdateQuery: vi.fn(),
  resetTaskAssigneesQuery: vi.fn(), acceptConfirmationProposal: vi.fn(), restoreConfirmationProposal: vi.fn(),
  scheduleDateMoveRules: vi.fn(), propagateFrom: vi.fn(),
  recordActivityEvent: vi.fn(), revalidatePath: vi.fn(), batch: vi.fn(),
}))
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock("@/lib/activity-log", () => ({ recordActivityEvent: mocks.recordActivityEvent }))
vi.mock("@/lib/schedule/publication-history", () => ({ isScheduleShiftReasonRequired: async () => false }))
vi.mock("@/lib/schedule/record-shift", () => ({ recordScheduleShift: vi.fn() }))
vi.mock("@/lib/domain/schedule/date-move-rules", () => ({ scheduleDateMoveRules: mocks.scheduleDateMoveRules }))
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
  acceptConfirmationProposal: mocks.acceptConfirmationProposal,
  restoreConfirmationProposal: mocks.restoreConfirmationProposal,
  clearTaskAssigneesQuery: vi.fn(), replaceTaskPeopleQueries: () => [],
}))

import { updateTask } from "@/app/actions/schedule"

const task = {
  id: "task-1", projectId: "project-1", title: "Framing", startDate: "2026-09-14",
  workdays: 3, endDateCalculated: "2026-09-16", status: "PENDING", percentComplete: 0,
  assignedTo: "Sub", assignedUserId: "sub-1", confirmationRequired: true,
  confirmationStatus: "proposed", proposalSubmittedAt: "2026-11-12T18:00:00.000Z",
  startTime: null, endTime: null, proposedStartDate: "2026-09-21", proposedWorkdays: 4,
}
const accept = {
  startDate: "2026-09-21", workdays: 4, acceptChangeProposal: true,
  expectedProposalSubmittedAt: "2026-11-12T18:00:00.000Z",
}
const SUB_ANSWERED = { success: false, error: "The sub just answered. Review their answer and try again.", subAnswered: true }

function expectNothingSaved(): void {
  expect(mocks.batch).not.toHaveBeenCalled()
  expect(mocks.persistScheduleDateUpdates).not.toHaveBeenCalled()
  expect(mocks.recordActivityEvent).not.toHaveBeenCalled()
}

beforeEach(() => {
  mocks.scheduleWriteContext.mockResolvedValue({
    success: true,
    data: { db: { batch: mocks.batch }, organizationId: "org-1", user: { id: "user-1" }, env: { DB: {} } },
  })
  mocks.findTask.mockResolvedValue(task)
  mocks.isOrganizationProject.mockResolvedValue(true)
  mocks.readWorkingSchedule.mockResolvedValue({ tasks: [task], dependencies: [], exceptions: [] })
  mocks.acceptConfirmationProposal.mockResolvedValue(true)
  mocks.scheduleDateMoveRules.mockResolvedValue({ reaskOnDateMove: true })
})
afterEach(() => vi.clearAllMocks())

describe("updateTask accepting a date proposal", () => {
  it("accepts the proposal staff reviewed, then saves the new dates", async () => {
    await expect(updateTask("task-1", accept)).resolves.toEqual({ success: true })
    expect(mocks.acceptConfirmationProposal).toHaveBeenCalledWith(
      expect.anything(), "task-1", "2026-11-12T18:00:00.000Z", "accept_proposal", expect.any(String),
    )
    expect(mocks.acceptConfirmationProposal.mock.invocationCallOrder[0]).toBeLessThan(mocks.batch.mock.invocationCallOrder[0] ?? 0)
    // The edited item's own move first, then the items after it.
    expect(mocks.persistScheduleDateUpdates.mock.calls.map((call) => call[2])).toEqual([
      new Map([["task-1", { startDate: "2026-09-21", endDateCalculated: expect.any(String), workdays: 4 }]]),
      new Map(),
    ])
    expect(mocks.persistScheduleDateUpdates).toHaveBeenCalledWith({}, "project-1", expect.any(Map), expect.any(String), { reaskOnDateMove: true })
  })

  it("stops when the sub answered between the read and the write, saving nothing", async () => {
    mocks.acceptConfirmationProposal.mockResolvedValue(false)
    await expect(updateTask("task-1", accept)).resolves.toEqual(SUB_ANSWERED)
    expectNothingSaved()
  })

  it.each([
    ["answered before the save read it", { ...task, confirmationStatus: "confirmed", proposalSubmittedAt: null, proposedStartDate: null, proposedWorkdays: null }, accept],
    ["proposed again", { ...task, proposalSubmittedAt: "2026-11-12T19:00:00.000Z" }, accept],
    ["(no reviewed proposal sent)", task, { ...accept, expectedProposalSubmittedAt: undefined }],
  ])("stops when the sub %s", async (_label, stored, data) => {
    mocks.findTask.mockResolvedValue(stored)
    await expect(updateTask("task-1", data)).resolves.toEqual(SUB_ANSWERED)
    expect(mocks.acceptConfirmationProposal).not.toHaveBeenCalled()
    expectNothingSaved()
  })

  it("an ordinary date move doesn't take the accept path", async () => {
    await expect(updateTask("task-1", { startDate: "2026-09-28" })).resolves.toEqual({ success: true })
    expect(mocks.acceptConfirmationProposal).not.toHaveBeenCalled()
    expect(mocks.persistScheduleDateUpdates).toHaveBeenCalledTimes(2)
  })

  it("puts the proposal back when the item edit fails after the accept landed", async () => {
    mocks.batch.mockRejectedValueOnce(new Error("D1 down"))
    await expect(updateTask("task-1", accept)).resolves.toEqual({ success: false, error: "Failed to update schedule item" })
    expect(mocks.restoreConfirmationProposal).toHaveBeenCalledWith(expect.anything(), task, expect.any(String))
  })

  it("keeps the original error when the restore itself fails", async () => {
    mocks.batch.mockRejectedValueOnce(new Error("D1 down"))
    mocks.restoreConfirmationProposal.mockRejectedValueOnce(new Error("still down"))
    await expect(updateTask("task-1", accept)).resolves.toEqual({ success: false, error: "Failed to update schedule item" })
  })

  it("doesn't restore once the item edit landed", async () => {
    mocks.persistScheduleDateUpdates.mockRejectedValueOnce(new Error("D1 down"))
    await expect(updateTask("task-1", accept)).resolves.toMatchObject({ success: false })
    expect(mocks.restoreConfirmationProposal).not.toHaveBeenCalled()
  })
})

describe("updateTask date moves", () => {
  const plain = { ...task, confirmationStatus: "confirmed", proposalSubmittedAt: null, proposedStartDate: null, proposedWorkdays: null }
  beforeEach(() => {
    mocks.findTask.mockResolvedValue(plain)
    mocks.readWorkingSchedule.mockResolvedValue({ tasks: [plain], dependencies: [], exceptions: [] })
  })

  it("resets the item's multi-assignee answers on a date move only when the company asks again", async () => {
    await updateTask("task-1", { startDate: "2026-09-28" })
    expect(mocks.resetTaskAssigneesQuery).toHaveBeenCalledTimes(1)
    mocks.resetTaskAssigneesQuery.mockClear()
    mocks.scheduleDateMoveRules.mockResolvedValue({ reaskOnDateMove: false })
    await updateTask("task-1", { startDate: "2026-10-05" })
    expect(mocks.resetTaskAssigneesQuery).not.toHaveBeenCalled()
    expect(mocks.persistScheduleDateUpdates).toHaveBeenCalledWith({}, "project-1", expect.any(Map), expect.any(String), { reaskOnDateMove: false })
    // A changed confirmation rule still re-asks.
    await updateTask("task-1", { confirmationRequired: false })
    expect(mocks.resetTaskAssigneesQuery).toHaveBeenCalledTimes(1)
  })

  it("records the shift and Activity when a later group fails, noting the partial move", async () => {
    const successor = { ...plain, id: "s1", startDate: "2026-09-17" }
    mocks.readWorkingSchedule.mockResolvedValue({
      tasks: [plain, successor],
      dependencies: [{ id: "d1", predecessorId: "task-1", successorId: "s1", type: "FS", lagDays: 0 }],
      exceptions: [],
    })
    mocks.persistScheduleDateUpdates.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("D1 down"))
    const result = await updateTask("task-1", { startDate: "2026-09-28" })
    expect(result).toEqual({ success: false, error: "Saved “Framing”, but some items after it could not be moved. Make the change again to move them." })
    expect(mocks.recordActivityEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: "schedule.item_updated",
      summary: "Updated schedule item “Framing”. Some items after it could not be moved.",
      metadata: { partialMove: true },
    }))
    expect(mocks.recalcCriticalPath).toHaveBeenCalled()
  })

  it("accepts a cascade the size of the largest jobs (418 items)", async () => {
    const many = Array.from({ length: 418 }, (_, index) => ({ ...plain, id: `s${index}`, startDate: "2026-09-17" }))
    mocks.readWorkingSchedule.mockResolvedValue({
      tasks: [plain, ...many],
      dependencies: many.map((successor) => ({ id: `d-${successor.id}`, predecessorId: "task-1", successorId: successor.id, type: "FS", lagDays: 0 })),
      exceptions: [],
    })
    await expect(updateTask("task-1", { startDate: "2026-09-28" })).resolves.toEqual({ success: true })
    expect(mocks.persistScheduleDateUpdates.mock.calls.map((call) => call[2].size)).toEqual([1, 418])
  })
})
