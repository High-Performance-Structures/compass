import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  getCloudflareContext: vi.fn(),
  getDb: vi.fn(),
  requirePermission: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({ requireAuth: mocks.requireAuth }))
vi.mock("@/lib/db", () => ({ getCloudflareContext: mocks.getCloudflareContext }))
vi.mock("@/db", () => ({ getDb: mocks.getDb }))
vi.mock("@/lib/permissions", () => ({ requirePermission: mocks.requirePermission }))

type QueryResult = readonly unknown[]

function query(result: QueryResult): Record<string, (...args: never[]) => unknown> {
  const chain: Record<string, (...args: never[]) => unknown> = {
    from: () => chain,
    where: () => chain,
    limit: () => chain,
    orderBy: () => chain,
    then: (resolve: (value: QueryResult) => unknown) =>
      Promise.resolve(result).then(resolve),
  }
  return chain
}

import { getProjectAudienceOptions } from "@/app/actions/project-audience-preview"

describe("project audience options authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireAuth.mockResolvedValue({
      id: "external-1",
      email: "external@example.com",
      firstName: null,
      lastName: null,
      displayName: null,
      avatarUrl: null,
      dashboardDeskPhotoUrl: null,
      sidebarDeskPhotoUrl: null,
      role: "client",
      googleEmail: null,
      isActive: true,
      lastLoginAt: null,
      organizationId: "org-a",
      organizationName: "Org A",
      organizationType: "client",
      createdAt: "2026-09-01",
      updatedAt: "2026-09-01",
    })
    mocks.getCloudflareContext.mockResolvedValue({ env: { DB: "db" } })
    mocks.getDb.mockReturnValue({
      select: () => query([{ id: "org-a", type: "internal" }]),
    })
  })

  it("denies an external audience from an authoritative internal organization before permission or project queries", async () => {
    await expect(getProjectAudienceOptions("owner")).resolves.toEqual([])

    expect(mocks.getCloudflareContext).toHaveBeenCalledTimes(1)
    expect(mocks.getDb).toHaveBeenCalledWith("db")
    expect(mocks.requirePermission).not.toHaveBeenCalled()
  })
})
