import Database from "better-sqlite3"
import { beforeEach, describe, expect, it } from "vitest"

import { getDb } from "@/db"
import { d1Over } from "@/lib/domain/__tests__/sqlite-d1"
import { migratedDatabase } from "@/lib/domain/contacts/__tests__/directory-seed"
import type { SageEmployeeDirectoryRow } from "@/lib/domain/sage-bridge/store"
import type { Db } from "@/lib/server/action-context"

import { applySageEmployeeDirectory, linkStaffToSageEmployee, staffSageLinkOverview } from "../employee-directory-sync"

/*
 * Sage's employee list against every migration replayed on SQLite: staff are
 * linked by email only, one-to-one, and linked contacts follow Sage's status.
 */

type Sqlite = ReturnType<typeof migratedDatabase>

const NOW = "2026-11-10T12:00:00.000Z"
const ORG = "org-a"
const GUID = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`

function employee(n: number, email: string | null, patch: Partial<SageEmployeeDirectoryRow> = {}): SageEmployeeDirectoryRow {
  return { sageRecordId: GUID(n), sageEmployeeNumber: String(n), firstName: "Test", lastName: `Person ${n}`, email, sageStatusCode: 1, inactive: false, ...patch }
}

function seed(sqlite: Sqlite): void {
  sqlite.exec(`
    INSERT INTO organizations (id, name, slug, type, created_at, updated_at) VALUES
      ('${ORG}', 'Acme Builders', 'acme', 'internal', '${NOW}', '${NOW}');
    INSERT INTO users (id, email, display_name, role, created_at, updated_at) VALUES
      ('u-linked', 'linked@acme.test', 'Lee Linked', 'field_crew', '${NOW}', '${NOW}'),
      ('u-contact', 'contact@acme.test', 'Cam Contact', 'field_crew', '${NOW}', '${NOW}'),
      ('u-nocontact', 'NoContact@Acme.test', 'Nia Nocontact', 'office', '${NOW}', '${NOW}'),
      ('u-client', 'client@acme.test', 'Cli Ent', 'client', '${NOW}', '${NOW}');
    INSERT INTO organization_members (id, organization_id, user_id, role, joined_at) VALUES
      ('m1', '${ORG}', 'u-linked', 'field_crew', '${NOW}'),
      ('m2', '${ORG}', 'u-contact', 'field_crew', '${NOW}'),
      ('m3', '${ORG}', 'u-nocontact', 'office', '${NOW}'),
      ('m4', '${ORG}', 'u-client', 'client', '${NOW}');
    INSERT INTO internal_contacts (id, organization_id, user_id, name, email, sage_employee_id, sage_employee_number, source_system, active, created_at, updated_at) VALUES
      ('ic-linked', '${ORG}', 'u-linked', 'Lee Linked', 'linked@acme.test', '${GUID(1)}', '1', 'sage', 1, '${NOW}', '${NOW}'),
      ('ic-contact', '${ORG}', 'u-contact', 'Cam Contact', NULL, NULL, NULL, 'compass_user', 1, '${NOW}', '${NOW}'),
      ('ic-twin-a', '${ORG}', NULL, 'Twin A', 'shared@acme.test', NULL, NULL, 'manual', 1, '${NOW}', '${NOW}'),
      ('ic-twin-b', '${ORG}', NULL, 'Twin B', 'Shared@acme.test', NULL, NULL, 'manual', 1, '${NOW}', '${NOW}'),
      ('ic-namesake', '${ORG}', NULL, 'Test Person 9', 'other@acme.test', NULL, NULL, 'manual', 1, '${NOW}', '${NOW}');
  `)
}

let sqlite: Sqlite
let d1: D1Database
let db: Db

let migratedImage: Buffer | null = null

/** Replaying every migration is slow, so it runs once and each test gets a copy. */
function migrated(): Sqlite {
  if (!migratedImage) {
    const base = migratedDatabase()
    migratedImage = base.serialize()
    base.close()
  }
  const copy = new Database(migratedImage)
  copy.exec("PRAGMA foreign_keys = ON")
  return copy
}

beforeEach(() => {
  sqlite = migrated()
  seed(sqlite)
  // @ts-expect-error The test binding implements only what drizzle's D1 driver and the batch calls use.
  d1 = d1Over(sqlite)
  db = getDb(d1)
})

function contact(id: string): { readonly active: number; readonly sage_employee_id: string | null; readonly sage_employee_number: string | null } | undefined {
  const row: unknown = sqlite.prepare("SELECT active, sage_employee_id, sage_employee_number FROM internal_contacts WHERE id = ?").get(id)
  if (typeof row !== "object" || row === null) return undefined
  return {
    active: Number(Reflect.get(row, "active")),
    sage_employee_id: String(Reflect.get(row, "sage_employee_id") ?? "") || null,
    sage_employee_number: String(Reflect.get(row, "sage_employee_number") ?? "") || null,
  }
}

function count(query: string, ...values: unknown[]): number {
  const row: unknown = sqlite.prepare(query).get(...values)
  return typeof row === "object" && row !== null ? Number(Object.values(row)[0]) : 0
}

const LIST = [
  employee(1, "linked@acme.test"),
  // Matches the contact's login email, not the (blank) contact email.
  employee(2, "CONTACT@acme.test "),
  employee(3, "nocontact@acme.test"),
  employee(4, "shared@acme.test"),
  // Same name as a Compass contact, different email: never linked.
  employee(9, "someone-else@acme.test", { firstName: "Test", lastName: "Person 9" }),
]

describe("Sage employee list: linking staff by email", () => {
  it("links a contact whose email matches exactly one current Sage employee, and records it", async () => {
    const summary = await applySageEmployeeDirectory(db, d1, ORG, LIST, NOW)
    expect(contact("ic-contact")).toMatchObject({ sage_employee_id: GUID(2), sage_employee_number: "2" })
    expect(summary.linked).toBe(2)
    expect(count("SELECT count(*) FROM sage_contact_link_events e JOIN sage_contact_read_requests r ON r.id = e.request_id WHERE r.entity_id = 'ic-contact' AND r.purpose = 'directory_match' AND e.event_type = 'linked'")).toBe(1)
    expect(count("SELECT count(*) FROM sage_contact_read_requests WHERE entity_id = 'ic-contact' AND purpose = 'refresh' AND status = 'queued'")).toBe(1)
    expect(count("SELECT count(*) FROM activity_events WHERE action = 'internal_contact.sage_linked' AND entity_id = 'ic-contact'")).toBe(1)
  })

  it("creates the internal contact for a staff login that has none", async () => {
    await applySageEmployeeDirectory(db, d1, ORG, LIST, NOW)
    const id = `internal-contact-user-${ORG}-u-nocontact`
    expect(contact(id)).toMatchObject({ active: 1, sage_employee_id: GUID(3), sage_employee_number: "3" })
    expect(count("SELECT count(*) FROM internal_contacts WHERE id = ? AND source_system = 'compass_user' AND user_id = 'u-nocontact'", id)).toBe(1)
    // A client login is never given a staff contact.
    expect(count("SELECT count(*) FROM internal_contacts WHERE user_id = 'u-client'")).toBe(0)
  })

  it("skips an ambiguous match and lists it as needing a link", async () => {
    await applySageEmployeeDirectory(db, d1, ORG, [...LIST, employee(5, "nocontact@acme.test")], NOW)
    expect(contact("ic-twin-a")?.sage_employee_id).toBeNull()
    expect(contact("ic-twin-b")?.sage_employee_id).toBeNull()
    // Two current Sage employees share this login's email: no contact is created.
    expect(count("SELECT count(*) FROM internal_contacts WHERE user_id = 'u-nocontact'")).toBe(0)
    const overview = await staffSageLinkOverview(db, ORG)
    const gaps = Object.fromEntries(overview.needsLinking.map((row) => [
      row.target.kind === "contact" ? row.target.internalContactId : row.target.user.userId, row.gap,
    ]))
    expect(gaps).toMatchObject({ "ic-twin-a": "several_staff", "ic-twin-b": "several_staff", "u-nocontact": "several_sage_employees" })
  })

  it("never links on a name alone", async () => {
    await applySageEmployeeDirectory(db, d1, ORG, LIST, NOW)
    expect(contact("ic-namesake")?.sage_employee_id).toBeNull()
    const overview = await staffSageLinkOverview(db, ORG)
    expect(overview.needsLinking.find((row) => row.target.kind === "contact" && row.target.internalContactId === "ic-namesake")?.gap).toBe("no_sage_match")
  })

  it("leaves links for a person when automatic linking is off, and an admin can link by hand", async () => {
    sqlite.exec(`INSERT INTO organization_feature_settings (organization_id, feature_key, value, updated_at) VALUES
      ('${ORG}', 'sage-contact-review', '{"autoLinkEmployeesByEmail":false}', '${NOW}')`)
    await applySageEmployeeDirectory(db, d1, ORG, LIST, NOW)
    expect(contact("ic-contact")?.sage_employee_id).toBeNull()
    const admin = { id: null, email: "admin@acme.test", displayName: "Ann Admin", firstName: null, lastName: null, role: "admin" }
    const result = await linkStaffToSageEmployee(db, ORG, { target: { kind: "contact", internalContactId: "ic-namesake" }, sageRecordId: GUID(9) }, admin, NOW)
    expect(result).toEqual({ success: true })
    expect(contact("ic-namesake")?.sage_employee_number).toBe("9")
    const again = await linkStaffToSageEmployee(db, ORG, { target: { kind: "contact", internalContactId: "ic-contact" }, sageRecordId: GUID(9) }, admin, NOW)
    expect(again.success).toBe(false)
  })
})

describe("Sage employee list: status follows Sage", () => {
  it("makes a linked contact inactive when Sage shows the employee not current, and active again when current", async () => {
    await applySageEmployeeDirectory(db, d1, ORG, [employee(1, "linked@acme.test", { inactive: true })], NOW)
    expect(contact("ic-linked")?.active).toBe(0)
    expect(count("SELECT count(*) FROM activity_events WHERE action = 'internal_contact.sage_deactivated'")).toBe(1)
    // The Compass user and membership are untouched.
    expect(count("SELECT count(*) FROM users WHERE id = 'u-linked' AND is_active = 1")).toBe(1)
    expect(count("SELECT count(*) FROM organization_members WHERE user_id = 'u-linked'")).toBe(1)

    await applySageEmployeeDirectory(db, d1, ORG, [employee(1, "linked@acme.test", { sageStatusCode: 3 })], NOW)
    expect(contact("ic-linked")?.active).toBe(0)

    const summary = await applySageEmployeeDirectory(db, d1, ORG, [employee(1, "linked@acme.test")], NOW)
    expect(contact("ic-linked")?.active).toBe(1)
    expect(summary.reactivated).toBe(1)
    expect(count("SELECT count(*) FROM activity_events WHERE action = 'internal_contact.sage_reactivated'")).toBe(1)
  })

  it("changes nothing for an employee missing from the read", async () => {
    await applySageEmployeeDirectory(db, d1, ORG, [employee(2, "contact@acme.test")], NOW)
    expect(contact("ic-linked")?.active).toBe(1)
  })

  it("leaves status alone when the company turns the setting off", async () => {
    sqlite.exec(`INSERT INTO organization_feature_settings (organization_id, feature_key, value, updated_at) VALUES
      ('${ORG}', 'sage-contact-review', '{"employeeStatusFollowsSage":false}', '${NOW}')`)
    const summary = await applySageEmployeeDirectory(db, d1, ORG, [employee(1, "linked@acme.test", { inactive: true })], NOW)
    expect(contact("ic-linked")?.active).toBe(1)
    expect(summary.deactivated).toBe(0)
  })
})
