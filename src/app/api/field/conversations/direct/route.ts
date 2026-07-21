import { NextResponse } from "next/server"
import { z } from "zod/v4"

import { sendMessage } from "@/app/actions/chat-messages"
import { openDirectConversation } from "@/app/actions/conversations"

const requestSchema = z.object({
  targetUserId: z.string().min(1),
  content: z.string().trim().min(1).max(10_000),
})

export async function POST(request: Request): Promise<Response> {
  try {
    const parsed = requestSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Choose a person and enter a message." },
        { status: 400 }
      )
    }

    const conversation = await openDirectConversation(parsed.data.targetUserId)
    if (!conversation.success) {
      return NextResponse.json(conversation, { status: 403 })
    }

    const message = await sendMessage({
      channelId: conversation.data.channelId,
      content: parsed.data.content,
    })
    if (!message.success) {
      return NextResponse.json(
        { success: false, error: message.error ?? "Unable to send the message." },
        { status: 400 }
      )
    }

    return NextResponse.json({
      success: true,
      channelId: conversation.data.channelId,
    })
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error ? error.message : "Unable to send the message.",
      },
      { status: 500 }
    )
  }
}
