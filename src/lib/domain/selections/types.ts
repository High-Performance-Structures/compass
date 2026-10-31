/** Finish selection read models and action inputs, shared by the actions, the domain module and components. */

export type ProjectSelectionStatus =
  | "needed"
  | "proposed"
  | "owner_review"
  | "approved"
  | "pricing"
  | "rfq_sent"
  | "ordered"
  | "installed"
  | "unavailable"
  | "deferred"

export type ProjectSelectionItem = {
  readonly id: string
  readonly projectId: string
  readonly sourceSystem: string
  readonly sourceRecordId: string | null
  readonly sourceWorkbookId: string | null
  readonly sourceSheetName: string | null
  readonly roomName: string
  readonly roomType: string | null
  readonly category: string
  readonly name: string
  readonly description: string | null
  readonly quantity: number | null
  readonly manufacturer: string | null
  readonly model: string | null
  readonly colorFinish: string | null
  readonly choiceOptions: readonly string[]
  readonly parentSelectionId: string | null
  readonly parentChoiceValue: string | null
  readonly selectionLevel: number
  readonly supplierName: string | null
  readonly productUrl: string | null
  readonly costCode: string | null
  readonly phaseCode: string | null
  readonly status: ProjectSelectionStatus
  readonly ownerVisible: boolean
  readonly ownerApproved: boolean
  readonly rfqOperationId: string | null
  readonly purchaseOrderOperationId: string | null
  readonly notes: string | null
  readonly syncStatus: string
  readonly updatedAt: string
}

export type ProjectSelectionRoom = {
  readonly id: string
  readonly projectId: string
  readonly sourceSystem: string
  readonly sourceWorkbookId: string | null
  readonly sourceSheetId: string | null
  readonly sourceSheetName: string | null
  readonly roomName: string
  readonly roomType: string | null
  readonly sortOrder: number
  readonly selectionCount: number
  readonly selections: readonly ProjectSelectionItem[]
}

export type ProjectSelectionsSummary = {
  readonly totalCount: number
  readonly roomCount: number
  readonly sourceWorkbookCount: number
  readonly needsDecisionCount: number
  readonly approvedCount: number
  readonly pricingCount: number
  readonly orderedCount: number
  readonly rooms: readonly ProjectSelectionRoom[]
}

export type ProjectSelectionOption = {
  readonly value: string
  readonly label: string
}

export type ProjectSelectionCostCodeOption = {
  readonly onBudget?: boolean
  readonly value: string
  readonly label: string
  readonly description: string
  readonly divisionCode: string
  readonly divisionLabel: string
  readonly source: "sage" | "company" | "project_budget" | "selection"
  readonly needsSageReview: boolean
}

export type ProjectSelectionOptions = {
  readonly roomTypes: readonly ProjectSelectionOption[]
  readonly manufacturers: readonly ProjectSelectionOption[]
  readonly divisions: readonly ProjectSelectionOption[]
  readonly costCodes: readonly ProjectSelectionCostCodeOption[]
}

export type CreateProjectSelectionInput = {
  readonly roomName: string | null
  readonly roomType: string | null
  readonly category: string | null
  readonly name: string | null
  readonly description: string | null
  readonly quantity: string | null
  readonly manufacturer: string | null
  readonly model: string | null
  readonly colorFinish: string | null
  readonly supplierName: string | null
  readonly productUrl: string | null
  readonly costCode: string | null
  readonly phaseCode: string | null
  readonly status: string | null
  readonly notes: string | null
  readonly templateId?: string | null
  readonly templateContentItemId?: string | null
  readonly choiceOptions?: readonly string[]
}

export type UpdateProjectSelectionInput = CreateProjectSelectionInput & {
  readonly changeReason: string | null
}

export type ProjectFinishScheduleImportPreview = {
  readonly workbookId: string
  readonly workbookTitle: string
  readonly workbookProjectNumber: string | null
  readonly compassProjectNumber: string | null
  readonly projectMatch: "match" | "mismatch" | "unknown"
  readonly roomCount: number
  readonly selectionCount: number
  readonly warnings: readonly string[]
}

export type ProjectFinishScheduleImportResult =
  | {
      readonly success: true
      readonly preview: ProjectFinishScheduleImportPreview
    }
  | { readonly success: false; readonly error: string }

export type ApplyProjectFinishScheduleImportResult =
  | {
      readonly success: true
      readonly createdCount: number
      readonly updatedCount: number
      readonly removedCount: number
      readonly conflictCount: number
      readonly staleCount: number
      readonly roomCount: number
    }
  | { readonly success: false; readonly error: string }
