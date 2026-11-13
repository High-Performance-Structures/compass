vi.mock("next/headers", () => ({ headers: async () => new Headers() }))
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  scheduleWriteContext: vi.fn(), readWorkingSchedule: vi.fn(), findTask: vi.fn(),
  isOrganizationProject: vi.fn(), recalcCriticalPath: vi.fn(),
  persistScheduleDateUpdates: vi.fn(), taskUpdateQuery: vi.fn(),
  resetTaskAssigneesQuery: vi.fn(), acceptConfirmationProposal: vi.fn(),
  recordActivityEvent: vi.fn(), revalidatePath: vi.fn(), batch: vi.fn(),
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
  acceptConfirmationProposal: mocks.acceptConfirmationProposal,
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
const SUB_ANSWERED = { success: false, error: "The sub just answered. Review their answer and try again." }

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
})
afterEach(() => vi.clearAllMocks())

describe("updateTask accepting a date proposal", () => {
  it("accepts the proposal staff reviewed, then saves the new dates", async () => {
    await expect(updateTask("task-1", accept)).resolves.toEqual({ success: true })
    expect(mocks.acceptConfirmationProposal).toHaveBeenCalledWith(
      expect.anything(), "task-1", "2026-11-12T18:00:00.000Z", "accept_proposal", expect.any(String),
    )
    expect(mocks.acceptConfirmationProposal.mock.invocationCallOrder[0]).toBeLessThan(mocks.batch.mock.invocationCallOrder[0] ?? 0)
    expect(mocks.persistScheduleDateUpdates).toHaveBeenCalledWith(
      {}, "project-1", new Map([["task-1", { startDate: "2026-09-21", endDateCalculated: expect.any(String), workdays: 4 }]]), expect.any(String),
      { reaskOnDateMove: true },
    )
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
    expect(mocks.persistScheduleDateUpdates).toHaveBeenCalledTimes(1)
  })
})
