import { audienceReadCacheControl, assertAudienceResourceProject } from "@/lib/project-audience-request-server"
import { conversationRequestViewer } from "@/lib/conversations/preview-viewer"
import { and, eq, isNotNull, or, type SQL } from "drizzle-orm"
import { NextRequest } from "next/server"

import { getDb } from "@/db"
import { projectDocuments } from "@/db/schema-documents"
import { getCurrentUser } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import {
  getExportExtension,
  getExportMimeType,
  isGoogleNativeFile,
} from "@/lib/google/mapper"
import { assertProjectAccess } from "@/lib/project-access"
import { projectMemberRole } from "@/lib/project-member-role"
import { canUseProjectAudience } from "@/lib/project-audience-access"
import { isInternalStaffRole } from "@/lib/user-roles"
import { getProjectDocumentDriveContext } from "@/lib/google/project-document-drive"
import { resolveProjectRouteId } from "@/lib/project-route-id"

export async function GET(
  _request: NextRequest,
  {
    params,
  }: {
    readonly params: Promise<{
      readonly id: string
      readonly documentId: string
    }>
  }
): Promise<Response> {
  try {
    const user = await conversationRequestViewer(await getCurrentUser())
    if (!user) return new Response("Unauthorized", { status: 401 })
    const { id: rawProjectId, documentId } = await params
    const projectId = await resolveProjectRouteId(rawProjectId)
    if (!projectId) return new Response("Document not found", { status: 404 })
    await assertAudienceResourceProject(projectId)
    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)
    await assertProjectAccess(db, user, projectId)

    const viewerIsInternal = isInternalStaffRole(user.role)
    // Internal staff see every document; external viewers reach a file only
    // through a visibility flag for an audience they actually belong to.
    let audienceFilter: SQL<unknown> | undefined
    if (!viewerIsInternal) {
      const role = await projectMemberRole(db, user.id, projectId)
      const canOwner = canUseProjectAudience(role, "owner")
      const canSubVendor = canUseProjectAudience(role, "sub_vendor")
      if (!canOwner && !canSubVendor) {
        return new Response("Document not found", { status: 404 })
      }
      audienceFilter =
        canOwner && canSubVendor
          ? or(
              eq(projectDocuments.visibleToOwner, true),
              eq(projectDocuments.visibleToSubVendor, true)
            )
          : canOwner
            ? eq(projectDocuments.visibleToOwner, true)
            : eq(projectDocuments.visibleToSubVendor, true)
    }

    const document = await db
      .select({
        sourceDriveFileId: projectDocuments.sourceDriveFileId,
        sourceFileName: projectDocuments.sourceFileName,
        sourceMimeType: projectDocuments.sourceMimeType,
        status: projectDocuments.status,
      })
      .from(projectDocuments)
      .where(
        and(
          eq(projectDocuments.id, documentId),
          eq(projectDocuments.projectId, projectId),
          audienceFilter,
          eq(projectDocuments.downloadable, true),
          isNotNull(projectDocuments.publishedAt)
        )
      )
      .limit(1)
      .then((rows) => rows[0] ?? null)
    if (!document) return new Response("Document not found", { status: 404 })
    if (
      !viewerIsInternal &&
      document.status !== "current" &&
      document.status !== "superseded"
    ) {
      return new Response("Document not found", { status: 404 })
    }

    const drive = await getProjectDocumentDriveContext({
      db,
      env,
    })
    let response: Response
    let contentType = document.sourceMimeType
    let fileName = document.sourceFileName

    if (isGoogleNativeFile(document.sourceMimeType)) {
      const exportMimeType = getExportMimeType(document.sourceMimeType)
      if (!exportMimeType) {
        return new Response("Document cannot be exported", { status: 400 })
      }
      response = await drive.client.exportFile(
        drive.googleEmail,
        document.sourceDriveFileId,
        exportMimeType
      )
      contentType = exportMimeType
      fileName = `${fileName}${getExportExtension(document.sourceMimeType)}`
    } else {
      response = await drive.client.downloadFile(
        drive.googleEmail,
        document.sourceDriveFileId
      )
    }
    if (!response.ok) {
      return new Response("Unable to download document", { status: response.status })
    }

    return new Response(response.body, {
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `inline; filename="${encodeURIComponent(fileName)}"`,
        "Cache-Control": await audienceReadCacheControl(),
      },
    })
  } catch (error) {
    console.error("Project document download failed", error)
    return new Response("Document not found", { status: 404 })
  }
}
