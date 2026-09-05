import { decodeProjectRouteId } from "@/lib/project-route-id"
import { isCorrespondenceEnabled } from "@/lib/correspondence/access"
import { getCloudflareContext } from "@/lib/db"
import { redirect } from "next/navigation"

import { withProjectConversationContext } from "@/lib/conversation-navigation"

export default async function ProjectConversationsPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly id: string }>
  readonly searchParams: Promise<{
    readonly returnTo?: string | readonly string[]
  }>
}): Promise<never> {
  const { id: rawProjectId } = await params
  const id = decodeProjectRouteId(rawProjectId)
  const { env } = await getCloudflareContext()
  if (isCorrespondenceEnabled(id, env) || isCorrespondenceEnabled(id)) redirect(`/dashboard/projects/${encodeURIComponent(id)}/messages`)
  const query = await searchParams
  const returnTo =
    typeof query.returnTo === "string"
      ? query.returnTo
      : query.returnTo?.[0] ?? null

  redirect(withProjectConversationContext("/dashboard/conversations", id, returnTo))
}
