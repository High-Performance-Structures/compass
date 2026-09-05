import { NextResponse } from "next/server"
import { authorizeListeningRoomSync } from "@/app/actions/listening-room"

export const dynamic = "force-dynamic"

export async function GET(request: Request): Promise<Response> {
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
