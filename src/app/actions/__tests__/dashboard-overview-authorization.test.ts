import { describe, expect, it, vi } from "vitest"

const requireAuth = vi.fn()
const requireOrg = vi.fn()
const getCloudflareContext = vi.fn()

vi.mock("@/lib/auth", () => ({ requireAuth }))
vi.mock("@/lib/org-scope", () => ({ requireOrg }))
vi.mock("@/lib/db", () => ({ getCloudflareContext }))

const { getDashboardOverview } = await import("@/app/actions/dashboard-overview")

describe("dashboard overview authorization", () => {
  it("does not initialize the workspace aggregator for external users", async () => {
    requireAuth.mockResolvedValue({
      id: "external-user",
      role: "client",
      isActive: true,
      organizationId: "external-org",
      organizationType: "client",
      email: "owner@example.com",
      name: "Owner",
    })
    requireOrg.mockReturnValue("external-org")
    getCloudflareContext.mockImplementation(() => {
      throw new Error("external dashboard reached database access")
    })

    const result = await getDashboardOverview()

    expect(result.projects).toEqual([])
    expect(requireOrg).not.toHaveBeenCalled()
    expect(getCloudflareContext).not.toHaveBeenCalled()
  })
})
