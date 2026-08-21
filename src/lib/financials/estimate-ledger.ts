export const ESTIMATE_STATUSES = [
  "draft",
  "internal_review",
  "signature_pending",
  "accepted",
  "superseded",
  "void",
] as const

export type EstimateStatus = (typeof ESTIMATE_STATUSES)[number]

export type EstimateLineCalculationInput = {
  readonly quantity: number
  readonly unitCostCents: number
  readonly markupRateBasisPoints: number
  readonly taxable: boolean
  readonly taxRateBasisPoints: number
}

export type EstimateLineCalculation = {
  readonly directCostCents: number
  readonly markupCents: number
  readonly taxCents: number
  readonly lineTotalCents: number
}

export type EstimateLedgerLine = EstimateLineCalculation & {
  readonly id: string
  readonly divisionCode: string
  readonly divisionName: string
  readonly costCode: string
  readonly description: string
  readonly ownerVisible: boolean
  readonly sortOrder: number
}

export type EstimateLedgerTotals = {
  readonly directCostCents: number
  readonly markupCents: number
  readonly taxCents: number
  readonly estimateTotalCents: number
}

export type ContractAdjustment = {
  readonly id: string
  readonly changeOrderId: string
  readonly costCode: string
  readonly description: string
  readonly amountCents: number
  readonly executedAt: string
}

export type ContractBudgetLine = {
  readonly sourceEstimateLineId: string | null
  readonly divisionCode: string
  readonly divisionName: string
  readonly costCode: string
  readonly description: string
  readonly originalEstimateCents: number
  readonly approvedChangeCents: number
  readonly adjustedBudgetCents: number
  readonly ownerVisible: boolean
  readonly sortOrder: number
}

export type ContractBudget = {
  readonly lines: readonly ContractBudgetLine[]
  readonly originalContractSumCents: number
  readonly approvedChangesCents: number
  readonly revisedContractSumCents: number
}

function safeInteger(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.round(value)
}

function safeRate(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(1_000_000, Math.max(0, Math.round(value)))
}

export function calculateEstimateLine(
  input: EstimateLineCalculationInput
): EstimateLineCalculation {
  const quantity = Number.isFinite(input.quantity)
    ? Math.max(0, input.quantity)
    : 0
  const unitCostCents = Math.max(0, safeInteger(input.unitCostCents))
  const markupRate = safeRate(input.markupRateBasisPoints)
  const taxRate = safeRate(input.taxRateBasisPoints)
  const directCostCents = safeInteger(quantity * unitCostCents)
  const markupCents = safeInteger(
    (directCostCents * markupRate) / 10_000
  )
  const taxableSubtotal = directCostCents + markupCents
  const taxCents = input.taxable
    ? safeInteger((taxableSubtotal * taxRate) / 10_000)
    : 0

  return {
    directCostCents,
    markupCents,
    taxCents,
    lineTotalCents: taxableSubtotal + taxCents,
  }
}

export function calculateEstimateTotals(
  lines: readonly EstimateLedgerLine[]
): EstimateLedgerTotals {
  return lines.reduce<EstimateLedgerTotals>(
    (totals, line) => ({
      directCostCents: totals.directCostCents + line.directCostCents,
      markupCents: totals.markupCents + line.markupCents,
      taxCents: totals.taxCents + line.taxCents,
      estimateTotalCents: totals.estimateTotalCents + line.lineTotalCents,
    }),
    {
      directCostCents: 0,
      markupCents: 0,
      taxCents: 0,
      estimateTotalCents: 0,
    }
  )
}

export function isEstimateStatus(value: string): value is EstimateStatus {
  return ESTIMATE_STATUSES.some((status) => status === value)
}

export function estimateCanBeEdited(status: EstimateStatus): boolean {
  return status === "draft" || status === "internal_review"
}

export function estimateCanBeAccepted(input: {
  readonly status: EstimateStatus
  readonly foxitStatus: string
  readonly lineCount: number
}): boolean {
  return (
    input.status === "signature_pending" &&
    input.foxitStatus === "completed" &&
    input.lineCount > 0
  )
}

function defaultDivisionName(code: string): string {
  return `CSI Division ${code.slice(0, 2)}`
}

export function buildContractBudget(input: {
  readonly estimateLines: readonly EstimateLedgerLine[]
  readonly adjustments: readonly ContractAdjustment[]
}): ContractBudget {
  const grouped = new Map<string, ContractBudgetLine>()

  for (const line of input.estimateLines) {
    const current = grouped.get(line.costCode)
    if (current) {
      const originalEstimateCents =
        current.originalEstimateCents + line.lineTotalCents
      grouped.set(line.costCode, {
        ...current,
        sourceEstimateLineId: null,
        originalEstimateCents,
        adjustedBudgetCents:
          originalEstimateCents + current.approvedChangeCents,
        ownerVisible: current.ownerVisible || line.ownerVisible,
        sortOrder: Math.min(current.sortOrder, line.sortOrder),
      })
      continue
    }

    grouped.set(line.costCode, {
      sourceEstimateLineId: line.id,
      divisionCode: line.divisionCode,
      divisionName: line.divisionName,
      costCode: line.costCode,
      description: line.description,
      originalEstimateCents: line.lineTotalCents,
      approvedChangeCents: 0,
      adjustedBudgetCents: line.lineTotalCents,
      ownerVisible: line.ownerVisible,
      sortOrder: line.sortOrder,
    })
  }

  for (const adjustment of input.adjustments) {
    const current = grouped.get(adjustment.costCode)
    if (current) {
      const approvedChangeCents =
        current.approvedChangeCents + adjustment.amountCents
      grouped.set(adjustment.costCode, {
        ...current,
        approvedChangeCents,
        adjustedBudgetCents:
          current.originalEstimateCents + approvedChangeCents,
      })
      continue
    }

    const divisionCode = adjustment.costCode.slice(0, 2)
    grouped.set(adjustment.costCode, {
      sourceEstimateLineId: null,
      divisionCode,
      divisionName: defaultDivisionName(divisionCode),
      costCode: adjustment.costCode,
      description: adjustment.description,
      originalEstimateCents: 0,
      approvedChangeCents: adjustment.amountCents,
      adjustedBudgetCents: adjustment.amountCents,
      ownerVisible: true,
      sortOrder: 100_000 + grouped.size,
    })
  }

  const lines = [...grouped.values()].sort((left, right) => {
    const divisionOrder = left.divisionCode.localeCompare(right.divisionCode)
    if (divisionOrder !== 0) return divisionOrder
    const sortOrder = left.sortOrder - right.sortOrder
    if (sortOrder !== 0) return sortOrder
    return left.costCode.localeCompare(right.costCode)
  })
  const originalContractSumCents = lines.reduce(
    (sum, line) => sum + line.originalEstimateCents,
    0
  )
  const approvedChangesCents = lines.reduce(
    (sum, line) => sum + line.approvedChangeCents,
    0
  )

  return {
    lines,
    originalContractSumCents,
    approvedChangesCents,
    revisedContractSumCents:
      originalContractSumCents + approvedChangesCents,
  }
}

export async function contractBudgetSourceHash(input: {
  readonly estimateId: string
  readonly estimateSourceHash: string | null
  readonly adjustments: readonly ContractAdjustment[]
}): Promise<string> {
  const adjustments = [...input.adjustments]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((item) => ({
      id: item.id,
      changeOrderId: item.changeOrderId,
      costCode: item.costCode,
      amountCents: item.amountCents,
      executedAt: item.executedAt,
    }))
  const bytes = new TextEncoder().encode(
    JSON.stringify({
      estimateId: input.estimateId,
      estimateSourceHash: input.estimateSourceHash,
      adjustments,
    })
  )
  const digest = await crypto.subtle.digest("SHA-256", bytes)
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
}

export async function estimateSourceHash(input: {
  readonly estimateId: string
  readonly versionNumber: number
  readonly title: string
  readonly reportMode: string
  readonly introductionText: string | null
  readonly contractTerms: string | null
  readonly closingText: string | null
  readonly lines: readonly {
    readonly id: string
    readonly divisionCode: string
    readonly costCode: string
    readonly description: string
    readonly specifications: string | null
    readonly quantity: number
    readonly unit: string
    readonly unitCostCents: number
    readonly markupRateBasisPoints: number
    readonly taxable: boolean
    readonly taxCode: string | null
    readonly taxRateBasisPoints: number
    readonly lineTotalCents: number
    readonly ownerVisible: boolean
    readonly sortOrder: number
  }[]
  readonly basisDocuments: readonly {
    readonly id: string
    readonly documentType: string
    readonly title: string
    readonly documentDate: string | null
    readonly revision: string | null
    readonly driveFileId: string | null
    readonly driveUrl: string | null
    readonly notes: string | null
    readonly sortOrder: number
  }[]
  readonly phaseDescriptions: readonly {
    readonly divisionCode: string
    readonly description: string
  }[]
  readonly acknowledgements: readonly {
    readonly templateId: string
    readonly title: string
    readonly body: string
    readonly sortOrder: number
  }[]
}): Promise<string> {
  const lines = [...input.lines]
    .sort((left, right) => {
      const sortOrder = left.sortOrder - right.sortOrder
      if (sortOrder !== 0) return sortOrder
      return left.id.localeCompare(right.id)
    })
  const basisDocuments = [...input.basisDocuments].sort(
    (left, right) => left.sortOrder - right.sortOrder
  )
  const phaseDescriptions = [...input.phaseDescriptions].sort((left, right) =>
    left.divisionCode.localeCompare(right.divisionCode)
  )
  const acknowledgements = [...input.acknowledgements].sort(
    (left, right) => left.sortOrder - right.sortOrder
  )
  const bytes = new TextEncoder().encode(
    JSON.stringify({
      estimateId: input.estimateId,
      versionNumber: input.versionNumber,
      title: input.title,
      reportMode: input.reportMode,
      introductionText: input.introductionText,
      contractTerms: input.contractTerms,
      closingText: input.closingText,
      lines,
      basisDocuments,
      phaseDescriptions,
      acknowledgements,
    })
  )
  const digest = await crypto.subtle.digest("SHA-256", bytes)
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
}
