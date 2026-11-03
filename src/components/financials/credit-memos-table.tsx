"use client"

import type { ColumnDef } from "@tanstack/react-table"

import type { CreditMemo } from "@/db/schema-netsuite"
import { Badge } from "@/components/ui/badge"
import { EntitySearchInput, EntityTable } from "@/components/financials/entity-table"
import {
  actionsColumn,
  dollarsColumn,
  MobileRecordActions,
  RecordsEmpty,
  searchInputClass,
  selectColumn,
  type BadgeVariant,
} from "@/components/financials/record-columns"
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

const SEARCH = { columnId: "memoNumber", placeholder: "Search by memo number..." }

export function CreditMemosTable({
  creditMemos,
  customerMap,
  onEdit,
  onDelete,
}: CreditMemosTableProps) {
  const columns: ColumnDef<CreditMemo>[] = [
    selectColumn<CreditMemo>(),
    {
      accessorKey: "memoNumber",
      header: "Memo #",
      cell: ({ row }) => (
        <span className="font-medium">
          {row.original.memoNumber || "-"}
        </span>
      ),
    },
    {
      id: "customer",
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

  return (
    <EntityTable
      data={creditMemos}
      columns={columns}
      mobileToolbar={({ table }) => (
        <EntitySearchInput table={table} {...SEARCH} className={searchInputClass.mobile} />
      )}
      desktopToolbar={({ table }) => (
        <EntitySearchInput table={table} {...SEARCH} className={searchInputClass.desktop} />
      )}
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
