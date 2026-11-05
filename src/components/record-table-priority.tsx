"use client"

import * as React from "react"
import type { Table as TableInstance } from "@tanstack/react-table"
import { toast } from "sonner"

import { useRecordTable } from "@/components/record-table"
import type { RecordPriorityController } from "@/components/record-table-sortable"
import type { ActionDone } from "@/lib/action-result"

/**
 * Opt-in priority order for a record table: a list whose order a person
 * chooses (which PO to order first), not one the data decides. Use it only
 * where that chosen order matters (ui-standards.md, "Record lists").
 */
export type RecordPriorityOrder<T> = {
  /** What the order is called, such as "Ordering priority". */
  readonly label: string
  /** Server-decided: whether this viewer may change the order. */
  readonly canReorder: boolean
  /** A search narrows the list; dragging pauses until it is cleared. */
  readonly searching: boolean
  readonly getLabel: (row: T) => string
  /**
   * Saves one move. Only the span that moved is sent, from the record's old
   * place to its new one: `previousIds` is that span as the person saw it
   * (for the server's stale check) and `orderedIds` the same rows in their
   * new order. The server reassigns only those rows' places.
   */
  readonly onReorder: (previousIds: readonly string[], orderedIds: readonly string[]) => Promise<ActionDone>
}

type RecordTableOptions<T> = Parameters<typeof useRecordTable<T>>[0]

function arrange<T>(data: readonly T[], orderedIds: readonly string[], getRowId: (row: T) => string): readonly T[] {
  const byId = new Map(data.map((row) => [getRowId(row), row]))
  const arranged = orderedIds.flatMap((id) => byId.get(id) ?? [])
  const placed = new Set(orderedIds)
  return [...arranged, ...data.filter((row) => !placed.has(getRowId(row)))]
}

/**
 * `useRecordTable` plus priority order. `data` arrives in priority order. The
 * default view is that order with a rank, a drag handle and arrows per row;
 * sorting by a column header is temporary and pauses dragging until
 * "Back to priority order". Moves show at once and roll back with a toast if
 * the save fails.
 */
export function usePriorityRecordTable<T>({
  priorityOrder,
  ...options
}: RecordTableOptions<T> & { readonly priorityOrder: RecordPriorityOrder<T> }): {
  readonly table: TableInstance<T>
  readonly priority: RecordPriorityController<T>
} {
  const { data, getRowId } = options
  const [optimisticIds, setOptimisticIds] = React.useState<readonly string[] | null>(null)
  const [pending, setPending] = React.useState(false)
  const [announcement, setAnnouncement] = React.useState("")
  // Fresh data from the server replaces any optimistic order.
  React.useEffect(() => setOptimisticIds(null), [data])
  const ordered = React.useMemo(
    () => (optimisticIds ? arrange(data, optimisticIds, getRowId) : data),
    [data, optimisticIds, getRowId],
  )
  const orderedIds = React.useMemo(() => ordered.map(getRowId), [ordered, getRowId])
  const positions = React.useMemo(() => new Map(orderedIds.map((id, index) => [id, index])), [orderedIds])
  const table = useRecordTable({ ...options, data: ordered })
  const sorting = table.getState().sorting
  const sortedColumn = sorting[0] ? table.getColumn(sorting[0].id) : undefined
  const sortedHeader = sortedColumn?.columnDef.header
  const inPriorityView = sorting.length === 0
  const { canReorder, searching, label, getLabel, onReorder } = priorityOrder
  const dragEnabled = canReorder && inPriorityView && !searching && !pending

  const move = React.useCallback(
    (id: string, toIndex: number): void => {
      if (!dragEnabled) return
      const from = orderedIds.indexOf(id)
      const to = Math.max(0, Math.min(orderedIds.length - 1, toIndex))
      if (from < 0 || from === to) return
      const next = [...orderedIds]
      next.splice(from, 1)
      next.splice(to, 0, id)
      const row = ordered[from]
      const name = row === undefined ? "Record" : getLabel(row)
      setOptimisticIds(next)
      setPending(true)
      setAnnouncement(`Moved ${name} to position ${to + 1} of ${next.length}.`)
      // A one-step move off the visible page follows the record there.
      const pageSize = table.getState().pagination.pageSize
      if (Math.abs(to - from) === 1 && Math.floor(to / pageSize) !== Math.floor(from / pageSize)) {
        table.setPageIndex(Math.floor(to / pageSize))
      }
      const low = Math.min(from, to)
      const high = Math.max(from, to) + 1
      onReorder(orderedIds.slice(low, high), next.slice(low, high))
        .then((result) => {
          if (result.success) return
          setOptimisticIds(null)
          setAnnouncement(`The order was not saved. ${result.error}`)
          toast.error(result.error)
        })
        .catch(() => {
          setOptimisticIds(null)
          setAnnouncement("The order was not saved.")
          toast.error(`Unable to save the ${label.toLowerCase()}. Try again.`)
        })
        .finally(() => setPending(false))
    },
    [dragEnabled, orderedIds, ordered, getLabel, table, onReorder, label],
  )

  const priority: RecordPriorityController<T> = {
    label,
    canReorder,
    inPriorityView,
    searching,
    sortedBy: typeof sortedHeader === "string" ? sortedHeader : (sortedColumn?.id ?? null),
    dragEnabled,
    pending,
    announcement,
    count: orderedIds.length,
    getLabel,
    positionOf: (id) => positions.get(id) ?? -1,
    move,
    backToPriority: () => table.resetSorting(),
  }
  return { table, priority }
}
