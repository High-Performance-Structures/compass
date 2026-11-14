import { NextResponse } from "next/server"
import { authorizeListeningRoomSync } from "@/app/actions/listening-room"
import { VIEW_AS_READ_ONLY_MESSAGE } from "@/lib/view-as/constants"
import { isViewAsRequest } from "@/lib/view-as/request"

export const dynamic = "force-dynamic"

export async function GET(request: Request): Promise<Response> {
  // The Listening Room socket lets anyone in it control playback; the
  // Durable Object behind it is outside the View as database guard, so
  // View as never joins it.
  if (await isViewAsRequest()) {
    return NextResponse.json({ success: false, error: VIEW_AS_READ_ONLY_MESSAGE }, { status: 403 })
  }
  const channelId = new URL(request.url).searchParams.get("channelId") ?? ""
  const result = await authorizeListeningRoomSync(channelId)
  if (!result.success) {
    return NextResponse.json(
      { success: false, error: result.error },
      { status: result.error === "Listening room not found" ? 404 : 403 }
    )
  }
  return NextResponse.json(result)
}
