import { NextResponse } from "next/server"

import {
  CorrespondenceAttachmentError,
  stageCorrespondenceAttachment,
} from "@/lib/correspondence/attachment-storage"

function isFile(value: FormDataEntryValue | null): value is File {
  return (
    typeof value === "object" &&
    value !== null &&
    "arrayBuffer" in value &&
    "name" in value &&
    "size" in value &&
    "type" in value
  )
}

function errorResponse(error: unknown): NextResponse {
  if (error instanceof CorrespondenceAttachmentError) {
    return NextResponse.json(
      { success: false, error: error.message },
      { status: error.status }
    )
  }
  console.error("Correspondence attachment staging failed", error)
  return NextResponse.json(
    { success: false, error: "Unable to stage attachment." },
    { status: 500 }
  )
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const formData = await request.formData()
    const projectIdValue = formData.get("projectId")
    const projectId =
      typeof projectIdValue === "string" ? projectIdValue.trim() : ""
    const fileValue = formData.get("file")
    if (!projectId || !isFile(fileValue)) {
      return NextResponse.json(
        { success: false, error: "Project and attachment are required." },
        { status: 400 }
      )
    }
    const data = await stageCorrespondenceAttachment({ projectId, file: fileValue })
    return NextResponse.json({ success: true, data })
  } catch (error) {
    return errorResponse(error)
  }
}
