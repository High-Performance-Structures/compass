import { afterEach, describe, expect, it } from "vitest"

import { authorizedConversation } from "@/lib/correspondence/access"
import { listCorrespondence, readCorrespondence } from "@/lib/correspondence/read"
import { persistCorrespondence } from "@/lib/correspondence/send"

import {
  context,
  insertAttachment,
  insertConversation,
  insertGrant,
  insertMessage,
  insertParticipant,
  openCorrespondenceTestDatabase,
  type CorrespondenceTestDatabase,
} from "./helpers/correspondence-core"

describe("correspondence core D1 integration", () => {
  let database: CorrespondenceTestDatabase | null = null

  afterEach(() => {
    database?.close()
    database = null
  })

  function open(): CorrespondenceTestDatabase {
    database = openCorrespondenceTestDatabase()
    return database
  }

  function seedConversation(database: CorrespondenceTestDatabase, values: { readonly id?: string; readonly projectId?: "project-a" | "project-b" | "project-other"; readonly organizationId?: "org-a" | "org-b"; readonly includeOwner?: boolean }): string {
    const id = values.id ?? "conversation-a"
    const projectId = values.projectId ?? "project-a"
    insertConversation(database.sqlite, { id, projectId, organizationId: values.organizationId, subject: "Project correspondence" })
    insertParticipant(database.sqlite, { id: `${id}-staff`, conversationId: id, userId: projectId === "project-other" ? "staff-b" : "staff-a", role: "staff" })
    if (values.includeOwner !== false) insertParticipant(database.sqlite, { id: `${id}-owner`, conversationId: id, userId: projectId === "project-other" ? "owner-b" : "owner-a", role: "owner" })
    return id
  }

  it("isolates projects and tenants on list and read paths", async () => {
    const db = open()
    seedConversation(db, { id: "conversation-a", projectId: "project-a" })
    seedConversation(db, { id: "conversation-b", projectId: "project-b" })
    seedConversation(db, { id: "conversation-other", projectId: "project-other", organizationId: "org-b" })
    for (const [id, conversationId, userId] of [
      ["grant-a", "conversation-a", "staff-a"], ["grant-b", "conversation-b", "staff-a"], ["grant-other", "conversation-other", "staff-b"],
    ] as const) {
      insertMessage(db.sqlite, { id: `${id}-message`, conversationId, authorUserId: userId, body: id })
      insertGrant(db.sqlite, { id, messageId: `${id}-message`, userId, kind: "author" })
    }

    const projectA = await listCorrespondence(context(db, "staff-a", "project-a"))
    expect(projectA.map((row) => row.id)).toEqual(["conversation-a"])
    await expect(readCorrespondence(context(db, "staff-a", "project-a"), "conversation-b")).rejects.toThrow("Conversation not found")
    await expect(readCorrespondence(context(db, "staff-b", "project-other", "org-b"), "conversation-a")).rejects.toThrow("Conversation not found")
  })

  it("keeps mixed historical audiences at message grant granularity", async () => {
    const db = open()
    const conversationId = seedConversation(db, {})
    insertMessage(db.sqlite, { id: "historic-1", conversationId, authorUserId: "staff-a", body: "Staff-only historic context" })
    insertGrant(db.sqlite, { id: "historic-1-grant", messageId: "historic-1", userId: "staff-a", kind: "author" })
    insertMessage(db.sqlite, { id: "historic-2", conversationId, authorUserId: "staff-a", body: "Owner-visible reply" })
    insertGrant(db.sqlite, { id: "historic-2-staff", messageId: "historic-2", userId: "staff-a", kind: "author" })
    insertGrant(db.sqlite, { id: "historic-2-owner", messageId: "historic-2", userId: "owner-a", kind: "to" })

    const owner = await readCorrespondence(context(db, "owner-a", "project-a"), conversationId)
    expect(owner.messages.map((message) => message.id)).toEqual(["historic-2"])
    expect(owner.messages.map((message) => message.body)).not.toContain("Staff-only historic context")
    const staff = await readCorrespondence(context(db, "staff-a", "project-a"), conversationId)
    expect(staff.messages.map((message) => message.id)).toEqual(["historic-1", "historic-2"])
  })

  it("paginates beyond 200 messages with sequence ordering when timestamps tie", async () => {
    const db = open()
    const conversationId = seedConversation(db, {})
    for (let index = 0; index < 205; index += 1) {
      const id = `same-time-${index.toString().padStart(3, "0")}`
      const sequence = insertMessage(db.sqlite, { id, conversationId, authorUserId: "staff-a", body: id, sentAt: "2026-09-05T12:00:00.000Z" })
      insertGrant(db.sqlite, { id: `${id}-grant`, messageId: id, userId: "owner-a", kind: "to" })
      insertGrant(db.sqlite, { id: `${id}-author`, messageId: id, userId: "staff-a", kind: "author" })
      expect(sequence).toBeGreaterThan(0)
    }

    const seen: string[] = []
    let before: number | undefined
    for (;;) {
      const page = await readCorrespondence(context(db, "owner-a", "project-a"), conversationId, before)
      seen.unshift(...page.messages.map((message) => message.id))
      if (!page.hasEarlier) break
      const oldest = page.messages[0]
      if (!oldest) throw new Error("page unexpectedly empty")
      before = oldest.sequence
    }
    expect(seen).toHaveLength(205)
    expect(new Set(seen).size).toBe(205)
    expect(seen[0]).toBe("same-time-000")
    expect(seen.at(-1)).toBe("same-time-204")
  })

  it("is idempotent for a duplicate send and rejects a mismatched retry", async () => {
    const db = open()
    const conversationId = seedConversation(db, {})
    const input = {
      projectId: "project-a", conversationId, subject: "Project correspondence", recipientUserIds: ["owner-a"],
      body: "A native reply", idempotencyKey: "idempotency-key-0001", participantVersion: 1, attachmentIds: [],
    } as const
    const first = await persistCorrespondence(context(db, "staff-a", "project-a"), input)
    const retry = await persistCorrespondence(context(db, "staff-a", "project-a"), input)
    expect(retry).toEqual(first)
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM correspondence_messages WHERE id = ?").get(first.messageId)).toMatchObject({ count: 1 })
    await expect(persistCorrespondence(context(db, "staff-a", "project-a"), { ...input, body: "Different content" })).rejects.toThrow("different content")
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM correspondence_messages WHERE conversation_id = ?").get(conversationId)).toMatchObject({ count: 1 })
  })

  it("rolls back the whole batch when attachment linking fails", async () => {
    const db = open()
    const conversationId = seedConversation(db, {})
    insertAttachment(db.sqlite, { id: "staged-file", projectId: "project-a", ownerUserId: "staff-a", driveFileId: "drive-file" })
    db.failures.failNextMatching('set "message_id"')
    const input = {
      projectId: "project-a", conversationId, subject: "Project correspondence", recipientUserIds: ["owner-a"],
      body: "Reply with attachment", idempotencyKey: "idempotency-key-0002", participantVersion: 1, attachmentIds: ["staged-file"],
    } as const
    await expect(persistCorrespondence(context(db, "staff-a", "project-a"), input)).rejects.toThrow("could not be saved")
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM correspondence_messages").get()).toMatchObject({ count: 0 })
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM correspondence_outbox").get()).toMatchObject({ count: 0 })
    expect(db.sqlite.prepare("SELECT message_id FROM correspondence_attachments WHERE id = ?").get("staged-file")).toMatchObject({ message_id: null })
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM correspondence_write_guards").get()).toMatchObject({ count: 0 })
  })

  it("denies revoked actors and recipients and fences stale participant versions", async () => {
    const db = open()
    const conversationId = seedConversation(db, {})
    insertMessage(db.sqlite, { id: "visible", conversationId, authorUserId: "staff-a", body: "Visible" })
    insertGrant(db.sqlite, { id: "visible-staff", messageId: "visible", userId: "staff-a", kind: "author" })
    insertGrant(db.sqlite, { id: "visible-owner", messageId: "visible", userId: "owner-a", kind: "to" })
    db.sqlite.prepare("UPDATE correspondence_participants SET revoked_at = ? WHERE conversation_id = ? AND user_id = ?").run("2026-09-05T13:00:00.000Z", conversationId, "owner-a")
    await expect(readCorrespondence(context(db, "owner-a", "project-a"), conversationId)).rejects.toThrow("Conversation not found")
    await expect(persistCorrespondence(context(db, "staff-a", "project-a"), {
      projectId: "project-a", conversationId, subject: "Project correspondence", recipientUserIds: [], body: "No recipient", idempotencyKey: "idempotency-key-0003", participantVersion: 1, attachmentIds: [],
    })).rejects.toThrow("Choose between")
    db.sqlite.prepare("UPDATE correspondence_participants SET revoked_at = NULL WHERE conversation_id = ? AND user_id = ?").run(conversationId, "owner-a")
    await expect(persistCorrespondence(context(db, "staff-a", "project-a"), {
      projectId: "project-a", conversationId, subject: "Project correspondence", recipientUserIds: ["owner-a"], body: "Stale audience", idempotencyKey: "idempotency-key-0004", participantVersion: 99, attachmentIds: [],
    })).rejects.toThrow("audience changed")
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM correspondence_messages WHERE id = ?").get("visible")).toMatchObject({ count: 1 })
  })

  it("does not authorize a revoked participant through a stale direct lookup", async () => {
    const db = open()
    const conversationId = seedConversation(db, {})
    db.sqlite.prepare("UPDATE correspondence_participants SET revoked_at = ? WHERE conversation_id = ? AND user_id = ?").run("2026-09-05T13:00:00.000Z", conversationId, "staff-a")
    await expect(authorizedConversation(context(db, "staff-a", "project-a"), conversationId)).rejects.toThrow("Conversation not found")
  })

  it("orders a late historical backfill by original sentAt before a newer native reply", async () => {
    const db = open()
    const conversationId = seedConversation(db, {})
    insertMessage(db.sqlite, {
      id: "native-reply", conversationId, authorUserId: "staff-a", source: "compass", body: "Current reply",
      sentAt: "2026-09-05T12:00:00.000Z",
    })
    insertGrant(db.sqlite, { id: "native-author", messageId: "native-reply", userId: "staff-a", kind: "author" })
    insertGrant(db.sqlite, { id: "native-owner", messageId: "native-reply", userId: "owner-a", kind: "to" })
    insertMessage(db.sqlite, {
      id: "late-historical", conversationId, authorUserId: "staff-a", source: "buildertrend", body: "Older imported history",
      sentAt: "2026-08-01T12:00:00.000Z",
    })
    insertGrant(db.sqlite, { id: "late-owner", messageId: "late-historical", userId: "owner-a", kind: "to" })

    const detail = await readCorrespondence(context(db, "owner-a", "project-a"), conversationId)
    expect(detail.messages.map((message) => message.id)).toEqual(["late-historical", "native-reply"])
  })

  it("keeps a maximum recipient send within the D1 100-bind limit", async () => {
    const db = open()
    const conversationId = seedConversation(db, { includeOwner: false })
    const recipientUserIds = Array.from({ length: 30 }, (_, index) => `owner-${index.toString().padStart(2, "0")}`)
    const now = "2026-09-05T12:00:00.000Z"
    for (const userId of recipientUserIds) {
      db.sqlite.prepare("INSERT INTO users (id,email,first_name,last_name,display_name,role,is_active,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)").run(
        userId, `${userId}@example.test`, "Owner", userId, userId, "client", 1, now, now,
      )
      db.sqlite.prepare("INSERT INTO organization_members (id,organization_id,user_id,role,joined_at) VALUES (?,?,?,?,?)").run(
        `om-${userId}`, "org-a", userId, "client", now,
      )
      db.sqlite.prepare("INSERT INTO project_members (id,project_id,user_id,role,assigned_at) VALUES (?,?,?,?,?)").run(
        `pm-${userId}`, "project-a", userId, "owner", now,
      )
      insertParticipant(db.sqlite, { id: `participant-${userId}`, conversationId, userId, role: "owner" })
    }
    db.failures.setBindLimit(100)

    const result = await persistCorrespondence(context(db, "staff-a", "project-a"), {
      projectId: "project-a", conversationId, subject: "Project correspondence", recipientUserIds,
      body: "Maximum audience reply", idempotencyKey: "idempotency-key-0010", participantVersion: 1, attachmentIds: [],
    })
    expect(result.conversationId).toBe(conversationId)
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM correspondence_recipients WHERE message_id = ?").get(result.messageId)).toMatchObject({ count: 31 })
  })

  it("rolls back when a participant is revoked after validation and before the batch completes", async () => {
    const db = open()
    const conversationId = seedConversation(db, {})
    db.failures.setBeforeBatchHook((sqlite) => {
      sqlite.prepare("UPDATE correspondence_participants SET revoked_at = ? WHERE conversation_id = ? AND user_id = ?").run("2026-09-05T13:00:00.000Z", conversationId, "owner-a")
    })

    await expect(persistCorrespondence(context(db, "staff-a", "project-a"), {
      projectId: "project-a", conversationId, subject: "Project correspondence", recipientUserIds: ["owner-a"],
      body: "Revocation race", idempotencyKey: "idempotency-key-0011", participantVersion: 1, attachmentIds: [],
    })).rejects.toThrow("could not be saved")
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM correspondence_messages").get()).toMatchObject({ count: 0 })
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM correspondence_outbox").get()).toMatchObject({ count: 0 })
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM correspondence_write_guards").get()).toMatchObject({ count: 0 })
  })

  it("rejects a retired attachment even when its staged row still has a Drive ID", async () => {
    const db = open()
    const conversationId = seedConversation(db, {})
    insertAttachment(db.sqlite, { id: "retired-file", projectId: "project-a", ownerUserId: "staff-a", driveFileId: "drive-file", retiredAt: "2026-09-05T13:00:00.000Z" })

    await expect(persistCorrespondence(context(db, "staff-a", "project-a"), {
      projectId: "project-a", conversationId, subject: "Project correspondence", recipientUserIds: ["owner-a"],
      body: "Retired attachment", idempotencyKey: "idempotency-key-0012", participantVersion: 1, attachmentIds: ["retired-file"],
    })).rejects.toThrow("attachment")
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM correspondence_messages").get()).toMatchObject({ count: 0 })
  })

  it("allows an explicitly participating broad-scope staff user without project membership", async () => {
    const db = open()
    const conversationId = seedConversation(db, {})
    db.sqlite.prepare("DELETE FROM project_members WHERE project_id = ? AND user_id = ?").run("project-a", "staff-a")

    const result = await persistCorrespondence(context(db, "staff-a", "project-a"), {
      projectId: "project-a", conversationId, subject: "Project correspondence", recipientUserIds: ["owner-a"],
      body: "Staff context", idempotencyKey: "idempotency-key-0013", participantVersion: 1, attachmentIds: [],
    })
    expect(result.conversationId).toBe(conversationId)
  })

  it("requires project membership for an external participant after a role change", async () => {
    const db = open()
    const conversationId = seedConversation(db, {})
    db.sqlite.prepare("UPDATE project_members SET role = ? WHERE project_id = ? AND user_id = ?").run("supplier", "project-a", "owner-a")
    const messageId = "stale-role-message"
    insertMessage(db.sqlite, { id: messageId, conversationId, authorUserId: "staff-a", body: "Owner audience" })
    insertGrant(db.sqlite, { id: "stale-role-owner", messageId, userId: "owner-a", kind: "to" })

    await expect(readCorrespondence(context(db, "owner-a", "project-a"), conversationId)).rejects.toThrow("Conversation not found")
    db.sqlite.prepare("UPDATE project_members SET role = ? WHERE project_id = ? AND user_id = ?").run("owner", "project-a", "owner-a")
    db.sqlite.prepare("DELETE FROM project_members WHERE project_id = ? AND user_id = ?").run("project-a", "owner-a")
    await expect(readCorrespondence(context(db, "owner-a", "project-a"), conversationId)).rejects.toThrow("Conversation not found")
  })

  it("clears the matching conversation draft version and preserves a newer draft", async () => {
    const db = open()
    const conversationId = seedConversation(db, {})
    db.sqlite.prepare("INSERT INTO correspondence_drafts (id,conversation_id,user_id,body,version,updated_at) VALUES (?,?,?,?,?,?)").run(
      "draft-before-send", conversationId, "staff-a", "Reply draft", 4, "2026-09-05T12:00:00.000Z",
    )

    await persistCorrespondence(context(db, "staff-a", "project-a"), {
      projectId: "project-a", conversationId, subject: "Project correspondence", recipientUserIds: ["owner-a"],
      body: "Reply draft", idempotencyKey: "idempotency-key-0014", participantVersion: 1, attachmentIds: [],
    })
    expect(db.sqlite.prepare("SELECT body,version FROM correspondence_drafts WHERE id = ?").get("draft-before-send")).toMatchObject({ body: "", version: 5 })

    db.sqlite.prepare("UPDATE correspondence_drafts SET body = ?, version = ? WHERE id = ?").run("Newer device draft", 6, "draft-before-send")
    await persistCorrespondence(context(db, "staff-a", "project-a"), {
      projectId: "project-a", conversationId, subject: "Project correspondence", recipientUserIds: ["owner-a"],
      body: "Older device draft", idempotencyKey: "idempotency-key-0015", participantVersion: 1, attachmentIds: [],
    })
    expect(db.sqlite.prepare("SELECT body,version FROM correspondence_drafts WHERE id = ?").get("draft-before-send")).toMatchObject({ body: "Newer device draft", version: 6 })
  })

  it.each(["", " ", "\t\n", "\u00a0\u2003\ufeff"])("clears the sent composition with normalized subject/body whitespace %j", async (whitespace) => {
    const db = open()
    db.sqlite.prepare("INSERT INTO correspondence_composition_drafts (id,organization_id,project_id,user_id,subject,body,recipient_user_ids,version,updated_at) VALUES (?,?,?,?,?,?,?,?,?)").run(
      "composition-before-send", "org-a", "project-a", "staff-a", `${whitespace}New subject${whitespace}`, `${whitespace}New composition body${whitespace}`, JSON.stringify(["owner-a"]), 2, "2026-09-05T12:00:00.000Z",
    )

    await persistCorrespondence(context(db, "staff-a", "project-a"), {
      projectId: "project-a", conversationId: null, subject: "New subject", recipientUserIds: ["owner-a"],
      body: "New composition body", idempotencyKey: "idempotency-key-0016", participantVersion: null, attachmentIds: [],
    })
    expect(db.sqlite.prepare("SELECT subject,body,recipient_user_ids,version FROM correspondence_composition_drafts WHERE id = ?").get("composition-before-send")).toMatchObject({ subject: "", body: "", recipient_user_ids: "[]", version: 3 })
  })
})
