"use server"

import { and, desc, eq, isNull } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import { getDb } from "@/db"
import {
  dailyLogs,
  projects,
  projectVideos,
  youtubeChannelConnections,
} from "@/db/schema"
import { recordActivityEvent } from "@/lib/activity-log"
import { requireAuth } from "@/lib/auth"
import { decrypt } from "@/lib/crypto"
import { getCloudflareContext } from "@/lib/db"
import { dailyLogDeleteStatement, updateDailyLogFromVideo } from "@/lib/domain/field/store"
import {
  deleteYoutubeChannelConnection,
  projectVideoDeleteStatement,
  updateLiveProjectVideo,
  updateProjectVideo,
  updateYoutubeChannelConnection,
} from "@/lib/domain/media/store"
import { downloadProjectVideoFile } from "@/lib/email/project-video-attachments"
import {
  getYoutubeOAuthConfig,
  refreshYoutubeAccessToken,
  uploadVideoToYoutube,
  youtubeChannelKey,
  youtubeTokenSalt,
} from "@/lib/google/youtube"
import { requireOrg } from "@/lib/org-scope"
import { requireFeaturePermission } from "@/lib/permission-enforcement"
import { youtubePrivacyStatus } from "@/lib/videos/youtube-audit"
import { requireUserContext } from "@/lib/server/action-context"

type ProjectVideoAudience = "staff" | "owner" | "sub_vendor" | "public"

export type ProjectVideoItem = {
  readonly id: string
  readonly title: string
  readonly description: string | null
  readonly department: string
  readonly youtubeChannelKey: string
  readonly compassAudience: string
  readonly youtubePrivacy: string
  readonly publishStatus: string
  readonly sourceSystem: string
  readonly sourceFileName: string
  readonly sourceMimeType: string
  readonly sourceFileSize: number
  readonly driveUrl: string | null
  readonly linkedEntityType: string | null
  readonly linkedEntityId: string | null
  readonly youtubeUrl: string | null
  readonly uploadError: string | null
  readonly submittedByName: string | null
  readonly createdAt: string
}

export type ProjectVideoWorkspace = {
  readonly project: {
    readonly id: string
    readonly name: string
    readonly projectNumber: string | null
  }
  readonly videos: readonly ProjectVideoItem[]
  readonly channels: readonly {
    readonly channelKey: string
    readonly channelTitle: string
    readonly status: string
  }[]
}

type VideoActionResult =
  | { readonly success: true }
  | { readonly success: false; readonly error: string }

async function projectVideoDb(
  projectId: string,
  action: "read" | "update"
): Promise<ReturnType<typeof getDb>> {
  const { user, db } = await requireUserContext()
  await requireFeaturePermission(user, "project-photos", action)
  const organizationId = requireOrg(user)
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
  if (!project) throw new Error("Project not found")
  return db
}

function audience(value: string): ProjectVideoAudience | null {
  switch (value) {
    case "staff":
    case "owner":
    case "sub_vendor":
    case "public":
      return value
    default:
      return null
  }
}

export async function getProjectVideoWorkspace(
  projectId: string
): Promise<ProjectVideoWorkspace> {
  const db = await projectVideoDb(projectId, "read")
  const [project] = await db
    .select({
      id: projects.id,
      name: projects.name,
      projectNumber: projects.projectNumber,
      organizationId: projects.organizationId,
    })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1)
  if (!project?.organizationId) throw new Error("Project not found")

  const [videos, channels] = await Promise.all([
    db
    .select({
      id: projectVideos.id,
      title: projectVideos.title,
      description: projectVideos.description,
      department: projectVideos.department,
      youtubeChannelKey: projectVideos.youtubeChannelKey,
      compassAudience: projectVideos.compassAudience,
      youtubePrivacy: projectVideos.youtubePrivacy,
      publishStatus: projectVideos.publishStatus,
      sourceSystem: projectVideos.sourceSystem,
      sourceFileName: projectVideos.sourceFileName,
      sourceMimeType: projectVideos.sourceMimeType,
      sourceFileSize: projectVideos.sourceFileSize,
      driveUrl: projectVideos.driveUrl,
      linkedEntityType: projectVideos.linkedEntityType,
      linkedEntityId: projectVideos.linkedEntityId,
      youtubeUrl: projectVideos.youtubeUrl,
      uploadError: projectVideos.uploadError,
      submittedByName: projectVideos.submittedByName,
      createdAt: projectVideos.createdAt,
    })
    .from(projectVideos)
    .where(
      and(
        eq(projectVideos.projectId, projectId),
        isNull(projectVideos.deletedAt)
      )
    )
      .orderBy(desc(projectVideos.createdAt)),
    db
      .select({
        channelKey: youtubeChannelConnections.channelKey,
        channelTitle: youtubeChannelConnections.channelTitle,
        status: youtubeChannelConnections.status,
      })
      .from(youtubeChannelConnections)
      .where(eq(youtubeChannelConnections.organizationId, project.organizationId)),
  ])

  return {
    project: {
      id: project.id,
      name: project.name,
      projectNumber: project.projectNumber,
    },
    videos,
    channels,
  }
}

export async function updateProjectVideoReview(input: {
  readonly projectId: string
  readonly videoId: string
  readonly title: string
  readonly description: string
  readonly compassAudience: string
  readonly youtubePrivacy: string
}): Promise<VideoActionResult> {
  try {
    const db = await projectVideoDb(input.projectId, "update")
    const [existing] = await db
      .select({ publishStatus: projectVideos.publishStatus })
      .from(projectVideos)
      .where(
        and(
          eq(projectVideos.id, input.videoId),
          eq(projectVideos.projectId, input.projectId),
          isNull(projectVideos.deletedAt)
        )
      )
      .limit(1)
    if (!existing) return { success: false, error: "Video not found." }
    if (existing.publishStatus === "published" || existing.publishStatus === "uploading") {
      return { success: false, error: "A published or uploading video cannot be re-reviewed." }
    }
    const normalizedAudience = audience(input.compassAudience)
    if (!normalizedAudience) {
      return { success: false, error: "Choose a valid video audience." }
    }
    const privacy = youtubePrivacyStatus(input.youtubePrivacy)
    if (!privacy) {
      return {
        success: false,
        error: "Choose Private, Unlisted, or Public for YouTube.",
      }
    }
    const title = input.title.trim()
    if (title.length === 0 || title.length > 100) {
      return { success: false, error: "Video title must be 1 to 100 characters." }
    }
    const description = input.description.trim()
    if (description.length > 5_000) {
      return { success: false, error: "Video description cannot exceed 5,000 characters." }
    }
    const user = await requireAuth()
    const now = new Date().toISOString()
    await updateLiveProjectVideo(db, {
      videoId: input.videoId,
      projectId: input.projectId,
      values: {
        title,
        description: description.length > 0 ? description : null,
        compassAudience: normalizedAudience,
        youtubePrivacy: privacy,
        publishStatus: "ready_for_upload",
        reviewedBy: user.id,
        reviewedAt: now,
        uploadError: null,
        updatedAt: now,
      },
    })
    revalidatePath(`/dashboard/projects/${input.projectId}/videos`)
    return { success: true }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Could not save video review.",
    }
  }
}

export async function disconnectYoutubeChannel(input: {
  readonly projectId: string
  readonly channelKey: string
}): Promise<
  | { readonly success: true; readonly revoked: boolean }
  | { readonly success: false; readonly error: string }
> {
  try {
    const user = await requireAuth()
    const organizationId = requireOrg(user)
    const db = await projectVideoDb(input.projectId, "update")
    const channelKey = youtubeChannelKey(input.channelKey)
    if (!channelKey) {
      return { success: false, error: "YouTube channel is invalid." }
    }
    const [connection] = await db
      .select()
      .from(youtubeChannelConnections)
      .where(
        and(
          eq(youtubeChannelConnections.organizationId, organizationId),
          eq(youtubeChannelConnections.channelKey, channelKey)
        )
      )
      .limit(1)
    if (!connection) return { success: true, revoked: true }

    const { env } = await getCloudflareContext()
    const config = getYoutubeOAuthConfig(
      env,
      "https://compass.openrangeconstruction.ltd"
    )
    let revoked = false
    try {
      const refreshToken = await decrypt(
        connection.refreshTokenEncrypted,
        config.tokenEncryptionKey,
        youtubeTokenSalt(organizationId, channelKey)
      )
      const response = await fetch("https://oauth2.googleapis.com/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token: refreshToken }),
      })
      revoked = response.ok
    } catch {
      revoked = false
    }

    await deleteYoutubeChannelConnection(db, connection.id)
    revalidatePath(`/dashboard/projects/${input.projectId}/videos`)
    return { success: true, revoked }
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "YouTube channel could not be disconnected.",
    }
  }
}

export async function archiveProjectVideo(input: {
  readonly projectId: string
  readonly videoId: string
}): Promise<VideoActionResult> {
  try {
    const db = await projectVideoDb(input.projectId, "update")
    const now = new Date().toISOString()
    await updateLiveProjectVideo(db, {
      videoId: input.videoId,
      projectId: input.projectId,
      values: { publishStatus: "archived", archivedAt: now, updatedAt: now },
    })
    revalidatePath(`/dashboard/projects/${input.projectId}/videos`)
    return { success: true }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Could not archive video.",
    }
  }
}

export async function deleteProjectVideo(input: {
  readonly projectId: string
  readonly videoId: string
}): Promise<VideoActionResult> {
  try {
    const db = await projectVideoDb(input.projectId, "update")
    const now = new Date().toISOString()
    const [video] = await db
      .select({
        publishStatus: projectVideos.publishStatus,
        linkedEntityType: projectVideos.linkedEntityType,
        linkedEntityId: projectVideos.linkedEntityId,
      })
      .from(projectVideos)
      .where(
        and(
          eq(projectVideos.id, input.videoId),
          eq(projectVideos.projectId, input.projectId),
          isNull(projectVideos.deletedAt)
        )
      )
      .limit(1)
    if (!video) return { success: false, error: "Video not found." }
    const deleteVideo = projectVideoDeleteStatement(db, {
      videoId: input.videoId,
      projectId: input.projectId,
      now,
    })
    if (
      video.publishStatus !== "published" &&
      video.linkedEntityType === "daily_log" &&
      video.linkedEntityId
    ) {
      await db.batch([
        deleteVideo,
        dailyLogDeleteStatement(db, {
          dailyLogId: video.linkedEntityId,
          projectId: input.projectId,
        }),
      ])
    } else {
      await db.batch([deleteVideo])
    }
    revalidatePath(`/dashboard/projects/${input.projectId}/videos`)
    return { success: true }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Could not delete video.",
    }
  }
}

export async function publishProjectVideo(input: {
  readonly projectId: string
  readonly videoId: string
  readonly confirmPublic: boolean
}): Promise<VideoActionResult> {
  const user = await requireAuth()
  const organizationId = requireOrg(user)
  let db: Awaited<ReturnType<typeof projectVideoDb>> | null = null
  try {
    db = await projectVideoDb(input.projectId, "update")
    const [video] = await db
      .select()
      .from(projectVideos)
      .where(
        and(
          eq(projectVideos.id, input.videoId),
          eq(projectVideos.projectId, input.projectId),
          eq(projectVideos.organizationId, organizationId),
          isNull(projectVideos.deletedAt)
        )
      )
      .limit(1)
    if (!video) return { success: false, error: "Video not found." }
    if (video.publishStatus !== "ready_for_upload" && video.publishStatus !== "upload_failed") {
      return { success: false, error: "Review and save this video before publishing." }
    }
    if (video.youtubePrivacy === "public" && !input.confirmPublic) {
      return { success: false, error: "Confirm public publication before uploading." }
    }
    const channelKey = youtubeChannelKey(video.youtubeChannelKey)
    if (!channelKey) return { success: false, error: "Video channel is invalid." }
    const [connection] = await db
      .select()
      .from(youtubeChannelConnections)
      .where(
        and(
          eq(youtubeChannelConnections.organizationId, organizationId),
          eq(youtubeChannelConnections.channelKey, channelKey),
          eq(youtubeChannelConnections.status, "connected")
        )
      )
      .limit(1)
    if (!connection) {
      return { success: false, error: "Connect the assigned YouTube channel first." }
    }

    const now = new Date().toISOString()
    await updateProjectVideo(db, video.id, { publishStatus: "uploading", uploadError: null, updatedAt: now })
    const { env } = await getCloudflareContext()
    const config = getYoutubeOAuthConfig(
      env,
      "https://compass.openrangeconstruction.ltd"
    )
    const refreshToken = await decrypt(
      connection.refreshTokenEncrypted,
      config.tokenEncryptionKey,
      youtubeTokenSalt(organizationId, channelKey)
    )
    const accessToken = await refreshYoutubeAccessToken({ config, refreshToken })
    const source = await downloadProjectVideoFile({
      env,
      db,
      organizationId,
      driveFileId: video.driveFileId,
    })
    if (!source.body) throw new Error("The staged video has no content.")
    const uploaded = await uploadVideoToYoutube({
      accessToken,
      title: video.title,
      description: video.description,
      privacy:
        video.youtubePrivacy === "public"
          ? "public"
          : video.youtubePrivacy === "unlisted"
            ? "unlisted"
            : "private",
      mimeType: video.sourceMimeType,
      fileSize: video.sourceFileSize,
      body: source.body,
      onSessionCreated: async (sessionUrl) => {
        if (db) await updateProjectVideo(db, video.id, { youtubeUploadSessionUrl: sessionUrl, updatedAt: now })
      },
    })
    const publishedAt = new Date().toISOString()
    await updateProjectVideo(db, video.id, {
      publishStatus: "published",
      youtubeVideoId: uploaded.videoId,
      youtubeUrl: uploaded.url,
      youtubeUploadSessionUrl: null,
      uploadError: null,
      publishedAt,
      updatedAt: publishedAt,
    })
    await updateYoutubeChannelConnection(db, connection.id, {
      lastUploadAt: publishedAt,
      lastError: null,
      updatedAt: publishedAt,
    })

    if (video.linkedEntityType === "daily_log" && video.linkedEntityId) {
      const [dailyLog] = await db
        .select({ notes: dailyLogs.notes })
        .from(dailyLogs)
        .where(eq(dailyLogs.id, video.linkedEntityId))
        .limit(1)
      const shareUrl =
        video.compassAudience === "staff"
          ? `https://compass.openrangeconstruction.ltd/api/projects/${encodeURIComponent(input.projectId)}/videos/${encodeURIComponent(video.id)}`
          : uploaded.url
      const notes = [
        dailyLog?.notes?.replace(
          "The share link will appear here after publication.",
          ""
        ).trim(),
        `Video: ${video.title}`,
        shareUrl,
      ]
        .filter((value): value is string => Boolean(value))
        .join("\n")
      await updateDailyLogFromVideo(db, video.linkedEntityId, {
        notes,
        isClientVisible:
          video.compassAudience === "owner" ||
          video.compassAudience === "public",
        syncStatus: "synced",
        updatedAt: publishedAt,
      })
    }
    await recordActivityEvent({
      db,
      organizationId,
      projectId: input.projectId,
      actor: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
      },
      category: "file",
      action: "project_video.published",
      entityType: "project_video",
      entityId: video.id,
      summary: `Published “${video.title}” to ${connection.channelTitle}.`,
      metadata: {
        audience: video.compassAudience,
        privacy: video.youtubePrivacy,
        youtubeVideoId: uploaded.videoId,
      },
      createdAt: publishedAt,
    })
    revalidatePath(`/dashboard/projects/${input.projectId}/videos`)
    revalidatePath(`/dashboard/projects/${input.projectId}/daily-logs`)
    return { success: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not publish video."
    if (db) {
      const now = new Date().toISOString()
      await updateProjectVideo(db, input.videoId, { publishStatus: "upload_failed", uploadError: message, updatedAt: now })
    }
    return { success: false, error: message }
  }
}
