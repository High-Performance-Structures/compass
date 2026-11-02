import Database from "better-sqlite3"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { beforeEach, describe, expect, it } from "vitest"

import { drizzleOverSqlite } from "../../../__tests__/helpers/correspondence-core"
import {
  CAPTURE_SCHEMA,
  PRECHECK_SCHEMA,
  buildBatches,
  conversationId,
  newPeopleCounts,
  parseCapture,
  parsePrecheck,
  planImport,
} from "../../../scripts/import-buildertrend-messages.mjs"
import {
  DIRECTORY_SCHEMA,
  createParticipantResolver,
  normalizeCompanyName,
  parseDirectory,
  parsePeopleCatalog,
} from "../../../scripts/import-buildertrend-participants.mjs"
import { listUnassignedPeople } from "@/lib/domain/contacts/unassigned-people"
import { loadDirectorySummary } from "@/lib/domain/contacts/directory-page"

/*
 * Owner decisions 2026-11-02 for Buildertrend participants with no match in
 * Compass: add them (uninvited, not yet connected to a company); connect them
 * to a vendor when the source names a company that is exactly one Compass
 * vendor (legal suffixes ignored); former employees are archived internal
 * contacts; threads with an unconnected new person import staff-only.
 */

type Sqlite = InstanceType<typeof Database>

const ORG = "org-1"
const P1 = "proj-1"
const P2 = "proj-2"
const NOW = "2026-11-02T00:00:00.000Z"

function directoryWith(vendorNames: readonly { vendorId: string; name: string }[]) {
  return parseDirectory({
    schema: DIRECTORY_SCHEMA,
    people: [
      { personKey: "user:u-pm", kind: "staff", userId: "u-pm", displayName: "Pat PM", emails: ["pm@example.com"], projectIds: [P1, P2] },
      { personKey: "user:u-sam", kind: "staff", userId: "u-sam", displayName: "Sam Staff", emails: [], projectIds: [], btIds: ["internal_user:501"] },
    ],
    vendorNames,
  })
}

const catalog = parsePeopleCatalog([
  { btId: 500, type: "internal_user", displayName: "Fran Former", email: "fran@old.example" },
  { btId: 501, type: "internal_user", displayName: "Sam Staff" },
].map((row) => JSON.stringify(row)).join("\n"))

function resolverWith(vendorNames: readonly { vendorId: string; name: string }[]) {
  return createParticipantResolver({ participantMap: new Map(), directory: directoryWith(vendorNames), catalog, organizationId: ORG })
}

const ref = (overrides: Record<string, unknown>) => ({ participantId: null, namespace: "sub", email: null, displayName: null, companyName: null, role: null, kind: "to", ...overrides })

describe("participants with no match in Compass", () => {
  const resolve = resolverWith([{ vendorId: "v-abc", name: "ABC Plumbing" }])

  it("adds a new person keyed by exact email, else exact full name; one word is not enough", () => {
    expect(resolve(ref({ displayName: "Nick New", email: "Nick@New.example" }), P1))
      .toMatchObject({ rule: "new_person_by_email", entry: { unassigned: true, identity: "new:email:nick@new.example" } })
    expect(resolve(ref({ displayName: "  Nina   New " }), P1))
      .toMatchObject({ rule: "new_person_by_name", entry: { unassigned: true, identity: "new:name:nina new", displayName: "Nina New" } })
    expect(resolve(ref({ displayName: "Nina" }), P1)).toEqual({ reason: "participant_unmatched" })
  })

  it("connects a new person to the one vendor whose name matches, ignoring case, spaces and legal suffixes", () => {
    expect(resolve(ref({ displayName: "Vic Pipe", companyName: "ABC Plumbing" }), P1))
      .toMatchObject({ rule: "connected_by_vendor_name", entry: { kind: "vendor", links: { vendorId: "v-abc" } } })
    expect(resolve(ref({ displayName: "Vic Pipe", companyName: "  abc   PLUMBING " }), P1)).toMatchObject({ rule: "connected_by_vendor_name" })
    expect(resolve(ref({ displayName: "Vic Pipe", companyName: "ABC Plumbing LLC" }), P1)).toMatchObject({ rule: "connected_by_vendor_name" })
    const llc = resolverWith([{ vendorId: "v-abc", name: "abc plumbing" }])
    expect(llc(ref({ displayName: "Vic Pipe", companyName: "ABC Plumbing, Inc." }), P1)).toMatchObject({ rule: "connected_by_vendor_name" })
  })

  it("leaves them unassigned when the company name differs or matches two vendors", () => {
    expect(resolve(ref({ displayName: "Vic Pipe", companyName: "ABC Plumbing & Heating" }), P1)).toMatchObject({ rule: "new_person_by_name", entry: { unassigned: true } })
    const twice = resolverWith([{ vendorId: "v-1", name: "ABC Plumbing" }, { vendorId: "v-2", name: "ABC Plumbing LLC" }])
    expect(twice(ref({ displayName: "Vic Pipe", companyName: "ABC Plumbing" }), P1)).toMatchObject({ rule: "new_person_by_name", entry: { unassigned: true } })
    expect(normalizeCompanyName("A.B.C. Plumbing Co.")).toBe("abc plumbing")
  })

  it("archives a BT employee with no Compass user as a former employee; an active staff user still matches", () => {
    expect(resolve(ref({ namespace: "builder", displayName: "Fran Former" }), P1))
      .toMatchObject({ rule: "former_employee_archived", entry: { kind: "former_staff", userId: null } })
    expect(resolve(ref({ namespace: "builder", displayName: "Sam Staff" }), P1))
      .toMatchObject({ rule: "by_name_catalog", entry: { decision: "user", userId: "u-sam" } })
  })
})

function migrated(): Sqlite {
  const sqlite = new Database(":memory:")
  const dir = join(process.cwd(), "drizzle")
  for (const file of readdirSync(dir).filter((name) => /^\d{4}_.*\.sql$/.test(name)).sort()) {
    sqlite.exec(readFileSync(join(dir, file), "utf8").replaceAll("--> statement-breakpoint", ""))
  }
  sqlite.exec("PRAGMA foreign_keys = ON")
  return sqlite
}

describe("importing new people", () => {
  let sqlite: Sqlite
  beforeEach(() => {
    sqlite = migrated()
    sqlite.exec(`
      INSERT INTO organizations (id, name, slug, type, is_active, created_at, updated_at) VALUES ('${ORG}', 'Org', 'org', 'internal', 1, '${NOW}', '${NOW}');
      INSERT INTO users (id, email, role, is_active, created_at, updated_at) VALUES ('u-pm', 'pm@example.com', 'project_manager', 1, '${NOW}', '${NOW}');
      INSERT INTO projects (id, name, organization_id, created_at) VALUES ('${P1}', 'One', '${ORG}', '${NOW}'), ('${P2}', 'Two', '${ORG}', '${NOW}');
      INSERT INTO vendors (id, name, organization_id, created_at) VALUES ('v-abc', 'ABC Plumbing', '${ORG}', '${NOW}');
    `)
  })

  const pm = { namespace: "builder", email: "pm@example.com", displayName: "Pat PM" }
  function message(id: string, job: string, sender: Record<string, unknown>, recipients: readonly Record<string, unknown>[]): string {
    return JSON.stringify({ schema: CAPTURE_SCHEMA, type: "message", btJobId: job, btThreadId: `9${id}`, btMessageId: id, subject: "Tile", body: "Hi", sentAtDisplay: "Oct 3, 2025 4:12 PM", sender, recipients, attachments: [] })
  }
  const thread = (id: string, job: string) => JSON.stringify({ schema: CAPTURE_SCHEMA, type: "thread", btJobId: job, btThreadId: `9${id}`, messageCount: 1 })
  const lines = [
    message("1", "101", pm, [{ namespace: "sub", displayName: "Nina New", kind: "to" }, { namespace: "sub", displayName: "Nick New", email: "nick@new.example", kind: "cc" }]), thread("1", "101"),
    message("2", "202", pm, [{ namespace: "sub", displayName: "Nina  New", kind: "to" }]), thread("2", "202"),
    message("3", "101", pm, [{ namespace: "sub", displayName: "Vic Pipe", companyName: "ABC Plumbing LLC", kind: "to" }]), thread("3", "101"),
    message("4", "101", { namespace: "builder", displayName: "Fran Former" }, [{ ...pm, kind: "to" }]), thread("4", "101"),
  ]

  function run() {
    const plan = planImport({
      capture: parseCapture(lines.join("\n")),
      resolveParticipant: resolverWith([{ vendorId: "v-abc", name: "ABC Plumbing" }]),
      precheck: parsePrecheck({ schema: PRECHECK_SCHEMA, staffOnlyProjectIds: [], privateArchiveJobIds: [] }),
      projects: { "101": P1, "202": P2 },
      timeZone: "America/Denver",
      organizationId: ORG,
    })
    const built = buildBatches(plan, { actorUserId: "u-pm", now: NOW, driveFiles: new Map(), batchSize: 40 })
    for (const batch of built.batches) sqlite.exec(batch.statements.join("\n"))
    return plan
  }
  const rows = (query: string) => sqlite.prepare(query).all()

  it("adds each new person once, reuses them across messages and projects, and keeps those threads staff-only", () => {
    const plan = run()
    expect(plan.reviews.filter((item: { reason: string }) => item.reason !== "staff_only_pending_identity")).toEqual([])
    const audience = Object.fromEntries(plan.threads.map((item: { btThreadId: string; audience: string }) => [item.btThreadId, item.audience]))
    expect(audience).toEqual({ "91": "staff", "92": "staff", "93": "sub_vendors", "94": "staff" })
    expect(plan.imported_staff_only_pending_identity).toBe(2)
    expect(newPeopleCounts(plan)).toEqual({ new_people_created: { by_email: 1, by_name: 1 }, reused_new_people: 1, former_employees_archived: 1 })
    expect(rows(`SELECT project_id, source_entity_id FROM project_contacts WHERE source_entity_type = 'buildertrend_new_person' AND display_name = 'Nina New' ORDER BY project_id`))
      .toEqual([{ project_id: P1, source_entity_id: "new:name:nina new" }, { project_id: P2, source_entity_id: "new:name:nina new" }])
    const before = rows("SELECT COUNT(*) AS n FROM project_contacts")
    run()
    expect(rows("SELECT COUNT(*) AS n FROM project_contacts")).toEqual(before)
  })

  it("connects a vendor-named person as that vendor's contact, and the thread keeps its vendor audience", () => {
    run()
    expect(rows(`SELECT name, vendor_id FROM vendor_contacts WHERE name = 'Vic Pipe'`)).toEqual([{ name: "Vic Pipe", vendor_id: "v-abc" }])
    expect(rows(`SELECT audience FROM channels WHERE id = '${conversationId(ORG, "93")}'`)).toEqual([{ audience: "sub_vendors" }])
  })

  it("archives a former employee: no account, out of the employee list, still named as sender", async () => {
    run()
    expect(rows(`SELECT name, active, user_id FROM internal_contacts`)).toEqual([{ name: "Fran Former", active: 0, user_id: null }])
    expect(rows(`SELECT contact_type, active FROM project_contacts WHERE source_entity_type = 'buildertrend_former_employee'`)).toEqual([{ contact_type: "internal", active: 0 }])
    expect(rows("SELECT COUNT(*) AS n FROM users")).toEqual([{ n: 1 }])
    expect(rows(`SELECT COUNT(*) AS n FROM channel_members WHERE user_id IS NULL`)).toEqual([{ n: 0 }])
    const summary = await loadDirectorySummary(drizzleOverSqlite(sqlite), ORG, { customers: true, vendors: true, internal: true })
    expect(summary.internalCount).toBe(0)
    expect(rows(`SELECT COALESCE((SELECT pc.display_name FROM project_contacts pc WHERE pc.id = m.imported_sender_contact_id), m.source_sender_label_snapshot) AS sender FROM messages m WHERE m.source_message_id = '4'`))
      .toEqual([{ sender: "Fran Former" }])
  })

  it("lists unconnected new people on the Contacts page, one row per person with every project", async () => {
    run()
    const people = await listUnassignedPeople(drizzleOverSqlite(sqlite), ORG)
    expect(people.map((person) => [person.name, person.email, person.projects.map((project) => project.projectId)])).toEqual([
      ["Nick New", "nick@new.example", [P1]],
      ["Nina New", null, [P1, P2]],
    ])
  })
})
