import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { beforeEach, describe, expect, it } from "vitest"

import {
  CAPTURE_SCHEMA,
  PARTICIPANT_MAP_SCHEMA,
  PRECHECK_SCHEMA,
  buildBatches,
  conversationId,
  legacyArchiveChannelId,
  legacyArchiveMessageId,
  legacyOwnerHistoryMessageId,
  parseCapture,
  parseParticipantMap,
  parsePrecheck,
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
const PRIVATE_PROJECT = "proj-private"
const JOB = "101"
const HOLD_JOB = "202"
const PRIVATE_JOB = "303"
const ACTOR = "user-staff"
const SHA_A = "a".repeat(64)
const SHA_B = "b".repeat(64)
const ESTIMATE_CHANNEL = "bt-message-archive-estimate-101"
const ESTIMATE_ROW = "bt-message-estimate-101-1001"

type Row = Record<string, unknown>

function migratedDatabase(): DatabaseSync {
  const db = new DatabaseSync(":memory:")
  const files = readdirSync(join(ROOT, "drizzle")).filter((file) => /^\d{4}_.*\.sql$/.test(file)).sort()
  for (const file of files) db.exec(readFileSync(join(ROOT, "drizzle", file), "utf8").replaceAll("--> statement-breakpoint", ""))
  db.exec("PRAGMA foreign_keys = ON")
  return db
}

function channel(db: DatabaseSync, id: string, projectId: string, isPrivate: boolean, audience: string): void {
  const now = "2026-01-01T00:00:00.000Z"
  db.exec(`INSERT INTO channels (id, name, type, organization_id, project_id, is_private, audience, created_by, sort_order, created_at, updated_at) VALUES ('${id}', '${id}', 'text', '${ORG}', '${projectId}', ${isPrivate ? 1 : 0}, '${audience}', '${ACTOR}', 0, '${now}', '${now}')`)
}

function message(db: DatabaseSync, id: string, channelId: string, content: string): void {
  db.exec(`INSERT INTO messages (id, channel_id, user_id, content, is_pinned, reply_count, created_at) VALUES ('${id}', '${channelId}', '${ACTOR}', '${content}', 0, 0, '2026-01-01T00:00:00.000Z')`)
}

function seed(db: DatabaseSync): void {
  const now = "2026-01-01T00:00:00.000Z"
  db.exec(`INSERT INTO organizations (id, name, slug, type, is_active, created_at, updated_at) VALUES ('${ORG}', 'Org', 'org', 'internal', 1, '${now}', '${now}')`)
  for (const [id, email] of [[ACTOR, "pm@example.com"], ["user-owner", "owner@example.com"], ["user-vendor", "vendor@example.com"]]) {
    db.exec(`INSERT INTO users (id, email, role, is_active, created_at, updated_at) VALUES ('${id}', '${email}', 'project_manager', 1, '${now}', '${now}')`)
  }
  for (const id of [PROJECT, STAFF_ONLY_PROJECT, PRIVATE_PROJECT]) {
    db.exec(`INSERT INTO projects (id, name, organization_id, created_at) VALUES ('${id}', '${id}', '${ORG}', '${now}')`)
  }
  db.exec(`UPDATE projects SET imported_conversations_staff_only = 1 WHERE id = '${STAFF_ONLY_PROJECT}'`)
  // A legacy staff archive holding one already-imported message.
  channel(db, legacyArchiveChannelId(JOB), PROJECT, false, "staff")
  message(db, legacyArchiveMessageId(JOB, "1001"), legacyArchiveChannelId(JOB), "excerpt only")
  // The owner channel holds an earlier reviewed copy of the same message.
  channel(db, `project-owner-${PROJECT}`, PROJECT, true, "clients")
  message(db, legacyOwnerHistoryMessageId(JOB, "1001"), `project-owner-${PROJECT}`, "excerpt only")
  // A different kind of archive that must never be touched.
  channel(db, ESTIMATE_CHANNEL, PROJECT, false, "staff")
  message(db, ESTIMATE_ROW, ESTIMATE_CHANNEL, "estimate note")
  // A private archive (closed even to most staff).
  channel(db, legacyArchiveChannelId(PRIVATE_JOB), PRIVATE_PROJECT, true, "staff")
  message(db, legacyArchiveMessageId(PRIVATE_JOB, "3001"), legacyArchiveChannelId(PRIVATE_JOB), "private")
  // A stored chat file whose bytes match one Buildertrend attachment.
  message(db, "native-1", `project-owner-${PROJECT}`, "photo")
  db.exec(`INSERT INTO message_attachments (id, message_id, file_name, mime_type, file_size, r2_path, uploaded_at, content_sha256) VALUES ('att-native', 'native-1', 'photo.jpg', 'image/jpeg', 10, 'drive-existing', '${now}', '${SHA_A}')`)
}

const staff = { participantId: "1", namespace: "builder", role: "Project Manager", displayName: "Pat PM" }
const owner = { participantId: "2", namespace: "owner", role: "Owner", displayName: "Olive Owner" }
const newOwner = { participantId: "3", namespace: "owner", role: "Owner", displayName: "Oscar Owner" }
const vendor = { participantId: "4", namespace: "sub", role: "Sub", displayName: "Val Vendor" }

function captured(id: string, overrides: Row = {}): string {
  return JSON.stringify({
    schema: CAPTURE_SCHEMA, type: "message", btJobId: JOB, btThreadId: "9001", btMessageId: id, btParentMessageId: null,
    subject: "Kitchen tile", body: `Body of ${id}`, sentAtDisplay: "Oct 3, 2025 4:12 PM", sentAtZone: null,
    sender: staff, recipients: [{ ...owner, kind: "to" }], attachments: [], ...overrides,
  })
}

function thread(id: string, count: number, job = JOB): string {
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

const verifiedPrecheck = parsePrecheck({ schema: PRECHECK_SCHEMA, staffOnlyProjectIds: [STAFF_ONLY_PROJECT], privateArchiveJobIds: [PRIVATE_JOB] })

function run(db: DatabaseSync, lines: readonly string[], options: { readonly precheck?: ReturnType<typeof parsePrecheck> } = {}) {
  const plan = planImport({
    capture: parseCapture(lines.join("\n")),
    participants: participantMap,
    precheck: options.precheck ?? verifiedPrecheck,
    projects: { [JOB]: PROJECT, [HOLD_JOB]: STAFF_ONLY_PROJECT, [PRIVATE_JOB]: PRIVATE_PROJECT },
    expectedStaffOnlyProjects: [STAFF_ONLY_PROJECT],
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
    run(db, [captured("1001"), captured("1002", { sentAtDisplay: "10/4/2025 9:00 AM" }), thread("9001", 2)])
    const channelId = conversationId(ORG, "9001")
    const rows = all(db, `SELECT id, channel_id, content, source_message_id, source_sent_at_snapshot, created_at FROM messages WHERE source_system = 'buildertrend' ORDER BY created_at`)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ id: legacyArchiveMessageId(JOB, "1001"), channel_id: channelId, content: "Body of 1001", source_sent_at_snapshot: "Oct 3, 2025 4:12 PM", created_at: "2025-10-03T22:12:00.000Z" })
    expect(rows[1]).toMatchObject({ channel_id: channelId, source_message_id: "1002", created_at: "2025-10-04T15:00:00.000Z" })
    // The owner-history copy is retired and the emptied archive is archived.
    expect(count(db, `SELECT COUNT(*) AS n FROM messages WHERE id = '${legacyOwnerHistoryMessageId(JOB, "1001")}'`)).toBe(0)
    expect(all(db, `SELECT archived_at FROM channels WHERE id = '${legacyArchiveChannelId(JOB)}'`)[0]?.archived_at).not.toBeNull()
    expect(all(db, `SELECT audience, is_private, source_thread_id FROM channels WHERE id = '${channelId}'`)[0]).toMatchObject({ audience: "clients", is_private: 1, source_thread_id: "9001" })
  })

  it("never touches the estimate archives or accepts non-numeric Buildertrend ids", () => {
    run(db, [captured("1001"), thread("9001", 1)])
    expect(all(db, `SELECT channel_id, content FROM messages WHERE id = '${ESTIMATE_ROW}'`)).toEqual([{ channel_id: ESTIMATE_CHANNEL, content: "estimate note" }])
    expect(all(db, `SELECT archived_at FROM channels WHERE id = '${ESTIMATE_CHANNEL}'`)).toEqual([{ archived_at: null }])
    expect(() => parseCapture(captured("1001", { btJobId: "estimate-101" }))).toThrow(/numeric/)
    expect(() => parseCapture(captured("estimate-101-1001"))).toThrow(/numeric/)
  })

  it("leaves any non-legacy row in a numeric archive there, staff-only, and keeps the archive open", () => {
    message(db, "staff-note-1", legacyArchiveChannelId(JOB), "internal note")
    run(db, [captured("1001"), thread("9001", 1)])
    expect(all(db, `SELECT channel_id FROM messages WHERE id = 'staff-note-1'`)).toEqual([{ channel_id: legacyArchiveChannelId(JOB) }])
    expect(all(db, `SELECT archived_at, audience FROM channels WHERE id = '${legacyArchiveChannelId(JOB)}'`)).toEqual([{ archived_at: null, audience: "staff" }])
  })

  it("holds every thread of a private archive's job and writes nothing for it", () => {
    const { plan, built } = run(db, [captured("3001", { btJobId: PRIVATE_JOB, btThreadId: "9301" }), thread("9301", 1, PRIVATE_JOB)])
    expect(plan.threads).toHaveLength(0)
    expect(plan.reviews).toEqual([expect.objectContaining({ reason: "private_archive", btJobId: PRIVATE_JOB })])
    expect(built.batches).toHaveLength(0)
    expect(all(db, `SELECT channel_id FROM messages WHERE id = '${legacyArchiveMessageId(PRIVATE_JOB, "3001")}'`)).toEqual([{ channel_id: legacyArchiveChannelId(PRIVATE_JOB) }])
  })

  it("does nothing for a private archive even if the pre-check missed it", () => {
    const stalePrecheck = parsePrecheck({ schema: PRECHECK_SCHEMA, staffOnlyProjectIds: [STAFF_ONLY_PROJECT], privateArchiveJobIds: [] })
    run(db, [captured("3001", { btJobId: PRIVATE_JOB, btThreadId: "9301" }), thread("9301", 1, PRIVATE_JOB)], { precheck: stalePrecheck })
    expect(count(db, `SELECT COUNT(*) AS n FROM channels WHERE id = '${conversationId(ORG, "9301")}'`)).toBe(0)
    expect(all(db, `SELECT channel_id FROM messages WHERE id = '${legacyArchiveMessageId(PRIVATE_JOB, "3001")}'`)).toEqual([{ channel_id: legacyArchiveChannelId(PRIVATE_JOB) }])
  })

  it("refuses a staff-only project until the pre-check shows its switch on", () => {
    const unverified = parsePrecheck({ schema: PRECHECK_SCHEMA, staffOnlyProjectIds: [], privateArchiveJobIds: [PRIVATE_JOB] })
    const { plan } = run(db, [captured("2001", { btJobId: HOLD_JOB, btThreadId: "9201" }), thread("9201", 1, HOLD_JOB)], { precheck: unverified })
    expect(plan.threads).toHaveLength(0)
    expect(plan.reviews).toEqual([expect.objectContaining({ reason: "staff_only_not_verified", projectId: STAFF_ONLY_PROJECT })])
  })

  it("emits no outside memberships on a staff-only project, and its SQL needs the switch still on", () => {
    const { built } = run(db, [captured("2001", { btJobId: HOLD_JOB, btThreadId: "9201" }), thread("9201", 1, HOLD_JOB)])
    const sql = built.batches.flatMap((batch) => batch.statements).join("\n")
    expect(sql).not.toContain("user-owner', 'member'")
    expect(all(db, `SELECT user_id FROM channel_members WHERE channel_id = '${conversationId(ORG, "9201")}'`).map((row) => row.user_id)).toEqual([ACTOR])
    // Re-run against a database where the switch was turned off: nothing new is written.
    const fresh = migratedDatabase()
    seed(fresh)
    fresh.exec(`UPDATE projects SET imported_conversations_staff_only = 0 WHERE id = '${STAFF_ONLY_PROJECT}'`)
    for (const batch of built.batches) fresh.exec(batch.statements.join("\n"))
    expect(count(fresh, `SELECT COUNT(*) AS n FROM channels WHERE id = '${conversationId(ORG, "9201")}'`)).toBe(0)
  })

  it("is idempotent: a second run adds nothing", () => {
    const lines = [captured("1001"), captured("1002", { attachments: [{ btAttachmentId: "51", fileName: "p.jpg", mimeType: "image/jpeg", sizeBytes: 10, sha256: SHA_B }] }), thread("9001", 2)]
    run(db, lines)
    const tables = ["channels", "messages", "channel_members", "channel_read_state", "message_attachments", "project_source_record_participants", "project_contacts"]
    const before = tables.map((table) => count(db, `SELECT COUNT(*) AS n FROM ${table}`))
    run(db, lines)
    expect(tables.map((table) => count(db, `SELECT COUNT(*) AS n FROM ${table}`))).toEqual(before)
  })

  it("writes no notifications, emails, mentions or unread counts", () => {
    const { built } = run(db, [captured("1001"), thread("9001", 1)])
    const sql = [...built.batches.flatMap((batch) => batch.statements), ...built.tail].join("\n")
    expect(sql).not.toMatch(/notification|email_outbox|message_mentions|push_|sms_/i)
    expect(count(db, `SELECT COUNT(*) AS n FROM channel_read_state WHERE unread_count <> 0`)).toBe(0)
  })

  it("matches people only by exact Buildertrend participant ids; others go to review", () => {
    const stranger = { participantId: "99", namespace: "owner", role: "Owner", displayName: "Olive Owner" }
    const { plan } = run(db, [captured("1001", { recipients: [{ ...stranger, kind: "to" }] }), thread("9001", 1)])
    // Same display name as a mapped owner, but a different id: never matched.
    expect(plan.threads).toHaveLength(0)
    expect(plan.reviews).toEqual([expect.objectContaining({ reason: "participant_unmatched", participant: "owner:99" })])
    expect(count(db, `SELECT COUNT(*) AS n FROM messages WHERE source_system = 'buildertrend'`)).toBe(0)
    // The unreviewed message stays in the staff archive.
    expect(count(db, `SELECT COUNT(*) AS n FROM messages WHERE channel_id = '${legacyArchiveChannelId(JOB)}'`)).toBe(1)
  })

  it("adds unknown participants as directory contacts without inviting them", () => {
    run(db, [captured("1001", { sender: newOwner, recipients: [{ ...staff, kind: "to" }] }), thread("9001", 1)])
    const contacts = all(db, `SELECT display_name, email, owner_portal_visible FROM project_contacts WHERE source_system = 'buildertrend'`)
    expect(contacts).toEqual([{ display_name: "Oscar Owner", email: "oscar@example.com", owner_portal_visible: 0 }])
    expect(count(db, `SELECT COUNT(*) AS n FROM project_access_invitations`)).toBe(0)
    const imported = all(db, `SELECT user_id, imported_sender_contact_id FROM messages WHERE source_system = 'buildertrend'`)[0]
    expect(imported?.user_id).toBe(ACTOR)
    expect(imported?.imported_sender_contact_id).not.toBeNull()
  })

  it("reuses a stored file with the same sha256 instead of keeping a second copy", () => {
    run(db, [captured("1001", { attachments: [
      { btAttachmentId: "51", fileName: "dup.jpg", mimeType: "image/jpeg", sizeBytes: 10, sha256: SHA_A },
      { btAttachmentId: "52", fileName: "new.jpg", mimeType: "image/jpeg", sizeBytes: 12, sha256: SHA_B },
    ] }), thread("9001", 1)])
    const rows = all(db, `SELECT source_attachment_id, r2_path FROM message_attachments WHERE source_attachment_id IS NOT NULL ORDER BY source_attachment_id`)
    expect(rows).toEqual([
      { source_attachment_id: "51", r2_path: "drive-existing" },
      { source_attachment_id: "52", r2_path: "drive-new" },
    ])
  })

  it("reuses a stored file only when sha256 and byte size match, in the same audience", () => {
    run(db, [
      // Same hash, different size: not the same file.
      captured("1001", { attachments: [{ btAttachmentId: "61", fileName: "a.jpg", mimeType: "image/jpeg", sizeBytes: 11, sha256: SHA_A }] }), thread("9001", 1),
      // Same hash and size, but a staff-only thread: the owner-channel file is not reused.
      captured("1101", { btThreadId: "9002", recipients: [{ ...staff, kind: "to" }], attachments: [{ btAttachmentId: "62", fileName: "b.jpg", mimeType: "image/jpeg", sizeBytes: 10, sha256: SHA_A }] }), thread("9002", 1),
    ])
    expect(count(db, `SELECT COUNT(*) AS n FROM message_attachments WHERE source_attachment_id IN ('61', '62')`)).toBe(0)
  })

  it("treats a message without a thread id as its own conversation", () => {
    const line = JSON.parse(captured("1301"))
    delete line.btThreadId
    const { plan } = run(db, [JSON.stringify(line)])
    expect(plan.pending).toEqual([])
    expect(plan.threads).toEqual([expect.objectContaining({ btThreadId: "msg-1301" })])
    expect(all(db, `SELECT source_thread_id FROM channels WHERE id = '${conversationId(ORG, "msg-1301")}'`)).toEqual([{ source_thread_id: "msg-1301" }])
  })

  it("never merges a message without a thread id into a real thread with the same number", () => {
    const own = JSON.parse(captured("1301"))
    own.btThreadId = null
    const { plan } = run(db, [JSON.stringify(own), captured("1401", { btThreadId: "1301" }), thread("1301", 1)])
    expect(plan.threads.map((item: Row) => item.btThreadId).sort()).toEqual(["1301", "msg-1301"])
    expect(count(db, `SELECT COUNT(*) AS n FROM channels WHERE source_thread_id IN ('1301', 'msg-1301')`)).toBe(2)
    expect(() => parseCapture(captured("1501", { btThreadId: "msg-9" }))).toThrow(/reserved/)
  })

  it("keeps a thread with both owners and vendors internal: staff-only, no outside members", () => {
    const { plan, built } = run(db, [captured("1001", { recipients: [{ ...owner, kind: "to" }, { ...vendor, kind: "cc" }] }), thread("9001", 1)])
    expect(plan.reviews).toEqual([])
    expect(plan.threads).toEqual([expect.objectContaining({ audience: "staff", mixedKeptInternal: true })])
    const channelId = conversationId(ORG, "9001")
    expect(all(db, `SELECT audience FROM channels WHERE id = '${channelId}'`)).toEqual([{ audience: "staff" }])
    expect(all(db, `SELECT user_id FROM channel_members WHERE channel_id = '${channelId}'`).map((row) => row.user_id)).toEqual([ACTOR])
    expect(all(db, `SELECT source_system FROM messages WHERE id = '${legacyArchiveMessageId(JOB, "1001")}'`)).toEqual([{ source_system: "buildertrend" }])
    // The owner keeps the copy they can already see.
    expect(built.tail.some((statement: string) => statement.startsWith("DELETE"))).toBe(false)
    expect(count(db, `SELECT COUNT(*) AS n FROM messages WHERE id = '${legacyOwnerHistoryMessageId(JOB, "1001")}'`)).toBe(1)
  })

  it("holds threads that use Bcc or are incomplete", () => {
    const { plan } = run(db, [
      captured("1101", { btThreadId: "9002", recipients: [{ ...owner, kind: "bcc" }] }), thread("9002", 1),
      captured("1201", { btThreadId: "9003" }), thread("9003", 2),
    ])
    expect(plan.threads).toHaveLength(0)
    expect(plan.reviews.map((item: Row) => item.reason)).toEqual(["bcc_recipient"])
    expect(plan.pending).toEqual([expect.objectContaining({ reason: "thread_incomplete", btThreadId: "9003" })])
  })

  it("keeps every statement within the D1 value limit and reads displayed dates", () => {
    const { built } = run(db, [captured("1001"), thread("9001", 1)])
    for (const statement of built.batches.flatMap((batch) => batch.statements)) {
      expect(statementValueCount(statement)).toBeLessThanOrEqual(100)
    }
    expect(sentAtIso("Jan 15, 2025 9:05 AM", "America/Denver")).toBe("2025-01-15T16:05:00.000Z")
    expect(sentAtIso("not a date", "America/Denver")).toBeNull()
  })
})
