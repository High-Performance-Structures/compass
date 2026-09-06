import { afterEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  getCloudflareContext: vi.fn(), getDb: vi.fn(), requireAuth: vi.fn(),
  requirePermission: vi.fn(), assertProjectAccess: vi.fn(),
  recordActivityEvent: vi.fn(), createNotificationEvent: vi.fn(),
  revalidatePath: vi.fn(), isInternalStaffRole: vi.fn(), updateSet: vi.fn(),
}))
vi.mock("@/lib/auth", () => ({ requireAuth: mocks.requireAuth }))
vi.mock("@/lib/db", () => ({ getCloudflareContext: mocks.getCloudflareContext }))
vi.mock("@/db", () => ({ getDb: mocks.getDb }))
vi.mock("@/lib/permissions", () => ({ requirePermission: mocks.requirePermission }))
vi.mock("@/lib/project-access", () => ({ assertProjectAccess: mocks.assertProjectAccess }))
vi.mock("@/lib/activity-log", () => ({ recordActivityEvent: mocks.recordActivityEvent }))
vi.mock("@/lib/notifications/events", () => ({ createNotificationEvent: mocks.createNotificationEvent }))
vi.mock("@/lib/user-roles", () => ({ isInternalStaffRole: mocks.isInternalStaffRole }))
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }))

import { respondToScheduleTaskAssignee } from "@/app/actions/schedule-confirmations"

type Value = unknown
function query(value: Value): Record<string, unknown> {
  const builder: Record<string, unknown> = {
    from: () => builder, innerJoin: () => builder, where: () => builder,
    orderBy: () => builder, limit: () => builder,
    get: async () => value,
    then: (resolve: (result: Value) => unknown, reject?: (error: unknown) => unknown) =>
      Promise.resolve(value).then(resolve, reject),
  }
  return builder
}

function setupDb(capabilitiesJson: string, role = "staff", ownerVisible = true): void {
  const values: readonly Value[] = [
    {
      id: "assignment-1", taskId: "task-1", projectId: "project-1", title: "Concrete",
      startDate: "2026-09-14", workdays: 3, confirmationRequired: true,
      participantId: "participant-1", assignedUserId: "user-1", projectContactId: null,
      assignedAt: "2026-09-01T00:00:00.000Z",
    },
    [{
      snapshotData: JSON.stringify({
        version: 1,
        tasks: [{
          id: "task-1", projectId: "project-1", title: "Concrete", startDate: "2026-09-14",
          workdays: 3, endDateCalculated: "2026-09-16", phase: "Build", displayColor: "blue",
          status: "PENDING", isCriticalPath: false, isMilestone: false, percentComplete: 0,
          assignedTo: null, assignedUserId: "user-1", assigneeParticipantIds: ["participant-1"],
          ownerVisible, subVendorVisible: true,
          confirmationRequired: true, confirmationStatus: "pending", confirmationRequestedAt: null,
          confirmationRespondedAt: null, reminderSentAt: null, proposedStartDate: null,
          proposedWorkdays: null, proposalNote: null, proposalSubmittedAt: null, sortOrder: 0,
          createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z",
        }], dependencies: [], exceptions: [],
      }), publishedAt: "2026-09-02T00:00:00.000Z",
    }],
    [{ participantId: "participant-1" }],
    {
      id: "participant-1", projectId: "project-1", organizationId: "org-1", userId: "user-1",
      projectContactId: null, reviewStatus: "reviewed", identityStatus: "matched",
      membershipStatus: "active", active: true, capabilitiesJson,
    },
    { id: "user-1", role },
    [],
  ]
  let index = 0
  mocks.getDb.mockReturnValue({
    select: () => query(values[index++] ?? null),
    update: () => ({ set: (value: unknown) => { mocks.updateSet(value); return { where: async () => undefined } } }),
  })
  mocks.getCloudflareContext.mockResolvedValue({ env: { DB: {} } })
  mocks.assertProjectAccess.mockResolvedValue({ id: "project-1", organizationId: "org-1", projectNumber: null })
  mocks.isInternalStaffRole.mockReturnValue(true)
}

afterEach(() => vi.clearAllMocks())

describe("multi-assignee schedule action gates", () => {
  it("rejects participants without schedule.respond", async () => {
    setupDb(JSON.stringify([]))
    mocks.requireAuth.mockResolvedValue({ id: "user-1", role: "field_crew" })
    await expect(respondToScheduleTaskAssignee("assignment-1", "confirmed"))
      .resolves.toEqual({ success: false, error: "This participant is no longer eligible." })
  })

  it("rejects a different user even for a valid publication", async () => {
    setupDb(JSON.stringify(["schedule.respond"]))
    mocks.requireAuth.mockResolvedValue({ id: "attacker", role: "field_crew" })
    await expect(respondToScheduleTaskAssignee("assignment-1", "confirmed"))
      .resolves.toEqual({ success: false, error: "This confirmation is not assigned to you." })
  })
})


describe("owner individual commitments", () => {
  it.each(["confirmed", "declined", "proposed"] as const)("records the owner’s %s response without editing published dates", async (response) => {
    setupDb(JSON.stringify(["schedule.respond"]), "owner")
    mocks.requireAuth.mockResolvedValue({ id: "user-1", role: "guest" })
    await expect(respondToScheduleTaskAssignee("assignment-1", {
      response, message: "Owner-supplied windows need coordination.",
      ...(response === "proposed" ? { proposedStartDate: "2026-09-21", proposedWorkdays: 5 } : {}),
    })).resolves.toEqual({ success: true })
    expect(mocks.updateSet).toHaveBeenCalledWith(expect.objectContaining({ responseStatus: response, responseMessage: "Owner-supplied windows need coordination." }))
    expect(mocks.updateSet.mock.calls[0][0]).not.toHaveProperty("startDate")
  })
  it("rejects a published task hidden from owners", async () => {
    setupDb(JSON.stringify(["schedule.respond"]), "owner", false)
    mocks.requireAuth.mockResolvedValue({ id: "user-1", role: "guest" })
    expect((await respondToScheduleTaskAssignee("assignment-1", "confirmed")).success).toBe(false)
    expect(mocks.updateSet).not.toHaveBeenCalled()
  })
})
