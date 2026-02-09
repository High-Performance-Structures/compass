"use server"

import { getDb } from "@/lib/db-universal"
import { agentItems } from "@/db/schema-agent"
import { eq, and } from "drizzle-orm"

function uuid(): string {
  return crypto.randomUUID()
}

function now(): string {
  return new Date().toISOString()
}

export async function createAgentItem(data: {
  readonly userId: string
  readonly type: "todo" | "note" | "checklist"
  readonly title: string
  readonly content?: string
  readonly conversationId?: string
  readonly parentId?: string
  readonly metadata?: Record<string, unknown>
}): Promise<
  | { success: true; id: string }
  | { success: false; error: string }
> {
  const db = await getDb()
  const id = uuid()
  const ts = now()

  await db.insert(agentItems).values({
    id,
    userId: data.userId,
    type: data.type,
    title: data.title,
    content: data.content ?? null,
    conversationId: data.conversationId ?? null,
    parentId: data.parentId ?? null,
    metadata: data.metadata
      ? JSON.stringify(data.metadata)
      : null,
    done: false,
    sortOrder: 0,
    createdAt: ts,
    updatedAt: ts,
  })

  return { success: true, id }
}

export async function updateAgentItem(
  id: string,
  data: Record<string, unknown>,
  userId: string,
): Promise<{ success: boolean; error?: string }> {
  const db = await getDb()

  const existing = await db
    .select()
    .from(agentItems)
    .where(
      and(eq(agentItems.id, id), eq(agentItems.userId, userId))
    )
    .get()

  if (!existing) {
    return { success: false, error: "Item not found" }
  }

  const updates: Record<string, unknown> = {
    updatedAt: now(),
  }

  if (data.title !== undefined) updates.title = data.title
  if (data.content !== undefined) updates.content = data.content
  if (data.done !== undefined) updates.done = data.done
  if (data.sortOrder !== undefined)
    updates.sortOrder = data.sortOrder
  if (data.metadata !== undefined)
    updates.metadata = JSON.stringify(data.metadata)

  await db
    .update(agentItems)
    .set(updates)
    .where(eq(agentItems.id, id))

  return { success: true }
}

export async function deleteAgentItem(
  id: string,
  userId: string,
): Promise<{ success: boolean; error?: string }> {
  const db = await getDb()

  const existing = await db
    .select()
    .from(agentItems)
    .where(
      and(eq(agentItems.id, id), eq(agentItems.userId, userId))
    )
    .get()

  if (!existing) {
    return { success: false, error: "Item not found" }
  }

  await db
    .delete(agentItems)
    .where(eq(agentItems.id, id))

  return { success: true }
}

export async function toggleAgentItem(
  id: string,
  userId: string,
): Promise<{ success: boolean; error?: string }> {
  const db = await getDb()

  const existing = await db
    .select()
    .from(agentItems)
    .where(
      and(eq(agentItems.id, id), eq(agentItems.userId, userId))
    )
    .get()

  if (!existing) {
    return { success: false, error: "Item not found" }
  }

  await db
    .update(agentItems)
    .set({
      done: !existing.done,
      updatedAt: now(),
    })
    .where(eq(agentItems.id, id))

  return { success: true }
}

export async function getAgentItems(
  userId: string,
  conversationId?: string,
): Promise<ReadonlyArray<typeof agentItems.$inferSelect>> {
  const db = await getDb()

  if (conversationId) {
    return db
      .select()
      .from(agentItems)
      .where(
        and(
          eq(agentItems.userId, userId),
          eq(agentItems.conversationId, conversationId)
        )
      )
      .all()
  }

  return db
    .select()
    .from(agentItems)
    .where(eq(agentItems.userId, userId))
    .all()
}
