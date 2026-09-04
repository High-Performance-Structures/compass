import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/d1"
import { eq } from "drizzle-orm"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  organizations,
  projectOperations,
  projectPurchaseOrderLines,
  projects,
} from "@/db/schema"
import { nuTechOrderItems, nuTechOrderWorkflows } from "@/db/schema-nutech"

const mocks = vi.hoisted(() => ({
  getCloudflareContext: vi.fn(),
  getDb: vi.fn(),
  fetch: vi.fn(),
  isInternalStaffRole: vi.fn(),
  requireAuth: vi.fn(),
  requireFeaturePermission: vi.fn(),
  canFeature: vi.fn(),
  requireOrg: vi.fn(),
  revalidatePath: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({ requireAuth: mocks.requireAuth }))
vi.mock("@/lib/db", () => ({ getCloudflareContext: mocks.getCloudflareContext }))
vi.mock("@/db", () => ({ getDb: mocks.getDb }))
vi.mock("@/lib/demo", () => ({ isDemoUser: vi.fn(() => false) }))
vi.mock("@/lib/org-scope", () => ({ requireOrg: mocks.requireOrg }))
vi.mock("@/lib/permission-enforcement", () => ({
  requireFeaturePermission: mocks.requireFeaturePermission,
  canFeature: mocks.canFeature,
}))
vi.mock("@/lib/user-roles", () => ({
  isInternalStaffRole: mocks.isInternalStaffRole,
}))
vi.mock("server-only", () => ({}))
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }))

import {
  deletePurchaseOrderRequest,
  getProjectOperationsSummary,
  getProjectPurchaseOrders,
  getProjectSageSyncQueue,
  queueProjectOperationForSageSync,
  queueProjectOperationsForSageSync,
  sendPurchaseOrderEmail,
  updatePurchaseOrderRequest,
} from "@/app/actions/project-operations"
import {
  getNuTechOrderDashboard,
  getProjectNuTechOrderWorkspace,
  releaseNuTechAirlitePurchaseOrder,
} from "@/app/actions/nutech-orders"
import {
  deleteNuTechOrderItem,
  generateNuTechAirliteWorkbook,
  saveNuTechOrderItem,
} from "@/app/actions/nutech-order-items"

type Sqlite = InstanceType<typeof Database>

type PauseAfterQuery = Readonly<{
  paused: Promise<void>
  shouldPause: (query: string) => boolean
  signal: () => void
}>

type D1BatchStatement = Readonly<{
  run: (skipPause?: boolean) => Promise<unknown>
}>

type PauseBeforeBatch = Readonly<{
  paused: Promise<void>
  signal: () => void
}>

function createD1(
  sqlite: Sqlite,
  pauseAfterQuery?: PauseAfterQuery,
  pauseBeforeBatch?: PauseBeforeBatch
): unknown {
  function statementFor(
    query: string,
    values: readonly unknown[] = []
  ): Record<string, unknown> {
    const statement = sqlite.prepare(query)
    const maybePause = async (): Promise<void> => {
      if (!pauseAfterQuery?.shouldPause(query)) return
      pauseAfterQuery.signal()
      await pauseAfterQuery.paused
    }

    return {
      bind: (...nextValues: unknown[]): unknown => statementFor(query, nextValues),
      run: async (skipPause = false): Promise<unknown> => {
        const info = statement.run(...values)
        if (!skipPause) await maybePause()
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
    async batch(statements: readonly D1BatchStatement[]): Promise<readonly unknown[]> {
      if (pauseBeforeBatch) {
        pauseBeforeBatch.signal()
        await pauseBeforeBatch.paused
      }
      sqlite.exec("BEGIN IMMEDIATE")
      try {
        const results: unknown[] = []
        for (const statement of statements) {
          results.push(await statement.run(true))
        }
        sqlite.exec("COMMIT")
        return results
      } catch (error) {
        sqlite.exec("ROLLBACK")
        throw error
      }
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
    CREATE TABLE organizations (
      id TEXT PRIMARY KEY NOT NULL,
      type TEXT NOT NULL,
      is_active INTEGER NOT NULL
    );

    CREATE TABLE projects (
      id TEXT PRIMARY KEY NOT NULL,
      organization_id TEXT NOT NULL,
      name TEXT,
      project_number TEXT,
      client_name TEXT,
      address TEXT
    );

    CREATE TABLE project_operations (
      id TEXT PRIMARY KEY NOT NULL,
      project_id TEXT NOT NULL,
      source_system TEXT NOT NULL DEFAULT 'sage',
      source_record_type TEXT NOT NULL,
      source_record_id TEXT,
      source_record_number TEXT,
      title TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'open',
      priority TEXT NOT NULL DEFAULT 'normal',
      assignee_type TEXT,
      assignee_name TEXT,
      site_contact_phone TEXT,
      company_name TEXT,
      cost_code TEXT,
      start_date TEXT,
      due_date TEXT,
      amount REAL,
      external_url TEXT,
      sage_job_id TEXT,
      sage_job_number TEXT,
      sage_vendor_id TEXT,
      sage_vendor_name TEXT,
      sage_phase_code TEXT,
      sage_cost_code TEXT,
      sage_tax_group TEXT,
      sage_ship_to TEXT,
      sage_order_date TEXT,
      sage_required_date TEXT,
      sage_write_status TEXT NOT NULL DEFAULT 'not_ready',
      sage_payload_json TEXT,
      sync_direction TEXT NOT NULL DEFAULT 'read',
      sync_status TEXT NOT NULL DEFAULT 'synced',
      last_synced_at TEXT,
      revision INTEGER NOT NULL DEFAULT 0,
      purchase_order_email_claim_token TEXT,
      purchase_order_email_claim_revision INTEGER,
      purchase_order_email_claim_fingerprint TEXT,
      purchase_order_email_claim_status TEXT,
      purchase_order_email_claim_attempt INTEGER,
      purchase_order_email_provider_message_id TEXT,
      purchase_order_email_claim_error TEXT,
      purchase_order_email_claim_reclaim_after TEXT,
      purchase_order_email_claim_retry_until TEXT,
      purchase_order_email_claim_provider_payload TEXT,
      purchase_order_email_claim_provider_credential_fingerprint TEXT,
      created_at TEXT NOT NULL,
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

    CREATE TABLE project_purchase_order_lines (
      id TEXT PRIMARY KEY NOT NULL,
      operation_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      source_system TEXT NOT NULL DEFAULT 'compass',
      source_record_id TEXT,
      line_number INTEGER NOT NULL DEFAULT 1,
      cost_code TEXT,
      phase_code TEXT,
      description TEXT NOT NULL,
      quantity REAL NOT NULL DEFAULT 1,
      unit_cost REAL NOT NULL DEFAULT 0,
      unit TEXT,
      amount REAL NOT NULL DEFAULT 0,
      tax_group TEXT,
      sage_payload_json TEXT,
      sync_status TEXT NOT NULL DEFAULT 'pending_sage',
      last_synced_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE nutech_order_workflows (
      id TEXT PRIMARY KEY NOT NULL,
      project_id TEXT NOT NULL,
      catalog_version_id TEXT,
      customer_type TEXT NOT NULL,
      pricing_mode TEXT NOT NULL,
      quantity_source TEXT NOT NULL,
      takeoff_acknowledgement_status TEXT NOT NULL,
      scope_type TEXT NOT NULL,
      block_quantity_notes TEXT,
      bracing_included INTEGER NOT NULL,
      bracing_rental_start_date TEXT,
      bracing_rental_end_date TEXT,
      bracing_notes TEXT,
      delivery_method TEXT NOT NULL,
      requested_delivery_date TEXT,
      airlite_purchase_order_operation_id TEXT,
      order_status TEXT NOT NULL,
      vendor_confirmation_number TEXT,
      airlite_workbook_id TEXT,
      airlite_workbook_url TEXT,
      airlite_workbook_status TEXT NOT NULL,
      airlite_workbook_generated_at TEXT,
      airlite_workbook_generated_by TEXT,
      purchase_order_released_at TEXT,
      purchase_order_released_by TEXT,
      vendor_invoice_number TEXT,
      vendor_invoice_status TEXT NOT NULL,
      vendor_invoice_received_at TEXT,
      vendor_invoice_released_at TEXT,
      vendor_invoice_released_by TEXT,
      notes TEXT,
      created_by TEXT,
      updated_by TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE nutech_order_items (
      id TEXT PRIMARY KEY NOT NULL,
      workflow_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      catalog_version_id TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      manufacturer_sku_snapshot TEXT NOT NULL,
      product_name_snapshot TEXT NOT NULL,
      price_unit_snapshot TEXT NOT NULL,
      unit_cost_cents INTEGER NOT NULL,
      unit_price_cents INTEGER NOT NULL,
      sort_order INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `)
}

function seedDraft(sqlite: Sqlite, now: string): void {
  sqlite
    .prepare("INSERT INTO organizations (id, type, is_active) VALUES (?, ?, ?)")
    .run("org-1", "internal", 1)
  sqlite.prepare(
    "INSERT INTO projects (id, organization_id, name, project_number, address) VALUES (?, ?, ?, ?, ?)"
  ).run("project-1", "org-1", "Test Project", "N-001", "123 Main St")
  sqlite.prepare(`
    INSERT INTO project_operations (
      id, project_id, source_system, source_record_type, source_record_number,
      title, description, status, priority, company_name, amount,
      sage_write_status, sage_payload_json, sync_direction, sync_status,
      revision, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    "po-1",
    "project-1",
    "compass",
    "purchase_order",
    "PRJ-PO-001",
    "Original draft",
    "Original scope",
    "draft",
    "normal",
    "Vendor",
    10,
    "draft_ready",
    JSON.stringify({ source: "compass_po_request", header: {}, lines: [] }),
    "write",
    "pending_sage",
    0,
    now,
    now
  )
  sqlite.prepare(`
    INSERT INTO project_purchase_order_lines (
      id, operation_id, project_id, line_number, description, quantity,
      unit_cost, amount, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run("line-1", "po-1", "project-1", 1, "Original line", 1, 10, 10, now, now)
}

function seedNuTechWorkflow(sqlite: Sqlite, now: string): void {
  sqlite.prepare(`
    INSERT INTO nutech_order_workflows (
      id, project_id, customer_type, pricing_mode, quantity_source,
      takeoff_acknowledgement_status, scope_type, bracing_included,
      delivery_method, airlite_purchase_order_operation_id, order_status,
      airlite_workbook_status, vendor_invoice_status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    "workflow-1",
    "project-1",
    "new",
    "standard",
    "customer_provided",
    "not_required",
    "block_sale",
    0,
    "delivery",
    "po-1",
    "customer_approved",
    "generated",
    "not_received",
    now,
    now
  )
  sqlite.prepare(`
    INSERT INTO nutech_order_items (
      id, workflow_id, product_id, catalog_version_id, quantity,
      manufacturer_sku_snapshot, product_name_snapshot, price_unit_snapshot,
      unit_cost_cents, unit_price_cents, sort_order, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    "nutech-item-1",
    "workflow-1",
    "product-1",
    "catalog-1",
    1,
    "SKU-1",
    "Block",
    "each",
    100,
    120,
    0,
    now,
    now
  )
}

const FIXED_NOW = "2026-08-25T05:00:00.000Z"
const COMMON_INPUT = {
  description: "Updated scope",
  companyName: "Vendor",
  sageVendorId: null,
  assigneeName: null,
  siteContactPhone: null,
  shipTo: null,
  orderDate: "2026-08-25",
  dueDate: null,
  priority: "normal",
  expectedRevision: 0,
} as const

describe("purchase-order replacement compare-and-swap", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(FIXED_NOW))
    vi.clearAllMocks()
    mocks.requireAuth.mockResolvedValue({
      id: "staff-1",
      role: "project_manager",
      isActive: true,
    })
    mocks.isInternalStaffRole.mockReturnValue(true)
    mocks.requireFeaturePermission.mockResolvedValue(undefined)
    mocks.requireOrg.mockReturnValue("org-1")
    mocks.getCloudflareContext.mockResolvedValue({ env: { DB: {} } })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("rejects a same-millisecond stale writer after a newer writer removes the final line", async () => {
    let releaseStaleRead: () => void = () => undefined
    const staleReadPaused = new Promise<void>((resolve) => {
      releaseStaleRead = resolve
    })
    let signalStaleRead: () => void = () => undefined
    const staleReadCompleted = new Promise<void>((resolve) => {
      signalStaleRead = resolve
    })
    let staleReadSignaled = false
    const sqlite = new Database(":memory:")
    createSchema(sqlite)
    seedDraft(sqlite, FIXED_NOW)

    const clientOne = createD1(sqlite, {
      paused: staleReadPaused,
      shouldPause: (query) =>
        query.startsWith("select") && query.includes('from "project_operations"'),
      signal: () => {
        if (staleReadSignaled) return
        staleReadSignaled = true
        signalStaleRead()
      },
    })
    const clientTwo = createD1(sqlite)
    // @ts-expect-error The SQLite adapter implements the D1 methods exercised here.
    const actorOne = drizzle(clientOne, {
      schema: { projectOperations, projectPurchaseOrderLines, projects },
    })
    // @ts-expect-error The SQLite adapter implements the D1 methods exercised here.
    const actorTwo = drizzle(clientTwo, {
      schema: { projectOperations, projectPurchaseOrderLines, projects },
    })
    mocks.getDb.mockReturnValueOnce(actorOne).mockReturnValueOnce(actorTwo)

    const staleWriter = updatePurchaseOrderRequest("project-1", "po-1", {
      ...COMMON_INPUT,
      title: "Stale replacement",
      lines: [
        {
          description: "Stale line",
          costCode: "03100",
          phaseCode: "03",
          quantity: 1,
          unitCost: 99,
          unit: "EA",
          amount: 99,
          taxGroup: null,
        },
      ],
    })
    await staleReadCompleted

    const newerResult = await updatePurchaseOrderRequest("project-1", "po-1", {
      ...COMMON_INPUT,
      title: "Newer empty draft",
      lines: [],
    })
    expect(newerResult).toEqual({ success: true, id: "po-1" })

    releaseStaleRead()
    expect(await staleWriter).toEqual({
      success: false,
      error: "This purchase order changed after you opened it. Refresh and try again.",
    })

    const storedOrder = await actorTwo
      .select()
      .from(projectOperations)
      .where(eq(projectOperations.id, "po-1"))
      .get()
    const storedLines = await actorTwo
      .select()
      .from(projectPurchaseOrderLines)
      .where(eq(projectPurchaseOrderLines.operationId, "po-1"))
      .all()

    expect(storedOrder?.title).toBe("Newer empty draft")
    expect(storedOrder?.amount).toBe(0)
    expect(storedOrder?.revision).toBe(1)
    expect(storedOrder?.updatedAt).toBe(FIXED_NOW)
    expect(storedLines).toEqual([])
    sqlite.close()
  })
})

describe("purchase-order action authorization boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireAuth.mockResolvedValue({
      id: "supplier-1",
      role: "supplier",
      isActive: true,
    })
    mocks.isInternalStaffRole.mockReturnValue(false)
    mocks.requireFeaturePermission.mockResolvedValue(undefined)
    mocks.requireOrg.mockReturnValue("org-1")
    mocks.getCloudflareContext.mockResolvedValue({ env: { DB: {} } })
  })

  it.each([
    ["purchase-order list", () => getProjectPurchaseOrders("project-1")],
    ["operations summary", () => getProjectOperationsSummary("project-1")],
    ["Sage sync queue", () => getProjectSageSyncQueue("project-1")],
  ])("denies an active external caller from the %s before database work", async (_name, invoke) => {
    await expect(invoke()).rejects.toThrow(
      "Purchase orders are limited to active internal staff."
    )
    expect(mocks.requireFeaturePermission).not.toHaveBeenCalled()
    expect(mocks.requireOrg).not.toHaveBeenCalled()
    expect(mocks.getDb).not.toHaveBeenCalled()
  })

  it.each([
    [
      "purchase-order update",
      () =>
        updatePurchaseOrderRequest("project-1", "po-1", {
          ...COMMON_INPUT,
          title: "Blocked external update",
          lines: [],
        }),
    ],
    [
      "purchase-order delete",
      () => deletePurchaseOrderRequest("project-1", "po-1"),
    ],
    [
      "single-item Sage queue",
      () => queueProjectOperationForSageSync("project-1", "po-1"),
    ],
    [
      "batch Sage queue",
      () => queueProjectOperationsForSageSync("project-1"),
    ],
    [
      "supplier email",
      () =>
        sendPurchaseOrderEmail("project-1", "po-1", {
          to: "vendor@example.com",
          cc: null,
          subject: "Purchase order",
          message: "Please review.",
        }),
    ],
  ])("denies an active external caller from the %s before database work", async (_name, invoke) => {
    await expect(invoke()).resolves.toEqual({
      success: false,
      error: "Purchase orders are limited to active internal staff.",
    })
    expect(mocks.requireFeaturePermission).not.toHaveBeenCalled()
    expect(mocks.requireOrg).not.toHaveBeenCalled()
    expect(mocks.getDb).not.toHaveBeenCalled()
  })

  it("denies an inactive internal editor before database work", async () => {
    mocks.requireAuth.mockResolvedValue({
      id: "inactive-staff-1",
      role: "project_manager",
      isActive: false,
    })
    mocks.isInternalStaffRole.mockReturnValue(true)

    await expect(
      updatePurchaseOrderRequest("project-1", "po-1", {
        ...COMMON_INPUT,
        title: "Blocked inactive update",
        lines: [],
      })
    ).resolves.toEqual({
      success: false,
      error: "Purchase orders are limited to active internal staff.",
    })
    expect(mocks.requireFeaturePermission).not.toHaveBeenCalled()
    expect(mocks.requireOrg).not.toHaveBeenCalled()
    expect(mocks.getDb).not.toHaveBeenCalled()
  })

  it("denies an external Nu-Tech release before permission or database work", async () => {
    await expect(releaseNuTechAirlitePurchaseOrder("project-1")).resolves.toEqual({
      success: false,
      error: "Purchase orders are limited to active internal staff.",
    })
    expect(mocks.requireFeaturePermission).not.toHaveBeenCalled()
    expect(mocks.requireOrg).not.toHaveBeenCalled()
    expect(mocks.getDb).not.toHaveBeenCalled()
  })

  it.each([
    [
      "Nu-Tech item save",
      () => saveNuTechOrderItem("project-1", { productId: "product-1", quantity: 1 }),
    ],
    [
      "Nu-Tech item delete",
      () => deleteNuTechOrderItem("project-1", "item-1"),
    ],
    [
      "Airlite workbook generation",
      () => generateNuTechAirliteWorkbook("project-1"),
    ],
  ])("denies an active external caller from %s before permission or database work", async (_name, invoke) => {
    await expect(invoke()).resolves.toEqual({
      success: false,
      error: "Purchase orders are limited to active internal staff.",
    })
    expect(mocks.requireFeaturePermission).not.toHaveBeenCalled()
    expect(mocks.requireOrg).not.toHaveBeenCalled()
    expect(mocks.getDb).not.toHaveBeenCalled()
  })

  it.each([
    ["Nu-Tech project workspace", () => getProjectNuTechOrderWorkspace("project-1")],
    ["Nu-Tech dashboard", () => getNuTechOrderDashboard()],
  ])("denies an active external caller from the %s before permission or database work", async (_name, invoke) => {
    await expect(invoke()).rejects.toThrow(
      "Purchase orders are limited to active internal staff."
    )
    expect(mocks.requireFeaturePermission).not.toHaveBeenCalled()
    expect(mocks.requireOrg).not.toHaveBeenCalled()
    expect(mocks.getDb).not.toHaveBeenCalled()
  })

  it.each([
    ["client", 1],
    ["internal", 0],
  ] as const)(
    "denies an active internal staff release from a %s organization before project work",
    async (organizationType, isActive) => {
      const sqlite = new Database(":memory:")
      createSchema(sqlite)
      seedDraft(sqlite, FIXED_NOW)
      seedNuTechWorkflow(sqlite, FIXED_NOW)
      sqlite
        .prepare("UPDATE organizations SET type = ?, is_active = ? WHERE id = ?")
        .run(organizationType, isActive, "org-1")
      // @ts-expect-error The SQLite adapter implements the D1 methods exercised here.
      const releaseDb = drizzle(createD1(sqlite), {
        schema: {
          organizations,
          projectOperations,
          projectPurchaseOrderLines,
          projects,
          nuTechOrderItems,
          nuTechOrderWorkflows,
        },
      })
      mocks.requireAuth.mockResolvedValue({
        id: "staff-1",
        role: "project_manager",
        isActive: true,
      })
      mocks.isInternalStaffRole.mockReturnValue(true)
      mocks.getDb.mockReturnValue(releaseDb)

      await expect(releaseNuTechAirlitePurchaseOrder("project-1")).resolves.toEqual({
        success: false,
        error: "Purchase orders require an active internal organization.",
      })
      expect(mocks.requireFeaturePermission).toHaveBeenCalledTimes(1)
      expect(mocks.getDb).toHaveBeenCalledTimes(1)
      sqlite.close()
    }
  )

  it.each([
    [
      "purchase-order update",
      () =>
        updatePurchaseOrderRequest("project-1", "po-1", {
          ...COMMON_INPUT,
          title: "Blocked organization update",
          lines: [],
        }),
    ],
    [
      "purchase-order delete",
      () => deletePurchaseOrderRequest("project-1", "po-1"),
    ],
    [
      "single Sage queue mutation",
      () => queueProjectOperationForSageSync("project-1", "po-1"),
    ],
    [
      "supplier email",
      () =>
        sendPurchaseOrderEmail("project-1", "po-1", {
          to: "vendor@example.com",
          cc: null,
          subject: "Purchase order",
          message: "Please review.",
        }),
    ],
  ] as const)(
    "denies an active internal staff %s from a client organization before mutation work",
    async (_name, invoke) => {
      const sqlite = new Database(":memory:")
      createSchema(sqlite)
      seedDraft(sqlite, FIXED_NOW)
      sqlite
        .prepare("UPDATE organizations SET type = ? WHERE id = ?")
        .run("client", "org-1")
      // @ts-expect-error The SQLite adapter implements the D1 methods exercised here.
      const actionDb = drizzle(createD1(sqlite), {
        schema: {
          organizations,
          projectOperations,
          projectPurchaseOrderLines,
          projects,
        },
      })
      mocks.requireAuth.mockResolvedValue({
        id: "staff-1",
        role: "project_manager",
        isActive: true,
      })
      mocks.isInternalStaffRole.mockReturnValue(true)
      mocks.getDb.mockReturnValue(actionDb)

      await expect(invoke()).resolves.toEqual({
        success: false,
        error: "Purchase orders require an active internal organization.",
      })
      expect(mocks.getDb).toHaveBeenCalledTimes(1)
      expect(mocks.fetch).not.toHaveBeenCalled()
      sqlite.close()
    }
  )
})

describe("purchase-order supplier email claim fence", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(FIXED_NOW))
    vi.clearAllMocks()
    mocks.fetch.mockReset()
    mocks.requireAuth.mockResolvedValue({
      id: "staff-1",
      role: "project_manager",
      isActive: true,
      displayName: "Project Manager",
      email: "staff@example.com",
    })
    mocks.isInternalStaffRole.mockReturnValue(true)
    mocks.requireFeaturePermission.mockResolvedValue(undefined)
    mocks.requireOrg.mockReturnValue("org-1")
    mocks.getCloudflareContext.mockResolvedValue({
      env: { DB: {}, RESEND_API_KEY: "resend-test" },
    })
    vi.stubGlobal("fetch", mocks.fetch)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("keeps a missing provider credential retryable instead of marking the email sent", async () => {
    const sqlite = new Database(":memory:")
    createSchema(sqlite)
    seedDraft(sqlite, FIXED_NOW)
    const emailActor = createD1(sqlite)
    // @ts-expect-error The SQLite adapter implements the D1 methods exercised here.
    const emailDb = drizzle(emailActor, {
      schema: { projectOperations, projectPurchaseOrderLines, projects },
    })
    mocks.getDb.mockReturnValue(emailDb)
    mocks.getCloudflareContext.mockResolvedValue({ env: { DB: {} } })

    expect(
      await sendPurchaseOrderEmail("project-1", "po-1", {
        to: "vendor@example.com",
        cc: null,
        subject: "Purchase order",
        message: "Please review.",
      })
    ).toEqual({
      success: false,
      error: "RESEND_API_KEY is not configured",
    })
    expect(mocks.fetch).not.toHaveBeenCalled()

    const storedOrder = await emailDb
      .select()
      .from(projectOperations)
      .where(eq(projectOperations.id, "po-1"))
      .get()
    expect(storedOrder?.status).toBe("draft")
    expect(storedOrder?.purchaseOrderEmailClaimStatus).toBe("failed")
    expect(storedOrder?.purchaseOrderEmailClaimToken).toBeNull()
    expect(storedOrder?.purchaseOrderEmailClaimProviderPayload).not.toBeNull()
    sqlite.close()
  })

  it("fails the claim without calling the provider when an editor wins after the email read", async () => {
    let releaseEmailRead: () => void = () => undefined
    const emailReadPaused = new Promise<void>((resolve) => {
      releaseEmailRead = resolve
    })
    let signalEmailRead: () => void = () => undefined
    const emailReadSignaled = new Promise<void>((resolve) => {
      signalEmailRead = resolve
    })
    let signaled = false
    const sqlite = new Database(":memory:")
    createSchema(sqlite)
    seedDraft(sqlite, FIXED_NOW)
    const emailActor = createD1(sqlite, {
      paused: emailReadPaused,
      shouldPause: (query) =>
        query.startsWith("select") &&
        query.includes('from "project_operations"'),
      signal: () => {
        if (signaled) return
        signaled = true
        signalEmailRead()
      },
    })
    const editorActor = createD1(sqlite)
    // @ts-expect-error The SQLite adapter implements the D1 methods exercised here.
    const emailDb = drizzle(emailActor, {
      schema: { projectOperations, projectPurchaseOrderLines, projects },
    })
    // @ts-expect-error The SQLite adapter implements the D1 methods exercised here.
    const editorDb = drizzle(editorActor, {
      schema: { projectOperations, projectPurchaseOrderLines, projects },
    })
    mocks.getDb.mockReturnValueOnce(emailDb).mockReturnValueOnce(editorDb)

    const emailAttempt = sendPurchaseOrderEmail("project-1", "po-1", {
      to: "vendor@example.com",
      cc: null,
      subject: "Purchase order",
      message: "Please review.",
    })
    await emailReadSignaled

    const editorResult = await updatePurchaseOrderRequest("project-1", "po-1", {
      ...COMMON_INPUT,
      title: "Newer empty draft",
      lines: [],
    })
    expect(editorResult).toEqual({ success: true, id: "po-1" })

    releaseEmailRead()
    expect(await emailAttempt).toEqual({
      success: false,
      error: "This purchase order changed while the email was being prepared. Refresh and try again.",
    })
    expect(mocks.fetch).not.toHaveBeenCalled()
    sqlite.close()
  })

  it("claims the exact revision before the provider and rejects a stale editor", async () => {
    let releaseEditorRead: () => void = () => undefined
    const editorReadPaused = new Promise<void>((resolve) => {
      releaseEditorRead = resolve
    })
    let signalEditorRead: () => void = () => undefined
    const editorReadSignaled = new Promise<void>((resolve) => {
      signalEditorRead = resolve
    })
    let signaled = false
    const sqlite = new Database(":memory:")
    createSchema(sqlite)
    seedDraft(sqlite, FIXED_NOW)
    const editorActor = createD1(sqlite, {
      paused: editorReadPaused,
      shouldPause: (query) =>
        query.startsWith("select") &&
        query.includes('from "project_operations"'),
      signal: () => {
        if (signaled) return
        signaled = true
        signalEditorRead()
      },
    })
    const emailActor = createD1(sqlite)
    // @ts-expect-error The SQLite adapter implements the D1 methods exercised here.
    const editorDb = drizzle(editorActor, {
      schema: { projectOperations, projectPurchaseOrderLines, projects },
    })
    // @ts-expect-error The SQLite adapter implements the D1 methods exercised here.
    const emailDb = drizzle(emailActor, {
      schema: { projectOperations, projectPurchaseOrderLines, projects },
    })
    mocks.getDb.mockReturnValueOnce(editorDb).mockReturnValueOnce(emailDb)
    mocks.fetch.mockResolvedValue(
      new Response(JSON.stringify({ id: "resend-1" }), { status: 200 })
    )

    const staleEditor = updatePurchaseOrderRequest("project-1", "po-1", {
      ...COMMON_INPUT,
      title: "Stale replacement",
      lines: [
        {
          description: "Stale line",
          costCode: "03100",
          phaseCode: "03",
          quantity: 1,
          unitCost: 99,
          unit: "EA",
          amount: 99,
          taxGroup: null,
        },
      ],
    })
    await editorReadSignaled

    const emailResult = await sendPurchaseOrderEmail("project-1", "po-1", {
      to: "vendor@example.com",
      cc: null,
      subject: "Purchase order",
      message: "Please review.",
    })
    expect(emailResult).toEqual({
      success: true,
      status: "sent",
      providerMessageId: "resend-1",
    })
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
    expect(mocks.fetch).toHaveBeenCalledWith(
      "https://api.resend.com/emails",
      expect.objectContaining({
        headers: expect.objectContaining({
          "Idempotency-Key": expect.any(String),
        }),
      })
    )

    releaseEditorRead()
    expect(await staleEditor).toEqual({
      success: false,
      error: "This purchase order changed after you opened it. Refresh and try again.",
    })

    const storedOrder = await emailDb
      .select()
      .from(projectOperations)
      .where(eq(projectOperations.id, "po-1"))
      .get()
    const storedLines = await emailDb
      .select()
      .from(projectPurchaseOrderLines)
      .where(eq(projectPurchaseOrderLines.operationId, "po-1"))
      .all()
    expect(storedOrder?.status).toBe("sent")
    expect(storedOrder?.title).toBe("Original draft")
    expect(storedOrder?.revision).toBe(2)
    expect(storedOrder?.purchaseOrderEmailClaimToken).toBeNull()
    expect(storedOrder?.sagePayloadJson).toContain("vendor@example.com")
    expect(storedLines).toHaveLength(1)
    sqlite.close()
  })

  it("keeps the order atomic when an email claim wins between delete statements", async () => {
    const directory = mkdtempSync(join(tmpdir(), "compass-po-delete-race-"))
    const databasePath = join(directory, "race.sqlite")
    const seedSqlite = new Database(databasePath)
    createSchema(seedSqlite)
    seedDraft(seedSqlite, FIXED_NOW)
    seedSqlite.close()

    const emailSqlite = new Database(databasePath)
    const deleteSqlite = new Database(databasePath)
    try {
      let releaseEmailRead: () => void = () => undefined
      const emailReadPaused = new Promise<void>((resolve) => {
        releaseEmailRead = resolve
      })
      let signalEmailRead: () => void = () => undefined
      const emailReadSignaled = new Promise<void>((resolve) => {
        signalEmailRead = resolve
      })
      let emailReadWasSignaled = false
      const emailActor = createD1(emailSqlite, {
        paused: emailReadPaused,
        shouldPause: (query) =>
          query.startsWith("select") &&
          query.includes('from "project_purchase_order_lines"'),
        signal: () => {
          if (emailReadWasSignaled) return
          emailReadWasSignaled = true
          signalEmailRead()
        },
      })

      let releaseDeleteMutation: () => void = () => undefined
      const deleteMutationPaused = new Promise<void>((resolve) => {
        releaseDeleteMutation = resolve
      })
      let signalDeleteMutation: () => void = () => undefined
      const deleteMutationSignaled = new Promise<void>((resolve) => {
        signalDeleteMutation = resolve
      })
      let deleteMutationWasSignaled = false
      const signalDeleteAttempt = (): void => {
        if (deleteMutationWasSignaled) return
        deleteMutationWasSignaled = true
        signalDeleteMutation()
      }
      const deleteActor = createD1(
        deleteSqlite,
        {
          paused: deleteMutationPaused,
          shouldPause: (query) =>
            query.startsWith('delete from "project_purchase_order_lines"'),
          signal: signalDeleteAttempt,
        },
        {
          paused: deleteMutationPaused,
          signal: signalDeleteAttempt,
        }
      )
      // @ts-expect-error The SQLite adapter implements the D1 methods exercised here.
      const emailDb = drizzle(emailActor, {
        schema: { projectOperations, projectPurchaseOrderLines, projects },
      })
      // @ts-expect-error The SQLite adapter implements the D1 methods exercised here.
      const deleteDb = drizzle(deleteActor, {
        schema: { projectOperations, projectPurchaseOrderLines, projects },
      })
      mocks.getDb.mockReturnValueOnce(emailDb).mockReturnValueOnce(deleteDb)

      let releaseProvider: (response: Response) => void = () => undefined
      const providerStarted = new Promise<void>((resolve) => {
        mocks.fetch.mockImplementationOnce(
          async (): Promise<Response> => {
            resolve()
            return await new Promise<Response>((resolveResponse) => {
              releaseProvider = resolveResponse
            })
          }
        )
      })

      const emailAttempt = sendPurchaseOrderEmail("project-1", "po-1", {
        to: "vendor@example.com",
        cc: null,
        subject: "Purchase order",
        message: "Please review.",
      })
      await emailReadSignaled

      const deleteAttempt = deletePurchaseOrderRequest("project-1", "po-1")
      await deleteMutationSignaled

      releaseEmailRead()
      await providerStarted
      releaseDeleteMutation()
      expect(await deleteAttempt).toEqual({
        success: false,
        error: "This purchase order is being emailed. Try again after delivery finishes.",
      })

      const requestBody = String(mocks.fetch.mock.calls[0]?.[1]?.body)
      expect(requestBody).toContain("Original line")

      releaseProvider(new Response(JSON.stringify({ id: "resend-delete-race" }), { status: 200 }))
      expect(await emailAttempt).toEqual({
        success: true,
        status: "sent",
        providerMessageId: "resend-delete-race",
      })

      const storedOrder = await emailDb
        .select()
        .from(projectOperations)
        .where(eq(projectOperations.id, "po-1"))
        .get()
      const storedLines = await emailDb
        .select()
        .from(projectPurchaseOrderLines)
        .where(eq(projectPurchaseOrderLines.operationId, "po-1"))
        .all()
      expect(storedOrder?.status).toBe("sent")
      expect(storedOrder?.purchaseOrderEmailClaimStatus).toBe("sent")
      expect(storedLines).toHaveLength(1)
      expect(storedLines[0]?.description).toBe("Original line")
    } finally {
      emailSqlite.close()
      deleteSqlite.close()
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it("reports a revision conflict when a newer editor beats a stale delete", async () => {
    const directory = mkdtempSync(join(tmpdir(), "compass-po-delete-edit-race-"))
    const databasePath = join(directory, "race.sqlite")
    const seedSqlite = new Database(databasePath)
    createSchema(seedSqlite)
    seedDraft(seedSqlite, FIXED_NOW)
    seedSqlite.close()

    const deleteSqlite = new Database(databasePath)
    const editorSqlite = new Database(databasePath)
    try {
      let releaseDeleteBatch: () => void = () => undefined
      const deleteBatchPaused = new Promise<void>((resolve) => {
        releaseDeleteBatch = resolve
      })
      let signalDeleteBatch: () => void = () => undefined
      const deleteBatchSignaled = new Promise<void>((resolve) => {
        signalDeleteBatch = resolve
      })
      let deleteBatchWasSignaled = false
      const deleteActor = createD1(deleteSqlite, undefined, {
        paused: deleteBatchPaused,
        signal: () => {
          if (deleteBatchWasSignaled) return
          deleteBatchWasSignaled = true
          signalDeleteBatch()
        },
      })
      const editorActor = createD1(editorSqlite)
      // @ts-expect-error The SQLite adapter implements the D1 methods exercised here.
      const deleteDb = drizzle(deleteActor, {
        schema: { projectOperations, projectPurchaseOrderLines, projects },
      })
      // @ts-expect-error The SQLite adapter implements the D1 methods exercised here.
      const editorDb = drizzle(editorActor, {
        schema: { projectOperations, projectPurchaseOrderLines, projects },
      })
      mocks.getDb.mockReturnValueOnce(deleteDb).mockReturnValueOnce(editorDb)

      const deleteAttempt = deletePurchaseOrderRequest("project-1", "po-1")
      await deleteBatchSignaled

      expect(
        await updatePurchaseOrderRequest("project-1", "po-1", {
          ...COMMON_INPUT,
          title: "Concurrent replacement",
          lines: [
            {
              description: "Concurrent line",
              costCode: "03100",
              phaseCode: "03",
              quantity: 1,
              unitCost: 25,
              unit: "EA",
              amount: 25,
              taxGroup: null,
            },
          ],
        })
      ).toEqual({ success: true, id: "po-1" })

      releaseDeleteBatch()
      expect(await deleteAttempt).toEqual({
        success: false,
        error: "This purchase order changed while it was being deleted. Refresh and try again.",
      })

      const storedOrder = await editorDb
        .select()
        .from(projectOperations)
        .where(eq(projectOperations.id, "po-1"))
        .get()
      const storedLines = await editorDb
        .select()
        .from(projectPurchaseOrderLines)
        .where(eq(projectPurchaseOrderLines.operationId, "po-1"))
        .all()
      expect(storedOrder?.title).toBe("Concurrent replacement")
      expect(storedOrder?.revision).toBe(1)
      expect(storedLines).toHaveLength(1)
      expect(storedLines[0]?.description).toBe("Concurrent line")
    } finally {
      deleteSqlite.close()
      editorSqlite.close()
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it("retries definitive provider failure with a fresh key and fences an older attempt", async () => {
    const sqlite = new Database(":memory:")
    createSchema(sqlite)
    seedDraft(sqlite, FIXED_NOW)
    const emailActor = createD1(sqlite)
    // @ts-expect-error The SQLite adapter implements the D1 methods exercised here.
    const emailDb = drizzle(emailActor, {
      schema: { projectOperations, projectPurchaseOrderLines, projects },
    })
    mocks.getDb.mockReturnValue(emailDb)
    mocks.fetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "provider unavailable" }), { status: 400 })
    )

    const input = {
      to: "vendor@example.com",
      cc: null,
      subject: "Purchase order",
      message: "Please review.",
    } as const
    expect(await sendPurchaseOrderEmail("project-1", "po-1", input)).toEqual({
      success: false,
      error: '{"error":"provider unavailable"}',
    })

    const failedClaim = await emailDb
      .select()
      .from(projectOperations)
      .where(eq(projectOperations.id, "po-1"))
      .get()
    expect(failedClaim?.purchaseOrderEmailClaimStatus).toBe("failed")
    expect(failedClaim?.purchaseOrderEmailClaimAttempt).toBe(1)
    const firstRequest = mocks.fetch.mock.calls[0]?.[1]

    let releaseProvider: (response: Response) => void = () => undefined
    const providerStarted = new Promise<void>((resolve) => {
      mocks.fetch.mockImplementationOnce(
        async (): Promise<Response> => {
          resolve()
          return await new Promise<Response>((resolveResponse) => {
            releaseProvider = resolveResponse
          })
        }
      )
    })
    const retry = sendPurchaseOrderEmail("project-1", "po-1", input)
    await providerStarted

    const retryClaim = await emailDb
      .select()
      .from(projectOperations)
      .where(eq(projectOperations.id, "po-1"))
      .get()
    expect(retryClaim?.purchaseOrderEmailClaimAttempt).toBe(2)
    const staleCompletion = sqlite
      .prepare(`
        UPDATE project_operations
        SET status = 'sent', sage_payload_json = ?, revision = revision + 1
        WHERE id = ?
          AND purchase_order_email_claim_token = ?
          AND purchase_order_email_claim_attempt = 1
          AND purchase_order_email_claim_status = 'in_flight'
      `)
      .run("{\"stale\":true}", "po-1", retryClaim?.purchaseOrderEmailClaimToken)
    expect(Number(staleCompletion.changes)).toBe(0)

    releaseProvider(new Response(JSON.stringify({ id: "resend-2" }), { status: 200 }))
    expect(await retry).toEqual({
      success: true,
      status: "sent",
      providerMessageId: "resend-2",
    })
    expect(mocks.fetch).toHaveBeenCalledTimes(2)
    expect(mocks.fetch.mock.calls[1]?.[1]).not.toEqual(firstRequest)
    const finalOrder = await emailDb
      .select()
      .from(projectOperations)
      .where(eq(projectOperations.id, "po-1"))
      .get()
    expect(finalOrder?.status).toBe("sent")
    expect(finalOrder?.sagePayloadJson).toContain("vendor@example.com")
    sqlite.close()
  })

  it("reclaims an expired network-uncertain claim with the same provider idempotency key", async () => {
    const sqlite = new Database(":memory:")
    createSchema(sqlite)
    seedDraft(sqlite, FIXED_NOW)
    const emailActor = createD1(sqlite)
    // @ts-expect-error The SQLite adapter implements the D1 methods exercised here.
    const emailDb = drizzle(emailActor, {
      schema: { projectOperations, projectPurchaseOrderLines, projects },
    })
    mocks.getDb.mockReturnValue(emailDb)
    mocks.fetch.mockRejectedValueOnce(new TypeError("network connection reset"))

    const input = {
      to: "vendor@example.com",
      cc: null,
      subject: "Purchase order",
      message: "Please review.",
    } as const
    expect(await sendPurchaseOrderEmail("project-1", "po-1", input)).toEqual({
      success: false,
      error:
        "Email provider delivery outcome is uncertain. Try again after the delivery reservation expires.",
    })

    const uncertainClaim = await emailDb
      .select()
      .from(projectOperations)
      .where(eq(projectOperations.id, "po-1"))
      .get()
    expect(uncertainClaim?.purchaseOrderEmailClaimStatus).toBe("uncertain")
    expect(uncertainClaim?.purchaseOrderEmailClaimAttempt).toBe(1)
    expect(uncertainClaim?.purchaseOrderEmailClaimReclaimAfter).toBe(
      "2026-08-25T05:05:00.000Z"
    )
    expect(uncertainClaim?.purchaseOrderEmailClaimRetryUntil).toBe(
      "2026-08-26T04:00:00.000Z"
    )
    const firstRequest = mocks.fetch.mock.calls[0]?.[1]

    expect(await sendPurchaseOrderEmail("project-1", "po-1", input)).toEqual({
      success: false,
      error:
        "This purchase order email has an uncertain delivery outcome. Try again shortly.",
    })
    expect(mocks.fetch).toHaveBeenCalledTimes(1)

    vi.setSystemTime(new Date("2026-08-25T05:05:00.000Z"))
    mocks.fetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: "resend-reclaimed" }), { status: 200 })
    )
    expect(await sendPurchaseOrderEmail("project-1", "po-1", input)).toEqual({
      success: true,
      status: "sent",
      providerMessageId: "resend-reclaimed",
    })
    expect(mocks.fetch).toHaveBeenCalledTimes(2)
    expect(mocks.fetch.mock.calls[1]?.[1]).toEqual(firstRequest)

    const finalOrder = await emailDb
      .select()
      .from(projectOperations)
      .where(eq(projectOperations.id, "po-1"))
      .get()
    expect(finalOrder?.purchaseOrderEmailClaimStatus).toBe("sent")
    expect(finalOrder?.purchaseOrderEmailClaimAttempt).toBe(2)
    expect(finalOrder?.purchaseOrderEmailClaimReclaimAfter).toBeNull()
    expect(finalOrder?.purchaseOrderEmailClaimRetryUntil).toBeNull()
    expect(finalOrder?.sagePayloadJson).toContain("vendor@example.com")
    sqlite.close()
  })

  it("replays the exact claimed provider payload after project and sender changes", async () => {
    const sqlite = new Database(":memory:")
    createSchema(sqlite)
    seedDraft(sqlite, FIXED_NOW)
    const emailActor = createD1(sqlite)
    // @ts-expect-error The SQLite adapter implements the D1 methods exercised here.
    const emailDb = drizzle(emailActor, {
      schema: { projectOperations, projectPurchaseOrderLines, projects },
    })
    mocks.getDb.mockReturnValue(emailDb)
    mocks.getCloudflareContext
      .mockResolvedValueOnce({
        env: {
          DB: {},
          RESEND_API_KEY: "resend-test",
          COMPASS_EMAIL_FROM: "Original Compass <original@compass.build>",
        },
      })
      .mockResolvedValueOnce({
        env: {
          DB: {},
          RESEND_API_KEY: "resend-test",
          COMPASS_EMAIL_FROM: "Changed Compass <changed@compass.build>",
        },
      })
    mocks.fetch.mockRejectedValueOnce(new TypeError("network connection reset"))

    const input = {
      to: "vendor@example.com",
      cc: null,
      subject: "Purchase order",
      message: "Please review.",
    } as const
    expect(await sendPurchaseOrderEmail("project-1", "po-1", input)).toEqual({
      success: false,
      error:
        "Email provider delivery outcome is uncertain. Try again after the delivery reservation expires.",
    })
    const originalRequest = mocks.fetch.mock.calls[0]?.[1]

    sqlite
      .prepare("UPDATE projects SET name = ?, address = ? WHERE id = ?")
      .run("Changed Project", "999 Changed Street", "project-1")
    mocks.requireAuth.mockResolvedValue({
      id: "staff-2",
      role: "project_manager",
      isActive: true,
      displayName: "Different Project Manager",
      email: "staff-2@example.com",
    })
    vi.setSystemTime(new Date("2026-08-25T05:05:00.000Z"))
    mocks.fetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: "resend-replayed" }), { status: 200 })
    )

    expect(await sendPurchaseOrderEmail("project-1", "po-1", input)).toEqual({
      success: true,
      status: "sent",
      providerMessageId: "resend-replayed",
    })
    expect(mocks.fetch.mock.calls[1]?.[1]).toEqual(originalRequest)
    sqlite.close()
  })

  it("clears an expired uncertain claim so a later send can start a new reservation", async () => {
    const sqlite = new Database(":memory:")
    createSchema(sqlite)
    seedDraft(sqlite, FIXED_NOW)
    const emailActor = createD1(sqlite)
    // @ts-expect-error The SQLite adapter implements the D1 methods exercised here.
    const emailDb = drizzle(emailActor, {
      schema: { projectOperations, projectPurchaseOrderLines, projects },
    })
    mocks.getDb.mockReturnValue(emailDb)
    mocks.fetch.mockRejectedValueOnce(new TypeError("network connection reset"))

    const input = {
      to: "vendor@example.com",
      cc: null,
      subject: "Purchase order",
      message: "Please review.",
    } as const
    await sendPurchaseOrderEmail("project-1", "po-1", input)

    vi.setSystemTime(new Date("2026-08-27T04:00:00.000Z"))
    expect(
      await sendPurchaseOrderEmail("project-1", "po-1", {
        ...input,
        message: "A changed request should still clear the expired reservation.",
      })
    ).toEqual({
      success: false,
      error:
        "This email can no longer be retried safely because the provider idempotency window expired. Reconcile delivery before trying again.",
    })

    const expiredClaim = await emailDb
      .select()
      .from(projectOperations)
      .where(eq(projectOperations.id, "po-1"))
      .get()
    expect(expiredClaim?.purchaseOrderEmailClaimStatus).toBe("failed")
    expect(expiredClaim?.purchaseOrderEmailClaimToken).toBeNull()
    expect(expiredClaim?.purchaseOrderEmailClaimReclaimAfter).toBeNull()

    mocks.fetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: "resend-after-expiry" }), { status: 200 })
    )
    expect(await sendPurchaseOrderEmail("project-1", "po-1", input)).toEqual({
      success: true,
      status: "sent",
      providerMessageId: "resend-after-expiry",
    })
    expect(mocks.fetch).toHaveBeenCalledTimes(2)
    sqlite.close()
  })

  it("refuses ambiguous recovery through a different provider credential", async () => {
    const sqlite = new Database(":memory:")
    createSchema(sqlite)
    seedDraft(sqlite, FIXED_NOW)
    const emailActor = createD1(sqlite)
    // @ts-expect-error The SQLite adapter implements the D1 methods exercised here.
    const emailDb = drizzle(emailActor, {
      schema: { projectOperations, projectPurchaseOrderLines, projects },
    })
    mocks.getDb.mockReturnValue(emailDb)
    mocks.getCloudflareContext
      .mockResolvedValueOnce({ env: { DB: {}, RESEND_API_KEY: "resend-account-a" } })
      .mockResolvedValueOnce({ env: { DB: {}, RESEND_API_KEY: "resend-account-b" } })
    mocks.fetch.mockRejectedValueOnce(new TypeError("network connection reset"))

    const input = {
      to: "vendor@example.com",
      cc: null,
      subject: "Purchase order",
      message: "Please review.",
    } as const
    expect(await sendPurchaseOrderEmail("project-1", "po-1", input)).toEqual({
      success: false,
      error:
        "Email provider delivery outcome is uncertain. Try again after the delivery reservation expires.",
    })

    vi.setSystemTime(new Date("2026-08-25T05:05:00.000Z"))
    mocks.fetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: "resend-other-account" }), { status: 200 })
    )
    expect(await sendPurchaseOrderEmail("project-1", "po-1", input)).toEqual({
      success: false,
      error:
        "Email provider credentials changed after this delivery became uncertain. Restore the original provider credential or reconcile delivery before retrying.",
    })
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
    const finalOrder = await emailDb
      .select()
      .from(projectOperations)
      .where(eq(projectOperations.id, "po-1"))
      .get()
    expect(finalOrder?.purchaseOrderEmailClaimStatus).toBe("uncertain")
    expect(finalOrder?.purchaseOrderEmailClaimAttempt).toBe(1)
    sqlite.close()
  })

  it("keeps a concurrent idempotency response uncertain and bounded", async () => {
    const sqlite = new Database(":memory:")
    createSchema(sqlite)
    seedDraft(sqlite, FIXED_NOW)
    const emailActor = createD1(sqlite)
    // @ts-expect-error The SQLite adapter implements the D1 methods exercised here.
    const emailDb = drizzle(emailActor, {
      schema: { projectOperations, projectPurchaseOrderLines, projects },
    })
    mocks.getDb.mockReturnValue(emailDb)
    mocks.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          name: "concurrent_idempotent_requests",
          message: "Another request with the same key is still processing.",
        }),
        { status: 409 }
      )
    )

    expect(
      await sendPurchaseOrderEmail("project-1", "po-1", {
        to: "vendor@example.com",
        cc: null,
        subject: "Purchase order",
        message: "Please review.",
      })
    ).toEqual({
      success: false,
      error:
        "Email provider delivery outcome is uncertain. Try again after the delivery reservation expires.",
    })

    const storedOrder = await emailDb
      .select()
      .from(projectOperations)
      .where(eq(projectOperations.id, "po-1"))
      .get()
    expect(storedOrder?.purchaseOrderEmailClaimStatus).toBe("uncertain")
    expect(storedOrder?.purchaseOrderEmailClaimReclaimAfter).toBe(
      "2026-08-25T05:05:00.000Z"
    )
    expect(storedOrder?.purchaseOrderEmailClaimRetryUntil).toBe(
      "2026-08-26T04:00:00.000Z"
    )
    sqlite.close()
  })

  it("preserves the original ambiguity window when a recovery request is rejected", async () => {
    const sqlite = new Database(":memory:")
    createSchema(sqlite)
    seedDraft(sqlite, FIXED_NOW)
    const emailActor = createD1(sqlite)
    // @ts-expect-error The SQLite adapter implements the D1 methods exercised here.
    const emailDb = drizzle(emailActor, {
      schema: { projectOperations, projectPurchaseOrderLines, projects },
    })
    mocks.getDb.mockReturnValue(emailDb)
    mocks.fetch
      .mockRejectedValueOnce(new TypeError("network connection reset"))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: "Provider unavailable" }), {
          status: 503,
        })
      )

    const input = {
      to: "vendor@example.com",
      cc: null,
      subject: "Purchase order",
      message: "Please review.",
    } as const
    expect(await sendPurchaseOrderEmail("project-1", "po-1", input)).toEqual({
      success: false,
      error:
        "Email provider delivery outcome is uncertain. Try again after the delivery reservation expires.",
    })

    vi.setSystemTime(new Date("2026-08-25T05:05:00.000Z"))
    expect(await sendPurchaseOrderEmail("project-1", "po-1", input)).toEqual({
      success: false,
      error:
        "Email provider delivery outcome is uncertain. Try again after the delivery reservation expires.",
    })

    const uncertainOrder = await emailDb
      .select()
      .from(projectOperations)
      .where(eq(projectOperations.id, "po-1"))
      .get()
    expect(uncertainOrder?.purchaseOrderEmailClaimStatus).toBe("uncertain")
    expect(uncertainOrder?.purchaseOrderEmailClaimRetryUntil).toBe(
      "2026-08-26T04:00:00.000Z"
    )

    vi.setSystemTime(new Date("2026-08-26T04:00:00.000Z"))
    mocks.fetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: "resend-too-late" }), { status: 200 })
    )
    expect(await sendPurchaseOrderEmail("project-1", "po-1", input)).toEqual({
      success: false,
      error:
        "This email can no longer be retried safely because the provider idempotency window expired. Reconcile delivery before trying again.",
    })
    expect(mocks.fetch).toHaveBeenCalledTimes(2)
    sqlite.close()
  })

  it("does not dispatch when an acquired recovery claim crosses its retry deadline", async () => {
    let releaseClaimWrite: () => void = () => undefined
    const claimWritePaused = new Promise<void>((resolve) => {
      releaseClaimWrite = resolve
    })
    let signalClaimWrite: () => void = () => undefined
    const claimWriteCompleted = new Promise<void>((resolve) => {
      signalClaimWrite = resolve
    })
    let claimWriteSignaled = false
    const sqlite = new Database(":memory:")
    createSchema(sqlite)
    seedDraft(sqlite, FIXED_NOW)
    const initialActor = createD1(sqlite)
    const delayedRetryActor = createD1(sqlite, {
      paused: claimWritePaused,
      shouldPause: (query) =>
        query.startsWith("update") &&
        query.includes('"purchase_order_email_claim_retry_until"'),
      signal: () => {
        if (claimWriteSignaled) return
        claimWriteSignaled = true
        signalClaimWrite()
      },
    })
    // @ts-expect-error The SQLite adapter implements the D1 methods exercised here.
    const initialDb = drizzle(initialActor, {
      schema: { projectOperations, projectPurchaseOrderLines, projects },
    })
    // @ts-expect-error The SQLite adapter implements the D1 methods exercised here.
    const delayedRetryDb = drizzle(delayedRetryActor, {
      schema: { projectOperations, projectPurchaseOrderLines, projects },
    })
    mocks.getDb.mockReturnValueOnce(initialDb).mockReturnValueOnce(delayedRetryDb)
    mocks.fetch.mockRejectedValueOnce(new TypeError("network connection reset"))

    const input = {
      to: "vendor@example.com",
      cc: null,
      subject: "Purchase order",
      message: "Please review.",
    } as const
    expect(await sendPurchaseOrderEmail("project-1", "po-1", input)).toEqual({
      success: false,
      error:
        "Email provider delivery outcome is uncertain. Try again after the delivery reservation expires.",
    })

    vi.setSystemTime(new Date("2026-08-25T05:05:00.000Z"))
    mocks.fetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: "resend-too-late" }), { status: 200 })
    )
    const delayedRetry = sendPurchaseOrderEmail("project-1", "po-1", input)
    await claimWriteCompleted
    vi.setSystemTime(new Date("2026-08-26T04:00:00.000Z"))
    releaseClaimWrite()

    expect(await delayedRetry).toEqual({
      success: false,
      error:
        "This email can no longer be retried safely because the provider idempotency window expired. Reconcile delivery before trying again.",
    })
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
    const finalOrder = await initialDb
      .select()
      .from(projectOperations)
      .where(eq(projectOperations.id, "po-1"))
      .get()
    expect(finalOrder?.purchaseOrderEmailClaimStatus).toBe("failed")
    expect(finalOrder?.purchaseOrderEmailClaimToken).toBeNull()
    expect(finalOrder?.purchaseOrderEmailClaimRetryUntil).toBeNull()
    sqlite.close()
  })

  it("refuses ambiguous recovery after the provider idempotency window expires", async () => {
    const sqlite = new Database(":memory:")
    createSchema(sqlite)
    seedDraft(sqlite, FIXED_NOW)
    const emailActor = createD1(sqlite)
    // @ts-expect-error The SQLite adapter implements the D1 methods exercised here.
    const emailDb = drizzle(emailActor, {
      schema: { projectOperations, projectPurchaseOrderLines, projects },
    })
    mocks.getDb.mockReturnValue(emailDb)
    mocks.fetch.mockRejectedValueOnce(new TypeError("network connection reset"))

    const input = {
      to: "vendor@example.com",
      cc: null,
      subject: "Purchase order",
      message: "Please review.",
    } as const
    expect(await sendPurchaseOrderEmail("project-1", "po-1", input)).toEqual({
      success: false,
      error:
        "Email provider delivery outcome is uncertain. Try again after the delivery reservation expires.",
    })

    vi.setSystemTime(new Date("2026-08-26T04:00:00.000Z"))
    mocks.fetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: "resend-too-late" }), { status: 200 })
    )
    expect(await sendPurchaseOrderEmail("project-1", "po-1", input)).toEqual({
      success: false,
      error:
        "This email can no longer be retried safely because the provider idempotency window expired. Reconcile delivery before trying again.",
    })
    expect(mocks.fetch).toHaveBeenCalledTimes(1)

    const finalOrder = await emailDb
      .select()
      .from(projectOperations)
      .where(eq(projectOperations.id, "po-1"))
      .get()
    expect(finalOrder?.purchaseOrderEmailClaimStatus).toBe("failed")
    expect(finalOrder?.purchaseOrderEmailClaimToken).toBeNull()
    expect(finalOrder?.purchaseOrderEmailClaimAttempt).toBe(1)
    expect(finalOrder?.purchaseOrderEmailClaimRetryUntil).toBeNull()
    expect(finalOrder?.sagePayloadJson).not.toContain("resend-too-late")
    sqlite.close()
  })

  it("starts the reclaim lease when the claim commits after slow preparation", async () => {
    let releaseLineRead: () => void = () => undefined
    const lineReadPaused = new Promise<void>((resolve) => {
      releaseLineRead = resolve
    })
    let signalLineRead: () => void = () => undefined
    const lineReadSignaled = new Promise<void>((resolve) => {
      signalLineRead = resolve
    })
    let lineReadWasSignaled = false
    const sqlite = new Database(":memory:")
    createSchema(sqlite)
    seedDraft(sqlite, FIXED_NOW)
    const emailActor = createD1(sqlite, {
      paused: lineReadPaused,
      shouldPause: (query) =>
        query.startsWith("select") &&
        query.includes('from "project_purchase_order_lines"'),
      signal: () => {
        if (lineReadWasSignaled) return
        lineReadWasSignaled = true
        signalLineRead()
      },
    })
    // @ts-expect-error The SQLite adapter implements the D1 methods exercised here.
    const emailDb = drizzle(emailActor, {
      schema: { projectOperations, projectPurchaseOrderLines, projects },
    })
    mocks.getDb.mockReturnValue(emailDb)

    let releaseProvider: (response: Response) => void = () => undefined
    const providerStarted = new Promise<void>((resolve) => {
      mocks.fetch.mockImplementationOnce(
        async (): Promise<Response> => {
          resolve()
          return await new Promise<Response>((resolveResponse) => {
            releaseProvider = resolveResponse
          })
        }
      )
    })
    mocks.fetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: "resend-duplicate" }), { status: 200 })
    )
    const input = {
      to: "vendor@example.com",
      cc: null,
      subject: "Purchase order",
      message: "Please review.",
    } as const
    const firstAttempt = sendPurchaseOrderEmail("project-1", "po-1", input)
    await lineReadSignaled

    vi.setSystemTime(new Date("2026-08-25T05:05:00.000Z"))
    releaseLineRead()
    await providerStarted

    expect(await sendPurchaseOrderEmail("project-1", "po-1", input)).toEqual({
      success: false,
      error: "This purchase order email is already being sent. Try again shortly.",
    })
    expect(mocks.fetch).toHaveBeenCalledTimes(1)

    releaseProvider(new Response(JSON.stringify({ id: "resend-first" }), { status: 200 }))
    expect(await firstAttempt).toEqual({
      success: true,
      status: "sent",
      providerMessageId: "resend-first",
    })
    const finalOrder = await emailDb
      .select()
      .from(projectOperations)
      .where(eq(projectOperations.id, "po-1"))
      .get()
    expect(finalOrder?.purchaseOrderEmailClaimAttempt).toBe(1)
    expect(finalOrder?.purchaseOrderEmailProviderMessageId).toBe("resend-first")
    sqlite.close()
  })

  it("fences a stale response-text failure after a reclaimed attempt completes", async () => {
    const sqlite = new Database(":memory:")
    createSchema(sqlite)
    seedDraft(sqlite, FIXED_NOW)
    const emailActor = createD1(sqlite)
    // @ts-expect-error The SQLite adapter implements the D1 methods exercised here.
    const emailDb = drizzle(emailActor, {
      schema: { projectOperations, projectPurchaseOrderLines, projects },
    })
    mocks.getDb.mockReturnValue(emailDb)

    let rejectResponseText: (reason?: unknown) => void = () => undefined
    let signalResponseTextStarted: () => void = () => undefined
    const responseTextStarted = new Promise<void>((resolve) => {
      signalResponseTextStarted = resolve
    })
    const staleResponse = new Response(JSON.stringify({ id: "resend-stale" }), {
      status: 200,
    })
    vi.spyOn(staleResponse, "text").mockImplementation(
      async (): Promise<string> => {
        signalResponseTextStarted()
        return await new Promise<string>((_resolve, reject) => {
          rejectResponseText = reject
        })
      }
    )
    mocks.fetch.mockResolvedValueOnce(staleResponse)

    const input = {
      to: "vendor@example.com",
      cc: null,
      subject: "Purchase order",
      message: "Please review.",
    } as const
    const staleAttempt = sendPurchaseOrderEmail("project-1", "po-1", input)
    await responseTextStarted
    const firstRequest = mocks.fetch.mock.calls[0]?.[1]

    vi.setSystemTime(new Date("2026-08-25T05:05:00.000Z"))
    mocks.fetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: "resend-reclaimed" }), { status: 200 })
    )
    expect(await sendPurchaseOrderEmail("project-1", "po-1", input)).toEqual({
      success: true,
      status: "sent",
      providerMessageId: "resend-reclaimed",
    })
    expect(mocks.fetch).toHaveBeenCalledTimes(2)
    expect(mocks.fetch.mock.calls[1]?.[1]).toEqual(firstRequest)

    rejectResponseText(new TypeError("response body interrupted"))
    expect(await staleAttempt).toEqual({
      success: false,
      error:
        "This purchase order changed while the email was being sent. Refresh and try again.",
    })

    const finalOrder = await emailDb
      .select()
      .from(projectOperations)
      .where(eq(projectOperations.id, "po-1"))
      .get()
    expect(finalOrder?.purchaseOrderEmailClaimStatus).toBe("sent")
    expect(finalOrder?.purchaseOrderEmailClaimAttempt).toBe(2)
    expect(finalOrder?.purchaseOrderEmailProviderMessageId).toBe("resend-reclaimed")
    expect(finalOrder?.sagePayloadJson).not.toContain("resend-stale")
    expect(finalOrder?.sagePayloadJson).toContain("vendor@example.com")
    sqlite.close()
  })

  it.each([429, 500, 503])(
    "retains an uncertain claim for HTTP %s even when the provider returns a body",
    async (status) => {
      const sqlite = new Database(":memory:")
      createSchema(sqlite)
      seedDraft(sqlite, FIXED_NOW)
      const emailActor = createD1(sqlite)
      // @ts-expect-error The SQLite adapter implements the D1 methods exercised here.
      const emailDb = drizzle(emailActor, {
        schema: { projectOperations, projectPurchaseOrderLines, projects },
      })
      mocks.getDb.mockReturnValue(emailDb)
      mocks.fetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ message: "provider unavailable" }), {
          status,
        })
      )

      const input = {
        to: "vendor@example.com",
        cc: null,
        subject: "Purchase order",
        message: "Please review.",
      } as const
      await expect(sendPurchaseOrderEmail("project-1", "po-1", input)).resolves.toEqual({
        success: false,
        error:
          "Email provider delivery outcome is uncertain. Try again after the delivery reservation expires.",
      })

      const storedOrder = await emailDb
        .select()
        .from(projectOperations)
        .where(eq(projectOperations.id, "po-1"))
        .get()
      expect(storedOrder?.purchaseOrderEmailClaimStatus).toBe("uncertain")
      expect(storedOrder?.purchaseOrderEmailClaimReclaimAfter).toBe(
        "2026-08-25T05:05:00.000Z"
      )
      expect(storedOrder?.purchaseOrderEmailClaimRetryUntil).toBe(
        "2026-08-26T04:00:00.000Z"
      )
      expect(mocks.fetch).toHaveBeenCalledTimes(1)

      await expect(sendPurchaseOrderEmail("project-1", "po-1", input)).resolves.toEqual({
        success: false,
        error: "This purchase order email has an uncertain delivery outcome. Try again shortly.",
      })
      expect(mocks.fetch).toHaveBeenCalledTimes(1)
      sqlite.close()
    }
  )

  it("retains uncertainty when a provider server failure body is unreadable", async () => {
    const sqlite = new Database(":memory:")
    createSchema(sqlite)
    seedDraft(sqlite, FIXED_NOW)
    const emailActor = createD1(sqlite)
    // @ts-expect-error The SQLite adapter implements the D1 methods exercised here.
    const emailDb = drizzle(emailActor, {
      schema: { projectOperations, projectPurchaseOrderLines, projects },
    })
    mocks.getDb.mockReturnValue(emailDb)

    const rejectedResponse = new Response("provider unavailable", { status: 503 })
    vi.spyOn(rejectedResponse, "text").mockRejectedValue(
      new TypeError("response body interrupted")
    )
    mocks.fetch.mockResolvedValueOnce(rejectedResponse)

    const input = {
      to: "vendor@example.com",
      cc: null,
      subject: "Purchase order",
      message: "Please review.",
    } as const
    expect(await sendPurchaseOrderEmail("project-1", "po-1", input)).toEqual({
      success: false,
      error:
        "Email provider delivery outcome is uncertain. Try again after the delivery reservation expires.",
    })
    const uncertainClaim = await emailDb
      .select()
      .from(projectOperations)
      .where(eq(projectOperations.id, "po-1"))
      .get()
    expect(uncertainClaim?.purchaseOrderEmailClaimStatus).toBe("uncertain")
    expect(uncertainClaim?.purchaseOrderEmailClaimReclaimAfter).toBe(
      "2026-08-25T05:05:00.000Z"
    )

    expect(await sendPurchaseOrderEmail("project-1", "po-1", input)).toEqual({
      success: false,
      error: "This purchase order email has an uncertain delivery outcome. Try again shortly.",
    })
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
    sqlite.close()
  })
})

describe("Nu-Tech purchase-order release versus supplier email", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(FIXED_NOW))
    vi.clearAllMocks()
    mocks.fetch.mockReset()
    mocks.requireAuth.mockResolvedValue({
      id: "staff-1",
      role: "project_manager",
      isActive: true,
      displayName: "Project Manager",
      email: "staff@example.com",
    })
    mocks.isInternalStaffRole.mockReturnValue(true)
    mocks.requireFeaturePermission.mockResolvedValue(undefined)
    mocks.canFeature.mockReturnValue(true)
    mocks.requireOrg.mockReturnValue("org-1")
    mocks.getCloudflareContext.mockResolvedValue({
      env: { DB: {}, RESEND_API_KEY: "resend-test" },
    })
    vi.stubGlobal("fetch", mocks.fetch)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("rejects a Nu-Tech release during an email claim and preserves email completion", async () => {
    const sqlite = new Database(":memory:")
    createSchema(sqlite)
    seedDraft(sqlite, FIXED_NOW)
    seedNuTechWorkflow(sqlite, FIXED_NOW)
    // @ts-expect-error The SQLite adapter implements the D1 methods exercised here.
    const emailDb = drizzle(createD1(sqlite), {
      schema: { projectOperations, projectPurchaseOrderLines, projects },
    })
    // @ts-expect-error The SQLite adapter implements the D1 methods exercised here.
    const releaseDb = drizzle(createD1(sqlite), {
      schema: { projectOperations, projects, nuTechOrderWorkflows, nuTechOrderItems },
    })
    mocks.getDb.mockReturnValueOnce(emailDb).mockReturnValueOnce(releaseDb)

    let releaseProvider: (response: Response) => void = () => undefined
    const providerStarted = new Promise<void>((resolve) => {
      mocks.fetch.mockImplementationOnce(
        async (): Promise<Response> => {
          resolve()
          return await new Promise<Response>((resolveResponse) => {
            releaseProvider = resolveResponse
          })
        }
      )
    })
    const emailAttempt = sendPurchaseOrderEmail("project-1", "po-1", {
      to: "vendor@example.com",
      cc: null,
      subject: "Purchase order",
      message: "Please review.",
    })
    await providerStarted

    const releaseResult = await releaseNuTechAirlitePurchaseOrder("project-1")
    expect(releaseResult).toEqual({
      success: false,
      error: "This purchase order is being emailed. Try again after delivery finishes.",
    })
    expect(mocks.fetch).toHaveBeenCalledTimes(1)

    releaseProvider(new Response(JSON.stringify({ id: "resend-1" }), { status: 200 }))
    expect(await emailAttempt).toEqual({
      success: true,
      status: "sent",
      providerMessageId: "resend-1",
    })

    const storedOrder = await emailDb
      .select()
      .from(projectOperations)
      .where(eq(projectOperations.id, "po-1"))
      .get()
    const storedWorkflow = await releaseDb
      .select()
      .from(nuTechOrderWorkflows)
      .where(eq(nuTechOrderWorkflows.id, "workflow-1"))
      .get()
    expect(storedOrder?.status).toBe("sent")
    expect(storedOrder?.purchaseOrderEmailClaimStatus).toBe("sent")
    expect(storedWorkflow?.purchaseOrderReleasedAt).toBeNull()
    expect(storedWorkflow?.orderStatus).toBe("customer_approved")
    sqlite.close()
  })

  it("fails a stale email claim without provider effects after Nu-Tech release wins", async () => {
    let releaseEmailRead: () => void = () => undefined
    const emailReadPaused = new Promise<void>((resolve) => {
      releaseEmailRead = resolve
    })
    let signalEmailRead: () => void = () => undefined
    const emailReadSignaled = new Promise<void>((resolve) => {
      signalEmailRead = resolve
    })
    let signaled = false
    const sqlite = new Database(":memory:")
    createSchema(sqlite)
    seedDraft(sqlite, FIXED_NOW)
    seedNuTechWorkflow(sqlite, FIXED_NOW)
    const emailDb = drizzle(
      // @ts-expect-error The SQLite adapter implements the D1 methods exercised here.
      createD1(sqlite, {
        paused: emailReadPaused,
        shouldPause: (query) =>
          query.startsWith("select") &&
          query.includes('from "project_operations"'),
        signal: () => {
          if (signaled) return
          signaled = true
          signalEmailRead()
        },
      }),
      { schema: { projectOperations, projectPurchaseOrderLines, projects } }
    )
    // @ts-expect-error The SQLite adapter implements the D1 methods exercised here.
    const releaseDb = drizzle(createD1(sqlite), {
      schema: { projectOperations, projects, nuTechOrderWorkflows, nuTechOrderItems },
    })
    mocks.getDb.mockReturnValueOnce(emailDb).mockReturnValueOnce(releaseDb)
    const emailAttempt = sendPurchaseOrderEmail("project-1", "po-1", {
      to: "vendor@example.com",
      cc: null,
      subject: "Purchase order",
      message: "Please review.",
    })
    await emailReadSignaled

    expect(await releaseNuTechAirlitePurchaseOrder("project-1")).toEqual({
      success: true,
      id: "workflow-1",
    })
    releaseEmailRead()
    expect(await emailAttempt).toEqual({
      success: false,
      error: "This purchase order changed while the email was being prepared. Refresh and try again.",
    })
    expect(mocks.fetch).not.toHaveBeenCalled()

    const storedOrder = await releaseDb
      .select()
      .from(projectOperations)
      .where(eq(projectOperations.id, "po-1"))
      .get()
    const storedWorkflow = await releaseDb
      .select()
      .from(nuTechOrderWorkflows)
      .where(eq(nuTechOrderWorkflows.id, "workflow-1"))
      .get()
    expect(storedOrder?.status).toBe("sent")
    expect(storedOrder?.revision).toBe(1)
    expect(storedWorkflow?.purchaseOrderReleasedAt).toBe(FIXED_NOW)
    expect(storedWorkflow?.orderStatus).toBe("po_released")
    sqlite.close()
  })
})
