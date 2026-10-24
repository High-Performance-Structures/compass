import { conversationRequestViewer } from "@/lib/conversations/preview-viewer"
import { and, eq } from "drizzle-orm"

import { getDb } from "@/db"
import { projectChangeOrders, projectMembers } from "@/db/schema"
import { requireAuth } from "@/lib/auth"
import { isChangeOrderStatus, isExecutedChangeOrderStatus } from "@/lib/change-orders/status"
import { serveSignedDocument } from "@/lib/contracts/serve-signed-document"
import { getCloudflareContext } from "@/lib/db"
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
    const user = await conversationRequestViewer(await requireAuth())
    if (!user) return new Response("Not found", { status: 404 })
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

    return serveSignedDocument({
      db,
      env,
      projectId,
      documentUrl: changeOrder.executedDocumentUrl,
      foxitEnvelopeId: changeOrder.foxitEnvelopeId,
      fileName: executedFileName(changeOrder.changeOrderNumber),
      label: "Change-order document",
    })
  } catch (error) {
    console.error("Executed change-order document download failed", error)
    return new Response("Change-order document not found", { status: 404 })
  }
}
