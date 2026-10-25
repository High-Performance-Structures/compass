import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { and, eq } from "drizzle-orm"
import { openCorrespondenceTestDatabase, type CorrespondenceTestDatabase } from "../../../__tests__/helpers/correspondence-core"
import { projectRfis } from "@/db/schema"
import { inJsonList, vendorVisibleRfiSourceIds } from "@/lib/rfis/vendor-visibility"
import {
  listRfiVendorOptions,
  loadRfiVendorAssignments,
  resolveRfiVendorContact,
  rfiVendorAssignmentStatement,
} from "@/lib/rfis/vendor-assignment"

let database: CorrespondenceTestDatabase
const NOW = "2026-10-24T00:00:00.000Z"

function insertParticipant(id: string, input: { readonly role: string; readonly contactId?: string | null; readonly userId?: string | null; readonly rfiId?: string }): void {
  database.sqlite.prepare(`INSERT INTO project_source_record_participants
    (id,organization_id,project_id,source_record_type,source_record_id,source_participant_id,participant_role,capabilities_json,project_contact_id,user_id,identity_status,membership_status,review_status,active,created_at,updated_at)
    VALUES (?,'org-a','project-a','rfi',?,?,?,'["rfi.view"]',?,?,'matched','active','reviewed',1,?,?)`)
    .run(id, input.rfiId ?? id, id, input.role, input.contactId ?? null, input.userId ?? null, NOW, NOW)
}

beforeEach(() => {
  database = openCorrespondenceTestDatabase()
  database.sqlite.exec("ALTER TABLE project_contacts ADD COLUMN vendor_id TEXT")
  database.sqlite.exec("CREATE TABLE project_rfis (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, source_record_id TEXT)")
  for (const id of ["user-a", "user-a2"]) database.sqlite.prepare("INSERT INTO users (id,email,role,is_active,created_at,updated_at) VALUES (?,?,'supplier',1,?,?)").run(id, `${id}@example.test`, NOW, NOW)
  database.sqlite.exec(readFileSync("drizzle/0140_project_source_record_participants.sql", "utf8").replaceAll("--> statement-breakpoint", ""))
  database.sqlite.exec(`INSERT INTO project_contacts (id,project_id,vendor_id,active,contact_type,display_name,company_name) VALUES
    ('contact-a','project-a','vendor-a',1,'supplier','Avery','Acme Supply'),
    ('contact-a2','project-a','vendor-a',1,'supplier','Alex','Acme Supply'),
    ('contact-b','project-a','vendor-b',1,'subcontractor','Blair','Beta Framing'),
    ('loose','project-a',NULL,1,'subcontractor','Lee','Acme Supply'),
    ('inactive','project-a','vendor-a',0,'supplier','Ira','Acme Supply'),
    ('owner','project-a',NULL,1,'owner','Olive','Owner Co')`)
})
afterEach(() => database.close())

function read(contactId = "contact-a", vendorId: string | null = "vendor-a", viewerId = "user-a"): Promise<readonly string[]> {
  return vendorVisibleRfiSourceIds({ db: database.db, projectId: "project-a", organizationId: "org-a", viewerId, contact: { id: contactId, vendorId, displayName: "Company person", companyName: "Acme Supply", email: "person@example.test", contactType: "supplier" } })
}

describe("vendor RFI visibility: assigned company plus submitter", () => {
  it("shows an RFI assigned to any contact at the viewer's company", async () => {
    insertParticipant("assigned-coworker", { role: "assignee", contactId: "contact-a2" })
    insertParticipant("assigned-other", { role: "assignee", contactId: "contact-b" })
    expect(await read()).toEqual(["assigned-coworker"])
    expect(await read("contact-b", "vendor-b", "user-b")).toEqual(["assigned-other"])
  })

  it("shows a submitter their own RFI but not a coworker's unassigned submission", async () => {
    insertParticipant("mine", { role: "requester", contactId: "contact-a", userId: "user-a" })
    insertParticipant("coworker-submitted", { role: "requester", contactId: "contact-a2", userId: "user-a2" })
    expect(await read()).toEqual(["mine"])
  })

  it("never grants through other participant roles, audience, or a matching company label", async () => {
    insertParticipant("cc", { role: "recipient", contactId: "contact-a" })
    insertParticipant("label-only", { role: "assignee", contactId: "loose" })
    expect(await read()).toEqual([])
    // A contact with no vendor record only matches assignments to itself.
    expect(await read("loose", null, "user-loose")).toEqual(["label-only"])
  })

  it("ignores inactive coworkers, unreviewed rows, and removed capabilities on the next read", async () => {
    insertParticipant("via-inactive", { role: "assignee", contactId: "inactive" })
    insertParticipant("unreviewed", { role: "assignee", contactId: "contact-a" })
    insertParticipant("revoked", { role: "assignee", contactId: "contact-a" })
    database.sqlite.exec("UPDATE project_source_record_participants SET review_status='unreviewed' WHERE id='unreviewed'")
    database.sqlite.exec("UPDATE project_source_record_participants SET capabilities_json='[]' WHERE id='revoked'")
    expect(await read()).toEqual([])
  })

  it("retains an explicit submitter grant without a current contact, and never borrows another user's grant", async () => {
    insertParticipant("mine", { role: "requester", contactId: "contact-a", userId: "user-a" })
    expect(await vendorVisibleRfiSourceIds({ db: database.db, projectId: "project-a", organizationId: "org-a", viewerId: "user-a", contact: null })).toEqual(["mine"])
    expect(await read("contact-a", "vendor-a", "user-a2")).toEqual([])
  })

  it("returns nothing without a viewer contact or across projects", async () => {
    insertParticipant("assigned", { role: "assignee", contactId: "contact-a" })
    expect(await vendorVisibleRfiSourceIds({ db: database.db, projectId: "project-a", organizationId: "org-a", viewerId: "user-a", contact: null })).toEqual([])
    expect(await vendorVisibleRfiSourceIds({ db: database.db, projectId: "project-b", organizationId: "org-a", viewerId: "user-a", contact: { id: "contact-a", vendorId: "vendor-a", displayName: "Avery", companyName: null, email: null, contactType: "supplier" } })).toEqual([])
  })
})

describe("staff vendor assignment", () => {
  it("only accepts an active subcontractor or supplier on the project", async () => {
    expect((await resolveRfiVendorContact(database.db, "project-a", "contact-b"))?.id).toBe("contact-b")
    expect(await resolveRfiVendorContact(database.db, "project-a", "inactive")).toBeNull()
    expect(await resolveRfiVendorContact(database.db, "project-a", "owner")).toBeNull()
    expect(await resolveRfiVendorContact(database.db, "project-b", "contact-a")).toBeNull()
    expect((await listRfiVendorOptions(database.db, "project-a")).map((option) => option.contactId).sort())
      .toEqual(["contact-a", "contact-a2", "contact-b", "loose"])
  })

  it.each(["rfi-legacy", "source-legacy"])("directly clears an imported assignment keyed by %s", async (sourceId) => {
    database.sqlite.exec("INSERT INTO project_rfis VALUES ('rfi-legacy','project-a','source-legacy')")
    insertParticipant("old-company", { role: "assignee", contactId: "contact-a", rfiId: sourceId })
    insertParticipant("submitter", { role: "requester", contactId: "contact-a", userId: "user-a", rfiId: sourceId })
    expect(await read("contact-a2", "vendor-a", "user-a2")).toEqual(["rfi-legacy"])
    await rfiVendorAssignmentStatement(database.db, { organizationId: "org-a", projectId: "project-a", rfiId: "rfi-legacy", contact: null, now: NOW })
    expect(await read("contact-a2", "vendor-a", "user-a2")).toEqual([])
    expect(await read()).toEqual(["rfi-legacy"])
    expect((await loadRfiVendorAssignments(database.db, { organizationId: "org-a", projectId: "project-a" })).size).toBe(0)
  })

  it("replaces and clears historical source-id assignees without removing the submitter", async () => {
    database.sqlite.exec("INSERT INTO project_rfis VALUES ('rfi-legacy','project-a','source-legacy')")
    insertParticipant("old-company", { role: "assignee", contactId: "contact-a", rfiId: "source-legacy" })
    insertParticipant("submitter", { role: "requester", contactId: "contact-a", userId: "user-a", rfiId: "source-legacy" })
    expect((await loadRfiVendorAssignments(database.db, { organizationId: "org-a", projectId: "project-a" })).get("rfi-legacy")?.contactId).toBe("contact-a")
    const contact = await resolveRfiVendorContact(database.db, "project-a", "contact-b")
    if (!contact) throw new Error("Missing contact")
    await rfiVendorAssignmentStatement(database.db, { organizationId: "org-a", projectId: "project-a", rfiId: "rfi-legacy", contact, now: NOW })
    expect(await read("contact-a2", "vendor-a", "user-a2")).toEqual([])
    expect(await read()).toEqual(["rfi-legacy"])
    expect(await read("contact-b", "vendor-b", "user-b")).toEqual(["rfi-legacy"])
    await rfiVendorAssignmentStatement(database.db, { organizationId: "org-a", projectId: "project-a", rfiId: "rfi-legacy", contact: null, now: NOW })
    expect(await read("contact-b", "vendor-b", "user-b")).toEqual([])
    expect(await read("contact-a2", "vendor-a", "user-a2")).toEqual([])
    expect(await read()).toEqual(["rfi-legacy"])
    expect((await loadRfiVendorAssignments(database.db, { organizationId: "org-a", projectId: "project-a" })).size).toBe(0)
  })

  it("assigns, reassigns, and clears one company per RFI", async () => {
    const contactA = await resolveRfiVendorContact(database.db, "project-a", "contact-a")
    const contactB = await resolveRfiVendorContact(database.db, "project-a", "contact-b")
    if (!contactA || !contactB) throw new Error("fixture contacts missing")
    const assign = (contact: typeof contactA | null) => rfiVendorAssignmentStatement(database.db, { organizationId: "org-a", projectId: "project-a", rfiId: "rfi-1", contact, now: NOW })

    await assign(contactA)
    expect(await read("contact-a2", "vendor-a", "user-a2")).toEqual(["rfi-1"])
    expect((await loadRfiVendorAssignments(database.db, { organizationId: "org-a", projectId: "project-a" })).get("rfi-1"))
      .toEqual({ contactId: "contact-a", label: "Acme Supply · Avery", contactActive: true })

    await assign(contactB)
    expect(await read()).toEqual([])
    expect(await read("contact-b", "vendor-b", "user-b")).toEqual(["rfi-1"])
    expect(database.sqlite.prepare("SELECT count(*) AS n FROM project_source_record_participants WHERE source_record_id='rfi-1'").get()).toEqual({ n: 1 })

    await assign(null)
    expect(await read("contact-b", "vendor-b", "user-b")).toEqual([])
    expect((await loadRfiVendorAssignments(database.db, { organizationId: "org-a", projectId: "project-a" })).size).toBe(0)
  })
})

describe("D1-safe id filtering", () => {
  it("binds any number of ids as a single parameter", async () => {
    database.sqlite.exec("CREATE TABLE IF NOT EXISTS project_rfis (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, source_record_id TEXT)")
    const ids = Array.from({ length: 250 }, (_, index) => `rfi-${index}`)
    const insert = database.sqlite.prepare("INSERT INTO project_rfis (id,project_id) VALUES (?, 'project-a')")
    for (const id of ids) insert.run(id)
    const query = database.db.select({ id: projectRfis.id }).from(projectRfis)
      .where(and(eq(projectRfis.projectId, "project-a"), inJsonList(projectRfis.id, ids.slice(0, 200))))
    expect(query.toSQL().params.length).toBeLessThan(5)
    expect((await query).length).toBe(200)
  })
})
