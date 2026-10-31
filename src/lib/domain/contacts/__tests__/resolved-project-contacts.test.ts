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

const mocks = vi.hoisted(() => ({ user: vi.fn(), db: vi.fn() }))
vi.mock("@/db", () => ({ getDb: mocks.db }))
vi.mock("@/lib/auth", () => ({ getCurrentUser: mocks.user, requireAuth: mocks.user }))
vi.mock("@/lib/db", () => ({ getCloudflareContext: async () => ({ env: { DB: {} } }) }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))

import { getProjectContactsSummary } from "@/app/actions/project-contacts"

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

/** Every column of each table, untyped: enough for the queries under test. */
function createTables(sqlite: InstanceType<typeof Database>): void {
  for (const table of TABLES) {
    const config = getTableConfig(table)
    sqlite.exec(`CREATE TABLE ${config.name} (${config.columns.map((column) => `"${column.name}"`).join(", ")})`)
  }
}

let sqlite: InstanceType<typeof Database>
const NOW = "2026-10-30T00:00:00.000Z"

function insert(table: string, row: Record<string, string | number | null>): void {
  const keys = Object.keys(row)
  sqlite
    .prepare(`INSERT INTO ${table} (${keys.map((key) => `"${key}"`).join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`)
    .run(...Object.values(row))
}

function projectContact(id: string, row: Record<string, string | number | null>): void {
  insert("project_contacts", {
    id,
    project_id: "project-1",
    contact_type: "owner",
    source_system: "compass",
    source_entity_type: "manual",
    display_name: "Copied name",
    company_name: "Copied company",
    email: "copied@example.com",
    phone: "000",
    address: "Copied address",
    owner_portal_visible: 0,
    sub_vendor_portal_visible: 0,
    internal_visible: 1,
    primary_contact: 0,
    active: 1,
    sort_order: 0,
    sync_status: "manual",
    created_at: NOW,
    updated_at: NOW,
    ...row,
  })
}

beforeEach(() => {
  sqlite = new Database(":memory:")
  createTables(sqlite)
  mocks.db.mockReturnValue(drizzle(sqlite))
  mocks.user.mockResolvedValue({ id: "staff-1", organizationId: "org-1", role: "admin", isActive: true })
  insert("projects", { id: "project-1", organization_id: "org-1", name: "Project", status: "OPEN", created_at: NOW, updated_at: NOW })
  insert("customers", {
    id: "customer-1",
    organization_id: "org-1",
    name: "Directory Client",
    company: "Client Co",
    email: " client@example.com ",
    phone: "111",
    address: "1 Client Way",
    relationship_type: "client",
    created_at: NOW,
  })
  insert("customer_contacts", {
    id: "person-1",
    customer_id: "customer-1",
    name: "Directory Person",
    email: "person@example.com",
    phone: "",
    is_primary: 0,
    active: 1,
    source_system: "manual",
    sync_status: "manual",
    created_at: NOW,
    updated_at: NOW,
  })
  insert("vendors", {
    id: "vendor-1",
    organization_id: "org-1",
    name: "Directory Vendor",
    category: "Subcontractor",
    email: "vendor@example.com",
    phone: "222",
    address: "2 Vendor Road",
    source_system: "manual",
    directory_status: "active",
    sync_status: "manual",
    created_at: NOW,
  })
  insert("internal_contacts", {
    id: "staff-person",
    organization_id: "org-1",
    name: "Staff Person",
    email: "staff@example.com",
    phone: "333",
    source_system: "manual",
    active: 1,
    sync_status: "manual",
    created_at: NOW,
    updated_at: NOW,
  })
})

afterEach(() => sqlite.close())

async function contactsById(): Promise<ReadonlyMap<string, { displayName: string; companyName: string | null; email: string | null; phone: string | null; address: string | null }>> {
  const summary = await getProjectContactsSummary("project-1")
  return new Map(summary.allContacts.map((contact) => [contact.id, contact]))
}

describe("resolvedProjectContacts (link to the directory)", () => {
  it("reads a linked client person from the directory, not the copy", async () => {
    projectContact("pc-person", {
      source_system: "customer_directory",
      source_entity_type: "customer_contact",
      source_entity_id: "person-1",
      customer_id: "customer-1",
      customer_contact_id: "person-1",
    })
    const contact = (await contactsById()).get("pc-person")
    expect(contact).toMatchObject({
      displayName: "Directory Person",
      companyName: "Client Co",
      email: "person@example.com",
      // A linked record owns its blanks: no fallback to the copied phone.
      phone: null,
      address: "1 Client Way",
    })
  })

  it("reads a client linked only by customer_id, trimming directory values", async () => {
    projectContact("pc-client", { customer_id: "customer-1" })
    expect((await contactsById()).get("pc-client")).toMatchObject({
      displayName: "Directory Client",
      companyName: "Client Co",
      email: "client@example.com",
      phone: "111",
      address: "1 Client Way",
    })
  })

  it("reads a vendor linked by vendor_id and a staff member by internal_contact_id", async () => {
    projectContact("pc-vendor", { contact_type: "subcontractor", vendor_id: "vendor-1" })
    projectContact("pc-staff", { contact_type: "internal", internal_contact_id: "staff-person" })
    const contacts = await contactsById()
    expect(contacts.get("pc-vendor")).toMatchObject({
      displayName: "Directory Vendor",
      companyName: "Directory Vendor",
      email: "vendor@example.com",
      phone: "222",
      address: "2 Vendor Road",
    })
    expect(contacts.get("pc-staff")).toMatchObject({
      displayName: "Staff Person",
      email: "staff@example.com",
      phone: "333",
      // Employee addresses never appear on a project.
      address: null,
    })
  })

  it("keeps the copy for unlinked contacts and for links that are no longer reachable", async () => {
    projectContact("pc-manual", {})
    sqlite.prepare("UPDATE customer_contacts SET active = 0 WHERE id = 'person-1'").run()
    projectContact("pc-inactive", {
      source_entity_type: "customer_contact",
      source_entity_id: "person-1",
      customer_id: "customer-1",
      customer_contact_id: "person-1",
      email: "  ",
    })
    const contacts = await contactsById()
    expect(contacts.get("pc-manual")).toMatchObject({
      displayName: "Copied name",
      companyName: "Copied company",
      email: "copied@example.com",
      phone: "000",
      address: "Copied address",
    })
    expect(contacts.get("pc-inactive")).toMatchObject({
      displayName: "Copied name",
      companyName: "Client Co",
      email: null,
      phone: "000",
      address: "Copied address",
    })
  })

  it("never reads another organization's directory record", async () => {
    insert("vendors", {
      id: "vendor-other",
      organization_id: "org-2",
      name: "Other Org Vendor",
      category: "Subcontractor",
      email: "other@example.com",
      source_system: "manual",
      directory_status: "active",
      sync_status: "manual",
      created_at: NOW,
    })
    projectContact("pc-foreign", { contact_type: "subcontractor", vendor_id: "vendor-other" })
    expect((await contactsById()).get("pc-foreign")).toMatchObject({
      displayName: "Copied name",
      email: "copied@example.com",
    })
  })
})
