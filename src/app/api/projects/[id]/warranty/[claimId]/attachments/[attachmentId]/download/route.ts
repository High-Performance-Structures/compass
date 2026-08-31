import { decodeProjectRouteId } from "@/lib/project-route-id"
import { and, eq } from "drizzle-orm"
import { NextRequest } from "next/server"

import { getDb } from "@/db"
import { projectMembers } from "@/db/schema"
import {
  projectWarrantyClaimAttachments,
  projectWarrantyClaims,
} from "@/db/schema-warranty"
import { getCurrentUser } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import { assertProjectAccess } from "@/lib/project-access"
import { canUseProjectAudience } from "@/lib/project-audience-access"
import { isInternalStaffRole } from "@/lib/user-roles"
import { getWarrantyDriveContext } from "@/lib/warranty/google-drive"
import { isOwnerVisibleWarrantyClaim } from "@/lib/warranty/status"

export async function GET(
  _request: NextRequest,
  {
    params,
  }: {
    readonly params: Promise<{
      readonly id: string
      readonly claimId: string
      readonly attachmentId: string
    }>
  }
): Promise<Response> {
  try {
    const user = await getCurrentUser()
    if (!user) return new Response("Unauthorized", { status: 401 })
    const { id: rawProjectId, claimId, attachmentId } = await params
    const projectId = decodeProjectRouteId(rawProjectId)
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
      if (!canUseProjectAudience(membership?.role ?? null, "owner")) {
        return new Response("File not found", { status: 404 })
      }
    }
    const row = await db
      .select({
        fileName: projectWarrantyClaimAttachments.fileName,
        mimeType: projectWarrantyClaimAttachments.mimeType,
        storageId: projectWarrantyClaimAttachments.storageId,
        ownerVisible: projectWarrantyClaimAttachments.ownerVisible,
        audience: projectWarrantyClaims.audience,
        promotionState: projectWarrantyClaims.promotionState,
      })
      .from(projectWarrantyClaimAttachments)
      .innerJoin(
        projectWarrantyClaims,
        eq(projectWarrantyClaims.id, projectWarrantyClaimAttachments.claimId)
      )
      .where(
        and(
          eq(projectWarrantyClaimAttachments.id, attachmentId),
          eq(projectWarrantyClaimAttachments.claimId, claimId),
          eq(projectWarrantyClaimAttachments.projectId, projectId),
          eq(projectWarrantyClaims.projectId, projectId)
        )
      )
      .limit(1)
      .then((rows) => rows[0] ?? null)
    if (
      !row?.storageId ||
      (!viewerIsInternal &&
        (!row.ownerVisible || !isOwnerVisibleWarrantyClaim(row)))
    ) {
      return new Response("File not found", { status: 404 })
    }
    const drive = await getWarrantyDriveContext({
      db,
      env,
      userEmail: user.email,
      googleEmail: user.googleEmail,
    })
    const response = await drive.client.downloadFile(drive.googleEmail, row.storageId)
    if (!response.ok) {
      return new Response("Unable to download file", { status: response.status })
    }
    return new Response(response.body, {
      headers: {
        "Content-Type": row.mimeType ?? "application/octet-stream",
        "Content-Disposition": `inline; filename="${encodeURIComponent(row.fileName)}"`,
        "Cache-Control": "private, max-age=300",
      },
    })
  } catch (error) {
    console.error("Warranty evidence download failed", error)
    return new Response("File not found", { status: 404 })
  }
}
