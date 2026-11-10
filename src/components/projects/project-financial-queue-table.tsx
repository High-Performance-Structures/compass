"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { IconExternalLink } from "@tabler/icons-react"
import type { ColumnDef } from "@tanstack/react-table"

import type { ProjectFinancialWorkflowItem } from "@/app/actions/project-financial-workflows"
import { payApplicationStatusLabel } from "@/components/projects/pay-application-billing-controls"
import { RecordSearchInput, RecordTable, useRecordTable } from "@/components/record-table"
import { SourceTag } from "@/components/shared/source-tag"
import { StatusFilterBar } from "@/components/status-filter-bar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { formatDate, formatDollars } from "@/lib/format"

type QueueType = ProjectFinancialWorkflowItem["type"]
type QueueFilter = QueueType | "all"

/** The filter buttons, in this order; a type with no records hides. */
const TYPE_LABELS: readonly { readonly value: QueueType; readonly label: string; readonly plural: string }[] = [
  { value: "owner_pay_application", label: "Owner pay app", plural: "Pay applications" },
  { value: "owner_invoice", label: "Owner invoice", plural: "Owner invoices" },
  { value: "deposit", label: "Deposit", plural: "Deposits" },
  { value: "payment", label: "Payment", plural: "Payments" },
  { value: "vendor_bill", label: "Vendor bill", plural: "Vendor bills" },
  { value: "credit_memo", label: "Credit memo", plural: "Credit memos" },
  { value: "rfq", label: "RFQ", plural: "RFQs" },
]

const rowId = (item: ProjectFinancialWorkflowItem): string => item.id

function workflowLabel(type: QueueType): string {
  return TYPE_LABELS.find((entry) => entry.value === type)?.label ?? type
}

function syncLabel(item: ProjectFinancialWorkflowItem): string {
  if (item.syncStatus === "pending_sage") return "Pending Sage"
  if (item.syncStatus === "queued_sage") return "Queued"
  if (item.syncStatus === "synced") return "Synced"
  if (item.syncStatus === "compass_only") return "Compass only"
  return item.syncStatus
}

function statusLabel(item: ProjectFinancialWorkflowItem): string {
  return item.type === "owner_pay_application" ? payApplicationStatusLabel(item.status) : item.status
}

function matchesSearch(item: ProjectFinancialWorkflowItem, query: string): boolean {
  const needle = query.trim().toLowerCase()
  if (!needle) return true
  return [workflowLabel(item.type), item.number, item.title, item.companyName, statusLabel(item), item.sourceLabel]
    .some((value) => value?.toLowerCase().includes(needle))
}

type QueueLinks = {
  /** The page a record opens on, when it has one (pay applications open their G702 / G703). */
  readonly href: (item: ProjectFinancialWorkflowItem) => string | null
  /** Opens a pay application's Quick look in the record drawer. */
  readonly quickLook: (item: ProjectFinancialWorkflowItem) => void
  readonly projectDriveUrl: string | null
  readonly developerModeEnabled: boolean
}

/** The financial queue sheet's columns (registry sheet "financials.queue"). */
export function financialQueueColumns(links: QueueLinks): ColumnDef<ProjectFinancialWorkflowItem>[] {
  return [
    {
      id: "record",
      accessorFn: (item) => `${workflowLabel(item.type)} ${item.number ?? ""}`.toLocaleLowerCase(),
      header: "Record",
      size: 190,
      cell: ({ row: { original } }) => {
        const href = links.href(original)
        return (
          <div className="min-w-32">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{workflowLabel(original.type)}</span>
              {original.importedFrom && <SourceTag source={original.importedFrom} />}
              {original.sourceLabel && <Badge variant="secondary">{original.sourceLabel}</Badge>}
            </div>
            {original.number && <p className="text-xs text-muted-foreground">{original.number}</p>}
            {href ? (
              // Pay applications: a Quick look in the drawer, or Edit on the full page.
              <div className="mt-1 flex flex-wrap gap-1">
                <Button type="button" size="sm" variant="outline" className="h-7" onClick={() => links.quickLook(original)}>
                  Quick look
                </Button>
                <Button asChild size="sm" variant="outline" className="h-7">
                  <a href={href}>Edit</a>
                </Button>
              </div>
            ) : null}
          </div>
        )
      },
    },
    {
      id: "title",
      accessorFn: (item) => item.title.toLocaleLowerCase() || undefined,
      header: "Title",
      size: 260,
      cell: ({ row: { original } }) => {
        const supportingHref =
          original.supportingPackageUrl ?? (original.type === "owner_pay_application" ? links.projectDriveUrl : null)
        return (
          <div className="min-w-40">
            <p className="break-words">{original.title}</p>
            {supportingHref && (
              <Button asChild size="sm" variant="link" className="mt-1 h-auto justify-start p-0">
                <a href={supportingHref} target="_blank" rel="noreferrer">
                  <IconExternalLink className="size-4" />
                  {original.supportingPackageUrl ? "Open supporting package" : "Open project Drive"}
                </a>
              </Button>
            )}
          </div>
        )
      },
    },
    {
      id: "company",
      accessorFn: (item) => item.companyName?.toLocaleLowerCase() || undefined,
      header: "Company",
      size: 170,
      cell: ({ row }) => row.original.companyName ?? <span className="text-muted-foreground">—</span>,
    },
    {
      id: "amount",
      accessorFn: (item) => item.amount ?? undefined,
      header: "Amount",
      size: 150,
      cell: ({ row: { original } }) => (
        <div className="text-right tabular-nums">
          <span>{formatDollars(original.amount, { decimals: 0, fallback: "-" })}</span>
          {original.paymentBreakdown && original.paymentBreakdown.depositApplied > 0 && (
            <p className="mt-1 text-xs text-muted-foreground">
              {formatDollars(original.paymentBreakdown.currentPaymentDue, { decimals: 0 })} due after {formatDollars(original.paymentBreakdown.depositApplied, { decimals: 0 })} deposit
            </p>
          )}
        </div>
      ),
    },
    {
      id: "date",
      accessorFn: (item) => item.dueDate?.slice(0, 10) || undefined,
      header: "Date",
      size: 120,
      cell: ({ row }) => <span className="whitespace-nowrap tabular-nums">{formatDate(row.original.dueDate?.slice(0, 10) ?? null, "medium", "-")}</span>,
    },
    {
      id: "status",
      accessorFn: (item) => statusLabel(item).toLocaleLowerCase(),
      header: "Status",
      size: 160,
      cell: ({ row: { original } }) => (
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline">{statusLabel(original)}</Badge>
          {original.readOnly && <Badge variant="outline">Read only</Badge>}
          {links.developerModeEnabled && <Badge variant="secondary">{syncLabel(original)}</Badge>}
        </div>
      ),
    },
  ]
}

/** A job's financial records on the shared record table, filtered by record type. */
export function ProjectFinancialQueueTable({
  items,
  projectId,
  projectDriveUrl,
  developerModeEnabled,
}: {
  readonly items: readonly ProjectFinancialWorkflowItem[]
  readonly projectId: string
  readonly projectDriveUrl: string | null
  readonly developerModeEnabled: boolean
}): React.ReactElement {
  const router = useRouter()
  const [filter, setFilter] = React.useState<QueueFilter>("all")
  const [query, setQuery] = React.useState("")
  const visible = React.useMemo(
    () => items.filter((item) => (filter === "all" || item.type === filter) && matchesSearch(item, query)),
    [items, filter, query]
  )
  const href = React.useCallback(
    (item: ProjectFinancialWorkflowItem): string | null =>
      item.type === "owner_pay_application" && item.sourceRecordId && item.paymentBreakdown !== null
        ? `/dashboard/projects/${projectId}/financials/pay-applications/${item.sourceRecordId}`
        : null,
    [projectId]
  )
  // The Quick look is read on the server from `?item=` and shown in the drawer.
  const quickLook = React.useCallback(
    (item: ProjectFinancialWorkflowItem): void => {
      if (!item.sourceRecordId) return
      router.push(`/dashboard/projects/${projectId}/financials?item=${encodeURIComponent(item.sourceRecordId)}`, { scroll: false })
    },
    [projectId, router]
  )
  const columns = React.useMemo(
    () => financialQueueColumns({ href, quickLook, projectDriveUrl, developerModeEnabled }),
    [href, quickLook, projectDriveUrl, developerModeEnabled]
  )
  const table = useRecordTable({
    data: visible,
    columns,
    getRowId: rowId,
    resetKey: `${filter}:${query}`,
    sheetId: "financials.queue",
  })

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <StatusFilterBar
          kind="button"
          label="Filter financial records by type"
          options={[
            { value: "all", label: "All", count: items.length, pinned: true },
            ...TYPE_LABELS.map((entry) => ({
              value: entry.value,
              label: entry.plural,
              count: items.filter((item) => item.type === entry.value).length,
            })),
          ]}
          selected={filter}
          onSelect={setFilter}
        />
        <RecordSearchInput
          value={query}
          onChange={setQuery}
          label="Search financial records"
          placeholder="Search number, title, company or status…"
          className="sm:max-w-sm"
        />
      </div>
      <RecordTable
        table={table}
        itemLabel="financial records"
        emptyMessage={query ? "No financial records match this search." : "No financial records of this type."}
        rowIdPrefix="financial-row"
        onRowOpen={(item) => {
          if (href(item)) quickLook(item)
        }}
      />
    </div>
  )
}
