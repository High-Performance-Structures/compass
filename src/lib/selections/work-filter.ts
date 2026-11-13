/**
 * The one search / room / division / cost-code filter shared by the
 * Selections page's Publish to owner, Finish specs and Print & share areas,
 * and the one-line status pills on each folded room group. Pure: no React,
 * database or network access.
 */
import type {
  ProjectSelectionItem,
  ProjectSelectionOptions,
  ProjectSelectionsSummary,
} from "@/lib/domain/selections/types"
import type { SelectionDecisionItem } from "@/lib/selections/types"

/** "all" means the filter is off. */
export const ALL_SELECTIONS = "all"

export type SelectionWorkFilter = {
  readonly search: string
  readonly roomName: string
  readonly division: string
  readonly costCode: string
}

export const EMPTY_SELECTION_WORK_FILTER: SelectionWorkFilter = {
  search: "",
  roomName: ALL_SELECTIONS,
  division: ALL_SELECTIONS,
  costCode: ALL_SELECTIONS,
}

export function selectionFilterActive(filter: SelectionWorkFilter): boolean {
  return (
    filter.search.trim() !== "" ||
    filter.roomName !== ALL_SELECTIONS ||
    filter.division !== ALL_SELECTIONS ||
    filter.costCode !== ALL_SELECTIONS
  )
}

/** Cost code value → its division, for the division filter. */
export function costCodeDivisions(
  options: ProjectSelectionOptions
): ReadonlyMap<string, string> {
  return new Map(options.costCodes.map((option) => [option.value, option.divisionCode]))
}

function matchesSearch(selection: ProjectSelectionItem, search: string): boolean {
  const term = search.trim().toLowerCase()
  if (!term) return true
  return [
    selection.roomName,
    selection.name,
    selection.category,
    selection.manufacturer,
    selection.model,
    selection.colorFinish,
    selection.supplierName,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .includes(term)
}

function selectionMatchesWorkFilter(
  selection: ProjectSelectionItem,
  filter: SelectionWorkFilter,
  divisions: ReadonlyMap<string, string>
): boolean {
  if (filter.roomName !== ALL_SELECTIONS && selection.roomName !== filter.roomName) return false
  if (filter.costCode !== ALL_SELECTIONS && selection.costCode !== filter.costCode) return false
  if (filter.division !== ALL_SELECTIONS) {
    if (!selection.costCode) return false
    if (divisions.get(selection.costCode) !== filter.division) return false
  }
  return matchesSearch(selection, filter.search)
}

/**
 * The summary narrowed to the filter, with its counts recomputed. Rooms the
 * filter leaves empty drop out; with no filter on, every room shows, including
 * a room with no selections yet (Add room).
 */
export function filterSelectionsSummary(
  summary: ProjectSelectionsSummary,
  filter: SelectionWorkFilter,
  divisions: ReadonlyMap<string, string>
): ProjectSelectionsSummary {
  const active = selectionFilterActive(filter)
  const rooms = summary.rooms
    .map((room) => ({
      ...room,
      selections: room.selections.filter((selection) =>
        selectionMatchesWorkFilter(selection, filter, divisions)
      ),
    }))
    .filter((room) => room.selections.length > 0 || !active)
    .map((room) => ({ ...room, selectionCount: room.selections.length }))
  const selections = rooms.flatMap((room) => room.selections)
  return {
    totalCount: selections.length,
    roomCount: rooms.length,
    sourceWorkbookCount: new Set(
      rooms.map((room) => room.sourceWorkbookId).filter((value): value is string => Boolean(value))
    ).size,
    needsDecisionCount: selections.filter((selection) => SPEC_NEEDS_DECISION.has(selection.status)).length,
    approvedCount: selections.filter((selection) => selection.status === "approved").length,
    pricingCount: selections.filter((selection) => ["pricing", "rfq_sent"].includes(selection.status)).length,
    orderedCount: selections.filter((selection) => ["ordered", "installed"].includes(selection.status)).length,
    rooms,
  }
}

/** The filter as words for a printout or email ("Kitchen / Plumbing"), or null. */
export function selectionFilterLabel(
  filter: SelectionWorkFilter,
  options: ProjectSelectionOptions
): string | null {
  const parts: string[] = []
  if (filter.roomName !== ALL_SELECTIONS) parts.push(filter.roomName)
  if (filter.division !== ALL_SELECTIONS) {
    parts.push(options.divisions.find((option) => option.value === filter.division)?.label ?? filter.division)
  }
  if (filter.costCode !== ALL_SELECTIONS) {
    parts.push(options.costCodes.find((option) => option.value === filter.costCode)?.label ?? filter.costCode)
  }
  if (filter.search.trim()) parts.push(`“${filter.search.trim()}”`)
  return parts.length > 0 ? parts.join(" / ") : null
}

/**
 * Decision items narrowed to the filter. A decision item is a finish
 * selection (same id), so it shows when its selection is in the filtered
 * summary; with no filter on, every item shows.
 */
export function filterDecisionItems(
  items: readonly SelectionDecisionItem[],
  filtered: ProjectSelectionsSummary,
  filter: SelectionWorkFilter
): readonly SelectionDecisionItem[] {
  if (!selectionFilterActive(filter)) return items
  const ids = new Set(filtered.rooms.flatMap((room) => room.selections.map((selection) => selection.id)))
  return items.filter((item) => ids.has(item.id))
}

export type RoomGroup<T> = {
  readonly roomName: string
  readonly items: readonly T[]
}

/** Items grouped by room, rooms in the order they first appear. */
export function groupByRoom<T>(
  items: readonly T[],
  roomOf: (item: T) => string
): readonly RoomGroup<T>[] {
  const groups = new Map<string, T[]>()
  for (const item of items) {
    const room = roomOf(item)
    const group = groups.get(room) ?? []
    group.push(item)
    groups.set(room, group)
  }
  return [...groups].map(([roomName, grouped]) => ({ roomName, items: grouped }))
}

export type RoomPill = {
  readonly label: string
  readonly tone: "neutral" | "attention" | "done" | "danger"
}

const SPEC_NEEDS_DECISION: ReadonlySet<string> = new Set(["needed", "proposed", "owner_review", "unavailable"])
const SPEC_DONE: ReadonlySet<string> = new Set(["approved", "ordered", "installed"])

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`
}

/** Late-risk pill shared by both kinds of room group. */
function lateRiskPill(ids: readonly string[], lateRisk: ReadonlySet<string>): RoomPill[] {
  const late = ids.filter((id) => lateRisk.has(id)).length
  return late > 0 ? [{ label: `${late} late risk`, tone: "danger" }] : []
}

/** The status pills on a folded Publish to owner room group. */
export function publishRoomPills(
  items: readonly SelectionDecisionItem[],
  lateRisk: ReadonlySet<string> = new Set()
): readonly RoomPill[] {
  const unpublished = items.filter((item) => !item.published).length
  const revision = items.filter((item) => item.published && !item.current).length
  const waiting = items.filter((item) => item.published && item.current && !item.approvedAt).length
  const requests = items.filter((item) => item.requests.some((request) => request.status === "open")).length
  const pills: RoomPill[] = []
  // The owner's confirmed choice; only a signature approves (the Finish specs pills show that).
  if (items.length > 0 && items.every((item) => item.published && item.current && item.approvedAt)) {
    pills.push({ label: "all chosen", tone: "done" })
  }
  if (waiting > 0) pills.push({ label: `${waiting} waiting on owner`, tone: "attention" })
  if (requests > 0) pills.push({ label: plural(requests, "owner request", "owner requests"), tone: "attention" })
  if (revision > 0) pills.push({ label: `${revision} revision needed`, tone: "danger" })
  if (unpublished > 0) pills.push({ label: `${unpublished} unpublished`, tone: "neutral" })
  return [...pills, ...lateRiskPill(items.map((item) => item.id), lateRisk)]
}

/** The status pills on a folded Finish specs room group. */
export function specRoomPills(
  selections: readonly ProjectSelectionItem[],
  lateRisk: ReadonlySet<string> = new Set()
): readonly RoomPill[] {
  const needs = selections.filter((selection) => SPEC_NEEDS_DECISION.has(selection.status)).length
  const pills: RoomPill[] = []
  if (selections.length > 0 && selections.every((selection) => SPEC_DONE.has(selection.status))) {
    pills.push({ label: "all approved", tone: "done" })
  } else if (needs > 0) {
    pills.push({ label: `${needs} need decision`, tone: "attention" })
  }
  return [...pills, ...lateRiskPill(selections.map((selection) => selection.id), lateRisk)]
}
