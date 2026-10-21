import { describe, expect, it, vi } from "vitest"

vi.mock("@/db", () => ({ getDb: vi.fn() }))
vi.mock("@/lib/jarvis/auth", () => ({ getJarvisEnvValue: vi.fn() }))
vi.mock("@/lib/jarvis/feedback-confirmation", () => ({
  confirmedFeedbackReportFromPayload: vi.fn(),
  feedbackCandidateFromReport: vi.fn(),
}))
vi.mock("@/lib/jarvis/feedback-desk", () => ({ enqueueFeedbackDeskItem: vi.fn() }))
vi.mock("@/lib/jarvis/feedback-github", () => ({ linkFeedbackDeskItemToGithub: vi.fn() }))
vi.mock("@/lib/jarvis/feedback-github-sync", () => ({ syncFeedbackDeskItemsFromGithub: vi.fn() }))
vi.mock("@/lib/jarvis/feedback-delivery", () => ({ feedbackDeliveryGraphEvent: vi.fn() }))
vi.mock("@/lib/jarvis/feedback-lifecycle", () => ({
  feedbackIsResolved: vi.fn(),
  feedbackSlaTarget: vi.fn(),
}))

import {
  feedbackDeskItems,
  jarvisBridgeEvents,
} from "@/db/schema-jarvis"
import { organizationMembers, organizations, users } from "@/db/schema"
import { reconcileHistoricalFeedbackOwnership } from "@/lib/jarvis/feedback-maintenance"

type Item = {
  readonly id: string
  readonly organizationId: string
  readonly source: string
  readonly sourceId: string
  readonly reporterEmail: string | null
  readonly metadata: string | null
  readonly createdAt: string
  readonly updatedAt: string
}

type SourceEvent = {
  readonly id: string
  readonly organizationId: string
  readonly feedbackDeskItemId: string
  readonly direction: string
  readonly source: string
  readonly eventType: string
  readonly payload: string
}

type User = {
  readonly id: string
  readonly email: string
  readonly googleEmail: string | null
  readonly isActive: boolean
}

type Membership = {
  readonly organizationId: string
  readonly organizationIsActive: boolean
}

class FakeQuery {
  private table: unknown = null
  private result: readonly unknown[] = []

  public constructor(private readonly db: FakeDb) {}

  public from(table: unknown): FakeQuery {
    this.table = table
    this.result = table === feedbackDeskItems
      ? this.db.items
      : table === jarvisBridgeEvents
        ? this.db.sourceEvents
        : table === users
          ? (this.db.user === null ? [] : [this.db.user])
          : table === organizationMembers
            ? (this.db.membership === null ? [] : [this.db.membership])
            : table === organizations
              ? (this.db.membership === null ? [] : [this.db.membership])
              : []
    return this
  }

  public innerJoin(): FakeQuery {
    return this
  }

  public where(): FakeQuery {
    return this
  }

  public orderBy(): FakeQuery {
    return this
  }

  public limit(): FakeQuery {
    if (this.table === feedbackDeskItems) this.result = this.db.items
    return this
  }

  public async get(): Promise<unknown> {
    return this.result[0]
  }

  public then<TResult1 = readonly unknown[], TResult2 = never>(
    onfulfilled?: ((value: readonly unknown[]) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve(this.result).then(onfulfilled, onrejected)
  }
}

class FakeUpdate {
  private values: Record<string, unknown> = {}

  public constructor(private readonly db: FakeDb) {}

  public set(values: Record<string, unknown>): FakeUpdate {
    this.values = values
    return this
  }

  public where(): FakeUpdate {
    return this
  }

  public async returning(): Promise<readonly { id: string }[]> {
    const item = this.db.items[0]
    if (!item) return []
    const next = {
      ...item,
      reporterEmail: typeof this.values.reporterEmail === "string"
        ? this.values.reporterEmail
        : item.reporterEmail,
      metadata: typeof this.values.metadata === "string"
        ? this.values.metadata
        : item.metadata,
      updatedAt: typeof this.values.updatedAt === "string"
        ? this.values.updatedAt
        : item.updatedAt,
    }
    this.db.items = [next]
    return [{ id: item.id }]
  }
}

class FakeInsert {
  public constructor(private readonly db: FakeDb) {}

  public values(values: Record<string, unknown>): FakeInsert {
    this.db.auditEvents.push(values)
    return this
  }

  public async onConflictDoNothing(): Promise<void> {}
}

class FakeDb {
  public items: readonly Item[] = []
  public sourceEvents: readonly SourceEvent[] = []
  public user: User | null = null
  public membership: Membership | null = null
  public auditEvents: Record<string, unknown>[] = []

  public select(): FakeQuery {
    return new FakeQuery(this)
  }

  public update(): FakeUpdate {
    return new FakeUpdate(this)
  }

  public insert(): FakeInsert {
    return new FakeInsert(this)
  }
}

function createFixture(isActive = true): FakeDb {
  const db = new FakeDb()
  db.items = [{
    id: "item-1",
    organizationId: "org-1",
    source: "ask-jarvis",
    sourceId: "event-1",
    reporterEmail: null,
    metadata: null,
    createdAt: "2026-10-21T00:00:00.000Z",
    updatedAt: "2026-10-21T00:00:00.000Z",
  }]
  db.user = {
    id: "user-1",
    email: "requester@example.com",
    googleEmail: null,
    isActive,
  }
  db.membership = {
    organizationId: "org-1",
    organizationIsActive: true,
  }
  db.sourceEvents = ["event-1", "event-2", "event-3"].map((id) => ({
    id,
    organizationId: "org-1",
    feedbackDeskItemId: "item-1",
    direction: "outbound",
    source: "ask-jarvis",
    eventType: "agent.prompt",
    payload: JSON.stringify({
      user: { id: "user-1", email: "requester@example.com" },
    }),
  }))
  return db
}

describe("Feedback ownership maintenance path", () => {
  it("repairs, audits, and then skips the same item on rerun", async () => {
    const db = createFixture()

    // @ts-expect-error This fixture implements only the DB methods exercised by this maintenance function.
    const firstResult = await reconcileHistoricalFeedbackOwnership(db, "org-1")
    expect(firstResult).toEqual({
      reconciledCount: 1,
      rejectedCount: 0,
      conflictCount: 0,
      skippedCount: 0,
    })
    expect(db.items[0]).toMatchObject({
      reporterEmail: "requester@example.com",
      metadata: JSON.stringify({ externalActorId: "user-1" }),
    })
    expect(db.auditEvents).toHaveLength(1)
    expect(db.auditEvents[0]).toMatchObject({
      source: "feedback-maintenance",
      eventType: "feedback.requester_reconciled",
      payload: JSON.stringify({
        schemaVersion: 1,
        feedbackDeskItemId: "item-1",
        sourceEventCount: 3,
        updatedFields: ["reporterEmail", "metadata.externalActorId"],
      }),
    })
    expect(JSON.stringify(db.auditEvents[0])).not.toContain("requester@example.com")

    // @ts-expect-error This fixture implements only the DB methods exercised by this maintenance function.
    const secondResult = await reconcileHistoricalFeedbackOwnership(db, "org-1")
    expect(secondResult).toEqual({
      reconciledCount: 0,
      rejectedCount: 0,
      conflictCount: 0,
      skippedCount: 1,
    })
    expect(db.auditEvents).toHaveLength(1)
  })

  it("does not mutate or audit an inactive source account", async () => {
    const db = createFixture(false)

    // @ts-expect-error This fixture implements only the DB methods exercised by this maintenance function.
    const result = await reconcileHistoricalFeedbackOwnership(db, "org-1")
    expect(result).toEqual({
      reconciledCount: 0,
      rejectedCount: 1,
      conflictCount: 0,
      skippedCount: 0,
    })
    expect(db.items[0]).toMatchObject({ reporterEmail: null, metadata: null })
    expect(db.auditEvents).toHaveLength(0)
  })
})
