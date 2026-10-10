import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  callAgentRoute: vi.fn(),
  getDb: vi.fn(),
}))

vi.mock("server-only", () => ({}))
vi.mock("@/lib/auth", () => ({ getCurrentUser: mocks.getCurrentUser }))
vi.mock("@/db", () => ({ getDb: mocks.getDb }))
vi.mock("@/lib/db", () => ({
  getCloudflareContext: async () => ({ env: { AGENT_AUTH_SECRET: "test-agent-secret", DB: {} } }),
}))
vi.mock("@/lib/agent/in-process-data-source", () => ({ callAgentRoute: mocks.callAgentRoute }))

import { confirmAgentAction } from "@/app/actions/agent-confirmation"
import { signPendingAction } from "@/lib/agent/pending-actions"

// The real migration, so the single-use check runs against the same table
// production uses. The users table is a stub for the foreign key.
function freshDatabase(): ReturnType<typeof drizzle> {
  const sqlite = new Database(":memory:")
  sqlite.exec("CREATE TABLE users (id text PRIMARY KEY NOT NULL)")
  sqlite.exec("INSERT INTO users (id) VALUES ('user-1'), ('user-2')")
  const migration = readFileSync(
    join(process.cwd(), "drizzle/0207_agent_action_confirmations.sql"),
    "utf8",
  )
  for (const statement of migration.split("--> statement-breakpoint")) {
    sqlite.exec(statement)
  }
  return drizzle(sqlite)
}

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
  mocks.getDb.mockReturnValue(freshDatabase())
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

  it("carries out a confirmation only once", async () => {
    const token = await signPendingAction("test-agent-secret", {
      ...pending,
      body: { action: "createTask", projectId: "project-1", title: "Frame" },
    })

    expect(await confirmAgentAction(token)).toEqual({ success: true })
    expect(await confirmAgentAction(token)).toEqual({
      success: false,
      error: "This change was already confirmed.",
    })
    expect(mocks.callAgentRoute).toHaveBeenCalledTimes(1)
  })

  it("does not use up a token proposed to someone else", async () => {
    const token = await signPendingAction("test-agent-secret", pending)
    mocks.getCurrentUser.mockResolvedValueOnce({ ...user, id: "user-2" })

    expect((await confirmAgentAction(token)).success).toBe(false)
    expect(await confirmAgentAction(token)).toEqual({ success: true })
  })
})
