"use client"

import * as React from "react"
import Link from "next/link"
import type { ColumnDef } from "@tanstack/react-table"

import type { Invoice } from "@/db/schema-netsuite"
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
import { invoiceAcceptsPayments, localeDateText } from "@/lib/domain/financials/rules"
import { formatDollars } from "@/lib/format"

const STATUS_VARIANT: Record<string, BadgeVariant> = {
  draft: "secondary",
  sent: "default",
  paid: "outline",
  overdue: "destructive",
  partially_paid: "default",
  void: "secondary",
}

interface InvoicesTableProps {
  invoices: Invoice[]
  customerMap: Record<string, string>
  projectMap: Record<string, string>
  onEdit?: (invoice: Invoice) => void
  onDelete?: (id: string) => void
}

const STATUSES: readonly { readonly value: string; readonly label: string }[] = [
  { value: "draft", label: "Draft" },
  { value: "sent", label: "Sent" },
  { value: "partially_paid", label: "Partially paid" },
  { value: "overdue", label: "Overdue" },
  { value: "paid", label: "Paid" },
  { value: "void", label: "Void" },
]

const invoiceRowId = (invoice: Invoice): string => invoice.id
const invoiceStatus = (invoice: Invoice): string => invoice.status
const invoiceSearchText = (invoice: Invoice): string => invoice.invoiceNumber ?? ""

/** Payments are recorded on the project's financials, where the customer's other open items are. */
function recordPaymentHref(invoice: Invoice): string | null {
  if (!invoice.projectId || invoice.amountDue <= 0 || !invoiceAcceptsPayments(invoice.status)) return null
  return `/dashboard/projects/${encodeURIComponent(invoice.projectId)}/financials?recordPayment=${encodeURIComponent(`invoice:${invoice.id}`)}`
}

type InvoiceColumnOptions = Pick<InvoicesTableProps, "customerMap" | "projectMap" | "onEdit" | "onDelete">

/** The Financials page's invoice sheet columns (sheet "financials.invoices"). */
export function financialInvoiceColumns({ customerMap, projectMap, onEdit, onDelete }: InvoiceColumnOptions): ColumnDef<Invoice>[] {
  return [
    selectColumn<Invoice>(),
    {
      accessorKey: "invoiceNumber",
      header: "Invoice #",
      cell: ({ row }) => <RecordName record={row.original} label={row.original.invoiceNumber || "-"} onOpen={onEdit} />,
    },
    {
      id: "customer",
      accessorFn: (invoice) => customerMap[invoice.customerId] ?? null,
      header: "Customer",
      cell: ({ row }) =>
        customerMap[row.original.customerId] ?? "-",
    },
    {
      id: "project",
      accessorFn: (invoice) => (invoice.projectId ? projectMap[invoice.projectId] ?? null : null),
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
      accessorKey: "issueDate",
      header: "Issue Date",
      cell: ({ row }) => localeDateText(row.original.issueDate),
    },
    {
      accessorKey: "dueDate",
      header: "Due Date",
      cell: ({ row }) => {
        const d = row.original.dueDate
        return d ? localeDateText(d) : "-"
      },
    },
    dollarsColumn<Invoice>("total", "Total", (inv) => inv.total),
    dollarsColumn<Invoice>("amountPaid", "Paid", (inv) => inv.amountPaid),
    dollarsColumn<Invoice>("amountDue", "Amount Due", (inv) => inv.amountDue),
    {
      id: "recordPayment",
      enableSorting: false,
      cell: ({ row }) => {
        const href = recordPaymentHref(row.original)
        return href ? (
          <Link href={href} className="text-sm text-primary hover:underline">
            Record payment
          </Link>
        ) : null
      },
    },
    actionsColumn<Invoice>(onEdit, onDelete),
  ]
}

export function InvoicesTable({
  invoices,
  customerMap,
  projectMap,
  onEdit,
  onDelete,
}: InvoicesTableProps): React.ReactElement {
  const [search, setSearch] = React.useState("")
  const startFilter = useListSheetStartFilter("financials.invoices", ALL_STATUSES)
  const [status, setStatus] = React.useState(startFilter)
  const rows = React.useMemo(
    () => filterEntityRows(invoices, search, invoiceSearchText, { selected: status, of: invoiceStatus }),
    [invoices, search, status],
  )
  const columns = React.useMemo(
    () => financialInvoiceColumns({ customerMap, projectMap, onEdit, onDelete }),
    [customerMap, projectMap, onEdit, onDelete],
  )
  const table = useRecordTable({
    data: rows,
    columns,
    getRowId: invoiceRowId,
    resetKey: `${status}|${search}`,
    enableSelection: true,
    sheetId: "financials.invoices",
  })

  return (
    <EntityTable
      table={table}
      search={{ value: search, onChange: setSearch, label: "Search invoices", placeholder: "Search by invoice number..." }}
      statusFilter={{
        label: "Filter invoices by status",
        rows: invoices,
        of: invoiceStatus,
        known: STATUSES,
        selected: status,
        onSelect: setStatus,
      }}
      onRowOpen={onEdit}
      mobileRow={(inv) => {
        const status = inv.status
        return (
          <>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <p className="text-sm font-medium truncate">
                  {inv.invoiceNumber || "-"}
                </p>
                <Badge
                  variant={STATUS_VARIANT[status] ?? "secondary"}
                  className="shrink-0 text-xs px-1.5 py-0"
                >
                  {status.replace("_", " ")}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground truncate">
                {customerMap[inv.customerId] ?? "-"}
                {inv.dueDate && ` · Due ${localeDateText(inv.dueDate)}`}
              </p>
            </div>
            <span className="text-sm font-semibold shrink-0">
              {formatDollars(inv.total)}
            </span>
            <MobileRecordActions record={inv} onEdit={onEdit} onDelete={onDelete} />
          </>
        )
      }}
      mobileEmpty={
        <RecordsEmpty
          title="No invoices yet"
          hint="Create an invoice to bill a customer for project work."
        />
      }
      desktopEmpty="No invoices found"
      itemLabel="invoices"
      paginationId="invoices"
    />
  )
}
