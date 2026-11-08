import { drizzle } from "drizzle-orm/d1"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { d1Over } from "@/lib/domain/__tests__/sqlite-d1"
import { migratedDatabase } from "@/lib/domain/contacts/__tests__/directory-seed"
import { isRecord } from "@/lib/shared/guards"

/*
 * "Edit here, Sage after OK" (owner decisions 2026-11-04): on a Sage-linked
 * client or vendor, every field shows its new value in Compass at once, and
 * Sage-shared fields also become one reviewed Sage change request (see
 * sage-edit-immediate.test.ts for the sync and outcome rules). Runs against
 * a database built from every migration.
 */

const state = vi.hoisted(() => {
  const initial: { d1: unknown; userId: string } = { d1: null, userId: "staff-1" }
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
    env: { DB: state.d1, SAGE_CONTACT_ORGANIZATION_ID: ORG, SAGE_CONTACT_WRITES_ENABLED: "true" },
  }),
}))
vi.mock("@/lib/permission-enforcement", () => ({
  canFeature: async () => true,
  requireFeaturePermission: async () => undefined,
}))
vi.mock("@/db", () => ({ getDb: (d1: never) => drizzle(d1) }))

import { reviewSageContactChange } from "@/app/actions/sage-contact-changes"
import { updateCustomer } from "@/app/actions/customers"
import {
  getSageLinkedEditState,
  requestSageLinkedCustomerChanges,
  requestSageLinkedVendorChanges,
  type SageLinkedSaveResult,
} from "@/app/actions/sage-linked-edits"
import { updateVendor } from "@/app/actions/vendors"
import { applySageContactSnapshotToCanonical } from "@/lib/sage/contact-canonical"

const ORG = "org-1"
const NOW = "2026-11-01T00:00:00.000Z"
const VENDOR_SAGE_ID = "3f2a9c1e-0000-4000-8000-000000000038"
const CLIENT_SAGE_ID = "7b1d2e3f-0000-4000-8000-000000000052"

let sqlite: ReturnType<typeof migratedDatabase>

function insert(table: string, row: Record<string, string | number | null>): void {
  const keys = Object.keys(row)
  sqlite.prepare(`INSERT INTO ${table} (${keys.map((key) => `"${key}"`).join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`)
    .run(...Object.values(row))
}

function rows(query: string): Record<string, unknown>[] {
  return sqlite.prepare(query).all().filter(isRecord)
}

const vendorSageFields = {
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

/** What the vendor form does on Save: Compass-only fields, then Sage requests. */
async function saveSageLinkedVendor(id: string, form: typeof vendorForm): Promise<SageLinkedSaveResult> {
  const saved = await updateVendor(id, {
    category: form.category,
    // Sage people go to the directory save as stored.
    contacts: [{ id: "vp-sage", name: "Sage Person", title: "Owner", email: "owner@sage.example", phone: "555-0101", isPrimary: true }],
  })
  if (!saved.success) return saved
  return requestSageLinkedVendorChanges(id, { sage: form.sage, contacts: form.contacts })
}

function statuses(result: SageLinkedSaveResult): readonly string[] | false {
  return result.success && result.data.sage.map((item) => item.outcome.status)
}

const vendorForm = {
  category: "Subcontractor",
  sage: {
    name: "Sage Framing", ownerName: "Pat Owner", email: "office@framing.example", phone: "555-0100",
    primaryEmail: "ap@framing.example", addressLine1: "1 Main St", addressLine2: "", city: "Denver", state: "CO", postalCode: "80202",
  },
  contacts: [{ id: "vp-sage", name: "Sage Person", title: "Owner", email: "owner@sage.example", phone: "555-0101", isPrimary: true }],
}

beforeEach(() => {
  sqlite = migratedDatabase()
  sqlite.pragma("foreign_keys = OFF")
  state.d1 = d1Over(sqlite)
  state.userId = "staff-1"
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
})

afterEach(() => sqlite.close())

describe("inline edits of a Sage-linked vendor", () => {
  it("saves a Compass-only field directly and creates no Sage request", async () => {
    snapshot("vendor_company", "vendor-sage", VENDOR_SAGE_ID, vendorSageFields)
    const result = await saveSageLinkedVendor("vendor-sage", { ...vendorForm, category: "Supplier" })
    expect(result).toEqual({ success: true, data: { sage: [] } })
    expect(rows("SELECT category FROM vendors")).toEqual([{ category: "Supplier" }])
    expect(rows("SELECT count(*) AS n FROM sage_contact_change_proposals")).toEqual([{ n: 0 }])
  })

  it("turns Sage-shared changes into one request and shows them in Compass at once", async () => {
    snapshot("vendor_company", "vendor-sage", VENDOR_SAGE_ID, vendorSageFields)
    const result = await saveSageLinkedVendor("vendor-sage", {
      ...vendorForm,
      category: "Supplier",
      sage: { ...vendorForm.sage, name: "Sage Framing Inc", phone: "555-0199" },
    })
    expect(statuses(result)).toEqual(["requested"])
    expect(rows("SELECT category, name, phone FROM vendors")).toEqual([{ category: "Supplier", name: "Sage Framing Inc", phone: "555-0199" }])
    const proposals = rows("SELECT kind, entity_id, status, changes_json FROM sage_contact_change_proposals")
    expect(proposals).toHaveLength(1)
    expect(proposals[0]).toMatchObject({ kind: "vendor_company", entity_id: "vendor-sage", status: "pending" })
    expect(JSON.parse(String(proposals[0]?.changes_json))).toEqual([
      { field: "name", before: "Sage Framing", after: "Sage Framing Inc" },
      { field: "phone", before: "555-0100", after: "555-0199" },
    ])
    expect(rows("SELECT action, entity_type FROM activity_events WHERE action LIKE 'sage_change.%'"))
      .toEqual([{ action: "sage_change.requested", entity_type: "vendor" }])

    const editState = await getSageLinkedEditState("vendor_company", "vendor-sage")
    expect(editState.success && editState.data.pending["vendor-sage"]?.changes.map((change) => change.after))
      .toEqual(["Sage Framing Inc", "555-0199"])

    // Saving the same edit again does not open a second request.
    const again = await saveSageLinkedVendor("vendor-sage", {
      ...vendorForm, category: "Supplier", sage: { ...vendorForm.sage, name: "Sage Framing Inc", phone: "555-0199" },
    })
    expect(statuses(again)).toEqual([])
    expect(rows("SELECT count(*) AS n FROM sage_contact_change_proposals")).toEqual([{ n: 1 }])
  })

  it("puts the Sage value back when the request is rejected, and keeps the new value through approval", async () => {
    snapshot("vendor_company", "vendor-sage", VENDOR_SAGE_ID, vendorSageFields)
    await saveSageLinkedVendor("vendor-sage", { ...vendorForm, sage: { ...vendorForm.sage, phone: "555-0199" } })
    expect(rows("SELECT phone FROM vendors")).toEqual([{ phone: "555-0199" }])
    const [proposal] = rows("SELECT id FROM sage_contact_change_proposals")
    state.userId = "reviewer-1"
    await expect(reviewSageContactChange(String(proposal?.id), "reject", "Wrong number"))
      .resolves.toMatchObject({ success: true, status: "rejected" })
    expect(rows("SELECT phone FROM vendors")).toEqual([{ phone: "555-0100" }])
    expect(rows("SELECT action FROM activity_events WHERE action LIKE 'sage_change.%' ORDER BY created_at, action"))
      .toEqual(expect.arrayContaining([{ action: "sage_change.requested" }, { action: "sage_change.rejected" }]))

    state.userId = "staff-1"
    await saveSageLinkedVendor("vendor-sage", { ...vendorForm, sage: { ...vendorForm.sage, phone: "555-0177" } })
    const [second] = rows("SELECT id FROM sage_contact_change_proposals WHERE status = 'pending'")
    state.userId = "reviewer-1"
    await expect(reviewSageContactChange(String(second?.id), "approve"))
      .resolves.toMatchObject({ success: true, status: "approved" })
    expect(rows("SELECT phone FROM vendors")).toEqual([{ phone: "555-0177" }])
  })

  it("lets the requester approve their own change unless the company requires a second approver", async () => {
    snapshot("vendor_company", "vendor-sage", VENDOR_SAGE_ID, vendorSageFields)
    await saveSageLinkedVendor("vendor-sage", { ...vendorForm, sage: { ...vendorForm.sage, phone: "555-0199" } })
    const [first] = rows("SELECT id FROM sage_contact_change_proposals WHERE status = 'pending'")
    // Default: the form offers "Approve and send to Sage" and the approval goes through.
    const editState = await getSageLinkedEditState("vendor_company", "vendor-sage")
    expect(editState.success && editState.data.pending["vendor-sage"]?.canApprove).toBe(true)
    await expect(reviewSageContactChange(String(first?.id), "approve"))
      .resolves.toMatchObject({ success: true, status: "approved" })

    // A company that requires a second approver blocks the requester, not another reviewer.
    sqlite.prepare("UPDATE sage_contact_change_proposals SET status = 'completed'").run()
    insert("organization_feature_settings", {
      organization_id: ORG, feature_key: "sage-contact-review",
      value: JSON.stringify({ requireSecondApprover: true }), updated_at: NOW, updated_by: null,
    })
    await saveSageLinkedVendor("vendor-sage", { ...vendorForm, sage: { ...vendorForm.sage, phone: "555-0177" } })
    const [second] = rows("SELECT id FROM sage_contact_change_proposals WHERE status = 'pending'")
    const lockedState = await getSageLinkedEditState("vendor_company", "vendor-sage")
    expect(lockedState.success && lockedState.data.pending["vendor-sage"]?.canApprove).toBe(false)
    await expect(reviewSageContactChange(String(second?.id), "approve"))
      .resolves.toMatchObject({ success: false, error: expect.stringContaining("another staff member") })
    state.userId = "reviewer-1"
    await expect(reviewSageContactChange(String(second?.id), "approve"))
      .resolves.toMatchObject({ success: true, status: "approved" })
  })

  it("requests against an old Sage read and asks Sage for a fresh one for approval", async () => {
    snapshot("vendor_company", "vendor-sage", VENDOR_SAGE_ID, vendorSageFields, "2026-10-01T00:00:00.000Z")
    const result = await saveSageLinkedVendor("vendor-sage", { ...vendorForm, sage: { ...vendorForm.sage, phone: "555-0199" } })
    expect(statuses(result)).toEqual(["requested"])
    expect(rows("SELECT count(*) AS n FROM sage_contact_change_proposals")).toEqual([{ n: 1 }])
    expect(rows("SELECT kind, entity_id, status FROM sage_contact_read_requests"))
      .toEqual([{ kind: "vendor_company", entity_id: "vendor-sage", status: "queued" }])
  })

  it("refuses a category change while the category follows a mapped Sage vendor type", async () => {
    insert("sage_vendor_directory_entries", {
      organization_id: ORG, sage_record_id: VENDOR_SAGE_ID, sage_vendor_number: "38", name: "Sage Framing",
      details_received: 1, vendor_type: "Subcontractor", captured_at: NOW,
    })
    await expect(updateVendor("vendor-sage", { category: "Supplier" }))
      .resolves.toEqual({ success: false, error: 'Category follows the Sage vendor type "Subcontractor". Change the vendor type in Sage.' })
    expect(rows("SELECT category FROM vendors")).toEqual([{ category: "Subcontractor" }])
  })

  it("saves a field an older Sage writer did not send and requests it with an unknown before-value", async () => {
    const olderWriter = Object.fromEntries(Object.entries(vendorSageFields)
      .filter(([field]) => field !== "name" && field !== "email" && field !== "phone"))
    snapshot("vendor_company", "vendor-sage", VENDOR_SAGE_ID, olderWriter)
    const editState = await getSageLinkedEditState("vendor_company", "vendor-sage")
    expect(editState.success && editState.data.unavailableFields).toEqual(["name", "email", "phone"])
    const result = await saveSageLinkedVendor("vendor-sage", { ...vendorForm, sage: { ...vendorForm.sage, phone: "555-0199" } })
    expect(result.success && result.data.sage[0]?.outcome).toMatchObject({ status: "requested" })
    expect(rows("SELECT phone FROM vendors")).toEqual([{ phone: "555-0199" }])
    // The writer refuses a field its own read lacks, so this fails visibly rather than misapplying.
    expect(rows("SELECT status, changes_json FROM sage_contact_change_proposals")).toEqual([{
      status: "pending", changes_json: JSON.stringify([{ field: "phone", before: null, after: "555-0199" }]),
    }])
  })

  it("sends a Sage person's change for approval and shows it in Compass at once", async () => {
    snapshot("vendor_company", "vendor-sage", VENDOR_SAGE_ID, vendorSageFields)
    snapshot("vendor_person", "vp-sage", "SC-1", {
      name: "Sage Person", title: "Owner", phone: "555-0101", phoneExtension: null, email: "owner@sage.example", cellPhone: null,
    }, new Date().toISOString(), VENDOR_SAGE_ID)
    const result = await saveSageLinkedVendor("vendor-sage", {
      ...vendorForm, contacts: [{ ...vendorForm.contacts[0], phone: "555-0222" }],
    })
    expect(statuses(result)).toEqual(["requested"])
    expect(rows("SELECT phone FROM vendor_contacts")).toEqual([{ phone: "555-0222" }])
    expect(rows("SELECT kind, entity_id FROM sage_contact_change_proposals")).toEqual([{ kind: "vendor_person", entity_id: "vp-sage" }])
  })
})

describe("inline edits of a Sage-linked client", () => {
  it("saves company and notes directly and sends email to Sage for approval", async () => {
    snapshot("client_company", "customer-sage", CLIENT_SAGE_ID, {
      addressLine1: null, addressLine2: null, city: null, state: null, postalCode: null,
      billingAddressLine1: null, billingAddressLine2: null, billingCity: null, billingState: null, billingPostalCode: null,
      name: "Kelly Painting", email: "kelly@paint.example", phone: "555-0200",
    })
    await expect(updateCustomer("customer-sage", { company: "Kelly Painting LLC", notes: "Gate code 1234" }))
      .resolves.toMatchObject({ success: true })
    const result = await requestSageLinkedCustomerChanges("customer-sage", {
      sage: { name: "Kelly Painting", email: "billing@paint.example", phone: "555-0200" },
    })
    expect(statuses(result)).toEqual(["requested"])
    expect(rows("SELECT company, notes, email FROM customers"))
      .toEqual([{ company: "Kelly Painting LLC", notes: "Gate code 1234", email: "billing@paint.example" }])
    const [proposal] = rows("SELECT kind, changes_json FROM sage_contact_change_proposals")
    expect(proposal?.kind).toBe("client_company")
    expect(JSON.parse(String(proposal?.changes_json))).toEqual([
      { field: "email", before: "kelly@paint.example", after: "billing@paint.example" },
    ])
  })

  it("uses a fresh read whose Sage GUID differs from the stored link only in case", async () => {
    sqlite.prepare("UPDATE customers SET sage_client_id = ?").run(CLIENT_SAGE_ID.toUpperCase())
    snapshot("client_company", "customer-sage", CLIENT_SAGE_ID, {
      addressLine1: null, addressLine2: null, city: null, state: null, postalCode: null,
      billingAddressLine1: null, billingAddressLine2: null, billingCity: null, billingState: null, billingPostalCode: null,
      name: "Kelly Painting", email: "kelly@paint.example", phone: "555-0200",
    })
    const result = await requestSageLinkedCustomerChanges("customer-sage", {
      sage: { name: "Kelly Painting", email: "billing@paint.example", phone: "555-0200" },
    })
    expect(statuses(result)).toEqual(["requested"])
    expect(rows("SELECT count(*) AS n FROM sage_contact_read_requests")).toEqual([{ n: 0 }])
  })
})

describe("a confirmed Sage write reaching Compass", () => {
  it("copies name, email and phone only for fields the approved write changed", async () => {
    const identity = { sageRecordId: VENDOR_SAGE_ID, sageRecordNumber: "38", parentSageRecordId: null, linkedUserId: null }
    const readBack = {
      kind: "vendor_company" as const, entityId: "vendor-sage", sageRecordId: VENDOR_SAGE_ID, sageRecordNumber: "38",
      parentSageRecordId: null, fields: { ...vendorSageFields, name: "SAGE FRAMING", phone: "555-0199", city: "Boulder" },
    }
    // A plain read does not rename the Compass vendor or change its phone.
    // @ts-expect-error The test binding implements only what the statement calls.
    await applySageContactSnapshotToCanonical(state.d1, ORG, identity, readBack)
    expect(rows("SELECT name, phone, city FROM vendors")).toEqual([{ name: "Sage Framing", phone: "555-0100", city: "Boulder" }])
    // @ts-expect-error The test binding implements only what the statement calls.
    await applySageContactSnapshotToCanonical(state.d1, ORG, identity, readBack, ["phone", "city"])
    expect(rows("SELECT name, phone, address FROM vendors"))
      .toEqual([{ name: "Sage Framing", phone: "555-0199", address: "1 Main St, Boulder, CO 80202" }])
  })
})
