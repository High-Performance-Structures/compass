import { getNotificationCenter } from "@/app/actions/notifications"

export const dynamic = "force-dynamic"

/**
 * The notification bell's list. A plain GET (not a server action) so the
 * timed refresh never waits in line with, or holds up, the page's own server
 * actions. Outside viewers pass the project and audience they're viewing.
 */
export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams
  const projectId = params.get("projectId")
  const audience = params.get("audience")
  const scope = projectId && (audience === "owner" || audience === "sub_vendor") ? { projectId, audience } as const : undefined
  const result = await getNotificationCenter(scope)
  return Response.json(result, { headers: { "Cache-Control": "no-store" } })
}
