import { decodeProjectRouteId } from "@/lib/project-route-id"
import { isCorrespondenceEnabled } from "@/lib/correspondence/access"
import { getCloudflareContext } from "@/lib/db"

import { withProjectConversationContext } from "@/lib/conversation-navigation"
import { ClientRedirect } from "@/components/client-redirect"

export default async function ProjectConversationsPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly id: string }>
  readonly searchParams: Promise<{
    readonly returnTo?: string | readonly string[]
  }>
}): Promise<React.ReactElement> {
  const { id: rawProjectId } = await params
  const id = decodeProjectRouteId(rawProjectId)
  const { env } = await getCloudflareContext()
  if (isCorrespondenceEnabled(id, env) || isCorrespondenceEnabled(id)) return <ClientRedirect href={`/dashboard/projects/${encodeURIComponent(id)}/messages`} />
  const query = await searchParams
  const returnTo =
    typeof query.returnTo === "string"
      ? query.returnTo
      : query.returnTo?.[0] ?? null

  return <ClientRedirect href={withProjectConversationContext("/dashboard/conversations", id, returnTo)} />
}
