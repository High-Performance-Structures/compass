import Database from "better-sqlite3"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { beforeEach, describe, expect, it } from "vitest"

import {
  CAPTURE_SCHEMA,
  PRECHECK_SCHEMA,
  buildBatches,
  conversationId,
  isHoldingReview,
  parseCapture,
  parsePrecheck,
  planImport,
} from "../../../scripts/import-buildertrend-messages.mjs"
import {
  DIRECTORY_SCHEMA,
  createParticipantResolver,
  parseDirectory,
  parsePeopleCatalog,
} from "../../../scripts/import-buildertrend-participants.mjs"

/*
 * Owner rules: exact-only identity, never guess; nothing reaches an outside
 * audience until staff verify. A proven single participant that matches more
 * than one exact candidate (participant_ambiguous) imports STAFF-ONLY, kept
 * exactly as shown: joined to no candidate and never turned into a new
 * contact. An undivided literal whose person boundaries are unproven still
 * holds its thread.
 */

type Sqlite = InstanceType<typeof Database>

const ORG = "org-1"
const PROJECT = "proj-1"
const NOW = "2026-11-02T00:00:00.000Z"

function migrated(): Sqlite {
  const sqlite = new Database(":memory:")
  const dir = join(process.cwd(), "drizzle")
  for (const file of readdirSync(dir).filter((name) => /^\d{4}_.*\.sql$/.test(name)).sort()) {
    sqlite.exec(readFileSync(join(dir, file), "utf8").replaceAll("--> statement-breakpoint", ""))
  }
  sqlite.exec("PRAGMA foreign_keys = ON")
  return sqlite
}

const directory = parseDirectory({
  schema: DIRECTORY_SCHEMA,
  people: [
    { personKey: "user:u-pm", kind: "staff", userId: "u-pm", displayName: "Pat PM", emails: ["pm@example.com"], projectIds: [PROJECT] },
    { personKey: "user:u-owner", kind: "owner", userId: "u-owner", displayName: "Olive Owner", emails: ["owner@example.com"], projectIds: [PROJECT] },
    // Two exact candidates for "Sam Smith" on the project: one account, one contact.
    { personKey: "user:u-sam1", kind: "owner", userId: "u-sam1", displayName: "Sam Smith", emails: [], projectIds: [PROJECT] },
    { personKey: "contact:sam2", kind: "vendor", displayName: "Sam Smith", emails: [], projectContactIds: { [PROJECT]: "pc-sam2" } },
    // Two exact candidates for one shared email.
    { personKey: "contact:front1", kind: "vendor", displayName: "Front One", emails: ["office@shared.example"], projectContactIds: { [PROJECT]: "pc-front1" } },
    { personKey: "contact:front2", kind: "vendor", displayName: "Front Two", emails: ["office@shared.example"], projectContactIds: { [PROJECT]: "pc-front2" } },
    // "Smith" and "John" are people too, so the literal "Smith, John" splits two ways.
    { personKey: "user:u-john", kind: "owner", userId: "u-john", displayName: "Smith, John", emails: [], projectIds: [PROJECT] },
    { personKey: "user:u-smith", kind: "owner", userId: "u-smith", displayName: "Smith", emails: [], projectIds: [PROJECT] },
    { personKey: "user:u-john2", kind: "owner", userId: "u-john2", displayName: "John", emails: [], projectIds: [PROJECT] },
  ],
})
const resolve = createParticipantResolver({ participantMap: new Map(), directory, catalog: parsePeopleCatalog(""), organizationId: ORG })

const pm = { namespace: "builder", displayName: "Pat PM", email: "pm@example.com" }
const olive = { namespace: "owner", displayName: "Olive Owner" }
const sam = { namespace: "owner", displayName: "Sam Smith" }

function message(id: string, overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    schema: CAPTURE_SCHEMA, type: "message", btJobId: "101", btThreadId: `9${id}`, btMessageId: id, subject: "Tile", body: `Body ${id}`,
    sentAtDisplay: "Oct 3, 2025 4:12 PM", sender: pm, recipients: [{ ...olive, kind: "to" }], attachments: [], ...overrides,
  })
}

function thread(id: string): string {
  return JSON.stringify({ schema: CAPTURE_SCHEMA, type: "thread", btJobId: "101", btThreadId: `9${id}`, messageCount: 1 })
}

describe("participants matching several exact candidates import staff-only", () => {
  let sqlite: Sqlite
  beforeEach(() => {
    sqlite = migrated()
    sqlite.exec(`
      INSERT INTO organizations (id, name, slug, type, is_active, created_at, updated_at) VALUES ('${ORG}', 'Org', 'org', 'internal', 1, '${NOW}', '${NOW}');
      INSERT INTO users (id, email, role, is_active, created_at, updated_at) VALUES
        ('u-pm', 'pm@example.com', 'project_manager', 1, '${NOW}', '${NOW}'),
        ('u-owner', 'owner@example.com', 'client', 1, '${NOW}', '${NOW}'),
        ('u-sam1', 'sam@example.com', 'client', 1, '${NOW}', '${NOW}');
      INSERT INTO projects (id, name, organization_id, created_at, imported_conversations_staff_only) VALUES ('${PROJECT}', 'P', '${ORG}', '${NOW}', 0);
    `)
  })

  function plan(lines: readonly string[]) {
    return planImport({
      capture: parseCapture(lines.join("\n")),
      resolveParticipant: resolve,
      precheck: parsePrecheck({ schema: PRECHECK_SCHEMA, staffOnlyProjectIds: [], privateArchiveJobIds: [] }),
      projects: { "101": PROJECT },
      timeZone: "America/Denver",
      organizationId: ORG,
    })
  }

  function run(lines: readonly string[]) {
    const result = plan(lines)
    const built = buildBatches(result, { actorUserId: "u-pm", now: NOW, driveFiles: new Map(), batchSize: 40 })
    for (const batch of built.batches) sqlite.exec(batch.statements.join("\n"))
    return { result, built }
  }

  const rows = (query: string) => sqlite.prepare(query).all()

  it("imports an ambiguous recipient staff-only, keeps the literal, attaches no candidate and creates no contact", () => {
    const { result } = run([
      message("1", { recipients: [{ ...olive, kind: "to" }, { ...sam, kind: "cc" }, { namespace: "sub", email: "Office@Shared.example", kind: "cc" }] }),
      thread("1"),
    ])
    const channelId = conversationId(ORG, "91")
    expect(result.threads).toEqual([expect.objectContaining({ audience: "staff", pendingIdentity: true })])
    expect(result.imported_staff_only_pending_identity).toBe(1)
    expect(result.imported_staff_only_ambiguous).toBe(1)
    expect(result.reviews).toEqual([expect.objectContaining({
      reason: "staff_only_pending_identity", channelId,
      unresolved: [expect.objectContaining({ reason: "participant_ambiguous" }), expect.objectContaining({ reason: "participant_ambiguous" })],
    })])
    expect(result.reviews.filter(isHoldingReview)).toEqual([])
    expect(result.matches).toMatchObject({ review: 2, new_person_by_email: 0, new_person_by_name: 0 })

    expect(rows(`SELECT audience FROM channels WHERE id = '${channelId}'`)).toEqual([{ audience: "staff" }])
    expect(rows(`SELECT user_id FROM channel_members WHERE channel_id = '${channelId}'`)).toEqual([{ user_id: "u-pm" }])
    // No new contact for an ambiguous literal (Olive has an account, so none at all).
    expect(rows("SELECT COUNT(*) AS n FROM project_contacts")).toEqual([{ n: 0 }])
    // The literals are kept exactly as shown, unresolved, linked to nobody.
    expect(rows(`SELECT source_participant_id, source_contact_name, participant_role, project_contact_id, user_id, identity_status, review_status, active
      FROM project_source_record_participants WHERE source_record_type = 'buildertrend_message' AND identity_status = 'unmatched' ORDER BY source_participant_id`))
      .toEqual([
        { source_participant_id: "owner:name:sam smith", source_contact_name: "Sam Smith", participant_role: "cc", project_contact_id: null, user_id: null, identity_status: "unmatched", review_status: "unreviewed", active: 0 },
        { source_participant_id: "sub:email:office@shared.example", source_contact_name: null, participant_role: "cc", project_contact_id: null, user_id: null, identity_status: "unmatched", review_status: "unreviewed", active: 0 },
      ])
    expect(rows(`SELECT COUNT(*) AS n FROM project_source_record_participants WHERE user_id = 'u-sam1' OR project_contact_id IN ('pc-sam2', 'pc-front1', 'pc-front2')`)).toEqual([{ n: 0 }])
  })

  it("shows an ambiguous sender by the label as shown, with no contact link", () => {
    const { result } = run([message("2", { sender: sam, recipients: [{ ...pm, kind: "to" }] }), thread("2")])
    expect(result.imported_staff_only_ambiguous).toBe(1)
    expect(rows(`SELECT user_id, imported_sender_contact_id, source_sender_label_snapshot FROM messages WHERE source_message_id = '2'`))
      .toEqual([{ user_id: "u-pm", imported_sender_contact_id: null, source_sender_label_snapshot: "Sam Smith" }])
    expect(rows(`SELECT user_id, project_contact_id, identity_status FROM project_source_record_participants WHERE source_record_type = 'buildertrend_message' AND participant_role = 'sender'`))
      .toEqual([{ user_id: null, project_contact_id: null, identity_status: "unmatched" }])
  })

  it("keeps a thread with an exact owner and an ambiguous person staff-only; only the zero-match person becomes a contact", () => {
    const { result } = run([
      message("3", { recipients: [{ ...olive, kind: "to" }, { ...sam, kind: "cc" }, { namespace: "owner", displayName: "Someone Unknown", kind: "cc" }] }),
      thread("3"),
    ])
    const channelId = conversationId(ORG, "93")
    // Without the ambiguous and unknown people this would be an owner thread.
    expect(result.threads).toEqual([expect.objectContaining({ audience: "staff", pendingIdentity: true })])
    expect(result.imported_staff_only_ambiguous).toBe(1)
    expect(result.reviews).toEqual([expect.objectContaining({
      reason: "staff_only_pending_identity",
      unresolved: expect.arrayContaining([expect.objectContaining({ reason: "new_unassigned_person" }), expect.objectContaining({ reason: "participant_ambiguous" })]),
    })])
    expect(rows(`SELECT user_id FROM channel_members WHERE channel_id = '${channelId}'`)).toEqual([{ user_id: "u-pm" }])
    expect(rows("SELECT display_name FROM project_contacts")).toEqual([{ display_name: "Someone Unknown" }])
    // The exact owner is recorded on the thread but gets no membership yet.
    expect(rows(`SELECT user_id FROM project_source_record_participants WHERE source_record_type = 'buildertrend_message_thread' AND user_id IS NOT NULL ORDER BY user_id`))
      .toEqual([{ user_id: "u-owner" }, { user_id: "u-pm" }])
  })

  it("still holds an undivided literal whose person boundaries are unproven", () => {
    const undivided = (literal: string) => ({ namespace: "owner", displayName: literal, kind: "to", requiresReview: true, participantBoundaryProven: false })
    const { result } = run([
      message("4", { recipients: [undivided("Smith, John")] }), thread("4"),
      message("5", { recipients: [undivided("Olive Owner, Bob")] }), thread("5"),
      message("6", { sender: { namespace: "builder", displayName: "Pat PM, Olive Owner", requiresReview: true }, recipients: [{ ...olive, kind: "to" }] }), thread("6"),
    ])
    expect(result.threads).toEqual([])
    expect(result.imported_staff_only_ambiguous).toBe(0)
    expect(result.reviews).toEqual([
      expect.objectContaining({ reason: "participant_boundary_unproven", btThreadId: "94", hold: true, split: "several" }),
      expect.objectContaining({ reason: "participant_boundary_unproven", btThreadId: "95", hold: true, split: "none" }),
      expect.objectContaining({ reason: "participant_boundary_unproven", btThreadId: "96", hold: true, split: "sender_several" }),
    ])
    expect(result.reviews.every(isHoldingReview)).toBe(true)
    expect(rows("SELECT COUNT(*) AS n FROM channels")).toEqual([{ n: 0 }])
  })

  it("leaves attachment holds unchanged and does not count the ambiguous person as a hold", () => {
    const { result } = run([
      message("7", { recipients: [{ ...sam, kind: "to" }], attachments: [{ btAttachmentId: "5", fileName: "a.jpg", sizeBytes: 1 }] }),
      thread("7"),
    ])
    expect(result.threads).toEqual([])
    expect(result.reviews.filter(isHoldingReview).map((item: { reason: string }) => item.reason)).toEqual(["attachment_unverified"])
  })

  it("is idempotent: a re-run plans the same statements and adds no rows", () => {
    const lines = [message("8", { recipients: [{ ...olive, kind: "to" }, { ...sam, kind: "cc" }] }), thread("8")]
    const first = run(lines)
    const count = () => rows(`SELECT
      (SELECT COUNT(*) FROM channels) AS channels, (SELECT COUNT(*) FROM messages) AS messages,
      (SELECT COUNT(*) FROM channel_members) AS members, (SELECT COUNT(*) FROM project_contacts) AS contacts,
      (SELECT COUNT(*) FROM project_source_record_participants) AS participants`)
    const before = count()
    const second = run(lines)
    expect(second.built).toEqual(first.built)
    expect(count()).toEqual(before)
  })
})
