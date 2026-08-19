import { NextResponse } from "next/server"
import { z } from "zod/v4"

import { getFieldProjectPacket } from "@/app/actions/field-mode"
import { createChannel } from "@/app/actions/conversations"

const requestSchema = z.object({
  projectId: z.string().min(1),
})

export async function POST(request: Request): Promise<Response> {
  try {
    const parsed = requestSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Choose a project first." },
        { status: 400 }
      )
    }

    const currentPacket = await getFieldProjectPacket(parsed.data.projectId)
    if (currentPacket.channel) {
      return NextResponse.json({
        success: true,
        created: false,
        channel: currentPacket.channel,
        messages: currentPacket.messages,
      })
    }

    const channelName = currentPacket.project.projectNumber
      ? `${currentPacket.project.projectNumber} · ${currentPacket.project.name}`
      : currentPacket.project.name
    const result = await createChannel({
      name: channelName,
      type: "text",
      description: "Project staff conversation",
      projectId: parsed.data.projectId,
      isPrivate: false,
    })
    if (!result.success) {
      return NextResponse.json(result, { status: 403 })
    }

    const packet = await getFieldProjectPacket(parsed.data.projectId)
    return NextResponse.json({
      success: true,
      created: true,
      channel: packet.channel,
      messages: packet.messages,
    })
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Unable to start the project channel.",
      },
      { status: 500 }
    )
  }
}
