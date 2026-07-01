import "server-only"

import { and, eq } from "drizzle-orm"

import { getDb } from "@/db"
import {
  rolePermissionOverrides,
  teamMembers,
  teamPermissionOverrides,
} from "@/db/schema"
import type { AuthUser } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import { isDemoOrg, isDemoUser } from "@/lib/demo"
import {
  accessLevelToActions,
  getPermissionAccessLevel,
  getPermissionFeature,
  isPermissionAccessLevel,
  type Action,
  type PermissionAccessLevel,
} from "@/lib/permissions"

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
  level: PermissionAccessLevel,
  action: Action
): boolean {
  return accessLevelToActions(level).includes(action)
}

function strongerAccessLevel(
  current: PermissionAccessLevel,
  candidate: PermissionAccessLevel
): PermissionAccessLevel {
  return ACCESS_LEVEL_RANK[candidate] > ACCESS_LEVEL_RANK[current]
    ? candidate
    : current
}

export async function getEffectivePermissionAccessLevel(
  user: AuthUser | null,
  featureId: string
): Promise<PermissionAccessLevel> {
  const feature = getPermissionFeature(featureId)
  if (!feature || !user || !user.isActive) return "none"

  let effectiveLevel = getPermissionAccessLevel(user.role, feature.resource)

  if (
    !user.organizationId ||
    isDemoUser(user.id) ||
    isDemoOrg(user.organizationId)
  ) {
    return effectiveLevel
  }

  try {
    const { env } = await getCloudflareContext()
    if (!env?.DB) return effectiveLevel

    const db = getDb(env.DB)

    const roleOverride = await db
      .select({ accessLevel: rolePermissionOverrides.accessLevel })
      .from(rolePermissionOverrides)
      .where(
        and(
          eq(rolePermissionOverrides.organizationId, user.organizationId),
          eq(rolePermissionOverrides.role, user.role),
          eq(rolePermissionOverrides.featureId, featureId)
        )
      )
      .get()

    if (roleOverride && isPermissionAccessLevel(roleOverride.accessLevel)) {
      effectiveLevel = roleOverride.accessLevel
    }

    const teamOverrides = await db
      .select({ accessLevel: teamPermissionOverrides.accessLevel })
      .from(teamPermissionOverrides)
      .innerJoin(
        teamMembers,
        eq(teamPermissionOverrides.teamId, teamMembers.teamId)
      )
      .where(
        and(
          eq(teamPermissionOverrides.organizationId, user.organizationId),
          eq(teamPermissionOverrides.featureId, featureId),
          eq(teamMembers.userId, user.id)
        )
      )

    for (const teamOverride of teamOverrides) {
      if (!isPermissionAccessLevel(teamOverride.accessLevel)) continue
      effectiveLevel = strongerAccessLevel(
        effectiveLevel,
        teamOverride.accessLevel
      )
    }

    return effectiveLevel
  } catch {
    return effectiveLevel
  }
}

export async function canFeature(
  user: AuthUser | null,
  featureId: string,
  action: Action
): Promise<boolean> {
  const level = await getEffectivePermissionAccessLevel(user, featureId)
  return accessLevelAllowsAction(level, action)
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
