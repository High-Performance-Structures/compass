/**
 * Pure rules for list sheet layouts (Settings > Lists and each sheet's
 * Columns button). No database or network access, safe in the browser.
 *
 * Precedence, per column: the person's own choice, then the company setting,
 * then the code default in the registry. Unknown ids (a column removed from
 * code) are dropped, and columns added to code later appear in their default
 * place with their default visibility.
 */
import { z } from "zod/v4"

import { LIST_SHEET_SORT_DIRECTIONS } from "@/lib/domain/settings/statuses"
import type { ListSheetColumn, ListSheetDefinition, ListSheetSort } from "@/lib/domain/settings/list-sheet-registry"

const MAX_COLUMNS = 100
const columnId = z.string().trim().min(1).max(80)

/** json: a company's column layout, in display order. */
export const listSheetColumnsSchema = z.array(z.object({ id: columnId, visible: z.boolean() }).strict()).max(MAX_COLUMNS)

/** json: column ids a person hid or showed. */
export const listSheetColumnIdsSchema = z.array(columnId).max(MAX_COLUMNS)

/** What Settings > Lists sends for one sheet. Strict: an organization or user id is refused. */
export const companyListSheetInputSchema = z.object({
  sheetId: z.string().trim().min(1).max(80),
  columns: listSheetColumnsSchema,
  sort: z.object({ columnId, direction: z.enum(LIST_SHEET_SORT_DIRECTIONS) }).strict().nullable(),
  startFilter: z.string().trim().min(1).max(40).nullable(),
}).strict()

/** What a sheet's Columns button sends. Strict, like the company input. */
export const personalListSheetInputSchema = z.object({
  sheetId: z.string().trim().min(1).max(80),
  hiddenColumnIds: listSheetColumnIdsSchema,
  shownColumnIds: listSheetColumnIdsSchema,
}).strict()

export type CompanyListSheetSetting = {
  readonly columns: readonly { readonly id: string; readonly visible: boolean }[]
  /** Null: the list's own order. */
  readonly sort: ListSheetSort | null
  readonly startFilter: string | null
}

export type PersonalListSheetPreference = {
  readonly hiddenColumnIds: readonly string[]
  readonly shownColumnIds: readonly string[]
}

type ListSheetLayoutColumn = ListSheetColumn & {
  readonly visible: boolean
  /** Whether the company layout (or the code default) shows it. */
  readonly companyVisible: boolean
}

export type ListSheetLayout = {
  /** Every registered column, in display order. */
  readonly columns: readonly ListSheetLayoutColumn[]
  readonly sort: ListSheetSort | null
  readonly startFilter: string | null
  /** Whether the person changed any column from the company layout. */
  readonly personalized: boolean
}

/** Parses stored JSON; anything malformed reads as empty. */
export function parseStoredJson<T>(raw: string | null | undefined, schema: z.ZodType<T>): T | null {
  if (!raw) return null
  try {
    const parsed = schema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

/**
 * The company's column order with unknown and repeated ids removed, and
 * columns missing from it (added to code later) placed after the column
 * that precedes them in the code default.
 */
function orderedColumnIds(definition: ListSheetDefinition, stored: readonly string[] | null): readonly string[] {
  const defaults = definition.columns.map((column) => column.id)
  if (!stored) return defaults
  const known = new Set(defaults)
  const order: string[] = []
  for (const id of stored) if (known.has(id) && !order.includes(id)) order.push(id)
  defaults.forEach((id, index) => {
    if (order.includes(id)) return
    const before = defaults.slice(0, index).reverse().find((candidate) => order.includes(candidate))
    order.splice(before === undefined ? 0 : order.indexOf(before) + 1, 0, id)
  })
  return order
}

function validSort(definition: ListSheetDefinition, sort: ListSheetSort | null): boolean {
  if (sort === null) return true
  const column = definition.columns.find((candidate) => candidate.id === sort.columnId)
  return column !== undefined && column.sortable !== false
}

function validStartFilter(definition: ListSheetDefinition, value: string | null): boolean {
  return value !== null && definition.startFilter !== null && definition.startFilter.options.some((option) => option.value === value)
}

/** The layout a sheet shows: personal over company over code default. */
export function resolveListSheetLayout(
  definition: ListSheetDefinition,
  company: CompanyListSheetSetting | null,
  personal: PersonalListSheetPreference | null,
): ListSheetLayout {
  const byId = new Map(definition.columns.map((column) => [column.id, column]))
  const companyVisibility = new Map((company?.columns ?? []).map((column) => [column.id, column.visible]))
  const hidden = new Set(personal?.hiddenColumnIds ?? [])
  const shown = new Set(personal?.shownColumnIds ?? [])
  let personalized = false
  const columns = orderedColumnIds(definition, company ? company.columns.map((column) => column.id) : null).flatMap((id) => {
    const column = byId.get(id)
    if (!column) return []
    const companyVisible = column.required === true || (companyVisibility.get(id) ?? column.hiddenByDefault !== true)
    let visible = companyVisible
    if (column.required !== true) {
      if (shown.has(id)) visible = true
      else if (hidden.has(id)) visible = false
    }
    if (visible !== companyVisible) personalized = true
    return [{ ...column, visible, companyVisible }]
  })
  const sort = company && validSort(definition, company.sort) ? company.sort : definition.defaultSort
  const startFilter = company && validStartFilter(definition, company.startFilter)
    ? company.startFilter
    : definition.startFilter?.defaultValue ?? null
  return { columns, sort, startFilter, personalized }
}

/**
 * A person's preference after showing or hiding one column. A choice that
 * matches the company layout is dropped, so later company changes apply.
 * Required and unknown columns are left alone.
 */
export function nextPersonalPreference(
  layout: ListSheetLayout,
  current: PersonalListSheetPreference | null,
  changedColumnId: string,
  visible: boolean,
): PersonalListSheetPreference {
  const hidden = new Set(current?.hiddenColumnIds ?? [])
  const shown = new Set(current?.shownColumnIds ?? [])
  const column = layout.columns.find((candidate) => candidate.id === changedColumnId)
  if (column && column.required !== true) {
    hidden.delete(changedColumnId)
    shown.delete(changedColumnId)
    if (visible !== column.companyVisible) (visible ? shown : hidden).add(changedColumnId)
  }
  return { hiddenColumnIds: [...hidden].sort(), shownColumnIds: [...shown].sort() }
}

type Checked<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: string }

/**
 * A company layout ready to store: every column the sheet registers, once,
 * required columns shown, a sortable sort column and a known start filter.
 */
export function checkCompanyListSheet(
  definition: ListSheetDefinition,
  input: z.infer<typeof companyListSheetInputSchema>,
): Checked<CompanyListSheetSetting> {
  const byId = new Map(definition.columns.map((column) => [column.id, column]))
  const seen = new Set<string>()
  for (const column of input.columns) {
    if (!byId.has(column.id)) return { ok: false, error: `This sheet has no column "${column.id}". Refresh and try again.` }
    if (seen.has(column.id)) return { ok: false, error: "Each column can appear only once." }
    seen.add(column.id)
    if (!column.visible && byId.get(column.id)?.required === true) {
      return { ok: false, error: `${byId.get(column.id)?.label ?? "This column"} is always shown because it opens the record.` }
    }
  }
  if (seen.size !== byId.size) return { ok: false, error: "Every column must be listed. Refresh and try again." }
  const sort = input.sort ? { columnId: input.sort.columnId, desc: input.sort.direction === "desc" } : null
  if (!validSort(definition, sort)) return { ok: false, error: "Choose a column this sheet can sort by." }
  if (input.startFilter !== null && !validStartFilter(definition, input.startFilter)) {
    return { ok: false, error: "Choose one of this sheet's filters." }
  }
  if (definition.startFilter === null && input.startFilter !== null) return { ok: false, error: "This sheet has no status filter." }
  return { ok: true, value: { columns: input.columns, sort, startFilter: input.startFilter } }
}

/** A person's preference ready to store: unknown and required columns dropped. */
export function checkPersonalListSheet(
  definition: ListSheetDefinition,
  input: z.infer<typeof personalListSheetInputSchema>,
): PersonalListSheetPreference {
  const optional = new Set(definition.columns.filter((column) => column.required !== true).map((column) => column.id))
  const shown = [...new Set(input.shownColumnIds.filter((id) => optional.has(id)))].sort()
  const hidden = [...new Set(input.hiddenColumnIds.filter((id) => optional.has(id) && !shown.includes(id)))].sort()
  return { hiddenColumnIds: hidden, shownColumnIds: shown }
}

/** Every sheet's company layout and this person's columns, loaded once per request. */
export type ListSheetPreferences = {
  readonly company: Readonly<Record<string, CompanyListSheetSetting>>
  readonly personal: Readonly<Record<string, PersonalListSheetPreference>>
  /** Signed in with an organization, and not the read-only demo. */
  readonly canSavePersonal: boolean
  /** May change Settings > Lists (company settings admins). */
  readonly canEditCompany: boolean
}

export const EMPTY_LIST_SHEET_PREFERENCES: ListSheetPreferences = {
  company: {},
  personal: {},
  canSavePersonal: false,
  canEditCompany: false,
}

/** TanStack column visibility for a layout: hidden registered columns only. */
export function listSheetColumnVisibility(layout: ListSheetLayout): Readonly<Record<string, boolean>> {
  return Object.fromEntries(layout.columns.filter((column) => !column.visible).map((column) => [column.id, false]))
}

/**
 * TanStack column order for the columns a table really has. Registered
 * columns take the layout's order within the slots registered columns hold;
 * unregistered ones (checkboxes, actions, developer columns) keep their place.
 */
export function listSheetColumnOrder(layout: ListSheetLayout, tableColumnIds: readonly string[]): readonly string[] {
  const present = new Set(tableColumnIds)
  const registered = new Set(layout.columns.map((column) => column.id))
  const ordered = layout.columns.map((column) => column.id).filter((id) => present.has(id))
  let next = 0
  return tableColumnIds.map((id) => (registered.has(id) ? ordered[next++] ?? id : id))
}
