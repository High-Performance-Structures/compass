import { readFileSync } from "node:fs"
import { join } from "node:path"

import { beforeEach, describe, expect, it } from "vitest"

import { d1Over, sqliteDb } from "@/lib/domain/__tests__/sqlite-d1"
import {
  readActivePaymentAllocations,
  readOwnerPayApplicationBalances,
  readProjectReceivables,
  readProjectReceivedPayments,
} from "@/lib/domain/financials/receivables"
import { applyReceivedPayment, voidReceivedPayment } from "@/lib/domain/financials/store"
import type { Db } from "@/lib/server/action-context"

/*
 * The store writes a payment and its allocations in one batch, guarded by the
 * balances the action read. Runs against SQLite with the tables as they stand
 * before 0285, then 0285 itself.
 */

const BASE = `
PRAGMA foreign_keys = ON;
CREATE TABLE organizations (id TEXT PRIMARY KEY);
CREATE TABLE users (id TEXT PRIMARY KEY, display_name TEXT);
CREATE TABLE customers (id TEXT PRIMARY KEY, name TEXT NOT NULL);
CREATE TABLE projects (
  id TEXT PRIMARY KEY, organization_id TEXT, name TEXT NOT NULL,
  client_name TEXT, client_customer_id TEXT REFERENCES customers(id)
);
CREATE UNIQUE INDEX projects_organization_id_unique ON projects (organization_id, id);
CREATE TABLE project_budget_applications (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id),
  source_system TEXT NOT NULL, application_number TEXT NOT NULL, period_to TEXT,
  status TEXT NOT NULL, current_payment_due REAL NOT NULL DEFAULT 0, billed_at TEXT,
  sage_invoice_number TEXT, created_at TEXT NOT NULL, owner_visible INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE invoices (
  id TEXT PRIMARY KEY, organization_id TEXT, customer_id TEXT NOT NULL, project_id TEXT,
  source_system TEXT NOT NULL DEFAULT 'compass', invoice_number TEXT, status TEXT NOT NULL,
  issue_date TEXT NOT NULL, total REAL NOT NULL, amount_paid REAL NOT NULL DEFAULT 0,
  amount_due REAL NOT NULL DEFAULT 0, billing_scope TEXT NOT NULL DEFAULT 'construction',
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX invoices_scope_record_unique ON invoices (organization_id, project_id, id);
CREATE TABLE payments (
  id TEXT PRIMARY KEY, netsuite_id TEXT, organization_id TEXT, customer_id TEXT, vendor_id TEXT, project_id TEXT,
  source_system TEXT NOT NULL DEFAULT 'compass', source_external_id TEXT, payment_type TEXT NOT NULL,
  amount REAL NOT NULL, gross_amount_cents INTEGER, processing_fee_cents INTEGER, net_amount_cents INTEGER,
  cash_receipt INTEGER NOT NULL DEFAULT 1, payment_date TEXT NOT NULL, payment_method TEXT,
  reference_number TEXT, memo TEXT, billing_scope TEXT NOT NULL DEFAULT 'construction',
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX payments_scope_record_unique ON payments (organization_id, project_id, id);
CREATE TABLE invoice_payment_allocations (
  id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, project_id TEXT NOT NULL,
  invoice_id TEXT NOT NULL, payment_id TEXT NOT NULL,
  allocation_cents INTEGER NOT NULL CHECK(typeof(allocation_cents) = 'integer' AND allocation_cents BETWEEN 1 AND 9007199254740991),
  created_at TEXT NOT NULL,
  FOREIGN KEY (organization_id, project_id, invoice_id) REFERENCES invoices(organization_id, project_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, project_id, payment_id) REFERENCES payments(organization_id, project_id, id) ON DELETE RESTRICT,
  UNIQUE (invoice_id, payment_id)
);
INSERT INTO organizations VALUES ('org-1');
INSERT INTO users VALUES ('user-1', 'Ana Staff');
INSERT INTO customers VALUES ('client-1', 'Pat Owner');
INSERT INTO projects VALUES ('p1', 'org-1', 'Ridge House', NULL, 'client-1');
INSERT INTO project_budget_applications VALUES
  ('app-1', 'p1', 'compass_contract_budget', '3', '2026-10-25', 'billed', 10000, '2026-10-26T00:00:00Z', NULL, '2026-10-26', 1),
  ('app-2', 'p1', 'compass_contract_budget', '4', '2026-11-25', 'internal_review', 9000, NULL, NULL, '2026-11-26', 0);
INSERT INTO invoices VALUES
  ('inv-1', 'org-1', 'client-1', 'p1', 'compass', '1001', 'sent', '2026-10-01', 500, 0, 500, 'construction', 'x', 'x');
`

const migration = readFileSync(join(process.cwd(), "drizzle/0285_payment_applications.sql"), "utf8")
const scope = { organizationId: "org-1", projectId: "p1" }
const now = "2026-10-31T12:00:00.000Z"

function newPayment(amountCents: number) {
  return {
    customerId: "client-1", amountCents, paymentDate: "2026-10-31", paymentMethod: "check",
    referenceNumber: "1234", memo: null, billingScope: "construction",
  }
}

function isD1(value: unknown): value is D1Database {
  return typeof value === "object" && value !== null && "batch" in value
}

let db: Db
let d1: D1Database
let sqlite: ReturnType<typeof sqliteDb>["sqlite"]

beforeEach(() => {
  const created = sqliteDb(BASE)
  for (const statement of migration.split("--> statement-breakpoint")) created.sqlite.exec(statement)
  sqlite = created.sqlite
  db = created.db
  const binding = d1Over(created.sqlite)
  if (!isD1(binding)) throw new Error("no D1 binding")
  d1 = binding
})

async function recordSplit(paymentId: string): Promise<string> {
  return applyReceivedPayment(d1, {
    ...scope, paymentId, actorId: "user-1", now,
    newPayment: newPayment(1_050_000),
    expectedAppliedCents: 0,
    allocations: [
      { kind: "pay_application", allocationId: `${paymentId}-a`, applicationId: "app-1", cents: 1_000_000, expectedPaidCents: 0 },
      {
        kind: "invoice", allocationId: `${paymentId}-b`, invoiceId: "inv-1", cents: 50_000, expectedPaidCents: 0,
        invoice: { amountPaid: 500, amountDue: 0, status: "paid" },
      },
    ],
  })
}

describe("received payment store", () => {
  it("writes the payment and its split allocations in one batch", async () => {
    expect(await recordSplit("pay-1")).toBe("saved")
    const items = await readProjectReceivables(db, scope)
    expect(items.map((item) => [item.id, item.paidCents, item.openCents, item.paidState])).toEqual([
      ["app-1", 1_000_000, 0, "paid"],
      ["inv-1", 50_000, 0, "paid"],
    ])
    const [payment] = await readProjectReceivedPayments(db, scope)
    expect(payment).toMatchObject({ amountCents: 1_050_000, appliedCents: 1_050_000, unappliedCents: 0 })
  })

  it("refuses the whole batch when a balance changed after it was read", async () => {
    expect(await recordSplit("pay-1")).toBe("saved")
    // A second payment read the draw before pay-1 landed: expected paid 0, now 10,000.
    const result = await applyReceivedPayment(d1, {
      ...scope, paymentId: "pay-2", actorId: "user-1", now,
      newPayment: newPayment(10_000),
      expectedAppliedCents: 0,
      allocations: [{ kind: "pay_application", allocationId: "pay-2-a", applicationId: "app-1", cents: 10_000, expectedPaidCents: 0 }],
    })
    expect(result).toBe("stale")
    // Nothing from the refused batch was kept, not even the payment row.
    expect(await readProjectReceivedPayments(db, scope)).toHaveLength(1)
  })

  it("refuses a draw that is not billed", async () => {
    const result = await applyReceivedPayment(d1, {
      ...scope, paymentId: "pay-3", actorId: "user-1", now,
      newPayment: newPayment(10_000),
      expectedAppliedCents: 0,
      allocations: [{ kind: "pay_application", allocationId: "pay-3-a", applicationId: "app-2", cents: 10_000, expectedPaidCents: 0 }],
    })
    expect(result).toBe("stale")
  })

  it("voids a payment with its reason, releasing its allocations as history", async () => {
    await recordSplit("pay-1")
    const active = await readActivePaymentAllocations(db, scope, "pay-1")
    expect(active.payApplications).toHaveLength(1)
    expect(active.invoices).toHaveLength(1)
    const voidInput = {
      ...scope, paymentId: "pay-1", actorId: "user-1", reason: "Check returned", now,
      invoiceReleases: [{
        allocationId: "pay-1-b", invoiceId: "inv-1", expectedPaidCents: 50_000,
        invoice: { amountPaid: 0, amountDue: 500, status: "sent" },
      }],
    }
    expect(await voidReceivedPayment(d1, voidInput)).toBe("saved")
    const items = await readProjectReceivables(db, scope)
    expect(items.map((item) => [item.id, item.paidCents, item.paidState])).toEqual([
      ["app-1", 0, "open"],
      ["inv-1", 0, "open"],
    ])
    const [payment] = await readProjectReceivedPayments(db, scope)
    expect(payment).toMatchObject({ voidReason: "Check returned", voidedByName: "Ana Staff", appliedCents: 0, unappliedCents: 0 })
    expect(payment?.allocations.every((allocation) => allocation.released)).toBe(true)
    // Voiding twice is refused, and the released rows stay as they are.
    expect(await voidReceivedPayment(d1, { ...voidInput, invoiceReleases: [] })).toBe("stale")
  })

  it("keeps released allocation history from being deleted with the payment", async () => {
    await recordSplit("pay-1")
    await expect(d1.prepare("DELETE FROM payments WHERE id = 'pay-1'").run()).rejects.toThrow(/FOREIGN KEY/)
  })
})

// Imported (historical) draws as the Sage read ingest and the Drive G702/G703 import store them.
const IMPORTED = `
INSERT INTO project_budget_applications
  (id, project_id, source_system, application_number, period_to, status, current_payment_due, created_at, owner_visible) VALUES
  ('imp-sage', 'p1', 'sage_read_snapshot', 'S-2', '2026-07-31', 'imported_draft', 4000, '2026-10-20', 0),
  ('imp-drive', 'p1', 'google_drive_g702_g703', '5', '2026-08-31', 'current', 2500.5, '2026-10-20', 1),
  ('imp-final', 'p1', 'google_drive_g702_g703', '6', '2026-09-30', 'paid_in_full', 0, '2026-10-20', 1),
  ('imp-void', 'p1', 'sage', '1', '2026-06-30', 'void', 1000, '2026-10-20', 1),
  ('budget-view', 'p1', 'compass_contract_budget_projection', 'Contract Budget R1', NULL, 'budget_current', 50000, '2026-10-20', 1);
`

function payDraw(paymentId: string, applicationId: string, cents: number, expectedPaidCents = 0): Promise<string> {
  return applyReceivedPayment(d1, {
    ...scope, paymentId, actorId: "user-1", now,
    newPayment: newPayment(cents),
    expectedAppliedCents: 0,
    allocations: [{ kind: "pay_application", allocationId: `${paymentId}-a`, applicationId, cents, expectedPaidCents }],
  })
}

describe("imported draws", () => {
  beforeEach(() => {
    sqlite.exec(IMPORTED)
  })

  it("lists imported draws with their source, and says why one can't take payments", async () => {
    const draws = (await readProjectReceivables(db, scope)).filter((item) => item.kind === "pay_application")
    expect(draws.map((item) => [item.id, item.billedCents, item.openCents, item.sourceLabel, item.paymentBlocker !== null])).toEqual([
      ["imp-sage", 400_000, 400_000, "Imported from Sage", false],
      ["imp-drive", 250_050, 250_050, "Imported from Drive", false],
      ["imp-final", 0, 0, "Imported from Drive", true],
      ["app-1", 1_000_000, 1_000_000, null, false],
    ])
    expect(draws.find((item) => item.id === "imp-final")?.paymentBlocker).toMatch(/no current payment due/)
  })

  it("takes a payment on an imported draw, up to its billed amount", async () => {
    expect(await payDraw("pay-d", "imp-drive", 250_000)).toBe("saved")
    const drive = (await readProjectReceivables(db, scope)).find((item) => item.id === "imp-drive")
    expect(drive).toMatchObject({ paidCents: 250_000, openCents: 50, paidState: "partially_paid" })
    // More than the 50 cents still open is refused by the store itself.
    expect(await payDraw("pay-e", "imp-drive", 51, 250_000)).toBe("stale")
    expect(await payDraw("pay-f", "imp-drive", 50, 250_000)).toBe("saved")
  })

  it("refuses imported draws with no billed amount, void draws and budget views", async () => {
    expect(await payDraw("pay-g", "imp-final", 100)).toBe("stale")
    expect(await payDraw("pay-h", "imp-void", 100)).toBe("stale")
    expect(await payDraw("pay-i", "budget-view", 100)).toBe("stale")
  })

  it("shows the owner paid amounts on owner-visible imported draws that take payments", async () => {
    expect(await payDraw("pay-d", "imp-drive", 100_000)).toBe("saved")
    const balances = await readOwnerPayApplicationBalances(db, "p1")
    expect(balances.map((entry) => [entry.applicationId, entry.paidCents, entry.openCents, entry.paidState]).sort()).toEqual([
      ["app-1", 0, 1_000_000, "open"],
      ["imp-drive", 100_000, 150_050, "partially_paid"],
    ])
  })
})
