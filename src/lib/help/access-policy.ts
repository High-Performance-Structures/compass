import { HELP_GUIDES, helpAudienceForRole } from "@/lib/help"
import type { HelpGuide } from "@/lib/help/types"
import { USER_ROLES } from "@/lib/user-roles"

export function getAudienceHelpGuides(
  role: string,
  guides: readonly HelpGuide[] = HELP_GUIDES
): readonly HelpGuide[] {
  const userRole = USER_ROLES.find((candidate) => candidate === role)
  const audience = userRole ? helpAudienceForRole(userRole) : null
  if (!audience) return []
  return guides.filter((guide) => guide.audiences.includes(audience))
}

export function selectAllowedHelpGuideIds(
  role: string,
  allowedFeatureIds: ReadonlySet<string>,
  guides: readonly HelpGuide[] = HELP_GUIDES
): readonly string[] {
  return getAudienceHelpGuides(role, guides)
    .filter((guide) => allowedFeatureIds.has(guide.featureId))
    .map((guide) => guide.id)
}
