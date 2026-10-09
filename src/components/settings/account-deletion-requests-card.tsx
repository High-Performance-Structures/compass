"use client"

import * as React from "react"
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

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

  const refresh = React.useCallback(() => {
    void getAccountDeletionRequestsForAdmin().then(setRequests)
  }, [])

  React.useEffect(() => {
    refresh()
  }, [refresh])

  if (requests === null) return null

  async function handleStart(request: AdminAccountDeletionRequest) {
    setBusyId(request.id)
    const result = await startAccountDeletionProcessing(request.id)
    setBusyId(null)
    if (!result.success) {
      toast.error(result.error)
      return
    }
    toast.success("Processing started. The person can no longer cancel.")
    refresh()
  }

  async function handleComplete() {
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
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Person</TableHead>
              <TableHead>Requested</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {requests.map((request) => (
              <TableRow key={request.id}>
                <TableCell>
                  <div className="text-sm">{personLabel(request)}</div>
                  {request.status !== "completed" &&
                    request.email &&
                    request.displayName && (
                      <div className="text-xs text-muted-foreground">
                        {request.email}
                      </div>
                    )}
                </TableCell>
                <TableCell className="text-sm">
                  {formatDate(request.requestedAt)}
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className="rounded-[4px]">
                    {STATUS_LABELS[request.status]}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  {request.status === "pending" && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={busyId !== null}
                      onClick={() => void handleStart(request)}
                    >
                      {busyId === request.id ? "Starting..." : "Start processing"}
                    </Button>
                  )}
                  {request.status === "processing" && (
                    <Button
                      type="button"
                      size="sm"
                      variant="destructive"
                      disabled={busyId !== null}
                      onClick={() => setCompleting(request)}
                    >
                      Delete account
                    </Button>
                  )}
                  {request.status === "completed" && (
                    <span className="text-xs text-muted-foreground">
                      {formatDate(request.completedAt)}
                    </span>
                  )}
                  {request.status === "cancelled" && (
                    <span className="text-xs text-muted-foreground">
                      {formatDate(request.cancelledAt)}
                    </span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
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
