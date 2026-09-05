import { afterEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  assertProjectAccess: vi.fn(),
  createNotificationEvent: vi.fn(),
  getCloudflareContext: vi.fn(),
  getDb: vi.fn(),
  recordActivityEvent: vi.fn(),
  requireAuth: vi.fn(),
  requirePermission: vi.fn(),
  revalidatePath: vi.fn(),
  updateSet: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({ requireAuth: mocks.requireAuth }))
vi.mock("@/lib/db", () => ({ getCloudflareContext: mocks.getCloudflareContext }))
vi.mock("@/db", () => ({ getDb: mocks.getDb }))
vi.mock("@/lib/permissions", () => ({ requirePermission: mocks.requirePermission }))
vi.mock("@/lib/project-access", () => ({ assertProjectAccess: mocks.assertProjectAccess }))
vi.mock("@/lib/activity-log", () => ({ recordActivityEvent: mocks.recordActivityEvent }))
vi.mock("@/lib/notifications/events", () => ({ createNotificationEvent: mocks.createNotificationEvent }))
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }))

import { proposeScheduleTaskChange } from "@/app/actions/schedule-confirmations"

type QueryValue = unknown

function query(value: QueryValue): Record<string, unknown> {
  const builder: Record<string, unknown> = {
    from: () => builder,
    innerJoin: () => builder,
    where: () => builder,
    orderBy: () => builder,
    limit: () => builder,
    get: async () => value,
    then: (
      resolve: (result: QueryValue) => unknown,
      reject?: (error: unknown) => unknown,
    ) => Promise.resolve(value).then(resolve, reject),
  }
  return builder
}

function publishedSnapshot(): string {
  return JSON.stringify({
    version: 1,
    tasks: [
      {
        id: "task-1",
        projectId: "project-1",
        title: "Concrete",
        startDate: "2026-09-14",
        workdays: 3,
        endDateCalculated: "2026-09-16",
        phase: "Build",
        displayColor: "blue",
        status: "PENDING",
        isCriticalPath: false,
        isMilestone: false,
        percentComplete: 0,
        assignedTo: "Test Subcontractor",
        assignedUserId: "user-1",
        assigneeParticipantIds: [],
        ownerVisible: false,
        subVendorVisible: true,
        confirmationRequired: true,
        confirmationStatus: "pending",
        confirmationRequestedAt: null,
        confirmationRespondedAt: null,
        reminderSentAt: null,
        proposedStartDate: null,
        proposedWorkdays: null,
        proposalNote: null,
        proposalSubmittedAt: null,
        sortOrder: 0,
        createdAt: "2026-09-01T00:00:00.000Z",
        updatedAt: "2026-09-01T00:00:00.000Z",
      },
    ],
    dependencies: [],
    exceptions: [],
  })
}

afterEach(() => vi.clearAllMocks())

describe("legacy subcontractor schedule proposals", () => {
  it("records a changed date and duration for a published assignment", async () => {
    const values: readonly QueryValue[] = [
      {
        id: "task-1",
        projectId: "project-1",
        title: "Concrete",
        startDate: "2026-09-14",
        workdays: 3,
        assignedUserId: "user-1",
        confirmationRequired: true,
      },
      [],
      { role: "subcontractor" },
      [{ snapshotData: publishedSnapshot() }],
      [],
    ]
    let queryIndex = 0
    mocks.getDb.mockReturnValue({
      select: () => query(values[queryIndex++] ?? null),
      update: () => ({
        set: (value: unknown) => {
          mocks.updateSet(value)
          return { where: async () => undefined }
        },
      }),
    })
    mocks.getCloudflareContext.mockResolvedValue({ env: { DB: {} } })
    mocks.requireAuth.mockResolvedValue({
      id: "user-1",
      displayName: "Test Subcontractor",
      email: "test@example.com",
      role: "guest",
    })
    mocks.assertProjectAccess.mockResolvedValue({
      id: "project-1",
      organizationId: "org-1",
    })

    await expect(
      proposeScheduleTaskChange("task-1", {
        startDate: "2026-09-21",
        workdays: 5,
        note: "Crew is available the following week.",
      }),
    ).resolves.toEqual({ success: true })
    expect(mocks.updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        confirmationStatus: "proposed",
        proposedStartDate: "2026-09-21",
        proposedWorkdays: 5,
        proposalNote: "Crew is available the following week.",
      }),
    )
    expect(mocks.recordActivityEvent).toHaveBeenCalledOnce()
  })
})
