import type { AuthUser } from "@/lib/auth"
import {
  getAudienceHelpGuides,
  selectAllowedHelpGuideIds,
} from "@/lib/help/access-policy"
import { canFeature } from "@/lib/permission-enforcement"

export type EffectiveHelpGuideAccess = Readonly<{
  canViewHelp: boolean
  allowedGuideIds: readonly string[]
}>

/**
 * Resolves the same organization/team-aware feature overrides used by product
 * pages before any guide metadata crosses the server boundary.
 */
export async function getEffectiveHelpGuideAccess(
  user: AuthUser | null
): Promise<EffectiveHelpGuideAccess> {
  const canViewHelp = await canFeature(user, "help-resources", "read")
  if (!canViewHelp || !user) {
    return { canViewHelp: false, allowedGuideIds: [] }
  }

  const candidates = getAudienceHelpGuides(user.role)
  const featureAccess = await Promise.all(
    Array.from(new Set(candidates.map((guide) => guide.featureId))).map(
      async (featureId) => ({
        featureId,
        allowed: await canFeature(user, featureId, "read"),
      })
    )
  )

  const allowedGuideIds = selectAllowedHelpGuideIds(
    user.role,
    new Set(
      featureAccess
        .filter((result) => result.allowed)
        .map((result) => result.featureId)
    )
  )

  return {
    canViewHelp: allowedGuideIds.length > 0,
    allowedGuideIds,
  }
}
