import { getProjectMessagesUnreadCount } from "@/app/actions/project-messages-unread"
import { decodeProjectRouteId } from "@/lib/project-route-id"

export const dynamic = "force-dynamic"

/**
 * Unread emails and conversations on one job for the signed-in viewer. A plain
 * GET (not a server action) so the sidebar's refresh never holds up navigation.
 */
export async function GET(
  _request: Request,
  { params }: { readonly params: Promise<{ readonly id: string }> },
): Promise<Response> {
  const { id } = await params
  const count = await getProjectMessagesUnreadCount(decodeProjectRouteId(id))
  return Response.json({ count }, { headers: { "Cache-Control": "no-store" } })
}
