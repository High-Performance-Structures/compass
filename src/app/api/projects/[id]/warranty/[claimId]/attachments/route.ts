import { resolveProjectRouteId } from "@/lib/project-route-id"
import { and, eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { NextRequest, NextResponse } from "next/server"

import { getDb } from "@/db"
import { projectMembers, projects } from "@/db/schema"
import {
  projectWarrantyClaimAttachments,
  projectWarrantyClaims,
} from "@/db/schema-warranty"
import { recordActivityEvent } from "@/lib/activity-log"
import { requireAuth } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import { isDemoUser } from "@/lib/demo"
import { requireFeaturePermission } from "@/lib/permission-enforcement"
import { assertProjectAccess } from "@/lib/project-access"
import { canUseProjectAudience } from "@/lib/project-audience-access"
import {
  MAX_PHOTO_UPLOAD_BATCH_BYTES,
  MAX_PHOTO_UPLOAD_FILE_BYTES,
  PHOTO_UPLOAD_LIMIT_LABEL,
} from "@/lib/photos/upload-limits"
import { isInternalStaffRole } from "@/lib/user-roles"
import {
  getWarrantyDriveContext,
  warrantyClaimFolderId,
} from "@/lib/warranty/google-drive"
import { isWarrantyProjectStage } from "@/lib/warranty/status"

type UploadResult =
  | { readonly success: true; readonly uploadedCount: number }
  | { readonly success: false; readonly error: string }

function isFile(value: FormDataEntryValue): value is File {
  return typeof value === "object" && value !== null && "arrayBuffer" in value
}

function safeFileName(value: string): string {
  const normalized = value.replace(/[/:\\]/g, "-").trim()
  return normalized || "warranty-evidence"
}

export async function POST(
  request: NextRequest,
  {
    params,
  }: {
    readonly params: Promise<{
      readonly id: string
      readonly claimId: string
    }>
  }
): Promise<NextResponse<UploadResult>> {
  try {
    const user = await requireAuth()
    if (isDemoUser(user.id)) {
      return NextResponse.json(
        { success: false, error: "Demo mode is read-only." },
        { status: 403 }
      )
    }
    const { id: rawProjectId, claimId } = await params
    const projectId = await resolveProjectRouteId(rawProjectId)
    if (!projectId) {
      return NextResponse.json({ success: false, error: "Project not found." }, { status: 404 })
    }
    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)
    const access = await assertProjectAccess(db, user, projectId)
    if (!access.organizationId) {
      return NextResponse.json(
        { success: false, error: "Project not found." },
        { status: 404 }
      )
    }
    const project = await db
      .select({
        id: projects.id,
        status: projects.status,
        jobStatusId: projects.jobStatusId,
        googleDriveFolderId: projects.googleDriveFolderId,
      })
      .from(projects)
      .where(
        and(
          eq(projects.id, projectId),
          eq(projects.organizationId, access.organizationId)
        )
      )
      .limit(1)
      .then((rows) => rows[0] ?? null)
    if (!project) {
      return NextResponse.json(
        { success: false, error: "Project not found." },
        { status: 404 }
      )
    }
    const viewerIsInternal = isInternalStaffRole(user.role)
    if (viewerIsInternal) {
      await requireFeaturePermission(user, "warranty-claims", "update")
    }
    if (!viewerIsInternal) {
      const membership = await db
        .select({ role: projectMembers.role })
        .from(projectMembers)
        .where(
          and(
            eq(projectMembers.projectId, projectId),
            eq(projectMembers.userId, user.id)
          )
        )
        .limit(1)
        .then((rows) => rows[0] ?? null)
      if (
        !canUseProjectAudience(membership?.role ?? null, "owner") ||
        !isWarrantyProjectStage(project)
      ) {
        return NextResponse.json(
          { success: false, error: "Warranty uploads are not available." },
          { status: 403 }
        )
      }
    }
    const claim = await db
      .select()
      .from(projectWarrantyClaims)
      .where(
        and(
          eq(projectWarrantyClaims.id, claimId),
          eq(projectWarrantyClaims.projectId, projectId),
          eq(projectWarrantyClaims.organizationId, access.organizationId)
        )
      )
      .limit(1)
      .then((rows) => rows[0] ?? null)
    if (
      !claim ||
      (!viewerIsInternal && claim.claimantUserId !== user.id) ||
      (!viewerIsInternal && claim.status !== "submitted")
    ) {
      return NextResponse.json(
        { success: false, error: "Warranty claim not found." },
        { status: 404 }
      )
    }

    const formData = await request.formData()
    const files = formData.getAll("files").filter(isFile)
    if (files.length === 0) {
      return NextResponse.json(
        { success: false, error: "Choose at least one file." },
        { status: 400 }
      )
    }
    const oversized = files.find((file) => file.size > MAX_PHOTO_UPLOAD_FILE_BYTES)
    if (oversized) {
      return NextResponse.json(
        {
          success: false,
          error: `${oversized.name} is larger than 50 MB. ${PHOTO_UPLOAD_LIMIT_LABEL}`,
        },
        { status: 400 }
      )
    }
    const totalBytes = files.reduce((total, file) => total + file.size, 0)
    if (totalBytes > MAX_PHOTO_UPLOAD_BATCH_BYTES) {
      return NextResponse.json(
        {
          success: false,
          error: `The selected files exceed the 90 MB batch limit. ${PHOTO_UPLOAD_LIMIT_LABEL}`,
        },
        { status: 400 }
      )
    }

    const drive = await getWarrantyDriveContext({
      db,
      env,
      userEmail: user.email,
      googleEmail: user.googleEmail,
    })
    const folderId = await warrantyClaimFolderId({
      db,
      projectId,
      mappedProjectFolderId: project.googleDriveFolderId,
      claimNumber: claim.claimNumber,
      drive,
    })
    const now = new Date().toISOString()
    for (const file of files) {
      const mimeType = file.type || "application/octet-stream"
      const uploaded = await drive.client.uploadFile(drive.googleEmail, {
        name: safeFileName(file.name),
        mimeType,
        parentId: folderId,
        driveId: drive.driveId ?? undefined,
        data: file,
      })
      await db.insert(projectWarrantyClaimAttachments).values({
        id: crypto.randomUUID(),
        organizationId: access.organizationId,
        projectId,
        claimId,
        fileName: uploaded.name,
        mimeType: uploaded.mimeType,
        fileSize: Number(uploaded.size ?? file.size),
        storageProvider: "google_drive",
        storageId: uploaded.id,
        storageUrl: uploaded.webViewLink ?? null,
        ownerVisible: true,
        createdBy: user.id,
        createdAt: now,
        updatedAt: now,
      })
    }
    await db
      .update(projectWarrantyClaims)
      .set({ updatedAt: now })
      .where(
        and(
          eq(projectWarrantyClaims.id, claimId),
          eq(projectWarrantyClaims.projectId, projectId)
        )
      )
    await recordActivityEvent({
      db,
      organizationId: access.organizationId,
      projectId,
      actor: user,
      category: "warranty",
      action: "warranty.evidence_uploaded",
      entityType: "warranty_claim",
      entityId: claimId,
      summary: `Uploaded ${files.length} evidence ${files.length === 1 ? "file" : "files"} to ${claim.claimNumber}.`,
      metadata: { fileCount: files.length },
    })
    revalidatePath(`/dashboard/projects/${projectId}/warranty`)
    revalidatePath(`/preview/projects/${projectId}/owner/warranty`)
    return NextResponse.json({ success: true, uploadedCount: files.length })
  } catch (error) {
    console.error("Warranty evidence upload failed", error)
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error ? error.message : "Unable to upload evidence.",
      },
      { status: 500 }
    )
  }
}
