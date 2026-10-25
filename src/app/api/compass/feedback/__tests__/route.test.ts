import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  resolveAgentUser: vi.fn(),
  enqueueFeedbackDeskItem: vi.fn(),
  linkFeedbackDeskItemToGithub: vi.fn(),
  valid: true,
}))

vi.mock("server-only", () => ({}))
vi.mock("@/db", () => ({ getDb: () => ({}) }))
vi.mock("@/lib/db", () => ({ getCloudflareContext: async () => ({ env: { DB: {} } }) }))
vi.mock("@/lib/agent/api-auth", () => ({
  validateAgentAuth: async () => mocks.valid
    ? { valid: true, userId: "staff-1", orgId: "org-1", role: "office", isDemoUser: false }
    : { valid: false },
}))
vi.mock("@/lib/agent/agent-user", () => ({ resolveAgentUser: mocks.resolveAgentUser }))
vi.mock("@/lib/jarvis/feedback-desk", () => ({ enqueueFeedbackDeskItem: mocks.enqueueFeedbackDeskItem }))
vi.mock("@/lib/jarvis/feedback-github", () => ({ linkFeedbackDeskItemToGithub: mocks.linkFeedbackDeskItemToGithub }))

import { POST } from "../route"

function post(body: unknown): Promise<Response> {
  return POST(new Request("https://compass.internal/api/compass/feedback", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer t" },
    body: JSON.stringify(body),
  }))
}

describe("POST /api/compass/feedback", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.valid = true
    mocks.resolveAgentUser.mockResolvedValue({
      id: "staff-1",
      displayName: "Wes Jones",
      email: "Wes@Example.com",
      organizationId: "org-1",
    })
    mocks.enqueueFeedbackDeskItem.mockResolvedValue({ id: "item-1", status: "new" })
    mocks.linkFeedbackDeskItemToGithub.mockResolvedValue(null)
  })

  it("files the request as the signed-in person, not anyone the agent names", async () => {
    const response = await post({
      action: "file",
      kind: "bug",
      title: "Gantt jumps left",
      description: "After saving, the Gantt scrolls back to the start.",
      page: "/dashboard/projects/p1/schedule",
      reporterEmail: "someone-else@example.com",
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ success: true, requestId: "item-1", link: "/dashboard/requests/item-1" })
    expect(mocks.enqueueFeedbackDeskItem).toHaveBeenCalledWith({}, expect.objectContaining({
      organizationId: "org-1",
      source: "ask-jarvis",
      kind: "bug",
      title: "Gantt jumps left",
      reporterName: "Wes Jones",
      reporterEmail: "wes@example.com",
      metadata: expect.objectContaining({ externalActorId: "staff-1", filedByAskJarvis: true }),
    }))
    expect(mocks.linkFeedbackDeskItemToGithub).toHaveBeenCalledTimes(1)
  })

  it("rejects an unauthenticated call", async () => {
    mocks.valid = false
    const response = await post({ action: "file", kind: "bug", title: "x", description: "y" })
    expect(response.status).toBe(401)
    expect(mocks.enqueueFeedbackDeskItem).not.toHaveBeenCalled()
  })

  it("rejects a request without a description", async () => {
    const response = await post({ action: "file", kind: "bug", title: "x", description: " " })
    expect(response.status).toBe(400)
    expect(mocks.enqueueFeedbackDeskItem).not.toHaveBeenCalled()
  })

  it("still reports success when the GitHub link fails", async () => {
    mocks.linkFeedbackDeskItemToGithub.mockRejectedValue(new Error("GitHub down"))
    const response = await post({ action: "file", kind: "question", title: "How?", description: "How do I send a message?" })
    expect(response.status).toBe(200)
  })
})
