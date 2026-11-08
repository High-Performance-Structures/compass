"use client"

import * as React from "react"
import type { ColumnDef } from "@tanstack/react-table"

import type { VendorBill } from "@/db/schema-netsuite"
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
  pending: "secondary",
  approved: "default",
  paid: "outline",
  partially_paid: "default",
  void: "secondary",
}

interface VendorBillsTableProps {
  bills: VendorBill[]
  vendorMap: Record<string, string>
  projectMap: Record<string, string>
  onEdit?: (bill: VendorBill) => void
  onDelete?: (id: string) => void
}

const vendorBillRowId = (record: VendorBill): string => record.id
const vendorBillSearchText = (record: VendorBill): string => record.billNumber ?? ""
const vendorBillStatus = (record: VendorBill): string => record.status

const STATUSES: readonly { readonly value: string; readonly label: string }[] = [
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "partially_paid", label: "Partially paid" },
  { value: "paid", label: "Paid" },
  { value: "void", label: "Void" },
]

type ColumnOptions = Pick<VendorBillsTableProps, "vendorMap" | "projectMap" | "onEdit" | "onDelete">

/** The Financials page's sheet columns (sheet "financials.vendor-bills"). */
export function vendorBillColumns({ vendorMap, projectMap, onEdit, onDelete }: ColumnOptions): ColumnDef<VendorBill>[] {
  return [
    selectColumn<VendorBill>(),
    {
      accessorKey: "billNumber",
      header: "Bill #",
      cell: ({ row }) => <RecordName record={row.original} label={row.original.billNumber || "-"} onOpen={onEdit} />,
    },
    {
      id: "vendor",
      accessorFn: (bill) => vendorMap[bill.vendorId] ?? null,
      header: "Vendor",
      cell: ({ row }) => vendorMap[row.original.vendorId] ?? "-",
    },
    {
      id: "project",
      accessorFn: (bill) => (bill.projectId ? projectMap[bill.projectId] ?? null : null),
      header: "Project",
      cell: ({ row }) =>
        row.original.projectId
          ? (projectMap[row.original.projectId] ?? "-")
          : "-",
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => {
        const status = row.original.status
        return (
          <Badge variant={STATUS_VARIANT[status] ?? "secondary"}>
            {status.replace("_", " ")}
          </Badge>
        )
      },
    },
    {
      accessorKey: "billDate",
      header: "Bill Date",
      cell: ({ row }) => localeDateText(row.original.billDate),
    },
    {
      accessorKey: "dueDate",
      header: "Due Date",
      cell: ({ row }) => {
        const d = row.original.dueDate
        return d ? localeDateText(d) : "-"
      },
    },
    dollarsColumn<VendorBill>("total", "Total", (bill) => bill.total),
    dollarsColumn<VendorBill>("amountDue", "Amount Due", (bill) => bill.amountDue),
    actionsColumn<VendorBill>(onEdit, onDelete),
  ]
}

export function VendorBillsTable({
  bills,
  vendorMap,
  projectMap,
  onEdit,
  onDelete,
}: VendorBillsTableProps): React.ReactElement {
  const [search, setSearch] = React.useState("")
  const startFilter = useListSheetStartFilter("financials.vendor-bills", ALL_STATUSES)
  const [status, setStatus] = React.useState(startFilter)
  const rows = React.useMemo(
    () => filterEntityRows(bills, search, vendorBillSearchText, { selected: status, of: vendorBillStatus }),
    [bills, search, status],
  )
  const columns = React.useMemo(
    () => vendorBillColumns({ vendorMap, projectMap, onEdit, onDelete }),
    [vendorMap, projectMap, onEdit, onDelete],
  )
  const table = useRecordTable({
    data: rows,
    columns,
    getRowId: vendorBillRowId,
    resetKey: `${status}|${search}`,
    enableSelection: true,
    sheetId: "financials.vendor-bills",
  })

  return (
    <EntityTable
      table={table}
      search={{ value: search, onChange: setSearch, label: "Search vendor bills", placeholder: "Search by bill number..." }}
      statusFilter={{
        label: "Filter vendor bills by status",
        rows: bills,
        of: vendorBillStatus,
        known: STATUSES,
        sheetId: "financials.vendor-bills",
        selected: status,
        onSelect: setStatus,
      }}
      onRowOpen={onEdit}
      mobileRow={(bill) => {
        const status = bill.status
        return (
          <>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <p className="text-sm font-medium truncate">
                  {bill.billNumber || "-"}
                </p>
                <Badge
                  variant={STATUS_VARIANT[status] ?? "secondary"}
                  className="shrink-0 text-xs px-1.5 py-0"
                >
                  {status.replace("_", " ")}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground truncate">
                {vendorMap[bill.vendorId] ?? "-"}
                {bill.dueDate && ` · Due ${localeDateText(bill.dueDate)}`}
              </p>
            </div>
            <span className="text-sm font-semibold shrink-0">
              {formatDollars(bill.total)}
            </span>
            <MobileRecordActions record={bill} onEdit={onEdit} onDelete={onDelete} />
          </>
        )
      }}
      mobileEmpty={
        <RecordsEmpty
          title="No bills yet"
          hint="Record a vendor bill to track what you owe."
        />
      }
      desktopEmpty="No bills found"
      itemLabel="vendor bills"
      paginationId="vendor-bills"
    />
  )
}
