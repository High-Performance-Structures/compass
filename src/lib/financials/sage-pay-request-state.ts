import { and, asc, eq } from "drizzle-orm"

import { projectBudgetApplications, projectBudgetLines } from "@/db/schema"
import { payApplicationShopTicketImports, shopTickets } from "@/db/schema-shop-tickets"
import { reconcilePayRequestWithSage, type PayRequestReconciliation } from "@/lib/domain/budget/sage-pay-request-rules"
import type { PayApplicationBillingSource } from "@/lib/domain/budget/statuses"
import type { PayApplicationSageSyncEvent } from "@/lib/domain/budget/statuses"
import type { PayRequestOrigin } from "@/lib/feature-settings/contract-settings"
import {
  SAGE_REFRESHABLE_STATUSES,
  latestSageSync,
  loadSageSnapshot,
  mappedSnapshotLines,
  payRequestOrigin,
} from "@/lib/financials/sage-pay-request-sync"
import { loadUnbilledShopTickets, type UnbilledShopTicketRow } from "@/lib/financials/sage-pay-request-tickets"
import type { Db } from "@/lib/server/action-context"

/*
 * What a pay application's page shows about Sage: where the company builds
 * pay requests, whether this one follows Sage, the Sage application it is
 * linked to, the line-by-line comparison for one built in Compass, and the
 * shop ticket checklist for whoever enters billing in Sage. Read only.
 */

export type PayRequestSageState = {
  readonly origin: PayRequestOrigin
  readonly billingSource: PayApplicationBillingSource
  readonly link: {
    readonly sageApplicationNumber: string
    readonly periodTo: string | null
    readonly invoiceNumber: string | null
    readonly capturedAt: string
    readonly lastEvent: PayApplicationSageSyncEvent
    readonly lastSyncedAt: string
  } | null
  /** Sage lines no Compass cost code matched (they keep Sage's text). */
  readonly unmappedLines: readonly string[]
  /** For a pay application built in Compass and linked to Sage: every difference by cost code. */
  readonly reconciliation: PayRequestReconciliation | null
  /** Server flag: staff may replace this pay application's amounts with Sage's. */
  readonly canUseSageAmounts: boolean
  /** Server flag: the shop ticket checklist can be ticked on this pay application. */
  readonly canTickShopTickets: boolean
  readonly unbilledShopTickets: readonly UnbilledShopTicketRow[]
  /** Tickets ticked off (already included) on this pay application. */
  readonly includedShopTickets: readonly { readonly id: string; readonly ticketNumber: string; readonly totalCents: number }[]
}

export async function loadPayRequestSageState(
  db: Db,
  input: { readonly organizationId: string; readonly projectId: string; readonly applicationId: string }
): Promise<PayRequestSageState | null> {
  const { projectId, applicationId } = input
  const application = await db
    .select({ status: projectBudgetApplications.status, billingSource: projectBudgetApplications.billingSource })
    .from(projectBudgetApplications)
    .where(and(eq(projectBudgetApplications.id, applicationId), eq(projectBudgetApplications.projectId, projectId)))
    .get()
  if (!application) return null
  const [origin, latest] = await Promise.all([payRequestOrigin(db, input.organizationId), latestSageSync(db, applicationId)])
  const snapshot = latest ? await loadSageSnapshot(db, projectId, latest.snapshotId) : null
  const mapped = snapshot ? await mappedSnapshotLines(db, projectId, snapshot) : null
  const refreshable = SAGE_REFRESHABLE_STATUSES.some((status) => status === application.status)
  let reconciliation: PayRequestReconciliation | null = null
  if (mapped && application.billingSource === "compass") {
    const lines = await db
      .select({
        costCode: projectBudgetLines.costCode,
        description: projectBudgetLines.description,
        adjustedEstimate: projectBudgetLines.adjustedEstimate,
        previousWorkCompleted: projectBudgetLines.previousWorkCompleted,
        currentWorkCompleted: projectBudgetLines.currentWorkCompleted,
        storedMaterials: projectBudgetLines.storedMaterials,
      })
      .from(projectBudgetLines)
      .where(and(eq(projectBudgetLines.projectId, projectId), eq(projectBudgetLines.applicationId, applicationId)))
    reconciliation = reconcilePayRequestWithSage(lines, mapped.lines)
  }
  const sageMode = origin === "sage"
  const [unbilledShopTickets, includedShopTickets] = sageMode
    ? await Promise.all([
        loadUnbilledShopTickets(db, projectId),
        db
          .select({ id: shopTickets.id, ticketNumber: shopTickets.ticketNumber, totalCents: shopTickets.totalCents })
          .from(payApplicationShopTicketImports)
          .innerJoin(shopTickets, eq(shopTickets.id, payApplicationShopTicketImports.ticketId))
          .where(and(eq(payApplicationShopTicketImports.applicationId, applicationId), eq(payApplicationShopTicketImports.mode, "already_included")))
          .orderBy(asc(shopTickets.sequenceNumber)),
      ])
    : [[], []]
  return {
    origin,
    billingSource: application.billingSource,
    link:
      latest && snapshot
        ? {
            sageApplicationNumber: snapshot.header.applicationNumber,
            periodTo: snapshot.header.periodTo,
            invoiceNumber: snapshot.header.invoiceNumber ?? null,
            capturedAt: snapshot.capturedAt,
            lastEvent: latest.eventKind,
            lastSyncedAt: latest.createdAt,
          }
        : null,
    unmappedLines: mapped ? mapped.lines.filter((line) => !line.mapped).map((line) => line.description) : [],
    reconciliation,
    canUseSageAmounts: reconciliation !== null && refreshable,
    canTickShopTickets: sageMode && application.status !== "void",
    unbilledShopTickets: unbilledShopTickets.filter((ticket) => ticket.budgetApplicationId === null || ticket.budgetApplicationId === applicationId),
    includedShopTickets,
  }
}
