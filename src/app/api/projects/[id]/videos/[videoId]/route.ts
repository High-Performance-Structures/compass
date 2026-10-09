import { resolveProjectRouteId } from "@/lib/project-route-id"
import { and, eq, or } from "drizzle-orm"
import { type NextRequest } from "next/server"

import { getDb } from "@/db"
import { projectVideos } from "@/db/schema"
import { requireAuth } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import { downloadProjectVideoFile } from "@/lib/email/project-video-attachments"
import type { ProjectAudience } from "@/lib/project-audience-access"
import { hasActiveExternalProjectResourceGrant } from "@/lib/project-external-resource-access"
import {
  assertProjectAccess,
  getActiveOrganization,
  getProjectAudienceAccessRecord,
} from "@/lib/project-access"
import { isInternalStaffRole } from "@/lib/user-roles"

function audienceValue(value: string | null): ProjectAudience | null {
  if (value === "owner" || value === "sub_vendor") return value
  return null
}

function safeFileName(value: string): string {
  return value.replace(/["\r\n]/g, "_")
}

export async function GET(
  request: NextRequest,
  {
    params,
  }: {
    readonly params: Promise<{
      readonly id: string
      readonly videoId: string
    }>
  }
): Promise<Response> {
  try {
    const user = await requireAuth()
    const { id: rawProjectId, videoId } = await params
    const projectId = await resolveProjectRouteId(rawProjectId)
    if (!projectId) return new Response("Video not found", { status: 404 })
    const requestedAudience = audienceValue(
      request.nextUrl.searchParams.get("audience")
    )
    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)
    const organization = await getActiveOrganization(db, user)
    const internal =
      (organization?.type === "internal" || organization?.type === "demo") &&
      isInternalStaffRole(user.role)
    if (!internal && (!requestedAudience || organization?.type !== "client")) {
      return new Response("Video not found", { status: 404 })
    }
    const project = internal
      ? await assertProjectAccess(db, user, projectId)
      : requestedAudience === null
        ? null
        : await getProjectAudienceAccessRecord(
            db,
            user,
            projectId,
            requestedAudience
          )
    if (!project?.organizationId) {
      return new Response("Video not found", { status: 404 })
    }
    if (!internal) {
      const granted = await hasActiveExternalProjectResourceGrant({
        db,
        organizationId: project.organizationId,
        projectId,
        recipientUserId: user.id,
        resourceId: videoId,
        resourceType: "video",
      })
      if (!granted) return new Response("Video not found", { status: 404 })
    }
    const [video] = await db
      .select({
        driveFileId: projectVideos.driveFileId,
        fileName: projectVideos.sourceFileName,
        mimeType: projectVideos.sourceMimeType,
        audience: projectVideos.compassAudience,
        publishStatus: projectVideos.publishStatus,
        youtubeUrl: projectVideos.youtubeUrl,
        youtubePrivacy: projectVideos.youtubePrivacy,
      })
      .from(projectVideos)
      .where(
        internal || requestedAudience === null
          ? and(
              eq(projectVideos.id, videoId),
              eq(projectVideos.projectId, projectId)
            )
          : and(
              eq(projectVideos.id, videoId),
              eq(projectVideos.projectId, projectId),
              eq(projectVideos.publishStatus, "published"),
              or(
                eq(projectVideos.compassAudience, requestedAudience),
                eq(projectVideos.compassAudience, "public")
              )
            )
      )
      .limit(1)
    if (!video) {
      return new Response("Video not found", { status: 404 })
    }
    // YouTube's published copy is transcoded for reliable browser audio/video.
    // Keep this authenticated Compass URL stable so existing Daily Log links
    // also benefit from the compatible playback copy.
    if (
      internal &&
      video.publishStatus === "published" &&
      video.youtubeUrl &&
      video.audience !== "staff" &&
      video.youtubePrivacy !== "private"
    ) {
      return Response.redirect(video.youtubeUrl, 302)
    }
    const response = await downloadProjectVideoFile({
      env,
      db,
      organizationId: project.organizationId,
      driveFileId: video.driveFileId,
      range: request.headers.get("range") ?? undefined,
    })
    const responseHeaders: Record<string, string> = {
      "Content-Type": video.mimeType,
      "Content-Disposition": `inline; filename="${safeFileName(video.fileName)}"`,
      "Cache-Control": "private, max-age=300",
      "X-Content-Type-Options": "nosniff",
      "Accept-Ranges": response.headers.get("Accept-Ranges") ?? "bytes",
    }
    const contentRange = response.headers.get("Content-Range")
    const contentLength = response.headers.get("Content-Length")
    if (contentRange) responseHeaders["Content-Range"] = contentRange
    if (contentLength) responseHeaders["Content-Length"] = contentLength
    return new Response(response.body, {
      status: response.status,
      headers: responseHeaders,
    })
  } catch (error) {
    console.error("Project video stream failed", error)
    return new Response("Video could not be loaded", { status: 500 })
  }
}
