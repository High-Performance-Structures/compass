import Database from "better-sqlite3"
import { getTableConfig, type SQLiteTable } from "drizzle-orm/sqlite-core"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  customerContacts,
  customers,
  internalContacts,
  organizationMembers,
  projectAccessInvitations,
  projectContacts,
  projectContactSourceLinks,
  projectMembers,
  projects,
  users,
  vendorContacts,
  vendors,
} from "@/db/schema"
import type { ProjectContactMutationInput } from "@/lib/domain/contacts/types"

const mocks = vi.hoisted(() => ({ user: vi.fn(), db: vi.fn() }))
vi.mock("@/db", () => ({ getDb: mocks.db }))
vi.mock("@/lib/auth", () => ({ getCurrentUser: mocks.user, requireAuth: mocks.user }))
vi.mock("@/lib/db", () => ({ getCloudflareContext: async () => ({ env: { DB: {} } }) }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("@/lib/permission-enforcement", () => ({
  canFeature: async () => true,
  requireFeaturePermission: async () => undefined,
}))

import { removeProjectContact, saveProjectContact } from "@/app/actions/project-contacts"

const TABLES: readonly SQLiteTable[] = [
  projects,
  projectContacts,
  customers,
  customerContacts,
  vendors,
  vendorContacts,
  internalContacts,
  users,
  organizationMembers,
  projectAccessInvitations,
  projectMembers,
  projectContactSourceLinks,
]

let sqlite: InstanceType<typeof Database>
const NOW = "2026-10-30T00:00:00.000Z"

function insert(table: string, row: Record<string, string | number | null>): void {
  const keys = Object.keys(row)
  sqlite
    .prepare(`INSERT INTO ${table} (${keys.map((key) => `"${key}"`).join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`)
    .run(...Object.values(row))
}

function storedContact(id: string): Record<string, unknown> {
  const row: unknown = sqlite.prepare("SELECT * FROM project_contacts WHERE id = ?").get(id)
  if (typeof row !== "object" || row === null) throw new Error(`missing contact ${id}`)
  return { ...row }
}

function input(overrides: Partial<ProjectContactMutationInput>): ProjectContactMutationInput {
  return {
    projectId: "project-1",
    contactId: null,
    directorySourceType: null,
    directorySourceId: null,
    vendorId: null,
    vendorContactId: null,
    customerContactId: null,
    contactType: "owner",
    displayName: "Typed Name",
    companyName: "Typed Co",
    role: "Owner",
    trade: "",
    csiDivision: "",
    csiDivisionName: "",
    primaryCostCode: "",
    email: " typed@example.com ",
    phone: "",
    address: "",
    notes: "",
    ownerPortalVisible: true,
    subVendorPortalVisible: false,
    internalVisible: true,
    primaryContact: false,
    ...overrides,
  }
}

beforeEach(() => {
  sqlite = new Database(":memory:")
  for (const table of TABLES) {
    const config = getTableConfig(table)
    sqlite.exec(`CREATE TABLE ${config.name} (${config.columns.map((column) => `"${column.name}"`).join(", ")})`)
  }
  mocks.db.mockReturnValue(drizzle(sqlite))
  mocks.user.mockResolvedValue({ id: "staff-1", organizationId: "org-1", role: "admin", isActive: true })
  insert("projects", { id: "project-1", organization_id: "org-1", name: "Project", status: "OPEN", created_at: NOW, updated_at: NOW })
  insert("vendors", {
    id: "vendor-1",
    organization_id: "org-1",
    name: "Acme Framing",
    category: "Subcontractor",
    email: "office@acme.com",
    phone: "222",
    address: "2 Vendor Road",
    source_system: "manual",
    directory_status: "active",
    sync_status: "synced",
    created_at: NOW,
  })
  insert("vendor_contacts", {
    id: "person-1",
    vendor_id: "vendor-1",
    name: "Sam Foreman",
    email: "sam@acme.com",
    phone: "333",
    is_primary: 1,
    active: 1,
    source_system: "manual",
    created_at: NOW,
    updated_at: NOW,
  })
})

afterEach(() => sqlite.close())

describe("saveProjectContact", () => {
  it("links a vendor person and keeps the directory identity, ignoring echoed form values", async () => {
    const created = await saveProjectContact(
      input({
        contactType: "subcontractor",
        directorySourceType: "vendor",
        directorySourceId: "vendor-1",
        vendorContactId: "person-1",
        role: "Framer",
      })
    )
    expect(created.success).toBe(true)
    if (!created.success) return
    expect(storedContact(created.contactId)).toMatchObject({
      vendor_id: "vendor-1",
      vendor_contact_id: "person-1",
      source_entity_type: "vendor_contact",
      source_system: "global_directory",
      display_name: "Sam Foreman",
      company_name: "Acme Framing",
      email: "sam@acme.com",
      phone: "333",
      role: "Framer",
      sync_status: "synced",
    })

    const edited = await saveProjectContact(
      input({
        contactId: created.contactId,
        contactType: "subcontractor",
        directorySourceType: "vendor",
        directorySourceId: "vendor-1",
        vendorContactId: "person-1",
        displayName: "Edited Name",
        email: "edited@example.com",
        role: "Lead framer",
      })
    )
    expect(edited).toEqual({ success: true, contactId: created.contactId })
    expect(storedContact(created.contactId)).toMatchObject({
      display_name: "Sam Foreman",
      email: "sam@acme.com",
      role: "Lead framer",
    })
    // The directory record is never edited from a project form.
    expect(sqlite.prepare("SELECT email FROM vendor_contacts WHERE id = 'person-1'").get()).toEqual({ email: "sam@acme.com" })
  })

  it("stores typed identity for an unlinked contact and rejects a duplicate assignment", async () => {
    const created = await saveProjectContact(input({}))
    expect(created.success).toBe(true)
    if (!created.success) return
    expect(storedContact(created.contactId)).toMatchObject({
      source_entity_type: "manual",
      display_name: "Typed Name",
      company_name: "Typed Co",
      email: "typed@example.com",
      phone: null,
    })

    const vendorInput = input({
      contactType: "subcontractor",
      directorySourceType: "vendor",
      directorySourceId: "vendor-1",
      vendorContactId: "person-1",
    })
    expect((await saveProjectContact(vendorInput)).success).toBe(true)
    expect(await saveProjectContact(vendorInput)).toEqual({
      success: false,
      error: "This contact is already on the project",
    })
  })

  it("keeps the existing validation messages", async () => {
    expect(await saveProjectContact(input({ contactType: "subcontractor" }))).toEqual({
      success: false,
      error: "Choose a vendor company for this project contact.",
    })
    expect(await saveProjectContact(input({ displayName: " " }))).toEqual({
      success: false,
      error: "Contact name is required",
    })
  })

  it("removes a contact by hiding it", async () => {
    const created = await saveProjectContact(input({}))
    if (!created.success) throw new Error(created.error)
    expect(await removeProjectContact("project-1", created.contactId)).toEqual({ success: true, contactId: created.contactId })
    expect(storedContact(created.contactId)).toMatchObject({ active: 0, owner_portal_visible: 0, internal_visible: 0 })
    expect(await removeProjectContact("project-1", created.contactId)).toEqual({
      success: false,
      error: "Project contact not found",
    })
  })
})
