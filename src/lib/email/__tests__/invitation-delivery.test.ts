import { readFileSync } from "node:fs"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { openCorrespondenceTestDatabase, type CorrespondenceTestDatabase } from "../../../../__tests__/helpers/correspondence-core"
import { cancelObsoleteInvitationEmails, deliverInvitationEmail, retryInvitationEmails } from "../invitation-delivery"
import { deferMailbox } from "../mailbox-state"

const mocks = vi.hoisted(() => ({ send: vi.fn(), invitation: vi.fn(), notify: vi.fn() }))
vi.mock("server-only", () => ({}))
vi.mock("@/lib/email/compass-email", () => ({ getCompassGmailSender: () => "robot@example.test", getCompassSystemSender: () => ({ address: "robot@example.test", name: null }), sendCompassEmail: mocks.send }))
vi.mock("@workos-inc/node", () => ({ WorkOS: class { userManagement = { getInvitation: mocks.invitation } } }))
vi.mock("@/lib/notifications/create-event", () => ({ createSystemNotificationEvent: mocks.notify }))
let db: CorrespondenceTestDatabase
const now = "2026-10-27T00:00:00.000Z"
const env = { WORKOS_API_KEY: "test", COMPASS_PUBLIC_BASE_URL: "https://compass.example.test" }
function seed(id = "invite", contact = "contact"): void {
  db.sqlite.prepare("INSERT OR IGNORE INTO project_contacts(id,project_id,contact_type,display_name,email) VALUES (?,'project-a','owner','Owner','owner-a@example.test')").run(contact)
  db.sqlite.prepare(`INSERT INTO project_access_invitations(id,organization_id,project_id,project_contact_id,email,role,status,workos_invitation_id,workos_expires_at,invited_by,invited_at,created_at,updated_at,email_status,email_subject,email_message,email_next_attempt_at)
    VALUES (?,'org-a','project-a',?,'owner-a@example.test','owner','sent','workos-invite','2026-11-10T00:00:00.000Z','staff-a',?, ?,?,'queued','Welcome to Compass','Your project welcome',?)`).run(id,contact,now,now,now,now)
}
function state(id = "invite"): unknown { return db.sqlite.prepare("SELECT status,email_status,email_attempts,email_next_attempt_at,email_error FROM project_access_invitations WHERE id=?").get(id) }
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(now); vi.resetAllMocks()
  db = openCorrespondenceTestDatabase()
  db.sqlite.exec("ALTER TABLE project_contacts ADD COLUMN customer_id TEXT; ALTER TABLE project_contacts ADD COLUMN customer_contact_id TEXT; ALTER TABLE project_contacts ADD COLUMN vendor_id TEXT; ALTER TABLE project_contacts ADD COLUMN vendor_contact_id TEXT")
  for (const file of ["0069_project_access_invitations.sql", "0074_activity_events.sql", "0261_invitation_email_recovery.sql"]) db.sqlite.exec(readFileSync(`drizzle/${file}`,"utf8"))
  mocks.send.mockResolvedValue({ status: "sent", provider: "gmail", providerMessageId: "message", error: null })
  mocks.invitation.mockResolvedValue({ email: "owner-a@example.test", state: "pending", expiresAt: "2026-11-10T00:00:00.000Z", acceptInvitationUrl: "https://auth.example.test/secure-invite" })
  mocks.notify.mockResolvedValue(undefined)
  seed()
})
afterEach(() => { db.close(); vi.useRealTimers() })

describe("durable invitation welcome delivery", () => {
  it("sends the saved message and existing acceptance URL once, then records Activity", async () => {
    expect(await deliverInvitationEmail({ db: db.db, env, invitationId: "invite" })).toEqual({ status: "sent", nextAttemptAt: null })
    await deliverInvitationEmail({ db: db.db, env, invitationId: "invite" })
    expect(mocks.send).toHaveBeenCalledTimes(1)
    expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({ subject: "Welcome to Compass", text: expect.stringContaining("secure-invite") }))
    expect(state()).toMatchObject({ email_status: "sent", email_attempts: 1 })
    expect(db.sqlite.prepare("SELECT action FROM activity_events").get()).toEqual({ action: "project.welcome_email_sent" })
  })
  it("honors Google's retry time across cron runs without sending another account invitation", async () => {
    mocks.send.mockResolvedValueOnce({ status: "rate_limited", provider: "gmail", providerMessageId: null, error: "Retry after 2026-10-27T00:15:37.014Z" })
    const result = await deliverInvitationEmail({ db: db.db, env, invitationId: "invite" })
    expect(result).toEqual({ status: "retrying", nextAttemptAt: "2026-10-27T00:15:42.014Z" })
    await retryInvitationEmails(db.db, env)
    expect(mocks.send).toHaveBeenCalledTimes(1)
    vi.setSystemTime("2026-10-27T00:16:00Z")
    await retryInvitationEmails(db.db, env)
    expect(mocks.send).toHaveBeenCalledTimes(2)
    expect(state()).toMatchObject({ email_status: "sent", email_attempts: 2 })
    expect(mocks.invitation).toHaveBeenCalledTimes(2)
  })
  it("keeps another invitation queued while the mailbox is cooling down", async () => {
    await deferMailbox(db.db, "robot@example.test", "2026-10-27T01:00:00.000Z")
    expect(await deliverInvitationEmail({ db: db.db, env, invitationId: "invite" })).toEqual({ status: "queued", nextAttemptAt: "2026-10-27T01:00:00.000Z" })
    expect(mocks.send).not.toHaveBeenCalled()
    expect(mocks.invitation).not.toHaveBeenCalled()
  })
  it("prevents concurrent callers from delivering the same invitation twice", async () => {
    await Promise.all([deliverInvitationEmail({ db: db.db, env, invitationId: "invite" }), deliverInvitationEmail({ db: db.db, env, invitationId: "invite" })])
    expect(mocks.send).toHaveBeenCalledTimes(1)
  })
  it("serializes different invitation sends sharing a mailbox", async () => {
    seed("invite-two", "contact-two")
    await Promise.all([deliverInvitationEmail({ db: db.db, env, invitationId: "invite" }), deliverInvitationEmail({ db: db.db, env, invitationId: "invite-two" })])
    expect(mocks.send).toHaveBeenCalledTimes(1)
  })
  it.each(["revoked", "expired"])("cancels a %s invitation without sending", async (status) => {
    db.sqlite.prepare("UPDATE project_access_invitations SET status=?").run(status)
    expect((await deliverInvitationEmail({ db: db.db, env, invitationId: "invite" })).status).toBe("cancelled")
    expect(mocks.send).not.toHaveBeenCalled()
  })
  it("releases an obsolete queue slot immediately while the provider cooldown is still active", async () => {
    db.sqlite.exec("UPDATE project_access_invitations SET status='revoked',email_status='retrying',email_next_attempt_at='2026-10-27T02:00:00Z'")
    await deferMailbox(db.db, "robot@example.test", "2026-10-27T02:00:00.000Z")
    await cancelObsoleteInvitationEmails(db.db, { projectId: "project-a", contactId: "contact", email: "corrected@example.test", role: "owner", now })
    expect(state()).toMatchObject({ status: "revoked", email_status: "cancelled", email_next_attempt_at: null })
    seed("replacement")
    expect(state("replacement")).toMatchObject({ email_status: "queued" })
  })
  it("releases a queued welcome immediately when its requested role changes", async () => {
    await cancelObsoleteInvitationEmails(db.db, { projectId: "project-a", contactId: "contact", email: "owner-a@example.test", role: "supplier", now })
    expect(state()).toMatchObject({ status: "revoked", email_status: "cancelled", email_next_attempt_at: null })
    seed("replacement")
    expect(state("replacement")).toMatchObject({ email_status: "queued" })
  })
  it("keeps accepted project access when an obsolete welcome is cancelled", async () => {
    db.sqlite.exec("UPDATE project_access_invitations SET status='accepted',accepted_by='owner-a'")
    await cancelObsoleteInvitationEmails(db.db, { projectId: "project-a", contactId: "contact", email: "owner-a@example.test", role: "supplier", now })
    expect(state()).toMatchObject({ status: "accepted", email_status: "cancelled" })
    expect(db.sqlite.prepare("SELECT role FROM project_members WHERE user_id='owner-a'").get()).toEqual({ role: "owner" })
  })
  it("does not dispatch if staff cancel while the WorkOS lookup is in progress", async () => {
    mocks.invitation.mockImplementation(async () => {
      db.sqlite.exec("UPDATE project_access_invitations SET status='revoked',email_status='cancelled',email_claim_token=NULL")
      return { email: "owner-a@example.test", state: "pending", expiresAt: "2026-11-10T00:00:00Z", acceptInvitationUrl: "https://auth.example.test/invite" }
    })
    expect((await deliverInvitationEmail({ db: db.db, env, invitationId: "invite" })).status).toBe("cancelled")
    expect(mocks.send).not.toHaveBeenCalled()
    expect(state()).toMatchObject({ email_status: "cancelled", email_attempts: 0 })
  })
  it("cancels when the project contact changes to a different external role", async () => {
    db.sqlite.exec("UPDATE project_contacts SET contact_type='supplier'")
    expect((await deliverInvitationEmail({ db: db.db, env, invitationId: "invite" })).status).toBe("cancelled")
    expect(mocks.send).not.toHaveBeenCalled()
  })
  it("cancels a saved welcome after the recipient email changes", async () => {
    db.sqlite.exec("UPDATE project_contacts SET email='corrected@example.test'")
    expect((await deliverInvitationEmail({ db: db.db, env, invitationId: "invite" })).status).toBe("cancelled")
    expect(mocks.send).not.toHaveBeenCalled()
    expect(state()).toMatchObject({ status: "revoked", email_status: "cancelled" })
    expect(db.sqlite.prepare("SELECT count(*) AS n FROM project_access_invitations WHERE status='sent'").get()).toEqual({ n: 0 })
  })
  it.each(["email", "active"])("rechecks a linked vendor person's changed %s before delivery", async (field) => {
    db.sqlite.exec("CREATE TABLE vendors(id TEXT,organization_id TEXT); CREATE TABLE vendor_contacts(id TEXT,vendor_id TEXT,email TEXT,user_id TEXT,active INTEGER); INSERT INTO vendors VALUES('vendor','org-a'); INSERT INTO vendor_contacts VALUES('person','vendor','owner-a@example.test',NULL,1); UPDATE project_contacts SET contact_type='supplier',vendor_id='vendor',vendor_contact_id='person'; UPDATE project_access_invitations SET role='supplier'")
    if (field === "email") db.sqlite.exec("UPDATE vendor_contacts SET email='new@example.test'")
    else db.sqlite.exec("UPDATE vendor_contacts SET active=0")
    expect((await deliverInvitationEmail({ db: db.db, env, invitationId: "invite" })).status).toBe("cancelled")
    expect(mocks.send).not.toHaveBeenCalled()
  })
  it("cancels delivery after its contact is removed", async () => {
    db.sqlite.exec("UPDATE project_contacts SET active=0")
    expect((await deliverInvitationEmail({ db: db.db, env, invitationId: "invite" })).status).toBe("cancelled")
    expect(mocks.send).not.toHaveBeenCalled()
  })
  it("cancels if the inviter no longer has project update permission", async () => {
    db.sqlite.exec("UPDATE organization_members SET role='field' WHERE user_id='staff-a'")
    expect((await deliverInvitationEmail({ db: db.db, env, invitationId: "invite" })).status).toBe("cancelled")
    expect(mocks.send).not.toHaveBeenCalled()
  })
  it("cancels if WorkOS revoked the invitation", async () => {
    mocks.invitation.mockResolvedValue({ email: "owner-a@example.test", state: "revoked", expiresAt: "2026-11-10T00:00:00Z" })
    expect((await deliverInvitationEmail({ db: db.db, env, invitationId: "invite" })).status).toBe("cancelled")
  })
  it("uses a sign-in link after acceptance instead of the old account invitation", async () => {
    mocks.invitation.mockResolvedValue({ email: "owner-a@example.test", state: "accepted", expiresAt: "2026-11-10T00:00:00Z" })
    await deliverInvitationEmail({ db: db.db, env, invitationId: "invite" })
    expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({ text: expect.stringContaining("https://compass.example.test/login?from=") }))
  })
  it("supports a welcome-only resend for a legacy client project role", async () => {
    db.sqlite.exec("UPDATE project_access_invitations SET status='accepted',role='client',accepted_by='owner-a'")
    expect((await deliverInvitationEmail({ db: db.db, env, invitationId: "invite" })).status).toBe("sent")
    expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({ text: expect.stringContaining("%2Fowner") }))
    expect(mocks.invitation).not.toHaveBeenCalled()
  })
  it("holds a lost send response for review and notifies the inviter without auto-resending", async () => {
    mocks.send.mockRejectedValue(new Error("socket closed after acceptance"))
    expect((await deliverInvitationEmail({ db: db.db, env, invitationId: "invite" })).status).toBe("unknown")
    vi.setSystemTime("2026-10-28T00:00:00Z")
    await retryInvitationEmails(db.db, env)
    expect(mocks.send).toHaveBeenCalledTimes(1)
    expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ delivery: { inApp: true, email: false, push: false } }))
  })
  it("marks an abandoned in-flight send unknown rather than requeuing it", async () => {
    db.sqlite.exec("UPDATE project_access_invitations SET email_status='sending',email_claimed_at='2026-10-26T23:50:00Z'")
    expect(await retryInvitationEmails(db.db, env)).toEqual({ processed: 0, needsReview: 1 })
    expect(state()).toMatchObject({ email_status: "unknown" })
    expect(mocks.send).not.toHaveBeenCalled()
    expect(mocks.notify).toHaveBeenCalledTimes(1)
  })
  it("stops repeated rate-limit failures and alerts staff", async () => {
    db.sqlite.exec("UPDATE project_access_invitations SET email_attempts=11")
    mocks.send.mockResolvedValue({ status: "rate_limited", provider: "gmail", providerMessageId: null, error: "Retry after 2026-10-27T01:00:00Z" })
    expect((await deliverInvitationEmail({ db: db.db, env, invitationId: "invite" })).status).toBe("failed")
    expect(mocks.notify).toHaveBeenCalledTimes(1)
  })
})
