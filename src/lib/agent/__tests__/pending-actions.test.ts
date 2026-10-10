import { describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))
vi.mock("@/app/api/compass/dashboards/route", () => ({ POST: vi.fn() }))
vi.mock("@/app/api/compass/github/route", () => ({ POST: vi.fn() }))
vi.mock("@/app/api/compass/memory/route", () => ({ POST: vi.fn() }))
vi.mock("@/app/api/compass/messages/route", () => ({ POST: vi.fn() }))
vi.mock("@/app/api/compass/query/route", () => ({ POST: vi.fn() }))
vi.mock("@/app/api/compass/schedule/route", () => ({ POST: vi.fn() }))
vi.mock("@/app/api/compass/skills/route", () => ({ POST: vi.fn() }))
vi.mock("@/app/api/compass/themes/route", () => ({ POST: vi.fn() }))

import { generateAgentToken, validateAgentAuth } from "@/lib/agent/api-auth"
import { createInProcessDataSource } from "@/lib/agent/in-process-data-source"
import {
  requiresConfirmation,
  signPendingAction,
  verifyPendingAction,
} from "@/lib/agent/pending-actions"

const secret = "test-agent-secret"
const pending = {
  userId: "user-1",
  organizationId: "org-1",
  path: "/api/compass/schedule",
  body: { action: "deleteTask", taskId: "task-1" },
}

describe("requiresConfirmation", () => {
  it("holds deletions and shared schedule changes, not reads or personal tweaks", () => {
    expect(requiresConfirmation("/api/compass/schedule", { action: "deleteTask" })).toBe(true)
    expect(requiresConfirmation("/api/compass/schedule", { action: "createTask" })).toBe(true)
    expect(requiresConfirmation("/api/compass/schedule", { action: "updateTask" })).toBe(true)
    expect(requiresConfirmation("/api/compass/schedule", { action: "createDependency" })).toBe(true)
    expect(requiresConfirmation("/api/compass/schedule", { action: "deleteDependency" })).toBe(true)
    expect(requiresConfirmation("/api/compass/dashboards", { action: "delete" })).toBe(true)

    expect(requiresConfirmation("/api/compass/schedule", { action: "getSchedule" })).toBe(false)
    expect(requiresConfirmation("/api/compass/dashboards", { action: "list" })).toBe(false)
    expect(requiresConfirmation("/api/compass/themes", { action: "set" })).toBe(false)
    expect(requiresConfirmation("/api/compass/query", { queryType: "daily_logs" })).toBe(false)
  })
})

describe("pending action tokens", () => {
  it("round-trips the exact action, data and user", async () => {
    const token = await signPendingAction(secret, pending)
    expect(await verifyPendingAction(secret, token)).toEqual(pending)
  })

  it("rejects a token signed with another secret or altered", async () => {
    const token = await signPendingAction(secret, pending)
    expect(await verifyPendingAction("other-secret", token)).toBeNull()
    const [header, , signature] = token.split(".")
    const forgedPayload = Buffer.from(
      JSON.stringify({ uid: "user-1", org: "org-1", path: pending.path, body: { action: "deleteTask", taskId: "task-2" } }),
    ).toString("base64url")
    expect(await verifyPendingAction(secret, `${header}.${forgedPayload}.${signature}`)).toBeNull()
  })

  it("never accepts an agent token as a confirmation", async () => {
    const agentToken = await generateAgentToken(secret, "user-1", "org-1", "admin", false)
    expect(await verifyPendingAction(secret, agentToken)).toBeNull()
  })

  it("never lets a confirmation token act as an agent token", async () => {
    const token = await signPendingAction(secret, pending)
    const result = await validateAgentAuth(
      new Request("https://compass.internal/api/compass/schedule", {
        headers: { Authorization: `Bearer ${token}` },
      }),
      { AGENT_AUTH_SECRET: secret },
    )
    expect(result.valid).toBe(false)
  })
})

describe("in-process interception", () => {
  it("returns the interceptor's answer without running the handler", async () => {
    const handler = vi.fn<(request: Request) => Promise<Response>>()
    const source = createInProcessDataSource("agent-token", {
      routes: new Map([["/api/compass/schedule", handler]]),
      intercept: async (_path, body) =>
        requiresConfirmation("/api/compass/schedule", body) ? { status: "awaiting_confirmation" } : undefined,
    })

    expect(await source.fetch("/api/compass/schedule", { action: "deleteTask", taskId: "t" })).toEqual({
      status: "awaiting_confirmation",
    })
    expect(handler).not.toHaveBeenCalled()

    handler.mockResolvedValueOnce(Response.json({ tasks: [] }))
    expect(await source.fetch("/api/compass/schedule", { action: "getSchedule", projectId: "p" })).toEqual({
      tasks: [],
    })
    expect(handler).toHaveBeenCalledTimes(1)
  })
})
