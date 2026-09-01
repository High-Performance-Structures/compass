import { and, eq, isNotNull } from "drizzle-orm"
import { NextRequest } from "next/server"

import { getDb } from "@/db"
import { projectMembers } from "@/db/schema"
import { projectDocuments } from "@/db/schema-documents"
import { getCurrentUser } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import {
  getExportExtension,
  getExportMimeType,
  isGoogleNativeFile,
} from "@/lib/google/mapper"
import { assertProjectAccess } from "@/lib/project-access"
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
    const user = await getCurrentUser()
    if (!user) return new Response("Unauthorized", { status: 401 })
    const { id: rawProjectId, documentId } = await params
    const projectId = await resolveProjectRouteId(rawProjectId)
    if (!projectId) return new Response("Document not found", { status: 404 })
    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)
    await assertProjectAccess(db, user, projectId)

    const viewerIsInternal = isInternalStaffRole(user.role)
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
      const role = membership?.role ?? null
      if (
        !canUseProjectAudience(role, "owner") &&
        !canUseProjectAudience(role, "sub_vendor")
      ) {
        return new Response("Document not found", { status: 404 })
      }
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
          eq(projectDocuments.audience, "project_team"),
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
        "Cache-Control": "private, max-age=300",
      },
    })
  } catch (error) {
    console.error("Project document download failed", error)
    return new Response("Document not found", { status: 404 })
  }
}
