import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { openCorrespondenceTestDatabase, type CorrespondenceTestDatabase } from "../../../__tests__/helpers/correspondence-core"
import { vendorVisibleRfiSourceIds } from "@/lib/rfis/vendor-visibility"

let database: CorrespondenceTestDatabase
beforeEach(() => {
  database = openCorrespondenceTestDatabase()
  database.sqlite.exec("ALTER TABLE project_contacts ADD COLUMN vendor_id TEXT")
  database.sqlite.exec(readFileSync("drizzle/0140_project_source_record_participants.sql", "utf8"))
  database.sqlite.exec("INSERT INTO project_contacts (id,project_id,vendor_id,active,contact_type,display_name) VALUES ('contact-a','project-a','vendor-a',1,'supplier','A'),('contact-a2','project-a','vendor-a',1,'supplier','A2'),('contact-b','project-a','vendor-b',1,'supplier','B'),('inactive','project-a','vendor-a',0,'supplier','I')")
  const insert = database.sqlite.prepare(`INSERT INTO project_source_record_participants
    (id,organization_id,project_id,source_record_type,source_record_id,source_participant_id,participant_role,capabilities_json,project_contact_id,identity_status,membership_status,review_status,active,created_at,updated_at)
    VALUES (?,'org-a','project-a','rfi',?,?,'recipient','["rfi.view"]',?,'matched','active','reviewed',1,'2026-10-24','2026-10-24')`)
  for (const [id, contact] of [['own','contact-a'],['coworker','contact-a2'],['other','contact-b'],['inactive-contact','inactive'],['unreviewed','contact-a']]) insert.run(id,id,id,contact)
  database.sqlite.exec("UPDATE project_source_record_participants SET review_status='unreviewed' WHERE id='unreviewed'")
})
afterEach(() => database.close())
function read(contactId = "contact-a", vendorId: string | null = "vendor-a"): Promise<readonly string[]> {
  return vendorVisibleRfiSourceIds({ db: database.db, projectId: "project-a", organizationId: "org-a", viewerId: "owner-a", contact: { id: contactId, vendorId, displayName: "Company person", companyName: "Same display name", email: "person@example.test", contactType: "subcontractor" } })
}
describe("company-scoped vendor RFIs", () => {
  it("shows own-company records including a verified coworker's involvement", async () => {
    expect((await read()).sort()).toEqual(["coworker", "own"])
    expect(await read("contact-b", "vendor-b")).toEqual(["other"])
  })
  it("does not infer a company from a display name or unresolved vendor ID", async () => {
    expect(await read("contact-a", null)).toEqual(["own"])
    expect(await vendorVisibleRfiSourceIds({ db: database.db, projectId: "project-a", organizationId: "org-a", viewerId: "owner-a", contact: null })).toEqual([])
  })
  it("revocation and capability removal take effect on the next request", async () => {
    database.sqlite.exec("UPDATE project_source_record_participants SET capabilities_json='[]' WHERE id='own'")
    database.sqlite.exec("UPDATE project_source_record_participants SET active=0 WHERE id='coworker'")
    expect(await read()).toEqual([])
  })
  it("does not cross project or organization boundaries", async () => {
    expect(await vendorVisibleRfiSourceIds({ db: database.db, projectId: "project-b", organizationId: "org-a", viewerId: "owner-a", contact: { id: "contact-a", vendorId: "vendor-a", displayName: "Person", companyName: null, email: null, contactType: "supplier" } })).toEqual([])
  })
})
