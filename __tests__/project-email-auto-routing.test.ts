import { afterEach, describe, expect, it, vi } from "vitest"
import { readFileSync } from "node:fs"
import { openCorrespondenceTestDatabase, type CorrespondenceTestDatabase, addContactDirectorySchema, addFeatureSettingsSchema } from "./helpers/correspondence-core"
import { routeProjectInboundEmail } from "@/lib/email/project-email-intake"
import { postHeldEmailBacklog } from "@/lib/email/held-email-backlog"
import { FILES_NOT_SAVED_NOTE } from "@/lib/email/project-message-routing"
import { UNVERIFIED_SENDER_NOTE } from "@/lib/email/sender-verification"
import { isCompassMailboxSender } from "@/lib/email/reply-tracking"
import type { InboundCandidate } from "@/lib/email/gmail-message-parser"
import { recordActivityEvent } from "@/lib/activity-log"

vi.mock("server-only", () => ({}))
vi.mock("@/lib/activity-log", () => ({ recordActivityEvent: vi.fn(), recordActivityEvents: vi.fn() }))
vi.mock("@/lib/correspondence/access", () => ({ isCorrespondenceEnabled: (_id: string, env: unknown) => typeof env === "object" && env !== null && "COMPASS_CORRESPONDENCE_ENABLED" in env && env.COMPASS_CORRESPONDENCE_ENABLED === "true" }))
vi.mock("@/lib/email/compass-email", () => ({
  COMPASS_GMAIL_READONLY_SCOPE: "readonly",
  getCompassGmailAccessToken: async () => ({ success: false, error: "Google Workspace service account is not connected." }),
}))
vi.mock("@/lib/email/gmail-inbound", () => ({ fetchGmailJson: vi.fn(), hydrateCandidateAttachments: vi.fn() }))

const ENV = { COMPASS_CORRESPONDENCE_ENABLED: "true" }

let database: CorrespondenceTestDatabase | undefined
function setup(): CorrespondenceTestDatabase {
  const db = openCorrespondenceTestDatabase()
  database = db
  db.sqlite.exec("ALTER TABLE users ADD COLUMN google_email TEXT")
  db.sqlite.exec(readFileSync("drizzle/0041_notifications.sql", "utf8").replaceAll("--> statement-breakpoint", ""))
  db.sqlite.exec(readFileSync("drizzle/0048_notification_channels.sql", "utf8").replaceAll("--> statement-breakpoint", ""))
  db.sqlite.exec(readFileSync("drizzle/0049_sms_consent.sql", "utf8").replaceAll("--> statement-breakpoint", ""))
  addContactDirectorySchema(db.sqlite)
  addFeatureSettingsSchema(db.sqlite)
  // Job addresses carry "proj-" ids; give both jobs numbers long enough to match.
  db.sqlite.exec(`
    UPDATE projects SET id='proj-a', project_number='J-1001' WHERE id='project-a';
    UPDATE projects SET id='proj-b', project_number='J-2002' WHERE id='project-b';
    UPDATE project_members SET project_id='proj-a' WHERE project_id='project-a';
    CREATE TABLE IF NOT EXISTS inbound_emails (
      id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, project_id TEXT, reply_thread_id TEXT, token TEXT,
      gmail_message_id TEXT NOT NULL UNIQUE, gmail_thread_id TEXT, message_id_header TEXT, in_reply_to_header TEXT,
      references_header TEXT, from_address TEXT NOT NULL, from_name TEXT, to_address TEXT, subject TEXT NOT NULL,
      text_body TEXT, html_body TEXT, snippet TEXT, sender_authentication TEXT, matched_status TEXT NOT NULL DEFAULT 'needs_review',
      posted_message_id TEXT, received_at TEXT NOT NULL, imported_at TEXT NOT NULL
    );
  `)
  return db
}
afterEach(() => {
  database?.close()
  vi.mocked(recordActivityEvent).mockClear()
})

function candidate(patch: Partial<InboundCandidate> = {}): InboundCandidate {
  return { gmailMessageId: "email-1", gmailThreadId: null, messageIdHeader: null, inReplyToHeader: null, referencesHeader: null, token: null, fromAddress: "stranger@example.test", fromName: "Pat Stranger", toAddress: "jarvis+project-proj-a@example.test", subject: "Deck question", textBody: "Can someone check the deck boards?", htmlBody: null, snippet: null, receivedAt: "2026-09-05T18:00:00.000Z", attachments: [], ...patch }
}

function route(db: CorrespondenceTestDatabase, email: InboundCandidate, env: unknown = ENV): ReturnType<typeof routeProjectInboundEmail> {
  return routeProjectInboundEmail({ db: db.db, env, organizationId: "org-a", candidate: email, matchJobNumbers: true })
}

function count(db: CorrespondenceTestDatabase, table: string): unknown {
  return db.sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()
}

function participants(db: CorrespondenceTestDatabase): unknown {
  return db.sqlite.prepare("SELECT user_id FROM correspondence_participants ORDER BY user_id").all()
}

describe("job emails are held only when the job is unknown", () => {
  it("posts an unrecognized sender's email to a known job's staff", async () => {
    const db = setup()
    expect(await route(db, candidate())).toMatchObject({ kind: "routed", projectId: "proj-a", matchedStatus: "routed_message" })
    expect(participants(db)).toEqual([{ user_id: "revoked-a" }, { user_id: "staff-a" }])
    expect(recordActivityEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: "project_email.routed",
      metadata: expect.objectContaining({ senderAuthorized: false, destination: "message" }),
    }))
  })

  it("posts an unrecognized sender's tagged email to Messages, not the tagged record", async () => {
    const db = setup()
    expect(await route(db, candidate({ subject: "[TO-DO] Fix the deck" }))).toMatchObject({ kind: "routed", matchedStatus: "routed_message" })
  })

  it("finds the job from the one job number in an email to the main mailbox", async () => {
    const db = setup()
    const email = candidate({ toAddress: "jarvis@example.test", textBody: "Question about job J-1001: can someone check the deck?" })
    expect(await route(db, email)).toMatchObject({ kind: "routed", projectId: "proj-a" })
    expect(count(db, "correspondence_messages")).toEqual({ count: 1 })
  })

  it("ignores job numbers when a tracked reply thread will route the email", async () => {
    const db = setup()
    const email = candidate({ toAddress: "jarvis@example.test", textBody: "About J-1001" })
    expect(await routeProjectInboundEmail({ db: db.db, env: ENV, organizationId: "org-a", candidate: email, matchJobNumbers: false })).toEqual({ kind: "not_project_email" })
  })

  it("holds an email that names two jobs, or none", async () => {
    const db = setup()
    expect(await route(db, candidate({ toAddress: "jarvis@example.test", textBody: "Compare J-1001 with J-2002." }))).toEqual({ kind: "needs_review", projectId: null })
    expect(recordActivityEvent).toHaveBeenCalledWith(expect.objectContaining({ metadata: { heldReason: "several_jobs", jobCount: 2 } }))
    expect(await route(db, candidate({ gmailMessageId: "email-2", toAddress: "jarvis@example.test", textBody: "No job here." }))).toEqual({ kind: "not_project_email" })
    expect(count(db, "correspondence_messages")).toEqual({ count: 0 })
  })

  it("posts a recognized sender's unmatched @name to the job's assigned staff, and exact names still work", async () => {
    const db = setup()
    const known = { fromAddress: "owner-a@example.test", fromName: "Owner A" }
    expect(await route(db, candidate({ ...known, subject: '@"Nobody Here" deck question' }))).toMatchObject({ kind: "routed" })
    expect(participants(db)).toEqual([{ user_id: "revoked-a" }, { user_id: "staff-a" }])
    const db2 = setup()
    expect(await route(db2, candidate({ ...known, subject: '@"Staff A" deck question' }))).toMatchObject({ kind: "routed" })
    expect(participants(db2)).toEqual([{ user_id: "staff-a" }])
  })

  it("ignores an unrecognized sender's @names", async () => {
    const db = setup()
    // An exact name from a stranger picks no one: the job's assigned staff receive it.
    expect(await route(db, candidate({ subject: '@"Staff A" deck question' }))).toMatchObject({ kind: "routed" })
    expect(participants(db)).toEqual([{ user_id: "revoked-a" }, { user_id: "staff-a" }])
    // With no staff on the job, the held-email reviewers do.
    const db2 = setup()
    db2.sqlite.exec("UPDATE organization_members SET role='office' WHERE user_id='revoked-a'")
    expect(await route(db2, candidate({ toAddress: "jarvis+project-proj-b@example.test", subject: '@"Revoked A" deck question' }))).toMatchObject({ kind: "routed" })
    expect(participants(db2)).toEqual([{ user_id: "staff-a" }])
  })

  it("recognizes a staff member's other email address as that person", async () => {
    const db = setup()
    db.sqlite.exec("INSERT INTO user_alternate_emails (id, organization_id, user_id, email, created_at) VALUES ('alt-1', 'org-a', 'staff-a', 'staff.home@example.test', '2026-11-13T00:00:00.000Z')")
    const routedAs = (senderAuthorized: boolean) => expect.objectContaining({ action: "project_email.routed", metadata: expect.objectContaining({ senderAuthorized }) })
    expect(await route(db, candidate({ fromAddress: "Staff.Home@example.test" }))).toMatchObject({ kind: "routed" })
    expect(recordActivityEvent).toHaveBeenLastCalledWith(routedAs(true))
    // Moved out of staff, the address is a stranger's again.
    db.sqlite.exec("UPDATE organization_members SET role='client' WHERE user_id='staff-a'")
    expect(await route(db, candidate({ gmailMessageId: "email-2", fromAddress: "staff.home@example.test" }))).toMatchObject({ kind: "routed" })
    expect(recordActivityEvent).toHaveBeenLastCalledWith(routedAs(false))
  })

  it("ignores another address of a deactivated person, or one saved in another company", async () => {
    const db = setup()
    db.sqlite.exec(`
      INSERT INTO user_alternate_emails (id, organization_id, user_id, email, created_at) VALUES ('alt-1', 'org-a', 'staff-a', 'staff.home@example.test', '2026-11-13T00:00:00.000Z');
      INSERT INTO user_alternate_emails (id, organization_id, user_id, email, created_at) VALUES ('alt-2', 'org-b', 'staff-a', 'staff.other@example.test', '2026-11-13T00:00:00.000Z');
    `)
    const routedAs = (senderAuthorized: boolean) => expect.objectContaining({ action: "project_email.routed", metadata: expect.objectContaining({ senderAuthorized }) })
    expect(await route(db, candidate({ fromAddress: "staff.other@example.test" }))).toMatchObject({ kind: "routed" })
    expect(recordActivityEvent).toHaveBeenLastCalledWith(routedAs(false))
    db.sqlite.exec("UPDATE users SET is_active=0 WHERE id='staff-a'")
    expect(await route(db, candidate({ gmailMessageId: "email-2", fromAddress: "staff.home@example.test" }))).toMatchObject({ kind: "routed" })
    expect(recordActivityEvent).toHaveBeenLastCalledWith(routedAs(false))
  })

  it("records Gmail's sender verdict without changing anything until the company enforces it", async () => {
    const db = setup()
    const routedWith = (metadata: Record<string, unknown>) => expect.objectContaining({ action: "project_email.routed", metadata: expect.objectContaining(metadata) })
    const known = { fromAddress: "owner-a@example.test", fromName: "Owner A", senderAuthentication: "fail" as const }
    // Record only, the default: a known sender who failed is still trusted.
    expect(await route(db, candidate(known))).toMatchObject({ kind: "routed" })
    expect(recordActivityEvent).toHaveBeenLastCalledWith(routedWith({ senderAuthorized: true, senderRecognized: true, senderAuthentication: "fail", senderVerification: "record" }))
    // Enforced: the same email posts to Messages with a note, untrusted.
    db.sqlite.exec(`INSERT INTO organization_feature_settings (organization_id, feature_key, value, updated_at) VALUES ('org-a', 'email-sender-verification', '{"mode":"enforce"}', '2026-11-13T00:00:00.000Z')`)
    expect(await route(db, candidate({ ...known, gmailMessageId: "email-2", subject: "[TO-DO] Fix the deck" }))).toMatchObject({ kind: "routed", matchedStatus: "routed_message" })
    expect(recordActivityEvent).toHaveBeenLastCalledWith(routedWith({ senderAuthorized: false, senderRecognized: true, senderVerification: "enforce" }))
    expect(db.sqlite.prepare("SELECT body FROM correspondence_messages ORDER BY sequence DESC LIMIT 1").get()).toEqual({ body: `Can someone check the deck boards?\n\n${UNVERIFIED_SENDER_NOTE}` })
    // A verified known sender stays trusted; an email stored before the check counts as unverified.
    expect(await route(db, candidate({ ...known, gmailMessageId: "email-3", senderAuthentication: "pass" }))).toMatchObject({ kind: "routed" })
    expect(recordActivityEvent).toHaveBeenLastCalledWith(routedWith({ senderAuthorized: true, senderAuthentication: "pass" }))
    expect(await route(db, candidate({ ...known, gmailMessageId: "email-4", senderAuthentication: undefined }))).toMatchObject({ kind: "routed" })
    expect(recordActivityEvent).toHaveBeenLastCalledWith(routedWith({ senderAuthorized: false, senderAuthentication: "unknown" }))
  })

  it("never finds a job from numbers in Compass's own mail", async () => {
    const db = setup()
    const own = candidate({ fromAddress: "jarvis+cmp-123@example.test", toAddress: "client@example.test", textBody: "Update on J-1001." })
    expect(await routeProjectInboundEmail({ db: db.db, env: { ...ENV, COMPASS_REPLY_MAILBOX: "jarvis@example.test" }, organizationId: "org-a", candidate: own, matchJobNumbers: !isCompassMailboxSender({ COMPASS_REPLY_MAILBOX: "jarvis@example.test" }, own.fromAddress) }))
      .toEqual({ kind: "not_project_email" })
  })

  it("notifies the company's held-email reviewers when the job has no staff", async () => {
    const db = setup()
    // proj-b has no assigned staff; both active admins in the company review held email.
    expect(await route(db, candidate({ toAddress: "jarvis+project-proj-b@example.test" }))).toMatchObject({ kind: "routed", projectId: "proj-b" })
    expect(db.sqlite.prepare("SELECT user_id FROM notification_recipients ORDER BY user_id").all()).toEqual([{ user_id: "revoked-a" }, { user_id: "staff-a" }])
  })

  it("holds when there is no one at all to notify", async () => {
    const db = setup()
    db.sqlite.exec("UPDATE organization_members SET role='field_crew' WHERE organization_id='org-a' AND role='admin'")
    expect(await route(db, candidate({ toAddress: "jarvis+project-proj-b@example.test" }))).toEqual({ kind: "needs_review", projectId: "proj-b" })
    expect(recordActivityEvent).toHaveBeenCalledWith(expect.objectContaining({ metadata: expect.objectContaining({ heldReason: "no_recipients" }) }))
  })

  it("posts without files that can't be saved, with a note in the message", async () => {
    const db = setup()
    const email = candidate({ attachments: [{ attachmentId: "file-1", fileName: "photo.jpg", mimeType: "image/jpeg", size: 10, data: null }] })
    expect(await route(db, email)).toMatchObject({ kind: "routed" })
    expect(db.sqlite.prepare("SELECT body FROM correspondence_messages").get()).toEqual({ body: `Can someone check the deck boards?\n\n${FILES_NOT_SAVED_NOTE}` })
    expect(count(db, "correspondence_attachments")).toEqual({ count: 0 })
    expect(recordActivityEvent).toHaveBeenCalledWith(expect.objectContaining({ metadata: expect.objectContaining({ filesLeftOut: true }) }))
  })

  it("keeps holding when job messaging is off", async () => {
    const db = setup()
    expect(await route(db, candidate(), {})).toEqual({ kind: "needs_review", projectId: "proj-a" })
    expect(recordActivityEvent).toHaveBeenCalledWith(expect.objectContaining({ metadata: expect.objectContaining({ heldReason: "messaging_off" }) }))
  })
})

describe("held email backlog", () => {
  function hold(db: CorrespondenceTestDatabase, id: string, toAddress: string, body: string, receivedAt: string): void {
    db.sqlite.prepare(`INSERT INTO inbound_emails (id,organization_id,gmail_message_id,from_address,from_name,to_address,subject,text_body,matched_status,received_at,imported_at)
      VALUES (?,?,?,?,?,?,?,?,'needs_review',?,?)`).run(id, "org-a", `gmail-${id}`, "stranger@example.test", "Pat Stranger", toAddress, "Deck question", body, receivedAt, receivedAt)
  }

  it("posts known-job emails quietly, leaves unknown ones held, and is safe to rerun", async () => {
    const db = setup()
    hold(db, "addressed", "jarvis+project-proj-a@example.test", "Please check the deck.", "2026-09-01T10:00:00.000Z")
    hold(db, "numbered", "jarvis@example.test", "About J-2002 framing.", "2026-09-02T10:00:00.000Z")
    hold(db, "two-jobs", "jarvis@example.test", "J-1001 and J-2002.", "2026-09-03T10:00:00.000Z")
    hold(db, "no-job", "jarvis@example.test", "Hello.", "2026-09-04T10:00:00.000Z")

    const first = await postHeldEmailBacklog({ db: db.db, env: ENV, limit: 3 })
    expect(first).toMatchObject({ scanned: 3, posted: 2, stillHeld: 1, skipped: 0, nextAfter: "2026-09-03T10:00:00.000Z|two-jobs" })
    const second = await postHeldEmailBacklog({ db: db.db, env: ENV, limit: 3, after: first.nextAfter })
    expect(second).toMatchObject({ scanned: 1, posted: 0, stillHeld: 1, nextAfter: null })

    expect(db.sqlite.prepare("SELECT id, matched_status AS status, project_id AS projectId FROM inbound_emails ORDER BY received_at").all()).toEqual([
      { id: "addressed", status: "posted", projectId: "proj-a" },
      { id: "numbered", status: "posted", projectId: "proj-b" },
      { id: "two-jobs", status: "needs_review", projectId: null },
      { id: "no-job", status: "needs_review", projectId: null },
    ])
    // Quiet: no notifications, and the messages arrive already read.
    expect(count(db, "notification_events")).toEqual({ count: 0 })
    expect(count(db, "notification_recipients")).toEqual({ count: 0 })
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM correspondence_recipients WHERE opened_at IS NULL").get()).toEqual({ count: 0 })
    expect(count(db, "correspondence_messages")).toEqual({ count: 2 })

    const rerun = await postHeldEmailBacklog({ db: db.db, env: ENV })
    expect(rerun).toMatchObject({ scanned: 2, posted: 0, stillHeld: 2 })
    expect(count(db, "correspondence_messages")).toEqual({ count: 2 })
  })

  it("leaves Compass's own mail held even when it names one job", async () => {
    const db = setup()
    const env = { ...ENV, COMPASS_REPLY_MAILBOX: "jarvis@example.test" }
    hold(db, "own", "client@example.test", "Update on J-1001.", "2026-09-01T10:00:00.000Z")
    db.sqlite.exec("UPDATE inbound_emails SET from_address='jarvis+cmp-1@example.test'")
    expect(await postHeldEmailBacklog({ db: db.db, env })).toMatchObject({ scanned: 1, posted: 0, stillHeld: 1 })
    expect(count(db, "correspondence_messages")).toEqual({ count: 0 })
  })
})
