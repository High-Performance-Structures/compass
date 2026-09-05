import { afterEach, describe, expect, it, vi } from "vitest"
import { readFileSync } from "node:fs"
import { openCorrespondenceTestDatabase, type CorrespondenceTestDatabase } from "./helpers/correspondence-core"
import { routeProjectInboundEmail, routeProjectInboundSms } from "@/lib/email/project-inbound-routing"
import { routeInboundProjectMessage } from "@/lib/email/project-message-routing"
import type { InboundCandidate } from "@/lib/email/gmail-message-parser"

vi.mock("server-only", () => ({}))
vi.mock("@/lib/activity-log", () => ({ recordActivityEvent: vi.fn() }))
vi.mock("@/lib/correspondence/access", () => ({ isCorrespondenceEnabled: (_id: string, env: unknown) => typeof env === "object" && env !== null && "COMPASS_CORRESPONDENCE_ENABLED" in env && env.COMPASS_CORRESPONDENCE_ENABLED === "true" }))

let database: CorrespondenceTestDatabase | undefined
function setup(): CorrespondenceTestDatabase {
  const db = openCorrespondenceTestDatabase()
  database = db
  db.sqlite.exec("ALTER TABLE users ADD COLUMN google_email TEXT")
  db.sqlite.exec(readFileSync("drizzle/0041_notifications.sql", "utf8").replaceAll("--> statement-breakpoint", ""))
  db.sqlite.exec("ALTER TABLE notification_recipients ADD COLUMN sms INTEGER NOT NULL DEFAULT 0; ALTER TABLE notification_preferences ADD COLUMN sms_phone_number TEXT; ALTER TABLE notification_preferences ADD COLUMN sms_consent_accepted INTEGER NOT NULL DEFAULT 0")
  return db
}
afterEach(() => database?.close())
function candidate(patch: Partial<InboundCandidate> = {}): InboundCandidate {
  return { gmailMessageId: "email-1", gmailThreadId: null, messageIdHeader: null, inReplyToHeader: null, referencesHeader: null, token: null, fromAddress: "owner@example.test", fromName: "Project Owner", toAddress: "jarvis+project-project-a@hps-colorado.com", subject: '[MESSAGE] @"Staff A" Please check', textBody: "Please check the finish.", htmlBody: null, snippet: null, receivedAt: "2026-09-05T18:00:00.000Z", attachments: [], ...patch }
}
function input(db: CorrespondenceTestDatabase) {
  return { db: db.db, env: { COMPASS_CORRESPONDENCE_ENABLED: "true" }, organizationId: "org-a", projectId: "project-a", candidate: candidate(), body: "Please check the finish.", now: "2026-09-05T19:00:00.000Z" }
}
describe("[MESSAGE] intake", () => {
  it("uses the shared authenticated sender route for email and holds unknown senders", async () => {
    const db = setup()
    db.sqlite.exec("UPDATE projects SET id='proj-project-a' WHERE id='project-b'")
    const known = candidate({ toAddress: "jarvis+project-proj-project-a@hps-colorado.com", fromAddress: "staff-a@example.test" })
    const result = await routeProjectInboundEmail({ ...input(db), candidate: known })
    expect(result.kind).toBe("routed")
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM correspondence_messages").get()).toEqual({ count: 1 })
    expect(await routeProjectInboundEmail({ ...input(db), candidate: { ...known, gmailMessageId: "unknown-2", fromAddress: "unknown@example.test" } })).toEqual({ kind: "needs_review", projectId: "proj-project-a" })
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM correspondence_messages").get()).toEqual({ count: 1 })
  })
  it("routes verified SMS through the shared tag parser and rejects unknown numbers", async () => {
    const db = setup()
    db.sqlite.exec("INSERT INTO notification_preferences(user_id,sms_phone_number,sms_consent_accepted,updated_at) VALUES ('staff-a','+13035550123',1,'2026-09-05')")
    expect((await routeProjectInboundSms({ ...input(db), senderPhone: "+13035550123" })).kind).toBe("routed")
    expect(await routeProjectInboundSms({ ...input(db), senderPhone: "+13035559999", candidate: candidate({ gmailMessageId: "sms-unknown" }) })).toEqual({ kind: "needs_review", projectId: "project-a" })
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM correspondence_messages").get()).toEqual({ count: 1 })
  })

  it.each(["email", "sms"] as const)("saves %s in Messages with a notification only for the internal mention", async (source) => {
    const db = setup()
    const result = await routeInboundProjectMessage({ ...input(db), source })
    expect(result?.status).toBe("routed_message")
    expect(db.sqlite.prepare("SELECT source,author_user_id,body FROM correspondence_messages").get()).toEqual({ source, author_user_id: null, body: "Please check the finish." })
    expect(db.sqlite.prepare("SELECT user_id,role FROM correspondence_participants").all()).toEqual([{ user_id: "staff-a", role: "staff" }])
    expect(db.sqlite.prepare("SELECT user_id,in_app FROM notification_recipients").all()).toEqual([{ user_id: "staff-a", in_app: 1 }])
    expect(db.sqlite.prepare("SELECT href FROM notification_events").get()).toEqual({ href: expect.stringContaining("/dashboard/projects/project-a/messages?conversationId=") })
    await routeInboundProjectMessage({ ...input(db), source })
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM notification_events").get()).toEqual({ count: 1 })
  })
  it("uses assigned staff when no one is mentioned", async () => {
    const db = setup()
    await routeInboundProjectMessage({ ...input(db), candidate: candidate({ subject: "[MESSAGE] Update" }), source: "email" })
    expect(db.sqlite.prepare("SELECT user_id FROM correspondence_participants ORDER BY user_id").all()).toEqual([{ user_id: "revoked-a" }, { user_id: "staff-a" }])
  })
  it.each(['@"Owner A"', '@"Staff B"', "@Staff", "@Nobody"])("holds unavailable/ambiguous mention %s without creating records", async (mention) => {
    const db = setup()
    if (mention === "@Staff") db.sqlite.exec("UPDATE users SET first_name='Staff' WHERE id='revoked-a'")
    expect(await routeInboundProjectMessage({ ...input(db), candidate: candidate({ subject: `[MESSAGE] ${mention}` }), source: "email" })).toBeNull()
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM correspondence_messages").get()).toEqual({ count: 0 })
  })
  it("holds inactive recipients and attachments without dropping content", async () => {
    const db = setup()
    db.sqlite.exec("UPDATE users SET is_active=0 WHERE id='staff-a'")
    expect(await routeInboundProjectMessage({ ...input(db), source: "sms" })).toBeNull()
    db.sqlite.exec("UPDATE users SET is_active=1 WHERE id='staff-a'")
    expect(await routeInboundProjectMessage({ ...input(db), candidate: candidate({ attachments: [{ attachmentId: "file-1", fileName: "photo.jpg", mimeType: "image/jpeg", size: 10, data: null }] }), source: "email" })).toBeNull()
  })
  it("respects notification preferences and messaging availability", async () => {
    const db = setup()
    db.sqlite.exec("INSERT INTO notification_preferences(user_id,in_app_enabled,updated_at) VALUES ('staff-a',0,'2026-09-05')")
    expect(await routeInboundProjectMessage({ ...input(db), env: {}, source: "email" })).toBeNull()
    await routeInboundProjectMessage({ ...input(db), source: "email" })
    expect(db.sqlite.prepare("SELECT in_app FROM notification_recipients").get()).toEqual({ in_app: 0 })
  })
  it("rolls back the message if notification persistence fails, then retries cleanly", async () => {
    const db = setup()
    db.failures.failNextMatching('insert into "notification_recipients"')
    await expect(routeInboundProjectMessage({ ...input(db), source: "email" })).rejects.toThrow()
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM correspondence_messages").get()).toEqual({ count: 0 })
    await routeInboundProjectMessage({ ...input(db), source: "email" })
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM notification_events").get()).toEqual({ count: 1 })
  })
  it("rechecks default project assignments inside the write batch", async () => {
    const db = setup()
    db.failures.setBeforeBatchHook((sqlite) => sqlite.exec("DELETE FROM project_members WHERE user_id='staff-a'"))
    await expect(routeInboundProjectMessage({ ...input(db), candidate: candidate({ subject: "[MESSAGE] Update" }), source: "email" })).rejects.toThrow()
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM correspondence_messages").get()).toEqual({ count: 0 })
  })
  it("rechecks internal access inside the write batch", async () => {
    const db = setup()
    db.failures.setBeforeBatchHook((sqlite) => sqlite.exec("UPDATE organization_members SET role='client' WHERE user_id='staff-a'"))
    await expect(routeInboundProjectMessage({ ...input(db), source: "email" })).rejects.toThrow()
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM correspondence_messages").get()).toEqual({ count: 0 })
  })
})
