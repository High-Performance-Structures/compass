import type { EstimateLedgerLine } from "@/lib/domain/estimates/rules"

// project-rfq-bids.ts (the RFQ area) still reads these from here.
export { calculateEstimateLine, estimateCanBeEdited, isEstimateStatus } from "@/lib/domain/estimates/rules"

export type ContractAdjustment = {
  readonly id: string
  readonly changeOrderId: string
  readonly costCode: string
  readonly description: string
  readonly amountCents: number
  readonly executedAt: string
}

type ContractBudgetLine = {
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
  readonly assemblies: readonly {
    readonly id: string
    readonly name: string
    readonly description: string | null
    readonly sortOrder: number
  }[]
  readonly estimateId: string
  readonly versionNumber: number
  readonly title: string
  readonly showCostBreakdowns?: boolean
  readonly showAssemblyBuilderFee?: boolean
  readonly reportMode: string
  readonly projectName: string
  readonly projectAddress: string | null
  readonly clientName: string | null
  readonly clientMailingAddress: string | null
  readonly introductionText: string | null
  readonly contractTerms: string | null
  readonly closingText: string | null
  readonly signers: {
    readonly clients: readonly {
      readonly name: string
      readonly title: string
      readonly email: string
      readonly initials: string
    }[]
    readonly company: {
      readonly name: string | null
      readonly title: string | null
      readonly email: string | null
      readonly initials: string | null
    }
  }
  readonly overheadRateBasisPoints: number
  readonly marginRateBasisPoints: number
  readonly contingencyRateBasisPoints: number
  readonly lines: readonly {
    readonly assemblyId: string | null
    readonly id: string
    readonly reportPhaseId: string | null
    readonly divisionCode: string
    readonly costCode: string
    readonly costCodeName: string
    readonly description: string
    readonly specifications: string | null
    readonly quantity: number
    readonly unit: string
    readonly unitCostCents: number
    readonly markupRateBasisPoints: number
    readonly taxable: boolean
    readonly taxCode: string | null
    readonly taxName: string | null
    readonly taxRateBasisPoints: number
    readonly taxCents: number
    readonly lineTotalCents: number
    readonly ownerVisible: boolean
    readonly includeInBuilderFee: boolean
    readonly sortOrder: number
    readonly costItems: readonly {
      readonly id: string
      readonly costCode: string
      readonly costCodeName: string
      readonly description: string
      readonly quantity: number
      readonly unit: string
      readonly unitCostCents: number
      readonly taxCode: string | null
      readonly taxName: string | null
      readonly taxRateBasisPoints: number
      readonly taxCents: number
      readonly lineTotalCents: number
      readonly sortOrder: number
    }[]
  }[]
  readonly basisDocuments: readonly {
    readonly id: string
    readonly projectDocumentId: string | null
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
  readonly reportPhases: readonly {
    readonly id: string
    readonly divisionCode: string
    readonly name: string
    readonly description: string
    readonly itemize: boolean
    readonly sortOrder: number
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
    .map((line) => ({
      ...line,
      costItems: [...line.costItems].sort((left, right) => {
        const sortOrder = left.sortOrder - right.sortOrder
        if (sortOrder !== 0) return sortOrder
        return left.id.localeCompare(right.id)
      }),
    }))
  const basisDocuments = [...input.basisDocuments].sort(
    (left, right) => left.sortOrder - right.sortOrder
  )
  const phaseDescriptions = [...input.phaseDescriptions].sort((left, right) =>
    left.divisionCode.localeCompare(right.divisionCode)
  )
  const acknowledgements = [...input.acknowledgements].sort(
    (left, right) => left.sortOrder - right.sortOrder
  )
  const reportPhases = [...input.reportPhases].sort((left, right) =>
    left.sortOrder - right.sortOrder || left.id.localeCompare(right.id)
  )
  const bytes = new TextEncoder().encode(
    JSON.stringify({
      estimateId: input.estimateId,
      versionNumber: input.versionNumber,
      title: input.title,
      reportMode: input.reportMode,
      showCostBreakdowns: input.showCostBreakdowns ?? false,
      ...(input.showAssemblyBuilderFee ? { showAssemblyBuilderFee: true } : {}),
      projectName: input.projectName,
      projectAddress: input.projectAddress,
      clientName: input.clientName,
      clientMailingAddress: input.clientMailingAddress,
      introductionText: input.introductionText,
      contractTerms: input.contractTerms,
      closingText: input.closingText,
      signers: input.signers,
      overheadRateBasisPoints: input.overheadRateBasisPoints,
      marginRateBasisPoints: input.marginRateBasisPoints,
      contingencyRateBasisPoints: input.contingencyRateBasisPoints,
      lines,
      assemblies: [...input.assemblies].sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id)),
      basisDocuments,
      phaseDescriptions,
      reportPhases,
      acknowledgements,
    })
  )
  const digest = await crypto.subtle.digest("SHA-256", bytes)
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
}
