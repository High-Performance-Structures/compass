import { NextResponse } from "next/server"

import { getChannelUpdates } from "@/app/actions/conversations-realtime"

const RESPONSE_HEADERS: Readonly<Record<string, string>> = {
  "Cache-Control": "private, no-store, max-age=0, must-revalidate",
  Pragma: "no-cache",
  Expires: "0",
}

export async function GET(
  request: Request,
  { params }: { readonly params: Promise<{ readonly channelId: string }> }
): Promise<Response> {
  try {
    const { channelId } = await params
    if (!channelId) {
      return NextResponse.json(
        { success: false, error: "Choose a conversation first." },
        { status: 400, headers: RESPONSE_HEADERS }
      )
    }

    const lastMessageId = new URL(request.url).searchParams.get("lastMessageId")
    const result = await getChannelUpdates(
      channelId,
      lastMessageId && lastMessageId.length > 0 ? lastMessageId : undefined
    )
    return NextResponse.json(result, {
      status: result.success ? 200 : 403,
      headers: RESPONSE_HEADERS,
    })
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Unable to refresh conversation messages.",
      },
      { status: 500, headers: RESPONSE_HEADERS }
    )
  }
}
