import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  callAgentRoute: vi.fn(),
}))

vi.mock("server-only", () => ({}))
vi.mock("@/lib/auth", () => ({ getCurrentUser: mocks.getCurrentUser }))
vi.mock("@/lib/db", () => ({
  getCloudflareContext: async () => ({ env: { AGENT_AUTH_SECRET: "test-agent-secret" } }),
}))
vi.mock("@/lib/agent/in-process-data-source", () => ({ callAgentRoute: mocks.callAgentRoute }))

import { confirmAgentAction } from "@/app/actions/agent-confirmation"
import { signPendingAction } from "@/lib/agent/pending-actions"

const user = { id: "user-1", organizationId: "org-1", role: "project_manager", isActive: true }
const pending = {
  userId: "user-1",
  organizationId: "org-1",
  path: "/api/compass/schedule",
  body: { action: "deleteTask", taskId: "task-1" },
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getCurrentUser.mockResolvedValue(user)
  mocks.callAgentRoute.mockResolvedValue({ success: true })
})

describe("confirmAgentAction", () => {
  it("carries out exactly the confirmed action as the signed-in user", async () => {
    const token = await signPendingAction("test-agent-secret", pending)

    expect(await confirmAgentAction(token)).toEqual({ success: true })
    expect(mocks.callAgentRoute).toHaveBeenCalledWith(
      expect.any(String),
      "/api/compass/schedule",
      { action: "deleteTask", taskId: "task-1" },
    )
  })

  it("refuses a confirmation proposed to someone else", async () => {
    const token = await signPendingAction("test-agent-secret", { ...pending, userId: "user-2" })

    expect(await confirmAgentAction(token)).toEqual({
      success: false,
      error: "This confirmation was for someone else.",
    })
    expect(mocks.callAgentRoute).not.toHaveBeenCalled()
  })

  it("refuses an invalid or expired token", async () => {
    expect(await confirmAgentAction("not-a-token")).toEqual({
      success: false,
      error: "This confirmation has expired. Ask Jarvis again.",
    })
    expect(mocks.callAgentRoute).not.toHaveBeenCalled()
  })

  it("requires a signed-in user", async () => {
    mocks.getCurrentUser.mockResolvedValue(null)
    const token = await signPendingAction("test-agent-secret", pending)

    expect((await confirmAgentAction(token)).success).toBe(false)
    expect(mocks.callAgentRoute).not.toHaveBeenCalled()
  })

  it("reports the handler's refusal", async () => {
    mocks.callAgentRoute.mockRejectedValue(new Error("No access to this project"))
    const token = await signPendingAction("test-agent-secret", pending)

    expect(await confirmAgentAction(token)).toEqual({
      success: false,
      error: "No access to this project",
    })
  })
})
