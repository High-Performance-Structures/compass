import { and, eq, ne } from "drizzle-orm"
import type { getDb } from "@/db"
import {
  projectChangeOrderHistory,
  projectChangeOrderLines,
  projectChangeOrders,
  projects,
} from "@/db/schema"
import { projectEstimates } from "@/db/schema-estimates"
import { changeOrderNumber } from "@/lib/change-orders/numbering"
import { estimateVersionDifference, type VersionDifference } from "@/lib/change-orders/version-difference"
import { contractEstimateConditions } from "@/lib/estimates/estimate-family"
import { estimateBudgetLedgerLines } from "@/lib/financials/contract-budget-store"

type Db = ReturnType<typeof getDb>
type EstimateRow = typeof projectEstimates.$inferSelect

/**
 * How a newer contract-estimate version takes effect once a contract
 * baseline exists. Either way a change order records the change.
 * - replace_contract: the new version becomes the contract baseline (e.g. for
 *   the lender); the change order documents it and lists the differences.
 * - difference_change_order: the original contract stays; the change order
 *   carries the line-by-line differences into the budget.
 */
export const CONTRACT_VERSION_TREATMENTS = ["replace_contract", "difference_change_order"] as const
export type ContractVersionTreatment = (typeof CONTRACT_VERSION_TREATMENTS)[number]

export function isContractVersionTreatment(value: unknown): value is ContractVersionTreatment {
  return value === "replace_contract" || value === "difference_change_order"
}

/**
 * The accepted contract estimate a newer version would replace, or null when
 * accepting this estimate doesn't touch an existing contract (first
 * acceptance, change-order and phase estimates, several-estimate jobs).
 */
export async function contractVersionBaseline(
  db: Db,
  estimate: Pick<EstimateRow, "id" | "projectId" | "estimateNumber" | "changeOrderId" | "phaseProposalId">,
  mode: "single" | "multiple"
): Promise<EstimateRow | null> {
  if (mode !== "single" || estimate.changeOrderId || estimate.phaseProposalId) return null
  const row = await db
    .select()
    .from(projectEstimates)
    .where(
      and(
        eq(projectEstimates.projectId, estimate.projectId),
        eq(projectEstimates.status, "accepted"),
        ne(projectEstimates.id, estimate.id),
        ...contractEstimateConditions()
      )
    )
    .get()
  return row ?? null
}

export async function contractVersionDifference(
  db: Db,
  baseline: EstimateRow,
  next: EstimateRow
): Promise<VersionDifference> {
  const [before, after] = await Promise.all([
    estimateBudgetLedgerLines(db, baseline),
    estimateBudgetLedgerLines(db, next),
  ])
  return estimateVersionDifference(before.lines, after.lines)
}

export type VersionChangeOrderInput = {
  readonly projectId: string
  readonly treatment: ContractVersionTreatment
  readonly baseline: EstimateRow
  readonly replacement: EstimateRow
  readonly difference: VersionDifference
  /** Free-hand description of the plan change and contract-packet edits. */
  readonly summary: string
  readonly signedAt: string
  readonly evidenceUrl: string | null
  readonly evidenceLabel: string
  readonly actor: { readonly id: string; readonly name: string; readonly role: string }
  readonly now: string
}

/**
 * Statements that create the change order for a newer contract version. A
 * replacement is inserted signature pending, for the baseline-replacement
 * execution to claim in the same batch; a difference change order is
 * executed at once and its lines feed the budget.
 */
export async function versionChangeOrderStatements(db: Db, input: VersionChangeOrderInput) {
  const [project, existing] = await Promise.all([
    db.select({ projectNumber: projects.projectNumber }).from(projects).where(eq(projects.id, input.projectId)).get(),
    db.select({ id: projectChangeOrders.id }).from(projectChangeOrders).where(eq(projectChangeOrders.projectId, input.projectId)),
  ])
  const id = crypto.randomUUID()
  const replace = input.treatment === "replace_contract"
  const from = `v${input.baseline.versionNumber}`
  const to = `v${input.replacement.versionNumber}`
  const lines = input.difference.lines
  const lineInserts = []
  // Each line binds 13 columns; seven per statement stays under D1's limit.
  for (let index = 0; index < lines.length; index += 7) {
    lineInserts.push(
      db.insert(projectChangeOrderLines).values(
        lines.slice(index, index + 7).map((line) => ({
          id: crypto.randomUUID(),
          projectId: input.projectId,
          changeOrderId: id,
          lineNumber: line.lineNumber,
          description: line.description.slice(0, 500),
          phaseCode: line.phaseCode,
          costCode: line.costCode,
          amountCents: line.amountCents,
          changeKind: line.kind,
          previousAmountCents: line.previousAmountCents,
          newAmountCents: line.newAmountCents,
          createdAt: input.now,
          updatedAt: input.now,
        }))
      )
    )
  }
  return {
    changeOrderId: id,
    changeOrderNumber: changeOrderNumber(project?.projectNumber ?? null, existing.length),
    statements: [
      db.insert(projectChangeOrders).values({
        id,
        projectId: input.projectId,
        changeOrderNumber: changeOrderNumber(project?.projectNumber ?? null, existing.length),
        title: replace
          ? `Estimate ${input.replacement.estimateNumber} ${to} replaces ${from}`
          : `Changes in estimate ${input.replacement.estimateNumber} ${to}`,
        scope: input.summary,
        reason: replace
          ? `The owner accepted ${to} of the contract estimate to replace ${from}.`
          : `The owner accepted ${to} of the contract estimate; the differences from ${from} are added to the contract.`,
        amountCents: input.difference.netChangeCents,
        status: replace ? "signature_pending" : "executed",
        audience: "owner",
        requesterType: "internal",
        requesterUserId: input.actor.id,
        requesterName: input.actor.name.slice(0, 200),
        sourceType: "estimate_version",
        sourceRecordId: input.replacement.id,
        internalNotes: null,
        budgetTreatment: replace ? "baseline_replacement" : "additive",
        baselineEstimateId: input.baseline.id,
        replacementEstimateId: input.replacement.id,
        foxitStatus: replace ? "not_started" : "completed",
        sageStatus: "not_ready",
        executedAt: replace ? null : input.signedAt,
        executedDocumentUrl: replace ? null : input.evidenceUrl,
        executedDocumentLabel: replace ? null : input.evidenceLabel.slice(0, 200),
        createdBy: input.actor.id,
        submittedAt: input.now,
        createdAt: input.now,
        updatedAt: input.now,
      }),
      ...lineInserts,
      db.insert(projectChangeOrderHistory).values({
        id: crypto.randomUUID(),
        projectId: input.projectId,
        changeOrderId: id,
        eventType: "created_from_estimate_version",
        fromStatus: null,
        toStatus: replace ? "signature_pending" : "executed",
        actorUserId: input.actor.id,
        actorName: input.actor.name.slice(0, 200),
        actorRole: input.actor.role.slice(0, 80),
        note: `Created when estimate ${input.replacement.estimateNumber} ${to} was accepted.`,
        metadataJson: JSON.stringify({
          treatment: input.treatment,
          baselineEstimateId: input.baseline.id,
          replacementEstimateId: input.replacement.id,
          netChangeCents: input.difference.netChangeCents,
          lineCount: lines.length,
        }),
        createdAt: input.now,
      }),
    ],
  }
}
