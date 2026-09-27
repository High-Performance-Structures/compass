import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  assertOwnerUpdateRouteAccess: vi.fn(),
  assertProjectAccess: vi.fn(),
  requireFeaturePermission: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({ requireAuth: mocks.requireAuth }))
vi.mock("@/lib/owner-updates/access", () => ({
  assertOwnerUpdateRouteAccess: mocks.assertOwnerUpdateRouteAccess,
}))
vi.mock("@/lib/project-access", () => ({
  assertProjectAccess: mocks.assertProjectAccess,
}))
vi.mock("@/lib/permission-enforcement", () => ({
  requireFeaturePermission: mocks.requireFeaturePermission,
}))
vi.mock("@/lib/demo", () => ({
  isDemoUser: () => false,
}))
vi.mock("@/lib/db", () => ({
  getCloudflareContext: vi.fn(),
}))
vi.mock("@/db", () => ({
  getDb: vi.fn(),
}))
vi.mock("@/lib/jarvis/agent-relay", () => ({
  isJarvisAgentBridgeEnabled: () => false,
  relayAgentRequest: vi.fn(),
}))
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}))

const { getProjectDailyLogWorkspace, getProjectFieldSummary, getProjectWeatherSnapshot } =
  await import("@/app/actions/project-field")

type QueryResult = readonly Record<string, unknown>[]

type Query = {
  readonly from: () => Query
  readonly leftJoin: () => Query
  readonly innerJoin: () => Query
  readonly where: () => Query
  readonly orderBy: () => Query
  readonly limit: () => Query
  readonly then: <TResult1 = QueryResult, TResult2 = never>(
    onfulfilled?:
      | ((value: QueryResult) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ) => Promise<TResult1 | TResult2>
}

type QueryDatabase = {
  readonly select: ReturnType<typeof vi.fn>
}

const internalUser = {
  id: "staff-1",
  isActive: true,
  role: "office",
  organizationId: "org-1",
  organizationType: "internal",
}

function createQueryDatabase(): QueryDatabase {
  let selectCount = 0
  const database: QueryDatabase = {
    select: vi.fn((): Query => {
      selectCount += 1
      const result: QueryResult =
        selectCount === 1
          ? [
              {
                id: "project-1",
                name: "Project One",
                projectNumber: "P-001",
                clientName: "Client One",
              },
            ]
          : selectCount === 4
            ? [{ phase: "Foundation" }]
            : []
      const query: Query = {
        from: () => query,
        leftJoin: () => query,
        innerJoin: () => query,
        where: () => query,
        orderBy: () => query,
        limit: () => query,
        then: (onfulfilled, onrejected) =>
          Promise.resolve(result).then(onfulfilled, onrejected),
      }
      return query
    }),
  }
  return database
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.assertOwnerUpdateRouteAccess.mockResolvedValue({})
  mocks.assertProjectAccess.mockResolvedValue({
    id: "project-1",
    organizationId: "org-1",
    projectNumber: "P-001",
  })
  mocks.requireFeaturePermission.mockResolvedValue(undefined)
  mocks.requireAuth.mockResolvedValue(internalUser)
})

describe("project field read authorization", () => {
  it("denies daily-log readers before project, log, or weather work", async () => {
    const database = { select: vi.fn() }
    const denial = new Error("daily-log read permission denied")
    mocks.assertOwnerUpdateRouteAccess.mockResolvedValue(database)
    mocks.requireFeaturePermission.mockImplementation(
      async (_viewer: unknown, featureId: string, action: string) => {
        if (featureId === "daily-logs" && action === "read") throw denial
      }
    )

    await expect(getProjectFieldSummary("project-1")).rejects.toThrow(denial)
    await expect(getProjectDailyLogWorkspace("project-1")).rejects.toThrow(denial)
    await expect(getProjectWeatherSnapshot("project-1")).resolves.toEqual({
      success: false,
      error: denial.message,
    })

    expect(mocks.requireFeaturePermission).toHaveBeenCalledTimes(3)
    expect(mocks.requireFeaturePermission).toHaveBeenNthCalledWith(
      1,
      internalUser,
      "daily-logs",
      "read"
    )
    expect(mocks.requireFeaturePermission).toHaveBeenNthCalledWith(
      2,
      internalUser,
      "daily-logs",
      "read"
    )
    expect(mocks.requireFeaturePermission).toHaveBeenNthCalledWith(
      3,
      internalUser,
      "daily-logs",
      "read"
    )
    expect(mocks.assertProjectAccess).not.toHaveBeenCalled()
    expect(database.select).not.toHaveBeenCalled()
  })

  it.each(["office", "developer"] as const)(
    "preserves the %s workspace schedule path after authorization",
    async (role) => {
      const database = createQueryDatabase()
      mocks.requireAuth.mockResolvedValue({ ...internalUser, role })
      mocks.assertOwnerUpdateRouteAccess.mockResolvedValue(database)

      const workspace = await getProjectDailyLogWorkspace("project-1")

      expect(workspace.project).toEqual({
        id: "project-1",
        name: "Project One",
        projectNumber: "P-001",
        clientName: "Client One",
      })
      expect(workspace.schedulePhases).toEqual(["Foundation"])
      expect(mocks.requireFeaturePermission).toHaveBeenCalledWith(
        { ...internalUser, role },
        "daily-logs",
        "read"
      )
      expect(mocks.assertProjectAccess).toHaveBeenCalledWith(
        database,
        { ...internalUser, role },
        "project-1"
      )
    }
  )
})
