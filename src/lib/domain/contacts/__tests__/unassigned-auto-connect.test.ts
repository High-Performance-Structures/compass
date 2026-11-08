import { drizzle } from "drizzle-orm/d1"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { d1Over } from "@/lib/domain/__tests__/sqlite-d1"
import { planUnassigned, summarizeUnassignedPlan } from "@/lib/domain/contacts/unassigned-matching"
import { buildMatchDirectory } from "@/lib/domain/conversations/participant-directory"
import { isRecord } from "@/lib/shared/guards"

import { migratedDatabase } from "./directory-seed"

/*
 * Contacts → Unassigned: one row per person (identities with the same email
 * collapse), and "Connect automatically…" connects clear matches through the
 * "Connect to company…" write path, never staff, never by free mail, and
 * never on a legal-hold project.
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

import { getUnassignedPeople, recordUnassignedAutoConnectRun, runUnassignedAutoConnectAction } from "@/app/actions/unassigned-people"

type Sqlite = ReturnType<typeof migratedDatabase>
type Row = Record<string, unknown>

const ORG = "org-1"
const NOW = "2026-11-01T00:00:00.000Z"

let sqlite: Sqlite

function insert(table: string, row: Record<string, string | number | null>): void {
  const keys = Object.keys(row)
  sqlite.prepare(`INSERT INTO ${table} (${keys.map((key) => `"${key}"`).join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`).run(...Object.values(row))
}

function rows(query: string, ...binds: readonly unknown[]): Row[] {
  return sqlite.prepare(query).all(...binds).filter(isRecord)
}

function unassigned(id: string, projectId: string, identity: string, name: string, email: string | null): void {
  insert("project_contacts", {
    id, project_id: projectId, contact_type: "subcontractor", source_system: "buildertrend",
    source_entity_type: "buildertrend_new_person", source_entity_id: identity, display_name: name, email,
    owner_portal_visible: 0, sub_vendor_portal_visible: 0, internal_visible: 1, active: 1, created_at: NOW, updated_at: NOW,
  })
}

beforeEach(() => {
  sqlite = migratedDatabase()
  sqlite.pragma("foreign_keys = OFF")
  // @ts-expect-error The test binding implements only what drizzle's D1 driver calls.
  mocks.db.mockReturnValue(drizzle(d1Over(sqlite)))
  mocks.user.mockResolvedValue({ id: "staff-1", email: "staff@new.example", organizationId: ORG, role: "admin", isActive: true, displayName: "Staff" })
  mocks.canFeature.mockResolvedValue(true)
  insert("organizations", { id: ORG, name: ORG, slug: ORG, type: "company", is_active: 1, created_at: NOW, updated_at: NOW })
  for (const [id, hold] of [["project-1", 0], ["project-2", 0], ["project-hold", 1]] as const) {
    insert("projects", { id, organization_id: ORG, name: id, status: "OPEN", imported_conversations_staff_only: hold, created_at: NOW, updated_at: NOW })
  }
  insert("users", { id: "staff-1", email: "staff@new.example", display_name: "Staff", role: "admin", is_active: 1, created_at: NOW, updated_at: NOW })
  insert("organization_members", { id: "om-1", organization_id: ORG, user_id: "staff-1", role: "admin", joined_at: NOW })
  insert("user_alternate_emails", { id: "alt-1", organization_id: ORG, user_id: "staff-1", email: "staff@old.example", created_at: NOW })
  insert("vendors", { id: "vendor-acme", organization_id: ORG, name: "Acme Framing", category: "Subcontractor", directory_status: "active", created_at: NOW, updated_at: NOW })
  insert("vendor_contacts", { id: "vc-bob", vendor_id: "vendor-acme", name: "Bob Builder", email: "bob@acme.example", active: 1, created_at: NOW, updated_at: NOW })
  // The same staff address is also a vendor contact's (staff must win).
  insert("vendors", { id: "vendor-own", organization_id: ORG, name: "Our Own Sub", category: "Subcontractor", directory_status: "active", created_at: NOW, updated_at: NOW })
  insert("vendor_contacts", { id: "vc-staff-old", vendor_id: "vendor-own", name: "Staff", email: "staff@old.example", active: 1, created_at: NOW, updated_at: NOW })
  insert("vendors", { id: "vendor-steel", organization_id: ORG, name: "Summit Steel, Inc.", category: "Supplier", directory_status: "active", created_at: NOW, updated_at: NOW })

  // One person under two importer identities ("Name <email>" in the email field).
  unassigned("pc-jane-1", "project-1", "new:email:jane@acme.example", "jane@acme.example", "jane@acme.example")
  unassigned("pc-jane-2", "project-2", "new:email:jane doe <jane@acme.example>", "Jane Doe <jane@acme.example>", "Jane Doe <JANE@acme.example>")
  unassigned("pc-staff", "project-1", "new:email:staff@old.example", "staff@old.example", "staff@old.example")
  unassigned("pc-pal", "project-1", "new:email:pal@gmail.com", "pal@gmail.com", "pal@gmail.com")
  unassigned("pc-hold", "project-hold", "new:email:sam@acme.example", "sam@acme.example", "sam@acme.example")
  unassigned("pc-steel", "project-2", "new:email:orders@summitsteel.com", "orders@summitsteel.com", "orders@summitsteel.com")
})

afterEach(() => sqlite.close())

describe("Unassigned list", () => {
  it("shows one row per person when identities share an email", async () => {
    const people = await getUnassignedPeople()
    const jane = people.find((person) => person.email?.includes("jane@acme.example"))
    expect(jane?.projects.map((project) => project.contactId).sort()).toEqual(["pc-jane-1", "pc-jane-2"])
    expect(people).toHaveLength(5)
  })
})

describe("matching plan", () => {
  it("collapses duplicates, puts staff first, matches by business domain only, and suggests by name", () => {
    const built = buildMatchDirectory({
      staff: [{ userId: "staff-1", email: "staff@new.example", name: "Staff", active: true, phone: null }],
      internal: [], alternates: [{ userId: "staff-1", email: "staff@old.example" }],
      vendors: [
        { id: "vendor-acme", name: "Acme Framing", email: null, primaryEmail: null },
        { id: "vendor-own", name: "Our Own Sub", email: null, primaryEmail: null },
        { id: "vendor-steel", name: "Summit Steel, Inc.", email: null, primaryEmail: null },
      ],
      vendorPeople: [
        { id: "vc-bob", vendorId: "vendor-acme", vendorName: "Acme Framing", name: "Bob", email: "bob@acme.example", userId: null, active: true, phone: null },
        { id: "vc-staff-old", vendorId: "vendor-own", vendorName: "Our Own Sub", name: "Staff", email: "staff@old.example", userId: null, active: true, phone: null },
      ],
      clientPeople: [{ id: "cc-1", customerId: "cust-1", customerName: "Lake Family", name: "Kim Lake", email: "kim@lakefamily.example", userId: null, active: true, phone: null }],
      projectContacts: [], companyDomains: [],
      customers: [{ id: "cust-1", name: "Lake Family", email: null }],
    })
    const row = (contactId: string, identity: string, name: string, email: string | null, staffOnly = false): Parameters<typeof planUnassigned>[1][number] =>
      ({ contactId, identity, name, email, projectId: staffOnly ? "hold" : "p1", staffOnly })
    const plan = planUnassigned(built, [
      row("a", "new:email:jane@acme.example", "jane@acme.example", "jane@acme.example"),
      row("b", "new:email:jane doe <jane@acme.example>", "Jane Doe <jane@acme.example>", "Jane Doe <jane@acme.example>"),
      row("c", "new:email:staff@old.example", "staff@old.example", "staff@old.example"),
      row("d", "new:email:pal@gmail.com", "pal@gmail.com", "pal@gmail.com"),
      row("e", "new:email:sam@acme.example", "sam@acme.example", "sam@acme.example", true),
      row("f", "new:email:orders@summitsteel.com", "orders@summitsteel.com", "orders@summitsteel.com"),
      row("g", "new:email:joe@lakefamily.example", "joe@lakefamily.example", "joe@lakefamily.example"),
    ])
    const byKey = new Map(plan.map((group) => [group.key, group]))
    expect(byKey.get("email:jane@acme.example")).toMatchObject({ identities: ["new:email:jane doe <jane@acme.example>", "new:email:jane@acme.example"], result: { kind: "connect", matchType: "vendor_domain", companyKind: "vendor", companyId: "vendor-acme" } })
    expect(byKey.get("email:staff@old.example")?.result).toEqual({ kind: "staff", name: "Staff" })
    expect(byKey.get("email:pal@gmail.com")?.result).toMatchObject({ kind: "none", reason: "no_match" })
    expect(byKey.get("email:orders@summitsteel.com")?.result).toEqual({ kind: "none", reason: "no_match", suggestion: { companyKind: "vendor", vendorId: "vendor-steel", vendorName: "Summit Steel, Inc." } })
    expect(byKey.get("email:joe@lakefamily.example")?.result).toMatchObject({ kind: "connect", companyKind: "customer", companyId: "cust-1" })
    const summary = summarizeUnassignedPlan(plan)
    expect(summary).toMatchObject({ duplicateGroups: 1, duplicateIdentities: 2, legalHoldOnly: { people: 1 }, connect: { people: 2 }, staff: { people: 1 }, leftover: { people: 2 }, withSuggestion: 1 })
  })
})

describe("Connect automatically", () => {
  it("previews, then connects clear matches through Connect to company, once per person", async () => {
    const preview = await runUnassignedAutoConnectAction({ apply: false, skipped: [] })
    expect(preview).toMatchObject({ success: true, data: { remaining: 1, summary: { connect: { people: 1 }, duplicateGroups: 1, staff: { people: 1 } } } })
    expect(rows("SELECT count(*) AS n FROM project_contacts WHERE vendor_id IS NOT NULL")).toEqual([{ n: 0 }])

    const result = await runUnassignedAutoConnectAction({ apply: true, skipped: [] })
    expect(result).toMatchObject({ success: true, data: { connectedPeople: 1, connectedContacts: 2, failed: [], remaining: 0 } })
    // Both identities end on ONE new vendor person, contacts linked in place, nothing shared.
    const jane = rows("SELECT id, name, email FROM vendor_contacts WHERE vendor_id = 'vendor-acme' AND id <> 'vc-bob'")
    expect(jane).toHaveLength(1)
    expect(jane[0]).toMatchObject({ name: "Jane Doe", email: "jane@acme.example" })
    expect(rows("SELECT id, vendor_id, vendor_contact_id, owner_portal_visible, sub_vendor_portal_visible FROM project_contacts WHERE id IN ('pc-jane-1', 'pc-jane-2') ORDER BY id"))
      .toEqual([
        { id: "pc-jane-1", vendor_id: "vendor-acme", vendor_contact_id: jane[0]?.id, owner_portal_visible: 0, sub_vendor_portal_visible: 0 },
        { id: "pc-jane-2", vendor_id: "vendor-acme", vendor_contact_id: jane[0]?.id, owner_portal_visible: 0, sub_vendor_portal_visible: 0 },
      ])
    // Staff, free mail, legal hold and suggestions stay unassigned.
    expect(rows("SELECT id FROM project_contacts WHERE vendor_id IS NULL AND customer_id IS NULL ORDER BY id").map((row) => row.id))
      .toEqual(["pc-hold", "pc-pal", "pc-staff", "pc-steel"])
    expect(rows("SELECT count(*) AS n FROM project_access_invitations")).toEqual([{ n: 0 }])

    expect(await recordUnassignedAutoConnectRun({ people: 1, contacts: 2, failed: 0 })).toEqual({ success: true, data: null })
    expect(rows("SELECT action FROM activity_events WHERE action LIKE 'unassigned_person.%'")).toEqual([{ action: "unassigned_person.auto_connected" }])
  })

  it("includes projects whose imported conversations are kept staff-only only when asked", async () => {
    const preview = await runUnassignedAutoConnectAction({ apply: false, skipped: [], includeStaffOnlyProjects: true })
    expect(preview).toMatchObject({ success: true, data: { remaining: 2, summary: { connect: { people: 2 }, legalHoldOnly: { people: 0 } } } })
    const result = await runUnassignedAutoConnectAction({ apply: true, skipped: [], includeStaffOnlyProjects: true })
    expect(result).toMatchObject({ success: true, data: { connectedPeople: 2, connectedContacts: 3, failed: [], remaining: 0 } })
    expect(rows("SELECT vendor_id, owner_portal_visible, sub_vendor_portal_visible FROM project_contacts WHERE id = 'pc-hold'"))
      .toEqual([{ vendor_id: "vendor-acme", owner_portal_visible: 0, sub_vendor_portal_visible: 0 }])
    expect(rows("SELECT imported_conversations_staff_only AS held FROM projects WHERE id = 'project-hold'")).toEqual([{ held: 1 }])
    expect(rows("SELECT count(*) AS n FROM project_access_invitations")).toEqual([{ n: 0 }])
  })

  it("is for admins only", async () => {
    mocks.user.mockResolvedValue({ id: "staff-2", email: "o@new.example", organizationId: ORG, role: "office", isActive: true, displayName: "Office" })
    expect(await runUnassignedAutoConnectAction({ apply: true, skipped: [] })).toMatchObject({ success: false })
  })
})
