"use server"

import { getCloudflareContext } from "@/lib/db"
import { eq, sql } from "drizzle-orm"
import { getDb } from "@/db"
import { channelCategories, channels } from "@/db/schema-conversations"
import { getCurrentUser } from "@/lib/auth"
import { requireOrg } from "@/lib/org-scope"

export async function listCategories() {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return { success: false, error: "Unauthorized" }
    }
    const orgId = requireOrg(user)

    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)

    // fetch categories with channel counts
    const categories = await db
      .select({
        id: channelCategories.id,
        name: channelCategories.name,
        position: channelCategories.position,
        channelCount: sql<number>`(
          SELECT COUNT(*) FROM ${channels}
          WHERE ${channels.categoryId} = ${channelCategories.id}
          AND ${channels.archivedAt} IS NULL
        )`,
      })
      .from(channelCategories)
      .where(eq(channelCategories.organizationId, orgId))
      .orderBy(channelCategories.position)

    return { success: true, data: categories }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to list categories",
    }
  }
}
