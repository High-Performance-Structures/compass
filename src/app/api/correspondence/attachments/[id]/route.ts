import { NextResponse } from "next/server"
import { attachmentPreviewKind } from "@/lib/correspondence/attachment-preview"

import {
  CorrespondenceAttachmentError,
  deleteStagedCorrespondenceAttachment,
  downloadCorrespondenceAttachment,
} from "@/lib/correspondence/attachment-storage"

function attachmentResponseError(error: unknown): NextResponse {
  if (error instanceof CorrespondenceAttachmentError) {
    return NextResponse.json(
      { success: false, error: error.message },
      { status: error.status }
    )
  }
  console.error("Correspondence attachment request failed", error)
  return NextResponse.json(
    { success: false, error: "Attachment is unavailable." },
    { status: 500 }
  )
}

function safeDownloadName(value: string): string {
  return value.replace(/[\r\n"\\]/g, "-") || "attachment"
}

async function routeInput(input: {
  readonly request: Request
  readonly params: Promise<{ readonly id: string }>
}): Promise<{ readonly projectId: string; readonly attachmentId: string } | null> {
  const { id } = await input.params
  const projectId = new URL(input.request.url).searchParams.get("projectId")?.trim()
  if (!id.trim() || !projectId) return null
  return { projectId, attachmentId: id.trim() }
}

export async function GET(
  request: Request,
  context: { readonly params: Promise<{ readonly id: string }> }
): Promise<Response> {
  const input = await routeInput({ request, params: context.params })
  if (!input) {
    return NextResponse.json(
      { success: false, error: "Project and attachment are required." },
      { status: 400 }
    )
  }
  try {
    const download = await downloadCorrespondenceAttachment(input)
    const preview = new URL(request.url).searchParams.get("preview") === "1"
    if (preview && attachmentPreviewKind(download.contentType) === null) {
      await download.body.body?.cancel()
      return NextResponse.json({ success: false, error: "Preview is not available for this file type." }, { status: 415 })
    }
    const headers = new Headers()
    headers.set("content-type", download.contentType)
    headers.set("content-disposition", `${preview ? "inline" : "attachment"}; filename="${safeDownloadName(download.name)}"`)
    headers.set("x-content-type-options", "nosniff")
    headers.set("cache-control", "private, no-store")
    if (preview) headers.set("content-security-policy", "default-src 'none'; frame-ancestors 'self'")
    return new Response(download.body.body, { status: download.body.status, headers })
  } catch (error) {
    return attachmentResponseError(error)
  }
}

export async function DELETE(
  request: Request,
  context: { readonly params: Promise<{ readonly id: string }> }
): Promise<NextResponse> {
  const input = await routeInput({ request, params: context.params })
  if (!input) {
    return NextResponse.json(
      { success: false, error: "Project and attachment are required." },
      { status: 400 }
    )
  }
  try {
    await deleteStagedCorrespondenceAttachment(input)
    return NextResponse.json({ success: true })
  } catch (error) {
    return attachmentResponseError(error)
  }
}
