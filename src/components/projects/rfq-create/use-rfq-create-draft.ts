"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

import { createRfqRequest } from "@/app/actions/project-operations"
import type { ProjectRfqCostCodeOption } from "@/lib/domain/operations/types"
import { directoryVendorPick } from "@/lib/domain/contacts/rules"
import type { ProjectTaskAssigneeOption } from "@/lib/domain/contacts/types"
import type {
  ProjectSelectionItem,
  ProjectSelectionOptions,
  ProjectSelectionsSummary,
} from "@/lib/domain/selections/types"
import { withPickedFiles, type PickedProjectFile } from "@/lib/files/picked-files"
import { RFQ_VENDOR_CATEGORY_OPTIONS, type RfqVendorCategoryOption } from "@/lib/project-rfq-categories"
import { cleanText } from "@/lib/shared/guards"

import {
  ALL,
  EMPTY_SELECTION_FILTERS,
  categoryMatches,
  contactTypeLabel,
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
  optionMatches,
  selectionMatchesFilters,
  toDocumentInput,
  toScopeInput,
  type DraftRfqDocumentLink,
  type DraftRfqScopeLine,
  type RfqDocumentField,
  type RfqLineField,
  type RfqStatus,
  type SelectionFilterState,
} from "./rfq-draft"

/** Recipient ("Requested from") picker state and actions. */
function useRfqRecipient(recipientOptions: readonly ProjectTaskAssigneeOption[]) {
  const [recipientPickerOpen, setRecipientPickerOpen] = React.useState(false)
  const [recipientQuery, setRecipientQuery] = React.useState("")
  const [selectedRecipientId, setSelectedRecipientId] = React.useState<
    string | null
  >(null)
  const [requestedFrom, setRequestedFrom] = React.useState("")
  const [recipientEmail, setRecipientEmail] = React.useState("")
  const normalizedRecipientQuery = normalizeChoice(recipientQuery)
  const projectRecipientOptions = recipientOptions.filter(
    (option) =>
      option.source === "project" &&
      optionMatches(option, normalizedRecipientQuery)
  )
  const directoryRecipientOptions = recipientOptions.filter(
    (option) =>
      option.source === "directory" &&
      optionMatches(option, normalizedRecipientQuery)
  )
  const selectedRecipient = selectedRecipientId
    ? (recipientOptions.find((option) => option.id === selectedRecipientId) ??
      null)
    : null

  function useTypedRecipient(): void {
    const typedName = recipientQuery.trim()
    if (!typedName) return

    setSelectedRecipientId(null)
    setRequestedFrom(typedName)
    setRecipientQuery("")
    setRecipientPickerOpen(false)
  }

  function clearRecipient(): void {
    setSelectedRecipientId(null)
    setRequestedFrom("")
    setRecipientEmail("")
    setRecipientQuery("")
  }

  return {
    recipientPickerOpen,
    setRecipientPickerOpen,
    recipientQuery,
    setRecipientQuery,
    selectedRecipientId,
    setSelectedRecipientId,
    requestedFrom,
    setRequestedFrom,
    recipientEmail,
    setRecipientEmail,
    normalizedRecipientQuery,
    projectRecipientOptions,
    directoryRecipientOptions,
    selectedRecipient,
    useTypedRecipient,
    clearRecipient,
  }
}

export type RfqRecipientState = ReturnType<typeof useRfqRecipient> & {
  readonly selectRecipient: (option: ProjectTaskAssigneeOption) => void
}

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
function useRfqRows(costCodeOptions: readonly ProjectRfqCostCodeOption[]) {
  const [lines, setLines] = React.useState<readonly DraftRfqScopeLine[]>([
    newLine(),
  ])
  const [documentLinks, setDocumentLinks] = React.useState<
    readonly DraftRfqDocumentLink[]
  >([newDocumentLink()])
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
function useRfqCategory() {
  const [categoryPickerOpen, setCategoryPickerOpen] = React.useState(false)
  const [categoryQuery, setCategoryQuery] = React.useState("")
  const [vendorCategory, setVendorCategory] = React.useState("")
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

/** Every piece of "New RFQ" draft state, its actions and the submit. */
export function useRfqCreateDraft({
  projectId,
  recipientOptions,
  selectionOptions,
  selectionsSummary,
  costCodeOptions,
}: {
  readonly projectId: string
  readonly recipientOptions: readonly ProjectTaskAssigneeOption[]
  readonly selectionOptions: ProjectSelectionOptions
  readonly selectionsSummary: ProjectSelectionsSummary
  readonly costCodeOptions: readonly ProjectRfqCostCodeOption[]
}) {
  const router = useRouter()
  const formRef = React.useRef<HTMLFormElement>(null)
  const [open, setOpen] = React.useState(false)
  const baseRecipient = useRfqRecipient(recipientOptions)
  const baseCategory = useRfqCategory()
  const [priority, setPriority] = React.useState("normal")
  const baseSelections = useRfqSelections(selectionOptions, selectionsSummary)
  const rows = useRfqRows(costCodeOptions)
  const [status, setStatus] = React.useState<RfqStatus>({ kind: "idle" })
  const lineCount = rows.lines.filter(
    (line) => cleanText(line.description) !== null
  ).length
  const documentCount = rows.documentLinks.filter(
    (link) => cleanText(link.url) !== null
  ).length

  function selectRecipient(option: ProjectTaskAssigneeOption): void {
    baseRecipient.setSelectedRecipientId(option.id)
    baseRecipient.setRequestedFrom(option.companyName ?? option.name)
    baseRecipient.setRecipientEmail(option.email ?? "")
    baseCategory.setVendorCategory(contactTypeLabel(option.contactType))
    baseRecipient.setRecipientQuery("")
    baseRecipient.setRecipientPickerOpen(false)
  }

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

  async function handleSubmit(
    event: React.FormEvent<HTMLFormElement>
  ): Promise<void> {
    event.preventDefault()
    const form = formRef.current
    if (!form) return

    setStatus({ kind: "saving" })
    const formData = new FormData(form)
    const result = await createRfqRequest(projectId, {
      title: String(formData.get("title") ?? ""),
      vendorCategory: cleanText(baseCategory.vendorCategory),
      requestedFrom: cleanText(baseRecipient.requestedFrom),
      recipientEmail: cleanText(baseRecipient.recipientEmail),
      responseDueDate: cleanText(
        String(formData.get("responseDueDate") ?? "")
      ),
      vendorPick: directoryVendorPick(baseRecipient.selectedRecipient),
      priority,
      scope: cleanText(String(formData.get("scope") ?? "")),
      scopeItems: rows.lines.map(toScopeInput),
      documentLinks: rows.documentLinks.map(toDocumentInput),
    })

    if (!result.success) {
      setStatus({ kind: "error", message: result.error })
      return
    }

    form.reset()
    baseRecipient.setSelectedRecipientId(null)
    baseRecipient.setRequestedFrom("")
    baseRecipient.setRecipientEmail("")
    baseCategory.setVendorCategory("")
    setPriority("normal")
    baseSelections.setSelectedSelectionIds(new Set())
    baseSelections.setSelectionFilters({ division: ALL, costCode: ALL, roomName: ALL })
    rows.setLines([newLine()])
    rows.setDocumentLinks([newDocumentLink()])
    setStatus({ kind: "saved", message: "RFQ draft created." })
    setOpen(false)
    router.push(
      `/dashboard/projects/${projectId}/rfqs?created=${encodeURIComponent(
        result.id
      )}`
    )
    router.refresh()
  }

  const recipient: RfqRecipientState = { ...baseRecipient, selectRecipient }
  const category: RfqCategoryState = { ...baseCategory, selectVendorCategory }
  const selections: RfqSelectionsState = { ...baseSelections, importSelectedSelections }

  return {
    formRef,
    open,
    setOpen,
    recipient,
    category,
    priority,
    setPriority,
    selections,
    rows,
    status,
    lineCount,
    documentCount,
    handleSubmit,
  }
}
