import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { getTableConfig, type SQLiteTable } from "drizzle-orm/sqlite-core"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { projectBudgetApplications, projectContractDeposits, projectOperations, projects } from "@/db/schema"
import { payApplicationPaymentAllocations } from "@/db/schema-netsuite"

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  requireAuth: vi.fn(),
  requirePermission: vi.fn(),
  recordActivityEvent: vi.fn(),
  assertProjectAccess: vi.fn(),
}))
vi.mock("@/db", () => ({ getDb: mocks.getDb }))
vi.mock("@/lib/auth", () => ({ requireAuth: mocks.requireAuth, getCurrentUser: mocks.requireAuth }))
vi.mock("@/lib/permissions", () => ({ requirePermission: mocks.requirePermission }))
vi.mock("@/lib/activity-log", () => ({ recordActivityEvent: mocks.recordActivityEvent, activityActorName: () => "Estimator" }))
vi.mock("@/lib/db", () => ({ getCloudflareContext: vi.fn(async () => ({ env: { DB: {} } })) }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("@/lib/project-access", () => ({ assertProjectAccess: mocks.assertProjectAccess }))

import {
  approveProjectOwnerPayApplicationForBilling,
  setProjectOwnerPayApplicationSageInvoice,
  undoProjectOwnerPayApplicationBilling,
} from "@/app/actions/pay-application-billing"
import { getProjectDepositRequests } from "@/app/actions/project-contract-deposits"

let sqlite: InstanceType<typeof Database>

function createTable(table: SQLiteTable): void {
  const config = getTableConfig(table)
  const columns = config.columns.map((column) => {
    const value = column.default
    const defaultSql = typeof value === "number" ? ` DEFAULT ${value}` : typeof value === "boolean" ? ` DEFAULT ${Number(value)}` : typeof value === "string" ? ` DEFAULT '${value.replaceAll("'", "''")}'` : ""
    return `"${column.name}" ${column.getSQLType()}${column.primary ? " PRIMARY KEY" : ""}${column.notNull ? " NOT NULL" : ""}${defaultSql}`
  })
  sqlite.exec(`CREATE TABLE "${config.name}" (${columns.join(",")})`)
}

function application(id: string, status: string, createdAt: string) {
  return {
    id, projectId: "bishop", sourceSystem: "compass_contract_budget", applicationNumber: id.replace("app-", ""),
    status, ownerVisible: false, currentPaymentDue: 163_610.98, createdAt, updatedAt: createdAt,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  sqlite = new Database(":memory:")
  for (const table of [projects, projectBudgetApplications, projectOperations, projectContractDeposits, payApplicationPaymentAllocations]) createTable(table)
  const db = drizzle(sqlite)
  db.insert(projects).values({ id: "bishop", name: "Ezell Residence - Bishop Built", projectNumber: "H-430-1900", organizationId: "org", createdAt: "t", updatedAt: "t" }).run()
  db.insert(projectBudgetApplications).values(application("app-1", "internal_review", "2026-10-16")).run()
  mocks.getDb.mockReturnValue({
    select: db.select.bind(db), update: db.update.bind(db), insert: db.insert.bind(db), delete: db.delete.bind(db),
    batch: async (queries: readonly { run(): unknown }[]) => sqlite.transaction(() => queries.map((query) => query.run()))(),
  })
  mocks.requireAuth.mockResolvedValue({ id: "user", role: "admin", organizationId: "org" })
})
afterEach(() => sqlite.close())

function row(id: string) {
  return sqlite.prepare("SELECT status, owner_visible, billed_by, sync_status, sage_invoice_number FROM project_budget_applications WHERE id = ?").get(id)
}

describe("approving a pay application for billing", () => {
  it("marks a reviewed draw billed and publishes it to the owner", async () => {
    expect((await approveProjectOwnerPayApplicationForBilling("bishop", "app-1")).success).toBe(true)
    expect(row("app-1")).toEqual({ status: "billed", owner_visible: 1, billed_by: "user", sync_status: "awaiting_sage_invoice", sage_invoice_number: null })
    expect(mocks.recordActivityEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "pay_application_billed" }))
  })

  it("only approves a draw that is ready for review", async () => {
    sqlite.prepare("UPDATE project_budget_applications SET status = 'draft'").run()
    expect((await approveProjectOwnerPayApplicationForBilling("bishop", "app-1")).success).toBe(false)
    expect(row("app-1")).toMatchObject({ status: "draft", owner_visible: 0 })
  })

  it("records the Sage invoice and blocks undo until it's cleared", async () => {
    await approveProjectOwnerPayApplicationForBilling("bishop", "app-1")
    expect((await setProjectOwnerPayApplicationSageInvoice("bishop", "app-1", " 25031 ")).success).toBe(true)
    expect(row("app-1")).toMatchObject({ sage_invoice_number: "25031", sync_status: "synced" })
    expect((await undoProjectOwnerPayApplicationBilling("bishop", "app-1")).success).toBe(false)
    await setProjectOwnerPayApplicationSageInvoice("bishop", "app-1", "")
    expect((await undoProjectOwnerPayApplicationBilling("bishop", "app-1")).success).toBe(true)
    expect(row("app-1")).toEqual({ status: "internal_review", owner_visible: 0, billed_by: null, sync_status: "needs_review", sage_invoice_number: null })
  })

  it("won't undo while a payment is applied to the draw", async () => {
    await approveProjectOwnerPayApplicationForBilling("bishop", "app-1")
    const insert = sqlite.prepare(
      "INSERT INTO pay_application_payment_allocations (id, organization_id, project_id, application_id, payment_id, allocation_cents, created_at, released_at) VALUES (?, 'org', 'bishop', 'app-1', ?, 100, 't', ?)"
    )
    insert.run("alloc-1", "pay-1", null)
    const blocked = await undoProjectOwnerPayApplicationBilling("bishop", "app-1")
    expect(blocked).toEqual({ success: false, error: "Payments are recorded against this draw. Void them first." })
    sqlite.prepare("UPDATE pay_application_payment_allocations SET released_at = 'voided'").run()
    expect((await undoProjectOwnerPayApplicationBilling("bishop", "app-1")).success).toBe(true)
  })

  it("won't undo once a later draw has been started", async () => {
    await approveProjectOwnerPayApplicationForBilling("bishop", "app-1")
    drizzle(sqlite).insert(projectBudgetApplications).values(application("app-2", "draft", "2026-11-16")).run()
    const result = await undoProjectOwnerPayApplicationBilling("bishop", "app-1")
    expect(result.success).toBe(false)
    expect(row("app-1")).toMatchObject({ status: "billed" })
  })

  it("refuses clients", async () => {
    mocks.requireAuth.mockResolvedValue({ id: "client", role: "client", organizationId: "client-org" })
    expect((await approveProjectOwnerPayApplicationForBilling("bishop", "app-1")).success).toBe(false)
  })
})

describe("deposit requests", () => {
  it("shows clients their requests, numbered in order, keeping voided numbers", async () => {
    mocks.requireAuth.mockResolvedValue({ id: "client", role: "client", organizationId: "client-org" })
    mocks.assertProjectAccess.mockResolvedValue({ id: "bishop", organizationId: "org", projectNumber: "H-430-1900" })
    const db = drizzle(sqlite)
    const base = { projectId: "bishop", sourceSystem: "compass", requestedAt: "2026-10-19", updatedAt: "t" }
    db.insert(projectContractDeposits).values([
      { ...base, id: "first", status: "void", requestedAmountCents: 1_000_00, createdAt: "1" },
      { ...base, id: "second", status: "requested", requestedAmountCents: 25_000_00, dueDate: "2026-11-01", requestMessage: "Due before framing.", notes: "Internal only", createdAt: "2" },
      { ...base, id: "recorded", status: "received", requestedAmountCents: null, requestedAt: null, receivedAmountCents: 5_000_00, createdAt: "3" },
    ]).run()
    const requests = await getProjectDepositRequests("bishop")
    expect(requests).toEqual([
      { id: "second", number: "H-430-1900-DEP-2", status: "requested", amountCents: 25_000_00, requestedAt: "2026-10-19", dueDate: "2026-11-01", receivedAt: null },
    ])
    expect(JSON.stringify(requests)).not.toContain("Internal only")
    expect(mocks.assertProjectAccess).toHaveBeenCalled()
  })
})
