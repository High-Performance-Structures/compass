"use client"

import * as React from "react"

import type { ProjectRfqCostCodeOption } from "@/lib/domain/operations/types"
import type {
  ProjectSelectionItem,
  ProjectSelectionOptions,
  ProjectSelectionsSummary,
} from "@/lib/domain/selections/types"
import { withPickedFiles, type PickedProjectFile } from "@/lib/files/picked-files"
import { RFQ_VENDOR_CATEGORY_OPTIONS, type RfqVendorCategoryOption } from "@/lib/project-rfq-categories"

import {
  ALL,
  EMPTY_SELECTION_FILTERS,
  categoryMatches,
  divisionForSelection,
  filtersWithDivision,
  flattenSelections,
  lineFromSelection,
  lineHasContent,
  lineWithCostCode,
  lineWithDivision,
  newDocumentLink,
  newLine,
  normalizeChoice,
  selectionMatchesFilters,
  type DraftRfqDocumentLink,
  type DraftRfqScopeLine,
  type RfqDocumentField,
  type RfqLineField,
  type SelectionFilterState,
} from "./rfq-draft"

/*
 * The parts of an RFQ draft that "New RFQ" (use-rfq-create-draft.ts) and
 * "Edit RFQ" (project-rfq-edit-form.tsx) share: trade category, finish
 * selection import, scope rows and the plans/specs links. The pickers in
 * this folder (RfqCategoryPicker, RfqSelectionImport, RfqScopeRows,
 * RfqDocumentLinks) each take one piece of this state.
 */

/** Finish-selection import state: filters, picks and derived lists. */
function useRfqSelections(
  selectionOptions: ProjectSelectionOptions,
  selectionsSummary: ProjectSelectionsSummary
) {
  const [selectionFilters, setSelectionFilters] =
    React.useState<SelectionFilterState>(EMPTY_SELECTION_FILTERS)
  const [selectedSelectionIds, setSelectedSelectionIds] = React.useState<
    ReadonlySet<string>
  >(new Set())
  const allSelections = React.useMemo(
    () => flattenSelections(selectionsSummary),
    [selectionsSummary]
  )
  const selectionCostCodes = React.useMemo(
    () =>
      selectionOptions.costCodes.filter((option) =>
        allSelections.some((selection) => selection.costCode === option.value)
      ),
    [allSelections, selectionOptions.costCodes]
  )
  const selectionDivisions = React.useMemo(
    () =>
      selectionOptions.divisions.filter((division) =>
        allSelections.some(
          (selection) =>
            divisionForSelection(selection, selectionOptions) === division.value
        )
      ),
    [allSelections, selectionOptions]
  )
  const filteredSelectionCostCodes = React.useMemo(
    () =>
      selectionFilters.division === ALL
        ? selectionCostCodes
        : selectionCostCodes.filter(
            (option) => option.divisionCode === selectionFilters.division
          ),
    [selectionCostCodes, selectionFilters.division]
  )
  const filteredSelections = React.useMemo(
    () =>
      allSelections.filter((selection) =>
        selectionMatchesFilters({
          filters: selectionFilters,
          options: selectionOptions,
          selection,
        })
      ),
    [allSelections, selectionFilters, selectionOptions]
  )
  const selectedSelections = React.useMemo(
    () =>
      allSelections.filter((selection) =>
        selectedSelectionIds.has(selection.id)
      ),
    [allSelections, selectedSelectionIds]
  )

  function toggleSelection(selectionId: string, checked: boolean): void {
    setSelectedSelectionIds((current) => {
      const next = new Set(current)
      if (checked) {
        next.add(selectionId)
      } else {
        next.delete(selectionId)
      }
      return next
    })
  }

  function selectAllFilteredSelections(): void {
    setSelectedSelectionIds((current) => {
      const next = new Set(current)
      for (const selection of filteredSelections) {
        next.add(selection.id)
      }
      return next
    })
  }

  function clearSelectedSelections(): void {
    setSelectedSelectionIds(new Set())
  }

  return {
    selectionFilters,
    setSelectionFilters,
    selectedSelectionIds,
    setSelectedSelectionIds,
    allSelections,
    selectionDivisions,
    filteredSelectionCostCodes,
    filteredSelections,
    selectedSelections,
    toggleSelection,
    selectAllFilteredSelections,
    clearSelectedSelections,
  }
}

export type RfqSelectionsState = ReturnType<typeof useRfqSelections> & {
  readonly importSelectedSelections: () => void
}

/** Scope rows and plans/specs document links. */
function useRfqRows(
  costCodeOptions: readonly ProjectRfqCostCodeOption[],
  initialLines: readonly DraftRfqScopeLine[],
  initialDocumentLinks: readonly DraftRfqDocumentLink[]
) {
  const [lines, setLines] = React.useState<readonly DraftRfqScopeLine[]>(
    initialLines.length > 0 ? initialLines : [newLine()]
  )
  const [documentLinks, setDocumentLinks] = React.useState<
    readonly DraftRfqDocumentLink[]
  >(initialDocumentLinks.length > 0 ? initialDocumentLinks : [newDocumentLink()])
  const [filePickerOpen, setFilePickerOpen] = React.useState(false)

  function addLine(): void {
    setLines((current) => [...current, newLine()])
  }

  function importLines(selections: readonly ProjectSelectionItem[]): void {
    const importedLines = selections.map((selection) =>
      lineFromSelection(selection, costCodeOptions)
    )
    setLines((current) => [...current.filter(lineHasContent), ...importedLines])
  }

  function removeLine(id: string): void {
    setLines((current) =>
      current.length === 1 ? current : current.filter((line) => line.id !== id)
    )
  }

  function updateLine(id: string, field: RfqLineField, value: string): void {
    setLines((current) =>
      current.map((line) =>
        line.id === id
          ? {
              ...line,
              [field]: value,
            }
          : line
      )
    )
  }

  function updateLineDivision(id: string, divisionCode: string): void {
    setLines((current) => current.map((line) =>
      line.id === id ? lineWithDivision(line, divisionCode, costCodeOptions) : line
    ))
  }

  function updateLineCostCode(id: string, costCode: string): void {
    setLines((current) => current.map((line) => line.id === id
      ? lineWithCostCode(line, costCode, costCodeOptions)
      : line
    ))
  }

  function addDocumentLink(): void {
    setDocumentLinks((current) => [...current, newDocumentLink()])
  }

  function addPickedFiles(files: readonly PickedProjectFile[]): void {
    setDocumentLinks((current) => withPickedFiles(current, files, newDocumentLink))
  }

  function removeDocumentLink(id: string): void {
    setDocumentLinks((current) =>
      current.length === 1 ? current : current.filter((link) => link.id !== id)
    )
  }

  function updateDocumentLink(
    id: string,
    field: RfqDocumentField,
    value: string
  ): void {
    setDocumentLinks((current) =>
      current.map((link) =>
        link.id === id
          ? {
              ...link,
              [field]: value,
            }
          : link
      )
    )
  }

  return {
    lines,
    setLines,
    documentLinks,
    setDocumentLinks,
    filePickerOpen,
    setFilePickerOpen,
    addLine,
    importLines,
    removeLine,
    updateLine,
    updateLineDivision,
    updateLineCostCode,
    addDocumentLink,
    addPickedFiles,
    removeDocumentLink,
    updateDocumentLink,
  }
}

export type RfqRowsState = ReturnType<typeof useRfqRows>

/** Vendor category / trade picker state. */
function useRfqCategory(initialCategory: string) {
  const [categoryPickerOpen, setCategoryPickerOpen] = React.useState(false)
  const [categoryQuery, setCategoryQuery] = React.useState("")
  const [vendorCategory, setVendorCategory] = React.useState(initialCategory)
  const normalizedCategoryQuery = normalizeChoice(categoryQuery)
  const vendorCategoryOptions = RFQ_VENDOR_CATEGORY_OPTIONS.filter((option) =>
    categoryMatches(option, normalizedCategoryQuery)
  )

  function useTypedVendorCategory(): void {
    const typedCategory = categoryQuery.trim()
    if (!typedCategory) return
    setVendorCategory(typedCategory)
    setCategoryQuery("")
    setCategoryPickerOpen(false)
  }

  function clearVendorCategory(): void {
    setVendorCategory("")
    setCategoryQuery("")
  }

  return {
    categoryPickerOpen,
    setCategoryPickerOpen,
    categoryQuery,
    setCategoryQuery,
    vendorCategory,
    setVendorCategory,
    vendorCategoryOptions,
    useTypedVendorCategory,
    clearVendorCategory,
  }
}

export type RfqCategoryState = ReturnType<typeof useRfqCategory> & {
  readonly selectVendorCategory: (option: RfqVendorCategoryOption) => void
}

/** Starting values; "New RFQ" starts empty, "Edit RFQ" from the saved RFQ. */
export type RfqScopeDraftInitial = {
  readonly vendorCategory: string
  readonly lines: readonly DraftRfqScopeLine[]
  readonly documentLinks: readonly DraftRfqDocumentLink[]
}

export const EMPTY_RFQ_SCOPE_DRAFT: RfqScopeDraftInitial = {
  vendorCategory: "",
  lines: [],
  documentLinks: [],
}

/**
 * Category, selection import and rows wired together: picking a trade with a
 * CSI division narrows the selection filters to it, and importing selections
 * adds them as scope rows.
 */
export function useRfqScopeDraft({
  selectionOptions,
  selectionsSummary,
  costCodeOptions,
  initial,
}: {
  readonly selectionOptions: ProjectSelectionOptions
  readonly selectionsSummary: ProjectSelectionsSummary
  readonly costCodeOptions: readonly ProjectRfqCostCodeOption[]
  readonly initial: RfqScopeDraftInitial
}) {
  const baseCategory = useRfqCategory(initial.vendorCategory)
  const baseSelections = useRfqSelections(selectionOptions, selectionsSummary)
  const rows = useRfqRows(costCodeOptions, initial.lines, initial.documentLinks)

  function selectVendorCategory(option: RfqVendorCategoryOption): void {
    baseCategory.setVendorCategory(option.label)
    baseCategory.setCategoryQuery("")
    baseCategory.setCategoryPickerOpen(false)
    const division = option.division
    if (division) {
      baseSelections.setSelectionFilters((current) =>
        filtersWithDivision(current, division, selectionOptions.costCodes)
      )
    }
  }

  function importSelectedSelections(): void {
    if (baseSelections.selectedSelections.length === 0) return
    rows.importLines(baseSelections.selectedSelections)
    baseSelections.setSelectedSelectionIds(new Set())
  }

  /** Back to an empty draft after "New RFQ" is created. */
  function reset(): void {
    baseCategory.setVendorCategory("")
    baseSelections.setSelectedSelectionIds(new Set())
    baseSelections.setSelectionFilters(EMPTY_SELECTION_FILTERS)
    rows.setLines([newLine()])
    rows.setDocumentLinks([newDocumentLink()])
  }

  const category: RfqCategoryState = { ...baseCategory, selectVendorCategory }
  const selections: RfqSelectionsState = { ...baseSelections, importSelectedSelections }
  return { category, selections, rows, reset }
}
