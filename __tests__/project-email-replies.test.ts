import { afterEach, describe, expect, it, vi } from "vitest"
import { readFileSync } from "node:fs"

import { context, openCorrespondenceTestDatabase, type CorrespondenceTestDatabase } from "./helpers/correspondence-core"
import { routeProjectEmailReply } from "@/lib/email/project-email-replies"
import { readCorrespondence } from "@/lib/correspondence/read"
import type { InboundCandidate } from "@/lib/email/gmail-message-parser"

vi.mock("server-only", () => ({}))

let database: CorrespondenceTestDatabase | undefined
function setup(): CorrespondenceTestDatabase {
  const db = openCorrespondenceTestDatabase()
  database = db
  db.sqlite.exec(readFileSync("drizzle/0041_notifications.sql", "utf8").replaceAll("--> statement-breakpoint", ""))
  db.sqlite.exec(readFileSync("drizzle/0048_notification_channels.sql", "utf8").replaceAll("--> statement-breakpoint", ""))
  db.sqlite.exec(readFileSync("drizzle/0049_sms_consent.sql", "utf8").replaceAll("--> statement-breakpoint", ""))
  db.sqlite.exec(readFileSync("drizzle/0053_email_reply_threads.sql", "utf8").replaceAll("--> statement-breakpoint", ""))
  db.sqlite.exec(readFileSync("drizzle/0176_project_email_campaigns.sql", "utf8").replaceAll("--> statement-breakpoint", ""))
  db.sqlite.exec(`
    INSERT INTO project_correspondence (id,organization_id,project_id,subject,created_at) VALUES ('conversation-email','org-a','project-a','Permit update','2026-09-30T12:00:00Z');
    INSERT INTO correspondence_messages (id,conversation_id,author_user_id,author_name,source,body,sent_at,request_hash) VALUES ('message-project-email-test','conversation-email','staff-a','Staff A','email','Permit approved','2026-09-30T12:00:00Z','request');
    INSERT INTO correspondence_participants (id,conversation_id,user_id,name,email,role) VALUES ('participant-a','conversation-email','staff-a','Staff A','staff-a@example.test','staff'),('participant-revoked','conversation-email','revoked-a','Revoked A','revoked-a@example.test','staff');
    INSERT INTO correspondence_recipients (id,message_id,user_id,name,kind,opened_at) VALUES ('grant-a','message-project-email-test','staff-a','Staff A','author','2026-09-30T12:00:00Z'),('grant-revoked','message-project-email-test','revoked-a','Revoked A','to',NULL);
    INSERT INTO email_reply_threads (id,token,organization_id,project_id,source_type,source_id,reply_to_address,subject,status,created_at,updated_at) VALUES ('reply-thread','cmp-0123456789abcdef12','org-a','project-a','project_correspondence','conversation-email','Compass <jarvis+cmp-0123456789abcdef12@hps-colorado.com>','Permit update','active','2026-09-30T12:00:00Z','2026-09-30T12:00:00Z');
    INSERT INTO project_email_campaigns (id,organization_id,project_id,conversation_id,message_id,sender_user_id,request_hash,reply_thread_id,status,created_at,updated_at) VALUES ('campaign','org-a','project-a','conversation-email','message-project-email-test','staff-a','request','reply-thread','sent','2026-09-30T12:00:00Z','2026-09-30T12:00:00Z');
    INSERT INTO project_email_recipients (id,campaign_id,email,kind) VALUES ('recipient-to','campaign','bidder@example.com','to'),('recipient-bcc','campaign','quiet@example.com','bcc');
  `)
  return db
}
afterEach(() => database?.close())

function candidate(patch: Partial<InboundCandidate> = {}): InboundCandidate {
  return {
    gmailMessageId: "gmail-reply-1", gmailThreadId: "gmail-thread", messageIdHeader: null,
    inReplyToHeader: "<original@example.com>", referencesHeader: null,
    token: "cmp-0123456789abcdef12", fromAddress: "bidder@example.com", fromName: "Bidder",
    toAddress: "jarvis+cmp-0123456789abcdef12@hps-colorado.com", subject: "Re: Permit update",
    textBody: "Thanks for the update.", htmlBody: null, snippet: null,
    receivedAt: "2026-09-30T13:00:00Z", attachments: [], ...patch,
  }
}

describe("external project email replies", () => {
  it("saves an authorized reply once and grants only active internal participants", async () => {
    const db = setup()
    db.sqlite.exec("UPDATE correspondence_participants SET revoked_at='2026-09-30T12:30:00Z' WHERE user_id='revoked-a'")
    const replyThread = await db.db.query.emailReplyThreads.findFirst()
    if (!replyThread) throw new Error("Missing test reply thread")
    const input = { db: db.db, organizationId: "org-a", replyThread, candidate: candidate() }
    const result = await routeProjectEmailReply(input)
    expect(result.status).toBe("posted")
    expect(db.sqlite.prepare("SELECT author_user_id,author_name,body FROM correspondence_messages WHERE id=?").get(result.messageId)).toEqual({ author_user_id: null, author_name: "Bidder <bidder@example.com>", body: "Thanks for the update." })
    expect(db.sqlite.prepare("SELECT user_id FROM correspondence_recipients WHERE message_id=?").all(result.messageId)).toEqual([{ user_id: "staff-a" }])
    expect((await routeProjectEmailReply(input)).status).toBe("duplicate")
  })

  it("accepts Bcc replies but rejects strangers and tokens absent from the destination", async () => {
    const db = setup()
    const replyThread = await db.db.query.emailReplyThreads.findFirst()
    if (!replyThread) throw new Error("Missing test reply thread")
    const base = { db: db.db, organizationId: "org-a", replyThread }
    expect((await routeProjectEmailReply({ ...base, candidate: candidate({ fromAddress: "quiet@example.com" }) })).status).toBe("posted")
    expect((await routeProjectEmailReply({ ...base, candidate: candidate({ gmailMessageId: "gmail-reply-2", fromAddress: "stranger@example.com" }) })).status).toBe("needs_review")
    expect((await routeProjectEmailReply({ ...base, candidate: candidate({ gmailMessageId: "gmail-reply-3", toAddress: "jarvis@hps-colorado.com" }) })).status).toBe("needs_review")
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM correspondence_messages").get()).toEqual({ count: 2 })
  })

  it("shows Bcc only to the sender while staff see To and Cc headers", async () => {
    const db = setup()
    const sender = await readCorrespondence(context(db, "staff-a", "project-a"), "conversation-email")
    const colleague = await readCorrespondence(context(db, "revoked-a", "project-a"), "conversation-email")
    expect(sender.messages[0]?.emailBcc).toEqual(["quiet@example.com"])
    expect(colleague.messages[0]?.emailBcc).toEqual([])
    expect(colleague.messages[0]?.recipients).toEqual([{ name: "bidder@example.com", kind: "to" }])
  })

  it("keeps reply text visible while marking attachments for manual review", async () => {
    const db = setup()
    const replyThread = await db.db.query.emailReplyThreads.findFirst()
    if (!replyThread) throw new Error("Missing test reply thread")
    const result = await routeProjectEmailReply({ db: db.db, organizationId: "org-a", replyThread, candidate: candidate({ attachments: [{ attachmentId: "file-1", fileName: "plan.pdf", mimeType: "application/pdf", size: 100, data: null }] }) })
    expect(result.status).toBe("needs_review")
    expect(db.sqlite.prepare("SELECT body FROM correspondence_messages WHERE id=?").get(result.messageId)).toEqual({ body: expect.stringContaining("1 email attachment is pending manual review") })
  })

  it("rolls back a reply when project staff access changes during the write", async () => {
    const db = setup()
    const replyThread = await db.db.query.emailReplyThreads.findFirst()
    if (!replyThread) throw new Error("Missing test reply thread")
    db.failures.setBeforeBatchHook((sqlite) => sqlite.exec("UPDATE correspondence_participants SET revoked_at='2026-09-30T12:59:00Z' WHERE user_id='staff-a'"))
    await expect(routeProjectEmailReply({ db: db.db, organizationId: "org-a", replyThread, candidate: candidate() })).rejects.toThrow()
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM correspondence_messages").get()).toEqual({ count: 1 })
  })
})
