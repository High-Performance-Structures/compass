import { and, eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { NextResponse } from "next/server"

import { getDb } from "@/db"
import { dailyLogs, projects, projectVideos } from "@/db/schema"
import { activityActorName, recordActivityEvent } from "@/lib/activity-log"
import { requireAuth } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import {
  findProjectVideoWebsiteUpload,
  verifyProjectVideoWebsiteUpload,
} from "@/lib/email/project-video-attachments"
import { requireOrg } from "@/lib/org-scope"
import { requireFeaturePermission } from "@/lib/permission-enforcement"
import { projectDepartment } from "@/lib/project-branding"
import { youtubeChannelForDepartment } from "@/lib/videos/channel-routing"
import {
  isProjectVideoFile,
  MAX_PROJECT_VIDEO_UPLOAD_BYTES,
  PROJECT_VIDEO_UPLOAD_LIMIT_LABEL,
} from "@/lib/videos/upload-limits"
import { youtubePrivacyStatus } from "@/lib/videos/youtube-audit"

type VideoAudience = "staff" | "owner" | "sub_vendor" | "public"

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function textValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function audienceValue(value: unknown): VideoAudience | null {
  if (
    value === "staff" ||
    value === "owner" ||
    value === "sub_vendor" ||
    value === "public"
  ) {
    return value
  }
  return null
}

export async function POST(
  request: Request,
  { params }: { readonly params: Promise<{ readonly id: string }> }
): Promise<Response> {
  try {
    const body: unknown = await request.json()
    if (!isRecord(body)) {
      return NextResponse.json(
        { success: false, error: "Uploaded video details are missing." },
        { status: 400 }
      )
    }
    const driveFileId = textValue(body.driveFileId)
    const uploadToken = textValue(body.uploadToken)
    const title = textValue(body.title)
    const description = textValue(body.description)
    const audience = audienceValue(body.compassAudience)
    const youtubePrivacy = youtubePrivacyStatus(body.youtubePrivacy)
    const addToDailyLog = body.addToDailyLog !== false
    if (!driveFileId && !uploadToken) {
      return NextResponse.json(
        { success: false, error: "Google Drive upload details are missing." },
        { status: 400 }
      )
    }
    if (uploadToken.length > 128) {
      return NextResponse.json(
        { success: false, error: "Google Drive upload details are invalid." },
        { status: 400 }
      )
    }
    if (title.length === 0 || title.length > 100) {
      return NextResponse.json(
        { success: false, error: "Video title must be 1 to 100 characters." },
        { status: 400 }
      )
    }
    if (description.length > 5_000) {
      return NextResponse.json(
        { success: false, error: "Video description cannot exceed 5,000 characters." },
        { status: 400 }
      )
    }
    if (!audience) {
      return NextResponse.json(
        { success: false, error: "Choose who may receive the video link." },
        { status: 400 }
      )
    }
    if (!youtubePrivacy) {
      return NextResponse.json(
        { success: false, error: "Choose Private, Unlisted, or Public for YouTube." },
        { status: 400 }
      )
    }

    const user = await requireAuth()
    await requireFeaturePermission(user, "project-photos", "update")
    const organizationId = requireOrg(user)
    const { id: projectId } = await params
    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)
    const [project] = await db
      .select({
        id: projects.id,
        projectNumber: projects.projectNumber,
      })
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

    const source = driveFileId
      ? await verifyProjectVideoWebsiteUpload({
          env,
          db,
          organizationId,
          projectId,
          driveFileId,
        })
      : await findProjectVideoWebsiteUpload({
          env,
          db,
          organizationId,
          projectId,
          uploadToken,
        })
    if (!source) {
      return NextResponse.json(
        {
          success: false,
          error: "Google Drive is still finishing this upload.",
        },
        { status: 409, headers: { "Retry-After": "2" } }
      )
    }
    if (!isProjectVideoFile({ fileName: source.fileName, mimeType: source.mimeType })) {
      return NextResponse.json(
        { success: false, error: "The uploaded file is not a supported video." },
        { status: 400 }
      )
    }
    if (source.fileSize > MAX_PROJECT_VIDEO_UPLOAD_BYTES) {
      return NextResponse.json(
        {
          success: false,
          error: `The uploaded video exceeds the ${PROJECT_VIDEO_UPLOAD_LIMIT_LABEL} limit.`,
        },
        { status: 400 }
      )
    }
    const [existing] = await db
      .select({ id: projectVideos.id })
      .from(projectVideos)
      .where(
        and(
          eq(projectVideos.sourceSystem, "compass_web"),
          eq(projectVideos.sourceExternalId, source.driveFileId)
        )
      )
      .limit(1)
    if (existing) {
      return NextResponse.json({ success: true, videoId: existing.id })
    }

    const now = new Date().toISOString()
    const videoId = `web-video-${crypto.randomUUID()}`
    const dailyLogId = addToDailyLog
      ? `web-video-log-${crypto.randomUUID()}`
      : null
    const department = projectDepartment({
      projectId,
      projectNumber: project.projectNumber,
    })
    const submitter = activityActorName(user)
    const videoInsert = db.insert(projectVideos).values({
      id: videoId,
      organizationId,
      projectId,
      title,
      description: description || null,
      department,
      youtubeChannelKey: youtubeChannelForDepartment(department),
      compassAudience: audience,
      youtubePrivacy,
      publishStatus: "pending_review",
      sourceSystem: "compass_web",
      sourceExternalId: source.driveFileId,
      sourceFileName: source.fileName,
      sourceMimeType: source.mimeType,
      sourceFileSize: source.fileSize,
      driveFileId: source.driveFileId,
      driveUrl: source.driveUrl,
      linkedEntityType: dailyLogId ? "daily_log" : null,
      linkedEntityId: dailyLogId,
      youtubeVideoId: null,
      youtubeUrl: null,
      youtubeUploadSessionUrl: null,
      uploadError: null,
      submittedByName: submitter,
      submittedByEmail: user.email,
      reviewedBy: null,
      reviewedAt: null,
      publishedAt: null,
      archivedAt: null,
      deletedAt: null,
      createdAt: now,
      updatedAt: now,
    })
    if (dailyLogId) {
      await db.batch([
        videoInsert,
        db.insert(dailyLogs).values({
          id: dailyLogId,
          projectId,
          authorId: user.id,
          sourceSystem: "compass_web",
          sourceExternalId: `${source.driveFileId}:video`,
          logDate: now.slice(0, 10),
          workCompleted: title,
          notes:
            `Video uploaded by ${submitter} for staff review. ` +
            "The share link will appear here after publication.",
          isClientVisible: false,
          reviewStatus: "needs_review",
          syncStatus: "pending",
          createdAt: now,
          updatedAt: now,
        }),
      ])
    } else {
      await videoInsert.run()
    }

    await recordActivityEvent({
      db,
      organizationId,
      projectId,
      actor: user,
      category: "file",
      action: "project.video_uploaded",
      entityType: "project_video",
      entityId: videoId,
      summary: `Uploaded project video: ${title}.`,
      metadata: {
        fileName: source.fileName,
        fileSize: source.fileSize,
        channel: youtubeChannelForDepartment(department),
        dailyLog: Boolean(dailyLogId),
      },
    })
    revalidatePath(`/dashboard/projects/${projectId}/videos`)
    revalidatePath(`/dashboard/projects/${projectId}/daily-logs`)
    return NextResponse.json({ success: true, videoId })
  } catch (error) {
    console.error("Project video upload completion failed", error)
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Compass could not save the uploaded video.",
      },
      { status: 500 }
    )
  }
}
