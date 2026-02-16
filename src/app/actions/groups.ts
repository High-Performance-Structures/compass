"use server"

import { getCloudflareContext } from "@opennextjs/cloudflare"
import { getDb } from "@/db"
import { groups, type Group, type NewGroup } from "@/db/schema"
import { requireAuth } from "@/lib/auth"
import { requirePermission } from "@/lib/permissions"
import { eq, and } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { requireOrg } from "@/lib/org-scope"
import { isDemoUser } from "@/lib/demo"

export async function getGroups(): Promise<Group[]> {
  try {
    const currentUser = await requireAuth()
    requirePermission(currentUser, "group", "read")
    const orgId = requireOrg(currentUser)

    const { env } = await getCloudflareContext()
    if (!env?.DB) return []

    const db = getDb(env.DB)
    const allGroups = await db
      .select()
      .from(groups)
      .where(eq(groups.organizationId, orgId))

    return allGroups
  } catch (error) {
    console.error("Error fetching groups:", error)
    return []
  }
}

export async function createGroup(
  name: string,
  description?: string,
  color?: string
): Promise<{ success: boolean; error?: string; data?: Group }> {
  try {
    const currentUser = await requireAuth()
    if (isDemoUser(currentUser.id)) {
      return { success: false, error: "DEMO_READ_ONLY" }
    }
    requirePermission(currentUser, "group", "create")
    const orgId = requireOrg(currentUser)

    const { env } = await getCloudflareContext()
    if (!env?.DB) {
      return { success: false, error: "Database not available" }
    }

    const db = getDb(env.DB)
    const now = new Date().toISOString()

    const newGroup: NewGroup = {
      id: crypto.randomUUID(),
      organizationId: orgId,
      name,
      description: description ?? null,
      color: color ?? null,
      createdAt: now,
    }

    await db.insert(groups).values(newGroup).run()

    revalidatePath("/dashboard/people")
    return { success: true, data: newGroup as Group }
  } catch (error) {
    console.error("Error creating group:", error)
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    }
  }
}

export async function deleteGroup(
  groupId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const currentUser = await requireAuth()
    if (isDemoUser(currentUser.id)) {
      return { success: false, error: "DEMO_READ_ONLY" }
    }
    requirePermission(currentUser, "group", "delete")
    const orgId = requireOrg(currentUser)

    const { env } = await getCloudflareContext()
    if (!env?.DB) {
      return { success: false, error: "Database not available" }
    }

    const db = getDb(env.DB)

    await db
      .delete(groups)
      .where(and(eq(groups.id, groupId), eq(groups.organizationId, orgId)))
      .run()

    revalidatePath("/dashboard/people")
    return { success: true }
  } catch (error) {
    console.error("Error deleting group:", error)
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    }
  }
}
