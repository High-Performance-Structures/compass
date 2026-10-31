import { and, eq, isNull, ne, type SQL } from "drizzle-orm"
import type { getDb } from "@/db"
import { projectChangeOrderHistory, projectChangeOrderLines, projectChangeOrders } from "@/db/schema"
import { projectEstimateAssemblies, projectEstimateLines, projectEstimates } from "@/db/schema-estimates"
import { estimateBudgetLedgerLines } from "@/lib/financials/contract-budget-store"
import type { EstimateLedgerLine } from "@/lib/domain/estimates/rules"

type Db = ReturnType<typeof getDb>
type EstimateRow = typeof projectEstimates.$inferSelect

/** Change orders that can no longer be executed from an estimate. */
const CLOSED_CHANGE_ORDER_STATUSES: ReadonlySet<string> = new Set(["declined", "void", "closed"])

/**
 * Which accepted estimates an acceptance replaces. A contract estimate
 * replaces the job's other accepted contract estimates (or, on several-estimate
 * jobs, older versions of the same estimate); a change-order or phase
 * estimate only replaces an older accepted version of itself.
 */
export function estimateSupersedeConditions(
  estimate: Pick<EstimateRow, "id" | "projectId" | "estimateNumber" | "changeOrderId" | "phaseProposalId">,
  mode: "single" | "multiple"
): readonly SQL[] {
  const base = [
    eq(projectEstimates.projectId, estimate.projectId),
    eq(projectEstimates.status, "accepted"),
    ne(projectEstimates.id, estimate.id),
  ]
  if (estimate.changeOrderId) return [...base, eq(projectEstimates.changeOrderId, estimate.changeOrderId)]
  if (estimate.phaseProposalId) return [...base, eq(projectEstimates.phaseProposalId, estimate.phaseProposalId)]
  return [
    ...base,
    isNull(projectEstimates.changeOrderId),
    isNull(projectEstimates.phaseProposalId),
    ...(mode === "multiple" ? [eq(projectEstimates.estimateNumber, estimate.estimateNumber)] : []),
  ]
}

export type ChangeOrderLineDraft = {
  readonly lineNumber: number
  readonly description: string
  readonly phaseCode: string
  readonly costCode: string
  readonly amountCents: number
  /** The contract assembly the line adds to or reduces, when it has one. */
  readonly contractAssemblyId: string | null
  readonly assemblyName: string | null
}

export type LineAssembly = { readonly contractAssemblyId: string | null; readonly name: string }

/**
 * Change-order lines from an accepted change-order estimate: one per cost
 * code within each assembly, at the client price (the contract budget tracks
 * contract value). Lines outside an assembly group by cost code alone.
 */
export function changeOrderLinesFromEstimate(
  lines: readonly EstimateLedgerLine[],
  assemblyForLine: (lineId: string | null) => LineAssembly | null = () => null
): readonly ChangeOrderLineDraft[] {
  const groups = new Map<
    string,
    { costCode: string; description: string; phaseCode: string; amountCents: number; assembly: LineAssembly | null }
  >()
  for (const line of lines) {
    if (line.lineTotalCents === 0) continue
    const assembly = assemblyForLine(line.id)
    const key = `${assembly?.contractAssemblyId ?? assembly?.name ?? ""}|${line.costCode}`
    const current = groups.get(key)
    if (current) current.amountCents += line.lineTotalCents
    else
      groups.set(key, {
        costCode: line.costCode,
        description: line.description,
        phaseCode: line.divisionCode,
        amountCents: line.lineTotalCents,
        assembly,
      })
  }
  return [...groups.values()]
    .sort((left, right) => left.costCode.localeCompare(right.costCode) || (left.assembly?.name ?? "").localeCompare(right.assembly?.name ?? ""))
    .map((group, index) => ({
      lineNumber: index + 1,
      costCode: group.costCode,
      description: group.description,
      phaseCode: group.phaseCode,
      amountCents: group.amountCents,
      contractAssemblyId: group.assembly?.contractAssemblyId ?? null,
      assemblyName: group.assembly?.name ?? null,
    }))
}

/**
 * Statements that execute a change order from its accepted estimate: its
 * lines become the estimate's priced cost codes, its amount the estimate
 * total, and it is marked executed with the signed document. Run them in the
 * same batch as the estimate acceptance, then rebuild the contract budget.
 */
export async function changeOrderExecutionFromEstimate(input: {
  readonly db: Db
  readonly estimate: EstimateRow
  readonly signedAt: string
  readonly evidenceUrl: string
  readonly evidenceLabel: string
  readonly actor: { readonly id: string | null; readonly name: string; readonly role: string }
  readonly now: string
}) {
  const changeOrderId = input.estimate.changeOrderId
  if (!changeOrderId) throw new Error("This estimate isn't linked to a change order.")
  const changeOrder = await input.db
    .select({ id: projectChangeOrders.id, status: projectChangeOrders.status, changeOrderNumber: projectChangeOrders.changeOrderNumber })
    .from(projectChangeOrders)
    .where(and(eq(projectChangeOrders.id, changeOrderId), eq(projectChangeOrders.projectId, input.estimate.projectId)))
    .get()
  if (!changeOrder) throw new Error("The linked change order no longer exists.")
  if (CLOSED_CHANGE_ORDER_STATUSES.has(changeOrder.status)) {
    throw new Error(`Change order ${changeOrder.changeOrderNumber} is ${changeOrder.status}; reopen it before accepting its estimate.`)
  }
  const [ledger, lineAssemblies] = await Promise.all([
    estimateBudgetLedgerLines(input.db, input.estimate),
    input.db
      .select({
        lineId: projectEstimateLines.id,
        name: projectEstimateAssemblies.name,
        contractAssemblyId: projectEstimateAssemblies.contractAssemblyId,
      })
      .from(projectEstimateLines)
      .innerJoin(projectEstimateAssemblies, eq(projectEstimateAssemblies.id, projectEstimateLines.assemblyId))
      .where(eq(projectEstimateLines.estimateId, input.estimate.id)),
  ])
  const assemblyByLine = new Map(lineAssemblies.map((row) => [row.lineId, row]))
  const lines = changeOrderLinesFromEstimate(ledger.lines, (lineId) => (lineId ? assemblyByLine.get(lineId) ?? null : null))
  if (lines.length === 0) throw new Error("The change-order estimate has no priced lines.")
  const totalCents = lines.reduce((sum, line) => sum + line.amountCents, 0)
  const lineInserts = []
  // Each line binds 11 columns; eight per statement stays under D1's limit.
  for (let index = 0; index < lines.length; index += 8) {
    lineInserts.push(
      input.db.insert(projectChangeOrderLines).values(
        lines.slice(index, index + 8).map((line) => ({
          id: crypto.randomUUID(),
          projectId: input.estimate.projectId,
          changeOrderId,
          lineNumber: line.lineNumber,
          description: line.description.slice(0, 500),
          phaseCode: line.phaseCode,
          costCode: line.costCode,
          amountCents: line.amountCents,
          contractAssemblyId: line.contractAssemblyId,
          assemblyName: line.assemblyName,
          createdAt: input.now,
          updatedAt: input.now,
        }))
      )
    )
  }
  return [
    input.db.delete(projectChangeOrderLines).where(eq(projectChangeOrderLines.changeOrderId, changeOrderId)),
    ...lineInserts,
    input.db
      .update(projectChangeOrders)
      .set({
        status: "executed",
        amountCents: totalCents,
        budgetTreatment: "additive",
        executedAt: input.signedAt,
        executedDocumentUrl: input.evidenceUrl,
        executedDocumentLabel: input.evidenceLabel.slice(0, 200),
        foxitStatus: "completed",
        updatedAt: input.now,
      })
      .where(eq(projectChangeOrders.id, changeOrderId)),
    input.db.insert(projectChangeOrderHistory).values({
      id: crypto.randomUUID(),
      projectId: input.estimate.projectId,
      changeOrderId,
      eventType: "executed_from_estimate",
      fromStatus: changeOrder.status,
      toStatus: "executed",
      actorUserId: input.actor.id,
      actorName: input.actor.name.slice(0, 200),
      actorRole: input.actor.role.slice(0, 80),
      note: `Executed from accepted estimate ${input.estimate.estimateNumber} v${input.estimate.versionNumber}.`,
      metadataJson: JSON.stringify({ estimateId: input.estimate.id, totalCents, lineCount: lines.length }),
      createdAt: input.now,
    }),
  ] as const
}
