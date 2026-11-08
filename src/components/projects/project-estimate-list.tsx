"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useTransition } from "react"
import { IconPlus } from "@tabler/icons-react"
import type { ColumnDef } from "@tanstack/react-table"
import { toast } from "sonner"

import { createProjectEstimateDraft, type ProjectEstimateSummary } from "@/app/actions/project-estimates"
import { createNuTechOrder, type NuTechOrderForEstimate } from "@/app/actions/nutech-orders"
import { useListSheetStartFilter } from "@/components/list-sheets/use-list-sheet"
import { RecordSearchInput, RecordTable, useRecordTable } from "@/components/record-table"
import { StatusFilterBar } from "@/components/status-filter-bar"
import { nuTechOrderStatusLabel } from "@/lib/nutech/workflow"
import { formatCents } from "@/lib/format"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

/** The newest version of each estimate number on the job, in number order. */
function latestEstimatePerNumber(estimates: readonly ProjectEstimateSummary[]): readonly ProjectEstimateSummary[] {
  const latest = new Map<string, ProjectEstimateSummary>()
  for (const estimate of estimates) {
    const current = latest.get(estimate.estimateNumber)
    if (!current || estimate.versionNumber > current.versionNumber) latest.set(estimate.estimateNumber, estimate)
  }
  return [...latest.values()].sort((a, b) => a.estimateNumber.localeCompare(b.estimateNumber))
}

/** The estimate workflow, in order: status filter buttons and status sort follow it. */
const OPEN_STATUSES: readonly string[] = ["draft", "internal_review", "signature_pending", "accepted"]

function statusLabel(status: string): string {
  return status.replaceAll("_", " ")
}

/** Workflow order for open statuses, then any other status by name. */
function statusSortValue(status: string): string {
  const index = OPEN_STATUSES.indexOf(status)
  return index >= 0 ? `0${index}` : `1${status}`
}

const rowId = (estimate: ProjectEstimateSummary): string => estimate.id

function estimateHref(projectId: string, estimate: ProjectEstimateSummary): string {
  return `/dashboard/projects/${projectId}/estimate?estimateId=${estimate.id}`
}

/** The sheet's columns; `nextStep` is only given on Nu-Tech jobs. */
export function estimateColumns(
  projectId: string,
  nextStep: ((estimate: ProjectEstimateSummary) => React.ReactElement) | null,
): ColumnDef<ProjectEstimateSummary>[] {
  const columns: ColumnDef<ProjectEstimateSummary>[] = [
    {
      id: "estimate",
      accessorFn: (row) => row.estimateNumber,
      header: "Estimate",
      size: 260,
      cell: ({ row: { original } }) => (
        <div>
          <Link href={estimateHref(projectId, original)} className="font-medium hover:underline">
            {original.title}
          </Link>
          <div className="font-mono text-xs text-muted-foreground">{original.estimateNumber}</div>
        </div>
      ),
    },
    {
      id: "version",
      accessorFn: (row) => row.versionNumber,
      header: "Version",
      size: 90,
      cell: ({ row }) => <span className="tabular-nums">v{row.original.versionNumber}</span>,
    },
    {
      id: "status",
      accessorFn: (row) => statusSortValue(row.status),
      header: "Status",
      size: 140,
      cell: ({ row }) => (
        <Badge variant={row.original.status === "accepted" ? "default" : "outline"}>{statusLabel(row.original.status)}</Badge>
      ),
    },
    {
      id: "total",
      accessorFn: (row) => row.estimateTotalCents,
      header: "Total",
      size: 120,
      cell: ({ row }) => <span className="block text-right tabular-nums">{formatCents(row.original.estimateTotalCents)}</span>,
    },
  ]
  if (nextStep) {
    columns.push({ id: "nextStep", header: "Next step", enableSorting: false, size: 220, cell: ({ row }) => nextStep(row.original) })
  }
  return columns
}

/**
 * Estimates on a job whose department allows several at once: one row per
 * estimate (its newest version), each opened, sent and accepted on its own.
 */
export function ProjectEstimateList({
  projectId,
  estimates,
  activeEstimateId,
  canEdit,
  orders,
}: {
  readonly projectId: string
  readonly estimates: readonly ProjectEstimateSummary[]
  readonly activeEstimateId: string | null
  readonly canEdit: boolean
  /** Nu-Tech jobs: the orders filling each estimate, for the Next step column. */
  readonly orders?: readonly NuTechOrderForEstimate[]
}): React.ReactElement {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const startFilter = useListSheetStartFilter("estimates.job", "open")
  // An older estimate opened from a link shows under All, so its row is on screen.
  const [chosenFilter, setFilter] = React.useState<string | null>(() => {
    const active = estimates.find((estimate) => estimate.id === activeEstimateId)
    return active && !OPEN_STATUSES.includes(active.status) ? "all" : null
  })
  const filter = chosenFilter ?? startFilter
  const [query, setQuery] = React.useState("")
  const rows = React.useMemo(() => latestEstimatePerNumber(estimates), [estimates])
  const open = rows.filter((row) => OPEN_STATUSES.includes(row.status))
  const accepted = rows.filter((row) => row.status === "accepted")

  const visibleRows = React.useMemo(() => {
    const term = query.trim().toLowerCase()
    return rows.filter((row) => {
      if (filter === "open" && !OPEN_STATUSES.includes(row.status)) return false
      if (filter !== "open" && filter !== "all" && row.status !== filter) return false
      return term === "" || `${row.title} ${row.estimateNumber} ${statusLabel(row.status)}`.toLowerCase().includes(term)
    })
  }, [rows, filter, query])

  const filterOptions = React.useMemo(() => {
    const statuses = [...new Set(rows.map((row) => row.status))].sort((a, b) => statusSortValue(a).localeCompare(statusSortValue(b)))
    return [
      { value: "open", label: "Open", count: rows.filter((row) => OPEN_STATUSES.includes(row.status)).length, pinned: true },
      ...statuses.map((status) => ({
        value: status,
        label: statusLabel(status).replace(/^./, (letter) => letter.toUpperCase()),
        count: rows.filter((row) => row.status === status).length,
      })),
      { value: "all", label: "All", count: rows.length, pinned: true },
    ]
  }, [rows])

  function newEstimate(): void {
    startTransition(async () => {
      const result = await createProjectEstimateDraft(projectId)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success("New estimate started.")
      router.push(`/dashboard/projects/${projectId}/estimate?estimateId=${result.id}`)
      router.refresh()
    })
  }

  const startOrder = React.useCallback((estimate: ProjectEstimateSummary): void => {
    startTransition(async () => {
      const result = await createNuTechOrder(projectId, { title: estimate.title, estimateId: estimate.id })
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success("Order started from this estimate. Add its products on the order page.")
      router.push(`/dashboard/projects/${projectId}/nutech?order=${encodeURIComponent(result.id)}`)
    })
  }, [projectId, router])

  /** What happens next for an estimate: the order filling it, or starting one once accepted. */
  const nextStep = React.useCallback((estimate: ProjectEstimateSummary): React.ReactElement => {
    const linked = (orders ?? []).filter((order) => order.estimateNumber === estimate.estimateNumber)
    if (linked.length > 0) {
      return (
        <span className="grid gap-0.5">
          {linked.map((order) => (
            <Link key={order.orderId} href={`/dashboard/projects/${projectId}/nutech?order=${encodeURIComponent(order.orderId)}`} className="hover:underline">
              Order {order.orderNumber} · {nuTechOrderStatusLabel(order.orderStatus)}
            </Link>
          ))}
        </span>
      )
    }
    if (estimate.status !== "accepted") return <span className="text-muted-foreground">When accepted</span>
    return (
      <span className="flex flex-wrap gap-2">
        {canEdit ? (
          <Button type="button" size="sm" variant="outline" onClick={() => startOrder(estimate)} disabled={pending}>
            Start order
          </Button>
        ) : null}
        <Button asChild size="sm" variant="ghost">
          <Link href={`/dashboard/projects/${projectId}/nutech#nutech-bracing`}>Bracing rental</Link>
        </Button>
      </span>
    )
  }, [orders, projectId, canEdit, pending, startOrder])

  const columns = React.useMemo(
    () => estimateColumns(projectId, orders ? nextStep : null),
    [projectId, orders, nextStep],
  )
  const table = useRecordTable({
    data: visibleRows,
    columns,
    getRowId: rowId,
    resetKey: `${filter}:${query}`,
    initialItemId: activeEstimateId,
    sheetId: "estimates.job",
  })

  return (
    <section aria-labelledby="job-estimates-heading" className="clarity-panel mb-5 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
        <div>
          <h2 id="job-estimates-heading" className="font-semibold">
            Estimates on this job
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {open.length} open · {accepted.length} accepted · each is sent and accepted on its own
          </p>
        </div>
        {canEdit ? (
          <Button type="button" size="sm" onClick={newEstimate} disabled={pending}>
            <IconPlus className="size-4" />
            {pending ? "Starting…" : "New estimate"}
          </Button>
        ) : null}
      </div>
      <div className="grid gap-3 px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <StatusFilterBar
            kind="button"
            label="Filter estimates by status"
            options={filterOptions}
            selected={filter}
            onSelect={setFilter}
          />
          <RecordSearchInput
            value={query}
            onChange={setQuery}
            label="Search estimates"
            placeholder="Search estimate name or number…"
            className="sm:max-w-xs"
          />
        </div>
        <RecordTable
          table={table}
          itemLabel="estimates"
          emptyMessage={query ? "No estimates match this search." : "No estimates in this view."}
          rowIdPrefix="job-estimate"
          focusedRowId={activeEstimateId}
          scrollToFocusedRow={false}
          getRowHref={(estimate) => estimateHref(projectId, estimate)}
        />
      </div>
    </section>
  )
}
