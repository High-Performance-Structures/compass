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

import { proposeScheduleTaskChange, respondToScheduleTaskConfirmation } from "@/app/actions/schedule-confirmations"

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

function publishedSnapshot(ownerVisible = false, subVendorVisible = true): string {
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
        ownerVisible,
        subVendorVisible,
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


function setupLegacyResponse(input: {
  readonly role: string
  readonly action: "response" | "proposal"
  readonly ownerVisible?: boolean
  readonly subVendorVisible?: boolean
  readonly assignedUserId?: string
  readonly startDate?: string
}): void {
  const snapshot = [{ snapshotData: publishedSnapshot(input.ownerVisible ?? true, input.subVendorVisible ?? false) }]
  const membership = { role: input.role }
  const values: readonly QueryValue[] = [
    { id: "task-1", projectId: "project-1", title: "Owner windows", startDate: input.startDate ?? "2026-09-14", workdays: 3, assignedUserId: input.assignedUserId ?? "user-1", confirmationRequired: true },
    [],
    ...(input.action === "response" ? [snapshot, membership] : [membership, snapshot]),
    [{ id: "staff-1", email: "staff@example.test", googleEmail: null, role: "project_manager" }],
  ]
  let index = 0
  mocks.getDb.mockReturnValue({
    select: () => query(values[index++] ?? null),
    update: () => ({ set: (value: unknown) => {
      mocks.updateSet(value)
      return { where: async () => undefined }
    } }),
  })
  mocks.getCloudflareContext.mockResolvedValue({ env: { DB: {} } })
  mocks.requireAuth.mockResolvedValue({ id: "user-1", displayName: "Owner", email: "owner@example.test", role: "guest" })
  mocks.assertProjectAccess.mockResolvedValue({ id: "project-1", organizationId: "org-1" })
}

describe("owner and vendor commitment responses", () => {
  it.each(["owner", "client"])("allows an assigned %s to report a conflict without vendor visibility", async (role) => {
    setupLegacyResponse({ role, action: "response" })
    await expect(respondToScheduleTaskConfirmation("task-1", "declined", "Windows arrive a week late."))
      .resolves.toEqual({ success: true })
    expect(mocks.updateSet).toHaveBeenCalledWith(expect.objectContaining({
      confirmationStatus: "declined", proposalNote: "Windows arrive a week late.", proposedStartDate: null,
    }))
    expect(mocks.updateSet.mock.calls[0][0]).not.toHaveProperty("startDate")
    expect(mocks.recordActivityEvent).toHaveBeenCalledWith(expect.objectContaining({ metadata: { note: "Windows arrive a week late." } }))
    expect(mocks.createNotificationEvent).toHaveBeenCalledWith(expect.objectContaining({
      body: "Owner declined the scheduled date. Windows arrive a week late.",
      href: "/dashboard/projects/project-1/schedule?view=list&item=task-1",
      audience: "internal",
    }))
  })
  it.each(["owner", "client"])("allows an assigned %s to propose dates and duration", async (role) => {
    setupLegacyResponse({ role, action: "proposal" })
    await expect(proposeScheduleTaskChange("task-1", { startDate: "2026-09-21", workdays: 5, note: "Delivery delay" }))
      .resolves.toEqual({ success: true })
    expect(mocks.updateSet).toHaveBeenCalledWith(expect.objectContaining({ confirmationStatus: "proposed", proposedWorkdays: 5 }))
    expect(mocks.updateSet.mock.calls[0][0]).not.toHaveProperty("startDate")
  })
  it.each(["response", "proposal"] as const)("rejects owner-hidden items for %s", async (action) => {
    setupLegacyResponse({ role: "owner", action, ownerVisible: false, subVendorVisible: true })
    const result = action === "response"
      ? await respondToScheduleTaskConfirmation("task-1", "confirmed")
      : await proposeScheduleTaskChange("task-1", { startDate: "2026-09-21", workdays: 3, note: "" })
    expect(result.success).toBe(false)
    expect(mocks.updateSet).not.toHaveBeenCalled()
  })
  it.each([
    { role: "owner", assignedUserId: "someone-else" },
    { role: "owner", startDate: "2026-09-28" },
    { role: "supplier", subVendorVisible: false },
    { role: "viewer" },
  ])("rejects an unauthorized or unpublished commitment: %o", async (input) => {
    setupLegacyResponse({ ...input, action: "response" })
    expect((await respondToScheduleTaskConfirmation("task-1", "confirmed")).success).toBe(false)
    expect(mocks.updateSet).not.toHaveBeenCalled()
  })
  it("rejects oversized notes before writing", async () => {
    await expect(respondToScheduleTaskConfirmation("task-1", "declined", "x".repeat(1001)))
      .resolves.toEqual({ success: false, error: "Notes must be 1,000 characters or fewer." })
    expect(mocks.updateSet).not.toHaveBeenCalled()
  })
})
