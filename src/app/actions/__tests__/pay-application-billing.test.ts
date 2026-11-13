import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { getTableConfig, type SQLiteTable } from "drizzle-orm/sqlite-core"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { projectBudgetApplications, projectContractDeposits, projectOperations, projects } from "@/db/schema"
import { payApplicationPaymentAllocations } from "@/db/schema-netsuite"
import { sageArInvoiceExports, sageDepositArExports } from "@/db/schema-sage"

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  requireAuth: vi.fn(),
  requirePermission: vi.fn(),
  recordActivityEvent: vi.fn(),
  assertProjectAccess: vi.fn(),
}))
vi.mock("@/db", () => ({ getDb: mocks.getDb }))
vi.mock("@/lib/auth", () => ({ requireAuth: mocks.requireAuth, getCurrentUser: mocks.requireAuth }))
vi.mock("@/lib/permissions", () => ({ requirePermission: mocks.requirePermission, can: () => true }))
vi.mock("@/lib/activity-log", () => ({ recordActivityEvent: mocks.recordActivityEvent, activityActorName: () => "Estimator" }))
vi.mock("@/lib/db", () => ({ getCloudflareContext: vi.fn(async () => ({ env: { DB: {} } })) }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("@/lib/domain/project/access", () => ({ assertProjectAccess: mocks.assertProjectAccess }))

import {
  approveProjectOwnerPayApplicationForBilling,
  confirmProjectOwnerPayApplicationNotInSage,
  setProjectOwnerPayApplicationSageInvoice,
  undoProjectOwnerPayApplicationBilling,
} from "@/app/actions/pay-application-billing"
import { getProjectDepositRequests, saveProjectContractDeposit, voidProjectContractDeposit } from "@/app/actions/project-contract-deposits"
import { confirmProjectDepositNotInSage } from "@/app/actions/project-deposit-sage"
import { loadDepositSageExports } from "@/lib/financials/deposit-sage"

let sqlite: InstanceType<typeof Database>
// Runs once before the next batch: a write that lands between a read and its batch.
let beforeNextBatch: (() => void) | null = null

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
  for (const table of [projects, projectBudgetApplications, projectOperations, projectContractDeposits, payApplicationPaymentAllocations, sageArInvoiceExports, sageDepositArExports]) createTable(table)
  const db = drizzle(sqlite)
  db.insert(projects).values({ id: "bishop", name: "Ezell Residence - Bishop Built", projectNumber: "H-430-1900", organizationId: "org", createdAt: "t", updatedAt: "t" }).run()
  db.insert(projectBudgetApplications).values(application("app-1", "internal_review", "2026-10-16")).run()
  mocks.getDb.mockReturnValue({
    select: db.select.bind(db), update: db.update.bind(db), insert: db.insert.bind(db), delete: db.delete.bind(db),
    // D1 reports a write's changes under meta.
    all: db.all.bind(db), run: (query: Parameters<typeof db.run>[0]) => ({ meta: { changes: db.run(query).changes } }),
    batch: async (queries: readonly { run(): unknown }[]) => {
      const hook = beforeNextBatch
      beforeNextBatch = null
      hook?.()
      return sqlite.transaction(() => queries.map((query) => query.run()))()
    },
  })
  mocks.requireAuth.mockResolvedValue({ id: "user", role: "admin", organizationId: "org" })
})
afterEach(() => sqlite.close())

/** The version of the draw staff have open. */
function seen(id: string): string {
  const stored: unknown = sqlite.prepare("SELECT updated_at FROM project_budget_applications WHERE id = ?").get(id)
  return String(Reflect.get(Object(stored), "updated_at"))
}

function row(id: string) {
  return sqlite.prepare("SELECT status, owner_visible, billed_by, sync_status, sage_invoice_number FROM project_budget_applications WHERE id = ?").get(id)
}

describe("approving a pay application for billing", () => {
  it("marks a reviewed draw billed and publishes it to the owner", async () => {
    expect((await approveProjectOwnerPayApplicationForBilling("bishop", "app-1", seen("app-1"))).success).toBe(true)
    expect(row("app-1")).toEqual({ status: "billed", owner_visible: 1, billed_by: "user", sync_status: "awaiting_sage_invoice", sage_invoice_number: null })
    expect(mocks.recordActivityEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "pay_application_billed" }))
  })

  it("only approves a draw that is ready for review", async () => {
    sqlite.prepare("UPDATE project_budget_applications SET status = 'draft'").run()
    expect((await approveProjectOwnerPayApplicationForBilling("bishop", "app-1", seen("app-1"))).success).toBe(false)
    expect(row("app-1")).toMatchObject({ status: "draft", owner_visible: 0 })
  })

  it("records the Sage invoice and blocks undo until it's cleared", async () => {
    await approveProjectOwnerPayApplicationForBilling("bishop", "app-1", seen("app-1"))
    expect((await setProjectOwnerPayApplicationSageInvoice("bishop", "app-1", " 25031 ")).success).toBe(true)
    expect(row("app-1")).toMatchObject({ sage_invoice_number: "25031", sync_status: "synced" })
    expect((await undoProjectOwnerPayApplicationBilling("bishop", "app-1")).success).toBe(false)
    await setProjectOwnerPayApplicationSageInvoice("bishop", "app-1", "")
    expect((await undoProjectOwnerPayApplicationBilling("bishop", "app-1")).success).toBe(true)
    expect(row("app-1")).toEqual({ status: "internal_review", owner_visible: 0, billed_by: null, sync_status: "needs_review", sage_invoice_number: null })
  })

  it("won't undo while a payment is applied to the draw", async () => {
    await approveProjectOwnerPayApplicationForBilling("bishop", "app-1", seen("app-1"))
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
    await approveProjectOwnerPayApplicationForBilling("bishop", "app-1", seen("app-1"))
    drizzle(sqlite).insert(projectBudgetApplications).values(application("app-2", "draft", "2026-11-16")).run()
    const result = await undoProjectOwnerPayApplicationBilling("bishop", "app-1")
    expect(result.success).toBe(false)
    expect(row("app-1")).toMatchObject({ status: "billed" })
  })

  it("two approvals at once bill it once: one Activity entry, one Sage request", async () => {
    const results = await Promise.all([
      approveProjectOwnerPayApplicationForBilling("bishop", "app-1", seen("app-1")),
      approveProjectOwnerPayApplicationForBilling("bishop", "app-1", seen("app-1")),
    ])
    expect(results.filter((result) => result.success)).toHaveLength(1)
    expect(results.find((result) => !result.success)).toMatchObject({ error: expect.stringMatching(/already approved/) })
    expect(mocks.recordActivityEvent.mock.calls.filter(([event]) => event.action === "pay_application_billed")).toHaveLength(1)
    expect(row("app-1")).toMatchObject({ status: "billed", owner_visible: 1 })
  })

  it("taking back the approval and recording a Sage invoice at once never leaves an invoiced draw in review", async () => {
    await approveProjectOwnerPayApplicationForBilling("bishop", "app-1", seen("app-1"))
    const [undo, record] = await Promise.all([
      undoProjectOwnerPayApplicationBilling("bishop", "app-1"),
      setProjectOwnerPayApplicationSageInvoice("bishop", "app-1", "25031"),
    ])
    // Exactly one wins, and the row agrees with it.
    expect([undo.success, record.success].filter(Boolean)).toHaveLength(1)
    expect(row("app-1")).toMatchObject(undo.success ? { status: "internal_review", sage_invoice_number: null } : { status: "billed", sage_invoice_number: "25031" })
  })

  describe("taking back billing with a Sage AR invoice export", () => {
    function exportRow(status: string, sageRecordId: string | null = null): void {
      sqlite.prepare(
        "INSERT INTO sage_ar_invoice_exports (id, organization_id, project_id, application_id, status, invoice_number, automatic, requested_at, attempt_count, sage_record_id, updated_at) VALUES ('exp', 'org', 'bishop', 'app-1', ?, 'H-430-1900-PR01', 1, 't', 0, ?, 't')"
      ).run(status, sageRecordId)
    }
    function exportStatus(): unknown {
      return sqlite.prepare("SELECT status FROM sage_ar_invoice_exports WHERE id = 'exp'").get()
    }

    it("cancels a queued export together with the undo", async () => {
      await approveProjectOwnerPayApplicationForBilling("bishop", "app-1", seen("app-1"))
      exportRow("queued")
      expect((await undoProjectOwnerPayApplicationBilling("bishop", "app-1")).success).toBe(true)
      expect(exportStatus()).toEqual({ status: "cancelled" })
    })

    it("leaves the queued export alone when the undo is refused", async () => {
      await approveProjectOwnerPayApplicationForBilling("bishop", "app-1", seen("app-1"))
      exportRow("queued")
      // A Sage invoice number is recorded after the undo's checks, before its write.
      beforeNextBatch = () => sqlite.prepare("UPDATE project_budget_applications SET sage_invoice_number = '25031' WHERE id = 'app-1'").run()
      const result = await undoProjectOwnerPayApplicationBilling("bishop", "app-1")
      expect(result.success).toBe(false)
      expect(row("app-1")).toMatchObject({ status: "billed" })
      expect(exportStatus()).toEqual({ status: "queued" })
    })

    it("refuses while the export is running, done, or recorded by Sage, and changes nothing", async () => {
      for (const [status, sageRecordId] of [["running", null], ["succeeded", null], ["failed", "AR-77"]] as const) {
        sqlite.prepare("DELETE FROM sage_ar_invoice_exports").run()
        sqlite.prepare("UPDATE project_budget_applications SET status = 'internal_review'").run()
        await approveProjectOwnerPayApplicationForBilling("bishop", "app-1", seen("app-1"))
        exportRow(status, sageRecordId)
        const result = await undoProjectOwnerPayApplicationBilling("bishop", "app-1")
        expect(result).toMatchObject({ success: false, error: expect.stringMatching(/void the invoice in Sage/) })
        expect(row("app-1")).toMatchObject({ status: "billed" })
        expect(exportStatus()).toEqual({ status })
      }
    })

    it("refuses when a payment is recorded or a later draw started after the undo's checks", async () => {
      await approveProjectOwnerPayApplicationForBilling("bishop", "app-1", seen("app-1"))
      exportRow("queued")
      beforeNextBatch = () => sqlite.prepare(
        "INSERT INTO pay_application_payment_allocations (id, organization_id, project_id, application_id, payment_id, allocation_cents, created_at, released_at) VALUES ('alloc-x', 'org', 'bishop', 'app-1', 'pay-x', 100, 't', NULL)"
      ).run()
      expect((await undoProjectOwnerPayApplicationBilling("bishop", "app-1")).success).toBe(false)
      expect(row("app-1")).toMatchObject({ status: "billed" })
      expect(exportStatus()).toEqual({ status: "queued" })
      sqlite.prepare("UPDATE pay_application_payment_allocations SET released_at = 'voided'").run()
      beforeNextBatch = () => drizzle(sqlite).insert(projectBudgetApplications).values(application("app-2", "draft", "2026-11-16")).run()
      expect((await undoProjectOwnerPayApplicationBilling("bishop", "app-1")).success).toBe(false)
      expect(row("app-1")).toMatchObject({ status: "billed" })
    })

    it("a writer failure that may have reached Sage blocks undo until staff check Sage", async () => {
      await approveProjectOwnerPayApplicationForBilling("bishop", "app-1", seen("app-1"))
      exportRow("failed")
      // The writer's own result (it holds its claim) for a run Sage may have taken.
      sqlite.prepare("UPDATE sage_ar_invoice_exports SET claim_token = 'lease-1', error_message = 'Sage timed out after saving' WHERE id = 'exp'").run()
      expect(await undoProjectOwnerPayApplicationBilling("bishop", "app-1")).toMatchObject({ success: false, error: expect.stringMatching(/void the invoice in Sage/) })
      expect(row("app-1")).toMatchObject({ status: "billed" })

      // "I checked Sage: it isn't there": staff only, recorded in Activity, nothing sent to Sage.
      mocks.requireAuth.mockResolvedValueOnce({ id: "client", role: "client", organizationId: "client-org" })
      expect((await confirmProjectOwnerPayApplicationNotInSage("bishop", "app-1")).success).toBe(false)
      expect((await confirmProjectOwnerPayApplicationNotInSage("bishop", "app-1")).success).toBe(true)
      expect(mocks.recordActivityEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "pay_application_sage_checked_absent" }))
      expect(sqlite.prepare("SELECT status, claim_token FROM sage_ar_invoice_exports WHERE id = 'exp'").get()).toEqual({ status: "failed", claim_token: null })
      // A second check finds nothing to clear (compare-and-set on "possibly in Sage").
      expect((await confirmProjectOwnerPayApplicationNotInSage("bishop", "app-1")).success).toBe(false)

      expect((await undoProjectOwnerPayApplicationBilling("bishop", "app-1")).success).toBe(true)
      expect(exportStatus()).toEqual({ status: "cancelled" })
    })

    it("the Sage check waits out a live writer claim on an export voided while sending", async () => {
      await approveProjectOwnerPayApplicationForBilling("bishop", "app-1", seen("app-1"))
      exportRow("needs_attention")
      const recent = new Date(Date.now() - 60_000).toISOString()
      sqlite.prepare("UPDATE sage_ar_invoice_exports SET claim_token = 'lease-1', claimed_at = ?, error_message = 'Voided while Sage was adding it; check Sage.' WHERE id = 'exp'").run(recent)
      expect((await confirmProjectOwnerPayApplicationNotInSage("bishop", "app-1")).success).toBe(false)
      expect(sqlite.prepare("SELECT claim_token FROM sage_ar_invoice_exports WHERE id = 'exp'").get()).toEqual({ claim_token: "lease-1" })
      // Once the claim is stale, staff may record the check.
      sqlite.prepare("UPDATE sage_ar_invoice_exports SET claimed_at = ? WHERE id = 'exp'").run(new Date(Date.now() - 11 * 60_000).toISOString())
      expect((await confirmProjectOwnerPayApplicationNotInSage("bishop", "app-1")).success).toBe(true)
    })

    it("the Sage check never clears an export Sage has or is adding", async () => {
      await approveProjectOwnerPayApplicationForBilling("bishop", "app-1", seen("app-1"))
      for (const [status, sageRecordId] of [["running", null], ["succeeded", "AR-77"], ["queued", null]] as const) {
        sqlite.prepare("DELETE FROM sage_ar_invoice_exports").run()
        exportRow(status, sageRecordId)
        expect((await confirmProjectOwnerPayApplicationNotInSage("bishop", "app-1")).success).toBe(false)
        expect(exportStatus()).toEqual({ status })
      }
    })

    it("refuses when Sage starts adding the invoice after the undo's checks", async () => {
      await approveProjectOwnerPayApplicationForBilling("bishop", "app-1", seen("app-1"))
      exportRow("queued")
      beforeNextBatch = () => sqlite.prepare("UPDATE sage_ar_invoice_exports SET status = 'running' WHERE id = 'exp'").run()
      expect((await undoProjectOwnerPayApplicationBilling("bishop", "app-1")).success).toBe(false)
      expect(row("app-1")).toMatchObject({ status: "billed" })
      expect(exportStatus()).toEqual({ status: "running" })
    })
  })

  it("bills only the version staff reviewed", async () => {
    // Opened before Sage's amounts were applied.
    const stale = await approveProjectOwnerPayApplicationForBilling("bishop", "app-1", "2026-10-15")
    expect(stale).toMatchObject({ success: false, error: expect.stringMatching(/changed since you opened it/) })
    // Changed between the approval's read and its write.
    beforeNextBatch = () => sqlite.prepare("UPDATE project_budget_applications SET current_payment_due = 1, updated_at = 'later' WHERE id = 'app-1'").run()
    expect((await approveProjectOwnerPayApplicationForBilling("bishop", "app-1", "2026-10-16")).success).toBe(false)
    expect(row("app-1")).toMatchObject({ status: "internal_review", owner_visible: 0 })
  })

  it("refuses clients", async () => {
    mocks.requireAuth.mockResolvedValue({ id: "client", role: "client", organizationId: "client-org" })
    expect((await approveProjectOwnerPayApplicationForBilling("bishop", "app-1", seen("app-1"))).success).toBe(false)
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
      { id: "second", number: "H-430-1900-DEP2", status: "requested", amountCents: 25_000_00, requestedAt: "2026-10-19", dueDate: "2026-11-01", receivedAt: null },
    ])
    expect(JSON.stringify(requests)).not.toContain("Internal only")
    expect(mocks.assertProjectAccess).toHaveBeenCalled()
  })
})

describe("voiding and saving a deposit", () => {
  beforeEach(() => {
    sqlite.exec(`
      INSERT INTO project_contract_deposits (id, project_id, status, requested_amount_cents, requested_at, source_system, created_at, updated_at)
        VALUES ('dep', 'bishop', 'requested', 2500000, '2026-10-19', 'compass', 't', 't0');
      INSERT INTO sage_deposit_ar_exports (id, organization_id, project_id, deposit_id, status, invoice_number, requested_at, attempt_count, updated_at)
        VALUES ('dexp', 'org', 'bishop', 'dep', 'queued', 'H-430-1900-DEP1', 't', 0, 't');
    `)
  })
  function deposit(): unknown {
    return sqlite.prepare("SELECT status FROM project_contract_deposits WHERE id = 'dep'").get()
  }
  function depositExport(): unknown {
    return sqlite.prepare("SELECT status FROM sage_deposit_ar_exports WHERE id = 'dexp'").get()
  }

  it("staff can record that a deposit invoice possibly in Sage isn't there; nothing else changes", async () => {
    sqlite.prepare("UPDATE sage_deposit_ar_exports SET status = 'failed', claim_token = 'lease-1', error_message = 'Sage timed out after saving'").run()
    mocks.requireAuth.mockResolvedValueOnce({ id: "client", role: "client", organizationId: "client-org" })
    expect((await confirmProjectDepositNotInSage("bishop", "dep")).success).toBe(false)
    // Staff outside the company's own organization (no Sage access, like the UI) can't either.
    expect((await confirmProjectDepositNotInSage("bishop", "dep")).success).toBe(false)
    mocks.requireAuth.mockResolvedValue({ id: "user", role: "admin", organizationId: "org", organizationType: "internal" })
    expect(await confirmProjectDepositNotInSage("bishop", "dep")).toEqual({ success: true, data: { depositId: "dep" } })
    expect(mocks.recordActivityEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "deposit_sage_checked_absent" }))
    expect(sqlite.prepare("SELECT status, claim_token FROM sage_deposit_ar_exports WHERE id = 'dexp'").get()).toEqual({ status: "failed", claim_token: null })
    expect(deposit()).toEqual({ status: "requested" })
    // Nothing left to clear.
    expect((await confirmProjectDepositNotInSage("bishop", "dep")).success).toBe(false)
  })

  it("voiding a deposit whose invoice Sage may have keeps that signal: the note shows and the Sage check stays offered", async () => {
    sqlite.prepare("UPDATE sage_deposit_ar_exports SET status = 'failed', claim_token = 'lease-1', error_message = 'Sage timed out after saving'").run()
    const result = await voidProjectContractDeposit("bishop", "dep")
    expect(result).toMatchObject({ success: true, note: expect.stringMatching(/check Sage/) })
    expect(deposit()).toEqual({ status: "void" })
    // Not cancelled: still possibly in Sage, so "I checked Sage: it isn't there" is still offered.
    expect(sqlite.prepare("SELECT status, claim_token FROM sage_deposit_ar_exports WHERE id = 'dexp'").get()).toEqual({ status: "failed", claim_token: "lease-1" })
    expect((await loadDepositSageExports(mocks.getDb(), "org", "bishop")).get("dep")?.possiblyInSage).toBe(true)
  })

  it("withdraws the queued Sage AR invoice only once the void lands", async () => {
    expect((await voidProjectContractDeposit("bishop", "dep")).success).toBe(true)
    expect(deposit()).toEqual({ status: "void" })
    expect(depositExport()).toEqual({ status: "cancelled" })
  })

  it("a void refused because the deposit changed meanwhile leaves its Sage AR invoice queued", async () => {
    beforeNextBatch = null
    // A payment is recorded after the void's checks: simulated on the next write.
    sqlite.exec(`
      CREATE TRIGGER pay_first BEFORE UPDATE OF status ON project_contract_deposits
      WHEN NEW.status = 'void' AND OLD.updated_at = 't0'
      BEGIN SELECT RAISE(IGNORE); END;
    `)
    const result = await voidProjectContractDeposit("bishop", "dep")
    expect(result).toMatchObject({ success: false, error: expect.stringMatching(/changed/) })
    expect(deposit()).toEqual({ status: "requested" })
    expect(depositExport()).toEqual({ status: "queued" })
  })

  it("a save that started before a void doesn't bring the deposit back", async () => {
    const input = { status: "received" as const, requestedAmount: 25_000, requestedAt: "2026-10-19", dueDate: null, receivedAmount: 25_000, receivedAt: "2026-10-20", paymentMethod: "check", reference: null, evidenceUrl: null, evidenceLabel: null, notes: null }
    // Voided between the save's read and its write.
    sqlite.exec(`
      CREATE TRIGGER void_first BEFORE UPDATE OF status ON project_contract_deposits
      WHEN NEW.status = 'received'
      BEGIN UPDATE project_contract_deposits SET status = 'void', updated_at = 't1' WHERE id = NEW.id; SELECT RAISE(IGNORE); END;
    `)
    const result = await saveProjectContractDeposit("bishop", "dep", input)
    expect(result.success).toBe(false)
    expect(deposit()).toEqual({ status: "void" })
  })
})

