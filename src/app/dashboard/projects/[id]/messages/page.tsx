export const dynamic = "force-dynamic"

import { getCorrespondenceInbox } from "@/app/actions/project-correspondence"
import { getOwnerDocumentEmailDraft } from "@/app/actions/owner-document-notices"
import { ProjectCorrespondenceWorkspace } from "@/components/correspondence/project-correspondence-workspace"
import { decodeProjectRouteId } from "@/lib/project-route-id"
import { notFound } from "next/navigation"
import { ProjectConversationsTab, projectConversationsQueryFromSearch } from "@/components/conversations/project-conversations-tab"
import { ProjectMessagesTabs } from "@/components/conversations/project-messages-tabs"
import { getCurrentUser } from "@/lib/auth"

export default async function ProjectMessagesPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly id: string }>
  readonly searchParams: Promise<{
    readonly conversationId?: string | readonly string[]
    readonly messageId?: string | readonly string[]
    readonly quickAdd?: string | readonly string[]
    readonly email?: string | readonly string[]
    readonly documentId?: string | readonly string[]
    readonly view?: string | readonly string[]
    readonly scope?: string | readonly string[]
    readonly filter?: string | readonly string[]
    readonly q?: string | readonly string[]
    readonly page?: string | readonly string[]
    readonly channel?: string | readonly string[]
  }>
}): Promise<React.ReactElement> {
  const { id: routeProjectId } = await params
  const projectId = decodeProjectRouteId(routeProjectId)
  const query = await searchParams
  const basePath = `/dashboard/projects/${encodeURIComponent(projectId)}/messages`
  const conversationsQuery = projectConversationsQueryFromSearch(query)
  if (conversationsQuery) {
    const currentUser = await getCurrentUser()
    if (!currentUser) notFound()
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <ProjectMessagesTabs active="conversations" emailsHref={basePath} conversationsHref={`${basePath}?view=conversations`} />
        <ProjectConversationsTab
          projectId={projectId}
          basePath={basePath}
          baseParams={{ view: "conversations" }}
          currentUser={currentUser}
          query={conversationsQuery}
        />
      </div>
    )
  }
  const initialInbox = await getCorrespondenceInbox(projectId)
  // Create email from a billed pay application or a deposit request.
  const emailKind = singleQueryValue(query.email)
  const emailDocumentId = singleQueryValue(query.documentId)
  const ownerEmail = initialInbox.success && initialInbox.data.workspace === "staff" && emailKind && emailDocumentId
    ? await getOwnerDocumentEmailDraft(projectId, emailKind, emailDocumentId)
    : null

  if (!initialInbox.success) {
    return (
      <main className="flex min-h-0 flex-1 items-center justify-center p-6">
        <div className="max-w-md border p-6 text-center">
          <h1 className="text-lg font-semibold">Messages are unavailable</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {initialInbox.error}
          </p>
        </div>
      </main>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ProjectMessagesTabs active="emails" emailsHref={basePath} conversationsHref={`${basePath}?view=conversations`} />
    <ProjectCorrespondenceWorkspace
      projectId={projectId}
      initialInbox={initialInbox.data}
      initialConversationId={singleQueryValue(query.conversationId)}
      initialMessageId={singleQueryValue(query.messageId)}
      initialNewMessage={singleQueryValue(query.quickAdd) === "message"}
      initialEmail={ownerEmail?.success ? ownerEmail.data : null}
      initialStatus={ownerEmail && !ownerEmail.success ? ownerEmail.error : null}
    />
    </div>
  )
}

function singleQueryValue(
  value: string | readonly string[] | undefined,
): string | undefined {
  return typeof value === "string" ? value : value?.[0]
}
