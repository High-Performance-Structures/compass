/*
 * Variance rules: numbering, contract-type gates and the builder fee and
 * liability insurance lines Compass adds to a variance or change order. Pure
 * functions with no database or network access (architecture standard,
 * sections 1 and 5).
 *
 * A variance is a cost-plus cost movement (a material price going up or
 * down) on the cost code it belongs to. It changes that line's scheduled
 * value, needs no owner signature, and is numbered V-001, V-002… per
 * project; change orders keep their own numbers.
 */

import { calculateEstimateTotals, type EstimateBuilderFeeRates } from "@/lib/domain/estimates/rules"
import type { ChangeOrderLineDerivation, ChangeOrderRecordType } from "@/lib/domain/estimates/statuses"
import { BUILDER_FEE_NAMES, isBuilderFeeCostCode } from "@/lib/domain/financials/builder-fee-codes"
import type { ProjectContractType } from "@/lib/domain/project/statuses"
import { cleanText } from "@/lib/shared/guards"

export type { ChangeOrderRecordType, ProjectContractType }

export function contractTypeLabel(type: ProjectContractType): string {
  switch (type) {
    case "fixed_price":
      return "Fixed price"
    case "cost_plus":
      return "Cost plus"
    case "cost_plus_fixed_fee":
      return "Cost plus fixed fee"
  }
}

/** The project's own contract type, else the company default. */
export function effectiveContractType(
  projectContractType: ProjectContractType | null,
  companyDefault: ProjectContractType
): ProjectContractType {
  return projectContractType ?? companyDefault
}

/** A fixed-price contract is renegotiated by change order, so it has no variances. */
export function contractAllowsVariances(type: ProjectContractType): boolean {
  return type !== "fixed_price"
}

/**
 * Whether the builder fee moves with a record. Change orders are priced with
 * their fee already. A variance carries fee only on a straight cost-plus
 * contract; on cost plus fixed fee the fee changes only by change order.
 */
function feeFollowsVariances(type: ProjectContractType): boolean {
  return type === "cost_plus"
}

/** A closed project's records never change. */
export function projectIsClosed(project: { readonly status: string; readonly jobStatusId: string }): boolean {
  return project.jobStatusId.trim().toLowerCase() === "closed" || project.status.trim().toUpperCase() === "CLOSED"
}

// ---- numbering

type NumberedRecord = {
  readonly changeOrderNumber: string
  readonly formerChangeOrderNumber: string | null
  readonly recordType: string
}

function suffixNumber(value: string | null, pattern: RegExp): number {
  const match = value ? pattern.exec(value.trim()) : null
  return match?.[1] ? Number(match[1]) : 0
}

const CHANGE_ORDER_SUFFIX = /CO-(\d+)$/i
const VARIANCE_SUFFIX = /^V-(\d+)$/i

function varianceNumber(sequence: number): string {
  return `V-${String(sequence).padStart(3, "0")}`
}

/**
 * The next change-order number on a job: <project number>-CO-001 and up. It
 * follows the highest number ever used, counting the numbers variances had
 * before they were reclassified, so a number the owner has seen is never
 * reused. Variances don't take change-order numbers.
 */
export function nextChangeOrderNumber(projectNumber: string | null, records: readonly NumberedRecord[]): string {
  const prefix = projectNumber?.trim() || "PROJECT"
  const changeOrders = records.filter((record) => record.recordType !== "variance")
  const highest = Math.max(
    changeOrders.length,
    ...records.map((record) =>
      Math.max(
        record.recordType === "variance" ? 0 : suffixNumber(record.changeOrderNumber, CHANGE_ORDER_SUFFIX),
        suffixNumber(record.formerChangeOrderNumber, CHANGE_ORDER_SUFFIX)
      )
    )
  )
  return `${prefix}-CO-${String(highest + 1).padStart(3, "0")}`
}

/** The next variance numbers on a job, V-001 and up, after the highest in use. */
export function nextVarianceNumbers(records: readonly NumberedRecord[], count: number): readonly string[] {
  const highest = Math.max(
    0,
    ...records.filter((record) => record.recordType === "variance").map((record) => suffixNumber(record.changeOrderNumber, VARIANCE_SUFFIX))
  )
  return Array.from({ length: count }, (_, index) => varianceNumber(highest + index + 1))
}

/**
 * Change orders being reclassified as variances, in date order (executed,
 * else created), each with the variance number it takes.
 */
export function varianceNumbersInDateOrder<T extends { readonly id: string; readonly executedAt: string | null; readonly createdAt: string }>(
  converting: readonly T[],
  records: readonly NumberedRecord[]
): readonly { readonly record: T; readonly number: string }[] {
  const ordered = [...converting].sort(
    (left, right) =>
      (left.executedAt ?? left.createdAt).localeCompare(right.executedAt ?? right.createdAt) || left.id.localeCompare(right.id)
  )
  const numbers = nextVarianceNumbers(records, ordered.length)
  return ordered.map((record, index) => ({ record, number: numbers[index] ?? varianceNumber(index + 1) }))
}

/**
 * Why a record can't be reclassified, or null. Rebaseline and contract-version
 * change orders replace the estimate, so they can't be variances; a variance
 * needs a cost, and an envelope out for signature must come back first.
 */
export function reclassificationError(input: {
  readonly to: ChangeOrderRecordType
  readonly recordType: string
  readonly status: string
  readonly kind: string | null
  readonly budgetTreatment: string
  readonly number: string
  readonly hasOpenEstimate: boolean
}): string | null {
  if (input.recordType === input.to) return null
  if (input.to === "change_order") return null
  if (input.budgetTreatment !== "additive" || input.kind === "replacement" || input.kind === "contract_version") {
    return `${input.number} replaces the contract estimate, so it stays a change order.`
  }
  if (input.kind === "description") return `${input.number} has no cost, so it can't be a variance.`
  if (input.status === "signature_pending") return `${input.number} is out for signature; bring it back before reclassifying it.`
  if (input.hasOpenEstimate) return `${input.number} has a change-order estimate; void the estimate before reclassifying it.`
  return null
}

// ---- variance lines typed by staff

export type VarianceLineInput = {
  readonly costCode: string
  readonly description: string
  readonly amountCents: number
}

const MAX_VARIANCE_LINES = 100

/** Checks a variance's cost lines: a job cost code, a description and a nonzero amount (increase or decrease). */
export function planVarianceLines(input: {
  readonly allowedCostCodes: ReadonlySet<string>
  readonly lines: readonly VarianceLineInput[]
}): { readonly success: true; readonly lines: readonly VarianceLineInput[] } | { readonly success: false; readonly error: string } {
  if (input.lines.length === 0) return { success: false, error: "Add at least one cost-coded line." }
  if (input.lines.length > MAX_VARIANCE_LINES) return { success: false, error: `Use ${MAX_VARIANCE_LINES} lines or fewer.` }
  const lines: VarianceLineInput[] = []
  for (const [index, line] of input.lines.entries()) {
    const label = `Line ${index + 1}`
    const costCode = cleanText(line.costCode)
    if (!costCode || !input.allowedCostCodes.has(costCode)) {
      return { success: false, error: `${label}: choose a cost code from this job's list.` }
    }
    const description = cleanText(line.description) ?? ""
    if (!description) return { success: false, error: `${label}: add a description.` }
    if (description.length > 500) return { success: false, error: `${label}: keep the description to 500 characters.` }
    if (!Number.isSafeInteger(line.amountCents) || line.amountCents === 0) {
      return { success: false, error: `${label}: enter the dollar amount of the increase or decrease.` }
    }
    lines.push({ costCode, description, amountCents: line.amountCents })
  }
  return { success: true, lines }
}

// ---- builder fee and liability insurance

export type InsuranceRule = {
  /** The cost code the insurance line goes under (the contract's own insurance line when it has one). */
  readonly costCode: string
  readonly description: string
  /** Insurance as a fraction of everything else on the record; 0 adds none. */
  readonly rate: number
}

export type DerivedChangeLine = {
  readonly costCode: string
  readonly description: string
  readonly amountCents: number
  readonly derivedFrom: ChangeOrderLineDerivation
}

function normalized(value: string): string {
  return value.trim().replaceAll(/\s+/g, " ").toLowerCase()
}

/** Whether a line is the insurance line, by cost code or by name. */
export function isInsuranceLine(
  line: { readonly costCode: string | null; readonly description: string },
  insurance: Pick<InsuranceRule, "costCode" | "description">
): boolean {
  return (
    (line.costCode !== null && normalized(line.costCode) === normalized(insurance.costCode)) ||
    normalized(line.description) === normalized(insurance.description) ||
    (line.costCode !== null && normalized(line.costCode) === normalized(insurance.description))
  )
}

/**
 * The insurance rate a contract carries: its insurance line as a share of
 * everything else on it. Null when the contract has no insurance line.
 */
export function contractInsuranceRate(
  lines: readonly { readonly costCode: string; readonly description: string; readonly originalEstimateCents: number }[],
  insurance: Pick<InsuranceRule, "costCode" | "description">
): number | null {
  const insuranceCents = lines
    .filter((line) => isInsuranceLine(line, insurance))
    .reduce((sum, line) => sum + line.originalEstimateCents, 0)
  const otherCents = lines
    .filter((line) => !isInsuranceLine(line, insurance))
    .reduce((sum, line) => sum + line.originalEstimateCents, 0)
  if (insuranceCents <= 0 || otherCents <= 0) return null
  return insuranceCents / otherCents
}

/**
 * The lines Compass adds to a variance or change order when it is approved:
 * - builder fee (overhead, margin, contingency at the contract's rates) on a
 *   variance, only when the contract is straight cost plus;
 * - liability insurance on both, at the insurance rate of everything else on
 *   the record, unless the record already has an insurance line.
 * Lines already derived are ignored, so approving again recomputes them.
 */
export function derivedChangeLines(input: {
  readonly recordType: ChangeOrderRecordType
  readonly contractType: ProjectContractType
  readonly lines: readonly {
    readonly costCode: string | null
    readonly description: string
    readonly amountCents: number | null
    readonly derivedFrom: string | null
  }[]
  readonly feeRates: EstimateBuilderFeeRates
  readonly insurance: InsuranceRule
}): readonly DerivedChangeLine[] {
  const priced = input.lines.filter((line) => line.derivedFrom === null)
  const derived: DerivedChangeLine[] = []
  if (input.recordType === "variance" && feeFollowsVariances(input.contractType)) {
    const baseCents = priced
      .filter((line) => !(line.costCode && isBuilderFeeCostCode(line.costCode)) && !isInsuranceLine(line, input.insurance))
      .reduce((sum, line) => sum + (line.amountCents ?? 0), 0)
    // The estimate's own fee math, so a variance's fee rounds like the contract's.
    const totals = calculateEstimateTotals(
      [
        {
          id: null,
          divisionCode: "",
          divisionName: "",
          costCode: "",
          description: "",
          directCostCents: baseCents,
          markupCents: 0,
          taxCents: 0,
          lineTotalCents: baseCents,
          ownerVisible: true,
          includeInBuilderFee: true,
          sortOrder: 0,
        },
      ],
      input.feeRates
    )
    const amounts = [totals.overheadCents, totals.marginCents, totals.contingencyCents]
    BUILDER_FEE_NAMES.forEach((name, index) => {
      const amountCents = amounts[index] ?? 0
      if (amountCents !== 0) derived.push({ costCode: name, description: name, amountCents, derivedFrom: "builder_fee" })
    })
  }
  const hasInsurance = priced.some((line) => isInsuranceLine(line, input.insurance))
  if (!hasInsurance && input.insurance.rate > 0) {
    const insuredCents = [...priced, ...derived].reduce((sum, line) => sum + (line.amountCents ?? 0), 0)
    const amountCents = Math.round(insuredCents * input.insurance.rate)
    if (amountCents !== 0) {
      derived.push({
        costCode: input.insurance.costCode,
        description: input.insurance.description,
        amountCents,
        derivedFrom: "insurance",
      })
    }
  }
  return derived
}

// ---- view flags

const OWNER_STEPS: readonly string[] = ["approved_for_owner", "signature_pending", "executed"]
const OPEN_STATUSES: readonly string[] = ["draft", "submitted", "triage", "needs_information", "pricing", "internal_review"]

/** A variance skips the owner steps: staff approve it with Approve variance instead. */
export function varianceTransitionAllowed(recordType: string, to: string): boolean {
  return recordType !== "variance" || !OWNER_STEPS.includes(to)
}

/** What staff may do with a record as a variance or change order (project gates come with the page options). */
export function varianceView(
  row: { readonly recordType: string; readonly status: string; readonly formerChangeOrderNumber: string | null },
  canApprove: boolean
): {
  readonly recordType: ChangeOrderRecordType
  readonly formerChangeOrderNumber: string | null
  readonly canEditVarianceLines: boolean
  readonly canApproveVariance: boolean
  readonly canReclassify: boolean
} {
  const variance = row.recordType === "variance"
  const open = OPEN_STATUSES.includes(row.status)
  return {
    recordType: variance ? "variance" : "change_order",
    formerChangeOrderNumber: row.formerChangeOrderNumber,
    canEditVarianceLines: variance && open && canApprove,
    canApproveVariance: variance && open && canApprove,
    canReclassify: canApprove && !["void", "declined", "signature_pending"].includes(row.status),
  }
}
