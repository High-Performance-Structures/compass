import Database from "better-sqlite3"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { drizzleOverSqlite } from "../../../../__tests__/helpers/correspondence-core"
import type { CorrespondenceContext } from "../access"
import { channelThreadConversationId } from "../channel-thread-id"

/*
 * Imported Buildertrend project conversations (channels) appear in the project
 * messages inbox as ordinary subjects. Checked against a database built from
 * every migration, through the same server actions the page uses.
 */

const mocks = vi.hoisted(() => ({ context: vi.fn(), sendMessage: vi.fn(), sendCorrespondence: vi.fn() }))
vi.mock("@/lib/correspondence/access", async (original) => {
  const actual = await original<typeof import("@/lib/correspondence/access")>()
  return { ...actual, correspondenceContext: mocks.context }
})
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))

import { getCorrespondenceDetail, getCorrespondenceInbox, markCorrespondenceOpened, saveCorrespondenceDraft, searchCorrespondence, setCorrespondenceState } from "@/app/actions/project-correspondence"
import { updateCorrespondenceInbox } from "@/app/actions/correspondence-inbox"
import { MessageCard } from "@/components/correspondence/correspondence-message-card"

type Sqlite = InstanceType<typeof Database>
type Viewer = "staff" | "owner" | "vendor" | "stranger"

const NOW = "2026-11-01T00:00:00.000Z"
const ORG = "org-1"
const OPEN = "proj-open"
const HOLD = "proj-hold"
const SNAPSHOT = "Oct 3, 2025 4:12 PM"

function migrated(): Sqlite {
  const sqlite = new Database(":memory:")
  const dir = join(process.cwd(), "drizzle")
  for (const file of readdirSync(dir).filter((name) => /^\d{4}_.*\.sql$/.test(name)).sort()) {
    sqlite.exec(readFileSync(join(dir, file), "utf8").replaceAll("--> statement-breakpoint", ""))
  }
  sqlite.exec("PRAGMA foreign_keys = ON")
  return sqlite
}

function channel(sqlite: Sqlite, values: { readonly id: string; readonly projectId: string; readonly name: string; readonly audience: string; readonly members: readonly string[]; readonly sourceSystem?: string | null }): void {
  sqlite.prepare(`INSERT INTO channels (id, name, type, organization_id, project_id, is_private, audience, created_by, sort_order, created_at, updated_at, source_system, source_thread_id)
    VALUES (?, ?, 'text', ?, ?, 1, ?, 'user-staff', 0, ?, ?, ?, ?)`).run(values.id, values.name, ORG, values.projectId, values.audience, NOW, NOW, values.sourceSystem === undefined ? "buildertrend" : values.sourceSystem, values.sourceSystem === null ? null : `thread-${values.id}`)
  for (const userId of values.members) {
    sqlite.prepare("INSERT INTO channel_members (id, channel_id, user_id, joined_at) VALUES (?, ?, ?, ?)").run(`cm-${values.id}-${userId}`, values.id, userId, NOW)
  }
}

function message(sqlite: Sqlite, values: { readonly id: string; readonly channelId: string; readonly userId: string; readonly content: string; readonly createdAt: string; readonly imported: boolean; readonly contactId?: string }): void {
  sqlite.prepare(`INSERT INTO messages (id, channel_id, user_id, content, is_pinned, reply_count, created_at, source_system, source_message_id, source_sent_at_snapshot, imported_sender_contact_id)
    VALUES (?, ?, ?, ?, 0, 0, ?, ?, ?, ?, ?)`).run(values.id, values.channelId, values.userId, values.content, values.createdAt,
    values.imported ? "buildertrend" : null, values.imported ? `bt-${values.id}` : null, values.imported ? SNAPSHOT : null, values.contactId ?? null)
}

function seed(sqlite: Sqlite): void {
  sqlite.exec(`
    INSERT INTO organizations (id, name, slug, type, is_active, created_at, updated_at) VALUES ('${ORG}', 'Org', 'org', 'internal', 1, '${NOW}', '${NOW}');
    INSERT INTO users (id, email, display_name, role, is_active, created_at, updated_at) VALUES
      ('user-staff', 'pm@example.com', 'Pat PM', 'project_manager', 1, '${NOW}', '${NOW}'),
      ('user-owner', 'owner@example.com', 'Olive Owner', 'client', 1, '${NOW}', '${NOW}'),
      ('user-vendor', 'vendor@example.com', 'Vic Vendor', 'subcontractor', 1, '${NOW}', '${NOW}'),
      ('user-stranger', 'stranger@example.com', 'Sam Stranger', 'client', 1, '${NOW}', '${NOW}');
    INSERT INTO organization_members (id, organization_id, user_id, role, joined_at) VALUES
      ('om-staff', '${ORG}', 'user-staff', 'project_manager', '${NOW}'),
      ('om-owner', '${ORG}', 'user-owner', 'client', '${NOW}'),
      ('om-vendor', '${ORG}', 'user-vendor', 'subcontractor', '${NOW}'),
      ('om-stranger', '${ORG}', 'user-stranger', 'client', '${NOW}');
    INSERT INTO projects (id, name, organization_id, created_at, imported_conversations_staff_only) VALUES
      ('${OPEN}', 'Stockbridge', '${ORG}', '${NOW}', 0), ('${HOLD}', 'Forest Lakes', '${ORG}', '${NOW}', 1);
    INSERT INTO project_members (id, project_id, user_id, role, assigned_at) VALUES
      ('pm-owner-open', '${OPEN}', 'user-owner', 'owner', '${NOW}'),
      ('pm-vendor-open', '${OPEN}', 'user-vendor', 'subcontractor', '${NOW}'),
      ('pm-stranger-open', '${OPEN}', 'user-stranger', 'owner', '${NOW}'),
      ('pm-owner-hold', '${HOLD}', 'user-owner', 'owner', '${NOW}');
    INSERT INTO project_contacts (id, project_id, contact_type, source_system, display_name, created_at, updated_at)
      VALUES ('contact-tile', '${OPEN}', 'vendor', 'buildertrend', 'Tina Tile', '${NOW}', '${NOW}');
  `)
  channel(sqlite, { id: "bt-thread-owner", projectId: OPEN, name: "Kitchen tile", audience: "clients", members: ["user-staff", "user-owner"] })
  message(sqlite, { id: "m-owner-1", channelId: "bt-thread-owner", userId: "user-owner", content: "Is the grout color final?", createdAt: "2025-10-03T22:12:00.000Z", imported: true })
  message(sqlite, { id: "m-owner-2", channelId: "bt-thread-owner", userId: "user-staff", content: "Yes, warm gray.", createdAt: "2025-10-04T15:00:00.000Z", imported: true })
  sqlite.exec(`INSERT INTO channel_read_state (id, user_id, channel_id, last_read_at, unread_count) VALUES ('rs-owner', 'user-owner', 'bt-thread-owner', '${NOW}', 2)`)
  channel(sqlite, { id: "bt-thread-vendor", projectId: OPEN, name: "Tile delivery", audience: "sub_vendors", members: ["user-staff", "user-vendor"] })
  message(sqlite, { id: "m-vendor-1", channelId: "bt-thread-vendor", userId: "user-staff", content: "Pallets arrive Tuesday.", createdAt: "2025-10-05T15:00:00.000Z", imported: true, contactId: "contact-tile" })
  channel(sqlite, { id: "bt-thread-internal", projectId: OPEN, name: "Owner and tile sub", audience: "staff", members: ["user-staff"] })
  message(sqlite, { id: "m-internal-1", channelId: "bt-thread-internal", userId: "user-staff", content: "Internal grout note", createdAt: "2025-10-06T15:00:00.000Z", imported: true })
  channel(sqlite, { id: "bt-thread-hold", projectId: HOLD, name: "Defect list", audience: "clients", members: ["user-staff", "user-owner"] })
  message(sqlite, { id: "m-hold-1", channelId: "bt-thread-hold", userId: "user-owner", content: "Grout cracked", createdAt: "2025-10-07T15:00:00.000Z", imported: true })
  // An ordinary project channel stays behind "Existing channels and direct messages".
  channel(sqlite, { id: "project-owner-proj-open", projectId: OPEN, name: "Owner Team", audience: "clients", members: ["user-staff", "user-owner"], sourceSystem: null })
  message(sqlite, { id: "m-team-1", channelId: "project-owner-proj-open", userId: "user-staff", content: "Grout delivery update", createdAt: "2025-10-08T15:00:00.000Z", imported: false })
}

const USER_IDS: Readonly<Record<Viewer, string>> = { staff: "user-staff", owner: "user-owner", vendor: "user-vendor", stranger: "user-stranger" }

function context(sqlite: Sqlite, viewer: Viewer, projectId: string = OPEN): CorrespondenceContext {
  const id = USER_IDS[viewer]
  return {
    db: drizzleOverSqlite(sqlite), env: {}, projectId, organizationId: ORG, projectName: projectId,
    workspace: viewer === "staff" ? "staff" : viewer === "vendor" ? "sub_vendor" : "owner",
    user: {
      id, email: `${id}@example.com`, firstName: null, lastName: null, displayName: id, avatarUrl: null,
      role: viewer === "staff" ? "project_manager" : viewer === "vendor" ? "subcontractor" : "client",
      googleEmail: null, isActive: true, lastLoginAt: null, organizationId: ORG, organizationName: "Org", organizationType: "internal", createdAt: NOW, updatedAt: NOW,
    },
  }
}

async function inboxSubjects(viewer: Viewer, projectId: string = OPEN): Promise<readonly string[]> {
  mocks.context.mockImplementation(async () => context(sqlite, viewer, projectId))
  const result = await getCorrespondenceInbox(projectId)
  if (!result.success) throw new Error(result.error)
  return result.data.conversations.map((conversation) => conversation.subject)
}

let sqlite: Sqlite

describe("imported project conversations in the project messages inbox", () => {
  beforeEach(() => {
    sqlite = migrated()
    seed(sqlite)
  })
  afterEach(() => {
    sqlite.close()
    vi.clearAllMocks()
  })

  it("lists every imported conversation on the project for staff, newest first, with the original sent date", async () => {
    mocks.context.mockImplementation(async () => context(sqlite, "staff"))
    const result = await getCorrespondenceInbox(OPEN)
    if (!result.success) throw new Error(result.error)
    expect(result.data.conversations.map((row) => row.subject)).toEqual(["Owner and tile sub", "Tile delivery", "Kitchen tile"])
    expect(result.data.conversations.find((row) => row.subject === "Kitchen tile")).toMatchObject({
      id: channelThreadConversationId("bt-thread-owner"),
      excerpt: "Yes, warm gray.",
      lastActivityAt: "2025-10-04T15:00:00.000Z",
      lastActivityDisplay: SNAPSHOT,
      origin: { kind: "channel", source: "buildertrend" },
      archived: false,
    })
  })

  it("shows owners and vendors only their own audience's threads", async () => {
    expect(await inboxSubjects("owner")).toEqual(["Kitchen tile"])
    expect(await inboxSubjects("vendor")).toEqual(["Tile delivery"])
    // A project owner who is not in the thread sees nothing.
    expect(await inboxSubjects("stranger")).toEqual([])
  })

  it("hides a staff-only project's imported conversations from outsiders, even members", async () => {
    expect(await inboxSubjects("owner", HOLD)).toEqual([])
    expect(await inboxSubjects("staff", HOLD)).toEqual(["Defect list"])
    mocks.context.mockImplementation(async () => context(sqlite, "owner", HOLD))
    const detail = await getCorrespondenceDetail(HOLD, channelThreadConversationId("bt-thread-hold"))
    expect(detail.success).toBe(false)
    const search = await searchCorrespondence(HOLD, "grout")
    expect(search.success && search.data.hits).toEqual([])
  })

  it("never opens another audience's thread by id", async () => {
    mocks.context.mockImplementation(async () => context(sqlite, "owner"))
    expect((await getCorrespondenceDetail(OPEN, channelThreadConversationId("bt-thread-vendor"))).success).toBe(false)
    expect((await getCorrespondenceDetail(OPEN, channelThreadConversationId("bt-thread-internal"))).success).toBe(false)
    expect((await getCorrespondenceDetail(OPEN, channelThreadConversationId("project-owner-proj-open"))).success).toBe(false)
  })

  it("opens the full thread in the right pane with source dates and the imported sender's name", async () => {
    mocks.context.mockImplementation(async () => context(sqlite, "staff"))
    const result = await getCorrespondenceDetail(OPEN, channelThreadConversationId("bt-thread-vendor"))
    if (!result.success) throw new Error(result.error)
    expect(result.data.draft).toBeNull()
    expect(result.data.messages).toEqual([expect.objectContaining({
      id: "m-vendor-1", sequence: 1, source: "buildertrend", delivery: "imported",
      authorName: "Tina Tile", authorUserId: null, body: "Pallets arrive Tuesday.",
      sentAt: "2025-10-05T15:00:00.000Z", sourceSentDisplay: SNAPSHOT, sourceSentAt: null, canEdit: false,
    })])
    const owner = await getCorrespondenceDetail(OPEN, channelThreadConversationId("bt-thread-owner"))
    if (!owner.success) throw new Error(owner.error)
    expect(owner.data.messages.map((row) => row.id)).toEqual(["m-owner-1", "m-owner-2"])
  })

  it("renders the [BT] source tag on imported messages", async () => {
    mocks.context.mockImplementation(async () => context(sqlite, "owner"))
    const result = await getCorrespondenceDetail(OPEN, channelThreadConversationId("bt-thread-owner"))
    if (!result.success) throw new Error(result.error)
    const first = result.data.messages[0]
    if (!first) throw new Error("missing message")
    const html = renderToStaticMarkup(createElement(MessageCard, {
      projectId: OPEN, message: first, viewerId: "user-owner", editDisabled: false,
      onEdit: async () => undefined, onRetract: () => undefined, onRetryEmail: async () => undefined,
    }))
    expect(html).toContain("[BT]")
    expect(html).toContain("Imported from Buildertrend")
    expect(html).toContain(SNAPSHOT)
  })

  it("finds imported conversations by subject and body, within the viewer's access", async () => {
    mocks.context.mockImplementation(async () => context(sqlite, "owner"))
    const bySubject = await searchCorrespondence(OPEN, "kitchen")
    expect(bySubject.success && bySubject.data.hits.map((hit) => hit.conversationId)).toEqual([
      channelThreadConversationId("bt-thread-owner"), channelThreadConversationId("bt-thread-owner"),
    ])
    const byBody = await searchCorrespondence(OPEN, "grout")
    expect(byBody.success && byBody.data.hits.map((hit) => [hit.messageId, hit.sourceSentDisplay])).toEqual([["m-owner-1", SNAPSHOT]])
    mocks.context.mockImplementation(async () => context(sqlite, "staff"))
    const staff = await searchCorrespondence(OPEN, "grout")
    expect(staff.success && staff.data.hits.map((hit) => hit.messageId)).toEqual(["m-internal-1", "m-owner-1"])
  })

  it("counts unread and clears it when the viewer opens the messages", async () => {
    mocks.context.mockImplementation(async () => context(sqlite, "owner"))
    const before = await getCorrespondenceInbox(OPEN)
    expect(before.success && before.data.conversations[0]?.unread).toBe(true)
    const unread = await searchCorrespondence(OPEN, "grout", "unread")
    expect(unread.success && unread.data.hits).toHaveLength(1)
    const opened = await markCorrespondenceOpened(OPEN, channelThreadConversationId("bt-thread-owner"), [{ id: "m-owner-2", editedAt: null }])
    expect(opened).toEqual({ success: true, data: null })
    const after = await getCorrespondenceInbox(OPEN)
    expect(after.success && after.data.conversations[0]?.unread).toBe(false)
    expect(sqlite.prepare("SELECT last_read_message_id AS id, unread_count AS n FROM channel_read_state WHERE user_id = 'user-owner'").get()).toEqual({ id: "m-owner-2", n: 0 })
  })

  it("supports bulk Mark as read and refuses inbox state it cannot keep", async () => {
    mocks.context.mockImplementation(async () => context(sqlite, "owner"))
    const id = channelThreadConversationId("bt-thread-owner")
    expect(await updateCorrespondenceInbox(OPEN, [id], "read")).toEqual({ success: true, data: null })
    expect(sqlite.prepare("SELECT unread_count AS n FROM channel_read_state WHERE user_id = 'user-owner'").get()).toEqual({ n: 0 })
    expect((await updateCorrespondenceInbox(OPEN, [id], "archive")).success).toBe(false)
    expect((await setCorrespondenceState(OPEN, id, { saved: true, followUp: false, archived: false })).success).toBe(false)
    // Another audience's thread cannot be marked read by id.
    expect((await updateCorrespondenceInbox(OPEN, [channelThreadConversationId("bt-thread-vendor")], "read")).success).toBe(false)
  })

  it("keeps no reply drafts: empty text clears, unsent text is refused instead of silently dropped", async () => {
    mocks.context.mockImplementation(async () => context(sqlite, "owner"))
    const id = channelThreadConversationId("bt-thread-owner")
    expect(await saveCorrespondenceDraft(OPEN, id, "", 0)).toEqual({ success: true, data: { version: 1 } })
    expect((await saveCorrespondenceDraft(OPEN, id, "half a reply", 0)).success).toBe(false)
  })
})
