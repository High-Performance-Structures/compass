"use server"

import { getDb } from "@/lib/db-universal"
import { agentConversations, agentMemories } from "@/db/schema"
import { eq, desc } from "drizzle-orm"
import { getCurrentUser } from "@/lib/auth"

interface SerializedMessage {
  readonly id: string
  readonly role: string
  readonly content: string
  readonly parts?: ReadonlyArray<unknown>
  readonly createdAt?: string
}

export async function saveConversation(
  conversationId: string,
  messages: ReadonlyArray<SerializedMessage>,
  title?: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const user = await getCurrentUser()
    if (!user) return { success: false, error: "Unauthorized" }

    const db = await getDb()
    const now = new Date().toISOString()

    const existing = await db.query.agentConversations.findFirst({
      where: (c, { eq: e }) => e(c.id, conversationId),
    })

    if (existing) {
      await db
        .update(agentConversations)
        .set({
          lastMessageAt: now,
          ...(title ? { title } : {}),
        })
        .where(eq(agentConversations.id, conversationId))
        .run()
    } else {
      await db
        .insert(agentConversations)
        .values({
          id: conversationId,
          userId: user.id,
          title: title ?? null,
          lastMessageAt: now,
          createdAt: now,
        })
        .run()
    }

    // delete old memories for this conversation and re-insert
    await db
      .delete(agentMemories)
      .where(eq(agentMemories.conversationId, conversationId))
      .run()

    for (const msg of messages) {
      await db
        .insert(agentMemories)
        .values({
          id: msg.id,
          conversationId,
          userId: user.id,
          role: msg.role,
          content: msg.content,
          metadata: msg.parts
            ? JSON.stringify(msg.parts)
            : null,
          createdAt: msg.createdAt ?? now,
        })
        .run()
    }

    return { success: true }
  } catch (error) {
    console.error("Failed to save conversation:", error)
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Unknown error",
    }
  }
}

export async function loadConversations(): Promise<{
  success: boolean
  data?: ReadonlyArray<{
    id: string
    title: string | null
    lastMessageAt: string
    createdAt: string
  }>
  error?: string
}> {
  try {
    const user = await getCurrentUser()
    if (!user) return { success: false, error: "Unauthorized" }

    const db = await getDb()

    const rows = await db
      .select({
        id: agentConversations.id,
        title: agentConversations.title,
        lastMessageAt: agentConversations.lastMessageAt,
        createdAt: agentConversations.createdAt,
      })
      .from(agentConversations)
      .where(eq(agentConversations.userId, user.id))
      .orderBy(desc(agentConversations.lastMessageAt))
      .limit(20)
      .all()

    return { success: true, data: rows }
  } catch (error) {
    console.error("Failed to load conversations:", error)
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Unknown error",
    }
  }
}

export async function loadConversation(
  conversationId: string
): Promise<{
  success: boolean
  data?: ReadonlyArray<SerializedMessage>
  error?: string
}> {
  try {
    const user = await getCurrentUser()
    if (!user) return { success: false, error: "Unauthorized" }

    const db = await getDb()

    const rows = await db
      .select()
      .from(agentMemories)
      .where(eq(agentMemories.conversationId, conversationId))
      .orderBy(agentMemories.createdAt)
      .all()

    const messages: SerializedMessage[] = rows.map((r) => ({
      id: r.id,
      role: r.role,
      content: r.content,
      parts: r.metadata ? JSON.parse(r.metadata) : undefined,
      createdAt: r.createdAt,
    }))

    return { success: true, data: messages }
  } catch (error) {
    console.error("Failed to load conversation:", error)
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Unknown error",
    }
  }
}

export async function deleteConversation(
  conversationId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const user = await getCurrentUser()
    if (!user) return { success: false, error: "Unauthorized" }

    const db = await getDb()

    // cascade delete handles memories
    await db
      .delete(agentConversations)
      .where(eq(agentConversations.id, conversationId))
      .run()

    return { success: true }
  } catch (error) {
    console.error("Failed to delete conversation:", error)
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Unknown error",
    }
  }
}
