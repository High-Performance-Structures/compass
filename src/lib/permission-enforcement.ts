import "server-only"

import { cache } from "react"
import { and, eq } from "drizzle-orm"

import { getDb } from "@/db"
import {
  rolePermissionOverrides,
  teamMembers,
  teamPermissionOverrides,
  userPermissionOverrides,
} from "@/db/schema"
import type { AuthUser } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import { isDemoOrg, isDemoUser } from "@/lib/demo"
import {
  accessLevelToFeatureActions,
  getPermissionFeatureAccessLevel,
  getPermissionFeature,
  isPermissionAccessLevel,
  type Action,
  type PermissionAccessLevel,
} from "@/lib/permissions"
import { isInternalStaffRole, isStaffOrganizationType } from "@/lib/user-roles"

export class FeaturePermissionDeniedError extends Error {
  readonly featureId: string
  readonly action: Action
  readonly role: string

  constructor({
    featureId,
    action,
    role,
  }: {
    readonly featureId: string
    readonly action: Action
    readonly role: string
  }) {
    super(`Permission denied: ${role} cannot ${action} ${featureId}`)
    this.name = "FeaturePermissionDeniedError"
    this.featureId = featureId
    this.action = action
    this.role = role
  }
}

export function isFeaturePermissionDeniedError(
  error: unknown
): error is FeaturePermissionDeniedError {
  return error instanceof FeaturePermissionDeniedError
}

const ACCESS_LEVEL_RANK: { readonly [key in PermissionAccessLevel]: number } = {
  none: 0,
  view: 1,
  edit: 2,
  delete: 3,
  approve: 4,
}

function accessLevelAllowsAction(
  featureId: string,
  level: PermissionAccessLevel,
  action: Action
): boolean {
  return accessLevelToFeatureActions(featureId, level).includes(action)
}

function strongerAccessLevel(
  current: PermissionAccessLevel,
  candidate: PermissionAccessLevel
): PermissionAccessLevel {
  return ACCESS_LEVEL_RANK[candidate] > ACCESS_LEVEL_RANK[current]
    ? candidate
    : current
}

type PermissionOverrides = {
  readonly role: ReadonlyMap<string, string>
  readonly team: ReadonlyMap<string, readonly string[]>
  readonly user: ReadonlyMap<string, string>
}

/**
 * A page can check a dozen features; each check used to cost two or three
 * sequential D1 reads. Read every override for this person once per request
 * (one batched round trip) and answer each feature from memory.
 */
const loadPermissionOverrides = cache(
  async (
    organizationId: string,
    userId: string,
    role: string
  ): Promise<PermissionOverrides | null> => {
    const { env } = await getCloudflareContext()
    if (!env?.DB) return null
    const db = getDb(env.DB)
    const [roleRows, teamRows, userRows] = await db.batch([
      db
        .select({
          featureId: rolePermissionOverrides.featureId,
          accessLevel: rolePermissionOverrides.accessLevel,
        })
        .from(rolePermissionOverrides)
        .where(
          and(
            eq(rolePermissionOverrides.organizationId, organizationId),
            eq(rolePermissionOverrides.role, role)
          )
        ),
      db
        .select({
          featureId: teamPermissionOverrides.featureId,
          accessLevel: teamPermissionOverrides.accessLevel,
        })
        .from(teamPermissionOverrides)
        .innerJoin(
          teamMembers,
          eq(teamPermissionOverrides.teamId, teamMembers.teamId)
        )
        .where(
          and(
            eq(teamPermissionOverrides.organizationId, organizationId),
            eq(teamMembers.userId, userId)
          )
        ),
      db
        .select({
          featureId: userPermissionOverrides.featureId,
          accessLevel: userPermissionOverrides.accessLevel,
        })
        .from(userPermissionOverrides)
        .where(
          and(
            eq(userPermissionOverrides.organizationId, organizationId),
            eq(userPermissionOverrides.userId, userId)
          )
        ),
    ])
    const team = new Map<string, string[]>()
    for (const row of teamRows) {
      team.set(row.featureId, [...(team.get(row.featureId) ?? []), row.accessLevel])
    }
    return {
      role: new Map(roleRows.map((row) => [row.featureId, row.accessLevel])),
      team,
      user: new Map(userRows.map((row) => [row.featureId, row.accessLevel])),
    }
  }
)

export async function getEffectivePermissionAccessLevel(
  user: AuthUser | null,
  featureId: string
): Promise<PermissionAccessLevel> {
  const feature = getPermissionFeature(featureId)
  if (!feature || !user || !user.isActive) return "none"

  // Shared directories include other companies' people. External accounts
  // may edit only their explicitly linked person through the self-service
  // Sage proposal path, never browse the full internal directory.
  // A demo company may preview its own people but never sees the shared
  // directory, which lists other companies' people.
  const staffOrganization = featureId === "project-audience-preview"
    ? isStaffOrganizationType(user.organizationType)
    : user.organizationType === "internal"
  if (feature.staffAssignable && (
    !staffOrganization || !isInternalStaffRole(user.role)
  )) return "none"

  if (feature.individualOnly) {
    if (
      !user.organizationId ||
      user.organizationType !== "internal" ||
      !isInternalStaffRole(user.role) ||
      isDemoUser(user.id) ||
      isDemoOrg(user.organizationId)
    ) {
      return "none"
    }
    try {
      const overrides = await loadPermissionOverrides(
        user.organizationId,
        user.id,
        user.role
      )
      const grant = overrides?.user.get(featureId)
      if (grant === "view" || grant === "approve") {
        return grant
      }
    } catch {
      // Confidential access must fail closed if storage is unavailable.
    }
    return "none"
  }

  let effectiveLevel = getPermissionFeatureAccessLevel(user.role, featureId)

  if (
    !user.organizationId ||
    isDemoUser(user.id) ||
    isDemoOrg(user.organizationId)
  ) {
    return effectiveLevel
  }

  try {
    const overrides = await loadPermissionOverrides(
      user.organizationId,
      user.id,
      user.role
    )
    if (!overrides) return feature.staffAssignable ? "none" : effectiveLevel

    const roleOverride = overrides.role.get(featureId)
    if (roleOverride !== undefined && isPermissionAccessLevel(roleOverride)) {
      effectiveLevel = roleOverride
    }

    for (const teamOverride of overrides.team.get(featureId) ?? []) {
      if (!isPermissionAccessLevel(teamOverride)) continue
      effectiveLevel = strongerAccessLevel(effectiveLevel, teamOverride)
    }

    if (feature.staffAssignable && user.organizationType === "internal" && isInternalStaffRole(user.role)) {
      const userOverride = overrides.user.get(featureId)
      if (userOverride !== undefined && isPermissionAccessLevel(userOverride)) {
        // A named staff choice may explicitly deny access despite role/team defaults.
        effectiveLevel = userOverride
      }
    }

    return effectiveLevel
  } catch {
    return feature.staffAssignable ? "none" : effectiveLevel
  }
}

export async function canFeature(
  user: AuthUser | null,
  featureId: string,
  action: Action
): Promise<boolean> {
  const level = await getEffectivePermissionAccessLevel(user, featureId)
  return accessLevelAllowsAction(featureId, level, action)
}

export async function requireFeaturePermission(
  user: AuthUser | null,
  featureId: string,
  action: Action
): Promise<void> {
  if (!(await canFeature(user, featureId, action))) {
    throw new FeaturePermissionDeniedError({
      featureId,
      action,
      role: user?.role ?? "unknown",
    })
  }
}
