import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { beforeEach, describe, expect, it } from "vitest"

import {
  CAPTURE_SCHEMA,
  PARTICIPANT_MAP_SCHEMA,
  buildBatches,
  conversationId,
  legacyArchiveChannelId,
  legacyArchiveMessageId,
  legacyOwnerHistoryMessageId,
  parseCapture,
  parseParticipantMap,
  planImport,
  sentAtIso,
  statementValueCount,
} from "../../../scripts/import-buildertrend-messages.mjs"

/*
 * The Buildertrend messages importer (docs/plans/bt-messages-live-conversations.md)
 * is checked against a database built from every migration, so the SQL it
 * writes is exercised exactly as D1 would run it.
 */

const ROOT = process.cwd()
const ORG = "org-1"
const PROJECT = "proj-1"
const STAFF_ONLY_PROJECT = "proj-hold"
const ACTOR = "user-staff"
const SHA_A = "a".repeat(64)
const SHA_B = "b".repeat(64)

type Row = Record<string, unknown>

function migratedDatabase(): DatabaseSync {
  const db = new DatabaseSync(":memory:")
  const files = readdirSync(join(ROOT, "drizzle")).filter((file) => /^\d{4}_.*\.sql$/.test(file)).sort()
  for (const file of files) db.exec(readFileSync(join(ROOT, "drizzle", file), "utf8").replaceAll("--> statement-breakpoint", ""))
  db.exec("PRAGMA foreign_keys = ON")
  return db
}

function seed(db: DatabaseSync): void {
  const now = "2026-01-01T00:00:00.000Z"
  db.exec(`INSERT INTO organizations (id, name, slug, type, is_active, created_at, updated_at) VALUES ('${ORG}', 'Org', 'org', 'internal', 1, '${now}', '${now}')`)
  for (const [id, email] of [[ACTOR, "pm@example.com"], ["user-owner", "owner@example.com"], ["user-vendor", "vendor@example.com"]]) {
    db.exec(`INSERT INTO users (id, email, role, is_active, created_at, updated_at) VALUES ('${id}', '${email}', 'project_manager', 1, '${now}', '${now}')`)
  }
  for (const id of [PROJECT, STAFF_ONLY_PROJECT]) {
    db.exec(`INSERT INTO projects (id, name, organization_id, created_at) VALUES ('${id}', '${id}', '${ORG}', '${now}')`)
  }
  db.exec(`UPDATE projects SET imported_conversations_staff_only = 1 WHERE id = '${STAFF_ONLY_PROJECT}'`)
  // A legacy staff archive holding one already-imported message.
  db.exec(`INSERT INTO channels (id, name, type, organization_id, project_id, is_private, audience, created_by, sort_order, created_at, updated_at) VALUES ('${legacyArchiveChannelId("job-1")}', 'BT archive', 'text', '${ORG}', '${PROJECT}', 0, 'staff', '${ACTOR}', 0, '${now}', '${now}')`)
  db.exec(`INSERT INTO messages (id, channel_id, user_id, content, is_pinned, reply_count, created_at) VALUES ('${legacyArchiveMessageId("job-1", "m1")}', '${legacyArchiveChannelId("job-1")}', '${ACTOR}', 'excerpt only', 0, 0, '${now}')`)
  // The owner channel holds an earlier reviewed copy of the same message.
  db.exec(`INSERT INTO channels (id, name, type, organization_id, project_id, is_private, audience, created_by, sort_order, created_at, updated_at) VALUES ('project-owner-${PROJECT}', 'Owner Team', 'text', '${ORG}', '${PROJECT}', 1, 'clients', '${ACTOR}', 0, '${now}', '${now}')`)
  db.exec(`INSERT INTO messages (id, channel_id, user_id, content, is_pinned, reply_count, created_at) VALUES ('${legacyOwnerHistoryMessageId("job-1", "m1")}', 'project-owner-${PROJECT}', '${ACTOR}', 'excerpt only', 0, 0, '${now}')`)
  // A stored chat file whose bytes match one Buildertrend attachment.
  db.exec(`INSERT INTO messages (id, channel_id, user_id, content, is_pinned, reply_count, created_at) VALUES ('native-1', 'project-owner-${PROJECT}', '${ACTOR}', 'photo', 0, 0, '${now}')`)
  db.exec(`INSERT INTO message_attachments (id, message_id, file_name, mime_type, file_size, r2_path, uploaded_at, content_sha256) VALUES ('att-native', 'native-1', 'photo.jpg', 'image/jpeg', 10, 'drive-existing', '${now}', '${SHA_A}')`)
}

const staff = { participantId: "1", namespace: "builder", role: "Project Manager", displayName: "Pat PM" }
const owner = { participantId: "2", namespace: "owner", role: "Owner", displayName: "Olive Owner" }
const newOwner = { participantId: "3", namespace: "owner", role: "Owner", displayName: "Oscar Owner" }
const vendor = { participantId: "4", namespace: "sub", role: "Sub", displayName: "Val Vendor" }

function message(id: string, overrides: Row = {}): string {
  return JSON.stringify({
    schema: CAPTURE_SCHEMA, type: "message", btJobId: "job-1", btThreadId: "t1", btMessageId: id, btParentMessageId: null,
    subject: "Kitchen tile", body: `Body of ${id}`, sentAtDisplay: "Oct 3, 2025 4:12 PM", sentAtZone: null,
    sender: staff, recipients: [{ ...owner, kind: "to" }], attachments: [], ...overrides,
  })
}

function thread(id: string, count: number, job = "job-1"): string {
  return JSON.stringify({ schema: CAPTURE_SCHEMA, type: "thread", btJobId: job, btThreadId: id, messageCount: count })
}

const participantMap = parseParticipantMap({
  schema: PARTICIPANT_MAP_SCHEMA,
  participants: {
    "builder:1": { decision: "user", kind: "staff", userId: ACTOR },
    "owner:2": { decision: "user", kind: "owner", userId: "user-owner" },
    "owner:3": { decision: "new_contact", kind: "owner", displayName: "Oscar Owner", email: "oscar@example.com" },
    "sub:4": { decision: "user", kind: "vendor", userId: "user-vendor" },
  },
})

function run(db: DatabaseSync, lines: readonly string[], projects: Row = { "job-1": PROJECT, "job-2": STAFF_ONLY_PROJECT }) {
  const plan = planImport({
    capture: parseCapture(lines.join("\n")),
    participants: participantMap,
    projects,
    timeZone: "America/Denver",
    organizationId: ORG,
  })
  const built = buildBatches(plan, { actorUserId: ACTOR, now: "2026-11-01T00:00:00.000Z", driveFiles: new Map([[SHA_B, "drive-new"]]), batchSize: 40 })
  for (const batch of built.batches) db.exec(batch.statements.join("\n"))
  db.exec(built.tail.join("\n"))
  return { plan, built }
}

function all(db: DatabaseSync, query: string): Row[] {
  return db.prepare(query).all()
}

function count(db: DatabaseSync, query: string): number {
  return Number(all(db, query)[0]?.n ?? 0)
}

describe("Buildertrend messages importer", () => {
  let db: DatabaseSync
  beforeEach(() => {
    db = migratedDatabase()
    seed(db)
  })

  it("converts the legacy archive row in place and inserts the rest once, with original dates", () => {
    run(db, [message("m1"), message("m2", { sentAtDisplay: "10/4/2025 9:00 AM" }), thread("t1", 2)])
    const channelId = conversationId(ORG, "t1")
    const rows = all(db, `SELECT id, channel_id, content, source_message_id, source_sent_at_snapshot, created_at FROM messages WHERE source_system = 'buildertrend' ORDER BY created_at`)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ id: legacyArchiveMessageId("job-1", "m1"), channel_id: channelId, content: "Body of m1", source_sent_at_snapshot: "Oct 3, 2025 4:12 PM", created_at: "2025-10-03T22:12:00.000Z" })
    expect(rows[1]).toMatchObject({ channel_id: channelId, source_message_id: "m2", created_at: "2025-10-04T15:00:00.000Z" })
    // The owner-history copy is retired and the emptied archive is archived.
    expect(count(db, `SELECT COUNT(*) AS n FROM messages WHERE id = '${legacyOwnerHistoryMessageId("job-1", "m1")}'`)).toBe(0)
    expect(all(db, `SELECT archived_at FROM channels WHERE id = '${legacyArchiveChannelId("job-1")}'`)[0]?.archived_at).not.toBeNull()
    expect(all(db, `SELECT audience, is_private, source_thread_id FROM channels WHERE id = '${channelId}'`)[0]).toMatchObject({ audience: "clients", is_private: 1, source_thread_id: "t1" })
  })

  it("is idempotent: a second run adds nothing", () => {
    const lines = [message("m1"), message("m2", { attachments: [{ btAttachmentId: "a1", fileName: "p.jpg", mimeType: "image/jpeg", sizeBytes: 10, sha256: SHA_B }] }), thread("t1", 2)]
    run(db, lines)
    const tables = ["channels", "messages", "channel_members", "channel_read_state", "message_attachments", "project_source_record_participants", "project_contacts"]
    const before = tables.map((table) => count(db, `SELECT COUNT(*) AS n FROM ${table}`))
    run(db, lines)
    expect(tables.map((table) => count(db, `SELECT COUNT(*) AS n FROM ${table}`))).toEqual(before)
  })

  it("writes no notifications, emails, mentions or unread counts", () => {
    const { built } = run(db, [message("m1"), thread("t1", 1)])
    const sql = [...built.batches.flatMap((batch) => batch.statements), ...built.tail].join("\n")
    expect(sql).not.toMatch(/notification|email_outbox|message_mentions|push_|sms_/i)
    expect(count(db, `SELECT COUNT(*) AS n FROM channel_read_state WHERE unread_count <> 0`)).toBe(0)
  })

  it("matches people only by exact Buildertrend participant ids; others go to review", () => {
    const stranger = { participantId: "99", namespace: "owner", role: "Owner", displayName: "Olive Owner" }
    const { plan } = run(db, [message("m1", { recipients: [{ ...stranger, kind: "to" }] }), thread("t1", 1)])
    // Same display name as a mapped owner, but a different id: never matched.
    expect(plan.threads).toHaveLength(0)
    expect(plan.reviews).toEqual([expect.objectContaining({ reason: "participant_unmatched", participant: "owner:99" })])
    expect(count(db, `SELECT COUNT(*) AS n FROM messages WHERE source_system = 'buildertrend'`)).toBe(0)
    // The unreviewed message stays in the staff archive.
    expect(count(db, `SELECT COUNT(*) AS n FROM messages WHERE channel_id = '${legacyArchiveChannelId("job-1")}'`)).toBe(1)
  })

  it("adds unknown participants as directory contacts without inviting them", () => {
    run(db, [message("m1", { sender: newOwner, recipients: [{ ...staff, kind: "to" }] }), thread("t1", 1)])
    const contacts = all(db, `SELECT display_name, email, owner_portal_visible FROM project_contacts WHERE source_system = 'buildertrend'`)
    expect(contacts).toEqual([{ display_name: "Oscar Owner", email: "oscar@example.com", owner_portal_visible: 0 }])
    expect(count(db, `SELECT COUNT(*) AS n FROM project_access_invitations`)).toBe(0)
    const imported = all(db, `SELECT user_id, imported_sender_contact_id FROM messages WHERE source_system = 'buildertrend'`)[0]
    expect(imported?.user_id).toBe(ACTOR)
    expect(imported?.imported_sender_contact_id).not.toBeNull()
  })

  it("reuses a stored file with the same sha256 instead of keeping a second copy", () => {
    run(db, [message("m1", { attachments: [
      { btAttachmentId: "a1", fileName: "dup.jpg", mimeType: "image/jpeg", sizeBytes: 10, sha256: SHA_A },
      { btAttachmentId: "a2", fileName: "new.jpg", mimeType: "image/jpeg", sizeBytes: 12, sha256: SHA_B },
    ] }), thread("t1", 1)])
    const rows = all(db, `SELECT source_attachment_id, r2_path FROM message_attachments WHERE source_attachment_id IS NOT NULL ORDER BY source_attachment_id`)
    expect(rows).toEqual([
      { source_attachment_id: "a1", r2_path: "drive-existing" },
      { source_attachment_id: "a2", r2_path: "drive-new" },
    ])
  })

  it("never adds outside members on a staff-only project", () => {
    run(db, [message("h1", { btJobId: "job-2", btThreadId: "t9" }), thread("t9", 1, "job-2")])
    const members = all(db, `SELECT user_id FROM channel_members WHERE channel_id = '${conversationId(ORG, "t9")}'`).map((row) => row.user_id)
    expect(members).toEqual([ACTOR])
  })

  it("holds threads that mix owners and vendors, use Bcc, or are incomplete", () => {
    const { plan } = run(db, [
      message("m1", { recipients: [{ ...owner, kind: "to" }, { ...vendor, kind: "cc" }] }), thread("t1", 1),
      message("x1", { btThreadId: "t2", recipients: [{ ...owner, kind: "bcc" }] }), thread("t2", 1),
      message("y1", { btThreadId: "t3" }), thread("t3", 2),
    ])
    expect(plan.threads).toHaveLength(0)
    expect(plan.reviews.map((item: Row) => item.reason).sort()).toEqual(["bcc_recipient", "mixed_owner_and_vendor"])
    expect(plan.pending).toEqual([expect.objectContaining({ reason: "thread_incomplete", btThreadId: "t3" })])
  })

  it("keeps every statement within the D1 value limit and reads displayed dates", () => {
    const { built } = run(db, [message("m1"), thread("t1", 1)])
    for (const statement of built.batches.flatMap((batch) => batch.statements)) {
      expect(statementValueCount(statement)).toBeLessThanOrEqual(100)
    }
    expect(sentAtIso("Jan 15, 2025 9:05 AM", "America/Denver")).toBe("2025-01-15T16:05:00.000Z")
    expect(sentAtIso("not a date", "America/Denver")).toBeNull()
  })
})
