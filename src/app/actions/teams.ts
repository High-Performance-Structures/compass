"use server"

import { getCloudflareContext } from "@/lib/db"
import { getDb } from "@/db"
import { teams, type Team, type NewTeam } from "@/db/schema"
import { requireAuth } from "@/lib/auth"
import { requirePermission } from "@/lib/permissions"
import { eq, and } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { requireOrg } from "@/lib/org-scope"
import { isDemoUser } from "@/lib/demo"

export async function getTeams(): Promise<Team[]> {
  try {
    const currentUser = await requireAuth()
    requirePermission(currentUser, "team", "read")
    const orgId = requireOrg(currentUser)

    const { env } = await getCloudflareContext()
    if (!env?.DB) return []

    const db = getDb(env.DB)
    const allTeams = await db
      .select()
      .from(teams)
      .where(eq(teams.organizationId, orgId))

    return allTeams
  } catch (error) {
    console.error("Error fetching teams:", error)
    return []
  }
}

export async function createTeam(
  name: string,
  description?: string
): Promise<{ success: boolean; error?: string; data?: Team }> {
  try {
    const currentUser = await requireAuth()
    if (isDemoUser(currentUser.id)) {
      return { success: false, error: "DEMO_READ_ONLY" }
    }
    requirePermission(currentUser, "team", "create")
    const orgId = requireOrg(currentUser)

    const { env } = await getCloudflareContext()
    if (!env?.DB) {
      return { success: false, error: "Database not available" }
    }

    const db = getDb(env.DB)
    const now = new Date().toISOString()

    const newTeam: NewTeam = {
      id: crypto.randomUUID(),
      organizationId: orgId,
      name,
      description: description ?? null,
      createdAt: now,
    }

    await db.insert(teams).values(newTeam).run()

    revalidatePath("/dashboard/people")
    return { success: true, data: newTeam as Team }
  } catch (error) {
    console.error("Error creating team:", error)
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    }
  }
}

export async function deleteTeam(
  teamId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const currentUser = await requireAuth()
    if (isDemoUser(currentUser.id)) {
      return { success: false, error: "DEMO_READ_ONLY" }
    }
    requirePermission(currentUser, "team", "delete")
    const orgId = requireOrg(currentUser)

    const { env } = await getCloudflareContext()
    if (!env?.DB) {
      return { success: false, error: "Database not available" }
    }

    const db = getDb(env.DB)

    await db
      .delete(teams)
      .where(and(eq(teams.id, teamId), eq(teams.organizationId, orgId)))
      .run()

    revalidatePath("/dashboard/people")
    return { success: true }
  } catch (error) {
    console.error("Error deleting team:", error)
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    }
  }
}
