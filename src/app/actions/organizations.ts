"use server"

import { getCloudflareContext } from "@/lib/db"
import { getDb } from "@/db"
import { organizations, organizationMembers, type Organization, type NewOrganization } from "@/db/schema"
import { getCurrentUser } from "@/lib/auth"
import { requirePermission } from "@/lib/permissions"
import { eq, and } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { cookies } from "next/headers"
import { isDemoUser } from "@/lib/demo"

export async function getOrganizations(): Promise<Organization[]> {
  try {
    const currentUser = await getCurrentUser()
    if (!currentUser) return []
    requirePermission(currentUser, "organization", "read")

    const { env } = await getCloudflareContext()
    if (!env?.DB) return []

    const db = getDb(env.DB)

    // filter to orgs the user is a member of
    const userOrgs = await db
      .select({
        id: organizations.id,
        name: organizations.name,
        slug: organizations.slug,
        type: organizations.type,
        logoUrl: organizations.logoUrl,
        isActive: organizations.isActive,
        createdAt: organizations.createdAt,
        updatedAt: organizations.updatedAt,
      })
      .from(organizations)
      .innerJoin(organizationMembers, eq(organizations.id, organizationMembers.organizationId))
      .where(and(eq(organizations.isActive, true), eq(organizationMembers.userId, currentUser.id)))

    return userOrgs
  } catch (error) {
    console.error("Error fetching organizations:", error)
    return []
  }
}

export async function createOrganization(
  name: string,
  slug: string,
  type: "internal" | "client" | "personal" | "demo"
): Promise<{ success: boolean; error?: string; data?: Organization }> {
  try {
    const currentUser = await getCurrentUser()
    if (!currentUser) {
      return { success: false, error: "Unauthorized" }
    }
    if (isDemoUser(currentUser.id)) {
      return { success: false, error: "DEMO_READ_ONLY" }
    }
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

export async function getUserOrganizations(): Promise<
  ReadonlyArray<{
    readonly id: string
    readonly name: string
    readonly slug: string
    readonly type: string
    readonly role: string
  }>
> {
  try {
    const currentUser = await getCurrentUser()
    if (!currentUser) return []

    const { env } = await getCloudflareContext()
    if (!env?.DB) return []

    const db = getDb(env.DB)
    const results = await db
      .select({
        id: organizations.id,
        name: organizations.name,
        slug: organizations.slug,
        type: organizations.type,
        role: organizationMembers.role,
      })
      .from(organizationMembers)
      .innerJoin(
        organizations,
        eq(organizations.id, organizationMembers.organizationId)
      )
      .where(eq(organizationMembers.userId, currentUser.id))

    return results
  } catch (error) {
    console.error("Error fetching user organizations:", error)
    return []
  }
}

export async function switchOrganization(
  orgId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const currentUser = await getCurrentUser()
    if (!currentUser) {
      return { success: false, error: "Not authenticated" }
    }

    const { env } = await getCloudflareContext()
    if (!env?.DB) {
      return { success: false, error: "Database not available" }
    }

    const db = getDb(env.DB)

    // verify user is member of target org
    const membership = await db
      .select()
      .from(organizationMembers)
      .where(
        and(
          eq(organizationMembers.organizationId, orgId),
          eq(organizationMembers.userId, currentUser.id)
        )
      )
      .get()

    if (!membership) {
      return { success: false, error: "Not a member of this organization" }
    }

    // set compass-active-org cookie
    const cookieStore = await cookies()
    cookieStore.set("compass-active-org", orgId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 365, // 1 year
    })

    revalidatePath("/dashboard")
    return { success: true }
  } catch (error) {
    console.error("Error switching organization:", error)
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    }
  }
}
