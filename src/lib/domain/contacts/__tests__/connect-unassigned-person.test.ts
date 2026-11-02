import { drizzle } from "drizzle-orm/d1"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { COMPANY_NAME_SUFFIXES as SCRIPT_SUFFIXES, normalizeCompanyName as scriptNormalizeCompanyName } from "../../../../../scripts/import-buildertrend-participants.mjs"
import { COMPANY_NAME_SUFFIXES, normalizeCompanyName } from "@/lib/domain/contacts/rules"
import { d1Over } from "@/lib/domain/__tests__/sqlite-d1"
import { isRecord } from "@/lib/shared/guards"

import { migratedDatabase } from "./directory-seed"

/*
 * "Connect to company…" on Contacts → Unassigned, run against a database
 * built from every migration. Connecting must reuse the directory's add path
 * and the project contact save, keep the imported contact rows (messages name
 * them as sender) and never share anything.
 */

const mocks = vi.hoisted(() => ({ user: vi.fn(), db: vi.fn(), canFeature: vi.fn() }))
vi.mock("@/db", () => ({ getDb: mocks.db }))
vi.mock("@/lib/auth", () => ({ getCurrentUser: mocks.user, requireAuth: mocks.user }))
vi.mock("@/lib/db", () => ({ getCloudflareContext: async () => ({ env: { DB: {} } }) }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("@/lib/permission-enforcement", () => ({
  canFeature: mocks.canFeature,
  requireFeaturePermission: async () => undefined,
}))

import { getVendorDirectoryCompany } from "@/app/actions/contact-directory"
import { createVendorContact, updateVendor } from "@/app/actions/vendors"
import {
  connectUnassignedPersonToCompany,
  getUnassignedCompanySuggestion,
  getUnassignedPeople,
} from "@/app/actions/unassigned-people"

type Sqlite = ReturnType<typeof migratedDatabase>
type Row = Record<string, unknown>

const ORG = "org-1"
const NOW = "2026-11-01T00:00:00.000Z"
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

/** Row counts of every Sage table, to prove nothing was written to Sage or queued for it. */
function sageTableRows(): Record<string, unknown> {
  const tables = rows("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'sage%' ORDER BY name")
  expect(tables.length).toBeGreaterThan(0)
  return Object.fromEntries(tables.map((table) => [String(table.name), rows(`SELECT count(*) AS n FROM "${String(table.name)}"`)[0]?.n]))
}

function importedContact(id: string, projectId: string, overrides: Record<string, string | number | null> = {}): void {
  insert("project_contacts", {
    id, project_id: projectId, contact_type: "subcontractor", source_system: "buildertrend",
    source_entity_type: "buildertrend_new_person", source_entity_id: IDENTITY,
    display_name: "Jane Doe", company_name: "Acme Framing, L.L.C.", email: "jane@acme.example",
    owner_portal_visible: 0, sub_vendor_portal_visible: 0, internal_visible: 1, active: 1,
    created_at: NOW, updated_at: NOW, ...overrides,
  })
}

function vendor(id: string, name: string, overrides: Record<string, string | number | null> = {}): void {
  insert("vendors", { id, organization_id: ORG, name, category: "Subcontractor", directory_status: "active", created_at: NOW, updated_at: NOW, ...overrides })
}

beforeEach(() => {
  sqlite = migratedDatabase()
  sqlite.pragma("foreign_keys = OFF")
  // @ts-expect-error The test binding implements only what drizzle's D1 driver calls.
  mocks.db.mockReturnValue(drizzle(d1Over(sqlite)))
  mocks.user.mockResolvedValue({ id: "staff-1", email: "staff@example.com", organizationId: ORG, role: "admin", isActive: true, displayName: "Staff" })
  mocks.canFeature.mockResolvedValue(true)
  insert("organizations", { id: ORG, name: ORG, slug: ORG, type: "company", is_active: 1, created_at: NOW, updated_at: NOW })
  for (const id of ["project-1", "project-2"]) {
    insert("projects", { id, organization_id: ORG, name: id, status: "OPEN", created_at: NOW, updated_at: NOW })
  }
  vendor("vendor-acme", "ACME Framing Inc")
  importedContact("pc-1", "project-1")
  importedContact("pc-2", "project-2", { email: null })
  // An imported message names pc-1 as its sender.
  insert("messages", { id: "msg-1", channel_id: "channel-1", user_id: "staff-1", content: "Hello", imported_sender_contact_id: "pc-1", created_at: NOW })
})

afterEach(() => sqlite.close())

describe("normalizeCompanyName", () => {
  it("matches the Buildertrend importer's company comparison", () => {
    expect([...COMPANY_NAME_SUFFIXES]).toEqual(SCRIPT_SUFFIXES)
    for (const name of ["Acme Framing, L.L.C.", "ACME   framing inc", "Acme Co", "Co", "  ", "O'Brien Plumbing PLLC", "Smith & Sons Ltd."]) {
      expect(normalizeCompanyName(name)).toBe(scriptNormalizeCompanyName(name))
    }
    expect(normalizeCompanyName("Acme Framing, L.L.C.")).toBe("acme framing")
    expect(normalizeCompanyName(null)).toBeNull()
  })
})

describe("Connect to company…", () => {
  it("suggests the vendor whose name matches the imported company name", async () => {
    vendor("vendor-other", "Acme Framing Supply")
    await expect(getUnassignedCompanySuggestion("Acme Framing, L.L.C.")).resolves.toEqual({ kind: "vendor", id: "vendor-acme", name: "ACME Framing Inc" })
    await expect(getUnassignedCompanySuggestion("Nobody Builders")).resolves.toBeNull()
    expect((await getUnassignedPeople())[0]?.companyName).toBe("Acme Framing, L.L.C.")
  })

  it("adds the person to the vendor and links every imported contact in place, sharing nothing", async () => {
    const result = await connectUnassignedPersonToCompany({ identity: IDENTITY, kind: "vendor", companyId: "vendor-acme" })
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data).toMatchObject({ companyName: "ACME Framing Inc", createdPerson: true, failed: [] })

    const people = rows("SELECT id, name, email, is_primary FROM vendor_contacts WHERE vendor_id = 'vendor-acme'")
    expect(people).toEqual([{ id: result.data.personId, name: "Jane Doe", email: "jane@acme.example", is_primary: 1 }])
    const contacts = rows("SELECT id, vendor_id, vendor_contact_id, source_entity_type, company_name, contact_type, owner_portal_visible, sub_vendor_portal_visible, active FROM project_contacts ORDER BY id")
    expect(contacts).toEqual(["pc-1", "pc-2"].map((id) => ({
      id, vendor_id: "vendor-acme", vendor_contact_id: result.data.personId, source_entity_type: "vendor_contact",
      company_name: "ACME Framing Inc", contact_type: "subcontractor", owner_portal_visible: 0, sub_vendor_portal_visible: 0, active: 1,
    })))
    expect(rows("SELECT imported_sender_contact_id FROM messages")).toEqual([{ imported_sender_contact_id: "pc-1" }])
    await expect(getUnassignedPeople()).resolves.toEqual([])
    expect(rows("SELECT action FROM activity_events")).toEqual([{ action: "unassigned_person.connected" }])
  })

  it("reuses the person already on the vendor and archives a duplicate on a project that lists them", async () => {
    insert("vendor_contacts", { id: "vp-jane", vendor_id: "vendor-acme", name: "jane  doe", email: "j@acme.example", is_primary: 1, active: 1, created_at: NOW, updated_at: NOW })
    insert("project_contacts", {
      id: "pc-existing", project_id: "project-2", contact_type: "subcontractor", source_system: "global_directory",
      source_entity_type: "vendor_contact", source_entity_id: "vp-jane", vendor_id: "vendor-acme", vendor_contact_id: "vp-jane",
      display_name: "jane  doe", active: 1, created_at: NOW, updated_at: NOW,
    })
    const result = await connectUnassignedPersonToCompany({ identity: IDENTITY, kind: "vendor", companyId: "vendor-acme" })
    expect(result.success && result.data).toMatchObject({ personId: "vp-jane", createdPerson: false, failed: [] })
    expect(rows("SELECT count(*) AS n FROM vendor_contacts")).toEqual([{ n: 1 }])
    expect(rows("SELECT id, vendor_contact_id, active FROM project_contacts ORDER BY id")).toEqual([
      { id: "pc-1", vendor_contact_id: "vp-jane", active: 1 },
      { id: "pc-2", vendor_contact_id: "vp-jane", active: 0 },
      { id: "pc-existing", vendor_contact_id: "vp-jane", active: 1 },
    ])
    await expect(getUnassignedPeople()).resolves.toEqual([])
  })

  it("connects an owner to the client record that is this person, without sharing with the owner portal", async () => {
    insert("customers", { id: "cust-jane", organization_id: ORG, name: "Jane Doe", relationship_type: "client", created_at: NOW, updated_at: NOW })
    const result = await connectUnassignedPersonToCompany({ identity: IDENTITY, kind: "customer", companyId: "cust-jane" })
    expect(result.success && result.data).toMatchObject({ personId: null, createdPerson: false, failed: [] })
    expect(rows("SELECT count(*) AS n FROM customer_contacts")).toEqual([{ n: 0 }])
    expect(rows("SELECT customer_id, customer_contact_id, contact_type, owner_portal_visible FROM project_contacts WHERE id = 'pc-1'")).toEqual([
      { customer_id: "cust-jane", customer_contact_id: null, contact_type: "owner", owner_portal_visible: 0 },
    ])
  })

  it("adds a named person to a client company through the client people path", async () => {
    insert("customers", { id: "cust-co", organization_id: ORG, name: "Bob Owner", company: "Owner Holdings", relationship_type: "client", created_at: NOW, updated_at: NOW })
    const result = await connectUnassignedPersonToCompany({ identity: IDENTITY, kind: "customer", companyId: "cust-co" })
    expect(result.success && result.data).toMatchObject({ companyName: "Owner Holdings", createdPerson: true })
    expect(rows("SELECT name, email FROM customer_contacts")).toEqual([{ name: "Jane Doe", email: "jane@acme.example" }])
  })

  it("adds the person to a Sage-linked vendor in Compass only: no Sage ids, no Sage writes, primary untouched", async () => {
    vendor("vendor-sage", "Sage Framing", { sage_vendor_id: "S-1", sage_vendor_number: "V100" })
    insert("vendor_contacts", { id: "vp-sage", vendor_id: "vendor-sage", name: "Sage Person", sage_contact_id: "SC-1", sage_line_number: 1, is_primary: 1, active: 1, created_at: NOW, updated_at: NOW })
    const sageBefore = sageTableRows()
    const result = await connectUnassignedPersonToCompany({ identity: IDENTITY, kind: "vendor", companyId: "vendor-sage" })
    expect(result.success && result.data).toMatchObject({ createdPerson: true, compassOnlyOnSageLinked: true, failed: [] })
    if (!result.success) return
    expect(rows("SELECT id, name, sage_contact_id, sage_line_number, is_primary FROM vendor_contacts ORDER BY name")).toEqual([
      { id: result.data.personId, name: "Jane Doe", sage_contact_id: null, sage_line_number: null, is_primary: 0 },
      { id: "vp-sage", name: "Sage Person", sage_contact_id: "SC-1", sage_line_number: 1, is_primary: 1 },
    ])
    expect(sageTableRows()).toEqual(sageBefore)
    expect(rows("SELECT vendor_id FROM project_contacts")).toEqual([{ vendor_id: "vendor-sage" }, { vendor_id: "vendor-sage" }])
    expect(rows("SELECT summary FROM activity_events")).toEqual([
      { summary: "Added a person from imported BT messages to Sage Framing, Compass only (not in Sage)." },
    ])

    // The vendor's other edits still work with the extra Compass-only person:
    // the full form resubmits every person unchanged, and a category change is local.
    const people = await getVendorDirectoryCompany("vendor-sage")
    expect(people.success).toBe(true)
    if (!people.success) return
    const resubmitted = people.data.contacts.map((person) => ({
      id: person.id, name: person.name, title: person.title ?? "", email: person.email ?? "", phone: person.phone ?? "", isPrimary: person.isPrimary,
    }))
    await expect(updateVendor("vendor-sage", { category: "Supplier", contacts: resubmitted })).resolves.toEqual({ success: true })
    await expect(updateVendor("vendor-sage", { category: "Subcontractor" })).resolves.toEqual({ success: true })
    expect(rows("SELECT count(*) AS n FROM vendor_contacts WHERE vendor_id = 'vendor-sage' AND active = 1")).toEqual([{ n: 2 }])
    expect(sageTableRows()).toEqual(sageBefore)

    // The normal add form keeps the Sage review rule.
    await expect(createVendorContact("vendor-sage", { id: null, name: "Someone Else", title: "", email: "", phone: "", isPrimary: false })).resolves.toEqual({
      success: false,
      error: "This vendor is linked to Sage. Add its contact through the reviewed Sage workflow.",
    })
  })

  it("adds the person to a Sage-linked client in Compass only", async () => {
    insert("customers", { id: "cust-sage", organization_id: ORG, name: "Bob Owner", company: "Owner Holdings", sage_client_id: "C-1", sage_client_number: "100", relationship_type: "client", created_at: NOW, updated_at: NOW })
    const sageBefore = sageTableRows()
    const result = await connectUnassignedPersonToCompany({ identity: IDENTITY, kind: "customer", companyId: "cust-sage" })
    expect(result.success && result.data).toMatchObject({ createdPerson: true, compassOnlyOnSageLinked: true })
    expect(rows("SELECT name, sage_contact_id, sage_line_number FROM customer_contacts")).toEqual([{ name: "Jane Doe", sage_contact_id: null, sage_line_number: null }])
    expect(sageTableRows()).toEqual(sageBefore)
  })

  it("needs the permission the add path needs", async () => {
    mocks.canFeature.mockImplementation(async (_user: unknown, feature: string) => feature !== "vendors")
    const result = await connectUnassignedPersonToCompany({ identity: IDENTITY, kind: "vendor", companyId: "vendor-acme" })
    expect(result).toEqual({ success: false, error: "You do not have permission to add people to vendors." })
    expect(rows("SELECT count(*) AS n FROM vendor_contacts")).toEqual([{ n: 0 }])
  })
})
