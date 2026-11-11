import Database from "better-sqlite3"
import { beforeEach, describe, expect, it } from "vitest"

import { d1Over } from "@/lib/domain/__tests__/sqlite-d1"
import {
  clientCompanyJoinBatch,
  clientCompanyJoinOptions,
  inspectClientCompanyJoin,
  type ClientCompanyJoinPlan,
} from "@/lib/domain/contacts/join-client-company"
import { isRecord } from "@/lib/shared/guards"

import { migratedDatabase } from "./directory-seed"

/*
 * "Company" on a client person's record: joining a client company runs on a
 * database built from every migration, so the guards, the project-contact
 * scope triggers and the unique sign-in index run exactly as D1 runs them.
 * All names are fictional.
 */

type Sqlite = InstanceType<typeof Database>
type Row = Record<string, unknown>

const ORG = "org-1"
const T0 = "2026-01-01T00:00:00.000Z"
const NOW = "2026-11-10T12:00:00.000Z"
const RECORD = "client-robin"
const COMPANY = "client-lakeside"
const PAIR = { organizationId: ORG, recordId: RECORD, companyId: COMPANY }
const ACTOR = { userId: "staff-1", name: "Office Staff", role: "admin", now: NOW }

function isD1(value: unknown): value is D1Database {
  return isRecord(value) && typeof value.prepare === "function" && typeof value.batch === "function"
}

function insert(sqlite: Sqlite, table: string, row: Row): void {
  const columns = Object.keys(row)
  sqlite.prepare(`INSERT INTO ${table} (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`)
    .run(...columns.map((column) => row[column]))
}

function all(sqlite: Sqlite, query: string, ...binds: readonly unknown[]): Row[] {
  return sqlite.prepare(query).all(...binds).filter(isRecord)
}

function one(sqlite: Sqlite, query: string, ...binds: readonly unknown[]): Row {
  const [row] = all(sqlite, query, ...binds)
  if (!row) throw new Error(`no row for ${query}`)
  return row
}

function person(sqlite: Sqlite, id: string, customerId: string, name: string, extra: Row = {}): void {
  insert(sqlite, "customer_contacts", { id, customer_id: customerId, name, created_at: T0, updated_at: T0, ...extra })
}

function projectContact(sqlite: Sqlite, id: string, projectId: string, extra: Row): void {
  insert(sqlite, "project_contacts", {
    id, project_id: projectId, contact_type: "owner", display_name: "Robin Vale", created_at: T0, updated_at: T0, ...extra,
  })
}

describe("joining a client company", () => {
  let sqlite: Sqlite
  let d1: D1Database

  beforeEach(() => {
    sqlite = migratedDatabase()
    sqlite.exec("PRAGMA foreign_keys = ON")
    const binding = d1Over(sqlite)
    if (!isD1(binding)) throw new Error("Not a D1 stand-in")
    d1 = binding
    insert(sqlite, "organizations", { id: ORG, name: ORG, slug: ORG, type: "internal", is_active: 1, created_at: T0, updated_at: T0 })
    insert(sqlite, "users", { id: "staff-1", email: "staff@builder.test", role: "admin", is_active: 1, created_at: T0, updated_at: T0 })
    insert(sqlite, "users", { id: "portal-robin", email: "robin@vale.test", role: "client", is_active: 1, created_at: T0, updated_at: T0 })
    insert(sqlite, "organization_members", { id: "member-robin", organization_id: ORG, user_id: "portal-robin", role: "client", joined_at: T0 })
    insert(sqlite, "projects", { id: "job-1", name: "Lakeside Hall", organization_id: ORG, created_at: T0 })
    // A job whose imported conversations are kept staff-only (legal hold): its rows are updated in place, never re-created.
    insert(sqlite, "projects", { id: "job-2", name: "Lakeside Annex", organization_id: ORG, created_at: T0, imported_conversations_staff_only: 1 })
    insert(sqlite, "customers", {
      id: RECORD, name: "Robin Vale", company: "Lakeside Society", email: "Robin@Vale.test", phone: "(555) 010-2000",
      organization_id: ORG, created_at: T0, updated_at: T0,
    })
    insert(sqlite, "customers", { id: COMPANY, name: "Lakeside Society", sage_client_number: "L-100", organization_id: ORG, created_at: T0, updated_at: T0 })
    projectContact(sqlite, "pc-1", "job-1", { customer_id: RECORD, source_entity_type: "customer", source_entity_id: RECORD })
    projectContact(sqlite, "pc-2", "job-2", { customer_id: RECORD })
    insert(sqlite, "projects", { id: "job-3", name: "Old job", organization_id: ORG, created_at: T0, client_customer_id: RECORD })
  })

  async function join(): Promise<ClientCompanyJoinPlan> {
    const plan = await inspectClientCompanyJoin(d1, PAIR)
    expect(plan.blockers).toEqual([])
    await d1.batch(clientCompanyJoinBatch(d1, plan, ACTOR))
    return plan
  }

  it("adds the person to the company, merges the record and repoints job links in place", async () => {
    const plan = await join()
    expect(plan.person.kind).toBe("new")
    const added = one(sqlite, "SELECT * FROM customer_contacts WHERE customer_id = ?", COMPANY)
    expect(added).toMatchObject({ id: plan.person.personId, name: "Robin Vale", email: "Robin@Vale.test", phone: "(555) 010-2000", active: 1 })
    expect(one(sqlite, "SELECT merged_into_customer_id AS m FROM customers WHERE id = ?", RECORD).m).toBe(COMPANY)
    // Same ids, now naming the company and its person, on both jobs (legal hold included).
    expect(all(sqlite, "SELECT id, customer_id, customer_contact_id, source_entity_id, active FROM project_contacts ORDER BY id")).toEqual([
      { id: "pc-1", customer_id: COMPANY, customer_contact_id: plan.person.personId, source_entity_id: COMPANY, active: 1 },
      { id: "pc-2", customer_id: COMPANY, customer_contact_id: plan.person.personId, source_entity_id: null, active: 1 },
    ])
    // The merge moves the rest (the job's client) and records the audit and Activity.
    expect(one(sqlite, "SELECT client_customer_id AS c FROM projects WHERE id = 'job-3'").c).toBe(COMPANY)
    expect(one(sqlite, "SELECT kind, source_id, destination_id FROM contact_merge_events")).toEqual({ kind: "customer_company", source_id: RECORD, destination_id: COMPANY })
    const activity = one(sqlite, "SELECT action, entity_id, metadata FROM activity_events WHERE action = 'customer.joined_company'")
    expect(activity.entity_id).toBe(COMPANY)
    expect(JSON.parse(String(activity.metadata))).toMatchObject({ recordId: RECORD, personId: plan.person.personId, projectContactIds: ["pc-1", "pc-2"] })
    // Joined records are no longer offered as companies.
    expect((await clientCompanyJoinOptions(d1, { organizationId: ORG, recordId: "someone" })).map((row) => row.id)).toEqual([COMPANY])
  })

  it("links the company's person with the same email instead of adding a duplicate", async () => {
    person(sqlite, "lakeside-robin", COMPANY, "R. Vale", { email: " robin@vale.TEST " })
    const plan = await join()
    expect(plan.person).toEqual({ kind: "existing", personId: "lakeside-robin", name: "R. Vale" })
    expect(all(sqlite, "SELECT id FROM customer_contacts WHERE customer_id = ?", COMPANY)).toEqual([{ id: "lakeside-robin" }])
    expect(all(sqlite, "SELECT DISTINCT customer_contact_id AS c FROM project_contacts")).toEqual([{ c: "lakeside-robin" }])
  })

  it("moves the record's sign-in to the company person and merges the record's own copy", async () => {
    person(sqlite, "lakeside-robin", COMPANY, "Robin Vale", { email: "robin@vale.test" })
    person(sqlite, "own-robin", RECORD, "Robin Vale", { email: "robin@vale.test", user_id: "portal-robin", is_primary: 1 })
    projectContact(sqlite, "pc-3", "job-1", { customer_id: RECORD, customer_contact_id: "own-robin" })
    const plan = await join()
    expect(plan.signIn).toEqual({ userId: "portal-robin", fromPersonId: "own-robin" })
    expect(one(sqlite, "SELECT user_id FROM customer_contacts WHERE id = 'lakeside-robin'").user_id).toBe("portal-robin")
    expect(one(sqlite, "SELECT customer_id, user_id, active, merged_into_person_id FROM customer_contacts WHERE id = 'own-robin'"))
      .toEqual({ customer_id: COMPANY, user_id: null, active: 0, merged_into_person_id: "lakeside-robin" })
    expect(one(sqlite, "SELECT customer_id, customer_contact_id FROM project_contacts WHERE id = 'pc-3'"))
      .toEqual({ customer_id: COMPANY, customer_contact_id: "lakeside-robin" })
    expect(all(sqlite, "SELECT person_id, previous_user_id, next_user_id FROM contact_account_link_events ORDER BY person_id")).toEqual([
      { person_id: "lakeside-robin", previous_user_id: null, next_user_id: "portal-robin" },
      { person_id: "own-robin", previous_user_id: "portal-robin", next_user_id: null },
    ])
  })

  it("moves an accepted invitation's sign-in to the new company person", async () => {
    insert(sqlite, "project_access_invitations", {
      id: "invite-1", organization_id: ORG, project_id: "job-1", project_contact_id: "pc-1", email: "robin@vale.test", role: "client",
      status: "accepted", invited_by: "staff-1", invited_at: T0, accepted_by: "portal-robin", created_at: T0, updated_at: T0,
    })
    const plan = await join()
    expect(plan.signIn).toEqual({ userId: "portal-robin", fromPersonId: null })
    expect(one(sqlite, "SELECT user_id FROM customer_contacts WHERE id = ?", plan.person.personId).user_id).toBe("portal-robin")
    // The invitation still points at the same project contact, which now names the company person.
    expect(one(sqlite, "SELECT customer_contact_id AS c FROM project_contacts WHERE id = 'pc-1'").c).toBe(plan.person.personId)
  })

  it("keeps rows that name another of the record's people on that person", async () => {
    person(sqlite, "own-sam", RECORD, "Sam Vale", { email: "sam@vale.test" })
    projectContact(sqlite, "pc-sam", "job-1", { customer_id: RECORD, customer_contact_id: "own-sam" })
    const plan = await join()
    expect(plan.otherPeople).toEqual(["Sam Vale"])
    expect(one(sqlite, "SELECT customer_id FROM customer_contacts WHERE id = 'own-sam'").customer_id).toBe(COMPANY)
    expect(one(sqlite, "SELECT customer_id, customer_contact_id, active FROM project_contacts WHERE id = 'pc-sam'"))
      .toEqual({ customer_id: COMPANY, customer_contact_id: "own-sam", active: 1 })
  })

  it("blocks a Sage-linked record and changes nothing", async () => {
    sqlite.prepare("UPDATE customers SET sage_client_number = 'R-200' WHERE id = ?").run(RECORD)
    const plan = await inspectClientCompanyJoin(d1, PAIR)
    expect(plan.blockers.join(" ")).toContain("linked to Sage client R-200")
    expect(one(sqlite, "SELECT merged_into_customer_id AS m FROM customers WHERE id = ?", RECORD).m).toBeNull()
  })

  it("does nothing when the plan is stale", async () => {
    const plan = await inspectClientCompanyJoin(d1, PAIR)
    sqlite.prepare("UPDATE customers SET merged_into_customer_id = ? WHERE id = ?").run(COMPANY, RECORD)
    await d1.batch(clientCompanyJoinBatch(d1, plan, ACTOR))
    expect(all(sqlite, "SELECT id FROM customer_contacts")).toEqual([])
    expect(all(sqlite, "SELECT customer_id FROM project_contacts ORDER BY id")).toEqual([{ customer_id: RECORD }, { customer_id: RECORD }])
    expect(all(sqlite, "SELECT id FROM activity_events WHERE action = 'customer.joined_company'")).toEqual([])
  })
})
