import { afterEach, describe, expect, it, vi } from "vitest"
import { readFileSync } from "node:fs"
import { openCorrespondenceTestDatabase, type CorrespondenceTestDatabase, addContactDirectorySchema } from "./helpers/correspondence-core"
import { listHeldJobEmails, postHeldJobEmail } from "@/lib/email/held-job-emails"
import { routeInboundProjectMessage } from "@/lib/email/project-message-routing"
import type { InboundCandidate } from "@/lib/email/gmail-message-parser"
import type { AuthUser } from "@/lib/auth"
import { recordActivityEvent } from "@/lib/activity-log"

vi.mock("server-only", () => ({}))
vi.mock("@/lib/activity-log", () => ({ recordActivityEvent: vi.fn() }))
vi.mock("@/lib/correspondence/access", () => ({ isCorrespondenceEnabled: (_id: string, env: unknown) => typeof env === "object" && env !== null && "COMPASS_CORRESPONDENCE_ENABLED" in env && env.COMPASS_CORRESPONDENCE_ENABLED === "true" }))
// Gmail is not reachable in tests, so held emails post from their stored text.
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
  db.sqlite.exec(`
    CREATE TABLE IF NOT EXISTS inbound_emails (
      id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, project_id TEXT, reply_thread_id TEXT, token TEXT,
      gmail_message_id TEXT NOT NULL UNIQUE, gmail_thread_id TEXT, message_id_header TEXT, in_reply_to_header TEXT,
      references_header TEXT, from_address TEXT NOT NULL, from_name TEXT, to_address TEXT, subject TEXT NOT NULL,
      text_body TEXT, html_body TEXT, snippet TEXT, sender_authentication TEXT, matched_status TEXT NOT NULL DEFAULT 'needs_review',
      posted_message_id TEXT, received_at TEXT NOT NULL, imported_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS activity_events (
      id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, project_id TEXT, actor_user_id TEXT, actor_name TEXT NOT NULL,
      actor_role TEXT NOT NULL, category TEXT NOT NULL, action TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT,
      summary TEXT NOT NULL, metadata TEXT, created_at TEXT NOT NULL
    );
  `)
  return db
}
afterEach(() => {
  database?.close()
  vi.mocked(recordActivityEvent).mockClear()
})

const REVIEWER: AuthUser = {
  id: "staff-a", email: "staff-a@example.test", firstName: "Staff", lastName: "A", displayName: "Staff A", avatarUrl: null,
  role: "admin", googleEmail: null, isActive: true, lastLoginAt: null, organizationId: "org-a", organizationName: "A",
  organizationType: "internal", createdAt: "2026-09-05T12:00:00.000Z", updatedAt: "2026-09-05T12:00:00.000Z",
}

function candidate(patch: Partial<InboundCandidate> = {}): InboundCandidate {
  return { gmailMessageId: "held-1", gmailThreadId: null, messageIdHeader: null, inReplyToHeader: null, referencesHeader: null, token: null, fromAddress: "stranger@example.test", fromName: "Pat Stranger", toAddress: "jarvis+project-project-b@example.test", subject: "Deck question", textBody: "Can someone check the deck boards?", htmlBody: null, snippet: null, receivedAt: "2026-09-05T18:00:00.000Z", attachments: [], ...patch }
}

/** The row the Gmail importer writes for a held email. */
function holdEmail(db: CorrespondenceTestDatabase, email: InboundCandidate, projectId: string | null): void {
  db.sqlite.prepare(`INSERT INTO inbound_emails (id,organization_id,project_id,gmail_message_id,from_address,from_name,to_address,subject,text_body,matched_status,received_at,imported_at)
    VALUES (?,?,?,?,?,?,?,?,?,'needs_review',?,?)`).run(`inbound-${email.gmailMessageId}`, "org-a", projectId, email.gmailMessageId, email.fromAddress, email.fromName, email.toAddress, email.subject, email.textBody, email.receivedAt, email.receivedAt)
}

function participants(db: CorrespondenceTestDatabase): unknown {
  return db.sqlite.prepare("SELECT user_id FROM correspondence_participants ORDER BY user_id").all()
}

describe("posting held job emails from the Staff Message Desk", () => {
  it("notifies the reviewer when no staff are assigned to the job", async () => {
    const db = setup()
    const email = candidate()
    // project-b has no assigned staff, so the automatic route holds it.
    expect(await routeInboundProjectMessage({ db: db.db, env: ENV, organizationId: "org-a", projectId: "project-b", candidate: email, body: "x", source: "email", now: "2026-09-05T19:00:00.000Z" }))
      .toEqual({ status: "held", reason: "no_recipients" })
    holdEmail(db, email, "project-b")

    const result = await postHeldJobEmail({ db: db.db, env: ENV, organizationId: "org-a", reviewer: REVIEWER, emailId: "inbound-held-1", projectId: "project-b" })

    expect(result).toEqual({ success: true, data: { projectId: "project-b", messageId: expect.stringMatching(/^inbound-message-/), filesLeftOut: false, filesUnchecked: true } })
    expect(participants(db)).toEqual([{ user_id: "staff-a" }])
    expect(db.sqlite.prepare("SELECT user_id FROM notification_recipients").all()).toEqual([{ user_id: "staff-a" }])
    expect(db.sqlite.prepare("SELECT body, author_user_id AS author FROM correspondence_messages").get()).toEqual({ body: "Can someone check the deck boards?", author: null })
    const stored = db.sqlite.prepare("SELECT matched_status AS status, project_id AS projectId, posted_message_id AS postedId FROM inbound_emails").get()
    expect(stored).toEqual({ status: "posted", projectId: "project-b", postedId: result.success ? result.data.messageId : null })
    // Already handled: a second reviewer (or a late click) can't post it again.
    expect(await postHeldJobEmail({ db: db.db, env: ENV, organizationId: "org-a", reviewer: REVIEWER, emailId: "inbound-held-1", projectId: "project-a" }))
      .toEqual({ success: false, error: "This email is no longer waiting for review." })
    expect(recordActivityEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: "project_email.routed",
      projectId: "project-b",
      actor: expect.objectContaining({ id: "staff-a" }),
      metadata: expect.objectContaining({ manualReview: true, routedBy: "staff-a" }),
    }))
  })

  it("lets staff post an email from a sender who isn't a contact", async () => {
    const db = setup()
    db.sqlite.exec("UPDATE projects SET id='proj-project-a' WHERE id='project-b'")
    db.sqlite.exec("UPDATE project_members SET project_id='proj-project-a' WHERE project_id='project-a'")
    // Held before unrecognized senders were posted automatically.
    const email = candidate({ toAddress: "jarvis+project-proj-project-a@example.test" })
    holdEmail(db, email, "proj-project-a")

    const result = await postHeldJobEmail({ db: db.db, env: ENV, organizationId: "org-a", reviewer: REVIEWER, emailId: "inbound-held-1", projectId: "proj-project-a" })

    expect(result.success).toBe(true)
    // The job's assigned staff are notified; the reviewer is not added on top.
    expect(participants(db)).toEqual([{ user_id: "revoked-a" }, { user_id: "staff-a" }])
    expect(db.sqlite.prepare("SELECT author_name AS author FROM correspondence_messages").get()).toEqual({ author: "Pat Stranger <stranger@example.test>" })
  })

  it("refuses another company's job and emails no longer waiting", async () => {
    const db = setup()
    holdEmail(db, candidate(), "project-b")
    expect(await postHeldJobEmail({ db: db.db, env: ENV, organizationId: "org-a", reviewer: REVIEWER, emailId: "inbound-held-1", projectId: "project-other" }))
      .toEqual({ success: false, error: "Job not found." })
    db.sqlite.exec("UPDATE inbound_emails SET matched_status='dismissed'")
    expect(await postHeldJobEmail({ db: db.db, env: ENV, organizationId: "org-a", reviewer: REVIEWER, emailId: "inbound-held-1", projectId: "project-b" }))
      .toEqual({ success: false, error: "This email is no longer waiting for review." })
    expect(participants(db)).toEqual([])
  })

  it("lists held emails with the job and the reason they were held", async () => {
    const db = setup()
    holdEmail(db, candidate(), "project-b")
    holdEmail(db, candidate({ gmailMessageId: "held-2", subject: "[RFI] Beam size", toAddress: null }), null)
    db.sqlite.prepare("INSERT INTO activity_events (id,organization_id,project_id,actor_name,actor_role,category,action,entity_type,entity_id,summary,metadata,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)")
      .run("project-email-review-held-1", "org-a", "project-b", "Pat", "project_email", "email", "project_email.needs_review", "project_email", "held-1", "held", JSON.stringify({ senderAuthorized: false, subjectTagged: false }), "2026-09-05T18:00:00.000Z")

    const queue = await listHeldJobEmails(db.db, "org-a")

    expect(queue.items.map((item) => ({ id: item.id, job: item.project?.projectNumber ?? null, suggested: item.suggestedProjectId, reason: item.reason.label, rfi: item.isRfi }))).toEqual([
      { id: "inbound-held-1", job: "A-2", suggested: "project-b", reason: "Sender isn't a contact on this job", rfi: false },
      { id: "inbound-held-2", job: null, suggested: null, reason: "Compass couldn't tell which job it's for", rfi: true },
    ])
  })
  it("lets only one reviewer take a held email", async () => {
    const db = setup()
    holdEmail(db, candidate(), "project-b")
    // Another reviewer took it between the read and the claim.
    db.sqlite.exec("UPDATE inbound_emails SET matched_status = 'posting'")
    expect(await postHeldJobEmail({ db: db.db, env: ENV, organizationId: "org-a", reviewer: REVIEWER, emailId: "inbound-held-1", projectId: "project-b" }))
      .toEqual({ success: false, error: "This email is no longer waiting for review." })
    expect(db.sqlite.prepare("SELECT count(*) AS n FROM correspondence_messages").get()).toEqual({ n: 0 })
  })
})
