import { drizzle } from "drizzle-orm/d1"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { d1Over } from "@/lib/domain/__tests__/sqlite-d1"
import { migratedDatabase } from "@/lib/domain/contacts/__tests__/directory-seed"
import { isRecord } from "@/lib/shared/guards"

/*
 * Owner rule 2026-11-03: staff edit a person's contact information for as
 * long as the person has not ACCEPTED a Compass invitation. A pending
 * invitation does not lock; changing the email then warns staff (nothing is
 * revoked from the directory, resent or emailed). Accepted account holders
 * keep today's rules, and Sage-linked people still go through Sage review.
 * Runs against a database built from every migration.
 */

const mocks = vi.hoisted(() => ({ user: vi.fn(), db: vi.fn() }))
vi.mock("@/db", () => ({ getDb: mocks.db }))
vi.mock("@/lib/auth", () => ({ getCurrentUser: mocks.user, requireAuth: mocks.user }))
vi.mock("@/lib/db", () => ({ getCloudflareContext: async () => ({ env: { DB: {} } }) }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("@/lib/permission-enforcement", () => ({
  canFeature: async () => true,
  requireFeaturePermission: async () => undefined,
}))

import { saveCustomerDirectoryPerson } from "@/app/actions/customer-people"
import { setInternalDirectoryPersonArchived, updateInternalDirectoryPerson } from "@/app/actions/internal-people"
import { saveProjectContact } from "@/app/actions/project-contacts"
import { archiveUnassignedPersonAction, editUnassignedPerson } from "@/app/actions/unassigned-people"
import { getInternalDirectoryContacts, updateVendor } from "@/app/actions/vendors"
import { INTERNAL_ACCOUNT_LOCK, INTERNAL_SAGE_LOCK } from "@/lib/domain/contacts/internal-people"
import { initialInput } from "@/components/projects/contact-editor/contact-editor-rules"
import { toContactItem } from "@/lib/domain/contacts/rules"
import { UNASSIGNED_ACCOUNT_LOCK } from "@/lib/domain/contacts/unassigned-person-edit"

type Sqlite = ReturnType<typeof migratedDatabase>
type Row = Record<string, unknown>

const ORG = "org-1"
const NOW = "2026-11-01T00:00:00.000Z"
const FUTURE = "2099-01-01T00:00:00.000Z"
const IDENTITY = "bt-person:jane"

let sqlite: Sqlite

function insert(table: string, row: Record<string, string | number | null>): void {
  const keys = Object.keys(row)
  sqlite.prepare(`INSERT INTO ${table} (${keys.map((key) => `"${key}"`).join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`)
    .run(...Object.values(row))
}

function rows(query: string, ...binds: readonly unknown[]): Row[] {
  return sqlite.prepare(query).all(...binds).filter(isRecord)
}

function one(query: string, ...binds: readonly unknown[]): Row {
  const row = rows(query, ...binds)[0]
  if (!row) throw new Error(`no row for ${query}`)
  return row
}

function user(id: string, email: string, isActive: number): void {
  insert("users", { id, email, role: "client", is_active: isActive, created_at: NOW, updated_at: NOW })
}

function invitation(id: string, contactId: string, status: "sent" | "accepted", email: string, acceptedBy: string | null = null): void {
  insert("project_access_invitations", {
    id, organization_id: ORG, project_id: "project-1", project_contact_id: contactId, email, role: "client",
    status, workos_expires_at: FUTURE, invited_by: "staff-1", invited_at: NOW, accepted_by: acceptedBy,
    created_at: NOW, updated_at: NOW,
  })
}

function projectContact(id: string, overrides: Record<string, string | number | null> = {}): void {
  insert("project_contacts", {
    id, project_id: "project-1", contact_type: "subcontractor", source_system: "buildertrend",
    source_entity_type: "buildertrend_new_person", source_entity_id: IDENTITY,
    display_name: "Jane Doe", company_name: "Acme", email: "jane@acme.example",
    owner_portal_visible: 0, sub_vendor_portal_visible: 0, internal_visible: 1, active: 1,
    created_at: NOW, updated_at: NOW, ...overrides,
  })
}

function activity(action: string): Row[] {
  return rows("SELECT * FROM activity_events WHERE action = ?", action)
}

const sageTables = (): Record<string, unknown> => Object.fromEntries(
  rows("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'sage%'")
    .map((table) => [String(table.name), one(`SELECT count(*) AS n FROM "${String(table.name)}"`).n])
)

beforeEach(() => {
  sqlite = migratedDatabase()
  sqlite.pragma("foreign_keys = OFF")
  // @ts-expect-error The test binding implements only what drizzle's D1 driver calls.
  mocks.db.mockReturnValue(drizzle(d1Over(sqlite)))
  mocks.user.mockResolvedValue({
    id: "staff-1", email: "staff@example.com", organizationId: ORG, role: "admin", isActive: true,
    displayName: "Staff", firstName: null, lastName: null,
  })
  insert("organizations", { id: ORG, name: ORG, slug: ORG, type: "company", is_active: 1, created_at: NOW, updated_at: NOW })
  for (const id of ["project-1", "project-2"]) {
    insert("projects", { id, organization_id: ORG, name: id, status: "OPEN", created_at: NOW, updated_at: NOW })
  }
})

afterEach(() => sqlite.close())

describe("Contacts → Unassigned", () => {
  beforeEach(() => {
    projectContact("pc-1")
    projectContact("pc-2", { project_id: "project-2", email: null })
  })

  it("edits an uninvited imported person on every project and logs it to Activity", async () => {
    const result = await editUnassignedPerson({ identity: IDENTITY, name: "Jane Q. Doe", email: "JQ@acme.example", phone: "555-0101", companyName: "Acme Framing" })
    expect(result).toEqual({ success: true, data: { warning: null } })
    expect(rows("SELECT display_name, email, phone, company_name FROM project_contacts ORDER BY id")).toEqual([
      { display_name: "Jane Q. Doe", email: "jq@acme.example", phone: "555-0101", company_name: "Acme Framing" },
      { display_name: "Jane Q. Doe", email: "jq@acme.example", phone: "555-0101", company_name: "Acme Framing" },
    ])
    expect(activity("unassigned_person.updated")).toHaveLength(1)
  })

  it("stays editable with a pending, unaccepted invitation and warns about its old email without touching it", async () => {
    invitation("inv-1", "pc-1", "sent", "jane@acme.example")
    const result = await editUnassignedPerson({ identity: IDENTITY, name: "Jane Doe", email: "jane.new@acme.example", phone: "", companyName: "Acme" })
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.warning).toMatch(/pending Compass invitation sent to their old email/)
    expect(one("SELECT email FROM project_contacts WHERE id = 'pc-1'").email).toBe("jane.new@acme.example")
    expect(one("SELECT status, email, email_attempts FROM project_access_invitations WHERE id = 'inv-1'"))
      .toEqual({ status: "sent", email: "jane@acme.example", email_attempts: 0 })
  })

  it("keeps today's lock once the person accepted an invitation", async () => {
    user("user_jane", "jane@acme.example", 1)
    invitation("inv-1", "pc-1", "accepted", "jane@acme.example", "user_jane")
    const result = await editUnassignedPerson({ identity: IDENTITY, name: "Someone Else", email: "", phone: "", companyName: "" })
    expect(result).toEqual({ success: false, error: UNASSIGNED_ACCOUNT_LOCK })
    expect(one("SELECT display_name FROM project_contacts WHERE id = 'pc-1'").display_name).toBe("Jane Doe")
    expect(await archiveUnassignedPersonAction(IDENTITY)).toEqual({ success: false, error: UNASSIGNED_ACCOUNT_LOCK })
  })

  it("archives without deleting the rows imported messages name", async () => {
    expect(await archiveUnassignedPersonAction(IDENTITY)).toEqual({ success: true, data: { name: "Jane Doe" } })
    expect(rows("SELECT id, active FROM project_contacts ORDER BY id")).toEqual([{ id: "pc-1", active: 0 }, { id: "pc-2", active: 0 }])
    expect(activity("unassigned_person.archived")).toHaveLength(1)
  })

  it("does not archive someone with a pending invitation, so it is revoked first", async () => {
    invitation("inv-1", "pc-1", "sent", "jane@acme.example")
    const result = await archiveUnassignedPersonAction(IDENTITY)
    expect(result.success).toBe(false)
    expect(one("SELECT active FROM project_contacts WHERE id = 'pc-1'").active).toBe(1)
  })
})

describe("vendor and client people", () => {
  const company = { name: "Acme", category: "Subcontractor", email: "", phone: "", address: "" }

  beforeEach(() => {
    insert("vendors", { id: "vendor-1", organization_id: ORG, name: "Acme", category: "Subcontractor", directory_status: "active", created_at: NOW, updated_at: NOW })
    insert("vendor_contacts", { id: "vp-1", vendor_id: "vendor-1", name: "Jane Doe", email: "jane@acme.example", is_primary: 1, active: 1, created_at: NOW, updated_at: NOW })
    projectContact("pc-v", { source_system: "manual", source_entity_type: "vendor", source_entity_id: "vendor-1", vendor_id: "vendor-1", vendor_contact_id: "vp-1" })
    insert("customers", { id: "cust-1", organization_id: ORG, name: "Owner Co", company: "Owner Co", created_at: NOW, updated_at: NOW })
    insert("customer_contacts", { id: "cp-1", customer_id: "cust-1", name: "Olive Owner", email: "olive@owner.example", is_primary: 1, active: 1, created_at: NOW, updated_at: NOW })
    projectContact("pc-c", { contact_type: "owner", source_system: "manual", source_entity_type: "customer", source_entity_id: "cust-1", customer_id: "cust-1", customer_contact_id: "cp-1" })
  })

  const vendorPerson = (email: string) => ({ id: "vp-1", name: "Jane Doe", title: "PM", email, phone: "555-0102", isPrimary: true })

  it("edits an uninvited vendor person and logs it", async () => {
    expect(await updateVendor("vendor-1", { ...company, contacts: [vendorPerson("jane.pm@acme.example")] })).toEqual({ success: true })
    expect(one("SELECT title, email, phone FROM vendor_contacts WHERE id = 'vp-1'")).toEqual({ title: "PM", email: "jane.pm@acme.example", phone: "555-0102" })
    expect(activity("vendor.updated")).toHaveLength(1)
  })

  it("edits a vendor person with a pending invitation and warns about the stale invitation", async () => {
    invitation("inv-v", "pc-v", "sent", "jane@acme.example")
    const result = await updateVendor("vendor-1", { ...company, contacts: [vendorPerson("jane.pm@acme.example")] })
    expect(result.success).toBe(true)
    expect("warning" in result ? result.warning : null).toMatch(/pending Compass invitation/)
    expect(one("SELECT status FROM project_access_invitations WHERE id = 'inv-v'").status).toBe("sent")
  })

  it("keeps today's lock for a vendor person who accepted", async () => {
    user("user_jane", "jane@acme.example", 1)
    invitation("inv-v", "pc-v", "accepted", "jane@acme.example", "user_jane")
    const result = await updateVendor("vendor-1", { ...company, contacts: [vendorPerson("other@acme.example")] })
    expect(result).toEqual({ success: false, error: "Jane Doe manages their own email and phone in Compass." })
  })

  it("edits an uninvited client person, and warns when a pending invitation is left at the old email", async () => {
    const clean = await saveCustomerDirectoryPerson("cust-1", "cp-1", { name: "Olive Owner", title: "", email: "olive@owner.example", phone: "555-0103", isPrimary: true })
    expect(clean).toEqual({ success: true, id: "cp-1" })
    invitation("inv-c", "pc-c", "sent", "olive@owner.example")
    const moved = await saveCustomerDirectoryPerson("cust-1", "cp-1", { name: "Olive Owner", title: "", email: "olive@new.example", phone: "555-0103", isPrimary: true })
    expect(moved.success).toBe(true)
    expect("warning" in moved ? moved.warning : null).toMatch(/pending Compass invitation/)
    expect(one("SELECT email FROM customer_contacts WHERE id = 'cp-1'").email).toBe("olive@new.example")
  })

  it("still sends a Sage-linked person through Sage review", async () => {
    insert("vendors", { id: "vendor-sage", organization_id: ORG, name: "Sage Co", category: "Subcontractor", sage_vendor_id: "S-1", sage_vendor_number: "V1", directory_status: "active", created_at: NOW, updated_at: NOW })
    insert("vendor_contacts", { id: "vp-sage", vendor_id: "vendor-sage", name: "Sam Sage", email: "sam@sage.example", sage_contact_id: "SC-1", sage_line_number: 1, is_primary: 1, active: 1, created_at: NOW, updated_at: NOW })
    insert("customer_contacts", { id: "cp-sage", customer_id: "cust-1", name: "Sid Sage", email: "sid@sage.example", sage_contact_id: "SCC-1", is_primary: 0, active: 1, created_at: NOW, updated_at: NOW })
    const before = sageTables()
    const vendor = await updateVendor("vendor-sage", {
      name: "Sage Co", category: "Subcontractor", email: "", phone: "", address: "",
      contacts: [{ id: "vp-sage", name: "Sam Sage", title: "", email: "new@sage.example", phone: "", isPrimary: true }],
    })
    expect(vendor.success).toBe(false)
    const client = await saveCustomerDirectoryPerson("cust-1", "cp-sage", { name: "Sid Sage", title: "", email: "new@sage.example", phone: "", isPrimary: false })
    expect(client).toEqual({ success: false, error: "Use Sage review for a linked contact." })
    expect(one("SELECT email FROM vendor_contacts WHERE id = 'vp-sage'").email).toBe("sam@sage.example")
    expect(sageTables()).toEqual(before)
  })
})

describe("project contacts", () => {
  function input(overrides: Partial<ReturnType<typeof initialInput>> = {}): ReturnType<typeof initialInput> {
    const row = one("SELECT * FROM project_contacts WHERE id = 'pc-p'")
    const contact = toContactItem({
      id: String(row.id), projectId: "project-1", contactType: "owner", sourceSystem: "manual", sourceRecordId: null,
      sourceEntityType: "manual", sourceEntityId: null, customerId: null, customerContactId: null, vendorId: null,
      vendorContactId: null, internalContactId: null, displayName: "Pat Owner", companyName: null, role: null,
      trade: null, csiDivision: null, csiDivisionName: null, primaryCostCode: null, email: "pat@owner.example",
      phone: null, address: null, notes: null, ownerPortalVisible: false, subVendorPortalVisible: false,
      internalVisible: true, primaryContact: false, sortOrder: 0, active: true, syncStatus: "manual",
      lastSyncedAt: null, createdAt: NOW, updatedAt: NOW,
    })
    return { ...initialInput("project-1", contact), ...overrides }
  }

  beforeEach(() => {
    projectContact("pc-p", { contact_type: "owner", source_system: "manual", source_entity_type: "manual", source_entity_id: null, display_name: "Pat Owner", company_name: null, email: "pat@owner.example" })
  })

  it("edits an uninvited project contact and logs it to Activity", async () => {
    const result = await saveProjectContact(input({ email: "pat@new.example", phone: "555-0104" }))
    expect(result).toEqual({ success: true, contactId: "pc-p" })
    expect(one("SELECT email, phone FROM project_contacts WHERE id = 'pc-p'")).toEqual({ email: "pat@new.example", phone: "555-0104" })
    expect(activity("project_contact.updated")).toHaveLength(1)
  })

  it("edits a project contact with a pending invitation: the old invitation is withdrawn, never resent", async () => {
    invitation("inv-p", "pc-p", "sent", "pat@owner.example")
    const result = await saveProjectContact(input({ email: "pat@new.example" }))
    expect(result.success).toBe(true)
    expect("warning" in result ? result.warning : null).toMatch(/revoked/)
    expect(one("SELECT status, email_attempts FROM project_access_invitations WHERE id = 'inv-p'")).toEqual({ status: "revoked", email_attempts: 0 })
  })

  it("keeps today's lock once the contact accepted", async () => {
    user("user_pat", "pat@owner.example", 1)
    invitation("inv-p", "pc-p", "accepted", "pat@owner.example", "user_pat")
    const result = await saveProjectContact(input({ email: "pat@new.example" }))
    expect(result.success).toBe(false)
    expect(one("SELECT email FROM project_contacts WHERE id = 'pc-p'").email).toBe("pat@owner.example")
  })
})

describe("internal people", () => {
  function internal(id: string, overrides: Record<string, string | number | null> = {}): void {
    insert("internal_contacts", { id, organization_id: ORG, name: "Ivy Imported", email: "ivy@old.example", source_system: "buildertrend", active: 0, created_at: NOW, updated_at: NOW, ...overrides })
  }
  const edit = (personId: string, values: Partial<{ name: string; jobTitle: string; email: string; phone: string; cellPhone: string }> = {}) =>
    updateInternalDirectoryPerson({ personId, name: "Ivy Imported", jobTitle: "", email: "ivy@old.example", phone: "", cellPhone: "", ...values })

  it("edits an archived imported person, updates their project copies and lists them under archived", async () => {
    internal("ic-1")
    projectContact("pc-i", { contact_type: "internal", source_entity_type: "internal_contact", source_entity_id: "ic-1", internal_contact_id: "ic-1", display_name: "Ivy Imported", email: "ivy@old.example" })
    expect(await edit("ic-1", { name: "Ivy Field", email: "ivy@new.example", phone: "555-0105" })).toEqual({ success: true, data: { warning: null } })
    expect(one("SELECT name, email, phone FROM internal_contacts WHERE id = 'ic-1'")).toEqual({ name: "Ivy Field", email: "ivy@new.example", phone: "555-0105" })
    expect(one("SELECT display_name, email, phone FROM project_contacts WHERE id = 'pc-i'")).toEqual({ display_name: "Ivy Field", email: "ivy@new.example", phone: "555-0105" })
    expect(activity("internal_contact.updated")).toHaveLength(1)
    const archived = await getInternalDirectoryContacts({ archived: true })
    expect(archived.map((person) => [person.id, person.accountHolder, person.active])).toEqual([["ic-1", false, false]])
  })

  it("stays editable while their Compass invitation is pending, and warns that it went to the old email", async () => {
    user("pending-ivy", "ivy@old.example", 0)
    internal("ic-1", { user_id: "pending-ivy", active: 1 })
    const result = await edit("ic-1", { email: "ivy@new.example" })
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.warning).toMatch(/pending Compass invitation was sent to ivy@old.example/)
    expect(one("SELECT email FROM users WHERE id = 'pending-ivy'").email).toBe("ivy@old.example")
  })

  it("keeps an accepted account holder's information theirs", async () => {
    user("user_ivy", "ivy@old.example", 1)
    internal("ic-1", { user_id: "user_ivy", active: 1 })
    expect(await edit("ic-1", { name: "Changed" })).toEqual({ success: false, error: INTERNAL_ACCOUNT_LOCK })
  })

  it("edits a Sage-linked employee's name and title but sends email and phones through Sage", async () => {
    internal("ic-1", { sage_employee_id: "E-1", sage_employee_number: "101", active: 1 })
    const before = sageTables()
    expect(await edit("ic-1", { email: "ivy@new.example" })).toEqual({ success: false, error: INTERNAL_SAGE_LOCK })
    expect(await edit("ic-1", { cellPhone: "555-0106" })).toEqual({ success: false, error: INTERNAL_SAGE_LOCK })
    expect((await edit("ic-1", { name: "Ivy Sage", jobTitle: "Estimator" })).success).toBe(true)
    expect(one("SELECT name, job_title, email FROM internal_contacts WHERE id = 'ic-1'")).toEqual({ name: "Ivy Sage", job_title: "Estimator", email: "ivy@old.example" })
    expect(sageTables()).toEqual(before)
    expect((await setInternalDirectoryPersonArchived("ic-1", true)).success).toBe(false)
  })

  it("archives and restores an uninvited person", async () => {
    internal("ic-1", { active: 1 })
    expect(await setInternalDirectoryPersonArchived("ic-1", true)).toEqual({ success: true, data: { name: "Ivy Imported" } })
    expect(one("SELECT active FROM internal_contacts WHERE id = 'ic-1'").active).toBe(0)
    expect(await setInternalDirectoryPersonArchived("ic-1", false)).toEqual({ success: true, data: { name: "Ivy Imported" } })
    expect(one("SELECT active FROM internal_contacts WHERE id = 'ic-1'").active).toBe(1)
    expect(activity("internal_contact.archived")).toHaveLength(1)
    expect(activity("internal_contact.restored")).toHaveLength(1)
  })
})
