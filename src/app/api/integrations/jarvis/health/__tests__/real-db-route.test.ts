import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/d1"
import { afterEach, describe, expect, it, vi } from "vitest"

import { feedbackServiceHealth } from "@/db/schema-jarvis"
import { createJarvisSignature } from "@/lib/jarvis/auth"

const mocks = vi.hoisted(() => ({
  getCloudflareContext: vi.fn(),
  getDb: vi.fn(),
}))

vi.mock("@/lib/db", () => ({
  getCloudflareContext: mocks.getCloudflareContext,
}))
vi.mock("@/db", () => ({ getDb: mocks.getDb }))
vi.mock("@/lib/jarvis/feedback-desk", () => ({ enqueueFeedbackDeskItem: vi.fn() }))
vi.mock("@/lib/jarvis/feedback-github", () => ({ linkFeedbackDeskItemToGithub: vi.fn() }))
vi.mock("@/lib/jarvis/feedback-github-sync", () => ({ syncFeedbackDeskItemsFromGithub: vi.fn() }))
vi.mock("@/lib/notifications/events", () => ({ createSystemNotificationEvent: vi.fn() }))

import { POST } from "../route"

type Sqlite = InstanceType<typeof Database>

function createD1(sqlite: Sqlite): unknown {
  function statementFor(query: string, values: readonly unknown[] = []): Record<string, unknown> {
    const statement = sqlite.prepare(query)
    return {
      bind: (...nextValues: unknown[]): unknown => statementFor(query, nextValues),
      run: async (): Promise<unknown> => {
        const info = statement.run(...values)
        return {
          success: true,
          meta: {
            changes: Number(info.changes),
            duration: 0,
            last_row_id: Number(info.lastInsertRowid),
            rows_read: 0,
            rows_written: Number(info.changes),
          },
        }
      },
      all: async (): Promise<unknown> => ({
        success: true,
        results: statement.all(...values),
      }),
      raw: async (): Promise<unknown> => statement.raw().all(...values),
      first: async (): Promise<unknown> => statement.all(...values)[0] ?? null,
    }
  }

  return {
    prepare(query: string): unknown {
      return statementFor(query)
    },
    async batch(statements: readonly { run: () => Promise<unknown> }[]): Promise<readonly unknown[]> {
      return Promise.all(statements.map((statement) => statement.run()))
    },
    async exec(query: string): Promise<Readonly<{ count: number; duration: number }>> {
      sqlite.exec(query)
      return { count: 0, duration: 0 }
    },
    async dump(): Promise<ArrayBuffer> {
      return new ArrayBuffer(0)
    },
  }
}

function createSchema(sqlite: Sqlite): void {
  sqlite.exec(`
    CREATE TABLE feedback_service_health (
      service_name TEXT PRIMARY KEY NOT NULL,
      organization_id TEXT,
      status TEXT NOT NULL,
      last_heartbeat_at TEXT NOT NULL,
      last_success_at TEXT,
      last_failure_at TEXT,
      consecutive_failures INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      metadata TEXT,
      updated_at TEXT NOT NULL
    );
  `)
}

describe("POST /api/integrations/jarvis/health with a real database", () => {
  const databases: Sqlite[] = []

  afterEach(() => {
    vi.clearAllMocks()
    for (const sqlite of databases.splice(0)) sqlite.close()
  })

  it("authenticates and persists a lifecycle executor heartbeat", async () => {
    const sqlite = new Database(":memory:")
    databases.push(sqlite)
    createSchema(sqlite)
    // @ts-expect-error The SQLite adapter implements the D1 methods used by this route.
    const db = drizzle(createD1(sqlite), { schema: { feedbackServiceHealth } })
    const env = {
      DB: createD1(sqlite),
      JARVIS_BRIDGE_SECRET: "test-secret",
      JARVIS_BRIDGE_ORGANIZATION_ID: "org-1",
    }
    mocks.getCloudflareContext.mockResolvedValue({ env })
    mocks.getDb.mockReturnValue(db)

    const rawBody = JSON.stringify({
      serviceName: "jarvis-feedback-lifecycle-executor",
      status: "healthy",
      metadata: { claimedEventCount: 1, completedCount: 1, failedCount: 0 },
    })
    const timestamp = String(Math.floor(Date.now() / 1_000))
    const signature = await createJarvisSignature(
      "test-secret",
      timestamp,
      "POST",
      "/api/integrations/jarvis/health",
      rawBody,
    )
    const response = await POST(new Request(
      "https://compass.example/api/integrations/jarvis/health",
      {
        method: "POST",
        body: rawBody,
        headers: {
          "content-type": "application/json",
          "x-compass-timestamp": timestamp,
          "x-compass-signature": signature,
        },
      },
    ))

    expect(response.status).toBe(200)
    const row = sqlite.prepare(`
      SELECT service_name, organization_id, status, metadata
      FROM feedback_service_health
      WHERE service_name = ?
    `).get("jarvis-feedback-lifecycle-executor") as {
      service_name: string
      organization_id: string
      status: string
      metadata: string
    } | undefined
    expect(row).toEqual({
      service_name: "jarvis-feedback-lifecycle-executor",
      organization_id: "org-1",
      status: "healthy",
      metadata: JSON.stringify({ claimedEventCount: 1, completedCount: 1, failedCount: 0 }),
    })
  })
})