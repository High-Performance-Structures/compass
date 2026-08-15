import { and, eq } from "drizzle-orm"
import { type NextRequest } from "next/server"

import { getDb } from "@/db"
import { projectVideos } from "@/db/schema"
import { requireAuth } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import { downloadProjectVideoFile } from "@/lib/email/project-video-attachments"
import { hasActiveExternalProjectResourceGrant } from "@/lib/project-external-resource-access"
import { assertProjectAccess } from "@/lib/project-access"
import { isInternalStaffRole } from "@/lib/user-roles"

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
    const { id: projectId, videoId } = await params
    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)
    const project = await assertProjectAccess(db, user, projectId)
    if (!project.organizationId) {
      return new Response("Video not found", { status: 404 })
    }
    const internal = isInternalStaffRole(user.role)
    if (!internal) {
      const granted = await hasActiveExternalProjectResourceGrant({
        db,
        organizationId: project.organizationId,
        projectId,
        recipientUserId: user.id,
        resourceId: videoId,
        resourceType: "video",
      })
      if (!granted) {
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
    const externallyStreamable =
      video?.publishStatus === "published" && video.driveFileId !== null
    if (!video || (!internal && !externallyStreamable)) {
      return new Response("Video not found", { status: 404 })
    }
    // Non-public external playback is deliberately streamed through Compass.
    // Redirecting to an unlisted provider URL would let a recipient forward it.
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
