import { and, eq } from "drizzle-orm"

import { getDb } from "@/db"
import { projectChangeOrders, projectMembers, projects } from "@/db/schema"
import { requireAuth } from "@/lib/auth"
import { isChangeOrderStatus, isExecutedChangeOrderStatus } from "@/lib/change-orders/status"
import { executedDocumentSource } from "@/lib/contracts/executed-document-source"
import { getCloudflareContext } from "@/lib/db"
import { downloadFoxitExecutedEnvelope } from "@/lib/foxit/esign"
import {
  getExportExtension,
  getExportMimeType,
  isGoogleNativeFile,
} from "@/lib/google/mapper"
import { getProjectDocumentDriveContext } from "@/lib/google/project-document-drive"
import { isDriveItemWithinProjectFolder } from "@/lib/google/project-folder-boundary"
import { assertProjectAccess } from "@/lib/project-access"
import { canUseProjectAudience } from "@/lib/project-audience-access"
import { resolveProjectRouteId } from "@/lib/project-route-id"
import { isInternalStaffRole } from "@/lib/user-roles"

function executedFileName(changeOrderNumber: string): string {
  return `${changeOrderNumber}-executed.pdf`.replace(/[^a-zA-Z0-9._-]/g, "-")
}

export async function GET(
  _request: Request,
  context: {
    readonly params: Promise<{
      readonly id: string
      readonly changeOrderId: string
    }>
  }
): Promise<Response> {
  try {
    const user = await requireAuth()
    const { id: rawProjectId, changeOrderId } = await context.params
    const projectId = await resolveProjectRouteId(rawProjectId)
    if (!projectId) {
      return new Response("Change-order document not found", { status: 404 })
    }

    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)
    await assertProjectAccess(db, user, projectId)
    const internal = isInternalStaffRole(user.role)

    if (!internal) {
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
      if (!canUseProjectAudience(membership?.role ?? null, "owner")) {
        return new Response("Change-order document not found", { status: 404 })
      }
    }

    const changeOrder = await db
      .select({
        changeOrderNumber: projectChangeOrders.changeOrderNumber,
        audience: projectChangeOrders.audience,
        status: projectChangeOrders.status,
        foxitEnvelopeId: projectChangeOrders.foxitEnvelopeId,
        executedDocumentUrl: projectChangeOrders.executedDocumentUrl,
      })
      .from(projectChangeOrders)
      .where(
        and(
          eq(projectChangeOrders.id, changeOrderId),
          eq(projectChangeOrders.projectId, projectId)
        )
      )
      .limit(1)
      .then((rows) => rows[0] ?? null)
    if (
      !changeOrder ||
      !isChangeOrderStatus(changeOrder.status) ||
      !isExecutedChangeOrderStatus(changeOrder.status) ||
      (!internal && changeOrder.audience !== "owner")
    ) {
      return new Response("Change-order document not found", { status: 404 })
    }

    const source = executedDocumentSource(changeOrder.executedDocumentUrl)
    if (!source) {
      return new Response("Change-order document not found", { status: 404 })
    }

    if (source.kind === "foxit") {
      if (
        !changeOrder.foxitEnvelopeId ||
        changeOrder.foxitEnvelopeId !== source.envelopeId
      ) {
        return new Response("Change-order document not found", { status: 404 })
      }
      const foxit = await downloadFoxitExecutedEnvelope({
        clientId: env.FOXIT_ESIGN_CLIENT_ID,
        clientSecret: env.FOXIT_ESIGN_CLIENT_SECRET,
        envelopeId: source.envelopeId,
      })
      if (!foxit.ok || !foxit.body) {
        return new Response("Change-order document is temporarily unavailable", {
          status: 502,
        })
      }
      return new Response(foxit.body, {
        headers: {
          "Content-Type": foxit.headers.get("Content-Type") ?? "application/pdf",
          "Content-Disposition": `inline; filename="${executedFileName(changeOrder.changeOrderNumber)}"`,
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
        },
      })
    }

    if (source.kind === "external") {
      return new Response(null, {
        status: 302,
        headers: {
          Location: source.url,
          "Cache-Control": "private, no-store",
        },
      })
    }

    const project = await db
      .select({ folderId: projects.googleDriveFolderId })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1)
      .then((rows) => rows[0] ?? null)
    if (!project?.folderId) {
      return new Response("Change-order document not found", { status: 404 })
    }

    const drive = await getProjectDocumentDriveContext({ db, env })
    const withinProject = await isDriveItemWithinProjectFolder({
      client: drive.client,
      googleEmail: drive.googleEmail,
      itemId: source.fileId,
      projectFolderId: project.folderId,
    })
    if (!withinProject) {
      return new Response("Change-order document not found", { status: 404 })
    }

    const file = await drive.client.getFile(drive.googleEmail, source.fileId)
    if (file.trashed) {
      return new Response("Change-order document not found", { status: 404 })
    }

    let response: Response
    let contentType = file.mimeType
    let fileName = file.name
    if (isGoogleNativeFile(file.mimeType)) {
      const exportMimeType = getExportMimeType(file.mimeType)
      if (!exportMimeType) {
        return new Response("Change-order document cannot be exported", {
          status: 400,
        })
      }
      response = await drive.client.exportFile(
        drive.googleEmail,
        source.fileId,
        exportMimeType
      )
      contentType = exportMimeType
      fileName = `${fileName}${getExportExtension(file.mimeType)}`
    } else {
      response = await drive.client.downloadFile(
        drive.googleEmail,
        source.fileId
      )
    }
    if (!response.ok || !response.body) {
      return new Response("Change-order document is temporarily unavailable", {
        status: 502,
      })
    }

    return new Response(response.body, {
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `inline; filename="${encodeURIComponent(fileName)}"`,
        "Cache-Control": "private, max-age=300",
        "X-Content-Type-Options": "nosniff",
      },
    })
  } catch (error) {
    console.error("Executed change-order document download failed", error)
    return new Response("Change-order document not found", { status: 404 })
  }
}
