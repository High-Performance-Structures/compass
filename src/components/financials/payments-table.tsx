"use client"

import * as React from "react"
import type { ColumnDef } from "@tanstack/react-table"

import type { Payment } from "@/db/schema-netsuite"
import { Badge } from "@/components/ui/badge"
import { EntityTable, filterEntityRows } from "@/components/financials/entity-table"
import {
  actionsColumn,
  dollarsColumn,
  MobileRecordActions,
  RecordName,
  RecordsEmpty,
  selectColumn,
} from "@/components/financials/record-columns"
import { useRecordTable } from "@/components/record-table"
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

const paymentRowId = (record: Payment): string => record.id
const paymentSearchText = (record: Payment): string => record.referenceNumber ?? ""

type ColumnOptions = Pick<PaymentsTableProps, "customerMap" | "vendorMap" | "projectMap" | "onEdit" | "onDelete">

/** The Financials page's sheet columns (sheet "financials.payments"). */
export function paymentColumns({ customerMap, vendorMap, projectMap, onEdit, onDelete }: ColumnOptions): ColumnDef<Payment>[] {
  return [
    selectColumn<Payment>(),
    {
      accessorKey: "referenceNumber",
      header: "Reference #",
      cell: ({ row }) => <RecordName record={row.original} label={row.original.referenceNumber || "-"} onOpen={onEdit} />,
    },
    {
      accessorKey: "paymentType",
      header: "Type",
      cell: ({ row }) => {
        const type = row.original.paymentType
        if (row.original.voidedAt) return <Badge variant="destructive">void</Badge>
        return (
          <Badge variant={type === "received" ? "default" : "secondary"}>
            {type}
          </Badge>
        )
      },
    },
    {
      id: "counterparty",
      accessorFn: (p) => (p.customerId ? customerMap[p.customerId] ?? null : p.vendorId ? vendorMap[p.vendorId] ?? null : null),
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
      accessorFn: (p) => (p.projectId ? projectMap[p.projectId] ?? null : null),
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
}

export function PaymentsTable({
  payments,
  customerMap,
  vendorMap,
  projectMap,
  onEdit,
  onDelete,
}: PaymentsTableProps): React.ReactElement {
  const [search, setSearch] = React.useState("")
  const rows = React.useMemo(
    () => filterEntityRows(payments, search, paymentSearchText),
    [payments, search],
  )
  const columns = React.useMemo(
    () => paymentColumns({ customerMap, vendorMap, projectMap, onEdit, onDelete }),
    [customerMap, vendorMap, projectMap, onEdit, onDelete],
  )
  const table = useRecordTable({
    data: rows,
    columns,
    getRowId: paymentRowId,
    resetKey: search,
    enableSelection: true,
    sheetId: "financials.payments",
  })

  return (
    <EntityTable
      table={table}
      search={{ value: search, onChange: setSearch, label: "Search payments", placeholder: "Search by reference number..." }}
      onRowOpen={onEdit}
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
