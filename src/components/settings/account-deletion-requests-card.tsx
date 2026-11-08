"use client"

import * as React from "react"
import type { ColumnDef } from "@tanstack/react-table"
import { toast } from "sonner"

import {
  completeAccountDeletion,
  getAccountDeletionRequestsForAdmin,
  startAccountDeletionProcessing,
  type AdminAccountDeletionRequest,
} from "@/app/actions/account-deletion-admin"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useListSheetFilterLabel, useListSheetStartFilter } from "@/components/list-sheets/use-list-sheet"
import { RecordTable, useRecordTable } from "@/components/record-table"
import { StatusFilterBar } from "@/components/status-filter-bar"

const STATUS_LABELS: Record<AdminAccountDeletionRequest["status"], string> = {
  pending: "Pending",
  processing: "Processing",
  completed: "Deleted",
  cancelled: "Cancelled",
}

function formatDate(value: string | null): string {
  return value ? new Date(value).toLocaleDateString() : "—"
}

function personLabel(request: AdminAccountDeletionRequest): string {
  if (request.status === "completed") return "Deleted user"
  return request.displayName ?? request.email ?? "Unknown user"
}

type RequestFilter = "open" | AdminAccountDeletionRequest["status"] | "all"

const SHEET_ID = "settings.account-deletion-requests"

const REQUEST_FILTERS: readonly { readonly value: RequestFilter; readonly label: string; readonly pinned?: boolean }[] = [
  { value: "open", label: "Open", pinned: true },
  { value: "pending", label: STATUS_LABELS.pending },
  { value: "processing", label: STATUS_LABELS.processing },
  { value: "completed", label: STATUS_LABELS.completed },
  { value: "cancelled", label: STATUS_LABELS.cancelled },
  { value: "all", label: "All", pinned: true },
]

/** Open requests still need an admin: pending or processing. */
function matchesFilter(request: AdminAccountDeletionRequest, filter: RequestFilter): boolean {
  if (filter === "all") return true
  if (filter === "open") return request.status === "pending" || request.status === "processing"
  return request.status === filter
}

function isRequestFilter(value: string): value is RequestFilter {
  return REQUEST_FILTERS.some((option) => option.value === value)
}

/** The date in the Action column once a request is closed. */
function closedDate(request: AdminAccountDeletionRequest): string | null {
  if (request.status === "completed") return request.completedAt
  if (request.status === "cancelled") return request.cancelledAt
  return null
}

const STATUS_ORDER: Record<AdminAccountDeletionRequest["status"], number> = {
  pending: 0,
  processing: 1,
  completed: 2,
  cancelled: 3,
}

type RequestActions = {
  readonly busyId: string | null
  readonly onStart: (request: AdminAccountDeletionRequest) => void
  readonly onComplete: (request: AdminAccountDeletionRequest) => void
}

/** The deletion request sheet's columns ("settings.account-deletion-requests" in the list sheet registry). */
export function accountDeletionRequestColumns(actions: RequestActions): ColumnDef<AdminAccountDeletionRequest>[] {
  const { busyId, onStart, onComplete } = actions
  return [
    {
      id: "person",
      header: "Person",
      accessorFn: (request) => personLabel(request),
      cell: ({ row }) => {
        const request = row.original
        return (
          <>
            <div className="text-sm">{personLabel(request)}</div>
            {request.status !== "completed" && request.email && request.displayName && (
              <div className="text-xs text-muted-foreground">{request.email}</div>
            )}
          </>
        )
      },
    },
    {
      id: "requested",
      header: "Requested",
      accessorFn: (request) => request.requestedAt,
      cell: ({ row }) => <span className="text-sm">{formatDate(row.original.requestedAt)}</span>,
    },
    {
      id: "status",
      header: "Status",
      accessorFn: (request) => STATUS_ORDER[request.status],
      cell: ({ row }) => (
        <Badge variant="outline" className="rounded-[4px]">
          {STATUS_LABELS[row.original.status]}
        </Badge>
      ),
    },
    {
      id: "actions",
      header: () => <span className="block text-right">Action</span>,
      enableSorting: false,
      cell: ({ row }) => {
        const request = row.original
        return (
          <div className="text-right">
            {request.status === "pending" && (
              <Button type="button" size="sm" variant="outline" disabled={busyId !== null} onClick={() => onStart(request)}>
                {busyId === request.id ? "Starting..." : "Start processing"}
              </Button>
            )}
            {request.status === "processing" && (
              <Button type="button" size="sm" variant="destructive" disabled={busyId !== null} onClick={() => onComplete(request)}>
                Delete account
              </Button>
            )}
            {request.status === "completed" || request.status === "cancelled" ? (
              <span className="text-xs text-muted-foreground">{formatDate(closedDate(request))}</span>
            ) : null}
          </div>
        )
      },
    },
  ]
}

const requestRowId = (request: AdminAccountDeletionRequest): string => request.id

/**
 * Admin queue for account deletion requests. Renders nothing for people who
 * can't manage them.
 */
export function AccountDeletionRequestsCard(): React.ReactElement | null {
  const [requests, setRequests] = React.useState<
    readonly AdminAccountDeletionRequest[] | null
  >(null)
  const [busyId, setBusyId] = React.useState<string | null>(null)
  const [completing, setCompleting] =
    React.useState<AdminAccountDeletionRequest | null>(null)
  const [confirmation, setConfirmation] = React.useState("")
  const startFilter = useListSheetStartFilter(SHEET_ID, "open")
  const [filter, setFilter] = React.useState<RequestFilter>(isRequestFilter(startFilter) ? startFilter : "open")

  const refresh = React.useCallback(() => {
    void getAccountDeletionRequestsForAdmin().then(setRequests)
  }, [])

  React.useEffect(() => {
    refresh()
  }, [refresh])

  const handleStart = React.useCallback(async (request: AdminAccountDeletionRequest): Promise<void> => {
    setBusyId(request.id)
    const result = await startAccountDeletionProcessing(request.id)
    setBusyId(null)
    if (!result.success) {
      toast.error(result.error)
      return
    }
    toast.success("Processing started. The person can no longer cancel.")
    refresh()
  }, [refresh])

  const columns = React.useMemo(
    () => accountDeletionRequestColumns({ busyId, onStart: (request) => void handleStart(request), onComplete: setCompleting }),
    [busyId, handleStart],
  )
  const visible = React.useMemo(
    () => (requests ?? []).filter((request) => matchesFilter(request, filter)),
    [requests, filter],
  )
  const filterLabel = useListSheetFilterLabel("settings.account-deletion-requests")
  const table = useRecordTable({
    data: visible,
    columns,
    getRowId: requestRowId,
    resetKey: filter,
    sheetId: "settings.account-deletion-requests",
  })

  if (requests === null) return null

  async function handleComplete(): Promise<void> {
    if (!completing) return
    setBusyId(completing.id)
    const result = await completeAccountDeletion(completing.id, confirmation)
    setBusyId(null)
    if (!result.success) {
      toast.error(result.error)
      return
    }
    setCompleting(null)
    setConfirmation("")
    toast.success("Account deleted")
    refresh()
  }

  return (
    <section className="space-y-3 border-t pt-6">
      <div className="space-y-1">
        <h3 className="text-sm font-semibold">Account deletion requests</h3>
        <p className="text-xs text-muted-foreground">
          Requests must be completed within 30 days. Before completing one,
          check whether any of the person&apos;s records must be kept for
          contracts, finances or legal reasons.
        </p>
      </div>

      {requests.length === 0 ? (
        <p className="text-sm text-muted-foreground">No requests.</p>
      ) : (
        <div className="flex min-w-0 flex-col gap-3">
          <StatusFilterBar
            kind="button"
            label="Filter account deletion requests by status"
            selected={filter}
            onSelect={setFilter}
            options={REQUEST_FILTERS.map((option) => ({
              ...option,
              label: filterLabel(option.value, option.label),
              count: requests.filter((request) => matchesFilter(request, option.value)).length,
            }))}
          />
          <RecordTable
            table={table}
            itemLabel="account deletion requests"
            emptyMessage="No requests with this status."
            rowIdPrefix="account-deletion-request"
          />
        </div>
      )}

      <AlertDialog
        open={completing !== null}
        onOpenChange={(open) => {
          if (!open) {
            setCompleting(null)
            setConfirmation("")
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {completing ? personLabel(completing) : "this account"}?
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <span className="block">
                This deletes their sign-in, device tokens, notification and
                schedule preferences, AI chats and memories, API keys, email
                drafts and other personal settings. Their name, email, phone,
                address and photos are removed from their profile.
              </span>
              <span className="block">
                Projects, financial records and history they worked on are
                kept and will show &ldquo;Deleted user&rdquo;. This cannot be
                undone.
              </span>
              <span className="block">Type DELETE to confirm.</span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Input
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            aria-label="Type DELETE to confirm deleting this account"
            autoComplete="off"
          />
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busyId !== null}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault()
                void handleComplete()
              }}
              disabled={confirmation.trim() !== "DELETE" || busyId !== null}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {busyId !== null ? "Deleting..." : "Delete account"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}
