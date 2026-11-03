/*
 * Pure draft rules for the "New RFQ" sheet: scope rows, document links,
 * recipient/category matching and finish-selection filters.
 */

import type {
  CreateRfqDocumentLinkInput,
  CreateRfqScopeLineInput,
  ProjectRfqCostCodeOption,
} from "@/lib/domain/operations/types"
import type { ProjectTaskAssigneeOption } from "@/lib/domain/contacts/types"
import type {
  ProjectSelectionItem,
  ProjectSelectionOptions,
  ProjectSelectionsSummary,
} from "@/lib/domain/selections/types"
import type { RfqVendorCategoryOption } from "@/lib/project-rfq-categories"
import { cleanText } from "@/lib/shared/guards"

export type DraftRfqScopeLine = {
  readonly selectionId: string | null
  readonly id: string
  readonly description: string
  readonly phaseCode: string
  readonly costCode: string
  readonly notes: string
}

export type DraftRfqDocumentLink = {
  readonly id: string
  readonly label: string
  readonly url: string
  readonly notes: string
}

export type RfqLineField = "description" | "notes"
export type RfqDocumentField = "label" | "url" | "notes"
export type SelectionFilterState = {
  readonly division: string
  readonly costCode: string
  readonly roomName: string
}

export type RfqStatus =
  | { readonly kind: "idle" }
  | { readonly kind: "saving" }
  | { readonly kind: "saved"; readonly message: string }
  | { readonly kind: "error"; readonly message: string }

export const DOCUMENT_INPUT_CLASS =
  "rounded-none border-x-0 border-t-0 px-0 shadow-none focus-visible:ring-0 focus-visible:border-foreground"
export const LINE_INPUT_CLASS =
  "h-8 rounded-none border-0 bg-transparent px-1 shadow-none focus-visible:ring-0 focus-visible:bg-background"
export const ALL = "all"

export const EMPTY_SELECTION_FILTERS: SelectionFilterState = {
  division: ALL,
  costCode: ALL,
  roomName: ALL,
}

export function newLine(): DraftRfqScopeLine {
  return {
    selectionId: null,
    id: crypto.randomUUID(),
    description: "",
    phaseCode: "",
    costCode: "",
    notes: "",
  }
}

export function lineFromSelection(
  selection: ProjectSelectionItem,
  costCodeOptions: readonly ProjectRfqCostCodeOption[]
): DraftRfqScopeLine {
  const detail = [
    selection.manufacturer ? `Manufacturer: ${selection.manufacturer}` : null,
    selection.model ? `Model: ${selection.model}` : null,
    selection.colorFinish ? `Finish: ${selection.colorFinish}` : null,
    selection.supplierName ? `Supplier: ${selection.supplierName}` : null,
    selection.productUrl ? `Product: ${selection.productUrl}` : null,
    selection.notes ? `Notes: ${selection.notes}` : null,
  ]
    .filter((value): value is string => value !== null)
    .join(" | ")

  return {
    id: crypto.randomUUID(),
    selectionId: selection.id,
    description: `${selection.roomName}: ${selection.name}`,
    phaseCode:
      costCodeOptions.find((option) => option.value === selection.costCode)
        ?.divisionCode ?? selection.phaseCode ?? "",
    costCode: selection.costCode ?? "",
    notes: detail,
  }
}

export function newDocumentLink(): DraftRfqDocumentLink {
  return {
    id: crypto.randomUUID(),
    label: "",
    url: "",
    notes: "",
  }
}

export function normalizeChoice(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

export function optionMatches(
  option: ProjectTaskAssigneeOption,
  normalizedQuery: string
): boolean {
  if (!normalizedQuery) return true

  return normalizeChoice(
    [
      option.name,
      option.label,
      option.companyName,
      option.email,
      option.contactType,
    ]
      .filter((value): value is string => Boolean(value))
      .join(" ")
  ).includes(normalizedQuery)
}

export function categoryMatches(
  option: RfqVendorCategoryOption,
  normalizedQuery: string
): boolean {
  if (!normalizedQuery) return true
  return normalizeChoice(`${option.label} ${option.division ?? ""}`).includes(
    normalizedQuery
  )
}

export function toScopeInput(line: DraftRfqScopeLine): CreateRfqScopeLineInput {
  return {
    selectionId: line.selectionId,
    description: cleanText(line.description),
    phaseCode: cleanText(line.phaseCode),
    costCode: cleanText(line.costCode),
    notes: cleanText(line.notes),
  }
}

export function toDocumentInput(
  link: DraftRfqDocumentLink
): CreateRfqDocumentLinkInput {
  return {
    label: cleanText(link.label),
    url: cleanText(link.url),
    notes: cleanText(link.notes),
  }
}

export function contactTypeLabel(value: string): string {
  if (value === "supplier") return "Supplier"
  if (value === "subcontractor") return "Subcontractor"
  if (value === "internal") return "Internal"
  if (value === "owner") return "Owner"
  return value
}

export function selectionStatusLabel(status: ProjectSelectionItem["status"]): string {
  return status
    .split("_")
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ")
}

export function flattenSelections(
  summary: ProjectSelectionsSummary
): readonly ProjectSelectionItem[] {
  return summary.rooms.flatMap((room) => room.selections)
}

export function divisionForSelection(
  selection: ProjectSelectionItem,
  options: ProjectSelectionOptions
): string | null {
  if (!selection.costCode) return null
  return (
    options.costCodes.find((option) => option.value === selection.costCode)
      ?.divisionCode ?? selection.costCode.slice(0, 2)
  )
}

export function selectionMatchesFilters({
  filters,
  options,
  selection,
}: {
  readonly filters: SelectionFilterState
  readonly options: ProjectSelectionOptions
  readonly selection: ProjectSelectionItem
}): boolean {
  if (filters.roomName !== ALL && selection.roomName !== filters.roomName) {
    return false
  }
  if (filters.costCode !== ALL && selection.costCode !== filters.costCode) {
    return false
  }
  if (filters.division !== ALL) {
    return divisionForSelection(selection, options) === filters.division
  }
  return true
}

/**
 * Filters narrowed to a division: the cost-code filter is kept only when it
 * belongs to that division (or the division is "all").
 */
export function filtersWithDivision(
  current: SelectionFilterState,
  division: string,
  costCodes: ProjectSelectionOptions["costCodes"]
): SelectionFilterState {
  return {
    ...current,
    division,
    costCode:
      division === ALL ||
      costCodes.some(
        (option) =>
          option.value === current.costCode &&
          option.divisionCode === division
      )
        ? current.costCode
        : ALL,
  }
}

/** True when the scope row has any text worth keeping. */
export function lineHasContent(line: DraftRfqScopeLine): boolean {
  return (
    cleanText(line.description) !== null ||
    cleanText(line.phaseCode) !== null ||
    cleanText(line.costCode) !== null ||
    cleanText(line.notes) !== null
  )
}

/** A row moved to a division; its cost code is kept only if it's in it. */
export function lineWithDivision(
  line: DraftRfqScopeLine,
  divisionCode: string,
  costCodeOptions: readonly ProjectRfqCostCodeOption[]
): DraftRfqScopeLine {
  const selectedCode = costCodeOptions.find(
    (option) => option.value === line.costCode
  )
  return {
    ...line,
    phaseCode: divisionCode,
    costCode: selectedCode?.divisionCode === divisionCode
      ? line.costCode : "",
  }
}

/** A row given a cost code; its division follows the code when known. */
export function lineWithCostCode(
  line: DraftRfqScopeLine,
  costCode: string,
  costCodeOptions: readonly ProjectRfqCostCodeOption[]
): DraftRfqScopeLine {
  const selectedCode = costCodeOptions.find(
    (option) => option.value === costCode
  )
  return {
    ...line,
    costCode,
    phaseCode: selectedCode?.divisionCode ?? line.phaseCode,
  }
}
