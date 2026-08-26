import { describe, expect, it, vi } from "vitest"
import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"

vi.mock("@/lib/notifications/events", () => ({
  createStrictSystemNotificationEvent: async () => {},
}))

function database(
  shared: { claimCount: number },
  options: Readonly<{ lostClaimOn: "finalize" | "retry" | null }> = {
    lostClaimOn: null,
  },
) {
  const selectGet = vi.fn()
    .mockResolvedValueOnce({
      id: "notification-event-1",
      status: "pending",
      feedbackDeskItemId: "feedback-1",
      payload: JSON.stringify({
        schemaVersion: 1,
        feedbackDeskItemId: "feedback-1",
        reference: "CFD-feedback-1",
        kind: "bug",
        status: "triaged",
        notificationKind: "status_changed",
      }),
    })
    .mockResolvedValueOnce({
      id: "feedback-1",
      organizationId: "org-1",
      kind: "bug",
      title: "Private title",
      status: "triaged",
      reporterEmail: "person@example.com",
      metadata: null,
    })
    .mockResolvedValueOnce([{ userId: "user-1", email: "person@example.com" }])
  const selectChain = {
    from: vi.fn(),
    innerJoin: vi.fn(),
    where: vi.fn(),
    get: selectGet,
    all: vi.fn().mockImplementation(() => selectGet()),
  }
  selectChain.from.mockReturnValue(selectChain)
  selectChain.innerJoin.mockReturnValue(selectChain)
  selectChain.where.mockReturnValue(selectChain)
  const claimResult = vi.fn().mockImplementation(() => {
    shared.claimCount += 1
    return shared.claimCount === 1
      ? { id: "notification-event-1" }
      : undefined
  })
  let updateCallCount = 0
  const updateWhere = vi.fn().mockImplementation(() => {
    updateCallCount += 1
    if (updateCallCount === 1) {
      return {
        returning: vi.fn().mockReturnValue({ get: claimResult }),
      }
    }
    const lostClaim = updateCallCount === 2 && options.lostClaimOn !== null
    return {
      returning: vi.fn().mockReturnValue({
        get: vi.fn().mockReturnValue(
          lostClaim ? undefined : { id: "notification-event-1" },
        ),
      }),
    }
  })
  const updateSet = vi.fn().mockReturnValue({ where: updateWhere })
  const update = vi.fn().mockReturnValue({ set: updateSet })
  return {
    db: {
      select: vi.fn().mockReturnValue(selectChain),
      update,
    },
    updateSet,
  }
}

function realSqliteDatabase() {
  const sqlite = new Database(":memory:")
  sqlite.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY NOT NULL,
      email TEXT NOT NULL,
      google_email TEXT,
      is_active INTEGER NOT NULL
    );
    CREATE TABLE organization_members (
      organization_id TEXT NOT NULL,
      user_id TEXT NOT NULL
    );
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
      idempotency_key TEXT NOT NULL UNIQUE,
      payload TEXT NOT NULL,
      result TEXT,
      attempt_count INTEGER NOT NULL,
      available_at TEXT NOT NULL,
      claim_token TEXT,
      claimed_at TEXT,
      feedback_desk_item_id TEXT,
      completed_at TEXT,
      last_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `)
  sqlite.prepare(
    "INSERT INTO users (id, email, google_email, is_active) VALUES (?, ?, ?, ?)",
  ).run("user-1", "person@example.com", null, 1)
  sqlite.prepare(
    "INSERT INTO organization_members (organization_id, user_id) VALUES (?, ?)",
  ).run("org-1", "user-1")
  sqlite.prepare(`
    INSERT INTO feedback_desk_items (
      id, organization_id, source, source_id, kind, status, priority,
      title, description, reporter_email, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    "feedback-1", "org-1", "feedback-widget", "source-1", "bug", "triaged",
    "normal", "Private title", "Private description", "person@example.com",
    "2026-08-22T03:00:00.000Z", "2026-08-22T03:00:00.000Z",
  )
  sqlite.prepare(`
    INSERT INTO jarvis_bridge_events (
      id, organization_id, direction, source, event_type, status,
      idempotency_key, payload, attempt_count, available_at, feedback_desk_item_id,
      created_at, updated_at
    ) VALUES (?, ?, 'outbound', 'feedback-desk', 'feedback.requester_notification',
      'pending', ?, ?, 0, ?, ?, ?, ?)
  `).run(
    "notification-event-1",
    "org-1",
    "feedback-requester-notification:bridge-retry-1",
    JSON.stringify({
      schemaVersion: 1,
      feedbackDeskItemId: "feedback-1",
      reference: "CFD-feedback-1",
      kind: "bug",
      status: "triaged",
      notificationKind: "status_changed",
    }),
    "2026-08-22T03:00:00.000Z",
    "feedback-1",
    "2026-08-22T03:00:00.000Z",
    "2026-08-22T03:00:00.000Z",
  )
  return { sqlite, db: drizzle(sqlite) }
}

describe("Feedback Desk requester notification outbox", () => {
  it("lets only one concurrent retry claim the notification event", async () => {
    const shared = { claimCount: 0 }
    const first = database(shared)
    const second = database(shared)
    let notificationCallCount = 0
    const persistNotification = async (
      input: Readonly<Record<string, unknown>>,
      ownership?: Readonly<Record<string, unknown>>,
    ) => {
      notificationCallCount += 1
      expect(input.idempotencyKey).toBe("notification-event-1")
      expect(ownership).toEqual(expect.objectContaining({
        eventId: "notification-event-1",
        claimToken: expect.any(String),
        reservationResult: null,
      }))
    }

    const { processFeedbackRequesterNotification } = await import(
      "@/lib/jarvis/feedback-status-update"
    )
    const results = await Promise.allSettled([
      processFeedbackRequesterNotification(first.db as never, {
        id: "status-event-1",
        idempotencyKey: "bridge-retry-1",
        feedbackDeskItemId: "feedback-1",
      }, persistNotification),
      processFeedbackRequesterNotification(second.db as never, {
        id: "status-event-1",
        idempotencyKey: "bridge-retry-1",
        feedbackDeskItemId: "feedback-1",
      }, persistNotification),
    ])

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1)
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1)
    expect(notificationCallCount).toBe(1)
    expect(first.updateSet).toHaveBeenCalledWith(expect.objectContaining({
      status: "completed",
    }))
  })

  it("leaves notification work pending when persistence fails", async () => {
    const fixture = database({ claimCount: 0 })
    const persistNotification = async () => {
      throw new Error("D1 unavailable")
    }

    const { processFeedbackRequesterNotification } = await import(
      "@/lib/jarvis/feedback-status-update"
    )
    await expect(processFeedbackRequesterNotification(fixture.db as never, {
      id: "status-event-1",
      idempotencyKey: "bridge-retry-1",
      feedbackDeskItemId: "feedback-1",
    }, persistNotification)).rejects.toThrow("D1 unavailable")

    expect(fixture.updateSet).toHaveBeenCalledWith(expect.objectContaining({
      status: "pending",
      lastError: "D1 unavailable",
      completedAt: null,
    }))
  })

  it("does not finalize after a stale worker loses its claim", async () => {
    const fixture = database(
      { claimCount: 0 },
      { lostClaimOn: "finalize" },
    )

    const { processFeedbackRequesterNotification } = await import(
      "@/lib/jarvis/feedback-status-update"
    )
    await expect(processFeedbackRequesterNotification(fixture.db as never, {
      id: "status-event-1",
      idempotencyKey: "bridge-retry-1",
      feedbackDeskItemId: "feedback-1",
    })).resolves.toEqual({
      queued: true,
      claimed: false,
      notifiedUserCount: 0,
    })
  })

  it("does not reset a replacement claim when persistence fails", async () => {
    const fixture = database(
      { claimCount: 0 },
      { lostClaimOn: "retry" },
    )
    const persistNotification = async () => {
      throw new Error("D1 unavailable")
    }

    const { processFeedbackRequesterNotification } = await import(
      "@/lib/jarvis/feedback-status-update"
    )
    await expect(processFeedbackRequesterNotification(fixture.db as never, {
      id: "status-event-1",
      idempotencyKey: "bridge-retry-1",
      feedbackDeskItemId: "feedback-1",
    }, persistNotification)).resolves.toEqual({
      queued: true,
      claimed: false,
      notifiedUserCount: 0,
    })
  })

  it("persists one requester outbox result across a real SQLite replay", async () => {
    const fixture = realSqliteDatabase()
    let sendCount = 0
    const persistNotification = async () => {
      sendCount += 1
    }

    try {
      const { processFeedbackRequesterNotification } = await import(
        "@/lib/jarvis/feedback-status-update"
      )
      const sourceEvent = {
        id: "status-event-1",
        idempotencyKey: "bridge-retry-1",
        feedbackDeskItemId: "feedback-1",
      }

      await expect(processFeedbackRequesterNotification(
        fixture.db as never,
        sourceEvent,
        persistNotification,
      )).resolves.toEqual({
        queued: true,
        claimed: true,
        notifiedUserCount: 1,
      })
      await expect(processFeedbackRequesterNotification(
        fixture.db as never,
        sourceEvent,
        persistNotification,
      )).resolves.toEqual({
        queued: true,
        claimed: false,
        notifiedUserCount: 0,
      })

      expect(sendCount).toBe(1)
      expect(fixture.sqlite.prepare(
        "SELECT status, attempt_count FROM jarvis_bridge_events WHERE id = ?",
      ).get("notification-event-1")).toEqual({
        status: "completed",
        attempt_count: 1,
      })
    } finally {
      fixture.sqlite.close()
    }
  })
})
