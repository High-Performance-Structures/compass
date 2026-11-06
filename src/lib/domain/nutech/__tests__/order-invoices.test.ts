import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { getTableConfig, type SQLiteTable } from "drizzle-orm/sqlite-core"
import { beforeEach, describe, expect, it } from "vitest"

import { nuTechOrderInvoices, nuTechOrderWorkflows } from "@/db/schema-nutech"
import { addNuTechOrderInvoice, deleteNuTechOrderInvoice } from "@/lib/domain/nutech/store"
import type { Db } from "@/lib/server/action-context"

let sqlite: InstanceType<typeof Database>
let db: Db

function createTable(table: SQLiteTable): void {
  const config = getTableConfig(table)
  const columns = config.columns.map((column) => {
    const value = column.default
    const defaultSql = typeof value === "number" ? ` DEFAULT ${value}` : typeof value === "boolean" ? ` DEFAULT ${Number(value)}` : typeof value === "string" ? ` DEFAULT '${value}'` : ""
    return `"${column.name}" ${column.getSQLType()}${column.primary ? " PRIMARY KEY" : ""}${column.notNull ? " NOT NULL" : ""}${defaultSql}`
  })
  sqlite.exec(`CREATE TABLE "${config.name}" (${columns.join(",")})`)
}

function order(): { readonly orderStatus: string; readonly vendorInvoiceStatus: string; readonly vendorInvoiceReceivedAt: string | null } {
  return sqlite
    .prepare("SELECT order_status AS orderStatus, vendor_invoice_status AS vendorInvoiceStatus, vendor_invoice_received_at AS vendorInvoiceReceivedAt FROM nutech_order_workflows WHERE id = 'o1'")
    .get() as never
}

function invoice(id: string, number: string, kind: "invoice" | "freight" | "credit_memo" = "invoice") {
  return {
    row: { id, workflowId: "o1", vendorId: null, kind, invoiceNumber: number, amountCents: null, receivedOn: "2026-10-22", createdBy: null, createdAt: "t", updatedAt: "t" },
    userId: "u1",
    now: "2026-11-06T18:00:00.000Z",
  }
}

beforeEach(() => {
  sqlite = new Database(":memory:")
  createTable(nuTechOrderWorkflows)
  createTable(nuTechOrderInvoices)
  sqlite.exec(`INSERT INTO nutech_order_workflows (id, project_id, customer_type, pricing_mode, quantity_source, order_status, created_at, updated_at)
    VALUES ('o1', 'p1', 'new', 'standard', 'customer_provided', 'vendor_confirmed', 't', 't')`)
  const local = drizzle(sqlite)
  // better-sqlite3 has no D1 batch; running the statements in order is enough here.
  const batch = async (statements: readonly PromiseLike<unknown>[]) => {
    const results: unknown[] = []
    for (const statement of statements) results.push(await statement)
    return results
  }
  db = Object.assign(local, { batch }) as unknown as Db
})

describe("order invoices", () => {
  it("marks the order's invoice received with the first invoice only", async () => {
    await addNuTechOrderInvoice(db, invoice("i1", "258670-EPS"))
    expect(order()).toEqual({ orderStatus: "invoice_received", vendorInvoiceStatus: "received", vendorInvoiceReceivedAt: "2026-10-22" })
    await addNuTechOrderInvoice(db, { ...invoice("i2", "INV1263", "freight"), row: { ...invoice("i2", "INV1263", "freight").row, receivedOn: "2026-11-01" } })
    expect(order().vendorInvoiceReceivedAt).toBe("2026-10-22")
  })

  it("rejects an unknown kind", async () => {
    await expect(addNuTechOrderInvoice(db, { ...invoice("i1", "X"), row: { ...invoice("i1", "X").row, kind: "bill" as never } })).rejects.toThrow()
  })

  it("puts the order back to waiting only when its last unreleased invoice is removed", async () => {
    await addNuTechOrderInvoice(db, invoice("i1", "258670-EPS"))
    await addNuTechOrderInvoice(db, invoice("i2", "CM 256539-EPS", "credit_memo"))
    expect(await deleteNuTechOrderInvoice(db, { workflowId: "o1", invoiceId: "i2", userId: "u1", now: "n" })).toBe(true)
    expect(order().vendorInvoiceStatus).toBe("received")
    expect(await deleteNuTechOrderInvoice(db, { workflowId: "o1", invoiceId: "i1", userId: "u1", now: "n" })).toBe(true)
    expect(order()).toEqual({ orderStatus: "vendor_confirmed", vendorInvoiceStatus: "not_received", vendorInvoiceReceivedAt: null })
    expect(await deleteNuTechOrderInvoice(db, { workflowId: "o1", invoiceId: "i1", userId: "u1", now: "n" })).toBe(false)
  })
})
