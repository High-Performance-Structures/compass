import { NextResponse } from "next/server"

import { getFieldDocumentFolder } from "@/app/actions/field-mode"

export async function GET(
  _request: Request,
  {
    params,
  }: {
    readonly params: Promise<{
      readonly projectId: string
      readonly folderId: string
    }>
  }
): Promise<Response> {
  try {
    const { projectId, folderId } = await params
    if (!projectId || !folderId) {
      return NextResponse.json(
        { success: false, error: "Choose a project folder first." },
        { status: 400 }
      )
    }

    const result = await getFieldDocumentFolder(projectId, folderId)
    if (!result.success) {
      return NextResponse.json(result, { status: 400 })
    }
    return NextResponse.json(result)
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Unable to open the project folder.",
      },
      { status: 500 }
    )
  }
}
