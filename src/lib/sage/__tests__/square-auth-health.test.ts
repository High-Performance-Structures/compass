import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/d1"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createJarvisSignature } from "@/lib/jarvis/auth"

const mocks = vi.hoisted(() => ({ getDb: vi.fn(), context: vi.fn() }))
vi.mock("@/db", () => ({ getDb: mocks.getDb }))
vi.mock("@/lib/db", () => ({ getCloudflareContext: mocks.context }))
import {
  checkCompassSquareAuthentication,
  notifySquareAuthHealth,
  recordSquareAuthObservation,
} from "../square-auth-health"
import { POST } from "@/app/api/integrations/square/auth-health/route"
import { POST as maintenance } from "@/app/api/operations/square/auth-health/route"

type Sqlite = InstanceType<typeof Database>
function d1(sqlite: Sqlite): unknown {
  function prepare(
    query: string,
    values: readonly unknown[] = []
  ): Record<string, unknown> {
    const statement = sqlite.prepare(query)
    function execute(): Record<string, unknown> {
      return {
        success: true,
        results:
          Reflect.get(statement, "reader") === true
            ? statement.all(...values)
            : (statement.run(...values), []),
        meta: {},
      }
    }
    return {
      bind: (...next: unknown[]): unknown => prepare(query, next),
      run: async (): Promise<unknown> => execute(),
      all: async (): Promise<unknown> => execute(),
      raw: async (): Promise<unknown> => statement.raw().all(...values),
      first: async (): Promise<unknown> => statement.get(...values) ?? null,
      execute,
    }
  }
  return {
    prepare,
    batch: async (
      statements: readonly { execute: () => unknown }[]
    ): Promise<unknown> =>
      sqlite.transaction(() =>
        statements.map((statement) => statement.execute())
      )(),
  }
}

describe("Square authentication health", () => {
  let sqlite: Sqlite
  const env = {
    DB: {},
    SAGE_SQUARE_ORGANIZATION_ID: "org-1",
    JARVIS_BRIDGE_SECRET: "test-bridge-secret-long-enough",
    SQUARE_PRODUCTION_ACCESS_TOKEN: "test-square-token",
  }
  // The real SQLite-backed D1 adapter implements precisely the ORM methods used here.
  // @ts-expect-error Test fixture intentionally omits unrelated Cloudflare bindings.
  const cloudflareEnv: CloudflareEnv = env
  const start = new Date("2026-09-18T05:00:00.000Z")
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(start)
    sqlite = new Database(":memory:")
    sqlite.exec(`
      CREATE TABLE feedback_service_health (service_name TEXT PRIMARY KEY, organization_id TEXT, status TEXT NOT NULL, last_heartbeat_at TEXT NOT NULL, last_success_at TEXT, last_failure_at TEXT, consecutive_failures INTEGER NOT NULL DEFAULT 0, last_error TEXT, metadata TEXT, updated_at TEXT NOT NULL);
      CREATE TABLE notification_events (id TEXT PRIMARY KEY, organization_id TEXT, project_id TEXT, event_type TEXT, source_type TEXT, source_id TEXT, title TEXT, body TEXT, href TEXT, priority TEXT, audience TEXT, created_by TEXT, created_at TEXT);
      CREATE TABLE notification_recipients (id TEXT PRIMARY KEY, event_id TEXT, user_id TEXT, in_app INTEGER DEFAULT 1, email INTEGER DEFAULT 0, sms INTEGER DEFAULT 0, push INTEGER DEFAULT 0, read_at TEXT, dismissed_at TEXT, created_at TEXT);
      CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT, role TEXT, is_active INTEGER);
      CREATE TABLE organization_members (organization_id TEXT, user_id TEXT);
      CREATE TABLE notification_preferences (user_id TEXT, in_app_enabled INTEGER);
      INSERT INTO users VALUES ('admin1','admin@example.test','admin',1), ('staff1','staff@example.test','office_manager',1), ('external-admin','other@example.test','admin',1), ('inactive','inactive@example.test','admin',0);
      INSERT INTO organization_members VALUES ('org-1','admin1'), ('org-1','staff1'), ('org-2','external-admin'), ('org-1','inactive');
    `)
    // @ts-expect-error SQLite test adapter implements the D1 query contract.
    mocks.getDb.mockReturnValue(drizzle(d1(sqlite)))
    mocks.context.mockResolvedValue({ env })
  })
  afterEach(() => {
    sqlite.close()
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  async function record(
    state: "healthy" | "credentials_rejected",
    seconds: number
  ): Promise<void> {
    const checkedAt = new Date(start.getTime() + seconds * 1000).toISOString()
    vi.setSystemTime(checkedAt)
    await recordSquareAuthObservation(
      cloudflareEnv,
      "org-1",
      "square-invoice-auth",
      { state, checkedAt }
    )
    await notifySquareAuthHealth(cloudflareEnv, "org-1")
  }
  function counts(): unknown {
    return sqlite
      .prepare(
        "SELECT event_type, COUNT(*) AS count FROM notification_events GROUP BY event_type ORDER BY event_type"
      )
      .all()
  }

  it("deduplicates failures and recovery; only notifies active same-org admins", async () => {
    await record("healthy", 0)
    await record("credentials_rejected", 60)
    await record("credentials_rejected", 120)
    await notifySquareAuthHealth(cloudflareEnv, "org-1")
    expect(counts()).toEqual([{ event_type: "square_auth.failed", count: 1 }])
    expect(
      sqlite
        .prepare("SELECT DISTINCT user_id FROM notification_recipients")
        .all()
    ).toEqual([{ user_id: "admin1" }])
    await record("healthy", 180)
    await record("healthy", 240)
    expect(counts()).toEqual([
      { event_type: "square_auth.failed", count: 1 },
      { event_type: "square_auth.recovered", count: 1 },
    ])
    expect(
      sqlite
        .prepare(
          "SELECT dismissed_at FROM notification_recipients WHERE event_id NOT LIKE '%:recovered'"
        )
        .get()
    ).toEqual({ dismissed_at: "2026-09-18T05:03:00.000Z" })
    await record("credentials_rejected", 300)
    expect(counts()).toEqual([
      { event_type: "square_auth.failed", count: 2 },
      { event_type: "square_auth.recovered", count: 1 },
    ])
  })

  it("detects missing first heartbeat and stopped monitors without repeated alerts", async () => {
    await notifySquareAuthHealth(cloudflareEnv, "org-1", start)
    expect(counts()).toEqual([])
    const stale = new Date(start.getTime() + 301000)
    await notifySquareAuthHealth(cloudflareEnv, "org-1", stale)
    await notifySquareAuthHealth(cloudflareEnv, "org-1", stale)
    expect(counts()).toEqual([{ event_type: "square_auth.failed", count: 1 }])
    await record("healthy", 360)
    expect(counts()).toEqual([
      { event_type: "square_auth.failed", count: 1 },
      { event_type: "square_auth.recovered", count: 1 },
    ])
  })

  it("ignores delayed/replayed reports and preserves latest success", async () => {
    await record("healthy", 180)
    await recordSquareAuthObservation(
      cloudflareEnv,
      "org-1",
      "square-invoice-auth",
      { state: "credentials_rejected", checkedAt: start.toISOString() }
    )
    expect(
      sqlite
        .prepare(
          "SELECT status, consecutive_failures FROM feedback_service_health"
        )
        .get()
    ).toEqual({ status: "healthy", consecutive_failures: 0 })
  })

  it("rolls back partial alert writes so the next attempt can deliver", async () => {
    await recordSquareAuthObservation(
      cloudflareEnv,
      "org-1",
      "square-invoice-auth",
      { state: "credentials_rejected", checkedAt: start.toISOString() }
    )
    sqlite.exec(
      "CREATE TRIGGER fail_recipient BEFORE INSERT ON notification_recipients BEGIN SELECT RAISE(ABORT, 'test failure'); END"
    )
    await expect(
      notifySquareAuthHealth(cloudflareEnv, "org-1")
    ).rejects.toThrow()
    expect(counts()).toEqual([])
    sqlite.exec("DROP TRIGGER fail_recipient")
    await notifySquareAuthHealth(cloudflareEnv, "org-1")
    expect(counts()).toEqual([{ event_type: "square_auth.failed", count: 1 }])
  })

  it("honors in-app opt-out", async () => {
    sqlite.exec("INSERT INTO notification_preferences VALUES ('admin1',0)")
    await record("credentials_rejected", 0)
    expect(
      sqlite.prepare("SELECT * FROM notification_recipients").all()
    ).toEqual([])
  })

  it("classifies provider failures safely and checks active locations", async () => {
    const fetching = vi.fn()
    vi.stubGlobal("fetch", fetching)
    for (const [status, state] of [
      [401, "credentials_rejected"],
      [403, "credentials_rejected"],
      [500, "unavailable"],
    ]) {
      fetching.mockResolvedValueOnce(
        new Response("test-square-token provider body", {
          status: Number(status),
        })
      )
      expect(
        (await checkCompassSquareAuthentication(cloudflareEnv)).state
      ).toBe(state)
    }
    fetching.mockRejectedValueOnce(new Error("test-square-token timeout"))
    expect((await checkCompassSquareAuthentication(cloudflareEnv)).state).toBe(
      "unavailable"
    )
    fetching.mockResolvedValueOnce(Response.json({ locations: [] }))
    expect((await checkCompassSquareAuthentication(cloudflareEnv)).state).toBe(
      "location_mismatch"
    )
    fetching.mockResolvedValueOnce(
      Response.json({
        locations: ["HPS", "ORC", "Nu-Tech"].map((name) => ({
          name,
          status: "ACTIVE",
        })),
      })
    )
    expect((await checkCompassSquareAuthentication(cloudflareEnv)).state).toBe(
      "healthy"
    )
    const options: unknown = fetching.mock.calls[0]?.[1]
    expect(options).toMatchObject({ redirect: "error" })
  })

  async function signedRequest(
    target: string,
    value: unknown
  ): Promise<Request> {
    const body = JSON.stringify(value)
    const timestamp = String(Math.floor(Date.now() / 1000))
    const signature = await createJarvisSignature(
      env.JARVIS_BRIDGE_SECRET,
      timestamp,
      "POST",
      target,
      body
    )
    return new Request("https://compass.example" + target, {
      method: "POST",
      body,
      headers: {
        "x-compass-timestamp": timestamp,
        "x-compass-signature": signature,
      },
    })
  }

  it("authenticates reports and rejects arbitrary errors, stale observations, or caller-selected organizations", async () => {
    const target = "/api/integrations/square/auth-health"
    expect(
      (
        await POST(
          new Request("https://compass.example" + target, {
            method: "POST",
            body: "{}",
          })
        )
      ).status
    ).toBe(401)
    for (const value of [
      {
        state: "healthy",
        checkedAt: start.toISOString(),
        organizationId: "org-2",
      },
      { state: "test-square-token", checkedAt: start.toISOString() },
      { state: "healthy", checkedAt: "2020-01-01T00:00:00.000Z" },
    ]) {
      expect((await POST(await signedRequest(target, value))).status).toBe(400)
    }
    expect(
      (
        await POST(
          await signedRequest(target, {
            state: "healthy",
            checkedAt: start.toISOString(),
          })
        )
      ).status
    ).toBe(200)
    expect(
      sqlite
        .prepare("SELECT organization_id, status FROM feedback_service_health")
        .get()
    ).toEqual({ organization_id: "org-1", status: "healthy" })
  })

  it("scheduled maintenance checks the server credential even with no invoices", async () => {
    const fetching = vi
      .fn()
      .mockResolvedValue(
        new Response("do not retain this body", { status: 401 })
      )
    vi.stubGlobal("fetch", fetching)
    expect(
      (
        await maintenance(
          await signedRequest("/api/operations/square/auth-health", {})
        )
      ).status
    ).toBe(200)
    expect(fetching).toHaveBeenCalledTimes(1)
    expect(counts()).toEqual([{ event_type: "square_auth.failed", count: 1 }])
    expect(
      JSON.stringify(
        sqlite.prepare("SELECT * FROM feedback_service_health").all()
      )
    ).not.toContain("test-square-token")
  })
})
