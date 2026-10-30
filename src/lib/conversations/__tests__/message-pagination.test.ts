import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { and, eq, isNull } from "drizzle-orm"
import { describe, expect, it } from "vitest"
import { messages } from "@/db/schema-conversations"
import { conversationHistoryBefore, conversationHistoryOrder, type ConversationHistoryCursor } from "../message-pagination"

describe("conversation history pagination", () => {
  it("returns every timestamp-tied message exactly once across pages and retains channel/thread boundaries", () => {
    const sqlite = new Database(":memory:")
    try {
      sqlite.exec("CREATE TABLE messages (id TEXT PRIMARY KEY, channel_id TEXT, thread_id TEXT, created_at TEXT)")
      const insert = sqlite.prepare("INSERT INTO messages VALUES (?, ?, ?, ?)")
      const tied = "2026-07-29T21:53:00.000Z"
      for (let i = 0; i < 125; i++) insert.run(`message-${String(i).padStart(3, "0")}`, "archive", null, tied)
      for (let i = 0; i < 5; i++) insert.run(`older-${i}`, "archive", null, "2026-07-28T12:00:00.000Z")
      insert.run("foreign", "other-channel", null, tied)
      insert.run("thread-reply", "archive", "parent", tied)
      const db = drizzle(sqlite)
      const ids: string[] = []
      let cursor: ConversationHistoryCursor | undefined
      for (let page = 0; page < 4; page++) {
        const rows = db.select({ id: messages.id, createdAt: messages.createdAt }).from(messages)
          .where(and(eq(messages.channelId, "archive"), isNull(messages.threadId), conversationHistoryBefore(cursor)))
          .orderBy(...conversationHistoryOrder()).limit(50).all()
        ids.push(...rows.map((row) => row.id))
        const last = rows.at(-1)
        if (last === undefined) break
        cursor = last
      }
      expect(ids).toHaveLength(130)
      expect(new Set(ids).size).toBe(130)
      expect(ids.slice(0, 3)).toEqual(["message-124", "message-123", "message-122"])
      expect(ids).toContain("message-000")
      expect(ids.slice(-5)).toEqual(["older-4", "older-3", "older-2", "older-1", "older-0"])
      expect(ids).not.toContain("foreign")
      expect(ids).not.toContain("thread-reply")
      const legacy = db.select({ id: messages.id }).from(messages)
        .where(and(eq(messages.channelId, "archive"), conversationHistoryBefore(tied)))
        .orderBy(...conversationHistoryOrder()).all()
      expect(legacy.map((row) => row.id)).toEqual(["older-4", "older-3", "older-2", "older-1", "older-0"])
    } finally { sqlite.close() }
  })
})
