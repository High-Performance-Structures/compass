"use client"

import type { ColumnDef } from "@tanstack/react-table"

import type { Payment } from "@/db/schema-netsuite"
import { Badge } from "@/components/ui/badge"
import { EntitySearchInput, EntityTable } from "@/components/financials/entity-table"
import {
  actionsColumn,
  dollarsColumn,
  MobileRecordActions,
  RecordsEmpty,
  searchInputClass,
  selectColumn,
} from "@/components/financials/record-columns"
import { localeDateText } from "@/lib/domain/financials/rules"
import { formatDollars } from "@/lib/format"

interface PaymentsTableProps {
  payments: Payment[]
  customerMap: Record<string, string>
  vendorMap: Record<string, string>
  projectMap: Record<string, string>
  onEdit?: (payment: Payment) => void
  onDelete?: (id: string) => void
}

const SEARCH = { columnId: "referenceNumber", placeholder: "Search by reference number..." }

export function PaymentsTable({
  payments,
  customerMap,
  vendorMap,
  projectMap,
  onEdit,
  onDelete,
}: PaymentsTableProps) {
  const columns: ColumnDef<Payment>[] = [
    selectColumn<Payment>(),
    {
      accessorKey: "referenceNumber",
      header: "Reference #",
      cell: ({ row }) => (
        <span className="font-medium">
          {row.original.referenceNumber || "-"}
        </span>
      ),
    },
    {
      accessorKey: "paymentType",
      header: "Type",
      cell: ({ row }) => {
        const type = row.original.paymentType
        return (
          <Badge variant={type === "received" ? "default" : "secondary"}>
            {type}
          </Badge>
        )
      },
    },
    {
      id: "counterparty",
      header: "Customer/Vendor",
      cell: ({ row }) => {
        const p = row.original
        if (p.customerId) return customerMap[p.customerId] ?? "-"
        if (p.vendorId) return vendorMap[p.vendorId] ?? "-"
        return "-"
      },
    },
    {
      id: "project",
      header: "Project",
      cell: ({ row }) =>
        row.original.projectId
          ? (projectMap[row.original.projectId] ?? "-")
          : "-",
    },
    dollarsColumn<Payment>("amount", "Amount", (p) => p.amount),
    {
      accessorKey: "paymentDate",
      header: "Date",
      cell: ({ row }) => localeDateText(row.original.paymentDate),
    },
    {
      accessorKey: "paymentMethod",
      header: "Method",
      cell: ({ row }) => {
        const m = row.original.paymentMethod
        return m ? m.replace("_", " ") : "-"
      },
    },
    actionsColumn<Payment>(onEdit, onDelete),
  ]

  return (
    <EntityTable
      data={payments}
      columns={columns}
      mobileToolbar={({ table }) => (
        <EntitySearchInput table={table} {...SEARCH} className={searchInputClass.mobile} />
      )}
      desktopToolbar={({ table }) => (
        <EntitySearchInput table={table} {...SEARCH} className={searchInputClass.desktop} />
      )}
      mobileRow={(p) => {
        const counterparty = p.customerId
          ? customerMap[p.customerId]
          : p.vendorId
            ? vendorMap[p.vendorId]
            : null
        return (
          <>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <p className="text-sm font-medium truncate">
                  {p.referenceNumber || "-"}
                </p>
                <Badge
                  variant={
                    p.paymentType === "received"
                      ? "default"
                      : "secondary"
                  }
                  className="shrink-0 text-xs px-1.5 py-0"
                >
                  {p.paymentType}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground truncate">
                {counterparty ?? "-"}
                {` · ${localeDateText(p.paymentDate)}`}
              </p>
            </div>
            <span className="text-sm font-semibold shrink-0">
              {formatDollars(p.amount)}
            </span>
            <MobileRecordActions record={p} onEdit={onEdit} onDelete={onDelete} />
          </>
        )
      }}
      mobileEmpty={
        <RecordsEmpty
          title="No payments yet"
          hint="Record a payment to track money in or out."
        />
      }
      desktopEmpty="No payments found"
      itemLabel="payments"
      paginationId="payments"
    />
  )
}
