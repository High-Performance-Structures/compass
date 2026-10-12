import { and, asc, desc, eq } from "drizzle-orm"

import type { getDb } from "@/db"
import { agentConversations, agentMemories } from "@/db/schema"

type Db = ReturnType<typeof getDb>

const MAX_LIST = 20
const MAX_TRANSCRIPT_MESSAGES = 40
const MAX_MESSAGE_CHARACTERS = 1_500

export type RecentConversation = Readonly<{
  id: string
  title: string | null
  lastMessageAt: string
  firstRequest: string | null
}>

export type ConversationTranscript = Readonly<{
  id: string
  title: string | null
  lastMessageAt: string
  messages: readonly Readonly<{ role: string; content: string; createdAt: string }>[]
  truncated: boolean
}>

function clip(text: string): string {
  return text.length > MAX_MESSAGE_CHARACTERS
    ? `${text.slice(0, MAX_MESSAGE_CHARACTERS)}…`
    : text
}

/**
 * The user's most recent Ask Jarvis conversations, newest first, with the
 * first request of each so Jarvis can tell them apart. Only the user's own.
 */
export async function listRecentConversations(
  db: Db,
  userId: string,
  limit = 10
): Promise<readonly RecentConversation[]> {
  const rows = await db
    .select({
      id: agentConversations.id,
      title: agentConversations.title,
      lastMessageAt: agentConversations.lastMessageAt,
    })
    .from(agentConversations)
    .where(eq(agentConversations.userId, userId))
    .orderBy(desc(agentConversations.lastMessageAt))
    .limit(Math.min(Math.max(1, Math.trunc(limit)), MAX_LIST))
    .all()

  return Promise.all(
    rows.map(async (row) => {
      const first = await db
        .select({ content: agentMemories.content })
        .from(agentMemories)
        .where(
          and(
            eq(agentMemories.conversationId, row.id),
            eq(agentMemories.userId, userId),
            eq(agentMemories.role, "user")
          )
        )
        .orderBy(asc(agentMemories.createdAt))
        .limit(1)
        .get()
      return { ...row, firstRequest: first ? clip(first.content) : null }
    })
  )
}

/**
 * The latest messages of one of the user's conversations, oldest first.
 * Returns null for unknown conversations and for other users' conversations.
 */
export async function getConversationTranscript(
  db: Db,
  userId: string,
  conversationId: string
): Promise<ConversationTranscript | null> {
  const conversation = await db
    .select({
      id: agentConversations.id,
      title: agentConversations.title,
      lastMessageAt: agentConversations.lastMessageAt,
    })
    .from(agentConversations)
    .where(
      and(
        eq(agentConversations.id, conversationId),
        eq(agentConversations.userId, userId)
      )
    )
    .get()
  if (!conversation) return null

  // Fetch one extra row to know whether older messages were left out.
  const newestFirst = await db
    .select({
      role: agentMemories.role,
      content: agentMemories.content,
      createdAt: agentMemories.createdAt,
    })
    .from(agentMemories)
    .where(
      and(
        eq(agentMemories.conversationId, conversationId),
        eq(agentMemories.userId, userId)
      )
    )
    .orderBy(desc(agentMemories.createdAt))
    .limit(MAX_TRANSCRIPT_MESSAGES + 1)
    .all()

  const truncated = newestFirst.length > MAX_TRANSCRIPT_MESSAGES
  const messages = newestFirst
    .slice(0, MAX_TRANSCRIPT_MESSAGES)
    .reverse()
    .map((message) => ({ ...message, content: clip(message.content) }))
  return { ...conversation, messages, truncated }
}
