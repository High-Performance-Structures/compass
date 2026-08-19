import { NextResponse } from "next/server"
import { z } from "zod/v4"

import { submitFieldChatMessage } from "@/app/actions/field-mode"

const requestSchema = z.object({
  channelId: z.string().min(1),
  content: z.string().trim().min(1).max(10_000),
})

export async function POST(request: Request): Promise<Response> {
  try {
    const parsed = requestSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Enter a message before saving." },
        { status: 400 }
      )
    }

    const result = await submitFieldChatMessage(
      parsed.data.channelId,
      parsed.data.content
    )
    return NextResponse.json(result, { status: result.success ? 200 : 403 })
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
