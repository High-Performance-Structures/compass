"use server"

import { and, eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import { getDb } from "@/db"
import {
  permissionAuditEvents,
  rolePermissionOverrides,
  teamPermissionOverrides,
  teams,
  userPermissionOverrides,
  users,
  organizationMembers,
} from "@/db/schema"
import { requireAuth } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import { isDemoOrg, isDemoUser } from "@/lib/demo"
import {
  getPermissionFeature,
  isPermissionAccessLevel,
  type PermissionAccessLevel,
} from "@/lib/permissions"
import { requireOrg } from "@/lib/org-scope"
import { isInternalStaffRole, USER_ROLES } from "@/lib/user-roles"
import { canManageUserAccess } from "@/lib/permissions"

export type PermissionOverrideChoice = {
  readonly id: string
  readonly role: string
  readonly featureId: string
  readonly accessLevel: PermissionAccessLevel
  readonly updatedAt: string
  readonly updatedBy: string | null
}

export type TeamPermissionOverrideChoice = {
  readonly id: string
  readonly teamId: string
  readonly featureId: string
  readonly accessLevel: PermissionAccessLevel
  readonly updatedAt: string
  readonly updatedBy: string | null
}

export type PermissionTeamOption = {
  readonly id: string
  readonly name: string
}

export type PermissionStaffOption = {
  readonly id: string
  readonly name: string
  readonly email: string
}

export type UserPermissionOverrideChoice = {
  readonly id: string
  readonly userId: string
  readonly featureId: string
  readonly accessLevel: "view" | "approve"
}

export type PermissionOverrideContext = {
  readonly demoMode: boolean
  readonly canManagePermissions: boolean
  readonly roleOverrides: readonly PermissionOverrideChoice[]
  readonly teamOverrides: readonly TeamPermissionOverrideChoice[]
  readonly teams: readonly PermissionTeamOption[]
  readonly staff: readonly PermissionStaffOption[]
  readonly userOverrides: readonly UserPermissionOverrideChoice[]
}

export type PermissionOverrideResult =
  | { readonly success: true }
  | { readonly success: false; readonly error: string }

const BASELINE = "baseline"
const INHERIT = "inherit"

function isKnownRole(role: string): boolean {
  return USER_ROLES.some((knownRole) => knownRole === role)
}

function isDemoContext(user: {
  readonly id: string
  readonly organizationId: string | null
}): boolean {
  return (
    isDemoUser(user.id) ||
    (user.organizationId !== null && isDemoOrg(user.organizationId))
  )
}

function validateFeature(featureId: string): string | null {
  const feature = getPermissionFeature(featureId)
  if (!feature) return "Unknown permission feature"
  return feature.individualOnly
    ? "Assign this permission to individual staff instead."
    : null
}

function validateAccessLevel(
  accessLevel: string,
  resetValue: typeof BASELINE | typeof INHERIT
): string | null {
  if (accessLevel === resetValue || isPermissionAccessLevel(accessLevel)) {
    return null
  }

  return "Unknown permission level"
}

function toRoleOverrideChoice(row: {
  readonly id: string
  readonly role: string
  readonly featureId: string
  readonly accessLevel: string
  readonly updatedAt: string
  readonly updatedBy: string | null
}): PermissionOverrideChoice | null {
  if (!isPermissionAccessLevel(row.accessLevel)) {
    return null
  }

  return {
    id: row.id,
    role: row.role,
    featureId: row.featureId,
    accessLevel: row.accessLevel,
    updatedAt: row.updatedAt,
    updatedBy: row.updatedBy,
  }
}

function toTeamOverrideChoice(row: {
  readonly id: string
  readonly teamId: string
  readonly featureId: string
  readonly accessLevel: string
  readonly updatedAt: string
  readonly updatedBy: string | null
}): TeamPermissionOverrideChoice | null {
  if (!isPermissionAccessLevel(row.accessLevel)) {
    return null
  }

  return {
    id: row.id,
    teamId: row.teamId,
    featureId: row.featureId,
    accessLevel: row.accessLevel,
    updatedAt: row.updatedAt,
    updatedBy: row.updatedBy,
  }
}

function compactRoleOverrides(
  rows: readonly {
    readonly id: string
    readonly role: string
    readonly featureId: string
    readonly accessLevel: string
    readonly updatedAt: string
    readonly updatedBy: string | null
  }[]
): readonly PermissionOverrideChoice[] {
  const overrides: PermissionOverrideChoice[] = []

  for (const row of rows) {
    const override = toRoleOverrideChoice(row)
    if (override) {
      overrides.push(override)
    }
  }

  return overrides
}

function compactTeamOverrides(
  rows: readonly {
    readonly id: string
    readonly teamId: string
    readonly featureId: string
    readonly accessLevel: string
    readonly updatedAt: string
    readonly updatedBy: string | null
  }[]
): readonly TeamPermissionOverrideChoice[] {
  const overrides: TeamPermissionOverrideChoice[] = []

  for (const row of rows) {
    const override = toTeamOverrideChoice(row)
    if (override) {
      overrides.push(override)
    }
  }

  return overrides
}

async function requirePermissionAdmin(): Promise<{
  readonly id: string
  readonly organizationId: string
}> {
  const currentUser = await requireAuth()

  if (currentUser.organizationId === null) {
    throw new Error("No active organization")
  }

  if (isDemoContext(currentUser)) {
    throw new Error("DEMO_READ_ONLY")
  }

  if (!canManageUserAccess(currentUser)) {
    throw new Error("Only admins can change permission settings")
  }

  return {
    id: currentUser.id,
    organizationId: currentUser.organizationId,
  }
}

export async function getPermissionOverrideContext(): Promise<PermissionOverrideContext> {
  const currentUser = await requireAuth()
  const demoMode = isDemoContext(currentUser)
  const canManagePermissions = canManageUserAccess(currentUser)
  const orgId = requireOrg(currentUser)

  if (demoMode) {
    return {
      demoMode: true,
      canManagePermissions: false,
      roleOverrides: [],
      teamOverrides: [],
      teams: [],
      staff: [],
      userOverrides: [],
    }
  }

  const { env } = await getCloudflareContext()
  if (!env?.DB) {
    return {
      demoMode,
      canManagePermissions,
      roleOverrides: [],
      teamOverrides: [],
      teams: [],
      staff: [],
      userOverrides: [],
    }
  }

  const db = getDb(env.DB)

  const [roleRows, teamRows, teamOptions, staffRows, userRows] = await Promise.all([
    db
      .select({
        id: rolePermissionOverrides.id,
        role: rolePermissionOverrides.role,
        featureId: rolePermissionOverrides.featureId,
        accessLevel: rolePermissionOverrides.accessLevel,
        updatedAt: rolePermissionOverrides.updatedAt,
        updatedBy: rolePermissionOverrides.updatedBy,
      })
      .from(rolePermissionOverrides)
      .where(eq(rolePermissionOverrides.organizationId, orgId)),
    db
      .select({
        id: teamPermissionOverrides.id,
        teamId: teamPermissionOverrides.teamId,
        featureId: teamPermissionOverrides.featureId,
        accessLevel: teamPermissionOverrides.accessLevel,
        updatedAt: teamPermissionOverrides.updatedAt,
        updatedBy: teamPermissionOverrides.updatedBy,
      })
      .from(teamPermissionOverrides)
      .where(eq(teamPermissionOverrides.organizationId, orgId)),
    db
      .select({ id: teams.id, name: teams.name })
      .from(teams)
      .where(eq(teams.organizationId, orgId)),
    canManagePermissions
      ? db
          .select({
            id: users.id,
            email: users.email,
            displayName: users.displayName,
            firstName: users.firstName,
            lastName: users.lastName,
            role: organizationMembers.role,
          })
          .from(organizationMembers)
          .innerJoin(users, eq(users.id, organizationMembers.userId))
          .where(
            and(
              eq(organizationMembers.organizationId, orgId),
              eq(users.isActive, true)
            )
          )
      : Promise.resolve([]),
    canManagePermissions
      ? db
          .select({
            id: userPermissionOverrides.id,
            userId: userPermissionOverrides.userId,
            featureId: userPermissionOverrides.featureId,
            accessLevel: userPermissionOverrides.accessLevel,
          })
          .from(userPermissionOverrides)
          .where(eq(userPermissionOverrides.organizationId, orgId))
      : Promise.resolve([]),
  ])

  const staffById = new Map<string, PermissionStaffOption>()
  for (const member of staffRows) {
    if (!isInternalStaffRole(member.role)) continue
    const name = member.displayName?.trim() ||
      [member.firstName, member.lastName].filter(Boolean).join(" ").trim() ||
      member.email
    staffById.set(member.id, {
      id: member.id,
      name,
      email: member.email,
    })
  }

  return {
    demoMode,
    canManagePermissions,
    roleOverrides: compactRoleOverrides(roleRows),
    teamOverrides: compactTeamOverrides(teamRows),
    teams: teamOptions,
    staff: Array.from(staffById.values()).sort((left, right) =>
      left.name.localeCompare(right.name)
    ),
    userOverrides: userRows.flatMap((row) =>
      row.accessLevel === "view" || row.accessLevel === "approve"
        ? [{
            id: row.id,
            userId: row.userId,
            featureId: row.featureId,
            accessLevel: row.accessLevel,
          }]
        : []
    ),
  }
}

export async function updateUserPermissionOverride(input: {
  readonly userId: string
  readonly featureId: string
  readonly accessLevel: "none" | "view" | "approve"
}): Promise<PermissionOverrideResult> {
  try {
    const feature = getPermissionFeature(input.featureId)
    if (!feature?.individualOnly) {
      return { success: false, error: "This is not an individual permission." }
    }
    if (!["none", "view", "approve"].includes(input.accessLevel)) {
      return { success: false, error: "Unknown permission level." }
    }
    const currentUser = await requirePermissionAdmin()
    const { env } = await getCloudflareContext()
    if (!env?.DB) return { success: false, error: "Database not available" }
    const db = getDb(env.DB)
    const member = await db
      .select({ role: organizationMembers.role })
      .from(organizationMembers)
      .innerJoin(users, eq(users.id, organizationMembers.userId))
      .where(
        and(
          eq(organizationMembers.organizationId, currentUser.organizationId),
          eq(organizationMembers.userId, input.userId),
          eq(users.isActive, true)
        )
      )
      .get()
    if (!member || !isInternalStaffRole(member.role)) {
      return { success: false, error: "Choose an active internal staff member." }
    }
    const existing = await db
      .select()
      .from(userPermissionOverrides)
      .where(
        and(
          eq(userPermissionOverrides.organizationId, currentUser.organizationId),
          eq(userPermissionOverrides.userId, input.userId),
          eq(userPermissionOverrides.featureId, input.featureId)
        )
      )
      .get()
    const now = new Date().toISOString()
    const removeExisting = db
      .delete(userPermissionOverrides)
      .where(
        and(
          eq(userPermissionOverrides.organizationId, currentUser.organizationId),
          eq(userPermissionOverrides.userId, input.userId),
          eq(userPermissionOverrides.featureId, input.featureId)
        )
      )
    const audit = db.insert(permissionAuditEvents).values({
      id: crypto.randomUUID(),
      organizationId: currentUser.organizationId,
      scope: "user",
      role: null,
      teamId: null,
      userId: input.userId,
      featureId: input.featureId,
      previousAccessLevel: existing?.accessLevel ?? null,
      nextAccessLevel: input.accessLevel === "none" ? null : input.accessLevel,
      changedBy: currentUser.id,
      createdAt: now,
    })
    if (input.accessLevel === "none") {
      await db.batch([removeExisting, audit])
    } else {
      const grant = db.insert(userPermissionOverrides).values({
        id: existing?.id ?? crypto.randomUUID(),
        organizationId: currentUser.organizationId,
        userId: input.userId,
        featureId: input.featureId,
        accessLevel: input.accessLevel,
        createdBy: existing?.createdBy ?? currentUser.id,
        updatedBy: currentUser.id,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      })
      await db.batch([removeExisting, grant, audit])
    }
    revalidatePath("/dashboard/settings")
    return { success: true }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    }
  }
}

export async function updateRolePermissionOverride(input: {
  readonly role: string
  readonly featureId: string
  readonly accessLevel: PermissionAccessLevel | typeof BASELINE
}): Promise<PermissionOverrideResult> {
  try {
    if (!isKnownRole(input.role)) {
      return { success: false, error: "Unknown role" }
    }

    const featureError = validateFeature(input.featureId)
    if (featureError) {
      return { success: false, error: featureError }
    }

    const levelError = validateAccessLevel(input.accessLevel, BASELINE)
    if (levelError) {
      return { success: false, error: levelError }
    }

    const currentUser = await requirePermissionAdmin()
    const { env } = await getCloudflareContext()
    if (!env?.DB) {
      return { success: false, error: "Database not available" }
    }

    const db = getDb(env.DB)
    const now = new Date().toISOString()
    const existing = await db
      .select()
      .from(rolePermissionOverrides)
      .where(
        and(
          eq(rolePermissionOverrides.organizationId, currentUser.organizationId),
          eq(rolePermissionOverrides.role, input.role),
          eq(rolePermissionOverrides.featureId, input.featureId)
        )
      )
      .get()

    await db
      .delete(rolePermissionOverrides)
      .where(
        and(
          eq(rolePermissionOverrides.organizationId, currentUser.organizationId),
          eq(rolePermissionOverrides.role, input.role),
          eq(rolePermissionOverrides.featureId, input.featureId)
        )
      )
      .run()

    if (input.accessLevel !== BASELINE) {
      await db
        .insert(rolePermissionOverrides)
        .values({
          id: crypto.randomUUID(),
          organizationId: currentUser.organizationId,
          role: input.role,
          featureId: input.featureId,
          accessLevel: input.accessLevel,
          createdBy: existing?.createdBy ?? currentUser.id,
          updatedBy: currentUser.id,
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
        })
        .run()
    }

    await db
      .insert(permissionAuditEvents)
      .values({
        id: crypto.randomUUID(),
        organizationId: currentUser.organizationId,
        scope: "role",
        role: input.role,
        teamId: null,
        featureId: input.featureId,
        previousAccessLevel: existing?.accessLevel ?? null,
        nextAccessLevel:
          input.accessLevel === BASELINE ? null : input.accessLevel,
        changedBy: currentUser.id,
        createdAt: now,
      })
      .run()

    revalidatePath("/dashboard/settings")
    return { success: true }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    }
  }
}

export async function updateTeamPermissionOverride(input: {
  readonly teamId: string
  readonly featureId: string
  readonly accessLevel: PermissionAccessLevel | typeof INHERIT
}): Promise<PermissionOverrideResult> {
  try {
    const featureError = validateFeature(input.featureId)
    if (featureError) {
      return { success: false, error: featureError }
    }

    const levelError = validateAccessLevel(input.accessLevel, INHERIT)
    if (levelError) {
      return { success: false, error: levelError }
    }

    const currentUser = await requirePermissionAdmin()
    const { env } = await getCloudflareContext()
    if (!env?.DB) {
      return { success: false, error: "Database not available" }
    }

    const db = getDb(env.DB)
    const team = await db
      .select({ id: teams.id })
      .from(teams)
      .where(
        and(
          eq(teams.id, input.teamId),
          eq(teams.organizationId, currentUser.organizationId)
        )
      )
      .get()

    if (!team) {
      return { success: false, error: "Unknown team" }
    }

    const now = new Date().toISOString()
    const existing = await db
      .select()
      .from(teamPermissionOverrides)
      .where(
        and(
          eq(teamPermissionOverrides.organizationId, currentUser.organizationId),
          eq(teamPermissionOverrides.teamId, input.teamId),
          eq(teamPermissionOverrides.featureId, input.featureId)
        )
      )
      .get()

    await db
      .delete(teamPermissionOverrides)
      .where(
        and(
          eq(teamPermissionOverrides.organizationId, currentUser.organizationId),
          eq(teamPermissionOverrides.teamId, input.teamId),
          eq(teamPermissionOverrides.featureId, input.featureId)
        )
      )
      .run()

    if (input.accessLevel !== INHERIT) {
      await db
        .insert(teamPermissionOverrides)
        .values({
          id: crypto.randomUUID(),
          organizationId: currentUser.organizationId,
          teamId: input.teamId,
          featureId: input.featureId,
          accessLevel: input.accessLevel,
          createdBy: existing?.createdBy ?? currentUser.id,
          updatedBy: currentUser.id,
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
        })
        .run()
    }

    await db
      .insert(permissionAuditEvents)
      .values({
        id: crypto.randomUUID(),
        organizationId: currentUser.organizationId,
        scope: "team",
        role: null,
        teamId: input.teamId,
        featureId: input.featureId,
        previousAccessLevel: existing?.accessLevel ?? null,
        nextAccessLevel: input.accessLevel === INHERIT ? null : input.accessLevel,
        changedBy: currentUser.id,
        createdAt: now,
      })
      .run()

    revalidatePath("/dashboard/settings")
    return { success: true }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    }
  }
}
