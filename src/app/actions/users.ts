"use server"

import { getCloudflareContext } from "@opennextjs/cloudflare"
import { getDb } from "@/db"
import {
  users,
  organizationMembers,
  projectMembers,
  teamMembers,
  groupMembers,
  teams,
  groups,
  type User,
  type NewUser,
} from "@/db/schema"
import { getCurrentUser } from "@/lib/auth"
import { requirePermission } from "@/lib/permissions"
import { eq, and } from "drizzle-orm"
import { revalidatePath } from "next/cache"

export type UserWithRelations = User & {
  teams: { id: string; name: string }[]
  groups: { id: string; name: string; color: string | null }[]
  projectCount: number
  organizationCount: number
}

export async function getUsers(): Promise<UserWithRelations[]> {
  try {
    const currentUser = await getCurrentUser()
    requirePermission(currentUser, "user", "read")

    const { env } = await getCloudflareContext()
    if (!env?.DB) return []

    const db = getDb(env.DB)

    // get all active users
    const allUsers = await db.select().from(users).where(eq(users.isActive, true))

    // for each user, fetch their teams, groups, and counts
    const usersWithRelations = await Promise.all(
      allUsers.map(async (user) => {
        // get teams
        const userTeams = await db
          .select({ id: teams.id, name: teams.name })
          .from(teamMembers)
          .innerJoin(teams, eq(teamMembers.teamId, teams.id))
          .where(eq(teamMembers.userId, user.id))

        // get groups
        const userGroups = await db
          .select({ id: groups.id, name: groups.name, color: groups.color })
          .from(groupMembers)
          .innerJoin(groups, eq(groupMembers.groupId, groups.id))
          .where(eq(groupMembers.userId, user.id))

        // get project count
        const projectCount = await db
          .select()
          .from(projectMembers)
          .where(eq(projectMembers.userId, user.id))
          .then((r) => r.length)

        // get organization count
        const organizationCount = await db
          .select()
          .from(organizationMembers)
          .where(eq(organizationMembers.userId, user.id))
          .then((r) => r.length)

        return {
          ...user,
          teams: userTeams,
          groups: userGroups,
          projectCount,
          organizationCount,
        }
      })
    )

    return usersWithRelations
  } catch (error) {
    console.error("Error fetching users:", error)
    return []
  }
}

export async function updateUserRole(
  userId: string,
  role: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const currentUser = await getCurrentUser()
    requirePermission(currentUser, "user", "update")

    const { env } = await getCloudflareContext()
    if (!env?.DB) {
      return { success: false, error: "Database not available" }
    }

    const db = getDb(env.DB)
    const now = new Date().toISOString()

    await db
      .update(users)
      .set({ role, updatedAt: now })
      .where(eq(users.id, userId))
      .run()

    revalidatePath("/dashboard/people")
    return { success: true }
  } catch (error) {
    console.error("Error updating user role:", error)
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    }
  }
}

export async function deactivateUser(
  userId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const currentUser = await getCurrentUser()
    requirePermission(currentUser, "user", "delete")

    const { env } = await getCloudflareContext()
    if (!env?.DB) {
      return { success: false, error: "Database not available" }
    }

    const db = getDb(env.DB)
    const now = new Date().toISOString()

    await db
      .update(users)
      .set({ isActive: false, updatedAt: now })
      .where(eq(users.id, userId))
      .run()

    revalidatePath("/dashboard/people")
    return { success: true }
  } catch (error) {
    console.error("Error deactivating user:", error)
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    }
  }
}

export async function assignUserToProject(
  userId: string,
  projectId: string,
  role: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const currentUser = await getCurrentUser()
    requirePermission(currentUser, "project", "update")

    const { env } = await getCloudflareContext()
    if (!env?.DB) {
      return { success: false, error: "Database not available" }
    }

    const db = getDb(env.DB)
    const now = new Date().toISOString()

    // check if already assigned
    const existing = await db
      .select()
      .from(projectMembers)
      .where(
        and(
          eq(projectMembers.userId, userId),
          eq(projectMembers.projectId, projectId)
        )
      )
      .get()

    if (existing) {
      // update role
      await db
        .update(projectMembers)
        .set({ role })
        .where(
          and(
            eq(projectMembers.userId, userId),
            eq(projectMembers.projectId, projectId)
          )
        )
        .run()
    } else {
      // insert new assignment
      await db
        .insert(projectMembers)
        .values({
          id: crypto.randomUUID(),
          userId,
          projectId,
          role,
          assignedAt: now,
        })
        .run()
    }

    revalidatePath("/dashboard/people")
    revalidatePath("/dashboard/projects")
    return { success: true }
  } catch (error) {
    console.error("Error assigning user to project:", error)
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    }
  }
}

export async function assignUserToTeam(
  userId: string,
  teamId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const currentUser = await getCurrentUser()
    requirePermission(currentUser, "team", "update")

    const { env } = await getCloudflareContext()
    if (!env?.DB) {
      return { success: false, error: "Database not available" }
    }

    const db = getDb(env.DB)
    const now = new Date().toISOString()

    // check if already assigned
    const existing = await db
      .select()
      .from(teamMembers)
      .where(
        and(eq(teamMembers.userId, userId), eq(teamMembers.teamId, teamId))
      )
      .get()

    if (existing) {
      return { success: false, error: "User already in team" }
    }

    // insert new assignment
    await db
      .insert(teamMembers)
      .values({
        id: crypto.randomUUID(),
        userId,
        teamId,
        joinedAt: now,
      })
      .run()

    revalidatePath("/dashboard/people")
    return { success: true }
  } catch (error) {
    console.error("Error assigning user to team:", error)
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    }
  }
}

export async function assignUserToGroup(
  userId: string,
  groupId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const currentUser = await getCurrentUser()
    requirePermission(currentUser, "group", "update")

    const { env } = await getCloudflareContext()
    if (!env?.DB) {
      return { success: false, error: "Database not available" }
    }

    const db = getDb(env.DB)
    const now = new Date().toISOString()

    // check if already assigned
    const existing = await db
      .select()
      .from(groupMembers)
      .where(
        and(eq(groupMembers.userId, userId), eq(groupMembers.groupId, groupId))
      )
      .get()

    if (existing) {
      return { success: false, error: "User already in group" }
    }

    // insert new assignment
    await db
      .insert(groupMembers)
      .values({
        id: crypto.randomUUID(),
        userId,
        groupId,
        joinedAt: now,
      })
      .run()

    revalidatePath("/dashboard/people")
    return { success: true }
  } catch (error) {
    console.error("Error assigning user to group:", error)
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    }
  }
}

export async function inviteUser(
  email: string,
  role: string,
  organizationId?: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const currentUser = await getCurrentUser()
    requirePermission(currentUser, "user", "create")

    const { env } = await getCloudflareContext()
    if (!env?.DB) {
      return { success: false, error: "Database not available" }
    }

    const db = getDb(env.DB)
    const now = new Date().toISOString()

    // check if user already exists
    const existing = await db.select().from(users).where(eq(users.email, email)).get()

    if (existing) {
      return { success: false, error: "User already exists" }
    }

    // check if workos is configured
    const envRecord = env as unknown as Record<string, string>
    const isWorkOSConfigured =
      envRecord.WORKOS_API_KEY &&
      envRecord.WORKOS_CLIENT_ID &&
      !envRecord.WORKOS_API_KEY.includes("placeholder")

    if (isWorkOSConfigured) {
      // send invitation through workos
      try {
        const { WorkOS } = await import("@workos-inc/node")
        const workos = new WorkOS(envRecord.WORKOS_API_KEY)

        // send invitation via workos
        // note: when user accepts, they'll be created in workos
        // and on first login, ensureUserExists() will sync them to our db
        const invitation = await workos.userManagement.sendInvitation({
          email,
        })

        // create pending user record in our db
        const newUser: NewUser = {
          id: crypto.randomUUID(), // temporary until workos creates real user
          email,
          role,
          isActive: false, // inactive until they accept invite
          createdAt: now,
          updatedAt: now,
          firstName: null,
          lastName: null,
          displayName: email.split("@")[0],
          avatarUrl: null,
          lastLoginAt: null,
        }

        await db.insert(users).values(newUser).run()

        // if organization specified, add to organization
        if (organizationId) {
          await db
            .insert(organizationMembers)
            .values({
              id: crypto.randomUUID(),
              organizationId,
              userId: newUser.id,
              role,
              joinedAt: now,
            })
            .run()
        }

        revalidatePath("/dashboard/people")
        return { success: true }
      } catch (workosError) {
        console.error("WorkOS invitation error:", workosError)
        return {
          success: false,
          error: "Failed to send invitation via WorkOS",
        }
      }
    } else {
      // development mode: just create user in db without sending email
      const newUser: NewUser = {
        id: crypto.randomUUID(),
        email,
        role,
        isActive: true, // active immediately in dev mode
        createdAt: now,
        updatedAt: now,
        firstName: null,
        lastName: null,
        displayName: email.split("@")[0],
        avatarUrl: null,
        lastLoginAt: null,
      }

      await db.insert(users).values(newUser).run()

      if (organizationId) {
        await db
          .insert(organizationMembers)
          .values({
            id: crypto.randomUUID(),
            organizationId,
            userId: newUser.id,
            role,
            joinedAt: now,
          })
          .run()
      }

      revalidatePath("/dashboard/people")
      return { success: true }
    }
  } catch (error) {
    console.error("Error inviting user:", error)
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    }
  }
}
