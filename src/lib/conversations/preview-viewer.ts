import type { AuthUser } from "@/lib/auth"
import { getProjectAudienceRequestScope } from "@/lib/project-audience-request-server"

export async function conversationRequestViewer(actor: AuthUser | null): Promise<AuthUser | null> {
  if (!actor || !actor.isActive) return actor
  const scope = await getProjectAudienceRequestScope()
  if (!scope) return actor
  const { resolveProjectAudienceViewer } = await import("@/lib/project-audience-viewer")
  const context = await resolveProjectAudienceViewer(scope.projectId, scope.audience)
  if (!context.viewer) throw new Error("Select a person to preview their conversations.")
  return context.viewer
}
