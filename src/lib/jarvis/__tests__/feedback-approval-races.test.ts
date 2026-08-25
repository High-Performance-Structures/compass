import { afterEach, describe, expect, it, vi } from "vitest"
import Database from "better-sqlite3"

import { getDb } from "@/db"
import { feedbackDeskItems, jarvisBridgeEvents } from "@/db/schema-jarvis"
import { linkFeedbackDeskItemToGithub } from "@/lib/jarvis/feedback-github"
import { applyFeedbackLifecycleUpdate } from "@/lib/jarvis/feedback-status-update"
import { eq } from "drizzle-orm"

type Sqlite = InstanceType<typeof Database>

function createD1(sqlite: Sqlite, pauseAfterRead?: {
  readonly paused: Promise<void>
  readonly shouldPause: (query?: string) => boolean
}, shouldFailWrite?: (query?: string) => boolean): unknown {
  function statementFor(query: string, values: readonly unknown[] = []): Record<string, unknown> {
    const statement = sqlite.prepare(query)
    const result = {
      bind: (...nextValues: unknown[]): unknown => statementFor(query, nextValues),
      run: async (): Promise<unknown> => {
        if (shouldFailWrite?.(query)) throw new Error("simulated crash")
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
      all: async (): Promise<unknown> => {
        if (shouldFailWrite?.(query)) throw new Error("simulated crash")
        const results = statement.all(...values)
        if (pauseAfterRead?.shouldPause(query)) await pauseAfterRead.paused
        return { success: true, results }
      },
      raw: async (): Promise<unknown> => {
        if (shouldFailWrite?.(query)) throw new Error("simulated crash")
        const results = statement.raw().all(...values)
        if (pauseAfterRead?.shouldPause(query)) await pauseAfterRead.paused
        return results
      },
      first: async (): Promise<unknown> => {
        const results = statement.all(...values)
        return results[0] ?? null
      },
    }
    return result
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
    CREATE TABLE jarvis_bridge_events (
      id TEXT PRIMARY KEY NOT NULL,
      organization_id TEXT,
      direction TEXT NOT NULL,
      source TEXT NOT NULL,
      event_type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      idempotency_key TEXT NOT NULL UNIQUE,
      feedback_desk_item_id TEXT,
      payload TEXT NOT NULL,
      result TEXT,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      available_at TEXT NOT NULL,
      claim_token TEXT,
      claimed_at TEXT,
      completed_at TEXT,
      last_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `)
}

function seedFeature(sqlite: Sqlite): void {
  sqlite.prepare(`
    INSERT INTO feedback_desk_items (
      id, organization_id, source, source_id, kind, status, priority,
      title, description, feature_priority_approved_at,
      github_issue_creation_approved_at, github_issue_creation_approved_by,
      triaged_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    "feature-1",
    null,
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

describe("Feedback Desk real approval race fences", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("allows only one of two database actors to claim GitHub issue creation", async () => {
    const sqlite = new Database(":memory:")
    createSchema(sqlite)
    seedFeature(sqlite)
    const client = createD1(sqlite)
    // @ts-expect-error The SQLite-backed adapter implements the D1 methods used by this integration test.
    const actorOne = getDb(client)
    // @ts-expect-error The SQLite-backed adapter implements the D1 methods used by this integration test.
    const actorTwo = getDb(client)
    const item = await actorOne.select().from(feedbackDeskItems)
      .where(eq(feedbackDeskItems.id, "feature-1")).get()
    if (!item) throw new Error("seed row missing")
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input).includes("/search/issues")) {
        return { ok: true, json: async () => ({ items: [] }) }
      }
      return {
        ok: true,
        json: async () => ({
          html_url: "https://github.com/example/compass/issues/42",
          node_id: "issue-node-42",
        }),
      }
    }))
    const fetchMock = vi.mocked(fetch)
    const env = Object.assign(Object.create(null), {
      GITHUB_TOKEN: "token",
      GITHUB_REPO: "example/compass",
    })

    const results = await Promise.all([
      linkFeedbackDeskItemToGithub(actorOne, env, item),
      linkFeedbackDeskItemToGithub(actorTwo, env, item),
    ])

    expect(results.filter((value) => value !== null)).toHaveLength(1)
    expect(fetchMock.mock.calls.filter((call) => {
      const options = call[1]
      return typeof call[0] === "string" && call[0].endsWith("/issues") &&
        typeof options === "object" && options !== null &&
        Reflect.get(options, "method") === "POST"
    })).toHaveLength(1)
    const stored = await actorOne.select().from(feedbackDeskItems)
      .where(eq(feedbackDeskItems.id, "feature-1")).get()
    expect(stored?.githubIssueUrl).toBe("https://github.com/example/compass/issues/42")
    expect(stored?.githubIssueCreationClaimToken).toBeNull()
    sqlite.close()
  })

  it("reclaims an expired claim by recovering the provider issue without a duplicate POST", async () => {
    const sqlite = new Database(":memory:")
    createSchema(sqlite)
    seedFeature(sqlite)
    sqlite.prepare(`
      UPDATE feedback_desk_items
      SET github_issue_creation_claim_token = ?,
          github_issue_creation_claimed_at = ?,
          github_issue_creation_claim_expires_at = ?
      WHERE id = ?
    `).run(
      "orphaned-claim",
      "2026-08-24T17:00:00.000Z",
      "2026-08-24T17:01:00.000Z",
      "feature-1",
    )
    const client = createD1(sqlite)
    // @ts-expect-error The SQLite-backed adapter implements the D1 methods used by this integration test.
    const actor = getDb(client)
    const item = await actor.select().from(feedbackDeskItems)
      .where(eq(feedbackDeskItems.id, "feature-1")).get()
    if (!item) throw new Error("seed row missing")
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        items: [{
          html_url: "https://github.com/example/compass/issues/42",
          node_id: "issue-node-42",
          title: "[Compass feedback] feature · CFD-feature-1",
        }],
      }),
    })
    vi.stubGlobal("fetch", fetchMock)
    const env = Object.assign(Object.create(null), {
      GITHUB_TOKEN: "token",
      GITHUB_REPO: "example/compass",
    })

    const result = await linkFeedbackDeskItemToGithub(actor, env, item)

    expect(result).toBe("https://github.com/example/compass/issues/42")
    expect(fetchMock.mock.calls.filter((call) => {
      const options = call[1]
      return typeof call[0] === "string" && call[0].endsWith("/issues") &&
        typeof options === "object" && options !== null &&
        Reflect.get(options, "method") === "POST"
    })).toHaveLength(0)
    const stored = await actor.select().from(feedbackDeskItems)
      .where(eq(feedbackDeskItems.id, "feature-1")).get()
    expect(stored?.githubIssueUrl).toBe("https://github.com/example/compass/issues/42")
    expect(stored?.githubIssueCreationClaimToken).toBeNull()
    sqlite.close()
  })

  it("fails closed without a provider recovery lookup instead of risking a duplicate POST", async () => {
    const sqlite = new Database(":memory:")
    createSchema(sqlite)
    seedFeature(sqlite)
    const client = createD1(sqlite)
    // @ts-expect-error The SQLite-backed adapter implements the D1 methods used by this integration test.
    const actor = getDb(client)
    const item = await actor.select().from(feedbackDeskItems)
      .where(eq(feedbackDeskItems.id, "feature-1")).get()
    if (!item) throw new Error("seed row missing")
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 503 })
    vi.stubGlobal("fetch", fetchMock)
    const env = Object.assign(Object.create(null), {
      GITHUB_TOKEN: "token",
      GITHUB_REPO: "example/compass",
    })

    const result = await linkFeedbackDeskItemToGithub(actor, env, item)

    expect(result).toBeNull()
    expect(fetchMock.mock.calls).toHaveLength(1)
    expect(fetchMock.mock.calls[0]?.[0]).toContain("/search/issues")
    const stored = await actor.select().from(feedbackDeskItems)
      .where(eq(feedbackDeskItems.id, "feature-1")).get()
    expect(stored?.githubIssueUrl).toBeNull()
    expect(stored?.githubIssueCreationClaimToken).toBeNull()
    sqlite.close()
  })

  it("recovers a provider issue when the process crashes after POST before linking locally", async () => {
    const sqlite = new Database(":memory:")
    createSchema(sqlite)
    seedFeature(sqlite)
    let failWrites = false
    const clientOne = createD1(sqlite, undefined, () => failWrites)
    const clientTwo = createD1(sqlite)
    // @ts-expect-error The SQLite-backed adapter implements the D1 methods used by this integration test.
    const actorOne = getDb(clientOne)
    // @ts-expect-error The SQLite-backed adapter implements the D1 methods used by this integration test.
    const actorTwo = getDb(clientTwo)
    const item = await actorOne.select().from(feedbackDeskItems)
      .where(eq(feedbackDeskItems.id, "feature-1")).get()
    if (!item) throw new Error("seed row missing")
    let providerIssueCreated = false
    const fetchMock = vi.fn().mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes("/search/issues")) {
        return {
          ok: true,
          json: async () => ({
            items: providerIssueCreated
              ? [{
                  html_url: "https://github.com/example/compass/issues/44",
                  node_id: "issue-node-44",
                  title: "[Compass feedback] feature · CFD-feature-1",
                }]
              : [],
          }),
        }
      }
      if (init?.method === "POST") {
        providerIssueCreated = true
        failWrites = true
        return {
          ok: true,
          json: async () => ({
            html_url: "https://github.com/example/compass/issues/44",
            node_id: "issue-node-44",
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

    expect(await linkFeedbackDeskItemToGithub(actorOne, env, item)).toBeNull()
    failWrites = false
    await actorTwo.update(feedbackDeskItems).set({
      githubIssueCreationClaimExpiresAt: "2026-08-24T17:01:00.000Z",
    }).where(eq(feedbackDeskItems.id, "feature-1")).run()
    const retryItem = await actorTwo.select().from(feedbackDeskItems)
      .where(eq(feedbackDeskItems.id, "feature-1")).get()
    if (!retryItem) throw new Error("retry row missing")

    const result = await linkFeedbackDeskItemToGithub(actorTwo, env, retryItem)

    expect(result).toBe("https://github.com/example/compass/issues/44")
    expect(fetchMock.mock.calls.filter((call) => {
      const options = call[1]
      return typeof call[0] === "string" && call[0].endsWith("/issues") &&
        typeof options === "object" && options !== null &&
        Reflect.get(options, "method") === "POST"
    })).toHaveLength(1)
    const stored = await actorTwo.select().from(feedbackDeskItems)
      .where(eq(feedbackDeskItems.id, "feature-1")).get()
    expect(stored?.githubIssueUrl).toBe("https://github.com/example/compass/issues/44")
    expect(stored?.githubIssueCreationClaimToken).toBeNull()
    sqlite.close()
  })

  it("does not let a claimed issue create or link after priority is revoked by another actor", async () => {
    let releaseSearch: () => void = () => undefined
    const searchPaused = new Promise<void>((resolve) => {
      releaseSearch = resolve
    })
    const sqlite = new Database(":memory:")
    createSchema(sqlite)
    seedFeature(sqlite)
    const clientOne = createD1(sqlite)
    const clientTwo = createD1(sqlite)
    // @ts-expect-error The SQLite-backed adapter implements the D1 methods used by this integration test.
    const actorOne = getDb(clientOne)
    // @ts-expect-error The SQLite-backed adapter implements the D1 methods used by this integration test.
    const actorTwo = getDb(clientTwo)
    const item = await actorOne.select().from(feedbackDeskItems)
      .where(eq(feedbackDeskItems.id, "feature-1")).get()
    if (!item) throw new Error("seed row missing")
    const fetchMock = vi.fn().mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? "GET"
      if (url.includes("/search/issues")) {
        await searchPaused
        return {
          ok: true,
          json: async () => ({ items: [] }),
        }
      }
      if (method === "POST") {
        return {
          ok: true,
          json: async () => ({
            html_url: "https://github.com/example/compass/issues/43",
            node_id: "issue-node-43",
          }),
        }
      }
      throw new Error(`unexpected fetch ${method} ${url}`)
    })
    vi.stubGlobal("fetch", fetchMock)
    const env = Object.assign(Object.create(null), {
      GITHUB_TOKEN: "token",
      GITHUB_REPO: "example/compass",
    })

    const linkPromise = linkFeedbackDeskItemToGithub(actorOne, env, item)
    await new Promise<void>((resolve) => setImmediate(resolve))
    await actorTwo.update(feedbackDeskItems).set({
      featurePriorityApprovedAt: null,
      featurePriorityApprovedBy: null,
      githubIssueCreationApprovedAt: null,
      githubIssueCreationApprovedBy: null,
      updatedAt: "2026-08-24T19:00:00.000Z",
    }).where(eq(feedbackDeskItems.id, "feature-1")).run()
    releaseSearch()

    expect(await linkPromise).toBeNull()
    expect(fetchMock.mock.calls.filter((call) => {
      const options = call[1]
      return typeof options === "object" && options !== null &&
        Reflect.get(options, "method") === "POST"
    })).toHaveLength(0)
    const stored = await actorTwo.select().from(feedbackDeskItems)
      .where(eq(feedbackDeskItems.id, "feature-1")).get()
    expect(stored?.githubIssueUrl).toBeNull()
    expect(stored?.featurePriorityApprovedAt).toBeNull()
    expect(stored?.githubIssueCreationClaimToken).toBeNull()
    sqlite.close()
  })

  it("fences the provider request start when revocation wins after the approval read", async () => {
    let releaseApprovalRead: () => void = () => undefined
    const approvalReadPaused = new Promise<void>((resolve) => {
      releaseApprovalRead = resolve
    })
    let pauseApprovalRead = false
    const sqlite = new Database(":memory:")
    createSchema(sqlite)
    seedFeature(sqlite)
    const clientOne = createD1(sqlite, {
      paused: approvalReadPaused,
      shouldPause: () => pauseApprovalRead,
    })
    const clientTwo = createD1(sqlite)
    // @ts-expect-error The SQLite-backed adapter implements the D1 methods used by this integration test.
    const actorOne = getDb(clientOne)
    // @ts-expect-error The SQLite-backed adapter implements the D1 methods used by this integration test.
    const actorTwo = getDb(clientTwo)
    const item = await actorOne.select().from(feedbackDeskItems)
      .where(eq(feedbackDeskItems.id, "feature-1")).get()
    if (!item) throw new Error("seed row missing")
    const fetchMock = vi.fn().mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes("/search/issues")) {
        pauseApprovalRead = true
        return { ok: true, json: async () => ({ items: [] }) }
      }
      if (init?.method === "POST") {
        return {
          ok: true,
          json: async () => ({
            html_url: "https://github.com/example/compass/issues/45",
            node_id: "issue-node-45",
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

    const linkPromise = linkFeedbackDeskItemToGithub(actorOne, env, item)
    await new Promise<void>((resolve) => setImmediate(resolve))
    await actorTwo.update(feedbackDeskItems).set({
      featurePriorityApprovedAt: null,
      featurePriorityApprovedBy: null,
      githubIssueCreationApprovedAt: null,
      githubIssueCreationApprovedBy: null,
      updatedAt: "2026-08-24T19:00:00.000Z",
    }).where(eq(feedbackDeskItems.id, "feature-1")).run()
    releaseApprovalRead()

    expect(await linkPromise).toBeNull()
    expect(fetchMock.mock.calls.filter((call) => {
      const options = call[1]
      return typeof options === "object" && options !== null &&
        Reflect.get(options, "method") === "POST"
    })).toHaveLength(0)
    sqlite.close()
  })

  it("preserves post uncertainty instead of clearing the claim for a duplicate retry", async () => {
    const sqlite = new Database(":memory:")
    createSchema(sqlite)
    seedFeature(sqlite)
    let failLinkWrite = false
    const clientOne = createD1(
      sqlite,
      undefined,
      (query) => failLinkWrite &&
        query?.startsWith('update "feedback_desk_items"') === true &&
        query.includes('set "github_issue_url"') === true,
    )
    const clientTwo = createD1(sqlite)
    // @ts-expect-error The SQLite-backed adapter implements the D1 methods used by this integration test.
    const actorOne = getDb(clientOne)
    // @ts-expect-error The SQLite-backed adapter implements the D1 methods used by this integration test.
    const actorTwo = getDb(clientTwo)
    const item = await actorOne.select().from(feedbackDeskItems)
      .where(eq(feedbackDeskItems.id, "feature-1")).get()
    if (!item) throw new Error("seed row missing")
    failLinkWrite = true
    const fetchMock = vi.fn().mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes("/search/issues")) {
        return { ok: true, json: async () => ({ items: [] }) }
      }
      if (init?.method === "POST") {
        return {
          ok: true,
          json: async () => ({
            html_url: "https://github.com/example/compass/issues/46",
            node_id: "issue-node-46",
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

    expect(await linkFeedbackDeskItemToGithub(actorOne, env, item)).toBeNull()
    failLinkWrite = false
    await actorTwo.update(feedbackDeskItems).set({
      githubIssueCreationClaimExpiresAt: "2026-08-24T17:01:00.000Z",
    }).where(eq(feedbackDeskItems.id, "feature-1")).run()
    const retryItem = await actorTwo.select().from(feedbackDeskItems)
      .where(eq(feedbackDeskItems.id, "feature-1")).get()
    if (!retryItem) throw new Error("retry row missing")

    expect(await linkFeedbackDeskItemToGithub(actorTwo, env, retryItem)).toBeNull()
    expect(fetchMock.mock.calls.filter((call) => {
      const options = call[1]
      return typeof call[0] === "string" && call[0].endsWith("/issues") &&
        typeof options === "object" && options !== null &&
        Reflect.get(options, "method") === "POST"
    })).toHaveLength(1)
    sqlite.close()
  })

  it("rolls back a lifecycle advancement when another database actor revokes priority", async () => {
    let releaseRead: () => void = () => undefined
    const paused = new Promise<void>((resolve) => {
      releaseRead = resolve
    })
    let pauseNextRead = true
    const sqlite = new Database(":memory:")
    createSchema(sqlite)
    seedFeature(sqlite)
    const clientOne = createD1(sqlite, {
      paused,
      shouldPause: () => {
        if (!pauseNextRead) return false
        pauseNextRead = false
        return true
      },
    })
    const clientTwo = createD1(sqlite)
    // @ts-expect-error The SQLite-backed adapter implements the D1 methods used by this integration test.
    const actorOne = getDb(clientOne)
    // @ts-expect-error The SQLite-backed adapter implements the D1 methods used by this integration test.
    const actorTwo = getDb(clientTwo)
    const snapshot = await actorTwo.select().from(feedbackDeskItems)
      .where(eq(feedbackDeskItems.id, "feature-1")).get()
    if (!snapshot) throw new Error("seed row missing")
    const lifecycle = applyFeedbackLifecycleUpdate(actorOne, snapshot, {
      status: "planned",
      actorSource: "compass-admin",
      idempotencyKey: "race-lifecycle-1",
    })

    await new Promise<void>((resolve) => setImmediate(resolve))
    await actorTwo.update(feedbackDeskItems).set({
      featurePriorityApprovedAt: null,
      featurePriorityApprovedBy: null,
      githubIssueCreationApprovedAt: null,
      githubIssueCreationApprovedBy: null,
      updatedAt: "2026-08-24T19:00:00.000Z",
    }).where(eq(feedbackDeskItems.id, "feature-1")).run()
    releaseRead()

    await expect(lifecycle).rejects.toThrow(
      "Feedback request changed before the lifecycle update could be saved",
    )
    const stored = await actorTwo.select().from(feedbackDeskItems)
      .where(eq(feedbackDeskItems.id, "feature-1")).get()
    expect(stored?.status).toBe("triaged")
    expect(stored?.featurePriorityApprovedAt).toBeNull()
    const events = await actorTwo.select().from(jarvisBridgeEvents)
    expect(events).toHaveLength(0)
    sqlite.close()
  })
})
