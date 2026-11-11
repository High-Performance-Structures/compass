import Database from "better-sqlite3"
import { eq, sql } from "drizzle-orm"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { getTableConfig, type SQLiteTable } from "drizzle-orm/sqlite-core"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import {
  customerContacts,
  customers,
  internalContacts,
  organizationMembers,
  projectContacts,
  projects,
  users,
  vendorContacts,
  vendors,
} from "@/db/schema"
import { contactDirectoryRecordReachable, resolvedContactColumns, resolvedContactValueOf, withContactDirectory } from "@/lib/domain/contacts/resolved-columns"

/*
 * The building block every project-contact reader uses: a linked row reads
 * its directory record, an unlinked or unreachable row falls back to the
 * copy, and a linked record's blank wins over the copy.
 */

const TABLES: readonly SQLiteTable[] = [projects, projectContacts, customers, customerContacts, vendors, vendorContacts, internalContacts, users, organizationMembers]
const NOW = "2026-11-10T00:00:00.000Z"

let sqlite: InstanceType<typeof Database>

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
    source_entity_type: "manual",
    display_name: "Copied name",
    company_name: "Copied company",
    email: "copied@example.com",
    phone: "000",
    address: "Copied address",
    active: 1,
    ...row,
  })
}

beforeEach(() => {
  sqlite = new Database(":memory:")
  for (const table of TABLES) {
    const config = getTableConfig(table)
    sqlite.exec(`CREATE TABLE ${config.name} (${config.columns.map((column) => `"${column.name}"`).join(", ")})`)
  }
  insert("projects", { id: "project-1", organization_id: "org-1", name: "Project", created_at: NOW, updated_at: NOW })
  insert("customers", { id: "customer-1", organization_id: "org-1", name: "Directory Client", company: "Client Co", email: "client@example.com", phone: "111", address: "1 Client Way" })
  insert("customer_contacts", { id: "person-1", customer_id: "customer-1", name: "Directory Person", email: "person@example.com", phone: "", active: 1 })
  insert("customer_contacts", { id: "person-archived", customer_id: "customer-1", name: "Archived Person", email: "archived@example.com", phone: "9", active: 0 })
  insert("vendors", { id: "vendor-1", organization_id: "org-1", directory_status: "active", name: "Directory Vendor", email: "vendor@example.com", phone: "222", address: "2 Vendor Road" })
  insert("vendors", { id: "vendor-other", organization_id: "org-2", directory_status: "active", name: "Other Org Vendor", email: "other@example.com" })
  insert("internal_contacts", { id: "staff-1", organization_id: "org-1", name: "Staff Person", email: "staff@example.com", phone: "333", active: 1 })
  insert("users", { id: "user-1", email: "user@example.com", phone: "444" })
  insert("organization_members", { id: "m1", user_id: "user-1", organization_id: "org-1" })

  projectContact("pc-person", { customer_id: "customer-1", customer_contact_id: "person-1" })
  projectContact("pc-vendor", { contact_type: "subcontractor", vendor_id: "vendor-1" })
  projectContact("pc-staff", { contact_type: "internal", internal_contact_id: "staff-1" })
  projectContact("pc-user", { contact_type: "internal", source_entity_type: "user", source_entity_id: "user-1" })
  projectContact("pc-manual", {})
  projectContact("pc-archived", { customer_id: "customer-1", customer_contact_id: "person-archived" })
  projectContact("pc-foreign", { contact_type: "subcontractor", vendor_id: "vendor-other" })
})

afterEach(() => sqlite.close())

type Resolved = { readonly id: string; readonly displayName: string; readonly companyName: string | null; readonly email: string | null; readonly phone: string | null; readonly address: string | null }

async function joined(organizationId?: string): Promise<ReadonlyMap<string, Resolved>> {
  const db = drizzle(sqlite)
  const query = db.select({ id: projectContacts.id, ...resolvedContactColumns }).from(projectContacts).$dynamic()
  const rows = await withContactDirectory(query, organizationId)
  return new Map(rows.map((row) => [row.id, row]))
}

describe("withContactDirectory + resolvedContactColumns", () => {
  it.each([["the given organization", "org-1"], ["the project's organization", undefined]])("reads linked rows from the directory (%s)", async (_label, organizationId) => {
    const rows = await joined(organizationId)
    expect(rows.get("pc-person")).toMatchObject({
      displayName: "Directory Person",
      companyName: "Client Co",
      email: "person@example.com",
      // The linked person's blank phone wins over the copied "000".
      phone: null,
      address: "1 Client Way",
    })
    expect(rows.get("pc-vendor")).toMatchObject({ displayName: "Directory Vendor", email: "vendor@example.com", phone: "222", address: "2 Vendor Road" })
    expect(rows.get("pc-staff")).toMatchObject({ displayName: "Staff Person", email: "staff@example.com", phone: "333", address: null })
    expect(rows.get("pc-user")).toMatchObject({ email: "user@example.com", phone: "444" })
  })

  it("falls back to the copy for unlinked, archived and other-organization rows", async () => {
    const rows = await joined()
    const copy = { displayName: "Copied name", email: "copied@example.com", phone: "000", address: "Copied address" }
    expect(rows.get("pc-manual")).toMatchObject({ ...copy, companyName: "Copied company" })
    expect(rows.get("pc-archived")).toMatchObject(copy)
    expect(rows.get("pc-foreign")).toMatchObject({ ...copy, companyName: "Copied company" })
  })

  it("filters and orders on resolved values, alongside the query's own customers join", async () => {
    const db = drizzle(sqlite)
    const query = db
      .select({ id: projectContacts.id, customerName: customers.name, email: resolvedContactColumns.email })
      .from(projectContacts)
      .leftJoin(customers, eq(customers.id, projectContacts.customerId))
      .$dynamic()
    const rows = await withContactDirectory(query, "org-1")
      .where(sql`lower(${resolvedContactColumns.email}) = 'person@example.com'`)
      .orderBy(resolvedContactColumns.displayName)
    expect(rows).toEqual([{ id: "pc-person", customerName: "Directory Client", email: "person@example.com" }])
    // The copy no longer matches a linked row.
    const stale = await withContactDirectory(db.select({ id: projectContacts.id }).from(projectContacts).$dynamic())
      .where(sql`${resolvedContactColumns.email} = 'copied@example.com'`)
    expect(stale.map((row) => row.id).sort()).toEqual(["pc-archived", "pc-foreign", "pc-manual"])
  })
})

describe("resolvedContactValueOf (correlated)", () => {
  it("matches the join form for every row", async () => {
    const db = drizzle(sqlite)
    const rows = await db
      .select({
        id: projectContacts.id,
        displayName: resolvedContactValueOf("displayName"),
        companyName: resolvedContactValueOf("companyName"),
        email: resolvedContactValueOf("email"),
        phone: resolvedContactValueOf("phone"),
        address: resolvedContactValueOf("address"),
      })
      .from(projectContacts)
    const expected = await joined()
    for (const row of rows) expect(row).toEqual(expected.get(row.id))
  })

  it("reads another row by id (a raw SQL alias)", async () => {
    const db = drizzle(sqlite)
    const row = await db
      .select({ email: sql<string | null>`(select ${resolvedContactValueOf("email", sql`other.id`)} from project_contacts other where other.id = 'pc-vendor')` })
      .from(projectContacts)
      .where(eq(projectContacts.id, "pc-manual"))
      .get()
    expect(row?.email).toBe("vendor@example.com")
  })
})

describe("contactDirectoryRecordReachable", () => {
  it("is true only where the join form reads the directory", async () => {
    const db = drizzle(sqlite)
    const rows = await db.select({ id: projectContacts.id }).from(projectContacts).where(contactDirectoryRecordReachable())
    expect(rows.map((row) => row.id).sort()).toEqual(["pc-person", "pc-staff", "pc-user", "pc-vendor"])
  })
})

describe("merged records", () => {
  beforeEach(() => {
    // A client merged into customer-1, a vendor merged into vendor-1, a person merged into person-1,
    // a vendor excluded without a survivor, and a client merged into a record that is itself merged.
    insert("customers", { id: "customer-merged", organization_id: "org-1", name: "Old Client", email: "old@example.com", merged_into_customer_id: "customer-1" })
    insert("vendors", { id: "vendor-merged", organization_id: "org-1", directory_status: "merged", name: "Old Vendor", email: "oldvendor@example.com", merged_into_vendor_id: "vendor-1" })
    insert("vendors", { id: "vendor-excluded", organization_id: "org-1", directory_status: "excluded_not_needed", name: "Excluded Vendor", email: "excluded@example.com" })
    insert("customer_contacts", { id: "person-merged", customer_id: "customer-1", name: "Old Person", email: "oldperson@example.com", active: 0, merged_into_person_id: "person-1" })
    insert("customers", { id: "customer-gone", organization_id: "org-1", name: "Gone", merged_into_customer_id: "customer-merged" })
    projectContact("pc-merged-client", { customer_id: "customer-merged" })
    projectContact("pc-merged-vendor", { contact_type: "subcontractor", source_entity_type: "vendor", source_entity_id: "vendor-merged" })
    projectContact("pc-excluded-vendor", { contact_type: "subcontractor", vendor_id: "vendor-excluded" })
    projectContact("pc-merged-person", { customer_id: "customer-merged", customer_contact_id: "person-merged" })
    projectContact("pc-two-hops", { customer_id: "customer-gone" })
  })

  it("follows a merged company and a merged person to the survivor", async () => {
    const rows = await joined()
    expect(rows.get("pc-merged-client")).toMatchObject({ displayName: "Directory Client", email: "client@example.com", address: "1 Client Way" })
    expect(rows.get("pc-merged-vendor")).toMatchObject({ displayName: "Directory Vendor", email: "vendor@example.com", phone: "222" })
    expect(rows.get("pc-merged-person")).toMatchObject({ displayName: "Directory Person", email: "person@example.com", companyName: "Client Co" })
  })

  it("falls back to the copy for an inactive vendor and a survivor that was merged again", async () => {
    const rows = await joined()
    expect(rows.get("pc-excluded-vendor")).toMatchObject({ displayName: "Copied name", email: "copied@example.com" })
    expect(rows.get("pc-two-hops")).toMatchObject({ displayName: "Copied name", email: "copied@example.com" })
  })

  it("agrees across the join, correlated and reachable forms", async () => {
    const db = drizzle(sqlite)
    const expected = await joined()
    const correlated = await db.select({ id: projectContacts.id, email: resolvedContactValueOf("email") }).from(projectContacts)
    for (const row of correlated) expect(row.email).toBe(expected.get(row.id)?.email)
    const reachable = await db.select({ id: projectContacts.id }).from(projectContacts).where(contactDirectoryRecordReachable())
    expect(reachable.map((row) => row.id).sort()).toEqual(
      ["pc-merged-client", "pc-merged-person", "pc-merged-vendor", "pc-person", "pc-staff", "pc-user", "pc-vendor"])
  })
})
