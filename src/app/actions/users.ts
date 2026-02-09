"use server"

import { getDb } from "@/lib/db-universal"
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
import {
  updateUserRoleSchema,
  deactivateUserSchema,
  inviteUserSchema,
  assignUserToProjectSchema,
  assignUserToTeamSchema,
  assignUserToGroupSchema,
} from "@/lib/validations/users"

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

    

    const db = getDb(db)

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
  // validate input
  const parseResult = updateUserRoleSchema.safeParse({ userId, role })
  if (!parseResult.success) {
    const firstIssue = parseResult.error.issues[0]
    return { success: false, error: firstIssue?.message || "Invalid input" }
  }

  try {
    const currentUser = await getCurrentUser()
    requirePermission(currentUser, "user", "update")

        if (!db) {
      return { success: false, error: "Database not available" }
    }

    const db = getDb(db)
    const now = new Date().toISOString()

    await db
      .update(users)
      .set({ role: parseResult.data.role, updatedAt: now })
      .where(eq(users.id, parseResult.data.userId))
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
  // validate input
  const parseResult = deactivateUserSchema.safeParse({ userId })
  if (!parseResult.success) {
    const firstIssue = parseResult.error.issues[0]
    return { success: false, error: firstIssue?.message || "Invalid input" }
  }

  try {
    const currentUser = await getCurrentUser()
    requirePermission(currentUser, "user", "delete")

        if (!db) {
      return { success: false, error: "Database not available" }
    }

    const db = getDb(db)
    const now = new Date().toISOString()

    await db
      .update(users)
      .set({ isActive: false, updatedAt: now })
      .where(eq(users.id, parseResult.data.userId))
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
  // validate input
  const parseResult = assignUserToProjectSchema.safeParse({ userId, projectId, role })
  if (!parseResult.success) {
    const firstIssue = parseResult.error.issues[0]
    return { success: false, error: firstIssue?.message || "Invalid input" }
  }

  const validated = parseResult.data

  try {
    const currentUser = await getCurrentUser()
    requirePermission(currentUser, "project", "update")

        if (!db) {
      return { success: false, error: "Database not available" }
    }

    const db = getDb(db)
    const now = new Date().toISOString()

    // check if already assigned
    const existing = await db
      .select()
      .from(projectMembers)
      .where(
        and(
          eq(projectMembers.userId, validated.userId),
          eq(projectMembers.projectId, validated.projectId)
        )
      )
      .get()

    if (existing) {
      // update role
      await db
        .update(projectMembers)
        .set({ role: validated.role })
        .where(
          and(
            eq(projectMembers.userId, validated.userId),
            eq(projectMembers.projectId, validated.projectId)
          )
        )
        .run()
    } else {
      // insert new assignment
      await db
        .insert(projectMembers)
        .values({
          id: crypto.randomUUID(),
          userId: validated.userId,
          projectId: validated.projectId,
          role: validated.role,
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
  // validate input
  const parseResult = assignUserToTeamSchema.safeParse({ userId, teamId })
  if (!parseResult.success) {
    const firstIssue = parseResult.error.issues[0]
    return { success: false, error: firstIssue?.message || "Invalid input" }
  }

  const validated = parseResult.data

  try {
    const currentUser = await getCurrentUser()
    requirePermission(currentUser, "team", "update")

        if (!db) {
      return { success: false, error: "Database not available" }
    }

    const db = getDb(db)
    const now = new Date().toISOString()

    // check if already assigned
    const existing = await db
      .select()
      .from(teamMembers)
      .where(
        and(eq(teamMembers.userId, validated.userId), eq(teamMembers.teamId, validated.teamId))
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
        userId: validated.userId,
        teamId: validated.teamId,
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
  // validate input
  const parseResult = assignUserToGroupSchema.safeParse({ userId, groupId })
  if (!parseResult.success) {
    const firstIssue = parseResult.error.issues[0]
    return { success: false, error: firstIssue?.message || "Invalid input" }
  }

  const validated = parseResult.data

  try {
    const currentUser = await getCurrentUser()
    requirePermission(currentUser, "group", "update")

        if (!db) {
      return { success: false, error: "Database not available" }
    }

    const db = getDb(db)
    const now = new Date().toISOString()

    // check if already assigned
    const existing = await db
      .select()
      .from(groupMembers)
      .where(
        and(eq(groupMembers.userId, validated.userId), eq(groupMembers.groupId, validated.groupId))
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
        userId: validated.userId,
        groupId: validated.groupId,
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
  // validate input
  const parseResult = inviteUserSchema.safeParse({ email, role, organizationId })
  if (!parseResult.success) {
    const firstIssue = parseResult.error.issues[0]
    return { success: false, error: firstIssue?.message || "Invalid input" }
  }

  const validated = parseResult.data

  try {
    const currentUser = await getCurrentUser()
    requirePermission(currentUser, "user", "create")

        if (!db) {
      return { success: false, error: "Database not available" }
    }

    const db = getDb(db)
    const now = new Date().toISOString()

    // check if user already exists
    const existing = await db.select().from(users).where(eq(users.email, validated.email)).get()

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
        await workos.userManagement.sendInvitation({
          email: validated.email,
        })

        // create pending user record in our db
        const newUser: NewUser = {
          id: crypto.randomUUID(), // temporary until workos creates real user
          email: validated.email,
          role: validated.role,
          isActive: false, // inactive until they accept invite
          createdAt: now,
          updatedAt: now,
          firstName: null,
          lastName: null,
          displayName: validated.email.split("@")[0],
          avatarUrl: null,
          lastLoginAt: null,
        }

        await db.insert(users).values(newUser).run()

        // if organization specified, add to organization
        if (validated.organizationId) {
          await db
            .insert(organizationMembers)
            .values({
              id: crypto.randomUUID(),
              organizationId: validated.organizationId,
              userId: newUser.id,
              role: validated.role,
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
        email: validated.email,
        role: validated.role,
        isActive: true, // active immediately in dev mode
        createdAt: now,
        updatedAt: now,
        firstName: null,
        lastName: null,
        displayName: validated.email.split("@")[0],
        avatarUrl: null,
        lastLoginAt: null,
      }

      await db.insert(users).values(newUser).run()

      if (validated.organizationId) {
        await db
          .insert(organizationMembers)
          .values({
            id: crypto.randomUUID(),
            organizationId: validated.organizationId,
            userId: newUser.id,
            role: validated.role,
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
