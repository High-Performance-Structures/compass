import { resolveProjectRouteId } from "@/lib/project-route-id"
import { and, eq } from "drizzle-orm"
import { type NextRequest } from "next/server"

import { getDb } from "@/db"
import { projectMembers, projectVideos } from "@/db/schema"
import { requireAuth } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import { downloadProjectVideoFile } from "@/lib/email/project-video-attachments"
import {
  canUseProjectAudience,
  type ProjectAudience,
} from "@/lib/project-audience-access"
import { assertProjectAccess } from "@/lib/project-access"
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
    const project = await assertProjectAccess(db, user, projectId)
    if (!project.organizationId) {
      return new Response("Video not found", { status: 404 })
    }
    const internal = isInternalStaffRole(user.role)
    if (!internal) {
      if (!requestedAudience) {
        return new Response("Video not found", { status: 404 })
      }
      const [membership] = await db
        .select({ role: projectMembers.role })
        .from(projectMembers)
        .where(
          and(
            eq(projectMembers.projectId, projectId),
            eq(projectMembers.userId, user.id)
          )
        )
        .limit(1)
      if (!canUseProjectAudience(membership?.role ?? null, requestedAudience)) {
        return new Response("Video not found", { status: 404 })
      }
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
        and(
          eq(projectVideos.id, videoId),
          eq(projectVideos.projectId, projectId)
        )
      )
      .limit(1)
    const allowedExternally =
      video?.publishStatus === "published" &&
      (video.audience === requestedAudience || video.audience === "public")
    if (!video || (!internal && !allowedExternally)) {
      return new Response("Video not found", { status: 404 })
    }
    // YouTube's published copy is transcoded for reliable browser audio/video.
    // Keep this authenticated Compass URL stable so existing Daily Log links
    // also benefit from the compatible playback copy.
    if (
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
