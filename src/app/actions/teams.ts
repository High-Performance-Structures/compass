"use server"

import { getCloudflareContext } from "@opennextjs/cloudflare"
import { getDb } from "@/db"
import { teams, type Team, type NewTeam } from "@/db/schema"
import { getCurrentUser } from "@/lib/auth"
import { requirePermission } from "@/lib/permissions"
import { eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"

export async function getTeams(): Promise<Team[]> {
  try {
    const currentUser = await getCurrentUser()
    requirePermission(currentUser, "team", "read")

    const { env } = await getCloudflareContext()
    if (!env?.DB) return []

    const db = getDb(env.DB)
    const allTeams = await db.select().from(teams)

    return allTeams
  } catch (error) {
    console.error("Error fetching teams:", error)
    return []
  }
}

export async function createTeam(
  organizationId: string,
  name: string,
  description?: string
): Promise<{ success: boolean; error?: string; data?: Team }> {
  try {
    const currentUser = await getCurrentUser()
    requirePermission(currentUser, "team", "create")

    const { env } = await getCloudflareContext()
    if (!env?.DB) {
      return { success: false, error: "Database not available" }
    }

    const db = getDb(env.DB)
    const now = new Date().toISOString()

    const newTeam: NewTeam = {
      id: crypto.randomUUID(),
      organizationId,
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
    const currentUser = await getCurrentUser()
    requirePermission(currentUser, "team", "delete")

    const { env } = await getCloudflareContext()
    if (!env?.DB) {
      return { success: false, error: "Database not available" }
    }

    const db = getDb(env.DB)

    await db.delete(teams).where(eq(teams.id, teamId)).run()

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
