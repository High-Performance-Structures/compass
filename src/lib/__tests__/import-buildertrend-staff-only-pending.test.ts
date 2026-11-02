import Database from "better-sqlite3"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { beforeEach, describe, expect, it } from "vitest"

import { drizzleOverSqlite } from "../../../__tests__/helpers/correspondence-core"
import {
  CAPTURE_SCHEMA,
  PARTICIPANT_MAP_SCHEMA,
  PRECHECK_SCHEMA,
  buildBatches,
  conversationId,
  parseCapture,
  parseParticipantMap,
  parsePrecheck,
  planImport,
} from "../../../scripts/import-buildertrend-messages.mjs"
import { createParticipantResolver } from "../../../scripts/import-buildertrend-participants.mjs"
import { canAccessImportedConversation } from "@/lib/conversations/channel-access"
import { planImportedThreadShare, shareImportedThread } from "@/lib/domain/conversations/imported-sharing"

/*
 * Owner decision 2026-11-02: a thread whose only problems are people who
 * could not be identified exactly is imported now, staff-only, and flagged;
 * staff later open it to the owner or vendor. Other problems still hold it.
 */

type Sqlite = InstanceType<typeof Database>

const ORG = "org-1"
const PROJECT = "proj-1"
const HOLD_PROJECT = "proj-hold"
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

const staff = { participantId: "1", namespace: "builder", displayName: "Pat PM" }
const owner = { participantId: "2", namespace: "owner", displayName: "Olive Owner" }
const vendor = { participantId: "4", namespace: "sub", displayName: "Val Vendor" }
const stranger = { participantId: "99", namespace: "owner", displayName: "Someone Unknown" }

const resolve = createParticipantResolver({
  participantMap: parseParticipantMap({
    schema: PARTICIPANT_MAP_SCHEMA,
    participants: {
      "builder:1": { decision: "user", kind: "staff", userId: "u-pm" },
      "owner:2": { decision: "user", kind: "owner", userId: "u-owner" },
      "sub:4": { decision: "user", kind: "vendor", userId: "u-vendor" },
    },
  }),
  directory: null,
  catalog: [],
  organizationId: ORG,
})

function message(id: string, job: string, overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    schema: CAPTURE_SCHEMA, type: "message", btJobId: job, btThreadId: `9${id}`, btMessageId: id, subject: "Tile", body: `Body ${id}`,
    sentAtDisplay: "Oct 3, 2025 4:12 PM", sender: staff,
    recipients: [{ ...owner, kind: "to" }, { ...stranger, kind: "cc" }], attachments: [], ...overrides,
  })
}

function thread(id: string, job: string): string {
  return JSON.stringify({ schema: CAPTURE_SCHEMA, type: "thread", btJobId: job, btThreadId: `9${id}`, messageCount: 1 })
}

describe("threads with unidentified people import staff-only", () => {
  let sqlite: Sqlite
  beforeEach(() => {
    sqlite = migrated()
    sqlite.exec(`
      INSERT INTO organizations (id, name, slug, type, is_active, created_at, updated_at) VALUES ('${ORG}', 'Org', 'org', 'internal', 1, '${NOW}', '${NOW}');
      INSERT INTO users (id, email, role, is_active, created_at, updated_at) VALUES
        ('u-pm', 'pm@example.com', 'project_manager', 1, '${NOW}', '${NOW}'),
        ('u-owner', 'owner@example.com', 'client', 1, '${NOW}', '${NOW}'),
        ('u-vendor', 'vendor@example.com', 'subcontractor', 1, '${NOW}', '${NOW}');
      INSERT INTO projects (id, name, organization_id, created_at, imported_conversations_staff_only) VALUES
        ('${PROJECT}', 'P', '${ORG}', '${NOW}', 0), ('${HOLD_PROJECT}', 'H', '${ORG}', '${NOW}', 1);
    `)
  })

  function run(lines: readonly string[]) {
    const plan = planImport({
      capture: parseCapture(lines.join("\n")),
      resolveParticipant: resolve,
      precheck: parsePrecheck({ schema: PRECHECK_SCHEMA, staffOnlyProjectIds: [HOLD_PROJECT], privateArchiveJobIds: [] }),
      projects: { "101": PROJECT, "202": HOLD_PROJECT },
      timeZone: "America/Denver",
      organizationId: ORG,
    })
    const built = buildBatches(plan, { actorUserId: "u-pm", now: NOW, driveFiles: new Map(), batchSize: 40 })
    for (const batch of built.batches) sqlite.exec(batch.statements.join("\n"))
    return plan
  }

  const rows = (query: string) => sqlite.prepare(query).all()

  it("imports the thread staff-only, records identified people, and flags it for review", () => {
    const plan = run([message("1", "101"), thread("1", "101")])
    const channelId = conversationId(ORG, "91")
    expect(plan.imported_staff_only_pending_identity).toBe(1)
    expect(plan.reviews).toEqual([expect.objectContaining({
      reason: "staff_only_pending_identity", channelId,
      unresolved: [expect.objectContaining({ reason: "participant_unmatched", literalSha256: expect.stringMatching(/^[0-9a-f]{64}$/) })],
    })])
    expect(rows(`SELECT audience FROM channels WHERE id = '${channelId}'`)).toEqual([{ audience: "staff" }])
    // Staff join; the identified owner is recorded but gets no membership yet.
    expect(rows(`SELECT user_id FROM channel_members WHERE channel_id = '${channelId}'`)).toEqual([{ user_id: "u-pm" }])
    expect(rows(`SELECT participant_role, user_id FROM project_source_record_participants WHERE source_record_type = 'buildertrend_message_thread' AND user_id = 'u-owner'`))
      .toEqual([{ participant_role: "owner", user_id: "u-owner" }])
  })

  it("keeps an unidentified sender's name exactly as shown", () => {
    run([message("2", "101", { sender: stranger, recipients: [{ ...staff, kind: "to" }] }), thread("2", "101")])
    expect(rows(`SELECT user_id, source_sender_label_snapshot FROM messages WHERE source_message_id = '2'`))
      .toEqual([{ user_id: "u-pm", source_sender_label_snapshot: "Someone Unknown" }])
  })

  it("still holds a thread for other reasons, such as an unverified attachment", () => {
    const plan = run([message("3", "101", { attachments: [{ btAttachmentId: "5", fileName: "a.jpg", sizeBytes: 1 }] }), thread("3", "101")])
    expect(plan.threads).toEqual([])
    expect(plan.imported_staff_only_pending_identity).toBe(0)
    expect(plan.reviews.map((item: { reason: string }) => item.reason).sort()).toEqual(["attachment_unverified", "participant_unmatched"])
    expect(rows(`SELECT COUNT(*) AS n FROM channels WHERE id = '${conversationId(ORG, "93")}'`)).toEqual([{ n: 0 }])
  })

  it("lets staff share it with the owner once confirmed, silently, and the owner can then open it", async () => {
    run([message("1", "101"), thread("1", "101")])
    const db = drizzleOverSqlite(sqlite)
    const channelId = conversationId(ORG, "91")
    const imported = { sourceSystem: "buildertrend", projectStaffOnly: false }
    expect(canAccessImportedConversation({ hasMembership: false, audience: "staff", role: "client", imported })).toBe(false)

    const preview = await planImportedThreadShare({ db, channelId, organizationId: ORG, actorRole: "project_manager", audience: "clients" })
    expect(preview).toMatchObject({ ok: true, people: [{ userId: "u-owner" }] })
    const shared = await shareImportedThread({ db, channelId, organizationId: ORG, actorRole: "project_manager", audience: "clients", now: NOW })
    expect(shared.ok).toBe(true)
    expect(rows(`SELECT audience FROM channels WHERE id = '${channelId}'`)).toEqual([{ audience: "clients" }])
    expect(rows(`SELECT user_id FROM channel_members WHERE channel_id = '${channelId}' ORDER BY user_id`)).toEqual([{ user_id: "u-owner" }, { user_id: "u-pm" }])
    expect(rows(`SELECT unread_count FROM channel_read_state WHERE channel_id = '${channelId}' AND user_id = 'u-owner'`)).toEqual([{ unread_count: 0 }])
    expect(rows("SELECT COUNT(*) AS n FROM notification_events")).toEqual([{ n: 0 }])
    expect(canAccessImportedConversation({ hasMembership: true, audience: "clients", role: "client", imported })).toBe(true)
    // A second request is refused: it is already shared.
    expect(await shareImportedThread({ db, channelId, organizationId: ORG, actorRole: "project_manager", audience: "clients", now: NOW }))
      .toEqual({ ok: false, error: "This conversation is already shared." })
  })

  it("refuses non-staff, legal-hold projects, mixed threads and an audience nobody was identified for", async () => {
    run([
      message("1", "101"), thread("1", "101"),
      message("4", "202"), thread("4", "202"),
      message("5", "101", { recipients: [{ ...owner, kind: "to" }, { ...vendor, kind: "to" }, { ...stranger, kind: "cc" }] }), thread("5", "101"),
    ])
    const db = drizzleOverSqlite(sqlite)
    const share = (channel: string, actorRole: string, audience: "clients" | "sub_vendors") =>
      planImportedThreadShare({ db, channelId: conversationId(ORG, channel), organizationId: ORG, actorRole, audience })
    expect(await share("91", "client", "clients")).toEqual({ ok: false, error: "Only staff can share an imported conversation." })
    expect(await share("94", "project_manager", "clients")).toEqual({ ok: false, error: "This project keeps imported conversations staff-only." })
    expect(await share("95", "project_manager", "clients")).toEqual({ ok: false, error: "This conversation includes both owners and vendors, so it stays internal." })
    expect(await share("91", "project_manager", "sub_vendors")).toEqual({ ok: false, error: "No vendor in this conversation has been identified yet." })
  })
})
