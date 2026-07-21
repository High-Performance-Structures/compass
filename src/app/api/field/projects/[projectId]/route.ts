import { NextResponse } from "next/server"

import { getFieldProjectPacket } from "@/app/actions/field-mode"

export async function GET(
  _request: Request,
  { params }: { readonly params: Promise<{ readonly projectId: string }> }
): Promise<Response> {
  try {
    const { projectId } = await params
    if (!projectId) {
      return NextResponse.json(
        { success: false, error: "Choose a project first." },
        { status: 400 }
      )
    }

    const packet = await getFieldProjectPacket(projectId)
    return NextResponse.json({ success: true, packet })
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Unable to refresh the project.",
      },
      { status: 500 }
    )
  }
}
