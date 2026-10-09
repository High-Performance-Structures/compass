import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  resolveAgentUser: vi.fn(),
  getCurrentUser: vi.fn(),
  setThemePreferenceForUser: vi.fn(),
  listCustomThemesForUser: vi.fn(),
  listCustomDashboardsForUser: vi.fn(),
  createIssue: vi.fn(),
}))

vi.mock("server-only", () => ({}))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("@/lib/db", () => ({ getCloudflareContext: async () => ({ env: { DB: {} } }) }))
vi.mock("@/db", () => ({ getDb: () => ({}) }))
vi.mock("@/lib/auth", () => ({ getCurrentUser: mocks.getCurrentUser }))
vi.mock("@/lib/agent/api-auth", () => ({
  validateAgentAuth: async () => ({
    valid: true,
    userId: "user-1",
    orgId: "org-1",
    role: "office",
    isDemoUser: false,
  }),
}))
vi.mock("@/lib/agent/agent-user", () => ({ resolveAgentUser: mocks.resolveAgentUser }))
vi.mock("@/lib/theme/user-themes", () => ({
  setThemePreferenceForUser: mocks.setThemePreferenceForUser,
  listCustomThemesForUser: mocks.listCustomThemesForUser,
  getCustomThemeForUser: vi.fn(),
  saveCustomThemeForUser: vi.fn(),
}))
vi.mock("@/lib/dashboards/user-dashboards", () => ({
  listCustomDashboardsForUser: mocks.listCustomDashboardsForUser,
  getCustomDashboardForUser: vi.fn(),
  deleteCustomDashboardForUser: vi.fn(),
}))
vi.mock("@/lib/github/client", () => ({
  getGitHubConfig: async () => ({ success: true, config: { token: "t", repo: "o/r" } }),
  createIssue: mocks.createIssue,
  fetchCommits: vi.fn(),
  fetchCommitDiff: vi.fn(),
  fetchPullRequests: vi.fn(),
  fetchIssues: vi.fn(),
  fetchContributors: vi.fn(),
  fetchMilestones: vi.fn(),
  fetchRepoStats: vi.fn(),
}))

import { POST as themesPOST } from "../themes/route"
import { POST as dashboardsPOST } from "../dashboards/route"
import { POST as githubPOST } from "../github/route"

function agentRequest(path: string, body: unknown): Request {
  return new Request(`https://compass.example${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer test" },
    body: JSON.stringify(body),
  })
}

const officeUser = { id: "user-1", role: "office", organizationId: "org-1" }

describe("agent API routes act as the token's user", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveAgentUser.mockResolvedValue(officeUser)
    mocks.setThemePreferenceForUser.mockResolvedValue({ success: true })
    mocks.listCustomThemesForUser.mockResolvedValue([])
    mocks.listCustomDashboardsForUser.mockResolvedValue([])
  })

  it("sets the theme for the token's user without a session cookie", async () => {
    const response = await themesPOST(
      agentRequest("/api/compass/themes", { action: "set", themeId: "native-compass" }),
    )

    expect(response.status).toBe(200)
    expect(mocks.setThemePreferenceForUser).toHaveBeenCalledWith(
      expect.anything(),
      "user-1",
      "native-compass",
    )
    expect(mocks.getCurrentUser).not.toHaveBeenCalled()
  })

  it("lists the token user's dashboards without a session cookie", async () => {
    const response = await dashboardsPOST(
      agentRequest("/api/compass/dashboards", { action: "list" }),
    )

    expect(response.status).toBe(200)
    expect(mocks.listCustomDashboardsForUser).toHaveBeenCalledWith(expect.anything(), "user-1")
    expect(mocks.getCurrentUser).not.toHaveBeenCalled()
  })

  it("rejects a token whose user is no longer active", async () => {
    mocks.resolveAgentUser.mockResolvedValue(null)

    const response = await themesPOST(
      agentRequest("/api/compass/themes", { action: "set", themeId: "native-compass" }),
    )

    expect(response.status).toBe(401)
    expect(mocks.setThemePreferenceForUser).not.toHaveBeenCalled()
  })

  it("keeps GitHub issue creation away from staff roles", async () => {
    const response = await githubPOST(
      agentRequest("/api/compass/github", { action: "createIssue", title: "Bug", body: "Details" }),
    )

    expect(response.status).toBe(403)
    expect(mocks.createIssue).not.toHaveBeenCalled()
  })

  it("lets administrators create GitHub issues", async () => {
    mocks.resolveAgentUser.mockResolvedValue({ ...officeUser, role: "admin" })
    mocks.createIssue.mockResolvedValue({
      success: true,
      data: { number: 1, url: "https://github.example/1", title: "Bug" },
    })

    const response = await githubPOST(
      agentRequest("/api/compass/github", { action: "createIssue", title: "Bug", body: "Details" }),
    )

    expect(response.status).toBe(200)
    expect(mocks.createIssue).toHaveBeenCalled()
  })
})
