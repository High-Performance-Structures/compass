"use client"

import * as React from "react"
import type { ColumnDef, SortingState } from "@tanstack/react-table"

import { useListSheetContext } from "@/components/list-sheets/list-sheet-provider"
import { listSheetDefinition, type ListSheetDefinition } from "@/lib/domain/settings/list-sheet-registry"
import {
  listSheetColumnOrder,
  listSheetColumnVisibility,
  nextPersonalPreference,
  resolveListSheetLayout,
  type ListSheetLayout,
  type PersonalListSheetPreference,
} from "@/lib/domain/settings/list-sheet-rules"

export type ListSheetControl = {
  readonly definition: ListSheetDefinition
  readonly layout: ListSheetLayout
  readonly setColumnVisible: (columnId: string, visible: boolean) => void
  /** Drops the person's own choices, back to the company layout. */
  readonly resetToCompany: () => void
}

/**
 * A registered sheet's layout (personal over company over code default) and
 * the person's Columns controls. Without the dashboard provider (tests,
 * pages outside the dashboard) the sheet uses its code default and column
 * changes last until the page closes. Null when no sheet id is given.
 */
function useListSheet(sheetId: string | undefined): ListSheetControl | null {
  const context = useListSheetContext()
  const [localPersonal, setLocalPersonal] = React.useState<PersonalListSheetPreference | null>(null)
  const definition = sheetId ? listSheetDefinition(sheetId) : null
  const company = definition ? context?.preferences.company[definition.id] ?? null : null
  const personal = definition
    ? context ? context.preferences.personal[definition.id] ?? null : localPersonal
    : null
  const layout = React.useMemo(
    () => (definition ? resolveListSheetLayout(definition, company, personal) : null),
    [definition, company, personal],
  )
  const setPersonal = React.useCallback((preference: PersonalListSheetPreference | null) => {
    if (!definition) return
    if (context) context.setPersonal(definition.id, preference)
    else setLocalPersonal(preference)
  }, [context, definition])

  return React.useMemo(() => {
    if (!definition || !layout) return null
    return {
      definition,
      layout,
      setColumnVisible: (columnId, visible) => {
        const next = nextPersonalPreference(layout, personal, columnId, visible)
        setPersonal(next.hiddenColumnIds.length || next.shownColumnIds.length ? next : null)
      },
      resetToCompany: () => setPersonal(null),
    }
  }, [definition, layout, personal, setPersonal])
}

/** The sheet's sort (company, else code default), else the list's own. */
export function openingSort(sheet: ListSheetControl | null, fallback: SortingState): SortingState {
  if (!sheet) return fallback
  const sort = sheet.layout.sort
  return sort ? [{ id: sort.columnId, desc: sort.desc }] : []
}

/**
 * Column visibility and order for a registered sheet (personal over company
 * over code default), as TanStack table options. Empty without a sheet.
 */
export function useListSheetTableOptions<T>(
  sheetId: string | undefined,
  columns: readonly ColumnDef<T>[],
): {
  readonly sheet: ListSheetControl | null
  readonly state: { readonly columnVisibility?: Record<string, boolean>; readonly columnOrder?: string[] }
} {
  const sheet = useListSheet(sheetId)
  const layout = sheet?.layout ?? null
  const columnIds = React.useMemo(
    () => columns.map((column, index) => column.id ?? accessorKeyOf(column) ?? String(index)),
    [columns],
  )
  const state = React.useMemo(() => {
    if (!layout) return {}
    return {
      columnVisibility: { ...listSheetColumnVisibility(layout) },
      columnOrder: [...listSheetColumnOrder(layout, columnIds)],
    }
  }, [layout, columnIds])
  return { sheet, state }
}

function accessorKeyOf<T>(column: ColumnDef<T>): string | null {
  if (!("accessorKey" in column)) return null
  const key: unknown = column.accessorKey
  return typeof key === "string" ? key : null
}

