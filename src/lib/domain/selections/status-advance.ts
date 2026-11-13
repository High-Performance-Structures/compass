/**
 * Automatic selection status moves: published to the owner → With owner, a
 * purchase order sent → Ordered, a daily log marking it installed →
 * Installed. Each move is an event of the selection status machine
 * (status-machine.ts), so a status only ever moves forward automatically: a
 * selection already further along (or deferred, or unavailable) is left
 * alone. Each row is compare-and-set on the status it was read with, and
 * only the moves that landed are logged to Activity. Staff can still set any
 * status by hand.
 */
import { and, eq, inArray } from "drizzle-orm"

import { projectFinishSelections, projects } from "@/db/schema"
import { projectSelectionProcurementLinks } from "@/db/schema-selection-decisions"
import { recordActivityEvents, type ActivityActor } from "@/lib/activity-log"
import { chunkD1Values } from "@/lib/d1-query"
import type { Db } from "@/lib/server/action-context"

import { selectionStatusSources, type SelectionStatusEvent } from "./status-machine"
import type { ProjectSelectionStatus } from "./statuses"
import { selectionStatusLabel } from "./status-labels"
import { readSelectionStatusLabels } from "./status-labels-server"
import { automaticSelectionStatusStatement } from "./store"

export type SelectionAdvanceTarget = "owner_review" | "ordered" | "installed"

const EVENT_FOR: Readonly<Record<SelectionAdvanceTarget, SelectionStatusEvent>> = {
  owner_review: "publish",
  ordered: "order",
  installed: "install",
}

/** The statuses an automatic move to `target` may replace. */
export function statusesBefore(target: SelectionAdvanceTarget): readonly ProjectSelectionStatus[] {
  return selectionStatusSources(EVENT_FOR[target])
}

export type SelectionAdvanceReason =
  | { readonly kind: "published" }
  | { readonly kind: "purchase_order_sent"; readonly purchaseOrderId: string; readonly purchaseOrderNumber: string | null }
  | { readonly kind: "daily_log"; readonly dailyLogId: string; readonly logDate: string }

function reasonText(reason: SelectionAdvanceReason): string {
  if (reason.kind === "published") return "published to the owner"
  if (reason.kind === "purchase_order_sent") return `purchase order ${reason.purchaseOrderNumber ?? ""} sent`.replace(/\s+/g, " ")
  return `marked installed on the ${reason.logDate} daily log`
}

/**
 * Moves the project's selections forward to `target` where they are behind
 * it, and logs each move. Returns the ids that moved.
 */
export async function advanceSelectionStatus(
  db: Db,
  input: {
    readonly projectId: string
    readonly selectionIds: readonly string[]
    readonly target: SelectionAdvanceTarget
    readonly reason: SelectionAdvanceReason
    readonly actor: ActivityActor
  },
): Promise<readonly string[]> {
  const ids = [...new Set(input.selectionIds)]
  if (ids.length === 0) return []
  const event = EVENT_FOR[input.target]
  const earlier = [...statusesBefore(input.target)]
  const now = new Date().toISOString()
  const before = (
    await Promise.all(
      chunkD1Values(ids).map((chunk) =>
        db
          .select({ id: projectFinishSelections.id, name: projectFinishSelections.name, status: projectFinishSelections.status })
          .from(projectFinishSelections)
          .where(and(eq(projectFinishSelections.projectId, input.projectId), inArray(projectFinishSelections.id, chunk), inArray(projectFinishSelections.status, earlier))),
      ),
    )
  ).flat()
  // updated_at is the edit token staff forms send back; an automatic status move leaves it.
  const statements = before.flatMap((row) => {
    const statement = automaticSelectionStatusStatement(db, { projectId: input.projectId, selectionId: row.id, event, stored: row.status })
    return statement ? [statement] : []
  })
  const [first, ...rest] = statements
  if (!first) return []
  // Each row is guarded on the status it was read with, so a concurrent change wins.
  const landed = new Set((await db.batch([first, ...rest])).flatMap((rows) => rows.map((row) => row.id)))
  const moved = before.filter((row) => landed.has(row.id))
  if (moved.length === 0) return []
  const project = await db.select({ organizationId: projects.organizationId }).from(projects).where(eq(projects.id, input.projectId)).get()
  if (project?.organizationId) {
    const organizationId = project.organizationId
    const why = reasonText(input.reason)
    // Activity text uses the company's status names as they are now; metadata keeps the keys.
    const labels = await readSelectionStatusLabels(db, organizationId)
    await recordActivityEvents(
      db,
      moved.map((row) => ({
        organizationId,
        projectId: input.projectId,
        actor: input.actor,
        category: "field",
        action: "selection_status_advanced",
        entityType: "project_finish_selection",
        entityId: row.id,
        summary: `${row.name} moved from ${selectionStatusLabel(row.status, labels)} to ${selectionStatusLabel(input.target, labels)}: ${why}.`,
        metadata: {
          from: row.status,
          to: input.target,
          reason: input.reason.kind,
          ...(input.reason.kind === "purchase_order_sent" ? { purchaseOrderId: input.reason.purchaseOrderId } : {}),
          ...(input.reason.kind === "daily_log" ? { dailyLogId: input.reason.dailyLogId } : {}),
        },
        createdAt: now,
      })),
    )
  }
  return moved.map((row) => row.id)
}

/** Selections tied to a purchase order: procurement links and the selection's own PO link. */
async function selectionsForPurchaseOrder(db: Db, projectId: string, purchaseOrderId: string): Promise<readonly string[]> {
  const [linked, own] = await Promise.all([
    db
      .select({ id: projectSelectionProcurementLinks.selectionId })
      .from(projectSelectionProcurementLinks)
      .where(and(eq(projectSelectionProcurementLinks.projectId, projectId), eq(projectSelectionProcurementLinks.operationId, purchaseOrderId))),
    db
      .select({ id: projectFinishSelections.id })
      .from(projectFinishSelections)
      .where(and(eq(projectFinishSelections.projectId, projectId), eq(projectFinishSelections.purchaseOrderOperationId, purchaseOrderId))),
  ])
  return [...new Set([...linked, ...own].map((row) => row.id))]
}

/** Purchase order statuses that mean it went to the vendor. */
const PURCHASE_ORDER_SENT_STATUSES: readonly string[] = ["sent", "ordered", "partially_received", "received"]

/**
 * When a purchase order has gone to the vendor, its selections move to
 * Ordered. Safe to call on any PO status change; other statuses do nothing.
 */
export async function advanceSelectionsForPurchaseOrder(
  db: Db,
  input: {
    readonly projectId: string
    readonly purchaseOrderId: string
    readonly purchaseOrderNumber: string | null
    readonly status: string
    readonly actor: ActivityActor
  },
): Promise<readonly string[]> {
  if (!PURCHASE_ORDER_SENT_STATUSES.includes(input.status)) return []
  const selectionIds = await selectionsForPurchaseOrder(db, input.projectId, input.purchaseOrderId)
  return advanceSelectionStatus(db, {
    projectId: input.projectId,
    selectionIds,
    target: "ordered",
    reason: { kind: "purchase_order_sent", purchaseOrderId: input.purchaseOrderId, purchaseOrderNumber: input.purchaseOrderNumber },
    actor: input.actor,
  })
}
