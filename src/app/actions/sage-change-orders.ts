"use server"

import { and, eq, inArray } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import { projects } from "@/db/schema"
import { sageChangeOrderExports } from "@/db/schema-sage"
import { actionFailure, type ActionResult } from "@/lib/action-result"
import { activityActorName, recordActivityEvent } from "@/lib/activity-log"
import { insertChangeOrderHistoryStatement } from "@/lib/domain/estimates/store"
import { sageChangeOrderNumberError } from "@/lib/domain/sage-bridge/change-order-rules"
import { queueSageChangeOrderExports } from "@/lib/domain/sage-bridge/change-order-store"
import { loadSageChangeOrderSendView, type SageChangeOrderSendView } from "@/lib/financials/sage-change-order-send-server"
import { formatCents, toCents } from "@/lib/format"
import { sageChangeOrderWritePayload, sageChangeOrderWritesEnabled } from "@/lib/sage/change-order-write"
import { canSendToSage } from "@/lib/sage/sage-send-access"
import { projectContext } from "@/lib/server/action-context"

/*
 * Send to Sage for change orders and variances: any office staff with
 * finance access may queue an approved change order for the Sage writer,
 * which adds it to Sage as an approved prime change order. Who sent it is
 * kept on the change order's history and in Activity.
 */

export type SageChangeOrderSendState = SageChangeOrderSendView & {
  /** Compass's Sage change order switch is on. */
  readonly writesEnabled: boolean
}

const OFFICE_STAFF_ONLY = "Only office staff with finance access can send change orders to Sage."

/** The send confirmation for a project's approved change orders (or only `changeOrderIds`). */
export async function getSageChangeOrderSendState(
  projectId: string,
  changeOrderIds?: readonly string[]
): Promise<ActionResult<SageChangeOrderSendState>> {
  const context = await projectContext(projectId, { scope: "organization" })
  if (!context.success) return context
  const { db, env, user, organizationId } = context.data
  if (!organizationId) return actionFailure("No active organization")
  if (!canSendToSage(user)) return actionFailure(OFFICE_STAFF_ONLY)
  const view = await loadSageChangeOrderSendView(db, { organizationId, projectId, changeOrderIds })
  if (!view) return actionFailure("Project not found")
  return { success: true, data: { ...view, writesEnabled: sageChangeOrderWritesEnabled(env) } }
}

export type SageChangeOrderSendRequest = {
  readonly changeOrderId: string
  /** The Sage change order number staff confirmed (they may edit the suggestion). */
  readonly sageNumber: string
}

/** Queues the confirmed change orders for the Sage writer. */
export async function sendChangeOrdersToSage(
  projectId: string,
  requests: readonly SageChangeOrderSendRequest[]
): Promise<ActionResult<{ readonly queued: number }>> {
  const context = await projectContext(projectId, { scope: "organization", mutation: true })
  if (!context.success) return context
  const { db, env, user, organizationId } = context.data
  if (!organizationId) return actionFailure("No active organization")
  if (!canSendToSage(user)) return actionFailure(OFFICE_STAFF_ONLY)
  if (!sageChangeOrderWritesEnabled(env)) return actionFailure("Sending change orders to Sage isn't turned on for this company yet.")
  if (requests.length === 0) return actionFailure("Choose at least one change order to send.")
  if (requests.length > 50) return actionFailure("Send at most 50 change orders at a time.")

  // Recompute everything from stored rows; nothing from the browser but the ids and numbers.
  const ids = [...new Set(requests.map((request) => request.changeOrderId))]
  const [view, project, openExports] = await Promise.all([
    loadSageChangeOrderSendView(db, { organizationId, projectId, changeOrderIds: ids }),
    db.select({ sageJobId: projects.sageJobId }).from(projects).where(eq(projects.id, projectId)).get(),
    db
      .select({ changeOrderId: sageChangeOrderExports.changeOrderId, number: sageChangeOrderExports.sageChangeOrderNumber })
      .from(sageChangeOrderExports)
      .where(and(eq(sageChangeOrderExports.projectId, projectId), inArray(sageChangeOrderExports.status, ["queued", "running", "succeeded"]))),
  ])
  if (!view || !view.sageJobNumber) return actionFailure("This project isn't linked to a Sage job.")
  const sageJobNumber = view.sageJobNumber

  const usedNumbers = openExports.filter((row) => !ids.includes(row.changeOrderId)).map((row) => row.number)
  const queue = []
  for (const request of requests) {
    const item = view.items.find((candidate) => candidate.plan.changeOrderId === request.changeOrderId)
    if (!item) return actionFailure("A change order wasn't found. Refresh and try again.")
    const label = item.plan.sageName
    if (!item.canSend) return actionFailure(`${label}: ${item.reason ?? "it can't be sent to Sage."}`)
    const numberError = sageChangeOrderNumberError(request.sageNumber, { sageNumbers: view.sageNumbers, compassNumbers: usedNumbers })
    if (numberError) return actionFailure(`${label}: ${numberError}`)
    const payload = sageChangeOrderWritePayload(item.plan, {
      projectId,
      number: request.sageNumber,
      sageJobNumber,
      sageJobId: project?.sageJobId?.trim() || null,
    })
    if (!payload) return actionFailure(`${label}: its Sage details aren't complete. Refresh and check the lines.`)
    usedNumbers.push(payload.changeOrder.number)
    queue.push({ item, payload })
  }

  const now = new Date().toISOString()
  const queued = await queueSageChangeOrderExports(
    db,
    queue.map(({ payload }) => ({
      organizationId,
      projectId,
      changeOrderId: payload.compassChangeOrderId,
      sageChangeOrderNumber: payload.changeOrder.number,
      payloadJson: JSON.stringify(payload),
      requestedByUserId: user.id,
      now,
    }))
  )
  const sent = queue.filter(({ payload }) => queued.includes(payload.compassChangeOrderId))
  const actorName = activityActorName(user)
  const [firstHistory, ...moreHistory] = sent.map(({ payload }) =>
    insertChangeOrderHistoryStatement(db, {
      id: crypto.randomUUID(),
      projectId,
      changeOrderId: payload.compassChangeOrderId,
      eventType: "sage_send_requested",
      fromStatus: null,
      toStatus: null,
      actorUserId: user.id,
      actorName: actorName.slice(0, 200),
      actorRole: user.role.slice(0, 80),
      note: `Sent to Sage as change order ${payload.changeOrder.number} (${formatCents(toCents(payload.changeOrder.totalApprovedAmount))}).`,
      metadataJson: JSON.stringify({ sageNumber: payload.changeOrder.number, lines: payload.lines.length }),
      createdAt: now,
    })
  )
  if (firstHistory) await db.batch([firstHistory, ...moreHistory])
  // Activity is per change order so each one shows who sent it.
  for (const { item, payload } of sent) {
    await recordActivityEvent({
      db,
      organizationId,
      projectId,
      actor: user,
      category: "financial",
      action: "change_order_sent_to_sage",
      entityType: "project_change_order",
      entityId: payload.compassChangeOrderId,
      summary: `${item.plan.sageName}: sent to Sage as change order ${payload.changeOrder.number}.`,
      metadata: { sageNumber: payload.changeOrder.number, totalApprovedAmount: payload.changeOrder.totalApprovedAmount },
      createdAt: now,
    })
  }
  revalidatePath(`/dashboard/projects/${projectId}/change-orders`)
  revalidatePath(`/dashboard/projects/${projectId}/financials`)
  if (sent.length === 0) return actionFailure("Those change orders are already on their way to Sage.")
  return { success: true, data: { queued: sent.length } }
}
