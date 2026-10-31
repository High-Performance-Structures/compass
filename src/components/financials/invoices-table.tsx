"use client"

import Link from "next/link"
import type { ColumnDef } from "@tanstack/react-table"

import type { Invoice } from "@/db/schema-netsuite"
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

const SEARCH = { columnId: "invoiceNumber", placeholder: "Search by invoice number..." }

/** Payments are recorded on the project's financials, where the customer's other open items are. */
function recordPaymentHref(invoice: Invoice): string | null {
  if (!invoice.projectId || invoice.amountDue <= 0 || !invoiceAcceptsPayments(invoice.status)) return null
  return `/dashboard/projects/${encodeURIComponent(invoice.projectId)}/financials?recordPayment=${encodeURIComponent(`invoice:${invoice.id}`)}`
}

export function InvoicesTable({
  invoices,
  customerMap,
  projectMap,
  onEdit,
  onDelete,
}: InvoicesTableProps) {
  const columns: ColumnDef<Invoice>[] = [
    selectColumn<Invoice>(),
    {
      accessorKey: "invoiceNumber",
      header: "Invoice #",
      cell: ({ row }) => (
        <span className="font-medium">
          {row.original.invoiceNumber || "-"}
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

  return (
    <EntityTable
      data={invoices}
      columns={columns}
      mobileToolbar={({ table }) => (
        <EntitySearchInput table={table} {...SEARCH} className={searchInputClass.mobile} />
      )}
      desktopToolbar={({ table }) => (
        <EntitySearchInput table={table} {...SEARCH} className={searchInputClass.desktop} />
      )}
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
