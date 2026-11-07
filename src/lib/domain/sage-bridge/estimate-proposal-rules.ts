import { canonicalFeeCostCode } from "@/lib/domain/financials/builder-fee-codes"
import { sageAmount, sageDescription } from "@/lib/domain/sage-bridge/change-order-rules"
import type { SageCostCodeMapping } from "@/lib/financials/sage-export-codes"
import { formatCents } from "@/lib/format"

/*
 * Pure rules for sending an accepted estimate to Sage 100 Contractor as the
 * job's proposal (ProposalAddRq): one proposal line per contract budget line
 * (the scheduled values Compass bills from, builder fees on their Sage fee
 * codes), the whole amount in Other; and, when the company sends it, the job
 * budget at cost (BudgetAddRq) by cost code. No database or network access.
 */

export type EstimateContractLine = {
  readonly costCode: string
  readonly description: string
  /** The line's scheduled value (original contract amount), in cents. */
  readonly amountCents: number
}

export type EstimateCostLine = {
  readonly costCode: string
  /** Direct cost at cost, in cents. */
  readonly costCents: number
}

/** Sage's proposal for the job, as the read-only copy summarises it. */
export type SageProposalSummary = {
  readonly lineCount: number
  readonly totalCents: number
}

type PlannedLine = {
  readonly costCode: string
  readonly description: string
  readonly amountCents: number
  readonly sageCostCodeName: string | null
  readonly sageCostCodeRecord: string | null
}

export type SageEstimatePlan = {
  readonly proposalLines: readonly PlannedLine[]
  readonly proposalTotalCents: number
  /** Null when the company doesn't send the budget. */
  readonly budgetLines: readonly PlannedLine[] | null
  /** Lines with no Sage cost code record number, listed for staff. */
  readonly unmappedLines: readonly string[]
  /** Why the sync can't go to Sage as it is; empty when it can. */
  readonly blockers: readonly string[]
}

function planLine(costCode: string, description: string, amountCents: number, mapCostCode: (code: string) => SageCostCodeMapping): PlannedLine {
  const code = canonicalFeeCostCode(costCode.trim())
  const mapping = code ? mapCostCode(code) : null
  const mapped = mapping?.status === "mapped" ? mapping : null
  return {
    costCode: code,
    description: sageDescription(description) || sageDescription(mapped?.sageName ?? code),
    amountCents,
    sageCostCodeName: mapped?.sageName ?? null,
    sageCostCodeRecord: mapped?.sageRecordNumber ?? null,
  }
}

function unmappedLabel(line: PlannedLine): string {
  return `${line.costCode || "No cost code"}: ${line.description} (${formatCents(line.amountCents)})`
}

export function planSageEstimate(input: {
  readonly contractLines: readonly EstimateContractLine[]
  readonly contractTotalCents: number
  readonly costLines: readonly EstimateCostLine[]
  readonly sendBudget: boolean
  readonly mapCostCode: (costCode: string) => SageCostCodeMapping
  /** Null when Compass hasn't read the job's Sage proposal (or the job isn't in Sage yet). */
  readonly sageProposal: SageProposalSummary | null
}): SageEstimatePlan {
  const blockers: string[] = []
  const proposalLines = input.contractLines
    .filter((line) => line.amountCents !== 0)
    .map((line) => planLine(line.costCode, line.description, line.amountCents, input.mapCostCode))
  const proposalTotalCents = proposalLines.reduce((sum, line) => sum + line.amountCents, 0)
  if (proposalLines.length === 0) blockers.push("The accepted estimate has no contract lines with an amount.")
  if (proposalTotalCents !== input.contractTotalCents) {
    blockers.push(`The proposal lines add up to ${formatCents(proposalTotalCents)}, but the contract total is ${formatCents(input.contractTotalCents)}.`)
  }

  let budgetLines: PlannedLine[] | null = null
  if (input.sendBudget) {
    const byCode = new Map<string, number>()
    for (const line of input.costLines) {
      const code = canonicalFeeCostCode(line.costCode.trim())
      if (!code || line.costCents === 0) continue
      byCode.set(code, (byCode.get(code) ?? 0) + line.costCents)
    }
    budgetLines = [...byCode.entries()]
      .filter(([, cents]) => cents !== 0)
      .map(([code, cents]) => planLine(code, code, cents, input.mapCostCode))
  }

  const unmapped = [...proposalLines, ...(budgetLines ?? [])].filter((line) => !line.sageCostCodeRecord)
  const unmappedLines = [...new Set(unmapped.map(unmappedLabel))]
  if (unmappedLines.length > 0) {
    blockers.push(`${unmappedLines.length === 1 ? "A line has" : `${unmappedLines.length} lines have`} no Sage cost code: ${unmappedLines.join("; ")}.`)
  }
  if (input.sageProposal && input.sageProposal.lineCount > 0) {
    blockers.push(
      `Sage already has a proposal for this job (${input.sageProposal.lineCount} lines, ${formatCents(input.sageProposal.totalCents)}); ` +
        `Compass's would be ${proposalLines.length} lines, ${formatCents(proposalTotalCents)}. Compass won't add a second proposal; compare them in Sage.`
    )
  }
  return { proposalLines, proposalTotalCents, budgetLines, unmappedLines, blockers }
}

/** The writer's line shape: decimal amounts, the whole amount in Other. */
export function sageEstimateWriterLines(lines: readonly PlannedLine[]): readonly {
  readonly description: string
  readonly costCodeRecordNumber: string
  readonly otherAmount: string
}[] {
  return lines.map((line) => ({
    description: line.description,
    costCodeRecordNumber: (line.sageCostCodeRecord ?? "").replace(/\.0+$/, ""),
    otherAmount: sageAmount(line.amountCents),
  }))
}
