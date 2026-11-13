import { drizzle } from "drizzle-orm/d1"
import { beforeEach, describe, expect, it } from "vitest"

import { d1Over } from "@/lib/domain/__tests__/sqlite-d1"
import { migratedDatabase } from "@/lib/domain/contacts/__tests__/directory-seed"
import { sageClientWriteResultCustomerStatement } from "@/lib/domain/contacts/store"
import { failedJobWriteClient } from "@/lib/sage/job-write-client"
import type { Db } from "@/lib/server/action-context"

/*
 * A merge archives a client without moving its failed Sage job write, so a
 * resend follows the merged-into pointer to the kept client; and a Sage result
 * for a client another Compass client already holds links the job anyway.
 * Runs against a database built from every migration.
 */

const ORG = "org-1"
const NOW = "2026-11-08T00:00:00.000Z"

let sqlite: ReturnType<typeof migratedDatabase>
let d1: D1Database
let db: Db

function insertCustomer(row: Record<string, string | null>): void {
  const values = { organization_id: ORG, created_at: NOW, updated_at: NOW, ...row }
  const keys = Object.keys(values)
  sqlite.prepare(`INSERT INTO customers (${keys.map((key) => `"${key}"`).join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`)
    .run(...Object.values(values))
}

const payload = JSON.stringify({
  operationType: "ensure_client_and_job",
  company: "High Performance Structures Inc",
  client: { compassCustomerId: "dup", sageClientId: null, sageClientNumber: null, name: "Acme Dev", shortName: "Acme Dev" },
  job: { compassProjectId: "p1", compassProjectNumber: "H-1", name: "H-1 Job", shortName: "H-1 Job" },
})

beforeEach(() => {
  sqlite = migratedDatabase()
  sqlite.pragma("foreign_keys = OFF")
  // @ts-expect-error The test binding implements only what drizzle's D1 driver calls.
  d1 = d1Over(sqlite)
  db = drizzle(d1)
  insertCustomer({ id: "kept", name: "Acme Homes, LLC", company: "Acme Development", phone: "303-555-0100", sage_client_id: "ABC", sage_client_number: "101" })
  insertCustomer({ id: "middle", name: "Acme Development", merged_into_customer_id: "kept" })
  insertCustomer({ id: "dup", name: "Acme Dev", merged_into_customer_id: "middle" })
})

describe("failedJobWriteClient", () => {
  it("resends a write left on a merged client for the kept client, with its details and Sage client", async () => {
    const resolved = await failedJobWriteClient(db, { organizationId: ORG, customerId: "dup", payloadJson: payload })
    expect(resolved.ok).toBe(true)
    if (!resolved.ok) return
    expect(resolved.customer?.id).toBe("kept")
    expect(resolved.movedFromCustomerId).toBe("dup")
    const next: unknown = JSON.parse(resolved.payloadJson)
    expect(next).toMatchObject({
      operationType: "ensure_client_and_job",
      client: {
        compassCustomerId: "kept", sageClientId: "ABC", sageClientNumber: "101",
        name: "Acme Homes, LLC", phone: "303-555-0100", billingAddress: null,
      },
      job: { compassProjectId: "p1", name: "H-1 Job" },
    })
  })

  it("leaves a write whose client was not merged unchanged", async () => {
    const resolved = await failedJobWriteClient(db, { organizationId: ORG, customerId: "kept", payloadJson: payload })
    expect(resolved).toMatchObject({ ok: true, movedFromCustomerId: null, payloadJson: payload })
  })

  it("stops on a merge loop instead of following it forever", async () => {
    sqlite.prepare("UPDATE customers SET merged_into_customer_id = 'dup' WHERE id = 'kept'").run()
    const resolved = await failedJobWriteClient(db, { organizationId: ORG, customerId: "dup", payloadJson: payload })
    expect(resolved.ok).toBe(false)
  })
})

describe("sageClientWriteResultCustomerStatement", () => {
  it("skips the link when another client holds the Sage client, so the rest of the batch still applies", async () => {
    insertCustomer({ id: "other", name: "Acme (new)" })
    const [link] = await d1.batch([
      sageClientWriteResultCustomerStatement(d1, { customerId: "other", sageClientId: "abc", sageClientNumber: "101", sageClientStatusId: 2, now: NOW }),
    ])
    expect(link?.meta.changes).toBe(0)
    expect(sqlite.prepare("SELECT sage_client_number AS n FROM customers WHERE id = 'other'").get()).toEqual({ n: null })
  })

  it("links a client nobody else holds", async () => {
    insertCustomer({ id: "other", name: "Another client" })
    const [link] = await d1.batch([
      sageClientWriteResultCustomerStatement(d1, { customerId: "other", sageClientId: "XYZ", sageClientNumber: "700", sageClientStatusId: 2, now: NOW }),
    ])
    expect(link?.meta.changes).toBe(1)
  })
})
