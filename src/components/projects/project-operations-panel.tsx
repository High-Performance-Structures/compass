import {
  IconCalendarStats,
  IconClipboardCheck,
  IconExternalLink,
  IconReceipt,
  IconUsers,
} from "@tabler/icons-react"
import Link from "next/link"

import type {
  ProjectOperationItem,
  ProjectOperationsSummary,
} from "@/app/actions/project-operations"
import {
  DeveloperOnly,
  WorkerOnly,
} from "@/components/developer-mode-provider"
import { Badge } from "@/components/ui/badge"

function money(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value)
}

function formatDate(value: string | null): string {
  if (!value) return "Unscheduled"
  return new Date(`${value}T00:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  })
}

function recordTypeLabel(value: string): string {
  switch (value) {
    case "purchase_order":
      return "PO"
    case "staff_task":
      return "Staff"
    case "subcontractor_task":
      return "Sub"
    case "supplier_task":
      return "Supplier"
    case "schedule_task":
      return "Schedule"
    default:
      return value
  }
}

function OperationRow({
  item,
}: {
  readonly item: ProjectOperationItem
}): React.ReactElement {
  return (
    <div className="flex min-w-0 items-start justify-between gap-3 rounded-md border bg-background p-2">
      <div className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <p className="truncate text-sm font-medium">{item.title}</p>
          <Badge variant="outline">
            {recordTypeLabel(item.sourceRecordType)}
          </Badge>
        </div>
        <p className="mt-1 truncate text-xs text-muted-foreground">
          <DeveloperOnly>
            {item.sourceRecordNumber
              ? `Sage ${item.sourceRecordNumber}`
              : "Sage mapped"}
          </DeveloperOnly>
          <WorkerOnly>{recordTypeLabel(item.sourceRecordType)}</WorkerOnly>
          {item.companyName ? ` · ${item.companyName}` : ""}
          {item.assigneeName ? ` · ${item.assigneeName}` : ""}
        </p>
      </div>
      <div className="shrink-0 text-right text-xs text-muted-foreground">
        <p>{formatDate(item.dueDate ?? item.startDate)}</p>
        {item.amount !== null && <p>{money(item.amount)}</p>}
      </div>
    </div>
  )
}

export function ProjectOperationsPanel({
  projectId,
  summary,
}: {
  readonly projectId: string
  readonly summary: ProjectOperationsSummary | null
}): React.ReactElement {
  if (!summary) {
    return (
      <section className="rounded-lg border p-3 sm:p-4">
        <div className="flex items-center gap-2">
          <IconClipboardCheck className="size-4 text-muted-foreground" />
          <h2 className="text-sm font-medium">Project Operations</h2>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          Operational details are unavailable for this project.
        </p>
      </section>
    )
  }

  return (
    <section className="rounded-lg border p-3 sm:p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <IconClipboardCheck className="size-4 text-muted-foreground" />
            <h2 className="text-sm font-medium">Project Operations</h2>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Purchase orders, staff/sub/supplier commitments, and the next
            schedule item available to owner updates.
          </p>
        </div>
        <Badge variant="secondary">
          {summary.activeCommitmentCount} active commitments
        </Badge>
        <Link
          href={`/dashboard/projects/${projectId}/purchase-orders`}
          className="inline-flex items-center gap-1.5 rounded-md border bg-background px-3 py-1.5 text-sm font-medium transition-colors hover:bg-accent"
        >
          Purchase orders
          <IconExternalLink className="size-4" />
        </Link>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-3">
        <div className="rounded-md border bg-background p-3">
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-muted-foreground">Open POs</span>
            <IconReceipt className="size-4 text-muted-foreground" />
          </div>
          <p className="mt-2 text-2xl font-semibold leading-none">
            {summary.openPurchaseOrderCount}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {money(summary.openPurchaseOrderTotal)}
          </p>
        </div>

        <div className="rounded-md border bg-background p-3">
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-muted-foreground">
              Staff/sub/supplier
            </span>
            <IconUsers className="size-4 text-muted-foreground" />
          </div>
          <p className="mt-2 text-2xl font-semibold leading-none">
            {summary.activeCommitmentCount}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Active commitments
          </p>
        </div>

        <div className="rounded-md border bg-background p-3">
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-muted-foreground">
              Next schedule item
            </span>
            <IconCalendarStats className="size-4 text-muted-foreground" />
          </div>
          {summary.nextScheduleItem ? (
            <div className="mt-2">
              <p className="line-clamp-1 text-sm font-medium">
                {summary.nextScheduleItem.title}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {formatDate(summary.nextScheduleItem.startDate)}
                {" - "}
                {formatDate(summary.nextScheduleItem.endDate)}
                {summary.nextScheduleItem.assignedTo
                  ? ` · ${summary.nextScheduleItem.assignedTo}`
                  : ""}
              </p>
            </div>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">
              No upcoming item mapped yet.
            </p>
          )}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
        <div className="space-y-2">
          <p className="text-xs font-medium uppercase text-muted-foreground">
            Purchase orders
          </p>
          {summary.purchaseOrders.length > 0 ? (
            summary.purchaseOrders.map((item) => (
              <OperationRow key={item.id} item={item} />
            ))
          ) : (
            <p className="rounded-md border p-3 text-sm text-muted-foreground">
              No purchase orders yet.
            </p>
          )}
        </div>

        <div className="space-y-2">
          <p className="text-xs font-medium uppercase text-muted-foreground">
            Commitments
          </p>
          {summary.commitments.length > 0 ? (
            summary.commitments.map((item) => (
              <OperationRow key={item.id} item={item} />
            ))
          ) : (
            <p className="rounded-md border p-3 text-sm text-muted-foreground">
              No staff/sub/supplier commitments yet.
            </p>
          )}
        </div>
      </div>
    </section>
  )
}
