import { readFileSync } from "node:fs"
import { Miniflare } from "miniflare"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import { handleSageContactCreateResult } from "@/lib/sage/contact-create-result"

const migration = readFileSync(
  new URL("../../../../drizzle/0171_sage_contact_create_review.sql", import.meta.url),
  "utf8"
).split("--> statement-breakpoint").map((statement) => statement.trim()).filter(Boolean)
// "Request add to Sage" (0310): its table and the proposal's compass_person_id; nothing else of 0310 is part of this test.
const addRequests = readFileSync(
  new URL("../../../../drizzle/0310_sage_directory_add_requests.sql", import.meta.url),
  "utf8"
).split("--> statement-breakpoint").map((statement) => statement.trim())
  .filter((statement) => /^(?:--[^\n]*\n)*(?:CREATE[^`]*`sage_directory_add_requests|ALTER TABLE `sage_contact_create_proposals`)/.test(statement))

const foundation = [
  "CREATE TABLE organizations (id TEXT PRIMARY KEY)",
  "CREATE TABLE users (id TEXT PRIMARY KEY)",
  "CREATE TABLE customers (id TEXT PRIMARY KEY, organization_id TEXT, sage_client_id TEXT)",
  "CREATE TABLE vendors (id TEXT PRIMARY KEY, organization_id TEXT, sage_vendor_id TEXT, directory_status TEXT)",
  `CREATE TABLE customer_contacts (id TEXT PRIMARY KEY, customer_id TEXT, name TEXT NOT NULL,
    title TEXT, email TEXT, phone TEXT, phone_extension TEXT, cell_phone TEXT,
    sage_contact_id TEXT, sage_line_number INTEGER, is_primary INTEGER, active INTEGER,
    source_system TEXT, sync_status TEXT, last_synced_at TEXT, created_at TEXT, updated_at TEXT)`,
  `CREATE TABLE vendor_contacts (id TEXT PRIMARY KEY, vendor_id TEXT, name TEXT NOT NULL,
    title TEXT, email TEXT, phone TEXT, phone_extension TEXT, cell_phone TEXT,
    sage_contact_id TEXT, sage_line_number INTEGER, is_primary INTEGER, active INTEGER,
    source_system TEXT, created_at TEXT, updated_at TEXT)`,
  `CREATE TABLE sage_contact_snapshots (id TEXT PRIMARY KEY, organization_id TEXT, kind TEXT,
    entity_id TEXT, sage_record_id TEXT, parent_sage_record_id TEXT, revision TEXT,
    fields_json TEXT, captured_at TEXT)`,
]

const proposalId = "11111111-1111-4111-8111-111111111111"
const claimToken = "22222222-2222-4222-8222-222222222222"
const fields = {
  name: "Test Person", title: "Estimator", phone: "5550100",
  phoneExtension: "123", email: "test@example.invalid", cellPhone: "5550101",
}
const now = "2026-09-24T23:00:00.000Z"

describe("Sage child Add result reconciliation", () => {
  let runtime: Miniflare
  let database: D1Database

  beforeEach(async () => {
    runtime = new Miniflare({
      modules: true,
      compatibilityDate: "2026-06-02",
      script: "export default { fetch() { return new Response('ok') } }",
      d1Databases: { DB: "contact-result-test" },
    })
    database = await runtime.getD1Database("DB")
    await database.batch(foundation.map((statement) => database.prepare(statement)))
    for (const statement of [...migration, ...addRequests]) await database.prepare(statement).run()
    await database.batch([
      database.prepare("INSERT INTO organizations VALUES ('org-1')"),
      database.prepare("INSERT INTO users VALUES ('requester')"),
      database.prepare("INSERT INTO customers VALUES ('customer-1', 'org-1', 'parent-sage-id')"),
    ])
    await database.prepare(
      `INSERT INTO sage_contact_create_proposals
       (id, organization_id, kind, customer_id, parent_sage_record_id, fields_json,
        dedupe_key, status, requested_by_user_id, requested_at, updated_at,
        claim_token, claimed_at, attempt_count)
       VALUES (?, 'org-1', 'client_person', 'customer-1', 'parent-sage-id', ?,
        'dedupe', 'running', 'requester', ?, ?, ?, ?, 1)`
    ).bind(proposalId, JSON.stringify(fields), now, now, claimToken, now).run()
  })

  afterEach(async () => { await runtime.dispose() })

  it("inserts one canonical person and snapshot after exact Sage read-back", async () => {
    const result = await handleSageContactCreateResult(
      { SAGE_CONTACT_ORGANIZATION_ID: "org-1" }, database,
      { outcome: "succeeded", id: proposalId, claimToken, snapshot: {
        kind: "client_person", entityId: proposalId,
        sageRecordId: "new-sage-id", sageRecordNumber: "2",
        parentSageRecordId: "parent-sage-id", revision: "revision-1", fields,
      } }, now
    )
    expect(result.status).toBe(202)
    expect(await result.json()).toEqual({ success: true, status: "succeeded" })
    expect(await database.prepare("SELECT id, sage_contact_id, sage_line_number FROM customer_contacts").first())
      .toEqual({ id: proposalId, sage_contact_id: "new-sage-id", sage_line_number: 2 })
    expect(await database.prepare("SELECT status FROM sage_contact_create_proposals").first())
      .toEqual({ status: "succeeded" })
    expect(await database.prepare("SELECT revision FROM sage_contact_snapshots").first())
      .toEqual({ revision: "revision-1" })
    expect(await database.prepare("SELECT event_type FROM sage_contact_create_events").first())
      .toEqual({ event_type: "succeeded" })
    const replay = await handleSageContactCreateResult(
      { SAGE_CONTACT_ORGANIZATION_ID: "org-1" }, database,
      { outcome: "succeeded", id: proposalId, claimToken, snapshot: {
        kind: "client_person", entityId: proposalId,
        sageRecordId: "new-sage-id", sageRecordNumber: "2",
        parentSageRecordId: "parent-sage-id", revision: "revision-1", fields,
      } }, now
    )
    expect(replay.status).toBe(409)
    expect(await database.prepare("SELECT COUNT(*) AS count FROM customer_contacts").first())
      .toEqual({ count: 1 })
  })

  it("inserts a vendor person only under its verified vendor parent", async () => {
    const vendorProposalId = "33333333-3333-4333-8333-333333333333"
    const vendorClaim = "44444444-4444-4444-8444-444444444444"
    await database.prepare("INSERT INTO vendors VALUES ('vendor-1', 'org-1', 'vendor-sage-id', 'active')").run()
    await database.prepare(
      `INSERT INTO sage_contact_create_proposals
       (id, organization_id, kind, vendor_id, parent_sage_record_id, fields_json,
        dedupe_key, status, requested_by_user_id, requested_at, updated_at,
        claim_token, claimed_at, attempt_count)
       VALUES (?, 'org-1', 'vendor_person', 'vendor-1', 'vendor-sage-id', ?,
        'vendor-dedupe', 'running', 'requester', ?, ?, ?, ?, 1)`
    ).bind(vendorProposalId, JSON.stringify(fields), now, now, vendorClaim, now).run()
    const result = await handleSageContactCreateResult(
      { SAGE_CONTACT_ORGANIZATION_ID: "org-1" }, database,
      { outcome: "succeeded", id: vendorProposalId, claimToken: vendorClaim, snapshot: {
        kind: "vendor_person", entityId: vendorProposalId,
        sageRecordId: "new-vendor-person-id", sageRecordNumber: "2",
        parentSageRecordId: "vendor-sage-id", revision: "revision-2", fields,
      } }, now
    )
    expect(result.status).toBe(202)
    expect(await database.prepare("SELECT vendor_id, sage_contact_id FROM vendor_contacts").first())
      .toEqual({ vendor_id: "vendor-1", sage_contact_id: "new-vendor-person-id" })
  })

  it("links an Add requested for an existing Compass person instead of copying them", async () => {
    const linkedProposalId = "55555555-5555-4555-8555-555555555555"
    const linkedClaim = "66666666-6666-4666-8666-666666666666"
    await database.prepare("INSERT INTO vendors VALUES ('vendor-2', 'org-1', 'vendor-2-sage-id', 'active')").run()
    await database.prepare(
      `INSERT INTO vendor_contacts (id, vendor_id, name, email, is_primary, active, source_system, created_at, updated_at)
       VALUES ('existing-person', 'vendor-2', 'Test Person', 'test@example.invalid', 0, 1, 'manual', ?, ?)`
    ).bind(now, now).run()
    await database.prepare(
      `INSERT INTO sage_contact_create_proposals
       (id, organization_id, kind, vendor_id, parent_sage_record_id, fields_json,
        dedupe_key, status, requested_by_user_id, requested_at, updated_at,
        claim_token, claimed_at, attempt_count, compass_person_id)
       VALUES (?, 'org-1', 'vendor_person', 'vendor-2', 'vendor-2-sage-id', ?,
        'linked-dedupe', 'running', 'requester', ?, ?, ?, ?, 1, 'existing-person')`
    ).bind(linkedProposalId, JSON.stringify(fields), now, now, linkedClaim, now).run()
    const result = await handleSageContactCreateResult(
      { SAGE_CONTACT_ORGANIZATION_ID: "org-1" }, database,
      { outcome: "succeeded", id: linkedProposalId, claimToken: linkedClaim, snapshot: {
        kind: "vendor_person", entityId: linkedProposalId,
        sageRecordId: "linked-sage-person", sageRecordNumber: "4",
        parentSageRecordId: "vendor-2-sage-id", revision: "revision-4", fields,
      } }, now
    )
    expect(await result.json()).toEqual({ success: true, status: "succeeded" })
    expect((await database.prepare("SELECT id, sage_contact_id, sage_line_number FROM vendor_contacts WHERE vendor_id = 'vendor-2'").all()).results)
      .toEqual([{ id: "existing-person", sage_contact_id: "linked-sage-person", sage_line_number: 4 }])
    expect(await database.prepare("SELECT entity_id FROM sage_contact_snapshots WHERE sage_record_id = 'linked-sage-person'").first())
      .toEqual({ entity_id: "existing-person" })
  })

  it("does not create a directory person after an uncertain Sage API attempt", async () => {
    const result = await handleSageContactCreateResult(
      { SAGE_CONTACT_ORGANIZATION_ID: "org-1" }, database,
      { outcome: "failed", id: proposalId, claimToken, attempted: true, error: "timeout" }, now
    )
    expect(result.status).toBe(202)
    expect(await result.json()).toEqual({ success: true, status: "needs_reconciliation" })
    expect(await database.prepare("SELECT status FROM sage_contact_create_proposals").first())
      .toEqual({ status: "needs_reconciliation" })
    expect(await database.prepare("SELECT COUNT(*) AS count FROM customer_contacts").first())
      .toEqual({ count: 0 })
  })

  it("allows a confirmed pre-attempt validation failure to terminate cleanly", async () => {
    const result = await handleSageContactCreateResult(
      { SAGE_CONTACT_ORGANIZATION_ID: "org-1" }, database,
      { outcome: "failed", id: proposalId, claimToken, attempted: false, error: "invalid plan" }, now
    )
    expect(result.status).toBe(202)
    expect(await result.json()).toEqual({ success: true, status: "failed" })
    expect(await database.prepare("SELECT status FROM sage_contact_create_proposals").first())
      .toEqual({ status: "failed" })
  })

  it("refuses a different parent even if the contact fields match", async () => {
    const result = await handleSageContactCreateResult(
      { SAGE_CONTACT_ORGANIZATION_ID: "org-1" }, database,
      { outcome: "succeeded", id: proposalId, claimToken, snapshot: {
        kind: "client_person", entityId: proposalId,
        sageRecordId: "new-sage-id", sageRecordNumber: "2",
        parentSageRecordId: "other-parent", revision: "revision-1", fields,
      } }, now
    )
    expect(result.status).toBe(202)
    expect(await result.json()).toEqual({ success: true, status: "needs_reconciliation" })
    expect(await database.prepare("SELECT COUNT(*) AS count FROM customer_contacts").first())
      .toEqual({ count: 0 })
  })

  it("refuses a child whose Sage read-back differs from the approved fields", async () => {
    const result = await handleSageContactCreateResult(
      { SAGE_CONTACT_ORGANIZATION_ID: "org-1" }, database,
      { outcome: "succeeded", id: proposalId, claimToken, snapshot: {
        kind: "client_person", entityId: proposalId,
        sageRecordId: "new-sage-id", sageRecordNumber: "2",
        parentSageRecordId: "parent-sage-id", revision: "revision-1",
        fields: { ...fields, phone: "different" },
      } }, now
    )
    expect(result.status).toBe(202)
    expect(await result.json()).toEqual({ success: true, status: "needs_reconciliation" })
    expect(await database.prepare("SELECT COUNT(*) AS count FROM customer_contacts").first())
      .toEqual({ count: 0 })
  })
})
