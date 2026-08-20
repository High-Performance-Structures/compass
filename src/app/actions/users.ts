"use server"

import { getCloudflareContext } from "@/lib/db"
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
import { canManageUserAccess, requirePermission } from "@/lib/permissions"
import { isDemoOrg, isDemoUser } from "@/lib/demo"
import { sendOrResendWorkOSInvitation } from "@/lib/workos-invitations"
import { getUserAvailabilityCondition } from "@/lib/user-availability"
import { eq, and, getTableColumns, sql } from "drizzle-orm"
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
  accessStatus: "active" | "invited"
}

function isPendingInvitationPlaceholder(user: User): boolean {
  return (
    !user.isActive &&
    user.lastLoginAt === null &&
    !user.id.startsWith("user_")
  )
}

async function getOrganizationUsers(
  includeInvited: boolean
): Promise<UserWithRelations[]> {
  try {
    const currentUser = await getCurrentUser()
    requirePermission(currentUser, "user", "read")
    if (!currentUser?.organizationId) return []
    if (
      isDemoUser(currentUser.id) ||
      isDemoOrg(currentUser.organizationId)
    ) {
      return []
    }

    const { env } = await getCloudflareContext()
    if (!env?.DB) return []

    const db = getDb(env.DB)
    const organizationId = currentUser.organizationId
    const availabilityCondition = getUserAvailabilityCondition(includeInvited)

    // Never expose users from another organization in the people directory.
    const allUsers = await db
      .select(getTableColumns(users))
      .from(users)
      .innerJoin(organizationMembers, eq(organizationMembers.userId, users.id))
      .where(
        and(
          availabilityCondition,
          eq(organizationMembers.organizationId, organizationId)
        )
      )

    // for each user, fetch their teams, groups, and counts
    const usersWithRelations = await Promise.all(
      allUsers.map(async (user) => {
        const accessStatus: UserWithRelations["accessStatus"] = user.isActive
          ? "active"
          : "invited"
        // get teams
        const userTeams = await db
          .select({ id: teams.id, name: teams.name })
          .from(teamMembers)
          .innerJoin(teams, eq(teamMembers.teamId, teams.id))
          .where(
            and(
              eq(teamMembers.userId, user.id),
              eq(teams.organizationId, organizationId)
            )
          )

        // get groups
        const userGroups = await db
          .select({ id: groups.id, name: groups.name, color: groups.color })
          .from(groupMembers)
          .innerJoin(groups, eq(groupMembers.groupId, groups.id))
          .where(
            and(
              eq(groupMembers.userId, user.id),
              eq(groups.organizationId, organizationId)
            )
          )

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
          .where(
            and(
              eq(organizationMembers.userId, user.id),
              eq(organizationMembers.organizationId, organizationId)
            )
          )
          .then((r) => r.length)

        return {
          ...user,
          teams: userTeams,
          groups: userGroups,
          projectCount,
          organizationCount,
          accessStatus,
        }
      })
    )

    return usersWithRelations
  } catch (error) {
    console.error("Error fetching users:", error)
    return []
  }
}

/** Active users available to collaboration and assignment surfaces. */
export async function getUsers(): Promise<UserWithRelations[]> {
  return getOrganizationUsers(false)
}

/** Settings roster, including pending invitation placeholders. */
export async function getSettingsUsers(): Promise<UserWithRelations[]> {
  return getOrganizationUsers(true)
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
    if (!canManageUserAccess(currentUser)) {
      return { success: false, error: "Only admins can update user roles" }
    }
    if (!currentUser?.organizationId) {
      return { success: false, error: "No active organization selected" }
    }

    const { env } = await getCloudflareContext()
    if (!env?.DB) {
      return { success: false, error: "Database not available" }
    }

    const db = getDb(env.DB)
    const now = new Date().toISOString()
    const targetMembership = await db
      .select({ id: organizationMembers.id })
      .from(organizationMembers)
      .where(
        and(
          eq(organizationMembers.userId, parseResult.data.userId),
          eq(
            organizationMembers.organizationId,
            currentUser.organizationId
          )
        )
      )
      .get()
    if (!targetMembership) {
      return { success: false, error: "User not found in this organization" }
    }

    await db
      .update(users)
      .set({ role: parseResult.data.role, updatedAt: now })
      .where(eq(users.id, parseResult.data.userId))
      .run()

    await db
      .update(organizationMembers)
      .set({ role: parseResult.data.role })
      .where(eq(organizationMembers.id, targetMembership.id))
      .run()

    revalidatePath("/dashboard/settings")
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
    if (!canManageUserAccess(currentUser)) {
      return { success: false, error: "Only admins can deactivate users" }
    }
    if (currentUser?.id === parseResult.data.userId) {
      return { success: false, error: "You cannot deactivate your own account" }
    }

    const { env } = await getCloudflareContext()
    if (!env?.DB) {
      return { success: false, error: "Database not available" }
    }

    const db = getDb(env.DB)
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
    if (!canManageUserAccess(currentUser)) {
      return { success: false, error: "Only admins can assign project access" }
    }

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
    if (!canManageUserAccess(currentUser)) {
      return { success: false, error: "Only admins can assign team access" }
    }

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
    if (!canManageUserAccess(currentUser)) {
      return { success: false, error: "Only admins can assign group access" }
    }

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
  const normalizedEmail = validated.email.trim().toLowerCase()

  try {
    const currentUser = await getCurrentUser()
    requirePermission(currentUser, "user", "create")
    if (!canManageUserAccess(currentUser)) {
      return { success: false, error: "Only admins can invite users" }
    }
    if (!currentUser?.organizationId) {
      return { success: false, error: "No active organization selected" }
    }

    const targetOrganizationId =
      validated.organizationId ?? currentUser.organizationId
    if (targetOrganizationId !== currentUser.organizationId) {
      return {
        success: false,
        error: "You can only invite users to your active organization",
      }
    }

    const { env } = await getCloudflareContext()
    if (!env?.DB) {
      return { success: false, error: "Database not available" }
    }

    const db = getDb(env.DB)
    const now = new Date().toISOString()

    // check if user already exists
    const existing = await db
      .select()
      .from(users)
      .where(sql`lower(trim(${users.email})) = ${normalizedEmail}`)
      .get()

    // check if workos is configured
    const envRecord = env as unknown as Record<string, string>
    const isWorkOSConfigured =
      envRecord.WORKOS_API_KEY &&
      envRecord.WORKOS_CLIENT_ID &&
      !envRecord.WORKOS_API_KEY.includes("placeholder")

    if (isWorkOSConfigured) {
      // send invitation through workos
      try {
        if (existing) {
          if (!isPendingInvitationPlaceholder(existing)) {
            return { success: false, error: "User already exists" }
          }
          const existingMembership = await db
            .select({ id: organizationMembers.id })
            .from(organizationMembers)
            .where(
              and(
                eq(organizationMembers.userId, existing.id),
                eq(organizationMembers.organizationId, targetOrganizationId)
              )
            )
            .get()
          if (!existingMembership) {
            return {
              success: false,
              error: "This pending user belongs to another organization",
            }
          }

          const resendResult = await sendOrResendWorkOSInvitation({
            apiKey: envRecord.WORKOS_API_KEY,
            email: normalizedEmail,
          })
          if (!resendResult.success) return resendResult

          await db
            .update(users)
            .set({ role: validated.role, updatedAt: now })
            .where(eq(users.id, existing.id))
            .run()
          await db
            .update(organizationMembers)
            .set({ role: validated.role })
            .where(eq(organizationMembers.id, existingMembership.id))
            .run()
          revalidatePath("/dashboard/settings")
          revalidatePath("/dashboard/people")
          return { success: true }
        }

        // On first login, ensureUserExists() activates the pending local row.
        const invitationResult = await sendOrResendWorkOSInvitation({
          apiKey: envRecord.WORKOS_API_KEY,
          email: normalizedEmail,
        })
        if (!invitationResult.success) return invitationResult

        // create pending user record in our db
        const newUser: NewUser = {
          id: crypto.randomUUID(), // temporary until workos creates real user
          email: normalizedEmail,
          role: validated.role,
          isActive: false, // inactive until they accept invite
          createdAt: now,
          updatedAt: now,
          firstName: null,
          lastName: null,
          displayName: normalizedEmail.split("@")[0],
          avatarUrl: null,
          lastLoginAt: null,
        }

        await db.insert(users).values(newUser).run()

        // if organization specified, add to organization
        await db
          .insert(organizationMembers)
          .values({
            id: crypto.randomUUID(),
            organizationId: targetOrganizationId,
            userId: newUser.id,
            role: validated.role,
            joinedAt: now,
          })
          .run()

        revalidatePath("/dashboard/settings")
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
      if (existing) {
        return { success: false, error: "User already exists" }
      }
      // development mode: just create user in db without sending email
      const newUser: NewUser = {
        id: crypto.randomUUID(),
        email: normalizedEmail,
        role: validated.role,
        isActive: true, // active immediately in dev mode
        createdAt: now,
        updatedAt: now,
        firstName: null,
        lastName: null,
        displayName: normalizedEmail.split("@")[0],
        avatarUrl: null,
        lastLoginAt: null,
      }

      await db.insert(users).values(newUser).run()

      await db
        .insert(organizationMembers)
        .values({
          id: crypto.randomUUID(),
          organizationId: targetOrganizationId,
          userId: newUser.id,
          role: validated.role,
          joinedAt: now,
        })
        .run()

      revalidatePath("/dashboard/settings")
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
