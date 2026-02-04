"use server"

import { getCloudflareContext } from "@opennextjs/cloudflare"
import { getDb } from "@/db"
import { organizations, type Organization, type NewOrganization } from "@/db/schema"
import { getCurrentUser } from "@/lib/auth"
import { requirePermission } from "@/lib/permissions"
import { eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"

export async function getOrganizations(): Promise<Organization[]> {
  try {
    const currentUser = await getCurrentUser()
    requirePermission(currentUser, "organization", "read")

    const { env } = await getCloudflareContext()
    if (!env?.DB) return []

    const db = getDb(env.DB)
    const allOrganizations = await db
      .select()
      .from(organizations)
      .where(eq(organizations.isActive, true))

    return allOrganizations
  } catch (error) {
    console.error("Error fetching organizations:", error)
    return []
  }
}

export async function createOrganization(
  name: string,
  slug: string,
  type: "internal" | "client"
): Promise<{ success: boolean; error?: string; data?: Organization }> {
  try {
    const currentUser = await getCurrentUser()
    requirePermission(currentUser, "organization", "create")

    const { env } = await getCloudflareContext()
    if (!env?.DB) {
      return { success: false, error: "Database not available" }
    }

    const db = getDb(env.DB)
    const now = new Date().toISOString()

    // check if slug already exists
    const existing = await db
      .select()
      .from(organizations)
      .where(eq(organizations.slug, slug))
      .get()

    if (existing) {
      return { success: false, error: "Organization slug already exists" }
    }

    const newOrg: NewOrganization = {
      id: crypto.randomUUID(),
      name,
      slug,
      type,
      logoUrl: null,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    }

    await db.insert(organizations).values(newOrg).run()

    revalidatePath("/dashboard/people")
    return { success: true, data: newOrg as Organization }
  } catch (error) {
    console.error("Error creating organization:", error)
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    }
  }
}
