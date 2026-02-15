"use server"

import { getCloudflareContext } from "@opennextjs/cloudflare"
import { eq, and, sql } from "drizzle-orm"
import { getDb } from "@/db"
import { channelCategories, channels, type NewChannelCategory } from "@/db/schema-conversations"
import { getCurrentUser } from "@/lib/auth"
import { requirePermission } from "@/lib/permissions"
import { revalidatePath } from "next/cache"

export async function listCategories() {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return { success: false, error: "Unauthorized" }
    }

    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)

    // get user's organization
    const orgMember = await db
      .select({ organizationId: sql<string>`organization_id` })
      .from(sql`organization_members`)
      .where(sql`user_id = ${user.id}`)
      .limit(1)
      .then((rows) => rows[0] ?? null)

    if (!orgMember) {
      return { success: false, error: "No organization found" }
    }

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
      .where(eq(channelCategories.organizationId, orgMember.organizationId))
      .orderBy(channelCategories.position)

    return { success: true, data: categories }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to list categories",
    }
  }
}

export async function createCategory(name: string, position?: number) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return { success: false, error: "Unauthorized" }
    }

    // admin only
    requirePermission(user, "channels", "create")

    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)

    // get user's organization
    const orgMember = await db
      .select({ organizationId: sql<string>`organization_id` })
      .from(sql`organization_members`)
      .where(sql`user_id = ${user.id}`)
      .limit(1)
      .then((rows) => rows[0] ?? null)

    if (!orgMember) {
      return { success: false, error: "No organization found" }
    }

    const categoryId = crypto.randomUUID()
    const now = new Date().toISOString()

    const newCategory: NewChannelCategory = {
      id: categoryId,
      name,
      organizationId: orgMember.organizationId,
      position: position ?? 0,
      collapsedByDefault: false,
      createdAt: now,
    }

    await db.insert(channelCategories).values(newCategory)

    revalidatePath("/dashboard")
    return { success: true, data: { categoryId } }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to create category",
    }
  }
}

export async function updateCategory(
  id: string,
  data: { name?: string; position?: number }
) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return { success: false, error: "Unauthorized" }
    }

    // admin only
    requirePermission(user, "channels", "create")

    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)

    // get user's organization
    const orgMember = await db
      .select({ organizationId: sql<string>`organization_id` })
      .from(sql`organization_members`)
      .where(sql`user_id = ${user.id}`)
      .limit(1)
      .then((rows) => rows[0] ?? null)

    if (!orgMember) {
      return { success: false, error: "No organization found" }
    }

    // verify category exists in user's org
    const category = await db
      .select()
      .from(channelCategories)
      .where(eq(channelCategories.id, id))
      .limit(1)
      .then((rows) => rows[0] ?? null)

    if (!category || category.organizationId !== orgMember.organizationId) {
      return { success: false, error: "Category not found" }
    }

    // build update object with only provided fields
    const updates: Partial<NewChannelCategory> = {}
    if (data.name !== undefined) {
      updates.name = data.name
    }
    if (data.position !== undefined) {
      updates.position = data.position
    }

    if (Object.keys(updates).length === 0) {
      return { success: true }
    }

    await db
      .update(channelCategories)
      .set(updates)
      .where(eq(channelCategories.id, id))

    revalidatePath("/dashboard")
    return { success: true }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to update category",
    }
  }
}

export async function deleteCategory(id: string) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return { success: false, error: "Unauthorized" }
    }

    // admin only
    requirePermission(user, "channels", "create")

    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)

    // get user's organization
    const orgMember = await db
      .select({ organizationId: sql<string>`organization_id` })
      .from(sql`organization_members`)
      .where(sql`user_id = ${user.id}`)
      .limit(1)
      .then((rows) => rows[0] ?? null)

    if (!orgMember) {
      return { success: false, error: "No organization found" }
    }

    // verify category exists in user's org
    const category = await db
      .select()
      .from(channelCategories)
      .where(eq(channelCategories.id, id))
      .limit(1)
      .then((rows) => rows[0] ?? null)

    if (!category || category.organizationId !== orgMember.organizationId) {
      return { success: false, error: "Category not found" }
    }

    // check for channels in this category
    const channelCount = await db
      .select({ count: sql<number>`count(*)` })
      .from(channels)
      .where(
        and(
          eq(channels.categoryId, id),
          sql`${channels.archivedAt} IS NULL`
        )
      )
      .then((rows) => rows[0]?.count ?? 0)

    if (channelCount > 0) {
      return { success: false, error: "Category has channels" }
    }

    await db.delete(channelCategories).where(eq(channelCategories.id, id))

    revalidatePath("/dashboard")
    return { success: true }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to delete category",
    }
  }
}

export async function reorderChannels(
  categoryId: string,
  channelOrder: string[]
) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return { success: false, error: "Unauthorized" }
    }

    requirePermission(user, "channels", "update")

    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)

    // get user's organization
    const orgMember = await db
      .select({ organizationId: sql<string>`organization_id` })
      .from(sql`organization_members`)
      .where(sql`user_id = ${user.id}`)
      .limit(1)
      .then((rows) => rows[0] ?? null)

    if (!orgMember) {
      return { success: false, error: "No organization found" }
    }

    // verify category exists and belongs to user's org
    const category = await db
      .select()
      .from(channelCategories)
      .where(eq(channelCategories.id, categoryId))
      .limit(1)
      .then((rows) => rows[0] ?? null)

    if (!category || category.organizationId !== orgMember.organizationId) {
      return { success: false, error: "Category not found" }
    }

    // verify all channels belong to this category
    if (channelOrder.length > 0) {
      const categoryChannels = await db
        .select({ id: channels.id })
        .from(channels)
        .where(eq(channels.categoryId, categoryId))

      const validChannelIds = new Set(categoryChannels.map((c) => c.id))
      for (const channelId of channelOrder) {
        if (!validChannelIds.has(channelId)) {
          return { success: false, error: "Invalid channel in order" }
        }
      }
    }

    // update sortOrder for each channel in the array
    for (let i = 0; i < channelOrder.length; i++) {
      await db
        .update(channels)
        .set({ sortOrder: i })
        .where(eq(channels.id, channelOrder[i]))
    }

    revalidatePath("/dashboard")
    return { success: true }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to reorder channels",
    }
  }
}
