"use client"

import * as React from "react"
import type { ColumnDef } from "@tanstack/react-table"

import type { CreditMemo } from "@/db/schema-netsuite"
import { Badge } from "@/components/ui/badge"
import { ALL_STATUSES, EntityTable, filterEntityRows } from "@/components/financials/entity-table"
import {
  actionsColumn,
  dollarsColumn,
  MobileRecordActions,
  RecordName,
  RecordsEmpty,
  selectColumn,
  type BadgeVariant,
} from "@/components/financials/record-columns"
import { useListSheetStartFilter } from "@/components/list-sheets/use-list-sheet"
import { useRecordTable } from "@/components/record-table"
import { localeDateText } from "@/lib/domain/financials/rules"
import { formatDollars } from "@/lib/format"

const STATUS_VARIANT: Record<string, BadgeVariant> = {
  draft: "secondary",
  applied: "default",
  void: "outline",
}

interface CreditMemosTableProps {
  creditMemos: CreditMemo[]
  customerMap: Record<string, string>
  onEdit?: (memo: CreditMemo) => void
  onDelete?: (id: string) => void
}

const creditMemoRowId = (record: CreditMemo): string => record.id
const creditMemoSearchText = (record: CreditMemo): string => record.memoNumber ?? ""
const creditMemoStatus = (record: CreditMemo): string => record.status

const STATUSES: readonly { readonly value: string; readonly label: string }[] = [
  { value: "draft", label: "Draft" },
  { value: "applied", label: "Applied" },
  { value: "void", label: "Void" },
]

type ColumnOptions = Pick<CreditMemosTableProps, "customerMap" | "onEdit" | "onDelete">

/** The Financials page's sheet columns (sheet "financials.credit-memos"). */
export function creditMemoColumns({ customerMap, onEdit, onDelete }: ColumnOptions): ColumnDef<CreditMemo>[] {
  return [
    selectColumn<CreditMemo>(),
    {
      accessorKey: "memoNumber",
      header: "Memo #",
      cell: ({ row }) => <RecordName record={row.original} label={row.original.memoNumber || "-"} onOpen={onEdit} />,
    },
    {
      id: "customer",
      accessorFn: (memo) => customerMap[memo.customerId] ?? null,
      header: "Customer",
      cell: ({ row }) =>
        customerMap[row.original.customerId] ?? "-",
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => {
        const status = row.original.status
        return (
          <Badge variant={STATUS_VARIANT[status] ?? "secondary"}>
            {status}
          </Badge>
        )
      },
    },
    {
      accessorKey: "issueDate",
      header: "Issue Date",
      cell: ({ row }) => localeDateText(row.original.issueDate),
    },
    dollarsColumn<CreditMemo>("total", "Total", (memo) => memo.total),
    dollarsColumn<CreditMemo>("amountApplied", "Applied", (memo) => memo.amountApplied),
    dollarsColumn<CreditMemo>("amountRemaining", "Remaining", (memo) => memo.amountRemaining),
    actionsColumn<CreditMemo>(onEdit, onDelete),
  ]
}

export function CreditMemosTable({
  creditMemos,
  customerMap,
  onEdit,
  onDelete,
}: CreditMemosTableProps): React.ReactElement {
  const [search, setSearch] = React.useState("")
  const startFilter = useListSheetStartFilter("financials.credit-memos", ALL_STATUSES)
  const [status, setStatus] = React.useState(startFilter)
  const rows = React.useMemo(
    () => filterEntityRows(creditMemos, search, creditMemoSearchText, { selected: status, of: creditMemoStatus }),
    [creditMemos, search, status],
  )
  const columns = React.useMemo(
    () => creditMemoColumns({ customerMap, onEdit, onDelete }),
    [customerMap, onEdit, onDelete],
  )
  const table = useRecordTable({
    data: rows,
    columns,
    getRowId: creditMemoRowId,
    resetKey: `${status}|${search}`,
    enableSelection: true,
    sheetId: "financials.credit-memos",
  })

  return (
    <EntityTable
      table={table}
      search={{ value: search, onChange: setSearch, label: "Search credit memos", placeholder: "Search by memo number..." }}
      statusFilter={{
        label: "Filter credit memos by status",
        rows: creditMemos,
        of: creditMemoStatus,
        known: STATUSES,
        selected: status,
        onSelect: setStatus,
      }}
      onRowOpen={onEdit}
      mobileRow={(memo) => {
        const status = memo.status
        return (
          <>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <p className="text-sm font-medium truncate">
                  {memo.memoNumber || "-"}
                </p>
                <Badge
                  variant={STATUS_VARIANT[status] ?? "secondary"}
                  className="shrink-0 text-xs px-1.5 py-0"
                >
                  {status}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground truncate">
                {customerMap[memo.customerId] ?? "-"}
                {memo.amountRemaining > 0 && ` · ${formatDollars(memo.amountRemaining)} remaining`}
              </p>
            </div>
            <span className="text-sm font-semibold shrink-0">
              {formatDollars(memo.total)}
            </span>
            <MobileRecordActions record={memo} onEdit={onEdit} onDelete={onDelete} />
          </>
        )
      }}
      mobileEmpty={
        <RecordsEmpty
          title="No credit memos yet"
          hint="Create a credit memo to adjust a customer balance."
        />
      }
      desktopEmpty="No credit memos found"
      itemLabel="credit memos"
      paginationId="credit-memos"
    />
  )
}
