"use server"

import { getCloudflareContext } from "@opennextjs/cloudflare"
import { eq, and, desc } from "drizzle-orm"
import { getDb } from "@/db"
import { slabMemories } from "@/db/schema"
import type { SlabMemory } from "@/db/schema"
import { getCurrentUser } from "@/lib/auth"

export async function getSlabMemories(): Promise<
  | { success: true; memories: ReadonlyArray<SlabMemory> }
  | { success: false; error: string }
> {
  try {
    const user = await getCurrentUser()
    if (!user) return { success: false, error: "Not authenticated" }

    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)

    const rows = await db
      .select()
      .from(slabMemories)
      .where(eq(slabMemories.userId, user.id))
      .orderBy(desc(slabMemories.createdAt))

    return { success: true, memories: rows }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to load memories",
    }
  }
}

export async function deleteSlabMemory(
  id: string,
): Promise<{ success: true } | { success: false; error: string }> {
  try {
    const user = await getCurrentUser()
    if (!user) return { success: false, error: "Not authenticated" }

    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)

    const deleted = await db
      .delete(slabMemories)
      .where(
        and(
          eq(slabMemories.id, id),
          eq(slabMemories.userId, user.id),
        ),
      )
      .returning({ id: slabMemories.id })

    if (deleted.length === 0) {
      return { success: false, error: "Memory not found" }
    }

    return { success: true }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to delete",
    }
  }
}

export async function toggleSlabMemoryPin(
  id: string,
  pinned: boolean,
): Promise<{ success: true } | { success: false; error: string }> {
  try {
    const user = await getCurrentUser()
    if (!user) return { success: false, error: "Not authenticated" }

    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)

    const updated = await db
      .update(slabMemories)
      .set({ pinned })
      .where(
        and(
          eq(slabMemories.id, id),
          eq(slabMemories.userId, user.id),
        ),
      )
      .returning({ id: slabMemories.id })

    if (updated.length === 0) {
      return { success: false, error: "Memory not found" }
    }

    return { success: true }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to update",
    }
  }
}
