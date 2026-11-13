import Database from "better-sqlite3"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { eq } from "drizzle-orm"

import { getDb } from "@/db"
import { invoices } from "@/db/schema-netsuite"
import { d1Over } from "@/lib/domain/__tests__/sqlite-d1"
import {
  receivedPaymentMachine,
  simpleInvoiceMachine,
  SQUARE_LINK_LEASE_MS,
  squareLinkMachine,
} from "@/lib/domain/financials/invoice-machines"
import { invoicePaidValues, invoiceUnpaidStatus } from "@/lib/domain/financials/rules"
import {
  applyReceivedPayment,
  cancelSquareInvoiceLink,
  failSquareInvoiceLink,
  finalizeSimpleInvoice,
  publishSquareInvoiceLink,
  refreshInvoicePaidStatusStatement,
  reopenSimpleInvoice,
  simpleInvoiceUpdateStatement,
  startSquareInvoiceLink,
  updateUnappliedPaymentRow,
  voidSimpleInvoice,
} from "@/lib/domain/financials/store"
import type { Db } from "@/lib/server/action-context"
import { availableEvents, machineProblems } from "@/lib/shared/state-machine"

/*
 * Money coming in on simple invoices (issue #1329, money sweep): the
 * invoice, Square link and payment machines, the store's compare-and-set
 * writes against a database built from every migration (two staff, a late
 * Square payment, a double click), and a guard that no invoice status write
 * bypasses the store.
 */

describe("simple invoice machines", () => {
  it("are well formed", () => {
    expect(machineProblems(simpleInvoiceMachine)).toEqual([])
    expect(machineProblems(squareLinkMachine)).toEqual([])
    expect(machineProblems(receivedPaymentMachine)).toEqual([])
  })

  it("void is final and only an open invoice can be voided or reopened", () => {
    expect(availableEvents(simpleInvoiceMachine, "void")).toEqual([])
    expect(availableEvents(simpleInvoiceMachine, "draft")).toEqual(["finalize"])
    expect(availableEvents(simpleInvoiceMachine, "partially_paid")).not.toContain("void")
    expect(availableEvents(simpleInvoiceMachine, "paid")).not.toContain("reopen")
  })

  it("a Square link is cancelled only by a void, and a cancelled one never restarts", () => {
    expect(availableEvents(squareLinkMachine, "canceled")).toEqual([])
    expect(availableEvents(squareLinkMachine, "published")).toEqual(["cancel"])
  })

  it("releasing the last payment returns a simple invoice to open, never the old 'sent'", () => {
    expect(invoiceUnpaidStatus("compass", "nutech_sale")).toBe("open")
    expect(invoiceUnpaidStatus("compass", null)).toBe("sent")
    expect(invoicePaidValues({ totalDollars: 100, paidCents: 0, unpaidStatus: invoiceUnpaidStatus("compass", "other") }).status).toBe("open")
  })
})

// ---------------------------------------------------------------------------
// Store writes against a migrated database.
// ---------------------------------------------------------------------------

type Sqlite = InstanceType<typeof Database>
const NOW = "2026-11-12T12:00:00.000Z"
let sqlite: Sqlite
let db: Db
let d1: D1Database
let migratedImage: Buffer | null = null

function migrated(): Sqlite {
  if (!migratedImage) {
    const image = new Database(":memory:")
    const dir = join(process.cwd(), "drizzle")
    for (const file of readdirSync(dir).filter((name) => /^\d{4}_.*\.sql$/.test(name)).sort()) {
      image.exec(readFileSync(join(dir, file), "utf8").replaceAll("--> statement-breakpoint", ""))
    }
    migratedImage = image.serialize()
    image.close()
  }
  return new Database(migratedImage)
}

function isD1(value: unknown): value is D1Database {
  return typeof value === "object" && value !== null && "prepare" in value
}

function row(id: string): Record<string, unknown> {
  const found: unknown = sqlite.prepare("SELECT status, square_state, amount_paid, amount_due, invoice_number FROM invoices WHERE id = ?").get(id)
  if (typeof found !== "object" || found === null) throw new Error(`no invoice ${id}`)
  return { ...found }
}

const key = (invoiceId: string) => ({ invoiceId, organizationId: "org-1", projectId: "p1" })

describe("simple invoice status writes", () => {
  beforeEach(() => {
    sqlite = migrated()
    sqlite.exec(`
      INSERT INTO organizations (id, name, slug, type, is_active, created_at, updated_at) VALUES ('org-1', 'Org', 'org', 'internal', 1, '${NOW}', '${NOW}');
      INSERT INTO users (id, email, created_at, updated_at) VALUES ('u1', 'a@example.com', '${NOW}', '${NOW}'), ('u2', 'b@example.com', '${NOW}', '${NOW}');
      INSERT INTO projects (id, name, organization_id, created_at) VALUES ('p1', 'Job', 'org-1', '${NOW}');
      INSERT INTO customers (id, name, organization_id, created_at) VALUES ('c1', 'Owner', 'org-1', '${NOW}');
      INSERT INTO invoices (id, organization_id, customer_id, project_id, source_system, status, issue_date, total, amount_due, invoice_kind, created_at, updated_at) VALUES
        ('draft-a', 'org-1', 'c1', 'p1', 'compass', 'draft', '2026-11-12', 100, 100, 'other', '${NOW}', '${NOW}'),
        ('draft-b', 'org-1', 'c1', 'p1', 'compass', 'draft', '2026-11-12', 100, 100, 'other', '${NOW}', '${NOW}'),
        ('open-1', 'org-1', 'c1', 'p1', 'compass', 'open', '2026-11-12', 100, 100, 'other', '${NOW}', '${NOW}');
    `)
    const binding = d1Over(sqlite)
    if (!isD1(binding)) throw new Error("test binding")
    d1 = binding
    db = getDb(binding)
  })
  afterEach(() => sqlite.close())

  it("two invoices finalized at once never share a number; the second is told to take the next", async () => {
    const finalize = (invoiceId: string, sequenceNumber: number) =>
      finalizeSimpleInvoice(db, { ...key(invoiceId), sequenceNumber, invoiceNumber: `P1-INV0${sequenceNumber}`, actorId: "u1", now: NOW })
    expect(await finalize("draft-a", 1)).toBe("finalized")
    expect(await finalize("draft-b", 1)).toBe("number_taken")
    expect(row("draft-b").status).toBe("draft")
    expect(await finalize("draft-b", 2)).toBe("finalized")
    // A double click on finalize: the second finds it already final.
    expect(await finalize("draft-b", 3)).toBe("changed")
    expect(row("draft-b").invoice_number).toBe("P1-INV02")
  })

  it("two staff voiding at once: one void lands", async () => {
    const input = { ...key("open-1"), reason: "Duplicate", actorId: "u1", now: NOW }
    expect(await voidSimpleInvoice(db, input)).toBe(true)
    expect(await voidSimpleInvoice(db, { ...input, actorId: "u2" })).toBe(false)
    expect(row("open-1")).toMatchObject({ status: "void", amount_due: 0 })
    expect(await reopenSimpleInvoice(db, { ...key("open-1"), now: NOW })).toBe(false)
  })

  it("a payment recorded from a screen read before the void is refused, and the void stands", async () => {
    expect(await voidSimpleInvoice(db, { ...key("open-1"), reason: "Wrong job", actorId: "u1", now: NOW })).toBe(true)
    const result = await applyReceivedPayment(d1, {
      organizationId: "org-1", projectId: "p1", paymentId: "pay-1", actorId: "u2", now: NOW,
      newPayment: { customerId: "c1", amountCents: 10000, paymentDate: "2026-11-12", paymentMethod: "check", referenceNumber: "1001", memo: null, billingScope: "construction" },
      expectedAppliedCents: 0,
      allocations: [{
        kind: "invoice", allocationId: "alloc-1", invoiceId: "open-1", cents: 10000, expectedPaidCents: 0,
        invoice: { amountPaid: 100, amountDue: 0, status: "paid" },
      }],
    })
    expect(result).toBe("stale")
    expect(row("open-1")).toMatchObject({ status: "void", amount_paid: 0 })
    expect(sqlite.prepare("SELECT count(*) AS n FROM payments").get()).toEqual({ n: 0 })
  })

  it("an invoice with a payment applied can't be voided or reopened", async () => {
    sqlite.exec(`UPDATE invoices SET amount_paid = 40, amount_due = 60 WHERE id = 'open-1'`)
    expect(await voidSimpleInvoice(db, { ...key("open-1"), reason: "x", actorId: "u1", now: NOW })).toBe(false)
    expect(await reopenSimpleInvoice(db, { ...key("open-1"), now: NOW })).toBe(false)
  })

  it("a late Square payment on a voided invoice is recorded but never un-voids it", async () => {
    sqlite.exec(`
      UPDATE invoices SET status = 'void', amount_due = 0 WHERE id = 'open-1';
      INSERT INTO payments (id, organization_id, customer_id, project_id, source_system, payment_type, amount, payment_date, created_at, updated_at)
        VALUES ('sq-pay', 'org-1', 'c1', 'p1', 'sage', 'received', 100, '2026-11-12', '${NOW}', '${NOW}');
      INSERT INTO invoice_payment_allocations (id, organization_id, project_id, invoice_id, payment_id, allocation_cents, created_at)
        VALUES ('sq-alloc', 'org-1', 'p1', 'open-1', 'sq-pay', 10000, '${NOW}');
    `)
    await refreshInvoicePaidStatusStatement(d1, { invoiceId: "open-1", organizationId: "org-1", projectId: "p1", now: NOW }).run()
    expect(row("open-1")).toMatchObject({ status: "void", amount_paid: 100, amount_due: 0 })
  })

  it("a double click on Email with Square starts one Square invoice", async () => {
    sqlite.exec(`UPDATE invoices SET square_requested = 1 WHERE id = 'open-1'`)
    expect(await startSquareInvoiceLink(db, { ...key("open-1"), now: NOW })).toBe(true)
    expect(await startSquareInvoiceLink(db, { ...key("open-1"), now: NOW })).toBe(false)
    // A request that died leaves it pending; after the lease another may start it again.
    const later = new Date(Date.parse(NOW) + SQUARE_LINK_LEASE_MS + 1000).toISOString()
    expect(await startSquareInvoiceLink(db, { ...key("open-1"), now: later })).toBe(true)
    expect(await publishSquareInvoiceLink(db, { ...key("open-1"), publicUrl: "https://square.example/pay", now: later })).toBe(true)
    expect(await failSquareInvoiceLink(db, { ...key("open-1"), error: "late", now: later })).toBe(false)
    expect(row("open-1").square_state).toBe("published")
  })

  it("a Square invoice finished after the void is not published; only a void cancels the link", async () => {
    expect(await startSquareInvoiceLink(db, { ...key("open-1"), now: NOW })).toBe(true)
    expect(await cancelSquareInvoiceLink(db, { ...key("open-1"), now: NOW })).toBe(false)
    expect(await voidSimpleInvoice(db, { ...key("open-1"), reason: "x", actorId: "u1", now: NOW })).toBe(true)
    expect(await publishSquareInvoiceLink(db, { ...key("open-1"), publicUrl: "https://square.example/pay", now: NOW })).toBe(false)
    expect(await cancelSquareInvoiceLink(db, { ...key("open-1"), now: NOW })).toBe(true)
    expect(row("open-1").square_state).toBe("canceled")
    expect(await startSquareInvoiceLink(db, { ...key("open-1"), now: NOW })).toBe(false)
  })

  it("plain invoice updates refuse a status or Square state", () => {
    const patch = { memo: "x" }
    Reflect.set(patch, "status", "paid")
    expect(() => simpleInvoiceUpdateStatement(db, eq(invoices.id, "open-1"), patch)).toThrow(/status functions/)
    expect(() => simpleInvoiceUpdateStatement(db, eq(invoices.id, "open-1"), { squareState: "published" })).toThrow(/status functions/)
  })

  it("a legacy payment edit loses to an allocation made after its read", async () => {
    sqlite.exec(`
      INSERT INTO payments (id, organization_id, customer_id, project_id, source_system, payment_type, amount, payment_date, created_at, updated_at)
        VALUES ('pay-2', 'org-1', 'c1', 'p1', 'compass', 'received', 50, '2026-11-12', '${NOW}', '${NOW}');
    `)
    expect(await updateUnappliedPaymentRow(db, "pay-2", { amount: 60, updatedAt: NOW })).toBe(true)
    sqlite.exec(`INSERT INTO invoice_payment_allocations (id, organization_id, project_id, invoice_id, payment_id, allocation_cents, created_at)
      VALUES ('alloc-2', 'org-1', 'p1', 'open-1', 'pay-2', 6000, '${NOW}')`)
    expect(await updateUnappliedPaymentRow(db, "pay-2", { amount: 70, updatedAt: NOW })).toBe(false)
    expect(sqlite.prepare("SELECT amount FROM payments WHERE id = 'pay-2'").get()).toEqual({ amount: 60 })
  })
})

// ---------------------------------------------------------------------------
// Guard: invoice status writes go through financials/store.ts.
// ---------------------------------------------------------------------------

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return name === "__tests__" ? [] : sourceFiles(path)
    return /\.(ts|tsx)$/.test(name) ? [path] : []
  })
}

let sources: ReadonlyMap<string, string> | null = null
function sourceTree(): ReadonlyMap<string, string> {
  sources ??= new Map(sourceFiles("src").map((file) => [file, readFileSync(file, "utf8")]))
  return sources
}

describe("invoice status write guard", { timeout: 30_000 }, () => {
  it("only the financials store writes invoices and payments", () => {
    const writers = [...sourceTree()].filter(([, source]) =>
      /\.(update|insert|delete)\((schema\.)?(invoices|payments)\)|(UPDATE|INSERT INTO|DELETE FROM)\s+(invoices|payments)\b/.test(source),
    ).map(([file]) => file)
    expect(writers).toEqual(["src/lib/domain/financials/store.ts"])
  })

  it("no caller passes a status or Square state to the plain invoice update", () => {
    const offenders = [...sourceTree()].filter(([file, source]) => {
      if (file === "src/lib/domain/financials/store.ts") return false
      return /simpleInvoiceUpdateStatement\([^)]*\b(status|squareState):/s.test(source)
    }).map(([file]) => file)
    expect(offenders).toEqual([])
  })

  it("the store's simple invoice and Square link status writes read the machines and compare-and-set", () => {
    const store = readFileSync("src/lib/domain/financials/store.ts", "utf8")
    // The two helpers write the target state from the machine and fence on its source states.
    expect(store).toContain("status: simpleInvoiceMachine.transitions[event].to")
    expect(store).toContain("inArray(invoices.status, [...simpleInvoiceMachine.transitions[event].from])")
    expect(store).toContain("squareState: squareLinkMachine.transitions[event].to")
    expect(store).toContain("inArray(invoices.squareState, [...squareLinkMachine.transitions[event].from])")
    // Every other invoice update in the store leaves status alone, except paid-state writes.
    const literal = store.match(/\bstatus: "(draft|open|partially_paid|paid|void)"/g) ?? []
    expect(literal).toEqual([])
    for (const name of ["finalizeSimpleInvoice", "reopenSimpleInvoice", "voidSimpleInvoice"]) {
      const body = store.slice(store.indexOf(`export async function ${name}`))
      expect(body.slice(0, body.indexOf("\n}\n"))).toContain("moveSimpleInvoice(db, key, ")
    }
    for (const name of ["startSquareInvoiceLink", "publishSquareInvoiceLink", "failSquareInvoiceLink", "cancelSquareInvoiceLink"]) {
      const body = store.slice(store.indexOf(`export async function ${name}`))
      expect(body.slice(0, body.indexOf("\n}\n"))).toContain("moveSquareLink(db, key, ")
    }
    // Paid-state writes never move a draft or void invoice.
    expect(store).toContain("PAID_STATUS_UNLESS_CLOSED")
    expect(store).toContain("WHEN status IN (${CLOSED_TO_PAYMENTS_SQL}) THEN status")
    expect(store).toContain("${INVOICE_TAKES_PAYMENTS}")
  })
})
