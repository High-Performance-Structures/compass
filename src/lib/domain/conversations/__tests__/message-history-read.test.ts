import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { addDirectoryPeopleSchema, openCorrespondenceTestDatabase, type CorrespondenceTestDatabase } from "../../../../../__tests__/helpers/correspondence-core"
import { readChannelMessages } from "../messages"
import type { ConversationHistoryCursor } from "@/lib/conversations/message-pagination"

let database: CorrespondenceTestDatabase | null = null
let authorized = true

vi.mock("@/lib/db", () => ({
  getCloudflareContext: async () => {
    if (database === null) throw new Error("Missing test database")
    return { env: { DB: database.d1 } }
  },
}))
vi.mock("@/lib/auth", () => ({ getCurrentUser: async () => ({ id: "staff-a", role: "admin" }) }))
vi.mock("@/lib/conversations/preview-viewer", () => ({ conversationRequestViewer: async (user: unknown) => user }))
vi.mock("@/lib/conversations/channel-access-server", () => ({
  getConversationChannelAccess: async () => authorized ? { id: "archive" } : null,
}))

const tied = "2026-07-29T21:53:00.000Z"

describe("shared conversation history reader", () => {
  beforeEach(() => {
    authorized = true
    database = openCorrespondenceTestDatabase()
    addDirectoryPeopleSchema(database.sqlite)
    database.sqlite.exec(`
      ALTER TABLE users ADD COLUMN avatar_url TEXT;
      CREATE TABLE messages (
        id TEXT PRIMARY KEY, channel_id TEXT, thread_id TEXT, user_id TEXT,
        content TEXT, content_html TEXT, edited_at TEXT, deleted_at TEXT,
        is_pinned INTEGER DEFAULT 0, reply_count INTEGER DEFAULT 0,
        last_reply_at TEXT, created_at TEXT, source_system TEXT,
        imported_sender_contact_id TEXT, source_sender_label_snapshot TEXT
      );
      CREATE TABLE message_attachments (id TEXT, message_id TEXT, file_name TEXT, mime_type TEXT, file_size INTEGER, storage_url TEXT);
      CREATE TABLE message_reactions (id TEXT, message_id TEXT, user_id TEXT, emoji TEXT);
      INSERT INTO project_contacts (id, project_id, contact_type, display_name)
        VALUES ('source-contact', 'project-a', 'other', 'Imported contact');
    `)
    const insert = database.sqlite.prepare("INSERT INTO messages (id,channel_id,thread_id,user_id,content,created_at) VALUES (?,?,?,'staff-a',?,?)")
    for (let i = 0; i < 125; i++) {
      const id = `message-${String(i).padStart(3, "0")}`
      insert.run(id, "archive", null, id, tied)
    }
    for (let i = 0; i < 5; i++) insert.run(`older-${i}`, "archive", null, "Older body", "2026-07-28T12:00:00.000Z")
    insert.run("other-channel", "other", null, "Other project", tied)
    insert.run("thread-reply", "archive", "parent", "Reply", tied)
    database.sqlite.exec(`
      UPDATE messages SET source_system='buildertrend', imported_sender_contact_id='source-contact', source_sender_label_snapshot='Captured literal'
        WHERE id='message-124';
      UPDATE messages SET deleted_at='2026-07-30T12:00:00.000Z', content_html='<p>Deleted</p>' WHERE id='older-0';
    `)
  })

  afterEach(() => {
    database?.close()
    database = null
  })

  it("pages every tied row once through the owning reader and retains imported sender metadata", async () => {
    const ids: string[] = []
    let cursor: ConversationHistoryCursor | undefined
    for (let page = 0; page < 4; page++) {
      const result = await readChannelMessages("archive", { limit: 50, cursor })
      if (!result.success || result.data === undefined) throw new Error("History read failed")
      if (page === 0) expect(result.data[0]).toMatchObject({
        id: "message-124", sourceSystem: "buildertrend", importedSenderName: "Imported contact",
      })
      ids.push(...result.data.map((row) => row.id))
      const last = result.data.at(-1)
      if (last === undefined) break
      cursor = { createdAt: last.createdAt, id: last.id }
    }
    expect(ids).toHaveLength(130)
    expect(new Set(ids).size).toBe(130)
    expect(ids).toContain("message-000")
    expect(ids).not.toContain("other-channel")
    expect(ids).not.toContain("thread-reply")
  })

  it("keeps timestamp-only callers compatible and masks deleted rows", async () => {
    const result = await readChannelMessages("archive", { cursor: tied })
    if (!result.success || result.data === undefined) throw new Error("History read failed")
    expect(result.data.map((row) => row.id)).toEqual(["older-4", "older-3", "older-2", "older-1", "older-0"])
    expect(result.data.at(-1)).toMatchObject({ content: "[Message deleted]", contentHtml: null, attachments: [], reactions: [] })
  })

  it("continues to reject a viewer without channel access", async () => {
    authorized = false
    expect(await readChannelMessages("archive", { cursor: { createdAt: tied, id: "message-100" } }))
      .toMatchObject({ success: false, error: "Not a member of this channel" })
  })
})
