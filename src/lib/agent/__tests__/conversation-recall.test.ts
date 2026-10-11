import { afterEach, describe, expect, it } from "vitest"

import {
  getConversationTranscript,
  listRecentConversations,
} from "@/lib/agent/conversation-recall"
import {
  openCorrespondenceTestDatabase,
  type CorrespondenceTestDatabase,
} from "../../../../__tests__/helpers/correspondence-core"

let database: CorrespondenceTestDatabase | null = null

afterEach(() => {
  database?.close()
  database = null
})

function open(): CorrespondenceTestDatabase {
  const opened = openCorrespondenceTestDatabase()
  opened.sqlite.exec(`
    CREATE TABLE agent_conversations (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, title TEXT,
      last_message_at TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE agent_memories (id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, user_id TEXT NOT NULL,
      role TEXT NOT NULL, content TEXT NOT NULL, embedding TEXT, metadata TEXT, created_at TEXT NOT NULL);
    INSERT INTO agent_conversations VALUES
      ('older', 'staff-a', 'Rebar', '2026-10-01T10:00:00Z', '2026-10-01T09:00:00Z'),
      ('newer', 'staff-a', NULL, '2026-10-09T10:00:00Z', '2026-10-09T09:00:00Z'),
      ('someone-else', 'staff-b', 'Private', '2026-10-10T10:00:00Z', '2026-10-10T09:00:00Z');
    INSERT INTO agent_memories VALUES
      ('m1', 'older', 'staff-a', 'user', 'When is the rebar inspection?', NULL, NULL, '2026-10-01T09:00:00Z'),
      ('m2', 'older', 'staff-a', 'assistant', 'Tuesday at 10:30.', NULL, NULL, '2026-10-01T09:00:05Z'),
      ('m3', 'newer', 'staff-a', 'user', 'Push the backfill a day.', NULL, NULL, '2026-10-09T09:00:00Z'),
      ('m4', 'someone-else', 'staff-b', 'user', 'Private question', NULL, NULL, '2026-10-10T09:00:00Z');
  `)
  return opened
}

describe("recalling earlier Jarvis conversations", () => {
  it("lists only the user's own conversations, newest first, with their first request", async () => {
    database = open()
    const conversations = await listRecentConversations(database.db, "staff-a")
    expect(conversations.map((conversation) => conversation.id)).toEqual(["newer", "older"])
    expect(conversations[1]?.firstRequest).toBe("When is the rebar inspection?")
  })

  it("returns a conversation's messages in order", async () => {
    database = open()
    const transcript = await getConversationTranscript(database.db, "staff-a", "older")
    expect(transcript?.messages.map((message) => message.content)).toEqual([
      "When is the rebar inspection?",
      "Tuesday at 10:30.",
    ])
    expect(transcript?.truncated).toBe(false)
  })

  it("never returns another user's conversation", async () => {
    database = open()
    expect(await getConversationTranscript(database.db, "staff-a", "someone-else")).toBeNull()
    expect(await getConversationTranscript(database.db, "staff-a", "missing")).toBeNull()
  })

  it("keeps only the latest messages of a long conversation", async () => {
    database = open()
    const insert = database.sqlite.prepare(
      "INSERT INTO agent_memories VALUES (?, 'newer', 'staff-a', 'user', ?, NULL, NULL, ?)"
    )
    for (let index = 0; index < 50; index += 1) {
      insert.run(`long-${index}`, `message ${index}`, `2026-10-09T10:${String(index).padStart(2, "0")}:00Z`)
    }
    const transcript = await getConversationTranscript(database.db, "staff-a", "newer")
    expect(transcript?.messages).toHaveLength(40)
    expect(transcript?.truncated).toBe(true)
    expect(transcript?.messages.at(-1)?.content).toBe("message 49")
  })
})
