import { drizzle } from "drizzle-orm/d1"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { d1Over } from "@/lib/domain/__tests__/sqlite-d1"
import { migratedDatabase } from "@/lib/domain/contacts/__tests__/directory-seed"
import { isRecord } from "@/lib/shared/guards"

/*
 * Sage-shared fields of a Sage-linked vendor, client or Sage person show the
 * new value in Compass as soon as staff save (owner decision 2026-11-04).
 * Sage catches up through the reviewed change request, and every Sage →
 * Compass sync leaves a field with an unfinished request alone. Runs against
 * a database built from every migration. All names and ids are made up.
 */

const state = vi.hoisted(() => {
  const initial: { d1: unknown; userId: string; syncConfigured: boolean } = { d1: null, userId: "staff-1", syncConfigured: true }
  return initial
})
function user(): Record<string, unknown> {
  return {
    id: state.userId, email: `${state.userId}@example.com`, firstName: "Avery", lastName: "Office", displayName: null,
    avatarUrl: null, role: "admin", googleEmail: null, isActive: true, lastLoginAt: null, organizationId: ORG,
    organizationName: "A", organizationType: "company", createdAt: "", updatedAt: "",
  }
}
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("@/lib/auth", () => ({ getCurrentUser: async () => user(), requireAuth: async () => user() }))
vi.mock("@/lib/db", () => ({
  getCloudflareContext: async () => ({
    env: {
      DB: state.d1, SAGE_CONTACT_ORGANIZATION_ID: state.syncConfigured ? ORG : undefined, SAGE_CONTACT_WRITES_ENABLED: "true",
      SAGE_CONTACT_BRIDGE_SECRET: "test-secret",
    },
  }),
}))
vi.mock("@/lib/permission-enforcement", () => ({
  canFeature: async () => true,
  requireFeaturePermission: async () => undefined,
}))
vi.mock("@/db", () => ({ getDb: (d1: never) => drizzle(d1) }))
vi.mock("@/lib/sage/bridge-auth", async (original) => ({
  ...await original<typeof import("@/lib/sage/bridge-auth")>(),
  getSageContactBridgeSecret: () => "test-secret",
  verifySageBridgeRequest: async () => ({ success: true }),
}))

import { POST } from "@/app/api/integrations/sage/contact-changes/results/route"
import { getDb } from "@/db"
import { getSageCompanyNameState } from "@/app/actions/sage-company-names"
import { reviewSageContactChange } from "@/app/actions/sage-contact-changes"
import {
  getSageLinkedEditState,
  requestSageLinkedCustomerChanges,
  requestSageLinkedVendorChanges,
  retrySageLinkedChange,
  saveSageLinkedCustomerPerson,
  type SageLinkedSaveResult,
} from "@/app/actions/sage-linked-edits"
import { applySageVendorDirectory } from "@/lib/sage/vendor-directory-sync"

const ORG = "org-1"
const NOW = "2026-11-01T00:00:00.000Z"
const VENDOR_SAGE_ID = "3f2a9c1e-0000-4000-8000-000000000038"
const CLIENT_SAGE_ID = "7b1d2e3f-0000-4000-8000-000000000052"
const CLAIM = "0b6f0c1e-1111-4222-8333-444455556666"
const READ_ID = "5d0c1f2e-2222-4333-8444-555566667777"

let sqlite: ReturnType<typeof migratedDatabase>

function insert(table: string, row: Record<string, string | number | null>): void {
  const keys = Object.keys(row)
  sqlite.prepare(`INSERT INTO ${table} (${keys.map((key) => `"${key}"`).join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`)
    .run(...Object.values(row))
}

function rows(query: string): Record<string, unknown>[] {
  return sqlite.prepare(query).all().filter(isRecord)
}

/** What Sage holds for the vendor: the last Sage read. */
const sageVendor = {
  ownerName: "Pat Owner", addressLine1: "1 Main St", addressLine2: null, city: "Denver", state: "CO",
  postalCode: "80202", primaryEmail: "ap@framing.example", name: "Sage Framing", email: "office@framing.example",
  phone: "555-0100",
}

function snapshot(kind: string, entityId: string, sageRecordId: string, fields: Record<string, string | null>,
  capturedAt = new Date().toISOString(), parent: string | null = null): void {
  insert("sage_contact_snapshots", {
    id: `snap-${entityId}`, organization_id: ORG, kind, entity_id: entityId, sage_record_id: sageRecordId,
    parent_sage_record_id: parent, revision: `rev-${entityId}`, fields_json: JSON.stringify(fields), captured_at: capturedAt,
  })
}

/** What Sage holds for the client. */
const clientSageFields = {
  addressLine1: null, addressLine2: null, city: null, state: null, postalCode: null,
  billingAddressLine1: null, billingAddressLine2: null, billingCity: null, billingState: null, billingPostalCode: null,
  name: "Kelly Painting", email: "kelly@paint.example", phone: "555-0200",
}

const vendorSage = {
  name: "Sage Framing", ownerName: "Pat Owner", email: "office@framing.example", phone: "555-0100",
  primaryEmail: "ap@framing.example", addressLine1: "1 Main St", addressLine2: "", city: "Denver", state: "CO", postalCode: "80202",
}
const sagePerson = { id: "vp-sage", name: "Sage Person", title: "Owner", email: "owner@sage.example", phone: "555-0101" }

function saveVendor(sage: Partial<typeof vendorSage>, person: Partial<typeof sagePerson> = {}): Promise<SageLinkedSaveResult> {
  return requestSageLinkedVendorChanges("vendor-sage", { sage: { ...vendorSage, ...sage }, contacts: [{ ...sagePerson, ...person }] })
}

function statuses(result: SageLinkedSaveResult): readonly string[] | false {
  return result.success && result.data.sage.map((item) => item.outcome.status)
}

function proposals(): Record<string, unknown>[] {
  return rows("SELECT id, kind, status, changes_json FROM sage_contact_change_proposals ORDER BY requested_at, rowid")
}

let requestCounter = 0
function postResult(body: Record<string, unknown>): Promise<Response> {
  requestCounter += 1
  return POST(new Request("https://compass.test/api/integrations/sage/contact-changes/results", {
    method: "POST",
    headers: { "content-type": "application/json", "x-compass-request-id": `req-${requestCounter}-${Date.now()}` },
    body: JSON.stringify(body),
  }))
}

function vendorReadBack(fields: Record<string, string | null>, revision = "rev-2"): Record<string, unknown> {
  return {
    kind: "vendor_company", entityId: "vendor-sage", sageRecordId: VENDOR_SAGE_ID, sageRecordNumber: "38",
    parentSageRecordId: null, revision, fields,
  }
}

/** A reviewer approves the open request and the Sage writer claims it. */
async function approveAndClaim(): Promise<string> {
  const [open] = rows("SELECT id FROM sage_contact_change_proposals WHERE status = 'pending'")
  const id = String(open?.id)
  state.userId = "reviewer-1"
  await expect(reviewSageContactChange(id, "approve")).resolves.toMatchObject({ success: true, status: "approved" })
  state.userId = "staff-1"
  sqlite.prepare("UPDATE sage_contact_change_proposals SET status = 'running', claim_token = ?, claimed_at = ? WHERE id = ?")
    .run(CLAIM, new Date().toISOString(), id)
  return id
}

beforeEach(() => {
  sqlite = migratedDatabase()
  sqlite.pragma("foreign_keys = OFF")
  state.d1 = d1Over(sqlite)
  state.userId = "staff-1"
  state.syncConfigured = true
  insert("vendors", {
    id: "vendor-sage", organization_id: ORG, name: "Sage Framing", category: "Subcontractor",
    email: "office@framing.example", phone: "555-0100", owner_name: "Pat Owner", address_line_1: "1 Main St",
    city: "Denver", state: "CO", postal_code: "80202", primary_email: "ap@framing.example",
    sage_vendor_id: VENDOR_SAGE_ID, sage_vendor_number: "38", directory_status: "active", created_at: NOW, updated_at: NOW,
  })
  insert("vendor_contacts", {
    id: "vp-sage", vendor_id: "vendor-sage", name: "Sage Person", title: "Owner", email: "owner@sage.example", phone: "555-0101",
    sage_contact_id: "SC-1", sage_line_number: 1, is_primary: 1, active: 1, created_at: NOW, updated_at: NOW,
  })
  insert("customers", {
    id: "customer-sage", organization_id: ORG, name: "Kelly Painting", company: null, email: "kelly@paint.example",
    phone: "555-0200", notes: null, sage_client_id: CLIENT_SAGE_ID, sage_client_number: "52", created_at: NOW, updated_at: NOW,
  })
  snapshot("vendor_company", "vendor-sage", VENDOR_SAGE_ID, sageVendor)
})

afterEach(() => sqlite.close())

describe("saving a Sage-shared field", () => {
  it("shows the new value in Compass at once and asks Sage for it", async () => {
    insert("projects", { id: "project-1", organization_id: ORG, name: "Test Barn", created_at: NOW, updated_at: NOW })
    insert("project_contacts", {
      id: "pc-1", project_id: "project-1", contact_type: "vendor", source_entity_type: "vendor_contact",
      source_entity_id: "vp-sage", vendor_id: "vendor-sage", vendor_contact_id: "vp-sage", display_name: "Sage Person",
      email: "owner@sage.example", created_at: NOW, updated_at: NOW,
    })
    snapshot("vendor_person", "vp-sage", "SC-1", {
      name: "Sage Person", title: "Owner", phone: "555-0101", phoneExtension: null, email: "owner@sage.example", cellPhone: null,
    }, new Date().toISOString(), VENDOR_SAGE_ID)
    const result = await saveVendor({ primaryEmail: "billing@framing.example" }, { email: "pat@framing.example" })
    expect(statuses(result)).toEqual(["requested", "requested"])
    expect(rows("SELECT primary_email FROM vendors")).toEqual([{ primary_email: "billing@framing.example" }])
    expect(rows("SELECT email FROM vendor_contacts")).toEqual([{ email: "pat@framing.example" }])
    // Project contacts and pickers that read the copy show the new email too.
    expect(rows("SELECT email FROM project_contacts")).toEqual([{ email: "pat@framing.example" }])
    expect(proposals().map((row) => [row.kind, row.status, JSON.parse(String(row.changes_json))])).toEqual([
      ["vendor_company", "pending", [{ field: "primaryEmail", before: "ap@framing.example", after: "billing@framing.example" }]],
      ["vendor_person", "pending", [{ field: "email", before: "owner@sage.example", after: "pat@framing.example" }]],
    ])
    const editState = await getSageLinkedEditState("vendor_company", "vendor-sage")
    expect(editState.success && editState.data.pending["vendor-sage"]).toMatchObject({ status: "pending", error: null })
    expect(editState.success && editState.data.pending["vp-sage"]?.changes.map((change) => change.field)).toEqual(["email"])
  })

  it("takes the before-value from the last Sage read, not from Compass", async () => {
    sqlite.prepare("DELETE FROM sage_contact_snapshots").run()
    // Sage's last read is older than the approval window; Compass already differs from it.
    snapshot("vendor_company", "vendor-sage", VENDOR_SAGE_ID, { ...sageVendor, phone: "555-0123" }, "2026-10-01T00:00:00.000Z")
    const result = await saveVendor({ phone: "555-0199" })
    expect(statuses(result)).toEqual(["requested"])
    expect(rows("SELECT phone FROM vendors")).toEqual([{ phone: "555-0199" }])
    expect(JSON.parse(String(proposals()[0]?.changes_json))).toEqual([{ field: "phone", before: "555-0123", after: "555-0199" }])
    // Approval needs a fresh read, so one is queued.
    expect(rows("SELECT kind, status FROM sage_contact_read_requests")).toEqual([{ kind: "vendor_company", status: "queued" }])
  })

  it("saves at once when Compass has never read the record from Sage; the request follows the read", async () => {
    const result = await requestSageLinkedCustomerChanges("customer-sage", {
      sage: { name: "Kelly Painting", email: "office@paint.example", phone: "555-0200" },
    })
    expect(statuses(result)).toEqual(["queued"])
    expect(rows("SELECT email FROM customers")).toEqual([{ email: "office@paint.example" }])
    expect(proposals().map((row) => [row.status, JSON.parse(String(row.changes_json))])).toEqual([
      ["queued", [{ field: "email", before: null, after: "office@paint.example" }]],
    ])
    expect(rows("SELECT kind, status FROM sage_contact_read_requests")).toEqual([{ kind: "client_company", status: "queued" }])
    const editState = await getSageLinkedEditState("client_company", "customer-sage")
    expect(editState.success && editState.data.pending["customer-sage"]).toMatchObject({ status: "queued", error: null })

    // The read lands: Sage's old email does not come back, and the request is planned against the read.
    sqlite.prepare("UPDATE sage_contact_read_requests SET id = ?, status = 'running', claim_token = ?, claimed_at = ?")
      .run(READ_ID, CLAIM, new Date().toISOString())
    const response = await postResult({
      type: "read",
      result: {
        outcome: "succeeded", id: READ_ID, claimToken: CLAIM,
        snapshot: {
          kind: "client_company", entityId: "customer-sage", sageRecordId: CLIENT_SAGE_ID, sageRecordNumber: "52",
          parentSageRecordId: null, revision: "rev-client", identityName: "Kelly Painting",
          fields: { ...clientSageFields, city: "Golden" },
        },
      },
    })
    expect(response.status).toBe(202)
    expect(rows("SELECT email, city FROM customers")).toEqual([{ email: "office@paint.example", city: "Golden" }])
    expect(proposals().map((row) => [row.status, JSON.parse(String(row.changes_json))])).toEqual([
      ["superseded", [{ field: "email", before: null, after: "office@paint.example" }]],
      ["pending", [{ field: "email", before: "kelly@paint.example", after: "office@paint.example" }]],
    ])
    expect(rows("SELECT requested_by_user_id, base_revision FROM sage_contact_change_proposals WHERE status = 'pending'"))
      .toEqual([{ requested_by_user_id: "staff-1", base_revision: "rev-client" }])
    // A different staff member still approves it.
    const [open] = rows("SELECT id FROM sage_contact_change_proposals WHERE status = 'pending'")
    await expect(reviewSageContactChange(String(open?.id), "approve")).resolves.toMatchObject({ success: false })
    state.userId = "reviewer-1"
    await expect(reviewSageContactChange(String(open?.id), "approve")).resolves.toMatchObject({ success: true, status: "approved" })
  })

  it("updates the waiting request when the field is edited again, and withdraws it when Sage's value returns", async () => {
    await saveVendor({ primaryEmail: "billing@framing.example" })
    const again = await saveVendor({ primaryEmail: "invoices@framing.example", phone: "555-0199" })
    expect(statuses(again)).toEqual(["updated"])
    expect(rows("SELECT primary_email, phone FROM vendors")).toEqual([{ primary_email: "invoices@framing.example", phone: "555-0199" }])
    const [first, second] = proposals()
    expect(first?.status).toBe("superseded")
    expect(second?.status).toBe("pending")
    expect(JSON.parse(String(second?.changes_json))).toEqual([
      { field: "phone", before: "555-0100", after: "555-0199" },
      { field: "primaryEmail", before: "ap@framing.example", after: "invoices@framing.example" },
    ])
    expect(rows("SELECT count(*) AS n FROM sage_contact_change_proposals WHERE status = 'pending'")).toEqual([{ n: 1 }])

    // The same values again: no new request.
    expect(statuses(await saveVendor({ primaryEmail: "invoices@framing.example", phone: "555-0199" }))).toEqual([])

    const back = await saveVendor({ primaryEmail: "ap@framing.example", phone: "555-0100" })
    expect(statuses(back)).toEqual(["in_sage"])
    expect(proposals().map((row) => row.status)).toEqual(["superseded", "withdrawn"])
    expect(rows("SELECT action FROM activity_events WHERE action LIKE 'sage_change.%' ORDER BY rowid")).toEqual([
      { action: "sage_change.requested" }, { action: "sage_change.updated" }, { action: "sage_change.withdrawn" },
    ])
  })

  it("saves while Sage is writing the last change; the new edit follows the write", async () => {
    await saveVendor({ phone: "555-0199" })
    const running = await approveAndClaim()
    const result = await saveVendor({ phone: "555-0177" })
    expect(result.success && result.data.sage[0]?.outcome).toEqual({ status: "queued", reason: "sage_writing" })
    expect(rows("SELECT phone FROM vendors")).toEqual([{ phone: "555-0177" }])
    expect(proposals().map((row) => row.status)).toEqual(["running", "queued"])

    // The running write lands; Compass keeps the newer value and asks Sage for it.
    const response = await postResult({
      type: "write",
      result: { outcome: "succeeded", id: running, claimToken: CLAIM, snapshot: vendorReadBack({ ...sageVendor, phone: "555-0199" }) },
    })
    await expect(response.json()).resolves.toEqual({ success: true, status: "succeeded" })
    expect(rows("SELECT phone FROM vendors")).toEqual([{ phone: "555-0177" }])
    expect(proposals().map((row) => [row.status, JSON.parse(String(row.changes_json))])).toEqual([
      ["succeeded", [{ field: "phone", before: "555-0100", after: "555-0199" }]],
      ["superseded", [{ field: "phone", before: "555-0100", after: "555-0177" }]],
      ["pending", [{ field: "phone", before: "555-0199", after: "555-0177" }]],
    ])
  })
})

describe("Sage → Compass syncs while a change is unfinished", () => {
  it("a Sage read leaves the held field alone and updates the others", async () => {
    await saveVendor({ primaryEmail: "billing@framing.example" })
    insert("sage_contact_read_requests", {
      id: READ_ID, organization_id: ORG, kind: "vendor_company", entity_id: "vendor-sage", sage_record_id: VENDOR_SAGE_ID,
      sage_record_number: "38", parent_sage_record_id: null, purpose: "refresh", status: "running",
      claim_token: CLAIM, claimed_at: new Date().toISOString(), requested_at: NOW,
    })
    const response = await postResult({
      type: "read",
      result: { outcome: "succeeded", id: READ_ID, claimToken: CLAIM, snapshot: vendorReadBack({ ...sageVendor, city: "Boulder" }, "rev-vendor-sage") },
    })
    expect(response.status).toBe(202)
    expect(rows("SELECT primary_email, city FROM vendors")).toEqual([{ primary_email: "billing@framing.example", city: "Boulder" }])
    // The snapshot keeps Sage's own value for the next request's before-value.
    expect(JSON.parse(String(rows("SELECT fields_json FROM sage_contact_snapshots")[0]?.fields_json)).primaryEmail)
      .toBe("ap@framing.example")
  })

  it("Sage's daily vendor list leaves the held field alone and updates the others", async () => {
    await saveVendor({ primaryEmail: "billing@framing.example" })
    const result = await applySageVendorDirectory(getDb(state.d1 as never), ORG, [{
      sageRecordId: VENDOR_SAGE_ID, sageVendorNumber: "38", name: "Sage Framing", email: "ap@framing.example",
      details: {
        ownerName: "Pat Owner", addressLine1: "1 Main St", addressLine2: null, city: "Denver", state: "CO",
        postalCode: "80202", phone: "555-0142", vendorType: null,
      },
    }], new Date().toISOString())
    expect(result).toEqual({ updated: 1 })
    expect(rows("SELECT primary_email, phone FROM vendors")).toEqual([{ primary_email: "billing@framing.example", phone: "555-0142" }])
  })

  it("does not flag a pending name as differing from Sage's name", async () => {
    insert("sage_vendor_directory_entries", {
      organization_id: ORG, sage_record_id: VENDOR_SAGE_ID, sage_vendor_number: "38", name: "Sage Framing",
      details_received: 1, captured_at: new Date().toISOString(),
    })
    await saveVendor({ name: "Sage Framing Inc" })
    const nameState = await getSageCompanyNameState("vendor_company", "vendor-sage")
    expect(nameState).toMatchObject({ success: true, data: { compassName: "Sage Framing Inc", sageName: "Sage Framing", status: "pending" } })
  })
})

describe("how an unfinished change ends", () => {
  it("a confirmed write clears the marker and Compass keeps the value", async () => {
    await saveVendor({ primaryEmail: "billing@framing.example" })
    const id = await approveAndClaim()
    const response = await postResult({
      type: "write",
      result: { outcome: "succeeded", id, claimToken: CLAIM, snapshot: vendorReadBack({ ...sageVendor, primaryEmail: "billing@framing.example" }) },
    })
    await expect(response.json()).resolves.toEqual({ success: true, status: "succeeded" })
    expect(rows("SELECT primary_email FROM vendors")).toEqual([{ primary_email: "billing@framing.example" }])
    const editState = await getSageLinkedEditState("vendor_company", "vendor-sage")
    expect(editState.success && editState.data.pending).toEqual({})
  })

  it("a write that reads back differently keeps the Compass value and the marker with the error; Retry asks again", async () => {
    await saveVendor({ primaryEmail: "billing@framing.example" })
    const id = await approveAndClaim()
    const response = await postResult({
      type: "write",
      result: { outcome: "succeeded", id, claimToken: CLAIM, snapshot: vendorReadBack(sageVendor) },
    })
    await expect(response.json()).resolves.toEqual({ success: true, status: "conflict" })
    expect(rows("SELECT primary_email FROM vendors")).toEqual([{ primary_email: "billing@framing.example" }])
    const editState = await getSageLinkedEditState("vendor_company", "vendor-sage")
    expect(editState.success && editState.data.pending["vendor-sage"]).toMatchObject({
      status: "conflict", error: "Sage read-back differs from approved changes",
    })

    const retried = await retrySageLinkedChange("vendor_company", "vendor-sage")
    expect(statuses(retried)).toEqual(["updated"])
    expect(proposals().map((row) => row.status)).toEqual(["superseded", "pending"])
    expect(JSON.parse(String(proposals()[1]?.changes_json))).toEqual([
      { field: "primaryEmail", before: "ap@framing.example", after: "billing@framing.example" },
    ])
  })

  it("a failed write can be rejected, which puts Sage's value back", async () => {
    await saveVendor({ primaryEmail: "billing@framing.example" })
    const id = await approveAndClaim()
    await postResult({ type: "write", result: { outcome: "failed", id, claimToken: CLAIM, error: "Sage was locked" } })
    expect(rows("SELECT primary_email FROM vendors")).toEqual([{ primary_email: "billing@framing.example" }])
    state.userId = "reviewer-1"
    await expect(reviewSageContactChange(id, "reject")).resolves.toMatchObject({ success: true, status: "rejected" })
    expect(rows("SELECT primary_email FROM vendors")).toEqual([{ primary_email: "ap@framing.example" }])
  })

  it("a rejected request puts the Sage value back and says so in Activity", async () => {
    await saveVendor({ phone: "555-0199" })
    expect(rows("SELECT phone FROM vendors")).toEqual([{ phone: "555-0199" }])
    const [open] = proposals()
    state.userId = "reviewer-1"
    await expect(reviewSageContactChange(String(open?.id), "reject", "Wrong number"))
      .resolves.toMatchObject({ success: true, status: "rejected" })
    expect(rows("SELECT phone FROM vendors")).toEqual([{ phone: "555-0100" }])
    const [activity] = rows("SELECT summary FROM activity_events WHERE action = 'sage_change.rejected'")
    expect(String(activity?.summary)).toMatch(/^Sage change rejected, reverted to Sage value/)
    const editState = await getSageLinkedEditState("vendor_company", "vendor-sage")
    expect(editState.success && editState.data.pending).toEqual({})
  })
})

/*
 * Compass is where contact corrections are made first (owner decision
 * 2026-11-04): no Sage state may block a save. Only the Sage side differs.
 */
describe("no Sage state blocks a contact correction", () => {
  function clientPerson(id: string, sageContactId: string | null, lineNumber: number | null): void {
    insert("customer_contacts", {
      id, customer_id: "customer-sage", name: "Tad Example", title: null, email: "tad@exmaple.test", phone: "555-0300",
      sage_contact_id: sageContactId, sage_line_number: lineNumber, is_primary: 0, active: 1, created_at: NOW, updated_at: NOW,
    })
  }
  const fixed = { name: "Ted Example", title: "", email: "ted@example.test", phone: "555-0300" }

  it("a client not linked to a verified Sage record saves in Compass only", async () => {
    sqlite.prepare("UPDATE customers SET sage_client_id = NULL").run()
    const result = await requestSageLinkedCustomerChanges("customer-sage", {
      sage: { name: "Kelly Painting Co", email: "office@paint.example", phone: "555-0200" },
    })
    expect(result.success && result.data.sage[0]?.outcome).toEqual({ status: "compass_only", reason: "not_linked" })
    expect(rows("SELECT name, email FROM customers")).toEqual([{ name: "Kelly Painting Co", email: "office@paint.example" }])
    expect(proposals()).toEqual([])
    expect(rows("SELECT count(*) AS n FROM sage_contact_read_requests")).toEqual([{ n: 0 }])
  })

  it("a client person whose Sage record was never read saves at once and waits for the read", async () => {
    clientPerson("cp-sage", "CC-1", 1)
    const result = await saveSageLinkedCustomerPerson("cp-sage", { ...fixed, isPrimary: true })
    expect(result.success && result.data.sage[0]?.outcome).toEqual({ status: "queued", reason: "reading_sage" })
    expect(rows("SELECT name, email, is_primary FROM customer_contacts"))
      .toEqual([{ name: "Ted Example", email: "ted@example.test", is_primary: 1 }])
    expect(proposals().map((row) => [row.kind, row.status, JSON.parse(String(row.changes_json))])).toEqual([
      ["client_person", "queued", [
        { field: "email", before: null, after: "ted@example.test" },
        { field: "name", before: null, after: "Ted Example" },
      ]],
    ])
  })

  it("a client person under an unverified client saves in Compass only", async () => {
    sqlite.prepare("UPDATE customers SET sage_client_id = NULL").run()
    clientPerson("cp-sage", "CC-1", 1)
    const result = await saveSageLinkedCustomerPerson("cp-sage", fixed)
    expect(result.success && result.data.sage[0]?.outcome).toEqual({ status: "compass_only", reason: "not_linked" })
    expect(rows("SELECT name, email FROM customer_contacts")).toEqual([{ name: "Ted Example", email: "ted@example.test" }])
    expect(proposals()).toEqual([])
  })

  it("an unverified vendor person (Sage line only) saves in Compass only", async () => {
    sqlite.prepare("UPDATE vendor_contacts SET sage_contact_id = NULL").run()
    const result = await saveVendor({}, { email: "pat@framing.example" })
    expect(result.success && result.data.sage[0]?.outcome).toEqual({ status: "compass_only", reason: "not_linked" })
    expect(rows("SELECT email FROM vendor_contacts")).toEqual([{ email: "pat@framing.example" }])
    expect(proposals()).toEqual([])
  })

  it("with Sage contact sync not set up, saves in Compass only and Sage's vendor list cannot put the old value back", async () => {
    state.syncConfigured = false
    const result = await saveVendor({ phone: "555-0199" })
    expect(result.success && result.data.sage[0]?.outcome).toEqual({ status: "compass_only", reason: "sync_off" })
    expect(rows("SELECT phone FROM vendors")).toEqual([{ phone: "555-0199" }])
    // Held, never sent: no read is asked for and nothing is reviewable.
    expect(proposals().map((row) => row.status)).toEqual(["queued"])
    expect(rows("SELECT count(*) AS n FROM sage_contact_read_requests")).toEqual([{ n: 0 }])
    await applySageVendorDirectory(getDb(state.d1 as never), ORG, [{
      sageRecordId: VENDOR_SAGE_ID, sageVendorNumber: "38", name: "Sage Framing", email: "ap@framing.example",
      details: {
        ownerName: "Pat Owner", addressLine1: "1 Main St", addressLine2: null, city: "Denver", state: "CO",
        postalCode: "80202", phone: "555-0100", vendorType: null,
      },
    }], new Date().toISOString())
    expect(rows("SELECT phone FROM vendors")).toEqual([{ phone: "555-0199" }])
  })

  it("rejecting a failed write keeps a newer edit's value and sends it for review", async () => {
    await saveVendor({ phone: "555-0199" })
    const running = await approveAndClaim()
    await saveVendor({ phone: "555-0177" })
    await postResult({ type: "write", result: { outcome: "failed", id: running, claimToken: CLAIM, error: "Sage was locked" } })
    // The failure stays visible with Retry and Reject.
    const editState = await getSageLinkedEditState("vendor_company", "vendor-sage")
    expect(editState.success && editState.data.pending["vendor-sage"]).toMatchObject({ status: "failed", error: "Sage was locked" })
    state.userId = "reviewer-1"
    await expect(reviewSageContactChange(running, "reject")).resolves.toMatchObject({ success: true, status: "rejected" })
    expect(rows("SELECT phone FROM vendors")).toEqual([{ phone: "555-0177" }])
    expect(proposals().map((row) => row.status)).toEqual(["rejected", "superseded", "pending"])
  })

  it("a waiting request is replanned when a newer Sage read lands", async () => {
    await saveVendor({ phone: "555-0199" })
    insert("sage_contact_read_requests", {
      id: READ_ID, organization_id: ORG, kind: "vendor_company", entity_id: "vendor-sage", sage_record_id: VENDOR_SAGE_ID,
      sage_record_number: "38", parent_sage_record_id: null, purpose: "refresh", status: "running",
      claim_token: CLAIM, claimed_at: new Date().toISOString(), requested_at: NOW,
    })
    await postResult({
      type: "read",
      result: { outcome: "succeeded", id: READ_ID, claimToken: CLAIM, snapshot: vendorReadBack({ ...sageVendor, phone: "555-0111" }, "rev-new") },
    })
    expect(rows("SELECT phone FROM vendors")).toEqual([{ phone: "555-0199" }])
    expect(proposals().map((row) => [row.status, JSON.parse(String(row.changes_json))])).toEqual([
      ["superseded", [{ field: "phone", before: "555-0100", after: "555-0199" }]],
      ["pending", [{ field: "phone", before: "555-0111", after: "555-0199" }]],
    ])
  })
})
