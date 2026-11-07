import { BUILDER_FEE_NAMES, canonicalFeeCostCode } from "@/lib/domain/financials/builder-fee-codes"
import { sageAmount, sageDescription } from "@/lib/domain/sage-bridge/change-order-rules"
import type { SageCostCodeMapping } from "@/lib/financials/sage-export-codes"
import { formatCents } from "@/lib/format"

/*
 * Pure rules for sending an accepted estimate to Sage 100 Contractor as the
 * job's proposal (ProposalAddRq): one proposal line per cost code (the
 * contract budget's scheduled values rolled up by cost code, in CSI division
 * order, builder fees last on their Sage fee codes), described by the Sage
 * cost code name and never by an assembly or item name, whatever view the
 * estimate uses; the whole amount in Other. When the company sends it, the
 * job budget at cost (BudgetAddRq) the same way. No database or network access.
 */

export type EstimateContractLine = {
  readonly costCode: string
  /** The budget line's own text; the proposal uses the Sage cost code name instead. */
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

function planLine(costCode: string, amountCents: number, mapCostCode: (code: string) => SageCostCodeMapping): PlannedLine {
  const code = canonicalFeeCostCode(costCode.trim())
  const mapping = code ? mapCostCode(code) : null
  const mapped = mapping?.status === "mapped" ? mapping : null
  return {
    costCode: code,
    // The Sage cost code's name; an assembly or item name never reaches Sage.
    description: sageDescription(mapped?.sageName ?? code),
    amountCents,
    sageCostCodeName: mapped?.sageName ?? null,
    sageCostCodeRecord: mapped?.sageRecordNumber ?? null,
  }
}

const CSI_CODE = /^(\d{2}) \d{2} \d{2}/

/** CSI codes in division and code order, then other named codes, then builder fees in their usual order. */
function costCodeOrder(left: string, right: string): number {
  const rank = (code: string) => {
    const fee = BUILDER_FEE_NAMES.indexOf(code)
    if (fee >= 0) return 2_000 + fee
    return CSI_CODE.test(code) ? 0 : 1_000
  }
  return rank(left) - rank(right) || (CSI_CODE.test(left) && CSI_CODE.test(right) ? left.localeCompare(right) : 0)
}

/** Amounts summed by canonical cost code (a fee coded "99 10 00" joins "Company Overhead"), zero totals left out. */
function rollUpByCostCode(lines: readonly { readonly costCode: string; readonly amountCents: number }[]): readonly [string, number][] {
  const byCode = new Map<string, number>()
  for (const line of lines) {
    const code = canonicalFeeCostCode(line.costCode.trim())
    byCode.set(code, (byCode.get(code) ?? 0) + line.amountCents)
  }
  return [...byCode.entries()].filter(([, cents]) => cents !== 0).sort(([left], [right]) => costCodeOrder(left, right))
}

function unmappedLabel(line: PlannedLine): string {
  return `${line.costCode || "No cost code"} (${formatCents(line.amountCents)})`
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
  const proposalLines = rollUpByCostCode(input.contractLines).map(([code, cents]) => planLine(code, cents, input.mapCostCode))
  const proposalTotalCents = proposalLines.reduce((sum, line) => sum + line.amountCents, 0)
  if (proposalLines.length === 0) blockers.push("The accepted estimate has no contract lines with an amount.")
  if (proposalTotalCents !== input.contractTotalCents) {
    blockers.push(`The proposal lines add up to ${formatCents(proposalTotalCents)}, but the contract total is ${formatCents(input.contractTotalCents)}.`)
  }

  let budgetLines: PlannedLine[] | null = null
  if (input.sendBudget) {
    budgetLines = rollUpByCostCode(
      input.costLines.filter((line) => line.costCode.trim()).map((line) => ({ costCode: line.costCode, amountCents: line.costCents }))
    ).map(([code, cents]) => planLine(code, cents, input.mapCostCode))
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
