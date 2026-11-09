import { toHelpGuidePreview } from "@/components/help/help-ui-model"
import { getCurrentUser, type AuthUser } from "@/lib/auth"
import { getHelpGuides } from "@/lib/help"
import { getEffectiveHelpGuideAccess } from "@/lib/help/server-access"
import {
  getProjectAudienceRequestScope,
  resolveProjectAudienceViewer,
} from "@/lib/project-audience-viewer"

export const dynamic = "force-dynamic"

/**
 * Full Help article text and search data for the Help drawer.
 *
 * Page layouts only send light guide listings (titles and headings) so every
 * dashboard render stays small; the drawer calls this once per browser
 * session when it opens (see `src/components/help/help-guide-details.ts`).
 * It returns exactly the guides the layouts list for the same viewer: the
 * signed-in person, or, inside an owner/vendor preview, the person being
 * previewed (the preview scope rides on the query string, as for every other
 * preview GET).
 */
export async function GET(): Promise<Response> {
  const user = await helpViewer().catch(() => null)
  const access = await getEffectiveHelpGuideAccess(user)
  const allowedHelpGuideIds = new Set(access.allowedGuideIds)
  const guides = getHelpGuides()
    .filter((guide) => allowedHelpGuideIds.has(guide.id))
    .map(toHelpGuidePreview)
  return Response.json(
    { guides },
    { headers: { "Cache-Control": "private, no-store" } },
  )
}

/** Same viewer rule as `src/app/preview/layout.tsx` and the dashboard layout. */
async function helpViewer(): Promise<AuthUser | null> {
  const scope = await getProjectAudienceRequestScope()
  if (!scope) return getCurrentUser()
  const context = await resolveProjectAudienceViewer(scope.projectId, scope.audience)
  return context.viewer ?? (context.isPreview ? null : await getCurrentUser())
}
