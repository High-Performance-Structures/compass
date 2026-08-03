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
