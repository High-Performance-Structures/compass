import { drizzle } from "drizzle-orm/d1"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { d1Over } from "@/lib/domain/__tests__/sqlite-d1"
import { migratedDatabase } from "@/lib/domain/contacts/__tests__/directory-seed"
import { COMPASS_ONLY_PRIMARY_ERROR } from "@/lib/sage/contact-edit-gate"
import { isRecord } from "@/lib/shared/guards"

/*
 * Compass-only people (no Sage ids) on a Sage-linked vendor are edited in
 * Compass (owner decision 2026-11-02). The vendor's identity and its Sage
 * people stay behind Sage review, and primary stays with Sage's people.
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

import { updateVendor, type VendorContactMutationInput } from "@/app/actions/vendors"

type Sqlite = ReturnType<typeof migratedDatabase>
type Row = Record<string, unknown>

const ORG = "org-1"
const NOW = "2026-11-01T00:00:00.000Z"
const SAGE_REVIEW = "This vendor is linked to Sage. Contact changes need Sage review before Compass can update the directory."

let sqlite: Sqlite

function insert(table: string, row: Record<string, string | number | null>): void {
  const keys = Object.keys(row)
  sqlite.prepare(`INSERT INTO ${table} (${keys.map((key) => `"${key}"`).join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`)
    .run(...Object.values(row))
}

function rows(query: string): Row[] {
  return sqlite.prepare(query).all().filter(isRecord)
}

function sageTableRows(): Record<string, unknown> {
  const tables = rows("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'sage%' ORDER BY name")
  expect(tables.length).toBeGreaterThan(0)
  return Object.fromEntries(tables.map((table) => [String(table.name), rows(`SELECT count(*) AS n FROM "${String(table.name)}"`)[0]?.n]))
}

const sagePerson: VendorContactMutationInput = { id: "vp-sage", name: "Sage Person", title: "Owner", email: "owner@sage.example", phone: "555-0100", isPrimary: true }
const localPerson: VendorContactMutationInput = { id: "vp-local", name: "Jane Doe", title: "", email: "jane@acme.example", phone: "", isPrimary: false }
const company = { name: "Sage Framing", category: "Subcontractor", email: "", phone: "", address: "" }

beforeEach(() => {
  sqlite = migratedDatabase()
  sqlite.pragma("foreign_keys = OFF")
  // @ts-expect-error The test binding implements only what drizzle's D1 driver calls.
  mocks.db.mockReturnValue(drizzle(d1Over(sqlite)))
  mocks.user.mockResolvedValue({ id: "staff-1", email: "staff@example.com", organizationId: ORG, role: "admin", isActive: true })
  insert("vendors", {
    id: "vendor-sage", organization_id: ORG, name: "Sage Framing", category: "Subcontractor",
    sage_vendor_id: "S-1", sage_vendor_number: "V100", directory_status: "active", created_at: NOW, updated_at: NOW,
  })
  insert("vendor_contacts", {
    id: "vp-sage", vendor_id: "vendor-sage", name: "Sage Person", title: "Owner", email: "owner@sage.example", phone: "555-0100",
    sage_contact_id: "SC-1", sage_line_number: 1, is_primary: 1, active: 1, created_at: NOW, updated_at: NOW,
  })
  insert("vendor_contacts", {
    id: "vp-local", vendor_id: "vendor-sage", name: "Jane Doe", email: "jane@acme.example", is_primary: 0, active: 1, created_at: NOW, updated_at: NOW,
  })
})

afterEach(() => sqlite.close())

describe("Compass-only people on a Sage-linked vendor", () => {
  it("edits, adds and removes Compass-only people without touching Sage people or Sage tables", async () => {
    const sageBefore = sageTableRows()
    await expect(updateVendor("vendor-sage", {
      ...company,
      contacts: [sagePerson, { ...localPerson, title: "Project manager", phone: "555-0300" }, { id: null, name: "New Person", title: "", email: "", phone: "", isPrimary: false }],
    })).resolves.toEqual({ success: true })
    expect(rows("SELECT name, title, phone, is_primary, sage_contact_id, active FROM vendor_contacts ORDER BY name")).toEqual([
      { name: "Jane Doe", title: "Project manager", phone: "555-0300", is_primary: 0, sage_contact_id: null, active: 1 },
      { name: "New Person", title: null, phone: null, is_primary: 0, sage_contact_id: null, active: 1 },
      { name: "Sage Person", title: "Owner", phone: "555-0100", is_primary: 1, sage_contact_id: "SC-1", active: 1 },
    ])

    await expect(updateVendor("vendor-sage", { ...company, contacts: [sagePerson] })).resolves.toEqual({ success: true })
    expect(rows("SELECT name FROM vendor_contacts WHERE active = 1")).toEqual([{ name: "Sage Person" }])
    expect(sageTableRows()).toEqual(sageBefore)
  })

  it("keeps Sage people, the vendor's identity and primary behind Sage", async () => {
    await expect(updateVendor("vendor-sage", { ...company, contacts: [{ ...sagePerson, phone: "555-0999" }, localPerson] }))
      .resolves.toEqual({ success: false, error: SAGE_REVIEW })
    await expect(updateVendor("vendor-sage", { ...company, contacts: [localPerson] }))
      .resolves.toEqual({ success: false, error: SAGE_REVIEW })
    await expect(updateVendor("vendor-sage", { ...company, name: "Renamed Framing", contacts: [sagePerson, localPerson] }))
      .resolves.toEqual({ success: false, error: SAGE_REVIEW })
    await expect(updateVendor("vendor-sage", { ...company, contacts: [{ ...sagePerson, isPrimary: false }, { ...localPerson, isPrimary: true }] }))
      .resolves.toEqual({ success: false, error: COMPASS_ONLY_PRIMARY_ERROR })
    expect(rows("SELECT name, phone, is_primary FROM vendor_contacts ORDER BY name")).toEqual([
      { name: "Jane Doe", phone: null, is_primary: 0 },
      { name: "Sage Person", phone: "555-0100", is_primary: 1 },
    ])
    expect(rows("SELECT name FROM vendors")).toEqual([{ name: "Sage Framing" }])
  })

  it("does not hand primary to a Compass-only person when no Sage person is primary", async () => {
    sqlite.prepare("UPDATE vendor_contacts SET is_primary = 0").run()
    await expect(updateVendor("vendor-sage", {
      ...company,
      contacts: [{ id: null, name: "First Listed", title: "", email: "", phone: "", isPrimary: false }, { ...sagePerson, isPrimary: false }, localPerson],
    })).resolves.toEqual({ success: true })
    expect(rows("SELECT count(*) AS n FROM vendor_contacts WHERE is_primary = 1")).toEqual([{ n: 0 }])
  })
})
