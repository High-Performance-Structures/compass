import { readFileSync } from "node:fs"
import { getTableColumns, getTableName } from "drizzle-orm"
import type { SQLiteTable } from "drizzle-orm/sqlite-core"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { context, openCorrespondenceTestDatabase, type CorrespondenceTestDatabase } from "../../../../__tests__/helpers/correspondence-core"
import { customerContacts, customers, internalContacts, projectContacts, projects, users, vendorContacts, vendors } from "@/db/schema"
import { buildertrendAccessCandidates } from "@/db/schema-buildertrend"
import { listPriorBuildertrendProjects, sendProjectAccessInvitation } from "../project-access-invitations"
const mocks = vi.hoisted(() => ({ auth: vi.fn(), deliver: vi.fn(), workos: vi.fn(), conversation: vi.fn() }))
let database: CorrespondenceTestDatabase
vi.mock("server-only", () => ({}))
vi.mock("@/lib/auth", () => ({ requireAuth: mocks.auth, getCurrentUser: mocks.auth }))
vi.mock("@/lib/db", () => ({ getCloudflareContext: async () => ({ env: { DB: database.d1 } }) }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("@/lib/workos-invitations", () => ({ sendOrResendProjectWorkOSInvitation: mocks.workos }))
vi.mock("@/lib/project-audience-conversations", () => ({ ensureProjectAudienceConversation: mocks.conversation }))
vi.mock("@/lib/notifications/create-event", () => ({ createSystemNotificationEvent: vi.fn() }))
vi.mock("@/lib/email/invitation-delivery", async (original) => ({ ...await original<typeof import("@/lib/email/invitation-delivery")>(), deliverInvitationEmail: mocks.deliver }))

function completeColumns(table: SQLiteTable): void {
  const name = getTableName(table)
  database.sqlite.exec(`CREATE TABLE IF NOT EXISTS "${name}" (id TEXT PRIMARY KEY)`)
  const present = new Set(database.sqlite.prepare(`PRAGMA table_info("${name}")`).all().flatMap((row) =>
    typeof row === "object" && row !== null && "name" in row && typeof row.name === "string" ? [row.name] : []))
  for (const column of Object.values(getTableColumns(table))) {
    if (!present.has(column.name)) database.sqlite.exec(`ALTER TABLE "${name}" ADD COLUMN "${column.name}" ${column.getSQLType()}`)
  }
}
function access(id: string, projectId: string, contactId: string | null, status: string): string {
  return `INSERT INTO buildertrend_staging_access_candidates(id,organization_id,source_key,project_id,project_contact_id,buildertrend_job_id,buildertrend_contact_id,buildertrend_access_role,contact_name,email,proposed_contact_type,match_status,source_notes,created_at,updated_at) VALUES('${id}','org-a','key-${id}','${projectId}',${contactId ? `'${contactId}'` : "NULL"},'job-${id}','owner:77','owner','Owner','owner-a@example.test','owner','matched','{"status":"${status}"}','2026-11-07','2026-11-07');`
}
beforeEach(() => {
  vi.resetAllMocks()
  database = openCorrespondenceTestDatabase()
  for (const table of [projectContacts, projects, users, customers, customerContacts, vendors, vendorContacts, internalContacts, buildertrendAccessCandidates]) completeColumns(table)
  for (const file of ["0069_project_access_invitations.sql", "0074_activity_events.sql", "0261_invitation_email_recovery.sql"]) database.sqlite.exec(readFileSync(`drizzle/${file}`, "utf8"))
  database.sqlite.exec("INSERT INTO customers(id,organization_id,name,email) VALUES('customer','org-a','Customer','owner-a@example.test'); INSERT INTO customer_contacts(id,customer_id,user_id,name,email,active) VALUES('person','customer','owner-a','Owner','owner-a@example.test',1); INSERT INTO project_contacts(id,project_id,contact_type,source_entity_type,source_entity_id,customer_id,customer_contact_id,display_name,email,active,owner_portal_visible) VALUES('contact','project-a','owner','customer','customer','customer','person','Owner','owner-a@example.test',1,0)")
  // Same BT owner on project A (this contact), project B (no Compass contact yet) and another company's project.
  database.sqlite.exec(access("a", "project-a", "contact", "Open") + access("b", "project-b", null, "Closed") + access("x", "project-other", null, "Open"))
  mocks.auth.mockResolvedValue(context(database, "staff-a", "project-a").user)
  mocks.deliver.mockResolvedValue({ status: "sent", nextAttemptAt: null })
})
afterEach(() => database.close())
const input = { projectId: "project-a", contactId: "contact", subject: "Welcome", message: "Your projects are ready.", additionalProjectIds: ["project-b", "project-other"] } satisfies Parameters<typeof sendProjectAccessInvitation>[0]

describe("invite with the person's Buildertrend projects", () => {
  it("lists only this company's other projects the person had in Buildertrend", async () => {
    const result = await listPriorBuildertrendProjects({ projectId: "project-a", contactId: "contact" })
    expect(result).toEqual({ success: true, projects: [expect.objectContaining({ projectId: "project-b", group: "closed", locked: false, buildertrendStatus: "Closed" })] })
  })
  it("grants the ticked projects with the one invitation and adds the contact where missing", async () => {
    const result = await sendProjectAccessInvitation(input)
    expect(result).toMatchObject({ success: true, accessStatus: "access_granted", additionalProjects: 1 })
    expect(database.sqlite.prepare("SELECT project_id, role FROM project_members WHERE user_id='owner-a' ORDER BY project_id").all()).toEqual([{ project_id: "project-a", role: "owner" }, { project_id: "project-b", role: "owner" }])
    expect(database.sqlite.prepare("SELECT customer_contact_id, owner_portal_visible FROM project_contacts WHERE project_id='project-b'").all()).toEqual([{ customer_contact_id: "person", owner_portal_visible: 1 }])
    expect(database.sqlite.prepare("SELECT status, email_status FROM project_access_invitations WHERE project_id='project-b'").all()).toEqual([{ status: "accepted", email_status: "included" }])
    expect(database.sqlite.prepare("SELECT count(*) AS n FROM project_access_invitations WHERE project_id='project-other'").get()).toEqual({ n: 0 })
    expect(mocks.deliver).toHaveBeenCalledTimes(1)
  })
  it("never grants a staff-only project", async () => {
    database.sqlite.exec("UPDATE projects SET imported_conversations_staff_only=1 WHERE id='project-b'")
    const listed = await listPriorBuildertrendProjects({ projectId: "project-a", contactId: "contact" })
    expect(listed).toMatchObject({ success: true, projects: [{ projectId: "project-b", locked: true }] })
    expect(await sendProjectAccessInvitation(input)).not.toHaveProperty("additionalProjects")
    expect(database.sqlite.prepare("SELECT count(*) AS n FROM project_members WHERE user_id='owner-a' AND project_id='project-b'").get()).toEqual({ n: 0 })
  })
})
