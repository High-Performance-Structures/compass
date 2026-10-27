import { readFileSync } from "node:fs"
import { getTableColumns, getTableName } from "drizzle-orm"
import type { SQLiteTable } from "drizzle-orm/sqlite-core"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { context, openCorrespondenceTestDatabase, type CorrespondenceTestDatabase } from "../../../../__tests__/helpers/correspondence-core"
import { customerContacts, customers, internalContacts, projectContacts, users, vendorContacts, vendors } from "@/db/schema"
import { sendProjectAccessInvitation } from "../project-access-invitations"
const mocks = vi.hoisted(() => ({ auth: vi.fn(), deliver: vi.fn(), workos: vi.fn(), conversation: vi.fn() }))
let database: CorrespondenceTestDatabase
vi.mock("server-only", () => ({}))
vi.mock("@/lib/auth", () => ({ requireAuth: mocks.auth }))
vi.mock("@/lib/db", () => ({ getCloudflareContext: async () => ({ env: { DB: database.d1 } }) }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("@/lib/workos-invitations", () => ({ sendOrResendProjectWorkOSInvitation: mocks.workos }))
vi.mock("@/lib/project-audience-conversations", () => ({ ensureProjectAudienceConversation: mocks.conversation }))
vi.mock("@/lib/notifications/create-event", () => ({ createSystemNotificationEvent: vi.fn() }))
vi.mock("@/lib/email/invitation-delivery", async (original) => ({ ...await original<typeof import("@/lib/email/invitation-delivery")>(), deliverInvitationEmail: mocks.deliver }))

// The shared fixture has a deliberately small schema. Add the real selected
// columns here so this test exercises the server action against SQLite/D1.
function completeColumns(table: SQLiteTable): void {
  const name = getTableName(table)
  database.sqlite.exec(`CREATE TABLE IF NOT EXISTS "${name}" (id TEXT PRIMARY KEY)`)
  const present = new Set(database.sqlite.prepare(`PRAGMA table_info("${name}")`).all().flatMap((row) =>
    typeof row === "object" && row !== null && "name" in row && typeof row.name === "string" ? [row.name] : []))
  for (const column of Object.values(getTableColumns(table))) {
    if (!present.has(column.name)) database.sqlite.exec(`ALTER TABLE "${name}" ADD COLUMN "${column.name}" ${column.getSQLType()}`)
  }
}
beforeEach(() => {
  vi.resetAllMocks()
  database = openCorrespondenceTestDatabase()
  for (const table of [projectContacts, users, customers, customerContacts, vendors, vendorContacts, internalContacts]) completeColumns(table)
  for (const file of ["0069_project_access_invitations.sql", "0074_activity_events.sql", "0261_invitation_email_recovery.sql"]) database.sqlite.exec(readFileSync(`drizzle/${file}`, "utf8"))
  database.sqlite.exec("INSERT INTO customers(id,organization_id,name,email) VALUES('customer','org-a','Customer','owner-a@example.test'); INSERT INTO customer_contacts(id,customer_id,user_id,name,email,active) VALUES('person','customer','owner-a','Owner','owner-a@example.test',1); INSERT INTO project_contacts(id,project_id,contact_type,source_entity_type,source_entity_id,customer_id,customer_contact_id,display_name,email,active) VALUES('contact','project-a','owner','customer','customer','customer','person','Owner','owner-a@example.test',1)")
  mocks.auth.mockResolvedValue(context(database, "staff-a", "project-a").user)
  mocks.deliver.mockResolvedValue({ status: "sent", nextAttemptAt: null })
})
afterEach(() => database.close())
const input = { projectId: "project-a", contactId: "contact", subject: "Welcome again", message: "Here is your existing project workspace.", intent: "resend_welcome" } satisfies Parameters<typeof sendProjectAccessInvitation>[0]

describe("welcome-only project invitation recovery", () => {
  it("saves a replacement welcome while preserving existing membership and visibility", async () => {
    const before = database.sqlite.prepare("SELECT * FROM project_members ORDER BY id").all()
    const result = await sendProjectAccessInvitation(input)
    expect(result).toEqual({ success: true, accessStatus: "access_granted", warning: null })
    expect(database.sqlite.prepare("SELECT * FROM project_members ORDER BY id").all()).toEqual(before)
    expect(database.sqlite.prepare("SELECT owner_portal_visible FROM project_contacts WHERE id='contact'").get()).toEqual({ owner_portal_visible: 0 })
    expect(database.sqlite.prepare("SELECT status,role,email_subject,email_message FROM project_access_invitations").get()).toEqual({ status: "accepted", role: "owner", email_subject: input.subject, email_message: input.message })
    expect(mocks.workos).not.toHaveBeenCalled()
    expect(mocks.conversation).not.toHaveBeenCalled()
  })
  it("does not rewrite a stale identity snapshot to make welcome-only contact binding pass", async () => {
    database.sqlite.exec("UPDATE project_contacts SET email='old-owner@example.test' WHERE id='contact'")
    expect(await sendProjectAccessInvitation(input)).toMatchObject({ success: false, error: expect.stringContaining("current project contact") })
    expect(database.sqlite.prepare("SELECT email FROM project_contacts WHERE id='contact'").get()).toEqual({ email: "old-owner@example.test" })
    expect(database.sqlite.prepare("SELECT count(*) AS n FROM project_access_invitations").get()).toEqual({ n: 0 })
    expect(mocks.deliver).not.toHaveBeenCalled()
  })
  it("cannot switch the account's private contact scope by welcoming another contact with the same email", async () => {
    database.sqlite.exec("INSERT INTO project_access_invitations(id,organization_id,project_id,project_contact_id,email,role,status,invited_by,invited_at,accepted_by,accepted_at,created_at,updated_at) VALUES('accepted','org-a','project-a','contact','owner-a@example.test','owner','accepted','staff-a','2026-10-25','owner-a','2026-10-25','2026-10-25','2026-10-25'); INSERT INTO project_contacts(id,project_id,contact_type,source_entity_type,source_entity_id,customer_id,customer_contact_id,display_name,email,active) VALUES('other-contact','project-a','owner','customer','customer','customer','person','Other scope','owner-a@example.test',1)")
    expect(await sendProjectAccessInvitation({ ...input, contactId: "other-contact" })).toMatchObject({ success: false, error: expect.stringContaining("current project contact") })
    expect(database.sqlite.prepare("SELECT project_contact_id FROM project_access_invitations WHERE status='accepted' ORDER BY accepted_at DESC").all()).toEqual([{ project_contact_id: "contact" }])
    expect(mocks.deliver).not.toHaveBeenCalled()
    expect(mocks.workos).not.toHaveBeenCalled()
  })
  it("cannot use welcome-only recovery to grant missing project access", async () => {
    database.sqlite.exec("DELETE FROM project_members WHERE user_id='owner-a'")
    expect(await sendProjectAccessInvitation(input)).toMatchObject({ success: false, error: expect.stringContaining("existing project access") })
    expect(database.sqlite.prepare("SELECT count(*) AS n FROM project_access_invitations").get()).toEqual({ n: 0 })
    expect(mocks.deliver).not.toHaveBeenCalled()
    expect(mocks.workos).not.toHaveBeenCalled()
  })
})
