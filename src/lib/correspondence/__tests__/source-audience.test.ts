import { afterEach, describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

import { readCorrespondence, listCorrespondence } from "@/lib/correspondence/read"

import {
  context,
  insertAttachment,
  insertConversation,
  insertGrant,
  insertMessage,
  insertParticipant,
  openCorrespondenceTestDatabase,
  type CorrespondenceTestDatabase,
} from "../../../../__tests__/helpers/correspondence-core"

describe("historical correspondence source audience", () => {
  let database: CorrespondenceTestDatabase | null = null

  afterEach(() => {
    database?.close()
    database = null
  })

  function open(): CorrespondenceTestDatabase {
    database = openCorrespondenceTestDatabase()
    database.sqlite.exec(readFileSync(resolve(process.cwd(), "drizzle/0154_correspondence_source_audience.sql"), "utf8"))
    return database
  }

  function seedHistoricalMessage(db: CorrespondenceTestDatabase): string {
    const conversationId = "source-audience-conversation"
    insertConversation(db.sqlite, { id: conversationId, projectId: "project-a" })
    insertParticipant(db.sqlite, { id: "source-audience-staff", conversationId, userId: "staff-a", role: "staff" })
    insertParticipant(db.sqlite, { id: "source-audience-owner", conversationId, userId: "owner-a", role: "owner" })
    insertParticipant(db.sqlite, { id: "source-audience-ungranted", conversationId, userId: "revoked-a", role: "staff" })
    insertMessage(db.sqlite, { id: "source-audience-message", conversationId, authorUserId: "staff-a", source: "buildertrend", body: "Historical body", sentAt: "2026-08-01T08:00:00" })
    insertGrant(db.sqlite, { id: "source-audience-author", messageId: "source-audience-message", userId: "staff-a", kind: "author" })
    insertGrant(db.sqlite, { id: "source-audience-owner-grant", messageId: "source-audience-message", userId: "owner-a", kind: "to" })
    db.sqlite.prepare(`INSERT INTO correspondence_source_messages
      (id,organization_id,project_id,conversation_id,message_id,source_account_id,source_project_id,source_message_id,source_subject,source_sent_display,source_sent_local,source_sent_at,source_timezone,source_body_sha256,source_evidence_json,captured_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      "source-header", "org-a", "project-a", conversationId, "source-audience-message", "bt-account", "bt-project", "bt-message",
      "Historic subject", "Aug 1, 2026 8:00 AM", "2026-08-01 08:00", null, null, "a".repeat(64), '{"expectedRecoverableFileCount":4}', "2026-09-05T12:00:00.000Z",
    )
    db.sqlite.prepare(`INSERT INTO correspondence_source_recipients
      (id,source_message_id,source_recipient_key,source_user_id,source_name,source_email,kind,source_ordinal,evidence_json)
      VALUES (?,?,?,?,?,?,?,?,?)`).run("source-author", "source-header", "author-1", "bt-author", "Historic Sender", "sender@example.test", "author", 0, "{}")
    db.sqlite.prepare(`INSERT INTO correspondence_source_recipients
      (id,source_message_id,source_recipient_key,source_user_id,source_name,source_email,kind,source_ordinal,evidence_json)
      VALUES (?,?,?,?,?,?,?,?,?)`).run("source-pending", "source-header", "to-1", null, "Pending Owner", "pending@example.test", "to", 1, "{}")
    db.sqlite.prepare(`INSERT INTO correspondence_source_recipients
      (id,source_message_id,source_recipient_key,source_user_id,source_name,source_email,kind,source_ordinal,evidence_json)
      VALUES (?,?,?,?,?,?,?,?,?)`).run("source-cc", "source-header", "cc-1", "bt-staff", "Staff A", "staff@example.test", "cc", 2, "{}")
    db.sqlite.prepare(`INSERT INTO correspondence_source_recipients
      (id,source_message_id,source_recipient_key,source_user_id,source_name,source_email,kind,source_ordinal,evidence_json)
      VALUES (?,?,?,?,?,?,?,?,?)`).run("source-bcc", "source-header", "bcc-1", null, "Hidden Recipient", "hidden@example.test", "bcc", 3, "{}")
    return conversationId
  }

  it("shows exact source To/CC to an already-authorized viewer without granting the pending person", async () => {
    const db = open()
    const conversationId = seedHistoricalMessage(db)

    const detail = await readCorrespondence(context(db, "owner-a", "project-a"), conversationId)
    expect(detail.messages).toHaveLength(1)
    expect(detail.messages[0]?.recipients).toEqual([
      { name: "Pending Owner", kind: "to" },
      { name: "Staff A", kind: "cc" },
    ])
    expect(detail.messages[0]?.sourceSentDisplay).toBe("Aug 1, 2026 8:00 AM")
    expect(detail.messages[0]?.sourceSentAt).toBeNull()
    expect(detail.messages[0]?.sourceAttachmentReadiness).toEqual({ expectedRecoverableFileCount: 4, linkedAttachmentCount: 0, pendingFileCount: 4 })
    expect(detail.messages[0]?.readReceipts).toEqual([
      { userId: "owner-a", name: "owner-a", status: "unavailable", openedAt: null },
    ])
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM correspondence_participants WHERE user_id IS NULL").get()).toMatchObject({ count: 0 })
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM correspondence_recipients WHERE user_id IS NULL").get()).toMatchObject({ count: 0 })
    const summary = await listCorrespondence(context(db, "owner-a", "project-a"), conversationId)
    expect(summary[0]?.lastActivityDisplay).toBe("Aug 1, 2026 8:00 AM")
    expect(summary[0]?.lastActivitySourceLocal).toBe(true)
    insertAttachment(db.sqlite, { id: "linked-original", messageId: "source-audience-message", driveFileId: "drive-original" })
    insertAttachment(db.sqlite, { id: "linked-original-duplicate-row", messageId: "source-audience-message", driveFileId: "drive-original" })
    insertAttachment(db.sqlite, { id: "retired-original", messageId: "source-audience-message", driveFileId: "drive-retired", retiredAt: "2026-09-05T13:00:00.000Z" })
    const linkedDetail = await readCorrespondence(context(db, "owner-a", "project-a"), conversationId)
    expect(linkedDetail.messages[0]?.sourceAttachmentReadiness).toEqual({ expectedRecoverableFileCount: 4, linkedAttachmentCount: 1, pendingFileCount: 3 })
    expect(linkedDetail.messages[0]?.attachments.map((attachment) => ({ id: attachment.id, available: attachment.available }))).toEqual([
      { id: "linked-original", available: true },
      { id: "linked-original-duplicate-row", available: true },
      { id: "retired-original", available: false },
    ])
  })

  it("keeps native messages on the existing current-account header path", async () => {
    const db = open()
    const conversationId = "native-conversation"
    insertConversation(db.sqlite, { id: conversationId, projectId: "project-a" })
    insertParticipant(db.sqlite, { id: "native-staff", conversationId, userId: "staff-a", role: "staff" })
    insertParticipant(db.sqlite, { id: "native-owner", conversationId, userId: "owner-a", role: "owner" })
    insertMessage(db.sqlite, { id: "native-message", conversationId, authorUserId: "staff-a", source: "compass", body: "Native body", sentAt: "2026-09-05T12:00:00.000Z" })
    insertGrant(db.sqlite, { id: "native-author", messageId: "native-message", userId: "staff-a", kind: "author" })
    insertGrant(db.sqlite, { id: "native-owner", messageId: "native-message", userId: "owner-a", kind: "to" })

    const detail = await readCorrespondence(context(db, "owner-a", "project-a"), conversationId)
    expect(detail.messages[0]?.recipients).toEqual([{ name: "owner-a", kind: "to" }])
    expect(detail.messages[0]?.sourceSentDisplay).toBeNull()
    expect(detail.messages[0]?.sourceSentAt).toBeNull()
  })

  it("does not let a current conversation participant without a message grant see source headers or body", async () => {
    const db = open()
    const conversationId = seedHistoricalMessage(db)
    await expect(readCorrespondence(context(db, "revoked-a", "project-a"), conversationId)).rejects.toThrow("Conversation not found")
  })

  it("does not claim file readiness when the immutable expected count is invalid", async () => {
    const db = open()
    const conversationId = seedHistoricalMessage(db)
    insertMessage(db.sqlite, { id: "invalid-count-message", conversationId, authorUserId: "staff-a", source: "buildertrend", body: "Invalid count body", sentAt: "2026-08-03T08:00:00" })
    insertGrant(db.sqlite, { id: "invalid-count-author", messageId: "invalid-count-message", userId: "staff-a", kind: "author" })
    insertGrant(db.sqlite, { id: "invalid-count-owner", messageId: "invalid-count-message", userId: "owner-a", kind: "to" })
    db.sqlite.prepare(`INSERT INTO correspondence_source_messages
      (id,organization_id,project_id,conversation_id,message_id,source_account_id,source_project_id,source_message_id,source_subject,source_sent_display,source_sent_local,source_sent_at,source_timezone,source_body_sha256,source_evidence_json,captured_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      "invalid-count-source", "org-a", "project-a", conversationId, "invalid-count-message", "bt-account", "bt-project", "bt-invalid-count",
      "Invalid count", "Aug 3, 2026 8:00 AM", "2026-08-03 08:00", null, null, "c".repeat(64), '{"expectedRecoverableFileCount":-1}', "2026-09-05T12:00:00.000Z",
    )
    const detail = await readCorrespondence(context(db, "owner-a", "project-a"), conversationId)
    expect(detail.messages.find((message) => message.id === "invalid-count-message")?.sourceAttachmentReadiness).toBeNull()
  })

  it("rejects invalid source evidence and wrong message scope, and prevents mutation", () => {
    const db = open()
    const conversationId = seedHistoricalMessage(db)
    const insert = db.sqlite.prepare(`INSERT INTO correspondence_source_messages
      (id,organization_id,project_id,conversation_id,message_id,source_account_id,source_project_id,source_message_id,source_subject,source_sent_display,source_sent_local,source_sent_at,source_timezone,source_body_sha256,source_evidence_json,captured_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    expect(() => insert.run("bad-hash", "org-a", "project-a", conversationId, "source-audience-message", "account-bad-hash", "bt-project", "bt-bad-hash", "Subject", "Display", null, null, null, "not-a-sha", "{}", "2026-09-05T12:00:00.000Z")).toThrow()
    expect(() => insert.run("bad-json", "org-a", "project-a", conversationId, "source-audience-message", "account-bad-json", "bt-project", "bt-bad-json", "Subject", "Display", null, null, null, "a".repeat(64), "not-json", "2026-09-05T12:00:00.000Z")).toThrow()
    expect(() => insert.run("bad-scope", "org-a", "project-b", conversationId, "source-audience-message", "account-bad-scope", "bt-project", "bt-bad-scope", "Subject", "Display", null, null, null, "a".repeat(64), "{}", "2026-09-05T12:00:00.000Z")).toThrow(/scope mismatch/)
    expect(() => db.sqlite.prepare("UPDATE correspondence_source_messages SET source_subject = ? WHERE id = ?").run("changed", "source-header")).toThrow(/immutable/)
    expect(() => db.sqlite.prepare("DELETE FROM correspondence_source_messages WHERE id = ?").run("source-header")).toThrow(/immutable/)
    expect(() => db.sqlite.prepare("UPDATE correspondence_source_recipients SET source_name = ? WHERE id = ?").run("changed", "source-pending")).toThrow(/immutable/)
  })
})
