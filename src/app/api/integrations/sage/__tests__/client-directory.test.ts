import { readFileSync } from "node:fs"
import { Miniflare } from "miniflare"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { z } from "zod/v4"

const mocks = vi.hoisted(() => ({ getCloudflareContext: vi.fn() }))
vi.mock("server-only", () => ({}))
vi.mock("@/lib/db", () => ({ getCloudflareContext: mocks.getCloudflareContext }))

import { GET, POST } from "../client-directory/route"
import { createSageBridgeSignature } from "@/lib/sage/bridge-auth"

const migration = readFileSync(new URL("../../../../../../drizzle/0173_sage_client_directory_snapshot.sql", import.meta.url), "utf8")
  .split("--> statement-breakpoint").map((statement) => statement.trim()).filter(Boolean)
const base = "https://compass.example.invalid/api/integrations/sage/client-directory"
const secret = "test-only-contact-bridge-secret-12345"
const refreshId = "11111111-1111-4111-8111-111111111111"
const sageId = "22222222-2222-4222-8222-222222222222"
const claimSchema = z.object({ refresh: z.object({
  id: z.string(), claimToken: z.string(), organizationId: z.string(),
}).nullable() })

async function signed(method: "GET" | "POST", body = ""): Promise<Request> {
  const requestId = crypto.randomUUID()
  const timestamp = String(Math.floor(Date.now() / 1000))
  const signature = await createSageBridgeSignature(secret, timestamp, requestId, method,
    "/api/integrations/sage/client-directory", body)
  return new Request(base, { method, body: method === "POST" ? body : undefined,
    headers: { "x-compass-timestamp": timestamp, "x-compass-request-id": requestId,
      "x-compass-signature": signature, ...(method === "POST" ? { "content-type": "application/json" } : {}) } })
}

describe("signed Sage client directory refresh", () => {
  let runtime: Miniflare
  let database: D1Database

  beforeEach(async () => {
    runtime = new Miniflare({ modules: true, compatibilityDate: "2026-06-02",
      script: "export default { fetch() { return new Response('ok') } }", d1Databases: { DB: "sage-directory-test" } })
    database = await runtime.getD1Database("DB")
    await database.batch([
      database.prepare("CREATE TABLE organizations (id TEXT PRIMARY KEY)"),
      database.prepare("CREATE TABLE users (id TEXT PRIMARY KEY)"),
      database.prepare("CREATE TABLE sage_bridge_request_nonces (request_id TEXT PRIMARY KEY, route TEXT, created_at TEXT)"),
      database.prepare("INSERT INTO organizations VALUES ('org-1')"),
    ])
    for (const statement of migration) await database.prepare(statement).run()
    await database.prepare("INSERT INTO sage_client_directory_refreshes (id, organization_id, status, requested_at) VALUES (?, 'org-1', 'queued', ?)")
      .bind(refreshId, new Date().toISOString()).run()
    mocks.getCloudflareContext.mockResolvedValue({ env: {
      DB: database, SAGE_CONTACT_ORGANIZATION_ID: "org-1", SAGE_CONTACT_BRIDGE_SECRET: secret,
    } })
  })
  afterEach(async () => { await runtime.dispose(); vi.clearAllMocks() })

  it("claims once and replaces a complete read-only snapshot without touching Compass customers", async () => {
    const claimResponse = await GET(await signed("GET"))
    expect(claimResponse.status).toBe(200)
    const claim = claimSchema.parse(await claimResponse.json()).refresh
    if (!claim) throw new Error("Expected Sage directory claim")
    expect(claim).toMatchObject({ id: refreshId, organizationId: "org-1" })
    expect(claimSchema.parse(await (await GET(await signed("GET"))).json()).refresh).toBeNull()
    const body = JSON.stringify({ outcome: "succeeded", ...claim, entries: [
      { sageRecordId: sageId, sageClientNumber: "2876", name: "Amaroo LLC", email: null },
    ] })
    const result = await POST(await signed("POST", body))
    expect(result.status).toBe(202)
    expect(await database.prepare("SELECT sage_client_number, name, email FROM sage_client_directory_entries").first())
      .toEqual({ sage_client_number: "2876", name: "Amaroo LLC", email: null })
    expect(await database.prepare("SELECT status FROM sage_client_directory_refreshes WHERE id = ?").bind(refreshId).first())
      .toEqual({ status: "succeeded" })
    expect((await POST(await signed("POST", body))).status).toBe(409)
    const lateFailure = JSON.stringify({ outcome: "failed", ...claim, error: "Late failure" })
    expect((await POST(await signed("POST", lateFailure))).status).toBe(409)
    expect(await database.prepare("SELECT status FROM sage_client_directory_refreshes WHERE id = ?").bind(refreshId).first())
      .toEqual({ status: "succeeded" })
  })

  it("rejects duplicate numbers and preserves the prior snapshot", async () => {
    await database.prepare("INSERT INTO sage_client_directory_entries VALUES ('org-1', ?, '12', 'Prior', NULL, ?)")
      .bind(sageId, new Date().toISOString()).run()
    const claim = claimSchema.parse(await (await GET(await signed("GET"))).json()).refresh
    if (!claim) throw new Error("Expected Sage directory claim")
    const body = JSON.stringify({ outcome: "succeeded", ...claim, entries: [
      { sageRecordId: sageId, sageClientNumber: "2876", name: "First", email: null },
      { sageRecordId: "33333333-3333-4333-8333-333333333333", sageClientNumber: "2876", name: "Duplicate", email: null },
    ] })
    expect((await POST(await signed("POST", body))).status).toBe(400)
    expect(await database.prepare("SELECT sage_client_number FROM sage_client_directory_entries").first())
      .toEqual({ sage_client_number: "12" })
    expect(await database.prepare("SELECT status FROM sage_client_directory_refreshes WHERE id = ?").bind(refreshId).first())
      .toEqual({ status: "failed" })
  })

  it("atomically stores a complete directory across D1 insert chunks", async () => {
    const claim = claimSchema.parse(await (await GET(await signed("GET"))).json()).refresh
    if (!claim) throw new Error("Expected Sage directory claim")
    const entries = Array.from({ length: 501 }, (_, index) => ({
      sageRecordId: crypto.randomUUID(), sageClientNumber: String(1000 + index),
      name: `Test client ${index}`, email: null,
    }))
    const body = JSON.stringify({ outcome: "succeeded", ...claim, entries })
    expect((await POST(await signed("POST", body))).status).toBe(202)
    expect(await database.prepare("SELECT COUNT(*) AS total FROM sage_client_directory_entries").first())
      .toEqual({ total: 501 })
  })
})
