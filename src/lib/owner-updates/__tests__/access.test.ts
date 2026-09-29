import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  getCloudflareContext: vi.fn(),
  getDb: vi.fn(),
}))

vi.mock("@/lib/db", () => ({
  getCloudflareContext: mocks.getCloudflareContext,
}))
vi.mock("@/db", () => ({
  getDb: mocks.getDb,
}))

type OrganizationRow = {
  readonly id: string
}

type Query = {
  readonly from: () => Query
  readonly where: () => Query
  readonly limit: () => Query
  readonly then: <TResult1 = readonly OrganizationRow[], TResult2 = never>(
    onfulfilled?:
      | ((value: readonly OrganizationRow[]) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ) => Promise<TResult1 | TResult2>
}

type Database = {
  readonly select: ReturnType<typeof vi.fn>
}

const { assertOwnerUpdateRouteAccess } = await import("@/lib/owner-updates/access")

const developerUser = {
  id: "developer-1",
  email: "developer@example.test",
  firstName: "Developer",
  lastName: "User",
  displayName: "Developer User",
  avatarUrl: null,
  role: "developer",
  googleEmail: null,
  isActive: true,
  lastLoginAt: null,
  organizationId: "org-1",
  organizationName: "HPS",
  organizationType: "internal",
  createdAt: "2026-09-28T00:00:00.000Z",
  updatedAt: "2026-09-28T00:00:00.000Z",
}

function createDatabase(): Database {
  const query: Query = {
    from: () => query,
    where: () => query,
    limit: () => query,
    then: (onfulfilled, onrejected) =>
      Promise.resolve([{ id: "org-1" }]).then(onfulfilled, onrejected),
  }
  return { select: vi.fn(() => query) }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getCloudflareContext.mockResolvedValue({ env: { DB: "test-db" } })
})

describe("owner update route access", () => {
  it("allows a developer only for the explicit daily-log read contract", async () => {
    const database = createDatabase()
    mocks.getDb.mockReturnValue(database)

    await expect(
      assertOwnerUpdateRouteAccess(developerUser, { allowDeveloperRead: true })
    ).resolves.toBe(database)
    expect(mocks.getCloudflareContext).toHaveBeenCalledTimes(1)
    expect(database.select).toHaveBeenCalledTimes(1)
  })

  it("keeps the developer role out of default owner-update access", async () => {
    await expect(assertOwnerUpdateRouteAccess(developerUser)).rejects.toThrow(
      "Permission denied: internal staff access is required"
    )
    expect(mocks.getCloudflareContext).not.toHaveBeenCalled()
    expect(mocks.getDb).not.toHaveBeenCalled()
  })

  it.each([
    ["external role", { ...developerUser, role: "client" }],
    ["inactive developer", { ...developerUser, isActive: false }],
  ] as const)(
    "keeps %s out of the explicit developer read contract",
    async (_label, user) => {
      await expect(
        assertOwnerUpdateRouteAccess(user, { allowDeveloperRead: true })
      ).rejects.toThrow("Permission denied: internal staff access is required")
      expect(mocks.getCloudflareContext).not.toHaveBeenCalled()
      expect(mocks.getDb).not.toHaveBeenCalled()
    }
  )
})
