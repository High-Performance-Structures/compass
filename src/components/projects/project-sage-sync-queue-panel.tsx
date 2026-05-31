"use client"

import { useMemo, useState, useTransition, type ReactElement } from "react"
import { useRouter } from "next/navigation"
import {
  IconAlertTriangle,
  IconArrowRight,
  IconCheck,
  IconClock,
  IconDatabaseExport,
} from "@tabler/icons-react"

import {
  queueProjectOperationForSageSync,
  queueProjectOperationsForSageSync,
  type ProjectSageSyncItem,
  type ProjectSageSyncQueue,
} from "@/app/actions/project-operations"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

function formatKind(kind: ProjectSageSyncItem["kind"]): string {
  if (kind === "project_handoff") return "Project handoff"
  if (kind === "purchase_order") return "Purchase order"
  if (kind === "vendor_bill") return "Vendor bill"
  if (kind === "owner_pay_application") return "Owner pay app"
  if (kind === "budget_application") return "Budget application"
  if (kind === "budget_line") return "Budget line"
  if (kind === "rfq") return "RFQ"
  return "Task"
}

function formatMoney(value: number | null): string {
  if (value === null) return "-"
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value)
}

function formatDate(value: string | null): string {
  if (!value) return "-"
  const date = new Date(`${value.slice(0, 10)}T00:00:00`)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

function itemQueueState(
  item: ProjectSageSyncItem
): "ready" | "queued" | "blocked" {
  if (item.syncStatus === "queued_sage" || item.syncStatus === "syncing") {
    return "queued"
  }
  if (item.syncDirection !== "write") return "blocked"
  if (item.sageWriteStatus === "not_ready") return "blocked"
  if (item.syncStatus === "synced") return "blocked"
  return "ready"
}

function canQueueItem(item: ProjectSageSyncItem): boolean {
  return item.table === "project_operations" && itemQueueState(item) === "ready"
}

function QueueStateBadge({ item }: { readonly item: ProjectSageSyncItem }): ReactElement {
  const state = itemQueueState(item)
  if (state === "ready") {
    return (
      <Badge variant="outline" className="gap-1 border-emerald-300 text-emerald-700">
        <IconCheck className="size-3" />
        Ready
      </Badge>
    )
  }
  if (state === "queued") {
    return (
      <Badge variant="outline" className="gap-1 border-blue-300 text-blue-700">
        <IconClock className="size-3" />
        Queued
      </Badge>
    )
  }
  return (
    <Badge variant="outline" className="gap-1 border-amber-300 text-amber-700">
      <IconAlertTriangle className="size-3" />
      Review
    </Badge>
  )
}

function statusText(item: ProjectSageSyncItem): string {
  if (item.syncDirection !== "write") return "Read-only from Sage"
  if (item.sageWriteStatus === "not_ready") return "Missing Sage mapping"
  if (item.syncStatus === "queued_sage") return "Waiting for Sage bridge"
  if (item.syncStatus === "syncing") return "Bridge is processing"
  if (item.syncStatus === "failed") return "Needs retry"
  return item.sageWriteStatus ?? item.syncStatus
}

export function ProjectSageSyncQueuePanel({
  projectId,
  queue,
}: {
  readonly projectId: string
  readonly queue: ProjectSageSyncQueue | null
}): ReactElement {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [message, setMessage] = useState<string | null>(null)
  const [activeItemId, setActiveItemId] = useState<string | null>(null)
  const visibleItems = useMemo(
    () => queue?.pendingItems.slice(0, 12) ?? [],
    [queue?.pendingItems]
  )

  function queueOne(item: ProjectSageSyncItem): void {
    if (!canQueueItem(item)) return
    setMessage(null)
    setActiveItemId(item.id)
    startTransition(async () => {
      const result = await queueProjectOperationForSageSync(projectId, item.id)
      setMessage(
        result.success
          ? "Queued for Sage bridge review."
          : result.error
      )
      setActiveItemId(null)
      router.refresh()
    })
  }

  function queueReadyBatch(): void {
    setMessage(null)
    setActiveItemId("batch")
    startTransition(async () => {
      const result = await queueProjectOperationsForSageSync(projectId)
      setMessage(
        result.success
          ? `Queued ${result.updatedCount} item${result.updatedCount === 1 ? "" : "s"} for Sage.`
          : result.error
      )
      setActiveItemId(null)
      router.refresh()
    })
  }

  if (!queue) {
    return (
      <section className="clarity-panel overflow-hidden">
        <div className="clarity-section-header flex items-center gap-2 px-4 py-3">
          <span className="flex size-8 items-center justify-center rounded-md border bg-background">
            <IconDatabaseExport className="size-4 text-muted-foreground" />
          </span>
          <h2 className="text-sm font-semibold">Sage Sync Queue</h2>
        </div>
        <p className="px-4 py-4 text-sm text-muted-foreground">
          Sync status is available when the project registry can be loaded.
        </p>
      </section>
    )
  }

  return (
    <section className="clarity-panel overflow-hidden">
      <div className="clarity-section-header flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex size-8 items-center justify-center rounded-md border bg-background">
              <IconDatabaseExport className="size-4 text-muted-foreground" />
            </span>
            <h2 className="text-sm font-semibold">Sage Sync Queue</h2>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Developer review lane for Compass records before the Sage bridge writes.
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          onClick={queueReadyBatch}
          disabled={isPending || queue.readyCount === 0}
          className="w-full sm:w-auto"
        >
          Queue Ready Batch
          <IconArrowRight className="size-4" />
        </Button>
      </div>

      <div className="flex flex-wrap gap-2 px-4 py-3 text-xs">
        <Badge variant="outline">{queue.pendingItems.length} pending</Badge>
        <Badge variant="outline" className="border-emerald-300 text-emerald-700">
          {queue.readyCount} ready
        </Badge>
        <Badge variant="outline" className="border-blue-300 text-blue-700">
          {queue.queuedCount} queued
        </Badge>
        <Badge variant="outline" className="border-amber-300 text-amber-700">
          {queue.blockedCount} review
        </Badge>
      </div>

      {message && (
        <p className="mx-4 rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
          {message}
        </p>
      )}

      {visibleItems.length === 0 ? (
        <p className="px-4 pb-4 text-sm text-muted-foreground">
          Nothing is waiting on Sage right now.
        </p>
      ) : (
        <div className="mx-4 mb-4 overflow-hidden rounded-md border">
          <div className="grid grid-cols-[1.2fr_.75fr_.8fr_.8fr_auto] gap-3 border-b bg-muted/40 px-3 py-2 text-xs font-medium uppercase text-muted-foreground">
            <span>Item</span>
            <span>Amount</span>
            <span>Date</span>
            <span>Status</span>
            <span className="text-right">Action</span>
          </div>
          <div className="divide-y">
            {visibleItems.map((item) => {
              const itemCanQueue = canQueueItem(item)
              const isActive = activeItemId === item.id || activeItemId === "batch"
              return (
                <div
                  key={`${item.table}:${item.id}`}
                  className="grid grid-cols-1 gap-2 px-3 py-3 text-sm sm:grid-cols-[1.2fr_.75fr_.8fr_.8fr_auto] sm:items-center sm:gap-3"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{formatKind(item.kind)}</span>
                      {item.recordNumber && (
                        <span className="text-xs text-muted-foreground">
                          {item.recordNumber}
                        </span>
                      )}
                    </div>
                    <p className="truncate text-sm text-muted-foreground">
                      {item.title}
                    </p>
                    {item.detail && (
                      <p className="truncate text-xs text-muted-foreground">
                        {item.detail}
                      </p>
                    )}
                  </div>
                  <span>{formatMoney(item.amount)}</span>
                  <span>{formatDate(item.dueDate)}</span>
                  <div className="space-y-1">
                    <QueueStateBadge item={item} />
                    <p className="text-xs text-muted-foreground">
                      {statusText(item)}
                    </p>
                  </div>
                  <div className="flex justify-start sm:justify-end">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => queueOne(item)}
                      disabled={isPending || !itemCanQueue}
                      className={cn(!itemCanQueue && "opacity-60")}
                    >
                      {isActive ? "Queueing..." : "Queue"}
                    </Button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {queue.pendingItems.length > visibleItems.length && (
        <p className="px-4 pb-4 text-xs text-muted-foreground">
          Showing the first {visibleItems.length} items. Additional rows remain in
          the queue and will be visible as this panel expands.
        </p>
      )}
    </section>
  )
}
