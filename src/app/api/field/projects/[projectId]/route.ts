import { NextResponse } from "next/server"

import { getFieldProjectPacket } from "@/app/actions/field-mode"
import { resolveProjectRouteId } from "@/lib/project-route-id"

const PACKET_RESPONSE_HEADERS: Readonly<Record<string, string>> = {
  "Cache-Control": "private, no-store, max-age=0, must-revalidate",
  Pragma: "no-cache",
  Expires: "0",
}

export async function GET(
  _request: Request,
  { params }: { readonly params: Promise<{ readonly projectId: string }> }
): Promise<Response> {
  try {
    const { projectId: rawProjectId } = await params
    const projectId = await resolveProjectRouteId(rawProjectId)
    if (!projectId) {
      return NextResponse.json(
        { success: false, error: "Choose a project first." },
        { status: 400, headers: PACKET_RESPONSE_HEADERS }
      )
    }

    const packet = await getFieldProjectPacket(projectId)
    return NextResponse.json(
      { success: true, packet },
      { headers: PACKET_RESPONSE_HEADERS }
    )
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Unable to refresh the project.",
      },
      { status: 500, headers: PACKET_RESPONSE_HEADERS }
    )
  }
}
