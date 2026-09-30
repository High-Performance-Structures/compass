import { afterEach, describe, expect, it, vi } from "vitest"
import { readFileSync } from "node:fs"

import { context, openCorrespondenceTestDatabase, type CorrespondenceTestDatabase } from "./helpers/correspondence-core"
import { routeProjectEmailReply } from "@/lib/email/project-email-replies"
import { persistCorrespondence } from "@/lib/correspondence/send"
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

  it("shares replies with active project owners and allows them to respond in Compass", async () => {
    const db = setup()
    db.sqlite.exec("INSERT INTO correspondence_participants (id,conversation_id,user_id,name,email,role) VALUES ('owner-participant','conversation-email','owner-a','Owner A','owner-a@example.test','owner')")
    db.sqlite.exec("INSERT INTO correspondence_recipients (id,message_id,user_id,name,kind) VALUES ('owner-grant','message-project-email-test','owner-a','Owner A','to')")
    const replyThread = await db.db.query.emailReplyThreads.findFirst()
    if (!replyThread) throw new Error("Missing reply thread")
    const result = await routeProjectEmailReply({ db: db.db, organizationId: "org-a", replyThread, candidate: candidate() })
    expect(result.status).toBe("posted")
    const ownerCtx = context(db, "owner-a", "project-a")
    expect((await readCorrespondence(ownerCtx, "conversation-email")).messages.map((message) => message.body)).toContain("Thanks for the update.")
    const sent = await persistCorrespondence(ownerCtx, { projectId: "project-a", conversationId: "conversation-email", subject: "Permit update", body: "Acknowledged in Compass.", recipientUserIds: ["staff-a", "revoked-a"], attachmentIds: [], idempotencyKey: "owner-email-reply-request", participantVersion: 1 })
    expect(sent.conversationId).toBe("conversation-email")
    db.sqlite.exec("DELETE FROM project_members WHERE user_id='owner-a'")
    await expect(readCorrespondence(ownerCtx, "conversation-email")).rejects.toThrow("Conversation not found")
    const next = await routeProjectEmailReply({ db: db.db, organizationId: "org-a", replyThread, candidate: candidate({ gmailMessageId: "reply-after-revocation" }) })
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM correspondence_recipients WHERE message_id=? AND user_id='owner-a'").get(next.messageId)).toEqual({ count: 0 })
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

  it("gives each Bcc user a private view and isolates their email and Compass replies", async () => {
    const db = setup()
    db.sqlite.exec(`
      INSERT INTO organization_members (id,organization_id,user_id,role,joined_at) VALUES ('om-owner-b-a','org-a','owner-b','client','2026-09-30');
      INSERT INTO project_members (id,project_id,user_id,role,assigned_at) VALUES ('pm-owner-b-a','project-a','owner-b','owner','2026-09-30');
      INSERT INTO correspondence_participants (id,conversation_id,user_id,name,email,role) VALUES ('owner-p','conversation-email','owner-a','Owner A','owner-a@example.test','owner'),('owner-b-p','conversation-email','owner-b','Owner B','owner-b@example.test','owner');
      INSERT INTO correspondence_recipients (id,message_id,user_id,name,kind) VALUES ('owner-g','message-project-email-test','owner-a','Owner A','to'),('owner-b-g','message-project-email-test','owner-b','Owner B','to');
      INSERT INTO project_email_recipients (id,campaign_id,email,kind) VALUES ('blind-a','campaign','owner-a@example.test','bcc'),('blind-b','campaign','owner-b@example.test','bcc');
    `)
    const ownerCtx = context(db, "owner-a", "project-a")
    const otherCtx = context(db, "owner-b", "project-a")
    const detail = await readCorrespondence(ownerCtx, "conversation-email")
    expect(detail.replyAudience).toBe("private_staff")
    expect(detail.conversation.people.map((person) => person.userId).sort()).toEqual(["owner-a", "revoked-a", "staff-a"])
    expect(JSON.stringify(detail)).not.toContain("owner-b")
    expect(JSON.stringify(await readCorrespondence(otherCtx, "conversation-email"))).not.toContain("owner-a")
    const replyThread = await db.db.query.emailReplyThreads.findFirst()
    if (!replyThread) throw new Error("Missing reply thread")
    const reply = await routeProjectEmailReply({ db: db.db, organizationId: "org-a", replyThread, candidate: candidate({ fromAddress: "owner-a@example.test", fromName: "Owner A", textBody: "Private email reply" }) })
    expect(reply.status).toBe("posted")
    expect((await readCorrespondence(ownerCtx, "conversation-email")).messages.map((message) => message.body)).toContain("Private email reply")
    expect((await readCorrespondence(otherCtx, "conversation-email")).messages.map((message) => message.body)).not.toContain("Private email reply")
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM notification_recipients WHERE user_id='owner-b'").get()).toEqual({ count: 0 })
    const sent = await persistCorrespondence(ownerCtx, { projectId: "project-a", conversationId: "conversation-email", subject: "Permit update", body: "Private Compass reply", recipientUserIds: ["staff-a", "revoked-a"], attachmentIds: [], idempotencyKey: "blind-compass-reply-request", participantVersion: 1 })
    expect(db.sqlite.prepare("SELECT user_id FROM correspondence_recipients WHERE message_id=? ORDER BY user_id").all(sent.messageId)).toEqual([{ user_id: "owner-a" }, { user_id: "revoked-a" }, { user_id: "staff-a" }])
    expect((await readCorrespondence(otherCtx, "conversation-email")).messages.map((message) => message.body)).not.toContain("Private Compass reply")
    // An account email change must not remove the original blind classification.
    db.sqlite.exec("UPDATE users SET email='new-owner@example.test' WHERE id='owner-a'")
    expect(JSON.stringify(await readCorrespondence(otherCtx, "conversation-email"))).not.toContain("new-owner")
    const afterEmailChange = await routeProjectEmailReply({ db: db.db, organizationId: "org-a", replyThread, candidate: candidate({ gmailMessageId: "reply-from-original-blind-address", fromAddress: "owner-a@example.test", fromName: "Owner A", textBody: "Reply from original mailbox" }) })
    expect(db.sqlite.prepare("SELECT user_id FROM correspondence_recipients WHERE message_id=? ORDER BY user_id").all(afterEmailChange.messageId)).toEqual([{ user_id: "owner-a" }, { user_id: "revoked-a" }, { user_id: "staff-a" }])
    expect((await readCorrespondence(ownerCtx, "conversation-email")).messages.map((message) => message.body)).toContain("Reply from original mailbox")
    const staff = context(db, "revoked-a", "project-a")
    const staffDetail = await readCorrespondence(staff, "conversation-email")
    expect(staffDetail.replyAudience).toBe("shared_email")
    expect(staffDetail.conversation.people.map((person) => person.userId).sort()).toEqual(["revoked-a", "staff-a"])
    const publicReply = await persistCorrespondence(staff, { projectId: "project-a", conversationId: "conversation-email", subject: "Permit update", body: "General project update", recipientUserIds: ["staff-a"], attachmentIds: [], idempotencyKey: "staff-mass-email-reply-request", participantVersion: 1 })
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM correspondence_recipients WHERE message_id=?").get(publicReply.messageId)).toEqual({ count: 4 })
    const after = await readCorrespondence(otherCtx, "conversation-email")
    expect(after.messages.map((message) => message.body)).toContain("General project update")
    expect(JSON.stringify(after)).not.toContain("owner-a")
  })

  it("does not silently share To/Cc recipients' replies with hidden Bcc users", async () => {
    const db = setup()
    db.sqlite.exec(`
      INSERT INTO organization_members (id,organization_id,user_id,role,joined_at) VALUES ('om-owner-b-a','org-a','owner-b','client','2026-09-30');
      INSERT INTO project_members (id,project_id,user_id,role,assigned_at) VALUES ('pm-owner-b-a','project-a','owner-b','owner','2026-09-30');
      INSERT INTO correspondence_participants (id,conversation_id,user_id,name,email,role) VALUES ('owner-p','conversation-email','owner-a','Owner A','owner-a@example.test','owner'),('owner-b-p','conversation-email','owner-b','Owner B','owner-b@example.test','owner');
      INSERT INTO correspondence_recipients (id,message_id,user_id,name,kind) VALUES ('owner-g','message-project-email-test','owner-a','Owner A','to'),('owner-b-g','message-project-email-test','owner-b','Owner B','to');
      INSERT INTO project_email_recipients (id,campaign_id,email,kind) VALUES ('blind-a','campaign','owner-a@example.test','bcc'),('visible-b','campaign','owner-b@example.test','to');
    `)
    const visibleCtx = context(db, "owner-b", "project-a")
    const detail = await readCorrespondence(visibleCtx, "conversation-email")
    expect(detail.conversation.people.map((person) => person.userId)).not.toContain("owner-a")
    const sent = await persistCorrespondence(visibleCtx, { projectId: "project-a", conversationId: "conversation-email", subject: "Permit update", body: "Reply to my visible audience", recipientUserIds: ["staff-a", "revoked-a"], attachmentIds: [], idempotencyKey: "visible-compass-reply-request", participantVersion: 1 })
    expect(db.sqlite.prepare("SELECT user_id FROM correspondence_recipients WHERE message_id=? ORDER BY user_id").all(sent.messageId)).toEqual([{ user_id: "owner-b" }, { user_id: "revoked-a" }, { user_id: "staff-a" }])
    const replyThread = await db.db.query.emailReplyThreads.findFirst()
    if (!replyThread) throw new Error("Missing reply thread")
    const emailReply = await routeProjectEmailReply({ db: db.db, organizationId: "org-a", replyThread, candidate: candidate({ fromAddress: "owner-b@example.test", fromName: "Owner B", textBody: "Normal email reply" }) })
    expect(db.sqlite.prepare("SELECT user_id FROM correspondence_recipients WHERE message_id=? ORDER BY user_id").all(emailReply.messageId)).toEqual([{ user_id: "owner-b" }, { user_id: "revoked-a" }, { user_id: "staff-a" }])
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM notification_recipients r JOIN notification_events e ON e.id=r.event_id WHERE e.source_id=? AND r.user_id='owner-a'").get(emailReply.messageId)).toEqual({ count: 0 })
    expect((await readCorrespondence(context(db, "owner-a", "project-a"), "conversation-email")).messages).toHaveLength(1)
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
