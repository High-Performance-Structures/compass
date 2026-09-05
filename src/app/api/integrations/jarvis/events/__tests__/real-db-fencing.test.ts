import Database from "better-sqlite3"
import { and, eq } from "drizzle-orm"
import { drizzle } from "drizzle-orm/d1"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { feedbackDeskItems, jarvisBridgeEvents } from "@/db/schema-jarvis"

const mocks = vi.hoisted(() => ({
  getCloudflareContext: vi.fn(),
  getDb: vi.fn(),
  getJarvisBridgeSecrets: vi.fn(),
  readBoundedBody: vi.fn(),
  verifyJarvisRequest: vi.fn(),
}))

vi.mock("@/lib/db", () => ({ getCloudflareContext: mocks.getCloudflareContext }))
vi.mock("@/db", () => ({ getDb: mocks.getDb }))
vi.mock("@/lib/jarvis/auth", () => ({
  getJarvisBridgeSecrets: mocks.getJarvisBridgeSecrets,
  getJarvisEnvValue: vi.fn(),
  readBoundedBody: mocks.readBoundedBody,
  verifyJarvisRequest: mocks.verifyJarvisRequest,
}))
vi.mock("@/lib/jarvis/feedback-desk", () => ({
  enqueueFeedbackReceipt: vi.fn(),
}))
vi.mock("@/lib/jarvis/feedback-github", () => ({
  linkFeedbackDeskItemToGithub: vi.fn(),
}))
vi.mock("@/lib/jarvis/visual-context", () => ({
  jarvisPayloadAfterCompletion: vi.fn((payload: string) => payload),
  jarvisPayloadForDelivery: vi.fn((_id: string, payload: string) => JSON.parse(payload)),
}))

import { POST as acknowledge } from "../[id]/ack/route"
import { GET as pullEvents } from "../route"

type Sqlite = InstanceType<typeof Database>

type ReadPause = Readonly<{
  paused: Promise<void>
  signal: () => void
}>

function createD1(sqlite: Sqlite, readPause?: ReadPause): unknown {
  let didPause = false

  async function maybePause(): Promise<void> {
    if (readPause === undefined || didPause) return
    didPause = true
    readPause.signal()
    await readPause.paused
  }

  function statementFor(query: string, values: readonly unknown[] = []): Record<string, unknown> {
    const statement = sqlite.prepare(query)
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
      status TEXT NOT NULL,
      priority TEXT NOT NULL,
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
      status TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      feedback_desk_item_id TEXT,
      payload TEXT NOT NULL,
      result TEXT,
      attempt_count INTEGER NOT NULL,
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

const eventId = "123e4567-e89b-12d3-a456-426614174000"
const itemId = "223e4567-e89b-12d3-a456-426614174000"
const oldClaimToken = "claim-old"
const payload = JSON.stringify({
  schemaVersion: 1,
  feedbackDeskItemId: itemId,
  reference: `CFD-${itemId}`,
  kind: "bug",
})

function seedEvent(sqlite: Sqlite, values: Readonly<{
  status: string
  claimToken: string | null
  claimedAt: string | null
  attemptCount?: number
}>): void {
  sqlite.prepare(`
    INSERT INTO jarvis_bridge_events (
      id, organization_id, direction, source, event_type, status,
      idempotency_key, feedback_desk_item_id, payload, result, attempt_count,
      available_at, claim_token, claimed_at, completed_at, last_error,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    eventId,
    "org-1",
    "outbound",
    "feedback-desk",
    "feedback.delivery_requested",
    values.status,
    "delivery:event-1",
    itemId,
    payload,
    null,
    values.attemptCount ?? 0,
    "2026-09-02T00:00:00.000Z",
    values.claimToken,
    values.claimedAt,
    null,
    null,
    "2026-09-02T00:00:00.000Z",
    "2026-09-02T00:00:00.000Z",
  )
}

function seedCompleteItem(sqlite: Sqlite): void {
  sqlite.prepare(`
    INSERT INTO feedback_desk_items (
      id, organization_id, source, source_id, kind, status, priority,
      title, description, delivery_graph_id, delivery_graph_status,
      delivery_graph_implementation_task_id, delivery_graph_review_task_id,
      delivery_graph_release_task_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    itemId,
    "org-1",
    "feedback-widget",
    "source-1",
    "bug",
    "triaged",
    "normal",
    "redacted",
    "redacted",
    "graph-1",
    "created",
    "implementation-1",
    "review-1",
    "release-1",
    "2026-09-02T00:00:00.000Z",
    "2026-09-02T00:00:00.000Z",
  )
}

function defer(): Readonly<{
  promise: Promise<void>
  resolve: () => void
}> {
  let resolvePromise: () => void = () => undefined
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve
  })
  return { promise, resolve: resolvePromise }
}

function pullRequest(): Request {
  return new Request(
    "https://compass.example/api/integrations/jarvis/events?limit=1&eventType=feedback.delivery_requested",
  )
}

function ackRequest(): Request {
  return new Request(
    `https://compass.example/api/integrations/jarvis/events/${eventId}/ack`,
    {
      method: "POST",
      body: JSON.stringify({ status: "completed", claimToken: oldClaimToken }),
    },
  )
}

describe("Jarvis event claim fencing with a real SQLite/D1 adapter", () => {
  const databases: Sqlite[] = []
  let database: Sqlite
  let dbQueue: unknown[]

  beforeEach(() => {
    database = new Database(":memory:")
    databases.push(database)
    createSchema(database)
    dbQueue = []
    mocks.getCloudflareContext.mockResolvedValue({ env: { DB: {} } })
    mocks.getJarvisBridgeSecrets.mockReturnValue(["secret"])
    mocks.verifyJarvisRequest.mockResolvedValue({ success: true })
    mocks.readBoundedBody.mockImplementation(async (request: Request) => ({
      success: true,
      rawBody: await request.text(),
    }))
    mocks.getDb.mockImplementation(() => dbQueue.shift())
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
    for (const sqlite of databases.splice(0)) sqlite.close()
  })

  it("anchors a lease after a delayed candidate query", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-09-02T00:00:00.000Z"))
    seedEvent(database, { status: "pending", claimToken: null, claimedAt: null })
    const candidateRead = defer()
    const candidateReadStarted = defer()
    const client = createD1(database, {
      paused: candidateRead.promise,
      signal: candidateReadStarted.resolve,
    })
    // @ts-expect-error The SQLite adapter implements the D1 methods exercised here.
    const actor = drizzle(client, { schema: { feedbackDeskItems, jarvisBridgeEvents } })
    dbQueue.push(actor)

    const pullPromise = pullEvents(pullRequest())
    await candidateReadStarted.promise
    vi.advanceTimersByTime(6 * 60 * 1000)
    candidateRead.resolve()
    const response = await pullPromise

    expect(response.status).toBe(200)
    const body = await response.json() as { events: unknown[] }
    expect(body.events).toHaveLength(1)
    const stored = database.prepare(
      "SELECT claimed_at AS claimedAt FROM jarvis_bridge_events WHERE id = ?",
    ).get(eventId) as { claimedAt: string }
    expect(stored.claimedAt).toBe("2026-09-02T00:06:00.000Z")

    dbQueue.push(actor)
    const secondPull = await pullEvents(pullRequest())
    expect(await secondPull.json()).toEqual({ events: [] })
  })

  it("allows only one of two workers to claim the same row", async () => {
    seedEvent(database, { status: "pending", claimToken: null, claimedAt: null })
    const firstCandidateRead = defer()
    const firstCandidateReadStarted = defer()
    const clientOne = createD1(database, {
      paused: firstCandidateRead.promise,
      signal: firstCandidateReadStarted.resolve,
    })
    const clientTwo = createD1(database)
    // @ts-expect-error The SQLite adapter implements the D1 methods exercised here.
    const actorOne = drizzle(clientOne, { schema: { feedbackDeskItems, jarvisBridgeEvents } })
    // @ts-expect-error The SQLite adapter implements the D1 methods exercised here.
    const actorTwo = drizzle(clientTwo, { schema: { feedbackDeskItems, jarvisBridgeEvents } })
    dbQueue.push(actorOne)

    const firstPull = pullEvents(pullRequest())
    await firstCandidateReadStarted.promise
    dbQueue.push(actorTwo)
    const secondResponse = await pullEvents(pullRequest())
    firstCandidateRead.resolve()
    const firstResponse = await firstPull

    const secondBody = await secondResponse.json() as { events: Array<{ claimToken: string }> }
    const firstBody = await firstResponse.json() as { events: unknown[] }
    expect(secondBody.events).toHaveLength(1)
    expect(firstBody.events).toEqual([])
    const stored = database.prepare(
      "SELECT status, claim_token AS claimToken, attempt_count AS attemptCount FROM jarvis_bridge_events WHERE id = ?",
    ).get(eventId) as { status: string; claimToken: string; attemptCount: number }
    expect(stored.status).toBe("processing")
    expect(stored.claimToken).toBe(secondBody.events[0]?.claimToken)
    expect(stored.attemptCount).toBe(1)
  })

  it("rejects an acknowledgement after a real claim rotation", async () => {
    seedCompleteItem(database)
    seedEvent(database, {
      status: "processing",
      claimToken: oldClaimToken,
      claimedAt: "2026-09-02T00:00:00.000Z",
      attemptCount: 1,
    })
    const existingRead = defer()
    const existingReadStarted = defer()
    const clientOne = createD1(database, {
      paused: existingRead.promise,
      signal: existingReadStarted.resolve,
    })
    const clientTwo = createD1(database)
    // @ts-expect-error The SQLite adapter implements the D1 methods exercised here.
    const actorOne = drizzle(clientOne, { schema: { feedbackDeskItems, jarvisBridgeEvents } })
    // @ts-expect-error The SQLite adapter implements the D1 methods exercised here.
    const actorTwo = drizzle(clientTwo, { schema: { feedbackDeskItems, jarvisBridgeEvents } })
    dbQueue.push(actorOne)

    const acknowledgement = acknowledge(ackRequest(), {
      params: Promise.resolve({ id: eventId }),
    })
    await existingReadStarted.promise
    await actorTwo.update(jarvisBridgeEvents).set({
      claimToken: "claim-new",
      claimedAt: "2026-09-02T00:01:00.000Z",
    }).where(and(
      eq(jarvisBridgeEvents.id, eventId),
      eq(jarvisBridgeEvents.status, "processing"),
      eq(jarvisBridgeEvents.claimToken, oldClaimToken),
    ))
    existingRead.resolve()

    const response = await acknowledgement
    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error: "Event claim is no longer active",
    })
    const stored = database.prepare(
      "SELECT status, claim_token AS claimToken FROM jarvis_bridge_events WHERE id = ?",
    ).get(eventId) as { status: string; claimToken: string }
    expect(stored.status).toBe("processing")
    expect(stored.claimToken).toBe("claim-new")
  })
})
