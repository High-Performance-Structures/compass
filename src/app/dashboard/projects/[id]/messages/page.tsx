export const dynamic = "force-dynamic"

import { getCorrespondenceInbox } from "@/app/actions/project-correspondence"
import { ProjectCorrespondenceWorkspace } from "@/components/correspondence/project-correspondence-workspace"
import { decodeProjectRouteId } from "@/lib/project-route-id"
import Link from "next/link"
import { withProjectConversationContext } from "@/lib/conversation-navigation"

export default async function ProjectMessagesPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly id: string }>
  readonly searchParams: Promise<{
    readonly conversationId?: string | readonly string[]
    readonly messageId?: string | readonly string[]
  }>
}): Promise<React.ReactElement> {
  const { id: routeProjectId } = await params
  const projectId = decodeProjectRouteId(routeProjectId)
  const query = await searchParams
  const initialInbox = await getCorrespondenceInbox(projectId)

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
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2 text-sm">
        <span className="text-muted-foreground">Project messages · Historical correspondence is being added as it is verified.</span>
        <Link className="underline underline-offset-4" href={withProjectConversationContext("/dashboard/conversations", projectId, null)}>Existing channels and direct messages</Link>
      </div>
    <ProjectCorrespondenceWorkspace
      projectId={projectId}
      initialInbox={initialInbox.data}
      initialConversationId={singleQueryValue(query.conversationId)}
      initialMessageId={singleQueryValue(query.messageId)}
    />
    </div>
  )
}

function singleQueryValue(
  value: string | readonly string[] | undefined,
): string | undefined {
  return typeof value === "string" ? value : value?.[0]
}
