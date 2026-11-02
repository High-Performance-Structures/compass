import { getListeningRoomStatus } from "@/app/actions/listening-room"

export const dynamic = "force-dynamic"

/**
 * The sidebar's Listening Room status. A plain GET (not a server action) so
 * the 30-second check never waits in line with, or holds up, the page's own
 * server actions.
 */
export async function GET(request: Request): Promise<Response> {
  const channelId = new URL(request.url).searchParams.get("channelId") ?? ""
  const result = await getListeningRoomStatus(channelId)
  return Response.json(result, { headers: { "Cache-Control": "no-store" } })
}
