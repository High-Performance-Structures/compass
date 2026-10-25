export type BudgetApplicationView = {
  readonly id: string
  readonly sourceSystem: string
  readonly applicationNumber: string
  readonly periodTo: string | null
  readonly status: string
  readonly originalContractSum: number
  readonly netChanges: number
  readonly contractSumToDate: number
  readonly totalCompletedStoredToDate: number
  readonly retainageHeld: number
  readonly totalEarnedLessRetainage: number
  readonly previousCertificates: number
  readonly currentPaymentDue: number
  readonly balanceToFinish: number
  readonly ownerVisible: boolean
  readonly documentAvailable: boolean
  readonly sourceUrl: string | null
  readonly lastSyncedAt: string | null
}

export type BudgetPaymentBreakdown = {
  readonly applicationTotal: number
  readonly currentPaymentDue: number
  readonly depositApplied: number
}

type BudgetPaymentSource = Pick<
  BudgetApplicationView,
  | "totalEarnedLessRetainage"
  | "previousCertificates"
  | "currentPaymentDue"
>

export type BudgetLineView = {
  readonly id: string
  readonly sourceSystem: string
  readonly costCode: string
  readonly csiDivision: string
  readonly csiDivisionName: string
  readonly description: string
  readonly notes: string | null
  readonly originalEstimate: number
  readonly priorChanges: number
  readonly currentChanges: number
  readonly totalChanges: number
  readonly adjustedEstimate: number
  readonly priorCosts: number
  readonly currentCosts: number
  readonly totalCosts: number
  readonly percentComplete: number
  readonly balanceToFinish: number
  readonly retainageHeld: number
  readonly vendorName: string | null
  readonly ownerLabel: string | null
  readonly ownerVisible: boolean
  readonly internalNotes: string | null
}

export type BudgetLineSnapshotRow = BudgetLineView & {
  readonly applicationId: string | null
}

export function selectBudgetApplication<
  TApplication extends { readonly id: string },
>(
  applications: readonly TApplication[],
  requestedApplicationId?: string
): TApplication | null {
  if (!requestedApplicationId) return applications[0] ?? null
  return (
    applications.find(
      (application) => application.id === requestedApplicationId
    ) ?? null
  )
}

export function scopeBudgetLinesToApplication<
  TLine extends { readonly applicationId: string | null },
>(
  lines: readonly TLine[],
  applicationId: string | null
): readonly TLine[] {
  if (!applicationId) return []
  return lines.filter((line) => line.applicationId === applicationId)
}

export function sanitizeBudgetApplicationForOwner(
  application: BudgetApplicationView
): BudgetApplicationView {
  return {
    ...application,
    sourceUrl: null,
    lastSyncedAt: null,
  }
}

function currency(value: number): number {
  return Math.round(value * 100) / 100
}

export function budgetApplicationStatus(
  application: Pick<BudgetApplicationView,
    "status" | "sourceSystem" | "currentPaymentDue" | "balanceToFinish" |
    "previousCertificates" | "totalEarnedLessRetainage"
  > & { readonly syncStatus: string }
): string {
  const acceptedCloseout =
    application.sourceSystem === "google_drive_g702_g703" &&
    application.syncStatus === "client_final_closeout_accepted" &&
    currency(application.currentPaymentDue) === 0 &&
    currency(application.balanceToFinish) === 0 &&
    currency(application.previousCertificates) === currency(application.totalEarnedLessRetainage)
  return acceptedCloseout ? "paid_in_full" : application.status
}

export function budgetReconciliation(
  application: BudgetApplicationView | null,
  totals: {
    readonly adjustedEstimate: number
    readonly priorCosts: number
    readonly currentCosts: number
    readonly totalCosts: number
    readonly balanceToFinish: number
  }
): {
  readonly kind: "periodic" | "paid_closeout"
  readonly contractDifference: number
  readonly priorDifference: number
  readonly currentDifference: number
  readonly reconciliationRequired: boolean
} {
  const contractDifference = application ? currency(totals.adjustedEstimate - application.contractSumToDate) : 0
  const priorDifference = application ? currency(totals.priorCosts - application.previousCertificates) : 0
  const currentDifference = application ? currency(totals.currentCosts - application.currentPaymentDue) : 0
  // A paid final certificate rolls receipts into previous certificates; its
  // continuation sheet still describes the original draw period. Check the
  // cumulative figures instead, retaining only two cents of printed rounding.
  const paidCloseout = application !== null &&
    application.status === "paid_in_full" &&
    currency(application.currentPaymentDue) === 0 &&
    currency(application.balanceToFinish) === 0 &&
    currency(totals.balanceToFinish) === 0 &&
    currency(application.previousCertificates) === currency(application.totalEarnedLessRetainage) &&
    currency(application.totalCompletedStoredToDate) === currency(application.totalEarnedLessRetainage) &&
    currency(totals.totalCosts) === currency(application.totalCompletedStoredToDate) &&
    Math.abs(contractDifference) <= 0.02
  return {
    kind: paidCloseout ? "paid_closeout" : "periodic",
    contractDifference,
    priorDifference,
    currentDifference,
    reconciliationRequired: !paidCloseout && (
      application?.status === "paid_in_full" ||
      Math.abs(contractDifference) >= 0.02 ||
      Math.abs(priorDifference) >= 0.02 ||
      Math.abs(currentDifference) >= 0.02
    ),
  }
}

export function budgetReconciliationSummary(
  application: BudgetApplicationView | null,
  lines: readonly Pick<BudgetLineView,
    "adjustedEstimate" | "priorCosts" | "currentCosts" | "totalCosts" | "balanceToFinish"
  >[]
): {
  readonly kind: "periodic" | "paid_closeout"
  readonly reconciliationRequired: boolean
} {
  const totals = lines.reduce((sum, line) => ({
    adjustedEstimate: sum.adjustedEstimate + line.adjustedEstimate,
    priorCosts: sum.priorCosts + line.priorCosts,
    currentCosts: sum.currentCosts + line.currentCosts,
    totalCosts: sum.totalCosts + line.totalCosts,
    balanceToFinish: sum.balanceToFinish + line.balanceToFinish,
  }), { adjustedEstimate: 0, priorCosts: 0, currentCosts: 0, totalCosts: 0, balanceToFinish: 0 })
  const { kind, reconciliationRequired } = budgetReconciliation(application, totals)
  return { kind, reconciliationRequired }
}

export function budgetPaymentBreakdown(
  application: BudgetPaymentSource
): BudgetPaymentBreakdown {
  const impliedDeposit = currency(
    application.totalEarnedLessRetainage -
      application.previousCertificates -
      application.currentPaymentDue
  )
  // On the first certified application, a positive difference is an amount
  // already applied to the draw, such as a construction deposit.
  const depositApplied =
    Math.abs(application.previousCertificates) < 0.02 &&
    impliedDeposit >= 0.02
      ? impliedDeposit
      : 0

  return {
    applicationTotal: currency(
      application.currentPaymentDue + depositApplied
    ),
    currentPaymentDue: application.currentPaymentDue,
    depositApplied,
  }
}

export function sanitizeBudgetLineForOwner(
  line: BudgetLineView
): BudgetLineView {
  return {
    ...line,
    notes: null,
    vendorName: null,
    internalNotes: null,
  }
}
