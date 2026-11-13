/**
 * Row values for a job's Selections sheet: follow-up selections placed under
 * the selection whose choice opens them, the owner's pick, over/under the
 * allowance, the status groups behind the filter buttons, and search. Pure:
 * no React, database or network access.
 */
import { PROJECT_SELECTION_STATUS_LABELS, type ProjectSelectionStatus } from "@/lib/domain/selections/statuses"
import { DEFAULT_SELECTION_STATUS_LABELS, selectionStatusLabel, type SelectionStatusLabels } from "@/lib/domain/selections/status-labels"

export type SelectionSheetInput = {
  readonly selections: readonly {
    readonly id: string
    readonly roomName: string
    readonly name: string
    readonly category: string
    readonly costCode: string | null
    readonly status: ProjectSelectionStatus
    readonly sourceSystem: string
    readonly sortOrder: number
    /** The older parent link from a sheet import (parent_selection_id). */
    readonly legacyParentId: string | null
    readonly allowanceCents: number | null
    readonly dueDate: string | null
    readonly published: boolean
    readonly roundKey: string | null
    /** A signature covers it (a signed Selection Phase, or its executed replacement change order). */
    readonly signed?: boolean
    /** Another selection replaces it (it stays on record, locked). */
    readonly replaced?: boolean
    /** It replaces an ordered or installed selection. */
    readonly replacement?: boolean
  }[]
  readonly choices: readonly {
    readonly selectionId: string
    readonly title: string
    readonly chosen: boolean
    readonly priceCents: number | null
    readonly ownerPriceCents: number | null
  }[]
  /** A follow-up selection and the selection whose choice opens it. */
  readonly dependents: readonly { readonly selectionId: string; readonly parentId: string }[]
}

export type SelectionSheetRow = {
  readonly id: string
  readonly roomName: string
  readonly name: string
  readonly category: string
  readonly costCode: string | null
  readonly status: ProjectSelectionStatus
  readonly sourceSystem: string
  /** The selection this one follows up on (its parent's choice opens it), or null. */
  readonly parentId: string | null
  readonly parentName: string | null
  readonly followUpCount: number
  readonly choiceCount: number
  readonly pickTitle: string | null
  /** The pick's supplier price (staff only). */
  readonly pickPriceCents: number | null
  /** The pick's owner price. */
  readonly pickOwnerPriceCents: number | null
  readonly allowanceCents: number | null
  /** The pick's owner price minus the allowance; null when either is missing. */
  readonly deltaCents: number | null
  readonly dueDate: string | null
  readonly published: boolean
  /** The company round (Settings > Selections) it belongs to, or null. */
  readonly roundKey: string | null
  /** A signature covers it: "Approved" reads "Approved (signed)". */
  readonly signed: boolean
  /** Another selection replaces it. */
  readonly replaced: boolean
  /** It replaces an ordered or installed selection (outside Selection Phases; its change order is its signature). */
  readonly replacement: boolean
  /** Sorts room, then parent, then its follow-ups right under it. */
  readonly orderKey: string
}

export function selectionSheetRows(input: SelectionSheetInput): readonly SelectionSheetRow[] {
  const byId = new Map(input.selections.map((row) => [row.id, row]))
  const parentOf = new Map<string, string>()
  for (const row of input.selections) {
    if (row.legacyParentId && byId.has(row.legacyParentId) && row.legacyParentId !== row.id) parentOf.set(row.id, row.legacyParentId)
  }
  // A dependent link from a choice wins over the older sheet link.
  for (const link of input.dependents) {
    if (byId.has(link.parentId) && link.parentId !== link.selectionId) parentOf.set(link.selectionId, link.parentId)
  }
  const followUps = new Map<string, number>()
  for (const parentId of parentOf.values()) followUps.set(parentId, (followUps.get(parentId) ?? 0) + 1)

  const position = new Map(input.selections.map((row, index) => [row.id, String(index).padStart(6, "0")]))
  return input.selections.map((row) => {
    const choices = input.choices.filter((choice) => choice.selectionId === row.id)
    const pick = choices.find((choice) => choice.chosen) ?? null
    const parentId = parentOf.get(row.id) ?? null
    // Only one level is indented; a follow-up of a follow-up sits under the same top parent.
    const top = parentId ? (parentOf.get(parentId) ?? parentId) : row.id
    const topRow = byId.get(top) ?? row
    const pickOwnerPriceCents = pick?.ownerPriceCents ?? null
    return {
      id: row.id,
      roomName: row.roomName,
      name: row.name,
      category: row.category,
      costCode: row.costCode,
      status: row.status,
      sourceSystem: row.sourceSystem,
      parentId,
      parentName: parentId ? (byId.get(parentId)?.name ?? null) : null,
      followUpCount: followUps.get(row.id) ?? 0,
      choiceCount: choices.length,
      pickTitle: pick?.title ?? null,
      pickPriceCents: pick?.priceCents ?? null,
      pickOwnerPriceCents,
      allowanceCents: row.allowanceCents,
      deltaCents: pickOwnerPriceCents === null || row.allowanceCents === null ? null : pickOwnerPriceCents - row.allowanceCents,
      dueDate: row.dueDate,
      published: row.published,
      roundKey: row.roundKey,
      signed: row.signed ?? false,
      replaced: row.replaced ?? false,
      replacement: row.replacement ?? false,
      orderKey: [topRow.roomName.toLocaleLowerCase(), position.get(top) ?? "", parentId ? "1" : "0", position.get(row.id) ?? ""].join("\u0000"),
    }
  })
}

export type SelectionListFilter = "open" | "needed" | "with_owner" | "approved" | "ordered" | "installed" | "all"

const SELECTION_LIST_FILTERS: readonly { readonly value: SelectionListFilter; readonly label: string }[] = [
  { value: "open", label: "Open" },
  { value: "needed", label: "Needed" },
  { value: "with_owner", label: "With owner" },
  { value: "approved", label: "Approved" },
  { value: "ordered", label: "Ordered" },
  { value: "installed", label: "Installed" },
  { value: "all", label: "All" },
]

/** The status whose company name labels each filter button ("Open" and "All" keep theirs). */
const FILTER_NAMED_BY: Readonly<Partial<Record<SelectionListFilter, ProjectSelectionStatus>>> = {
  needed: "needed",
  with_owner: "owner_review",
  approved: "approved",
  ordered: "ordered",
  installed: "installed",
}

/** The filter buttons labelled with the company's status names. Filter values (and grouping) never change. */
export function selectionListFilters(
  labels: SelectionStatusLabels = DEFAULT_SELECTION_STATUS_LABELS,
): readonly { readonly value: SelectionListFilter; readonly label: string }[] {
  return SELECTION_LIST_FILTERS.map((filter) => {
    const status = FILTER_NAMED_BY[filter.value]
    return status ? { ...filter, label: selectionStatusLabel(status, labels) } : filter
  })
}

type SelectionStatusGroup = Exclude<SelectionListFilter, "open" | "all"> | "deferred"

const GROUP_BY_STATUS: Readonly<Record<ProjectSelectionStatus, SelectionStatusGroup>> = {
  needed: "needed",
  proposed: "needed",
  pricing: "needed",
  rfq_sent: "needed",
  unavailable: "needed",
  owner_review: "with_owner",
  approved: "approved",
  ordered: "ordered",
  installed: "installed",
  deferred: "deferred",
}

/** The default status labels. Screens show the company's names via `selectionStatusLabel`. */
export const SELECTION_STATUS_LABELS = PROJECT_SELECTION_STATUS_LABELS

export function selectionStatusGroup(status: ProjectSelectionStatus): SelectionStatusGroup {
  return GROUP_BY_STATUS[status]
}

export function parseSelectionListFilter(value: string | null | undefined): SelectionListFilter {
  return SELECTION_LIST_FILTERS.find((filter) => filter.value === value)?.value ?? "open"
}

export function selectionMatchesFilter(row: Pick<SelectionSheetRow, "status">, filter: SelectionListFilter): boolean {
  const group = selectionStatusGroup(row.status)
  if (filter === "all") return true
  if (filter === "open") return group !== "installed" && group !== "deferred"
  return group === filter
}

export function selectionMatchesSearch(row: SelectionSheetRow, query: string): boolean {
  const needle = query.trim().toLocaleLowerCase()
  if (!needle) return true
  return [row.name, row.roomName, row.category, row.costCode, row.pickTitle, row.parentName]
    .some((value) => value?.toLocaleLowerCase().includes(needle))
}

/** Status sorts in workflow order. */
export function selectionStatusSortValue(status: ProjectSelectionStatus): number {
  return ["needed", "with_owner", "approved", "ordered", "installed", "deferred"].indexOf(selectionStatusGroup(status))
}
