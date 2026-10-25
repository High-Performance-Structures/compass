import type { AuthUser } from "@/lib/auth"
import { getProjectAudienceRequestScope } from "@/lib/project-audience-request-server"

export async function conversationRequestViewer(actor: AuthUser | null): Promise<AuthUser | null> {
  if (!actor || !actor.isActive) return actor
  const scope = await getProjectAudienceRequestScope()
  if (!scope) return actor
  const { resolveProjectAudienceViewer, isInvitedPreviewId } = await import("@/lib/project-audience-viewer")
  const context = await resolveProjectAudienceViewer(scope.projectId, scope.audience)
  if (!context.viewer) throw new Error("Select a person to preview their conversations.")
  if (isInvitedPreviewId(context.viewer.id)) throw new Error("This person hasn't accepted the invitation yet, so they have no conversations.")
  return context.viewer
}
