import type { ChangeOrderKind } from "@/lib/change-orders/kinds"
import type { ChangeOrderStatus } from "@/lib/change-orders/status"
import type { RecordedChangeOrderRequesterType } from "@/lib/change-orders/provenance"
import type { ChangeOrderBudgetTreatment } from "@/lib/change-orders/rebaseline"

/** Shapes of project change orders shared by actions, print reports, and views. */
export type ChangeOrderAudience = "internal" | "owner" | "sub_vendor"
export type ChangeOrderDocumentInput = {
  readonly label: string
  readonly url: string
  readonly notes: string | null
}

export type ChangeOrderExecutedDocumentInput = {
  readonly url: string
  readonly label: string
  readonly attested: boolean
}

export type ChangeOrderExecutedDocumentReplacementInput =
  ChangeOrderExecutedDocumentInput & {
    readonly reason: string
  }

export type ProjectChangeOrderPhaseOption = {
  readonly value: string
  readonly label: string
}

export type ProjectChangeOrderCostCodeOption = {
  readonly onBudget?: boolean
  readonly value: string
  readonly label: string
  readonly description: string
  readonly divisionCode: string
}

export type ProjectChangeOrderCompanyOption = {
  readonly value: string
  readonly label: string
  readonly description: string
}

export type ProjectChangeOrderEstimateOption = {
  readonly id: string
  readonly estimateNumber: string
  readonly versionNumber: number
  readonly title: string
  readonly status: string
  readonly estimateTotalCents: number
}

export type ProjectChangeOrderFormOptions = {
  readonly phases: readonly ProjectChangeOrderPhaseOption[]
  readonly costCodes: readonly ProjectChangeOrderCostCodeOption[]
  readonly companies: readonly ProjectChangeOrderCompanyOption[]
  readonly estimates: readonly ProjectChangeOrderEstimateOption[]
  readonly currentBaselineEstimateId: string | null
  /** The accepted contract estimate's assemblies a change can add to or reduce. */
  readonly contractAssemblies: readonly { readonly id: string; readonly name: string }[]
}

export type ProjectChangeOrderItem = {
  readonly id: string
  readonly projectId: string
  readonly changeOrderNumber: string
  readonly title: string
  readonly scope: string
  readonly reason: string | null
  readonly amountCents: number | null
  readonly scheduleImpactDays: number | null
  readonly status: ChangeOrderStatus
  readonly audience: ChangeOrderAudience
  readonly requesterType: RecordedChangeOrderRequesterType
  readonly requesterUserId: string | null
  readonly requesterName: string
  readonly requesterCompany: string | null
  readonly sourceType: string
  readonly sourceRecordId: string | null
  readonly sourceHref: string | null
  readonly internalNotes: string | null
  readonly budgetTreatment: ChangeOrderBudgetTreatment
  /** How it's built; null for older change orders with recorded lines. */
  readonly kind: ChangeOrderKind | null
  readonly baselineEstimate: ProjectChangeOrderEstimateOption | null
  readonly replacementEstimate: ProjectChangeOrderEstimateOption | null
  /** This change order's own estimate (built like the contract estimate). */
  readonly changeOrderEstimate: ProjectChangeOrderEstimateOption | null
  readonly replacementEstimateUrl: string | null
  readonly estimateComparisonUrl: string | null
  readonly rebaselineCompletedAt: string | null
  readonly rebaselineBlockers: readonly string[]
  readonly canExecuteRebaseline: boolean
  readonly foxitStatus: string
  readonly sageStatus: string
  readonly executedDocumentAvailable: boolean
  readonly executedDocumentLabel: string | null
  readonly canManageExecutedDocument: boolean
  readonly submittedAt: string | null
  readonly createdAt: string
  readonly updatedAt: string
  readonly canEdit: boolean
  readonly canApprove: boolean
  readonly allowedTransitions: readonly ChangeOrderStatus[]
  readonly lines: readonly {
    readonly id: string
    readonly lineNumber: number
    readonly description: string
    readonly phaseCode: string | null
    readonly costCode: string | null
    readonly amountCents: number | null
    /** Set on lines compared between two contract-estimate versions. */
    readonly changeKind: string | null
    readonly previousAmountCents: number | null
    readonly newAmountCents: number | null
    /** The contract assembly the line adds to or reduces. */
    readonly assemblyName: string | null
  }[]
  readonly documents: readonly {
    readonly id: string
    readonly label: string
    readonly url: string
    readonly notes: string | null
  }[]
  readonly history: readonly {
    readonly id: string
    readonly eventType: string
    readonly fromStatus: string | null
    readonly toStatus: string | null
    readonly actorName: string
    readonly actorRole: string
    readonly note: string | null
    readonly createdAt: string
  }[]
}
