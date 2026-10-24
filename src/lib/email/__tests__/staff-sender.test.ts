import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { readFileSync } from "node:fs"
import { openCorrespondenceTestDatabase, type CorrespondenceTestDatabase } from "../../../../__tests__/helpers/correspondence-core"
import { resolveStaffEmailSender } from "../staff-sender"
import { sendTrackedEmail } from "../tracked-send"
import { DEFAULT_DEPARTMENT_PROFILES } from "@/lib/department-profiles"

const mocks = vi.hoisted(() => ({ send: vi.fn(), user: vi.fn(), session: vi.fn() }))
vi.mock("server-only", () => ({}))
vi.mock("@workos-inc/authkit-nextjs", () => ({ getWorkOS: () => ({ userManagement: { getUser: mocks.user } }), withAuth: mocks.session }))
vi.mock("@/lib/email/compass-email", async (original) => ({ ...await original<typeof import("../compass-email")>(), sendCompassEmail: mocks.send }))

let database: CorrespondenceTestDatabase | undefined
function setup(): CorrespondenceTestDatabase {
  const db = openCorrespondenceTestDatabase()
  database = db
  db.sqlite.exec("ALTER TABLE users ADD COLUMN google_email TEXT; CREATE TABLE google_auth (organization_id TEXT,workspace_domain TEXT); INSERT INTO google_auth VALUES ('org-a','example.test')")
  db.sqlite.exec("CREATE TABLE organization_feature_settings (organization_id TEXT,feature_key TEXT,value TEXT)")
  db.sqlite.exec(readFileSync("drizzle/0053_email_reply_threads.sql", "utf8").replaceAll("--> statement-breakpoint", ""))
  return db
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.send.mockResolvedValue({ status: "sent", provider: "gmail", providerMessageId: "sent", error: null })
  mocks.user.mockResolvedValue({ email: "staff-a@example.test", emailVerified: true })
  mocks.session.mockResolvedValue({ user: { id: "workos-staff-a" } })
})
afterEach(() => database?.close())

describe("organization-scoped staff sender", () => {
  it("prefers the persisted Workspace primary address over a Google override", async () => {
    const db = setup()
    db.sqlite.exec("UPDATE users SET email=' Staff-A@Example.Test ', google_email='another@example.test' WHERE id='staff-a'")
    expect(await resolveStaffEmailSender({ db: db.db, env: {}, organizationId: "org-a", userId: "staff-a" })).toEqual({ success: true, delivery: "gmail", sender: { address: "staff-a@example.test", name: "Staff A" } })
    expect(mocks.user).toHaveBeenCalledWith("workos-staff-a")
  })

  it("uses the administrator-managed mapping when the login is outside Workspace", async () => {
    const db = setup()
    db.sqlite.exec("UPDATE users SET email='personal@gmail.com', google_email='staff-a@example.test' WHERE id='staff-a'")
    expect(await resolveStaffEmailSender({ db: db.db, env: {}, organizationId: "org-a", userId: "staff-a" })).toEqual({ success: true, delivery: "gmail", sender: { address: "staff-a@example.test", name: "Staff A" } })
  })

  it.each(["personal@gmail.com", "staff@example.test.attacker.com", "broken@@example.test"])("uses the shared mailbox for staff without a Workspace address: %s", async (email) => {
    const db = setup()
    db.sqlite.prepare("UPDATE users SET email=?, google_email='outside@other.test' WHERE id='staff-a'").run(email)
    expect(await resolveStaffEmailSender({ db: db.db, env: { COMPASS_REPLY_MAILBOX: "jarvis@example.test" }, organizationId: "org-a", userId: "staff-a" })).toEqual({ success: true, delivery: "gmail", sender: { address: "jarvis@example.test", name: "Staff A via Compass" } })
  })

  it.each(["inactive", "external", "other organization"])("refuses an %s account instead of granting the shared sender", async (kind) => {
    const db = setup()
    if (kind === "inactive") db.sqlite.exec("UPDATE users SET is_active=0 WHERE id='staff-a'")
    if (kind === "external") db.sqlite.exec("UPDATE organization_members SET role='client' WHERE user_id='staff-a'")
    const result = await resolveStaffEmailSender({ db: db.db, env: {}, organizationId: "org-a", userId: kind === "other organization" ? "staff-b" : "staff-a" })
    expect(result.success).toBe(false)
  })

  it("does not use another organization's Workspace connection", async () => {
    const db = setup()
    db.sqlite.exec("UPDATE google_auth SET organization_id='org-b'")
    expect(await resolveStaffEmailSender({ db: db.db, env: {}, organizationId: "org-a", userId: "staff-a" })).toMatchObject({ success: true, delivery: "system" })
    expect(mocks.user).not.toHaveBeenCalled()
  })

  it.each(["unverified", "changed since session", "provider unavailable"])("refuses an %s primary identity", async (kind) => {
    const db = setup()
    if (kind === "unverified") mocks.user.mockResolvedValue({ email: "staff-a@example.test", emailVerified: false })
    if (kind === "changed since session") mocks.user.mockResolvedValue({ email: "old@example.test", emailVerified: true })
    if (kind === "provider unavailable") mocks.user.mockRejectedValue(new Error("unavailable"))
    expect(await resolveStaffEmailSender({ db: db.db, env: {}, organizationId: "org-a", userId: "staff-a" })).toMatchObject({ success: false })
  })

  it("refuses another user's assigned mailbox", async () => {
    const db = setup()
    db.sqlite.exec("UPDATE users SET google_email='staff-a@example.test' WHERE id='staff-b'")
    expect(await resolveStaffEmailSender({ db: db.db, env: {}, organizationId: "org-a", userId: "staff-a" })).toMatchObject({ success: false, error: expect.stringContaining("another account") })
  })

  it("reserves department mailboxes for deliberate department sends", async () => {
    const db = setup()
    const value = JSON.stringify({ departments: { ...DEFAULT_DEPARTMENT_PROFILES, N: { ...DEFAULT_DEPARTMENT_PROFILES.N, senderAddress: "staff-a@example.test" } } })
    db.sqlite.prepare("INSERT INTO organization_feature_settings VALUES ('org-a','department-profiles',?)").run(value)
    expect(await resolveStaffEmailSender({ db: db.db, env: {}, organizationId: "org-a", userId: "staff-a" })).toMatchObject({ success: false, error: expect.stringContaining("department") })
  })
})

describe("tracked record delivery", () => {
  const input = { env: {}, organizationId: "org-a", projectId: "project-a", kind: "rfi", recordId: "rfi-1", recordLabel: "RFI-001", createdBy: "staff-a", to: ["owner@outside.test"], subject: "RFI-001", text: "Please review", replyName: "Staff A - RFI-001", alsoReplyTo: ["personal@gmail.com"] }

  it("sends as staff while retaining the record token and direct reply recipients", async () => {
    const db = setup()
    expect(await sendTrackedEmail({ ...input, kind: "rfi", db: db.db })).toMatchObject({ status: "sent" })
    expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({
      sender: { address: "staff-a@example.test", name: "Staff A" },
      replyTo: expect.stringMatching(/^"Staff A - RFI-001" <jarvis\+cmp-[a-z0-9]{18}@hps-colorado\.com>, staff-a@example.test, personal@gmail.com$/),
      text: expect.stringContaining("Compass reply token: cmp-"),
    }))
    expect(db.sqlite.prepare("SELECT source_id,created_by FROM email_reply_threads").get()).toEqual({ source_id: "rfi-1", created_by: "staff-a" })
  })

  it("preserves a deliberate department sender", async () => {
    const db = setup()
    const sender = { address: "orders@example.test", name: "Orders" }
    await sendTrackedEmail({ ...input, kind: "purchase_order", db: db.db, sender })
    expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({ sender, replyTo: expect.stringContaining(", orders@example.test") }))
  })

  it("does not append the bare tracked mailbox alongside its token address", async () => {
    const db = setup()
    db.sqlite.exec("UPDATE google_auth SET workspace_domain='hps-colorado.com'")
    await sendTrackedEmail({ ...input, kind: "rfi", db: db.db, alsoReplyTo: ["jarvis@hps-colorado.com"] })
    expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({ sender: { address: "jarvis@hps-colorado.com", name: "Staff A via Compass" }, replyTo: expect.stringMatching(/^"Staff A - RFI-001" <jarvis\+cmp-[a-z0-9]{18}@hps-colorado\.com>$/) }))
  })

  it("keeps the configured system-provider route when Google is not connected", async () => {
    const db = setup()
    db.sqlite.exec("DELETE FROM google_auth")
    await sendTrackedEmail({ ...input, kind: "rfi", db: db.db, alsoReplyTo: ["compass@hps-colorado.com", "personal@gmail.com"] })
    expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({ sender: undefined, fromName: "Staff A via Compass", replyTo: expect.stringMatching(/^"Staff A - RFI-001" <jarvis\+cmp-[a-z0-9]{18}@hps-colorado\.com>, personal@gmail.com$/) }))
  })

  it("blocks an unauthorized actor before creating a reply thread or sending", async () => {
    const db = setup()
    expect(await sendTrackedEmail({ ...input, kind: "rfi", db: db.db, createdBy: "staff-b" })).toMatchObject({ status: "failed" })
    expect(mocks.send).not.toHaveBeenCalled()
    expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM email_reply_threads").get()).toEqual({ n: 0 })
  })
})
