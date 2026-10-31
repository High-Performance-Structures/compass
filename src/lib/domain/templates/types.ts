/** Estimate template shapes shared by the template actions and the editor. */

export type EstimateTemplateOption = {
  readonly id: string
  readonly name: string
  readonly description: string | null
  readonly versionNumber: number
  readonly lineCount: number
  readonly requiresProjectTaxEntity: boolean
}

export type EstimateTemplateEditorLine = {
  readonly id: string
  readonly divisionCode: string
  readonly divisionName: string
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
  readonly ownerVisible: boolean
  readonly sortOrder: number
}

export type EstimateTemplateEditor = {
  readonly canEdit: boolean
  readonly id: string
  readonly name: string
  readonly description: string | null
  readonly lifecycleStatus: string
  readonly reviewStatus: string
  readonly versionId: string
  readonly versionNumber: number
  readonly versionStatus: string
  readonly documentTitle: string
  readonly contractTerms: string | null
  readonly defaultMarkupRateBasisPoints: number
  readonly lines: readonly EstimateTemplateEditorLine[]
  readonly costCodes: readonly {
    readonly value: string
    readonly label: string
    readonly divisionCode: string
    readonly divisionName: string
  }[]
  readonly taxCodes: readonly {
    readonly value: string
    readonly label: string
    readonly rateBasisPoints: number
  }[]
}

export type EstimateTemplateLineInput = {
  readonly costCode: string | null
  readonly description: string | null
  readonly specifications: string | null
  readonly quantity: number | null
  readonly unit: string | null
  readonly unitCost: number | null
  readonly markupPercent: number | null
  readonly taxable: boolean
  readonly taxCode: string | null
  readonly ownerVisible: boolean
}

export type ProjectTemplateLibraryItem = {
  readonly id: string
  readonly name: string
  readonly description: string | null
  readonly sourceSystem: string
  readonly templateKind: string
  readonly departmentCode: string | null
  readonly tradeCategory: string | null
  readonly lifecycleStatus: string
  readonly reviewStatus: string
  readonly currentVersionNumber: number | null
  readonly currentVersionId: string | null
  readonly currentVersionStatus: string | null
  readonly scheduleItemCount: number
  readonly dependencyCount: number
  readonly modules: readonly ProjectTemplateModuleSummary[]
}

export type ProjectTemplateContentItem = {
  readonly id: string
  readonly moduleType: string
  readonly sourceItemId: string | null
  readonly parentSourceItemId: string | null
  readonly title: string
  readonly category: string | null
  readonly description: string | null
  readonly sortOrder: number
  readonly payloadJson: string | null
}

type ProjectTemplateModuleSummary = {
  readonly moduleType: string
  readonly sourceItemCount: number
  readonly normalizationStatus: string
}

export type ProjectTemplatePreview = ProjectTemplateLibraryItem & {
  readonly scheduleItems: readonly {
    readonly title: string
    readonly workdays: number
    readonly startOffsetWorkdays: number
    readonly phase: string
    readonly assigneePlaceholder: string | null
  }[]
  readonly assigneePlaceholders: readonly string[]
}
