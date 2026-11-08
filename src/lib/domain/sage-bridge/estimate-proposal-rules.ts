import { BUILDER_FEE_NAMES, canonicalFeeCostCode } from "@/lib/domain/financials/builder-fee-codes"
import { sageAmount, sageDescription } from "@/lib/domain/sage-bridge/change-order-rules"
import type { SageCostCodeMapping } from "@/lib/financials/sage-export-codes"
import { formatCents } from "@/lib/format"

/*
 * Pure rules for sending an accepted estimate to Sage 100 Contractor as the
 * job's proposal (ProposalAddRq): one proposal line per estimate line, each on
 * its own Sage cost code (several lines may share one), in CSI division, cost
 * code and estimate order, builder fees last on their Sage fee codes. Each is
 * described by the estimate line's own text (the cost code name when blank),
 * never by an assembly name, whatever view the client sees; the sell amount
 * before sales tax in Other. Sage adds the tax when a pay request marks a line
 * taxable, so the tax is never in the proposal twice. Taxable lines carry
 * "Taxable" in UserDefined1 and the tax district and rate in Memo, so staff
 * know which lines to mark. When the company sends it, the job budget at
 * cost (BudgetAddRq) goes one line per cost code. No database or network access.
 */

/** An estimate line as it flows into the contract. */
export type EstimateProposalLine = {
  readonly costCode: string
  /** The estimate's name for the cost code, used when the line has no text. */
  readonly costCodeName: string
  readonly divisionCode: string
  readonly description: string
  /** The line's sell amount in the contract (cost, markup and tax), in cents. */
  readonly amountCents: number
  /** The sales tax inside amountCents, in cents; Sage adds it back at billing. */
  readonly taxCents: number
  readonly sortOrder: number
  /** The line, or any of its cost items, is taxable. */
  readonly taxable: boolean
  readonly taxName: string | null
  readonly taxRateBasisPoints: number
}

/** A builder fee (overhead, margin, contingency) as its own contract line. */
export type EstimateFeeLine = {
  readonly costCode: string
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
  readonly taxable: boolean
  /** "Taxable" for a taxable line, else empty. */
  readonly userDefined1: string
  /** The tax name and rate for a taxable line, else empty. */
  readonly memo: string
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

type MappedCode = Pick<PlannedLine, "costCode" | "sageCostCodeName" | "sageCostCodeRecord">

function mapCode(costCode: string, mapCostCode: (code: string) => SageCostCodeMapping): MappedCode {
  const code = canonicalFeeCostCode(costCode.trim())
  const mapping = code ? mapCostCode(code) : null
  const mapped = mapping?.status === "mapped" ? mapping : null
  return { costCode: code, sageCostCodeName: mapped?.sageName ?? null, sageCostCodeRecord: mapped?.sageRecordNumber ?? null }
}

/** A line described by its Sage cost code name (budget lines and builder fees). */
function costCodeLine(costCode: string, amountCents: number, mapCostCode: (code: string) => SageCostCodeMapping): PlannedLine {
  const mapped = mapCode(costCode, mapCostCode)
  return {
    ...mapped,
    description: sageDescription(mapped.sageCostCodeName ?? mapped.costCode),
    amountCents,
    taxable: false,
    userDefined1: "",
    memo: "",
  }
}

const SAGE_TAXABLE = "Taxable"
/** Sage keeps Memo as text; Compass sends a short tax note. */
const SAGE_MEMO_MAX = 100

function taxMemo(line: EstimateProposalLine): string {
  const name = line.taxName?.trim() ?? ""
  const rate = line.taxRateBasisPoints > 0 ? `${Number((line.taxRateBasisPoints / 100).toFixed(4))}%` : ""
  return sageDescription([name, rate].filter(Boolean).join(" "), SAGE_MEMO_MAX)
}

/** An estimate line as its own proposal line: its own text, never an assembly name. */
function estimateLine(line: EstimateProposalLine, mapCostCode: (code: string) => SageCostCodeMapping): PlannedLine {
  const mapped = mapCode(line.costCode, mapCostCode)
  const description =
    sageDescription(line.description) || sageDescription(line.costCodeName) || sageDescription(mapped.sageCostCodeName ?? mapped.costCode)
  return {
    ...mapped,
    description,
    amountCents: line.amountCents - line.taxCents,
    taxable: line.taxable,
    userDefined1: line.taxable ? SAGE_TAXABLE : "",
    memo: line.taxable ? taxMemo(line) : "",
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

/** Proposal order: CSI division, cost code, then the estimate's own order; other codes after; builder fees last. */
function proposalOrder(
  left: { readonly line: PlannedLine; readonly divisionCode: string; readonly sortOrder: number },
  right: { readonly line: PlannedLine; readonly divisionCode: string; readonly sortOrder: number }
): number {
  return (
    costCodeOrder(left.line.costCode, right.line.costCode) ||
    left.divisionCode.localeCompare(right.divisionCode) ||
    left.line.costCode.localeCompare(right.line.costCode) ||
    left.sortOrder - right.sortOrder
  )
}

/**
 * A rounding difference from the contract total (at most a cent a line) goes
 * on the largest line, the first one in order on a tie; a bigger one is left
 * for the total check to flag.
 */
function settleRounding(lines: readonly PlannedLine[], contractTotalCents: number): readonly PlannedLine[] {
  const difference = contractTotalCents - lines.reduce((sum, line) => sum + line.amountCents, 0)
  if (difference === 0 || Math.abs(difference) > lines.length) return lines
  let largest = 0
  lines.forEach((line, index) => {
    if (Math.abs(line.amountCents) > Math.abs(lines[largest]?.amountCents ?? 0)) largest = index
  })
  return lines.map((line, index) => (index === largest ? { ...line, amountCents: line.amountCents + difference } : line))
}

/** Cost codes Sage doesn't know, each with its total, for staff. */
function unmappedLabels(lines: readonly PlannedLine[]): readonly string[] {
  const byCode = new Map<string, number>()
  for (const line of lines) {
    if (line.sageCostCodeRecord) continue
    const code = line.costCode || "No cost code"
    byCode.set(code, (byCode.get(code) ?? 0) + line.amountCents)
  }
  return [...byCode.entries()].map(([code, cents]) => `${code} (${formatCents(cents)})`)
}

export function planSageEstimate(input: {
  readonly estimateLines: readonly EstimateProposalLine[]
  readonly feeLines: readonly EstimateFeeLine[]
  /** The contract total including sales tax; the proposal is this less the lines' tax. */
  readonly contractTotalCents: number
  readonly costLines: readonly EstimateCostLine[]
  readonly sendBudget: boolean
  readonly mapCostCode: (costCode: string) => SageCostCodeMapping
  /** Null when Compass hasn't read the job's Sage proposal (or the job isn't in Sage yet). */
  readonly sageProposal: SageProposalSummary | null
}): SageEstimatePlan {
  const blockers: string[] = []
  const contractBeforeTaxCents = input.contractTotalCents - input.estimateLines.reduce((sum, line) => sum + line.taxCents, 0)
  const ordered = [
    ...input.estimateLines
      .filter((line) => line.amountCents !== 0)
      .map((line) => ({ line: estimateLine(line, input.mapCostCode), divisionCode: line.divisionCode.trim(), sortOrder: line.sortOrder })),
    ...rollUpByCostCode(input.feeLines).map(([code, cents], index) => ({
      line: costCodeLine(code, cents, input.mapCostCode),
      divisionCode: "",
      sortOrder: index,
    })),
  ].sort(proposalOrder)
  const proposalLines = settleRounding(
    ordered.map((entry) => entry.line),
    contractBeforeTaxCents
  )
  const proposalTotalCents = proposalLines.reduce((sum, line) => sum + line.amountCents, 0)
  if (proposalLines.length === 0) blockers.push("The accepted estimate has no contract lines with an amount.")
  if (proposalTotalCents !== contractBeforeTaxCents) {
    blockers.push(`The proposal lines add up to ${formatCents(proposalTotalCents)}, but the contract before sales tax is ${formatCents(contractBeforeTaxCents)}.`)
  }

  let budgetLines: PlannedLine[] | null = null
  if (input.sendBudget) {
    budgetLines = rollUpByCostCode(
      input.costLines.filter((line) => line.costCode.trim()).map((line) => ({ costCode: line.costCode, amountCents: line.costCents }))
    ).map(([code, cents]) => costCodeLine(code, cents, input.mapCostCode))
  }

  const unmappedLines = [...new Set([...unmappedLabels(proposalLines), ...unmappedLabels(budgetLines ?? [])])]
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

/** The writer's budget line shape: decimal amounts, the whole amount in Other. */
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

/** The writer's proposal line shape: a budget line plus UserDefined1 ("Taxable") and Memo. */
export function sageProposalWriterLines(lines: readonly PlannedLine[]): readonly {
  readonly description: string
  readonly costCodeRecordNumber: string
  readonly otherAmount: string
  readonly userDefined1: string
  readonly memo: string
}[] {
  return sageEstimateWriterLines(lines).map((line, index) => ({
    ...line,
    userDefined1: lines[index]?.userDefined1 ?? "",
    memo: lines[index]?.memo ?? "",
  }))
}
