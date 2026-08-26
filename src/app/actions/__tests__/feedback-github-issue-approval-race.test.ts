import { afterEach, describe, expect, it, vi } from "vitest"
import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/d1"
import { eq } from "drizzle-orm"

import { feedbackDeskItems } from "@/db/schema-jarvis"
import { linkFeedbackDeskItemToGithub } from "@/lib/jarvis/feedback-github"

const mocks = vi.hoisted(() => ({
  canManageUserAccess: vi.fn(),
  getCloudflareContext: vi.fn(),
  getDb: vi.fn(),
  requireAuth: vi.fn(),
  revalidatePath: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({ requireAuth: mocks.requireAuth }))
vi.mock("@/lib/db", () => ({ getCloudflareContext: mocks.getCloudflareContext }))
vi.mock("@/db", () => ({ getDb: mocks.getDb }))
vi.mock("@/lib/permissions", () => ({ canManageUserAccess: mocks.canManageUserAccess }))
vi.mock("@/lib/user-roles", () => ({
  isInternalStaffRole: vi.fn(() => true),
}))
vi.mock("@/lib/jarvis/feedback-maintenance", () => ({
  runFeedbackMaintenance: vi.fn(),
}))
vi.mock("@/lib/jarvis/feedback-status-update", () => ({
  applyFeedbackLifecycleUpdate: vi.fn(),
}))
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }))

import { setFeedbackGithubIssueCreationApproval } from "@/app/actions/feedback-admin"

type Sqlite = InstanceType<typeof Database>

type PauseAfterWrite = Readonly<{
  paused: Promise<void>
  shouldPause: (query: string) => boolean
  signal: () => void
}>

function createD1(sqlite: Sqlite, pauseAfterWrite?: PauseAfterWrite): unknown {
  function statementFor(query: string, values: readonly unknown[] = []): Record<string, unknown> {
    const statement = sqlite.prepare(query)
    const maybePause = async (): Promise<void> => {
      if (!pauseAfterWrite?.shouldPause(query)) return
      pauseAfterWrite.signal()
      await pauseAfterWrite.paused
    }
    return {
      bind: (...nextValues: unknown[]): unknown => statementFor(query, nextValues),
      run: async (): Promise<unknown> => {
        const info = statement.run(...values)
        await maybePause()
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
      all: async (): Promise<unknown> => {
        const results = statement.all(...values)
        await maybePause()
        return { success: true, results }
      },
      raw: async (): Promise<unknown> => {
        const results = statement.raw().all(...values)
        await maybePause()
        return results
      },
      first: async (): Promise<unknown> => {
        const results = statement.all(...values)
        await maybePause()
        return results[0] ?? null
      },
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
    CREATE TABLE feedback_desk_items (
      id TEXT PRIMARY KEY NOT NULL,
      organization_id TEXT,
      source TEXT NOT NULL,
      source_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'new',
      priority TEXT NOT NULL DEFAULT 'normal',
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      internal_summary TEXT,
      reporter_name TEXT,
      reporter_email TEXT,
      channel_id TEXT,
      message_id TEXT,
      thread_id TEXT,
      github_issue_url TEXT,
      github_issue_node_id TEXT,
      github_issue_creation_approved_at TEXT,
      github_issue_creation_approved_by TEXT,
      github_issue_creation_claim_token TEXT,
      github_issue_creation_claimed_at TEXT,
      github_issue_creation_claim_expires_at TEXT,
      github_issue_creation_provider_attempted_at TEXT,
      feature_priority_approved_at TEXT,
      feature_priority_approved_by TEXT,
      github_draft_pull_request_url TEXT,
      assigned_to_user_id TEXT,
      assigned_to_name TEXT,
      sla_target_at TEXT,
      triaged_at TEXT,
      resolved_at TEXT,
      last_requester_update_at TEXT,
      last_github_sync_at TEXT,
      privacy_scrubbed_at TEXT,
      delivery_graph_id TEXT,
      delivery_graph_status TEXT,
      delivery_graph_implementation_task_id TEXT,
      delivery_graph_review_task_id TEXT,
      delivery_graph_release_task_id TEXT,
      delivery_graph_last_error TEXT,
      delivery_graph_updated_at TEXT,
      metadata TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `)
}

function seedApprovedFeature(sqlite: Sqlite): void {
  sqlite.prepare(`
    INSERT INTO feedback_desk_items (
      id, organization_id, source, source_id, kind, status, priority,
      title, description, feature_priority_approved_at,
      github_issue_creation_approved_at, github_issue_creation_approved_by,
      triaged_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    "feature-1",
    "org-1",
    "feedback-widget",
    "source-1",
    "feature",
    "triaged",
    "normal",
    "Redacted feature",
    "Redacted description",
    "2026-08-24T17:00:00.000Z",
    "2026-08-24T18:00:00.000Z",
    "admin-1",
    "2026-08-24T17:00:00.000Z",
    "2026-08-24T17:00:00.000Z",
    "2026-08-24T17:00:00.000Z",
  )
}

function postCount(fetchMock: ReturnType<typeof vi.fn>): number {
  return fetchMock.mock.calls.filter((call) => {
    const options = call[1]
    return typeof call[0] === "string" && call[0].endsWith("/issues") &&
      typeof options === "object" && options !== null &&
      Reflect.get(options, "method") === "POST"
  }).length
}

describe("GitHub issue approval revocation provider fence", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it("rejects approval removal after the provider marker commits before POST", async () => {
    let releaseProviderMarker: () => void = () => undefined
    const providerMarkerPaused = new Promise<void>((resolve) => {
      releaseProviderMarker = resolve
    })
    let signalProviderMarker: () => void = () => undefined
    const providerMarkerCommitted = new Promise<void>((resolve) => {
      signalProviderMarker = resolve
    })
    let markerSignaled = false
    const sqlite = new Database(":memory:")
    createSchema(sqlite)
    seedApprovedFeature(sqlite)
    const clientOne = createD1(sqlite, {
      paused: providerMarkerPaused,
      shouldPause: (query) =>
        query.startsWith('update "feedback_desk_items"') &&
        query.includes("provider_attempted_at"),
      signal: () => {
        if (markerSignaled) return
        markerSignaled = true
        signalProviderMarker()
      },
    })
    const clientTwo = createD1(sqlite)
    // @ts-expect-error The SQLite adapter implements the D1 methods exercised here.
    const actorOne = drizzle(clientOne, { schema: { feedbackDeskItems } })
    // @ts-expect-error The SQLite adapter implements the D1 methods exercised here.
    const actorTwo = drizzle(clientTwo, { schema: { feedbackDeskItems } })
    const item = await actorOne.select().from(feedbackDeskItems)
      .where(eq(feedbackDeskItems.id, "feature-1")).get()
    if (!item) throw new Error("seed row missing")

    mocks.requireAuth.mockResolvedValue({ id: "admin-2", organizationId: "org-1" })
    mocks.canManageUserAccess.mockReturnValue(true)
    mocks.getCloudflareContext.mockResolvedValue({ env: { DB: clientTwo } })
    mocks.getDb.mockReturnValue(actorTwo)
    const fetchMock = vi.fn().mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes("/search/issues")) {
        return { ok: true, json: async () => ({ items: [] }) }
      }
      if (init?.method === "POST") {
        return {
          ok: true,
          json: async () => ({
            html_url: "https://github.com/example/compass/issues/48",
            node_id: "issue-node-48",
          }),
        }
      }
      throw new Error(`unexpected fetch ${url}`)
    })
    vi.stubGlobal("fetch", fetchMock)
    const env = Object.assign(Object.create(null), {
      GITHUB_TOKEN: "token",
      GITHUB_REPO: "example/compass",
    })

    // @ts-expect-error The focused actor contains the schema used by this integration path.
    const linkPromise = linkFeedbackDeskItemToGithub(actorOne, env, item)
    await providerMarkerCommitted
    const revocation = await setFeedbackGithubIssueCreationApproval({
      id: "feature-1",
      approved: false,
    })

    expect(revocation).toEqual({
      success: false,
      error: "This request changed while its GitHub approval was being updated",
    })
    releaseProviderMarker()

    expect(await linkPromise).toBe("https://github.com/example/compass/issues/48")
    expect(postCount(fetchMock)).toBe(1)
    const stored = await actorTwo.select().from(feedbackDeskItems)
      .where(eq(feedbackDeskItems.id, "feature-1")).get()
    expect(stored?.githubIssueCreationApprovedAt).toBe("2026-08-24T18:00:00.000Z")
    expect(stored?.githubIssueUrl).toBe("https://github.com/example/compass/issues/48")
    sqlite.close()
  })

  it("clears the provider-attempt fence after a definitive GitHub rejection", async () => {
    const sqlite = new Database(":memory:")
    createSchema(sqlite)
    seedApprovedFeature(sqlite)
    const client = createD1(sqlite)
    // @ts-expect-error The SQLite adapter implements the D1 methods exercised here.
    const actor = drizzle(client, { schema: { feedbackDeskItems } })
    const item = await actor.select().from(feedbackDeskItems)
      .where(eq(feedbackDeskItems.id, "feature-1")).get()
    if (!item) throw new Error("seed row missing")

    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes("/search/issues")) {
        return { ok: true, json: async () => ({ items: [] }) }
      }
      if (init?.method === "POST") return { ok: false, status: 403 }
      throw new Error(`unexpected fetch ${String(input)}`)
    }))

    // @ts-expect-error The focused actor contains the schema used by this integration path.
    const result = await linkFeedbackDeskItemToGithub(actor, {
      GITHUB_TOKEN: "token",
      GITHUB_REPO: "example/compass",
    }, item)

    expect(result).toBeNull()
    const stored = await actor.select().from(feedbackDeskItems)
      .where(eq(feedbackDeskItems.id, "feature-1")).get()
    expect(stored?.githubIssueCreationProviderAttemptedAt).toBeNull()
    expect(stored?.githubIssueCreationClaimToken).toBeNull()
    sqlite.close()
  })
})
