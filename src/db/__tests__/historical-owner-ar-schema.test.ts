import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it, vi } from "vitest"

const actionState = vi.hoisted(() => ({ database: null, inserted: [], updates: [], selectResults: [] }))

vi.mock("@/lib/db", () => ({
  getCloudflareContext: vi.fn(async () => ({ env: { DB: {} } })),
}))
vi.mock("@/db", () => ({ getDb: vi.fn(() => actionState.database) }))
vi.mock("@/lib/auth", () => ({ requireAuth: vi.fn(async () => ({ id: "user-a" })) }))
vi.mock("@/lib/permissions", () => ({ requirePermission: vi.fn() }))
vi.mock("@/lib/org-scope", () => ({ requireOrg: vi.fn(() => "org-auth") }))
vi.mock("@/lib/demo", () => ({ isDemoUser: vi.fn(() => false) }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))

import {
  creditMemos,
  invoiceCreditAllocations,
  invoicePaymentAllocations,
  invoices,
  payments,
} from "@/db/schema-netsuite"
import {
  validateCashSettlementCents,
  validateNonCashCreditSettlement,
  validateOwnerArAllocationCents,
  validateOwnerArSourceIdentity,
  omitOwnerArSourceFields,
} from "@/lib/financials/owner-ar"

type TestStatement = {
  readonly get: (...parameters: unknown[]) => unknown
  readonly run: (...parameters: unknown[]) => unknown
}

type TestDatabase = {
  readonly exec: (sql: string) => void
  readonly prepare: (sql: string) => TestStatement
  readonly close: () => void
}

type TestDatabaseConstructor = new (filename: string) => TestDatabase

const isTestDatabaseConstructor = (
  value: unknown,
): value is TestDatabaseConstructor => typeof value === "function"

async function openDatabase(): Promise<TestDatabase> {
  const sqliteSpecifier = "better-sqlite3"
  const sqliteModule: unknown = await import(sqliteSpecifier)
  if (
    sqliteModule === null ||
    typeof sqliteModule !== "object" ||
    !("default" in sqliteModule) ||
    !isTestDatabaseConstructor(sqliteModule.default)
  ) {
    throw new Error("better-sqlite3 did not provide a Database constructor")
  }
  return new sqliteModule.default(":memory:")
}

const migrationSql = (): string =>
  readFileSync(
    resolve(process.cwd(), "drizzle/0156_historical_owner_ar_relations.sql"),
    "utf8",
  ).replaceAll("--> statement-breakpoint", "")

function createLegacyTables(database: TestDatabase): void {
  database.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE organizations (id TEXT PRIMARY KEY NOT NULL);
    CREATE TABLE projects (id TEXT PRIMARY KEY NOT NULL, organization_id TEXT REFERENCES organizations(id));
    CREATE TABLE customers (id TEXT PRIMARY KEY NOT NULL);
    CREATE TABLE vendors (id TEXT PRIMARY KEY NOT NULL);
    CREATE TABLE invoices (
      id TEXT PRIMARY KEY NOT NULL, netsuite_id TEXT, customer_id TEXT NOT NULL REFERENCES customers(id),
      project_id TEXT REFERENCES projects(id), invoice_number TEXT, status TEXT NOT NULL,
      issue_date TEXT NOT NULL, due_date TEXT, subtotal REAL NOT NULL, tax REAL NOT NULL,
      total REAL NOT NULL, amount_paid REAL NOT NULL, amount_due REAL NOT NULL, memo TEXT,
      line_items TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE payments (
      id TEXT PRIMARY KEY NOT NULL, netsuite_id TEXT, customer_id TEXT REFERENCES customers(id),
      vendor_id TEXT REFERENCES vendors(id), project_id TEXT REFERENCES projects(id),
      payment_type TEXT NOT NULL, amount REAL NOT NULL, payment_date TEXT NOT NULL,
      payment_method TEXT, reference_number TEXT, memo TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE credit_memos (
      id TEXT PRIMARY KEY NOT NULL, netsuite_id TEXT, customer_id TEXT NOT NULL REFERENCES customers(id),
      project_id TEXT REFERENCES projects(id), memo_number TEXT, status TEXT NOT NULL,
      issue_date TEXT NOT NULL, total REAL NOT NULL, amount_applied REAL NOT NULL,
      amount_remaining REAL NOT NULL, memo TEXT, line_items TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
  `)
  database.exec(migrationSql())
  database.exec(`
    INSERT INTO organizations (id) VALUES ('org-a'), ('org-b');
    INSERT INTO projects (id, organization_id) VALUES
      ('project-a', 'org-a'), ('project-b', 'org-b'),
      ('project-invoice-guard', 'org-b'), ('project-payment-guard', 'org-b'),
      ('project-credit-guard', 'org-b'), ('project-legacy', 'org-b');
    INSERT INTO customers (id) VALUES ('customer-a');
  `)
}

const invoiceInsert = (database: TestDatabase, id = "invoice-a", organizationId = "org-a", projectId = "project-a", sourceExternalId = "bt-invoice-1"): void => {
  database.prepare(`
    INSERT INTO invoices (
      id, customer_id, project_id, organization_id, source_system, source_external_id,
      status, issue_date, subtotal, tax, total, amount_paid, amount_due, created_at, updated_at
    ) VALUES (?, 'customer-a', ?, ?, 'buildertrend', ?, 'open', '2026-09-01', 100, 0, 100, 0, 100, 'now', 'now')
  `).run(id, projectId, organizationId, sourceExternalId)
}

const paymentInsert = (database: TestDatabase, id = "payment-a", organizationId = "org-a", projectId = "project-a", sourceExternalId = "bt-payment-1"): void => {
  database.prepare(`
    INSERT INTO payments (
      id, customer_id, project_id, organization_id, source_system, source_external_id,
      payment_type, amount, gross_amount_cents, processing_fee_cents, net_amount_cents,
      cash_receipt, payment_date, created_at, updated_at
    ) VALUES (?, 'customer-a', ?, ?, 'buildertrend', ?, 'owner_receipt', 100, 10000, 300, 9700, 1, '2026-09-01', 'now', 'now')
  `).run(id, projectId, organizationId, sourceExternalId)
}

const creditInsert = (database: TestDatabase, id = "credit-a", organizationId = "org-a", projectId = "project-a", sourceExternalId = "bt-credit-1"): void => {
  database.prepare(`
    INSERT INTO credit_memos (
      id, customer_id, project_id, organization_id, source_system, source_external_id,
      status, issue_date, total, amount_applied, amount_remaining, created_at, updated_at
    ) VALUES (?, 'customer-a', ?, ?, 'buildertrend', ?, 'open', '2026-09-01', 10915, 10915, 0, 'now', 'now')
  `).run(id, projectId, organizationId, sourceExternalId)
}

describe("historical owner AR schema", () => {
  it("strips forged owner AR identity fields at financial action boundaries", async () => {
    actionState.database = {
      insert: () => ({ values: async (value: unknown) => { actionState.inserted.push(value) } }),
      select: () => ({
        from: () => {
          const where = () => ({ limit: async () => actionState.selectResults.shift() ?? [{ projectId: "project-a" }] })
          return { where, innerJoin: () => ({ where }) }
        },
      }),
      update: () => ({
        set: (value: unknown) => ({ where: async () => { actionState.updates.push(value) } }),
      }),
    }
    const invoiceActions = await import("@/app/actions/invoices")
    const paymentActions = await import("@/app/actions/payments")
    const creditActions = await import("@/app/actions/credit-memos")

    await invoiceActions.createInvoice({
      customerId: "customer-a", status: "draft", issueDate: "2026-09-01",
      subtotal: 1, tax: 0, total: 1, amountPaid: 0, amountDue: 1,
      organizationId: "attacker-org", sourceSystem: "buildertrend", sourceExternalId: "forged-invoice",
    })
    await paymentActions.createPayment({
      customerId: "customer-a", paymentType: "owner_receipt", amount: 1,
      paymentDate: "2026-09-01", organizationId: "attacker-org", sourceSystem: "buildertrend", sourceExternalId: "forged-payment",
    })
    await creditActions.createCreditMemo({
      customerId: "customer-a", status: "draft", issueDate: "2026-09-01",
      total: 1, amountApplied: 0, amountRemaining: 1,
      organizationId: "attacker-org", sourceSystem: "buildertrend", sourceExternalId: "forged-credit",
    })
    expect(actionState.inserted).toHaveLength(3)
    for (const value of actionState.inserted) {
      expect(value.organizationId).toBe("org-auth")
      expect(value.sourceSystem).toBe("compass")
      expect("sourceExternalId" in value).toBe(false)
    }

    await invoiceActions.updateInvoice("invoice-a", { organizationId: "attacker-org", sourceSystem: "manual", sourceExternalId: "overwrite-invoice", memo: "kept" })
    await paymentActions.updatePayment("payment-a", { organizationId: "attacker-org", sourceSystem: "manual", sourceExternalId: "overwrite-payment", memo: "kept" })
    await creditActions.updateCreditMemo("credit-a", { organizationId: "attacker-org", sourceSystem: "manual", sourceExternalId: "overwrite-credit", memo: "kept" })
    expect(actionState.updates).toHaveLength(3)
    for (const value of actionState.updates) {
      expect("organizationId" in value).toBe(false)
      expect("sourceSystem" in value).toBe(false)
      expect("sourceExternalId" in value).toBe(false)
      expect(value.memo).toBe("kept")
    }

    actionState.selectResults = [[{ projectId: "project-a" }], []]
    expect(await invoiceActions.updateInvoice("invoice-a", { projectId: "other-org-project" })).toEqual({ success: false, error: "Project not found or access denied" })
    actionState.selectResults = [[{ projectId: "project-a" }], []]
    expect(await paymentActions.updatePayment("payment-a", { projectId: "other-org-project" })).toEqual({ success: false, error: "Project not found or access denied" })
    actionState.selectResults = [[{ projectId: "project-a" }], []]
    expect(await creditActions.updateCreditMemo("credit-a", { projectId: "other-org-project" })).toEqual({ success: false, error: "Project not found or access denied" })
    expect(actionState.updates).toHaveLength(3)
  })

  it("exposes native identity, settlement, and allocation fields", () => {
    expect(invoices.organizationId.name).toBe("organization_id")
    expect(invoices.sourceExternalId.name).toBe("source_external_id")
    expect(payments.grossAmountCents.name).toBe("gross_amount_cents")
    expect(payments.processingFeeCents.name).toBe("processing_fee_cents")
    expect(payments.netAmountCents.name).toBe("net_amount_cents")
    expect(payments.cashReceipt.name).toBe("cash_receipt")
    expect(creditMemos.cashReceipt.name).toBe("cash_receipt")
    expect(invoicePaymentAllocations.allocationCents.name).toBe("allocation_cents")
    expect(invoiceCreditAllocations.creditMemoId.name).toBe("credit_memo_id")
  })

  it("validates source identity and integer-cent settlement invariants", () => {
    expect(omitOwnerArSourceFields({
      organizationId: "attacker-org",
      sourceSystem: "buildertrend",
      sourceExternalId: "forged-source",
      invoiceNumber: "manual-invoice",
    })).toEqual({ invoiceNumber: "manual-invoice" })
    expect(validateOwnerArSourceIdentity({
      organizationId: "org-a",
      projectId: "project-a",
      sourceSystem: "buildertrend",
      sourceExternalId: "15973591",
    }).ok).toBe(true)
    expect(validateOwnerArSourceIdentity({
      organizationId: "org-a",
      projectId: "project-a",
      sourceSystem: "netsuite",
      sourceExternalId: "legacy-1",
    }).ok).toBe(false)
    expect(validateCashSettlementCents({ cashReceipt: true, grossAmountCents: 10000, processingFeeCents: 300, netAmountCents: 9700 }).ok).toBe(true)
    expect(validateCashSettlementCents({ cashReceipt: true, grossAmountCents: 10000, processingFeeCents: 301, netAmountCents: 9700 }).ok).toBe(false)
    expect(validateCashSettlementCents({ cashReceipt: true, grossAmountCents: Number.MAX_SAFE_INTEGER + 1, processingFeeCents: 0, netAmountCents: 0 }).ok).toBe(false)
    expect(validateNonCashCreditSettlement({ cashReceipt: false, appliedAmountCents: 1091500 }).ok).toBe(true)
    expect(validateNonCashCreditSettlement({ cashReceipt: true, appliedAmountCents: 1091500 }).ok).toBe(false)
    expect(validateOwnerArAllocationCents(1).ok).toBe(true)
    expect(validateOwnerArAllocationCents(0).ok).toBe(false)
  })

  it("enforces source uniqueness, settlement checks, and scoped allocation references", async () => {
    const database = await openDatabase()
    try {
      createLegacyTables(database)
      invoiceInsert(database)
      paymentInsert(database)
      expect(() => invoiceInsert(database, "invoice-duplicate")).toThrow()
      expect(() => database.prepare(`
        INSERT INTO invoices (
          id, customer_id, project_id, source_system, source_external_id,
          status, issue_date, subtotal, tax, total, amount_paid, amount_due, created_at, updated_at
        ) VALUES ('invoice-unscoped', 'customer-a', 'project-a', 'buildertrend', 'bt-unscoped', 'open', '2026-09-01', 1, 0, 1, 0, 1, 'now', 'now')
      `).run()).toThrow(/requires non-empty id and exact organization\/project scope/)
      expect(() => invoiceInsert(database, "invoice-cross-org", "org-b", "project-a", "bt-cross-org")).toThrow(/exact organization\/project scope/)
      expect(() => paymentInsert(database, "payment-cross-org", "org-b", "project-a", "bt-payment-cross-org")).toThrow(/exact organization\/project scope/)
      expect(() => creditInsert(database, "credit-cross-org", "org-b", "project-a", "bt-credit-cross-org")).toThrow(/exact organization\/project scope/)
      expect(() => invoiceInsert(database, "invoice-empty-source", "org-a", "project-a", "")).toThrow(/non-empty id/)
      expect(() => database.prepare(`
        INSERT INTO invoices (
          id, customer_id, status, issue_date, subtotal, tax, total, amount_paid, amount_due, created_at, updated_at
        ) VALUES ('invoice-legacy-null-scope', 'customer-a', 'open', '2026-09-01', 1, 0, 1, 0, 1, 'now', 'now')
      `).run()).not.toThrow()
      invoiceInsert(database, "invoice-b", "org-b", "project-b", "bt-invoice-1")
      paymentInsert(database, "payment-b", "org-b", "project-b", "bt-payment-2")
      invoiceInsert(database, "invoice-project-guard", "org-b", "project-invoice-guard", "bt-project-guard-invoice")
      paymentInsert(database, "payment-project-guard", "org-b", "project-payment-guard", "bt-project-guard-payment")
      creditInsert(database, "credit-project-guard", "org-b", "project-credit-guard", "bt-project-guard-credit")
      expect(() => database.prepare("UPDATE projects SET organization_id = organization_id WHERE id = 'project-b'").run()).not.toThrow()
      expect(() => database.prepare("UPDATE projects SET organization_id = NULL WHERE id = 'project-invoice-guard'").run()).toThrow(/conflicts with sourced AR identity/)
      expect(() => database.prepare("UPDATE projects SET organization_id = NULL WHERE id = 'project-payment-guard'").run()).toThrow(/conflicts with sourced AR identity/)
      expect(() => database.prepare("UPDATE projects SET organization_id = NULL WHERE id = 'project-credit-guard'").run()).toThrow(/conflicts with sourced AR identity/)
      database.prepare("INSERT INTO invoices (id, customer_id, project_id, status, issue_date, subtotal, tax, total, amount_paid, amount_due, created_at, updated_at) VALUES ('invoice-project-legacy', 'customer-a', 'project-legacy', 'open', '2026-09-01', 1, 0, 1, 0, 1, 'now', 'now')").run()
      expect(() => database.prepare("UPDATE projects SET organization_id = 'org-a' WHERE id = 'project-legacy'").run()).not.toThrow()
      expect(() => paymentInsert(database, "payment-invalid", "org-a", "project-a", "bt-payment-invalid")).not.toThrow()
      expect(() => database.prepare(`
        UPDATE payments SET gross_amount_cents = 10000.5 WHERE id = 'payment-invalid'
      `).run()).toThrow()
      expect(() => database.prepare(`
        UPDATE payments SET gross_amount_cents = 9007199254740992 WHERE id = 'payment-invalid'
      `).run()).toThrow()
      expect(() => database.prepare(`
        UPDATE payments SET gross_amount_cents = 10000, processing_fee_cents = 301, net_amount_cents = 9700 WHERE id = 'payment-invalid'
      `).run()).toThrow()
      expect(() => database.prepare(`
        INSERT INTO credit_memos (
          id, customer_id, project_id, organization_id, source_system, source_external_id,
          cash_receipt, status, issue_date, total, amount_applied, amount_remaining, created_at, updated_at
        ) VALUES ('credit-a', 'customer-a', 'project-a', 'org-a', 'buildertrend', '65080', 1, 'open', '2026-09-01', 10915, 10915, 0, 'now', 'now')
      `).run()).toThrow()
      creditInsert(database, "credit-a", "org-a", "project-a", "65080")
      expect(() => database.prepare("UPDATE invoices SET source_system = 'netsuite' WHERE id = 'invoice-a'").run()).toThrow()
      expect(() => database.prepare("UPDATE payments SET source_system = 'netsuite' WHERE id = 'payment-a'").run()).toThrow()
      expect(() => database.prepare("UPDATE credit_memos SET source_system = 'netsuite' WHERE id = 'credit-a'").run()).toThrow()
      database.prepare(`
        INSERT INTO invoice_payment_allocations (id, organization_id, project_id, invoice_id, payment_id, allocation_cents, created_at)
        VALUES ('allocation-payment-a', 'org-a', 'project-a', 'invoice-a', 'payment-a', 9700, 'now')
      `).run()
      database.prepare(`
        INSERT INTO invoice_credit_allocations (id, organization_id, project_id, invoice_id, credit_memo_id, allocation_cents, created_at)
        VALUES ('allocation-credit-a', 'org-a', 'project-a', 'invoice-a', 'credit-a', 1091500, 'now')
      `).run()
      expect(() => database.prepare(`
        INSERT INTO invoice_payment_allocations (id, organization_id, project_id, invoice_id, payment_id, allocation_cents, created_at)
        VALUES ('allocation-cross-project', 'org-a', 'project-a', 'invoice-a', 'payment-b', 1, 'now')
      `).run()).toThrow()
      expect(() => database.prepare(`
        INSERT INTO invoice_payment_allocations (id, organization_id, project_id, invoice_id, payment_id, allocation_cents, created_at)
        VALUES ('allocation-fractional', 'org-a', 'project-a', 'invoice-a', 'payment-a', 1.5, 'now')
      `).run()).toThrow()
      expect(() => database.prepare(`
        INSERT INTO invoice_payment_allocations (id, organization_id, project_id, invoice_id, payment_id, allocation_cents, created_at)
        VALUES ('allocation-unsafe', 'org-a', 'project-a', 'invoice-a', 'payment-a', 9007199254740992, 'now')
      `).run()).toThrow()
      expect(() => database.prepare("DELETE FROM invoices WHERE id = 'invoice-a'").run()).toThrow()
    } finally {
      database.close()
    }
  })
})
