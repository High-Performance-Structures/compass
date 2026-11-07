import "server-only"

import { and, asc, eq, inArray } from "drizzle-orm"

import { projectChangeOrderLines, projectChangeOrders, projects } from "@/db/schema"
import { sageChangeOrderExports, sagePrimeChangeOrderReads, sagePrimeChangeOrders } from "@/db/schema-sage"
import { loadProjectCostCodeCatalog } from "@/lib/cost-codes/catalog-server"
import { chunkD1Values } from "@/lib/d1-query"
import {
  planSageChangeOrder,
  sageChangeOrderState,
  type SageChangeOrderPlan,
  type SageChangeOrderState,
  type SagePrimeChangeOrderRow,
} from "@/lib/domain/sage-bridge/change-order-rules"
import type { SageChangeOrderExportStatus } from "@/lib/domain/sage-bridge/statuses"
import { readFeatureSettings } from "@/lib/feature-settings/server"
import { indexSageCatalog, mapToSageCostCode } from "@/lib/financials/sage-export-codes"
import type { Db } from "@/lib/server/action-context"

/*
 * What Compass would send to Sage for a project's approved change orders and
 * variances, and where each one stands: in Sage already, on its way, or
 * ready to send. Read only; the send action recomputes it before queueing.
 */

const SENDABLE_STATUSES = ["executed", "sage_pending", "synced", "closed"] as const

type SageChangeOrderExportView = {
  readonly status: SageChangeOrderExportStatus
  readonly sageChangeOrderNumber: string
  readonly errorMessage: string | null
  readonly requestedAt: string
}

export type SageChangeOrderSendItem = {
  readonly plan: SageChangeOrderPlan
  readonly title: string
  readonly sage: SageChangeOrderState
  readonly export: SageChangeOrderExportView | null
  /** Server-decided: staff may queue it now. */
  readonly canSend: boolean
  /** Why it can't be sent right now (blockers, already in Sage, on its way). */
  readonly reason: string | null
}

export type SageChangeOrderSendView = {
  readonly sageJobNumber: string | null
  /** When Compass last read this job's change orders from Sage; null when never. */
  readonly sageReadAt: string | null
  /** Numbers Sage already uses on this job (for checking an edited number). */
  readonly sageNumbers: readonly string[]
  readonly items: readonly SageChangeOrderSendItem[]
}

function reasonFor(item: Omit<SageChangeOrderSendItem, "canSend" | "reason">): string | null {
  if (item.sage.state === "in_sage") return `Already in Sage as ${item.sage.sageNumber}.`
  if (item.sage.state === "differs") return `Sage has ${item.sage.sageNumber} with a different amount; fix it in Sage or Compass first.`
  if (item.export?.status === "queued" || item.export?.status === "running") return "On its way to Sage."
  if (item.export?.status === "succeeded") return `Sent to Sage as ${item.export.sageChangeOrderNumber}.`
  return item.plan.blockers[0] ?? null
}

/** Loads the send view for a project's approved change orders, or only `changeOrderIds`. */
export async function loadSageChangeOrderSendView(
  db: Db,
  input: { readonly organizationId: string; readonly projectId: string; readonly changeOrderIds?: readonly string[] }
): Promise<SageChangeOrderSendView | null> {
  const project = await db
    .select({ projectNumber: projects.projectNumber, sageJobNumber: projects.sageJobNumber })
    .from(projects)
    .where(and(eq(projects.id, input.projectId), eq(projects.organizationId, input.organizationId)))
    .get()
  if (!project) return null
  const sageJobNumber = project.sageJobNumber?.trim() || null

  const changeOrders = await db
    .select({
      id: projectChangeOrders.id,
      recordType: projectChangeOrders.recordType,
      number: projectChangeOrders.changeOrderNumber,
      title: projectChangeOrders.title,
      status: projectChangeOrders.status,
      executedAt: projectChangeOrders.executedAt,
      acceptedOn: projectChangeOrders.acceptedOn,
      sageRecordId: projectChangeOrders.sageRecordId,
    })
    .from(projectChangeOrders)
    .where(
      and(
        eq(projectChangeOrders.projectId, input.projectId),
        input.changeOrderIds ? inArray(projectChangeOrders.id, [...input.changeOrderIds].slice(0, 50)) : inArray(projectChangeOrders.status, [...SENDABLE_STATUSES])
      )
    )
    .orderBy(asc(projectChangeOrders.executedAt), asc(projectChangeOrders.changeOrderNumber))
  const ids = changeOrders.map((row) => row.id)

  const [lineRows, catalog, settings, primeRows, read, exports] = await Promise.all([
    Promise.all(
      chunkD1Values(ids).map((chunk) =>
        db
          .select({
            changeOrderId: projectChangeOrderLines.changeOrderId,
            costCode: projectChangeOrderLines.costCode,
            description: projectChangeOrderLines.description,
            amountCents: projectChangeOrderLines.amountCents,
          })
          .from(projectChangeOrderLines)
          .where(and(eq(projectChangeOrderLines.projectId, input.projectId), inArray(projectChangeOrderLines.changeOrderId, chunk)))
          .orderBy(asc(projectChangeOrderLines.lineNumber))
      )
    ).then((chunks) => chunks.flat()),
    loadProjectCostCodeCatalog(db),
    readFeatureSettings(db, input.organizationId, "sage-change-orders"),
    db
      .select({
        sageRecordId: sagePrimeChangeOrders.sageRecordId,
        changeOrderNumber: sagePrimeChangeOrders.changeOrderNumber,
        description: sagePrimeChangeOrders.description,
        approvedAmountCents: sagePrimeChangeOrders.approvedAmountCents,
        sageJobNumber: sagePrimeChangeOrders.sageJobNumber,
      })
      .from(sagePrimeChangeOrders)
      .where(eq(sagePrimeChangeOrders.projectId, input.projectId)),
    db.select().from(sagePrimeChangeOrderReads).where(eq(sagePrimeChangeOrderReads.projectId, input.projectId)).get(),
    db
      .select({
        changeOrderId: sageChangeOrderExports.changeOrderId,
        status: sageChangeOrderExports.status,
        sageChangeOrderNumber: sageChangeOrderExports.sageChangeOrderNumber,
        errorMessage: sageChangeOrderExports.errorMessage,
        requestedAt: sageChangeOrderExports.requestedAt,
      })
      .from(sageChangeOrderExports)
      .where(eq(sageChangeOrderExports.projectId, input.projectId)),
  ])

  const index = indexSageCatalog(catalog)
  const linesByOrder = new Map<string, { costCode: string | null; description: string; amountCents: number | null }[]>()
  for (const line of lineRows) {
    const lines = linesByOrder.get(line.changeOrderId) ?? []
    lines.push({ costCode: line.costCode, description: line.description, amountCents: line.amountCents })
    linesByOrder.set(line.changeOrderId, lines)
  }
  // A read of another Sage job (the project was relinked) doesn't count.
  const readCurrent = read && sageJobNumber && read.sageJobNumber === sageJobNumber ? read : null
  const rows: readonly SagePrimeChangeOrderRow[] | null = readCurrent
    ? primeRows.filter((row) => row.sageJobNumber === sageJobNumber)
    : null
  const exportByOrder = new Map(exports.map((row) => [row.changeOrderId, row]))

  const items = changeOrders.map((changeOrder): SageChangeOrderSendItem => {
    const plan = planSageChangeOrder(
      {
        id: changeOrder.id,
        recordType: changeOrder.recordType === "variance" ? "variance" : "change_order",
        number: changeOrder.number,
        title: changeOrder.title,
        status: changeOrder.status,
        executedAt: changeOrder.executedAt,
        acceptedOn: changeOrder.acceptedOn,
        sageRecordId: changeOrder.sageRecordId,
        lines: linesByOrder.get(changeOrder.id) ?? [],
      },
      {
        settings,
        projectNumber: project.projectNumber,
        sageJobNumber,
        mapCostCode: (costCode) => mapToSageCostCode(costCode, index),
      }
    )
    const exported = exportByOrder.get(changeOrder.id)
    const sage = sageChangeOrderState(
      {
        sageRecordId: changeOrder.sageRecordId ?? null,
        numbers: [changeOrder.number, plan.sageName, plan.suggestedNumber, exported?.sageChangeOrderNumber ?? ""],
        descriptions: [plan.description],
        amountCents: plan.totalCents,
      },
      rows
    )
    // Compass stored Sage's record but hasn't read the job since: it's in Sage.
    const known: SageChangeOrderState =
      sage.state === "unknown" && changeOrder.sageRecordId
        ? { state: "in_sage", sageRecordId: changeOrder.sageRecordId, sageNumber: exported?.sageChangeOrderNumber ?? plan.sageName }
        : sage
    const base = {
      plan,
      title: changeOrder.title,
      sage: known,
      export: exported
        ? {
            status: exported.status,
            sageChangeOrderNumber: exported.sageChangeOrderNumber,
            errorMessage: exported.errorMessage,
            requestedAt: exported.requestedAt,
          }
        : null,
    }
    const reason = reasonFor(base)
    const exportOpen = exported ? exported.status !== "failed" : false
    const canSend = plan.blockers.length === 0 && (known.state === "not_in_sage" || known.state === "unknown") && !exportOpen
    return { ...base, canSend, reason: canSend ? null : reason }
  })

  return {
    sageJobNumber,
    sageReadAt: readCurrent?.capturedAt ?? null,
    sageNumbers: rows ? rows.map((row) => row.changeOrderNumber) : [],
    items,
  }
}
