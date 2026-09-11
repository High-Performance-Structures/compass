import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/d1"
import { eq } from "drizzle-orm"

import { projectMembers, projectOperations } from "@/db/schema"

const mocks = vi.hoisted(() => ({
  assertProjectAccess: vi.fn(),
  getCloudflareContext: vi.fn(),
  getDb: vi.fn(),
  getProjectAudienceViewerContact: vi.fn(),
  notifyPurchaseOrderVendorUpdate: vi.fn(),
  notifyRfiCreated: vi.fn(),
  notifyRfqResponseReceived: vi.fn(),
  requireAuth: vi.fn(),
  revalidatePath: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({ requireAuth: mocks.requireAuth }))
vi.mock("@/lib/db", () => ({ getCloudflareContext: mocks.getCloudflareContext }))
vi.mock("@/db", () => ({ getDb: mocks.getDb }))
vi.mock("@/lib/project-access", () => ({
  assertProjectAccess: mocks.assertProjectAccess,
}))
vi.mock("@/lib/project-audience-viewer-contact", () => ({
  getProjectAudienceViewerContact: mocks.getProjectAudienceViewerContact,
}))
vi.mock("@/lib/notifications/events", () => ({
  notifyPurchaseOrderVendorUpdate: mocks.notifyPurchaseOrderVendorUpdate,
  notifyRfiCreated: mocks.notifyRfiCreated,
  notifyRfqResponseReceived: mocks.notifyRfqResponseReceived,
}))
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }))

import { respondToSubVendorPurchaseOrder } from "@/app/actions/project-audience-sub-vendor"

type Sqlite = InstanceType<typeof Database>

type PauseAfterQuery = Readonly<{
  paused: Promise<void>
  shouldPause: (query: string) => boolean
  signal: () => void
}>

function createD1(sqlite: Sqlite, pauseAfterQuery: PauseAfterQuery): unknown {
  function statementFor(
    query: string,
    values: readonly unknown[] = []
  ): Record<string, unknown> {
    const statement = sqlite.prepare(query)
    const maybePause = async (): Promise<void> => {
      if (!pauseAfterQuery.shouldPause(query)) return
      pauseAfterQuery.signal()
      await pauseAfterQuery.paused
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
    async batch(): Promise<readonly unknown[]> {
      throw new Error("Unexpected batch")
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
    CREATE TABLE project_members (
      id TEXT PRIMARY KEY NOT NULL,
      project_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL
    );

    CREATE TABLE project_operations (
      id TEXT PRIMARY KEY NOT NULL,
      project_id TEXT NOT NULL,
      source_record_type TEXT NOT NULL,
      source_record_number TEXT,
      title TEXT NOT NULL,
      status TEXT NOT NULL,
      assignee_name TEXT,
      company_name TEXT,
      sage_vendor_name TEXT,
      sage_payload_json TEXT,
      revision INTEGER NOT NULL DEFAULT 0,
      purchase_order_email_claim_token TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TRIGGER project_operations_revision_after_update
    AFTER UPDATE ON project_operations
    FOR EACH ROW
    WHEN NEW.revision = OLD.revision
    BEGIN
      UPDATE project_operations
      SET revision = OLD.revision + 1
      WHERE id = OLD.id;
    END;
  `)
}

const FIXED_NOW = "2026-09-10T20:00:00.000Z"

describe("sub/vendor purchase-order response claim fence", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(FIXED_NOW))
    vi.clearAllMocks()
    mocks.requireAuth.mockResolvedValue({
      id: "supplier-1",
      role: "supplier",
      isActive: true,
      email: "supplier@example.com",
      displayName: "Supplier User",
    })
    mocks.getCloudflareContext.mockResolvedValue({ env: { DB: {} } })
    mocks.assertProjectAccess.mockResolvedValue({
      id: "project-1",
      organizationId: "org-1",
      projectNumber: "N-001",
    })
    mocks.getProjectAudienceViewerContact.mockResolvedValue({
      id: "contact-1",
      contactType: "supplier",
      displayName: "Supplier User",
      companyName: "Vendor",
      email: "supplier@example.com",
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("rejects a supplier status response when an email claim wins after the read", async () => {
    let releaseRead: () => void = () => undefined
    const readPaused = new Promise<void>((resolve) => {
      releaseRead = resolve
    })
    let signalRead: () => void = () => undefined
    const readReached = new Promise<void>((resolve) => {
      signalRead = resolve
    })
    let signaled = false
    const sqlite = new Database(":memory:")
    createSchema(sqlite)
    sqlite
      .prepare(
        "INSERT INTO project_members (id, project_id, user_id, role) VALUES (?, ?, ?, ?)"
      )
      .run("membership-1", "project-1", "supplier-1", "supplier")
    sqlite
      .prepare(`
        INSERT INTO project_operations (
          id, project_id, source_record_type, source_record_number, title, status,
          company_name, sage_payload_json, revision, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        "po-1",
        "project-1",
        "purchase_order",
        "N-001-PO-001",
        "Airlite order",
        "sent",
        "Vendor",
        JSON.stringify({ recipientEmails: ["supplier@example.com"] }),
        0,
        FIXED_NOW
      )
    const db = drizzle(
      // @ts-expect-error The SQLite adapter implements the D1 methods exercised here.
      createD1(sqlite, {
        paused: readPaused,
        shouldPause: (query) =>
          query.startsWith("select") && query.includes('from "project_operations"'),
        signal: () => {
          if (signaled) return
          signaled = true
          signalRead()
        },
      }),
      { schema: { projectMembers, projectOperations } }
    )
    mocks.getDb.mockReturnValue(db)

    const responseAttempt = respondToSubVendorPurchaseOrder("project-1", "po-1", {
      decision: "status",
      status: "processing",
      note: "Preparing shipment",
    })
    await readReached

    sqlite
      .prepare(`
        UPDATE project_operations
        SET purchase_order_email_claim_token = ?, revision = revision + 1, updated_at = ?
        WHERE id = ?
      `)
      .run("email-claim-1", FIXED_NOW, "po-1")
    releaseRead()

    await expect(responseAttempt).resolves.toEqual({
      success: false,
      error: "The purchase order changed. Refresh the page before responding.",
    })
    const storedOrder = await db
      .select({
        revision: projectOperations.revision,
        claimToken: projectOperations.purchaseOrderEmailClaimToken,
        payload: projectOperations.sagePayloadJson,
      })
      .from(projectOperations)
      .where(eq(projectOperations.id, "po-1"))
      .get()
    expect(storedOrder?.revision).toBe(1)
    expect(storedOrder?.claimToken).toBe("email-claim-1")
    expect(storedOrder?.payload).toBe(
      JSON.stringify({ recipientEmails: ["supplier@example.com"] })
    )
    expect(mocks.notifyPurchaseOrderVendorUpdate).not.toHaveBeenCalled()
    sqlite.close()
  })
})
