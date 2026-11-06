/**
 * The status resolver and the rules for editing a company's statuses. Pure:
 * no database or network access, safe in the browser.
 *
 * A record type's status list is its code defaults (./registry.ts) with the
 * company's Settings › Statuses rows merged over them. Every status list,
 * filter button, badge, status sort and status select reads it, so no list
 * hard-codes its statuses.
 */
import { isListValue } from "@/lib/shared/statuses"

import { RECORD_STATUS_REGISTRY } from "./registry"
import {
  RECORD_STATUS_COLORS,
  RECORD_STATUS_GROUPS,
  RECORD_STATUS_TYPES,
  type RecordStatusColor,
  type RecordStatusGroup,
  type RecordStatusType,
} from "./statuses"

/** One stored company row (organization_record_statuses), as the resolver reads it. */
export type StoredRecordStatus = {
  readonly statusKey: string
  readonly label: string
  readonly color: string
  readonly statusGroup: string
  readonly sortOrder: number
  readonly showAsButton: boolean
  readonly hidden: boolean
  readonly builtIn: boolean
}

type ResolvedRecordStatus = {
  readonly key: string
  readonly label: string
  readonly color: RecordStatusColor
  readonly group: RecordStatusGroup
  readonly showAsButton: boolean
  readonly hidden: boolean
  /** Compass code depends on it: it can be renamed or hidden, never deleted. */
  readonly builtIn: boolean
}

/** A record type's statuses in the company's order. Plain data, so a server page can pass it to the browser. */
export type RecordStatusList = {
  readonly type: RecordStatusType
  readonly statuses: readonly ResolvedRecordStatus[]
}

/** "open" (the Open group), "all", or one status's filter value. */
export type RecordStatusFilter = string

export type RecordStatusFilterOption = {
  readonly value: RecordStatusFilter
  readonly label: string
  readonly count: number
  readonly color?: RecordStatusColor
  /** Open and All show even with no records. */
  readonly pinned?: boolean
}

const RESERVED_FILTERS: readonly string[] = ["open", "all"]

/** Lower case with every run of other characters as one underscore ("Partially-Received" -> "partially_received"). */
function normalizedStatusValue(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "")
}

function titleCase(value: string): string {
  return normalizedStatusValue(value)
    .split("_")
    .filter((part) => part.length > 0)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ")
}

// ---------------------------------------------------------------------------
// Resolving: code defaults merged with the company's rows
// ---------------------------------------------------------------------------

function fromStored(row: StoredRecordStatus, builtIn: boolean, fallback?: ResolvedRecordStatus): ResolvedRecordStatus {
  return {
    key: row.statusKey,
    label: row.label.trim() || fallback?.label || titleCase(row.statusKey),
    color: isListValue(RECORD_STATUS_COLORS, row.color) ? row.color : (fallback?.color ?? "gray"),
    group: isListValue(RECORD_STATUS_GROUPS, row.statusGroup) ? row.statusGroup : (fallback?.group ?? "open"),
    showAsButton: row.showAsButton,
    hidden: row.hidden,
    builtIn,
  }
}

/** A record type's statuses with no company customization: the code defaults, all shown. */
export function defaultRecordStatusList(type: RecordStatusType): RecordStatusList {
  return {
    type,
    statuses: RECORD_STATUS_REGISTRY[type].statuses.map((status) => ({
      ...status,
      showAsButton: true,
      hidden: false,
      builtIn: true,
    })),
  }
}

/**
 * The company's rows merged over the code defaults:
 * - a stored built-in row changes that status's label, color, group, order
 *   and visibility, never its key;
 * - other stored rows are the company's own statuses;
 * - stored rows keep the company's order; a built-in status with no row
 *   (such as one added to Compass later) follows the default status before it;
 * - a stored built-in row whose status Compass no longer has is ignored.
 */
export function resolveRecordStatuses(type: RecordStatusType, rows: readonly StoredRecordStatus[]): RecordStatusList {
  const defaults = defaultRecordStatusList(type).statuses
  const defaultByKey = new Map(defaults.map((status) => [status.key, status]))
  const seen = new Set<string>()
  const ordered: ResolvedRecordStatus[] = []
  for (const row of [...rows].sort((a, b) => a.sortOrder - b.sortOrder)) {
    if (seen.has(row.statusKey)) continue
    const fallback = defaultByKey.get(row.statusKey)
    if (!fallback && row.builtIn) continue
    seen.add(row.statusKey)
    ordered.push(fromStored(row, fallback !== undefined, fallback))
  }
  defaults.forEach((status, index) => {
    if (seen.has(status.key)) return
    const before = defaults
      .slice(0, index)
      .reverse()
      .map((previous) => ordered.findIndex((item) => item.key === previous.key))
      .find((position) => position >= 0)
    ordered.splice(before === undefined ? 0 : before + 1, 0, status)
    seen.add(status.key)
  })
  return { type, statuses: ordered }
}

// ---------------------------------------------------------------------------
// Reading a stored status through the list
// ---------------------------------------------------------------------------

/**
 * The status a stored value means: its key or a known spelling of it, then
 * (unless `strict`) the type's fallback for unknown values; null when unknown.
 */
function recordStatusFor(list: RecordStatusList, stored: string, strict = false): ResolvedRecordStatus | null {
  const byKey = (key: string | undefined): ResolvedRecordStatus | undefined =>
    key === undefined ? undefined : list.statuses.find((status) => status.key === key)
  const definition = RECORD_STATUS_REGISTRY[list.type]
  const normalized = normalizedStatusValue(stored)
  return (
    byKey(stored) ??
    byKey(normalized) ??
    byKey(definition.aliases[normalized]) ??
    (strict ? undefined : byKey(definition.unknownKey)) ??
    null
  )
}

/** The status key a stored value means, or null for an unknown value. */
export function recordStatusKey(list: RecordStatusList, stored: string): string | null {
  return recordStatusFor(list, stored)?.key ?? null
}

/**
 * The status key a stored value really is (its key or a known spelling),
 * without the type's unknown-value fallback. Automations that move a record
 * from one built-in status use this, so a status they don't know is left alone.
 */
export function recordStatusExactKey(list: RecordStatusList, stored: string): string | null {
  return recordStatusFor(list, stored, true)?.key ?? null
}

/** What a stored status counts as; an unknown status counts as open. */
export function recordStatusGroup(list: RecordStatusList, stored: string): RecordStatusGroup {
  return recordStatusFor(list, stored)?.group ?? "open"
}

export function isOpenRecordStatus(list: RecordStatusList, stored: string): boolean {
  return recordStatusGroup(list, stored) === "open"
}

/** The company's label; an unknown status shows its own text. */
export function recordStatusLabel(list: RecordStatusList, stored: string): string {
  return recordStatusFor(list, stored)?.label ?? (titleCase(stored) || stored)
}

export function recordStatusColor(list: RecordStatusList, stored: string): RecordStatusColor {
  return recordStatusFor(list, stored)?.color ?? "gray"
}

/** Status sorts in the company's workflow order; unknown statuses last. */
export function recordStatusSortValue(list: RecordStatusList, stored: string): number {
  const key = recordStatusKey(list, stored)
  const index = key === null ? -1 : list.statuses.findIndex((status) => status.key === key)
  return index < 0 ? list.statuses.length : index
}

/** One record type's list from a set loaded together, or its code defaults. */
export function recordStatusListFor(lists: readonly RecordStatusList[], type: RecordStatusType): RecordStatusList {
  return lists.find((list) => list.type === type) ?? defaultRecordStatusList(type)
}

/** The record type a project operation row's `source_record_type` belongs to, from the registry; null for others. */
function recordStatusTypeForSource(sourceRecordType: string): RecordStatusType | null {
  return (
    RECORD_STATUS_TYPES.find((type) => {
      const storage = RECORD_STATUS_REGISTRY[type].records
      return storage.table === "project_operations" && storage.sourceRecordTypes.includes(sourceRecordType)
    }) ?? null
  )
}

/** A project operation's status as its company names it; record kinds without company statuses show their own text. */
export function operationStatusLabel(lists: readonly RecordStatusList[], sourceRecordType: string, stored: string): string {
  const type = recordStatusTypeForSource(sourceRecordType)
  return type ? recordStatusLabel(recordStatusListFor(lists, type), stored) : titleCase(stored) || stored
}

// ---------------------------------------------------------------------------
// Filter buttons
// ---------------------------------------------------------------------------

/** A status's `?status=` value. A status keyed "open" or "all" gets a suffix so it never means the Open or All button. */
export function recordStatusFilterValue(key: string): RecordStatusFilter {
  return RESERVED_FILTERS.includes(key) ? `${key}_status` : key
}

/** The filter in a `?status=` value; anything unknown shows Open. */
export function parseRecordStatusFilter(
  list: RecordStatusList,
  value: string | readonly string[] | undefined,
): RecordStatusFilter {
  const raw = typeof value === "string" ? value : value?.[0]
  if (raw === undefined) return "open"
  if (RESERVED_FILTERS.includes(raw)) return raw
  return list.statuses.some((status) => recordStatusFilterValue(status.key) === raw) ? raw : "open"
}

export function recordStatusMatchesFilter(list: RecordStatusList, stored: string, filter: RecordStatusFilter): boolean {
  if (filter === "all") return true
  if (filter === "open") return isOpenRecordStatus(list, stored)
  const key = recordStatusKey(list, stored)
  return key !== null && recordStatusFilterValue(key) === filter
}

/**
 * Open, each status the company shows as a button (in its order), then All,
 * with how many records each shows. `statusCounts` is how many records carry
 * each stored status.
 */
export function recordStatusFilterOptions(
  list: RecordStatusList,
  statusCounts: readonly { readonly status: string; readonly count: number }[],
): readonly RecordStatusFilterOption[] {
  const countFor = (filter: RecordStatusFilter): number =>
    statusCounts.reduce((total, row) => total + (recordStatusMatchesFilter(list, row.status, filter) ? row.count : 0), 0)
  return [
    { value: "open", label: "Open", count: countFor("open"), pinned: true },
    ...list.statuses
      .filter((status) => status.showAsButton && !status.hidden)
      .map((status) => {
        const value = recordStatusFilterValue(status.key)
        return { value, label: status.label, color: status.color, count: countFor(value) }
      }),
    { value: "all", label: "All", count: countFor("all"), pinned: true },
  ]
}

// ---------------------------------------------------------------------------
// Status selects on a record
// ---------------------------------------------------------------------------

/** The statuses a record's status select offers: the visible ones, plus the record's own if it is hidden. */
export function selectableRecordStatuses(
  list: RecordStatusList,
  current?: string,
): readonly { readonly value: string; readonly label: string }[] {
  const currentKey = current === undefined ? null : recordStatusKey(list, current)
  return list.statuses
    .filter((status) => !status.hidden || status.key === currentKey)
    .map((status) => ({ value: status.key, label: status.label }))
}

/** Whether a record may be set to `value`: a status on the list that is visible, or the record's current one. */
export function isSelectableRecordStatus(list: RecordStatusList, value: string, current?: string): boolean {
  const status = list.statuses.find((item) => item.key === value)
  if (!status) return false
  return !status.hidden || (current !== undefined && recordStatusKey(list, current) === value)
}

// ---------------------------------------------------------------------------
// Editing (Settings › Statuses). The server applies these rules to every save.
// ---------------------------------------------------------------------------

export const RECORD_STATUS_LABEL_MAX = 40
export const RECORD_STATUS_MAX_PER_TYPE = 40

/** One row as the Settings page sends it, in the order to save. `key` is null for a new status. */
export type RecordStatusEdit = {
  readonly key: string | null
  readonly label: string
  readonly color: RecordStatusColor
  readonly group: RecordStatusGroup
  readonly showAsButton: boolean
  readonly hidden: boolean
}

export type PlannedRecordStatusRow = {
  readonly statusKey: string
  readonly label: string
  readonly color: RecordStatusColor
  readonly statusGroup: RecordStatusGroup
  readonly sortOrder: number
  readonly showAsButton: boolean
  readonly hidden: boolean
  readonly builtIn: boolean
}

export type RecordStatusPlan<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: string }

/** A new status's stable key: from its label, never one already used, a known spelling, or a filter word. */
export function newRecordStatusKey(type: RecordStatusType, label: string, taken: ReadonlySet<string>): string {
  const definition = RECORD_STATUS_REGISTRY[type]
  const unavailable = new Set<string>([
    ...taken,
    ...definition.statuses.map((status) => status.key),
    ...Object.keys(definition.aliases),
    ...RESERVED_FILTERS,
    ...RESERVED_FILTERS.map(recordStatusFilterValue),
  ])
  const base = normalizedStatusValue(label).slice(0, 40).replace(/_+$/, "") || "status"
  if (!unavailable.has(base)) return base
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${base}_${suffix}`
    if (!unavailable.has(candidate)) return candidate
  }
}

/**
 * The rows to store for a save of one record type's whole list, or why it is
 * refused:
 * - every built-in status stays (it can be hidden, never deleted);
 * - every company status already saved stays (Delete removes one, after
 *   checking no record uses it);
 * - an existing key must be one this company has; a new status gets a key;
 * - names are required, unique and short.
 */
export function planRecordStatusSave(
  type: RecordStatusType,
  stored: readonly StoredRecordStatus[],
  edits: readonly RecordStatusEdit[],
): RecordStatusPlan<readonly PlannedRecordStatusRow[]> {
  if (edits.length > RECORD_STATUS_MAX_PER_TYPE) {
    return { ok: false, error: `A record type can have at most ${RECORD_STATUS_MAX_PER_TYPE} statuses.` }
  }
  const builtInKeys = new Set(RECORD_STATUS_REGISTRY[type].statuses.map((status) => status.key))
  const customKeys = new Set(stored.filter((row) => !builtInKeys.has(row.statusKey) && !row.builtIn).map((row) => row.statusKey))
  const labels = new Set<string>()
  const keys = new Set<string>()
  for (const edit of edits) {
    const label = edit.label.trim()
    if (!label) return { ok: false, error: "Every status needs a name." }
    if (label.length > RECORD_STATUS_LABEL_MAX) {
      return { ok: false, error: `Keep status names to ${RECORD_STATUS_LABEL_MAX} characters.` }
    }
    const folded = label.toLowerCase()
    if (labels.has(folded)) return { ok: false, error: `Two statuses are named "${label}". Give each a different name.` }
    labels.add(folded)
    if (!isListValue(RECORD_STATUS_COLORS, edit.color)) return { ok: false, error: "Choose a color from the list." }
    if (!isListValue(RECORD_STATUS_GROUPS, edit.group)) return { ok: false, error: "Choose Open, Closed or Void for Counts as." }
    if (edit.key === null) continue
    if (!builtInKeys.has(edit.key) && !customKeys.has(edit.key)) {
      return { ok: false, error: "A status in this list no longer exists. Refresh the page and try again." }
    }
    if (keys.has(edit.key)) return { ok: false, error: "A status appears twice. Refresh the page and try again." }
    keys.add(edit.key)
  }
  const missingBuiltIn = [...builtInKeys].filter((key) => !keys.has(key))
  if (missingBuiltIn.length > 0) {
    return { ok: false, error: "Built-in statuses can't be deleted. Hide one instead to take it off buttons and status choices." }
  }
  if ([...customKeys].some((key) => !keys.has(key))) {
    return { ok: false, error: "Use a status's Delete button to remove it. Refresh the page and try again." }
  }
  const taken = new Set<string>([...keys, ...stored.map((row) => row.statusKey)])
  const rows = edits.map((edit, index): PlannedRecordStatusRow => {
    const statusKey = edit.key ?? newRecordStatusKey(type, edit.label, taken)
    taken.add(statusKey)
    return {
      statusKey,
      label: edit.label.trim(),
      color: edit.color,
      statusGroup: edit.group,
      sortOrder: index,
      showAsButton: edit.showAsButton,
      hidden: edit.hidden,
      builtIn: builtInKeys.has(statusKey),
    }
  })
  return { ok: true, value: rows }
}

/**
 * Whether a status may be deleted: only a company-added status that no record
 * uses. A built-in status, or one in use, is hidden instead.
 */
export function planRecordStatusDelete(
  type: RecordStatusType,
  stored: readonly StoredRecordStatus[],
  key: string,
  recordsUsingIt: number,
): RecordStatusPlan<{ readonly label: string }> {
  const builtIn = RECORD_STATUS_REGISTRY[type].statuses.find((status) => status.key === key)
  if (builtIn) {
    return { ok: false, error: `${builtIn.label} is a built-in status. Compass relies on it, so it can be hidden but not deleted.` }
  }
  const row = stored.find((item) => item.statusKey === key && !item.builtIn)
  if (!row) return { ok: false, error: "That status no longer exists. Refresh the page." }
  if (recordsUsingIt > 0) {
    const records = RECORD_STATUS_REGISTRY[type].label.toLowerCase()
    const count = recordsUsingIt === 1 ? `1 of your ${records} uses` : `${recordsUsingIt} of your ${records} use`
    return {
      ok: false,
      error: `${count} ${row.label}, so it can't be deleted. Hide it instead: it leaves the filter buttons and status choices, and those records keep it.`,
    }
  }
  return { ok: true, value: { label: row.label } }
}
