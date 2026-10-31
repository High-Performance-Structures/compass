"use server"

import { getCloudflareContext } from "@/lib/db"
import { getDb } from "@/db"
import { agentConversations, agentMemories } from "@/db/schema"
import { and, eq } from "drizzle-orm"
import { getCurrentUser } from "@/lib/auth"
import { isDemoUser } from "@/lib/demo"

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

    if (isDemoUser(user.id)) {
      return { success: false, error: "DEMO_READ_ONLY" }
    }

    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)
    const now = new Date().toISOString()

    const existing = await db.query.agentConversations.findFirst({
      where: (c, { and: a, eq: e }) =>
        a(
          e(c.id, conversationId),
          e(c.userId, user.id),
        ),
    })

    if (existing) {
      await db
        .update(agentConversations)
        .set({
          lastMessageAt: now,
          ...(title ? { title } : {}),
        })
        .where(
          and(
            eq(agentConversations.id, conversationId),
            eq(agentConversations.userId, user.id),
          ),
        )
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
      .where(
        and(
          eq(agentMemories.conversationId, conversationId),
          eq(agentMemories.userId, user.id),
        ),
      )
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
      error: "Failed to save conversation",
    }
  }
}
