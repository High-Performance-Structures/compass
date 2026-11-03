"use client"

import type { ColumnDef } from "@tanstack/react-table"

import type { VendorBill } from "@/db/schema-netsuite"
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

const SEARCH = { columnId: "billNumber", placeholder: "Search by bill number..." }

export function VendorBillsTable({
  bills,
  vendorMap,
  projectMap,
  onEdit,
  onDelete,
}: VendorBillsTableProps) {
  const columns: ColumnDef<VendorBill>[] = [
    selectColumn<VendorBill>(),
    {
      accessorKey: "billNumber",
      header: "Bill #",
      cell: ({ row }) => (
        <span className="font-medium">
          {row.original.billNumber || "-"}
        </span>
      ),
    },
    {
      id: "vendor",
      header: "Vendor",
      cell: ({ row }) => vendorMap[row.original.vendorId] ?? "-",
    },
    {
      id: "project",
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

  return (
    <EntityTable
      data={bills}
      columns={columns}
      mobileToolbar={({ table }) => (
        <EntitySearchInput table={table} {...SEARCH} className={searchInputClass.mobile} />
      )}
      desktopToolbar={({ table }) => (
        <EntitySearchInput table={table} {...SEARCH} className={searchInputClass.desktop} />
      )}
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
