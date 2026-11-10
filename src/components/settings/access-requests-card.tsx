"use client"

/*
 * Settings > People > Access requests: the admin queue of people who asked
 * to join this company from the Request access page. Review opens
 * AccessRequestReviewDialog, where the request is linked to a directory
 * record and approved or declined.
 */
import * as React from "react"
import type { ColumnDef } from "@tanstack/react-table"

import { getCompanyAccessRequests } from "@/app/actions/access-requests"
import { AccessRequestReviewDialog } from "@/components/settings/access-request-review-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { useListSheetFilterLabel, useListSheetStartFilter } from "@/components/list-sheets/use-list-sheet"
import { RecordTable, useRecordTable } from "@/components/record-table"
import { StatusFilterBar } from "@/components/status-filter-bar"
import type { CompanyAccessRequest } from "@/lib/domain/access-requests/queries"
import { ACCESS_REQUEST_KIND_LABELS } from "@/lib/domain/access-requests/rules"
import type { AccessRequestStatus } from "@/lib/domain/access-requests/statuses"
import { formatDate } from "@/lib/format"
import { userRoleLabel } from "@/lib/user-roles"

const SHEET_ID = "settings.access-requests"

const STATUS_LABELS: Record<AccessRequestStatus, string> = {
  pending: "Waiting",
  approved: "Approved",
  declined: "Declined",
  withdrawn: "Withdrawn",
}

type RequestFilter = AccessRequestStatus | "all"

const REQUEST_FILTERS: readonly { readonly value: RequestFilter; readonly label: string; readonly pinned?: boolean }[] = [
  { value: "pending", label: STATUS_LABELS.pending, pinned: true },
  { value: "approved", label: STATUS_LABELS.approved },
  { value: "declined", label: STATUS_LABELS.declined },
  { value: "withdrawn", label: STATUS_LABELS.withdrawn },
  { value: "all", label: "All", pinned: true },
]

function isRequestFilter(value: string): value is RequestFilter {
  return REQUEST_FILTERS.some((option) => option.value === value)
}

/** One line under the status: who decided and what an approval gave. */
function decisionLine(request: CompanyAccessRequest): string | null {
  if (request.status === "pending") return null
  const who = request.decidedByName ? ` by ${request.decidedByName}` : ""
  const when = request.decidedAt ? ` ${formatDate(request.decidedAt)}` : ""
  if (request.status !== "approved") return `${who}${when}`.trim() || null
  const role = request.grantedRole ? `${userRoleLabel(request.grantedRole)}` : ""
  const jobs = request.grantedProjectCount ? `, ${request.grantedProjectCount} job${request.grantedProjectCount === 1 ? "" : "s"}` : ""
  return `${role}${jobs}${who}${when}`.trim()
}

/** The access request sheet's columns ("settings.access-requests" in the list sheet registry). */
export function accessRequestColumns(onReview: (request: CompanyAccessRequest) => void): ColumnDef<CompanyAccessRequest>[] {
  return [
    {
      id: "person",
      header: "Person",
      accessorFn: (request) => request.requesterName,
      cell: ({ row }) => {
        const request = row.original
        return (
          <>
            <div className="text-sm">{request.requesterName}</div>
            <div className="text-xs text-muted-foreground">{request.requesterEmail}</div>
            {request.phone ? <div className="text-xs text-muted-foreground tabular-nums">{request.phone}</div> : null}
          </>
        )
      },
    },
    {
      id: "kind",
      header: "I am a",
      accessorFn: (request) => ACCESS_REQUEST_KIND_LABELS[request.kind],
      cell: ({ row }) => (
        <>
          <div className="text-sm">{ACCESS_REQUEST_KIND_LABELS[row.original.kind]}</div>
          {row.original.companyName ? <div className="text-xs text-muted-foreground">{row.original.companyName}</div> : null}
        </>
      ),
    },
    {
      id: "details",
      header: "Job or note",
      accessorFn: (request) => request.jobReference ?? request.note ?? "",
      cell: ({ row }) => (
        <div className="max-w-xs space-y-0.5">
          {row.original.jobReference ? <div className="text-sm">{row.original.jobReference}</div> : null}
          {row.original.note ? <div className="line-clamp-2 text-xs text-muted-foreground">{row.original.note}</div> : null}
          {row.original.linkedPerson ? <div className="text-xs text-muted-foreground">Linked to {row.original.linkedPerson}</div> : null}
        </div>
      ),
    },
    {
      id: "requested",
      header: "Requested",
      accessorFn: (request) => request.createdAt,
      cell: ({ row }) => <span className="text-sm tabular-nums">{formatDate(row.original.createdAt)}</span>,
    },
    {
      id: "status",
      header: "Status",
      accessorFn: (request) => STATUS_LABELS[request.status],
      cell: ({ row }) => {
        const line = decisionLine(row.original)
        return (
          <>
            <Badge variant="outline" className="rounded-[4px]">{STATUS_LABELS[row.original.status]}</Badge>
            {line ? <div className="mt-1 text-xs text-muted-foreground">{line}</div> : null}
          </>
        )
      },
    },
    {
      id: "actions",
      header: () => <span className="block text-right">Action</span>,
      enableSorting: false,
      cell: ({ row }) =>
        row.original.status === "pending" ? (
          <div className="text-right">
            <Button type="button" size="sm" variant="outline" onClick={() => onReview(row.original)}>
              Review
            </Button>
          </div>
        ) : null,
    },
  ]
}

const requestRowId = (request: CompanyAccessRequest): string => request.id

/** The admin queue. Shows a short message to people who can't review requests. */
export function AccessRequestsCard(): React.ReactElement {
  const [requests, setRequests] = React.useState<readonly CompanyAccessRequest[] | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [reviewing, setReviewing] = React.useState<CompanyAccessRequest | null>(null)
  const startFilter = useListSheetStartFilter(SHEET_ID, "pending")
  const [filter, setFilter] = React.useState<RequestFilter>(isRequestFilter(startFilter) ? startFilter : "pending")
  const filterLabel = useListSheetFilterLabel("settings.access-requests")

  const refresh = React.useCallback(() => {
    void getCompanyAccessRequests().then((result) => {
      if (result.success) {
        setRequests(result.data)
        setError(null)
      } else {
        setError(result.error)
      }
    })
  }, [])

  React.useEffect(() => {
    refresh()
  }, [refresh])

  const columns = React.useMemo(() => accessRequestColumns(setReviewing), [])
  const visible = React.useMemo(
    () => (requests ?? []).filter((request) => filter === "all" || request.status === filter),
    [requests, filter],
  )
  const table = useRecordTable({
    data: visible,
    columns,
    getRowId: requestRowId,
    resetKey: filter,
    sheetId: "settings.access-requests",
  })

  return (
    <section aria-labelledby="access-requests-heading" className="space-y-3">
      <div className="space-y-1">
        <h2 id="access-requests-heading" className="text-base font-semibold">Access requests</h2>
        <p className="text-sm text-muted-foreground">
          People who signed up and asked to join this company. Link each one to their client, vendor or staff record, then approve
          or decline. Nothing is shared until you approve.
        </p>
      </div>
      {error ? <p className="text-sm text-muted-foreground">{error}</p> : null}
      {requests === null && !error ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
      {requests !== null ? (
        <div className="flex min-w-0 flex-col gap-3">
          <StatusFilterBar
            kind="button"
            label="Filter access requests by status"
            selected={filter}
            onSelect={setFilter}
            options={REQUEST_FILTERS.map((option) => ({
              ...option,
              label: filterLabel(option.value, option.label),
              count: option.value === "all" ? requests.length : requests.filter((request) => request.status === option.value).length,
            }))}
          />
          <RecordTable
            table={table}
            itemLabel="access requests"
            emptyMessage={filter === "pending" ? "No one is waiting for access." : "No requests with this status."}
            rowIdPrefix="access-request"
          />
        </div>
      ) : null}
      <AccessRequestReviewDialog
        request={reviewing}
        onOpenChange={(open) => {
          if (!open) setReviewing(null)
        }}
        onDecided={() => {
          setReviewing(null)
          refresh()
        }}
      />
    </section>
  )
}
