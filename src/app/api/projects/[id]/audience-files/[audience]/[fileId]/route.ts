import { and, eq } from "drizzle-orm"
import { NextResponse } from "next/server"

import { projectAudienceFiles } from "@/db/schema"
import { requireProjectAudienceFileAccess } from "@/lib/project-audience-file-access"
import { hasActiveExternalProjectResourceGrant } from "@/lib/project-external-resource-access"
import { projectAudienceDriveClient } from "@/lib/project-audience-file-drive"
import type { ProjectAudience } from "@/lib/project-audience-access"
import { getCloudflareContext } from "@/lib/db"

function audienceFromParam(value: string): ProjectAudience | null {
  if (value === "owner") return "owner"
  if (value === "sub-vendor") return "sub_vendor"
  return null
}

function downloadFileName(value: string): string {
  return value.replace(/[\r\n"\\]/g, "-").trim() || "project-file"
}

function projectAudienceAccessFailure(error: unknown): NextResponse {
  const message = error instanceof Error ? error.message : ""
  if (message === "Unauthorized") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  if (message === "Project not found") {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }
  return NextResponse.json({ error: "Forbidden" }, { status: 403 })
}

export async function GET(
  _request: Request,
  {
    params,
  }: {
    readonly params: Promise<{
      readonly id: string
      readonly audience: string
      readonly fileId: string
    }>
  }
): Promise<Response> {
  try {
    const { id: projectId, audience: audienceParam, fileId } = await params
    const audience = audienceFromParam(audienceParam)
    if (!audience) return NextResponse.json({ error: "Not found" }, { status: 404 })

    let access: Awaited<ReturnType<typeof requireProjectAudienceFileAccess>>
    try {
      access = await requireProjectAudienceFileAccess({ projectId, audience })
    } catch (error) {
      return projectAudienceAccessFailure(error)
    }
    if (!access.viewerIsInternal) {
      const granted = await hasActiveExternalProjectResourceGrant({
        db: access.db,
        organizationId: access.organizationId,
        projectId,
        recipientUserId: access.user.id,
        resourceId: fileId,
        resourceType: "audience_file",
      })
      if (!granted) {
        return NextResponse.json({ error: "File not found" }, { status: 404 })
      }
    }
    const file = await access.db
      .select({
        driveFileId: projectAudienceFiles.driveFileId,
        fileName: projectAudienceFiles.fileName,
      })
      .from(projectAudienceFiles)
      .where(
        and(
          eq(projectAudienceFiles.id, fileId),
          eq(projectAudienceFiles.organizationId, access.organizationId),
          eq(projectAudienceFiles.projectId, projectId),
          eq(projectAudienceFiles.uploadStatus, "uploaded")
        )
      )
      .get()
    if (!file?.driveFileId) {
      return NextResponse.json({ error: "File not found" }, { status: 404 })
    }

    const { env } = await getCloudflareContext()
    const drive = await projectAudienceDriveClient({
      db: access.db,
      env: env as unknown as Record<string, string>,
      googleEmail: access.user.googleEmail,
      organizationId: access.organizationId,
      userEmail: access.user.email,
    })
    const source = await drive.client.downloadFile(drive.googleEmail, file.driveFileId)
    if (!source.ok || !source.body) {
      return NextResponse.json({ error: "File download failed" }, { status: 502 })
    }

    return new Response(source.body, {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Disposition": `attachment; filename="${downloadFileName(file.fileName)}"`,
        "Content-Type": "application/octet-stream",
      },
    })
  } catch {
    return NextResponse.json(
      { error: "File download failed" },
      { status: 502 }
    )
  }
}
