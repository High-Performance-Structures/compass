import { resolveProjectRouteId } from "@/lib/project-route-id"
import { and, eq } from "drizzle-orm"
import { NextResponse } from "next/server"

import { getDb } from "@/db"
import { projects } from "@/db/schema"
import { requireAuth } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import { initiateProjectVideoWebsiteUpload } from "@/lib/email/project-video-attachments"
import { requireOrg } from "@/lib/org-scope"
import { requireFeaturePermission } from "@/lib/permission-enforcement"
import {
  isProjectVideoFile,
  MAX_PROJECT_VIDEO_UPLOAD_BYTES,
  projectVideoMimeType,
  PROJECT_VIDEO_UPLOAD_LIMIT_LABEL,
} from "@/lib/videos/upload-limits"

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function textValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function numberValue(value: unknown): number {
  return typeof value === "number" ? value : Number.NaN
}

export async function POST(
  request: Request,
  { params }: { readonly params: Promise<{ readonly id: string }> }
): Promise<Response> {
  try {
    const body: unknown = await request.json()
    if (!isRecord(body)) {
      return NextResponse.json(
        { success: false, error: "Video upload details are missing." },
        { status: 400 }
      )
    }
    const fileName = textValue(body.fileName)
    const requestedMimeType = textValue(body.mimeType)
    const fileSize = numberValue(body.fileSize)
    if (!isProjectVideoFile({ fileName, mimeType: requestedMimeType })) {
      return NextResponse.json(
        { success: false, error: "Choose a supported video file." },
        { status: 400 }
      )
    }
    if (
      !Number.isSafeInteger(fileSize) ||
      fileSize <= 0 ||
      fileSize > MAX_PROJECT_VIDEO_UPLOAD_BYTES
    ) {
      return NextResponse.json(
        {
          success: false,
          error: `Videos must be larger than 0 bytes and no more than ${PROJECT_VIDEO_UPLOAD_LIMIT_LABEL}.`,
        },
        { status: 400 }
      )
    }

    const user = await requireAuth()
    await requireFeaturePermission(user, "project-photos", "update")
    const organizationId = requireOrg(user)
    const { id: rawProjectId } = await params
    const projectId = await resolveProjectRouteId(rawProjectId)
    if (!projectId) {
      return NextResponse.json({ success: false, error: "Project not found." }, { status: 404 })
    }
    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)
    const [project] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(
        and(
          eq(projects.id, projectId),
          eq(projects.organizationId, organizationId)
        )
      )
      .limit(1)
    if (!project) {
      return NextResponse.json(
        { success: false, error: "Project not found." },
        { status: 404 }
      )
    }

    const mimeType = projectVideoMimeType({
      fileName,
      mimeType: requestedMimeType,
    })
    const session = await initiateProjectVideoWebsiteUpload({
      env,
      db,
      organizationId,
      projectId,
      fileName,
      mimeType,
      fileSize,
    })
    return NextResponse.json(
      {
        success: true,
        uploadUrl: session.uploadUrl,
        uploadToken: session.uploadToken,
        mimeType,
      },
      { headers: { "Cache-Control": "no-store" } }
    )
  } catch (error) {
    console.error("Project video upload session failed", error)
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Compass could not start the video upload.",
      },
      { status: 500 }
    )
  }
}
