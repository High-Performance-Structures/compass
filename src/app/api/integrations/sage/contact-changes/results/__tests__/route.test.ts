import { drizzle } from "drizzle-orm/d1"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { d1Over } from "@/lib/domain/__tests__/sqlite-d1"
import { migratedDatabase } from "@/lib/domain/contacts/__tests__/directory-seed"
import { isRecord } from "@/lib/shared/guards"

/*
 * Regression for the 2026-11-04 client company read that the writer saw as
 * HTTP 409: Compass stored the client's Sage GUID upper case, the contact
 * writer reads it back from SQL in .NET's lower case, and the exact
 * comparison rejected a genuine read-back. GUID case must not matter; a
 * different record must still be rejected.
 */

const state = vi.hoisted(() => ({ d1: null as unknown }))
const ORG = "org-1"

vi.mock("@/lib/db", () => ({
  getCloudflareContext: async () => ({
    env: { DB: state.d1, SAGE_CONTACT_ORGANIZATION_ID: ORG, SAGE_CONTACT_BRIDGE_SECRET: "test-secret" },
  }),
}))
vi.mock("@/db", () => ({ getDb: (d1: never) => drizzle(d1) }))
vi.mock("@/lib/sage/bridge-auth", async (original) => ({
  ...await original<typeof import("@/lib/sage/bridge-auth")>(),
  getSageContactBridgeSecret: () => "test-secret",
  verifySageBridgeRequest: async () => ({ success: true }),
}))

import { POST } from "@/app/api/integrations/sage/contact-changes/results/route"

const NOW = "2026-11-04T20:13:11.934Z"
const READ_ID = "5d0c1f2e-2222-4333-8444-555566667777"
const CLAIM = "0b6f0c1e-1111-4222-8333-444455556666"
const CLIENT_UPPER = "A1B2C3D4-0000-4000-8000-0000000000AA"
const CLIENT_LOWER = CLIENT_UPPER.toLowerCase()
const VENDOR_ID = "3f2a9c1e-0000-4000-8000-000000000038"

let sqlite: ReturnType<typeof migratedDatabase>

function insert(table: string, row: Record<string, string | number | null>): void {
  const keys = Object.keys(row)
  sqlite.prepare(`INSERT INTO ${table} (${keys.map((key) => `"${key}"`).join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`)
    .run(...Object.values(row))
}

function rows(query: string): Record<string, unknown>[] {
  return sqlite.prepare(query).all().filter(isRecord)
}

const clientFields = {
  addressLine1: "1 Test Rd", addressLine2: null, city: "Springfield", state: "CO", postalCode: "80000",
  billingAddressLine1: null, billingAddressLine2: null, billingCity: null, billingState: null, billingPostalCode: null,
  name: "Client Example", email: "client@example.com", phone: "555-0300",
}
const vendorFields = {
  ownerName: "Pat Owner", addressLine1: "1 Main St", addressLine2: null, city: "Denver", state: "CO",
  postalCode: "80202", primaryEmail: "ap@framing.example", name: "Sage Framing", email: "office@framing.example",
  phone: "555-0100",
}

function readRequest(kind: string, entityId: string, sageRecordId: string, number: string): void {
  insert("sage_contact_read_requests", {
    id: READ_ID, organization_id: ORG, kind, entity_id: entityId, sage_record_id: sageRecordId,
    sage_record_number: number, parent_sage_record_id: null, purpose: "refresh", status: "running",
    claim_token: CLAIM, claimed_at: NOW, requested_at: NOW,
  })
}

let requestCounter = 0
function post(snapshot: Record<string, unknown>): Promise<Response> {
  requestCounter += 1
  return POST(new Request("https://compass.test/api/integrations/sage/contact-changes/results", {
    method: "POST",
    headers: { "content-type": "application/json", "x-compass-request-id": `req-${requestCounter}-${Date.now()}` },
    body: JSON.stringify({ type: "read", result: { outcome: "succeeded", id: READ_ID, claimToken: CLAIM, snapshot } }),
  }))
}

beforeEach(() => {
  sqlite = migratedDatabase()
  sqlite.pragma("foreign_keys = OFF")
  state.d1 = d1Over(sqlite)
  insert("customers", {
    id: "customer-1", organization_id: ORG, name: "Client Example", email: "old@example.com", phone: null,
    sage_client_id: CLIENT_UPPER, sage_client_number: "101", created_at: NOW, updated_at: NOW,
  })
  insert("vendors", {
    id: "vendor-1", organization_id: ORG, name: "Sage Framing", category: "Subcontractor",
    sage_vendor_id: VENDOR_ID, sage_vendor_number: "38", directory_status: "active", created_at: NOW, updated_at: NOW,
  })
})

afterEach(() => sqlite.close())

describe("Sage writer read results", () => {
  it("accepts a client company read-back whose GUID differs only in case", async () => {
    readRequest("client_company", "customer-1", CLIENT_UPPER, "101")
    const response = await post({
      kind: "client_company", entityId: "customer-1", sageRecordId: CLIENT_LOWER, sageRecordNumber: "101",
      parentSageRecordId: null, identityName: "Client Example", revision: "rev-1", fields: clientFields,
    })
    expect(response.status).toBe(202)
    await expect(response.json()).resolves.toEqual({ success: true, status: "succeeded" })
    expect(rows("SELECT status, error_message FROM sage_contact_read_requests"))
      .toEqual([{ status: "succeeded", error_message: null }])
    // The directory keeps the id spelling it stores; the snapshot is stored in canonical lower case.
    expect(rows("SELECT sage_client_id FROM customers")).toEqual([{ sage_client_id: CLIENT_UPPER }])
    expect(rows("SELECT kind, sage_record_id FROM sage_contact_snapshots"))
      .toEqual([{ kind: "client_company", sage_record_id: CLIENT_LOWER }])
  })

  it("accepts a vendor read-back sent upper case against a lower-case link", async () => {
    readRequest("vendor_company", "vendor-1", VENDOR_ID, "38")
    const response = await post({
      kind: "vendor_company", entityId: "vendor-1", sageRecordId: VENDOR_ID.toUpperCase(), sageRecordNumber: "38",
      parentSageRecordId: null, revision: "rev-1", fields: vendorFields,
    })
    expect(response.status).toBe(202)
    expect(rows("SELECT sage_vendor_id FROM vendors")).toEqual([{ sage_vendor_id: VENDOR_ID }])
    expect(rows("SELECT sage_record_id FROM sage_contact_snapshots")).toEqual([{ sage_record_id: VENDOR_ID }])
  })

  it("still rejects a read-back for a different Sage record", async () => {
    readRequest("client_company", "customer-1", CLIENT_UPPER, "101")
    const response = await post({
      kind: "client_company", entityId: "customer-1", sageRecordId: "a1b2c3d4-0000-4000-8000-0000000000ab",
      sageRecordNumber: "101", parentSageRecordId: null, revision: "rev-1", fields: clientFields,
    })
    expect(response.status).toBe(409)
    expect(rows("SELECT status FROM sage_contact_read_requests")).toEqual([{ status: "running" }])
    expect(rows("SELECT count(*) AS n FROM sage_contact_snapshots")).toEqual([{ n: 0 }])
  })
})
