import { getMyStaleMessageCount } from "@/app/actions/staff-message-desk"

export const dynamic = "force-dynamic"

/**
 * Stale Message Desk messages assigned to the signed-in user. A plain GET (not
 * a server action) so the sidebar's refresh never holds up page navigation.
 */
export async function GET(): Promise<Response> {
  const count = await getMyStaleMessageCount()
  return Response.json({ count }, { headers: { "Cache-Control": "no-store" } })
}
