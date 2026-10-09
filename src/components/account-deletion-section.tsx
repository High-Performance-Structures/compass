"use client"

import * as React from "react"
import Link from "next/link"
import { toast } from "sonner"

import {
  cancelAccountDeletionRequest,
  getAccountDeletionRequest,
  requestAccountDeletion,
  type AccountDeletionRequestState,
} from "@/app/actions/profile"
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
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

export function AccountDeletionSection(): React.ReactElement {
  const [deletionRequest, setDeletionRequest] =
    React.useState<AccountDeletionRequestState | null>(null)
  const [statusLoading, setStatusLoading] = React.useState(true)
  const [confirmation, setConfirmation] = React.useState("")
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [actionLoading, setActionLoading] = React.useState(false)

  React.useEffect(() => {
    let cancelled = false
    void getAccountDeletionRequest().then((result) => {
      if (cancelled) return
      setStatusLoading(false)
      if (result.success) {
        setDeletionRequest(result.data ?? null)
      } else {
        toast.error(result.error)
      }
    })
    return () => {
      cancelled = true
    }
  }, [])

  async function handleRequestDeletion(): Promise<void> {
    setActionLoading(true)
    const result = await requestAccountDeletion(confirmation)
    setActionLoading(false)
    if (!result.success) {
      toast.error(result.error)
      return
    }

    setDeletionRequest(result.data ?? null)
    setConfirmation("")
    setDialogOpen(false)
    toast.success("Account deletion request submitted")
  }

  async function handleCancelDeletion(): Promise<void> {
    setActionLoading(true)
    const result = await cancelAccountDeletionRequest()
    setActionLoading(false)
    if (!result.success) {
      toast.error(result.error)
      return
    }

    setDeletionRequest(null)
    toast.success("Account deletion request cancelled")
  }

  return (
    <div className="space-y-3">
      <h2 className="text-destructive text-xs font-semibold uppercase">
        Delete Account
      </h2>
      {statusLoading ? (
        <p className="text-muted-foreground text-xs">
          Loading deletion request status...
        </p>
      ) : deletionRequest ? (
        <div className="space-y-2">
          <p className="text-sm">
            Your account deletion request is {deletionRequest.status}.
          </p>
          <p className="text-muted-foreground text-xs leading-5">
            Requested {new Date(deletionRequest.requestedAt).toLocaleDateString()}.
            Compass will complete the review within 30 days and retain only
            records required for contractual, security, or legal purposes.
          </p>
          {deletionRequest.status === "pending" && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void handleCancelDeletion()}
              disabled={actionLoading}
            >
              {actionLoading ? "Cancelling..." : "Cancel request"}
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-muted-foreground text-xs leading-5">
            Request deletion of your Compass account and associated personal
            data. Project and financial records that must be retained will be
            de-identified where possible.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={() => setDialogOpen(true)}
              disabled={actionLoading}
            >
              Request account deletion
            </Button>
            <Link
              href="/account-deletion"
              className="text-muted-foreground text-xs underline underline-offset-4"
            >
              Learn about deletion
            </Link>
          </div>
        </div>
      )}

      <AlertDialog
        open={dialogOpen}
        onOpenChange={(nextOpen) => {
          setDialogOpen(nextOpen)
          if (!nextOpen) setConfirmation("")
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Request account deletion?</AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <span className="block">
                This starts permanent deletion of your Compass account and
                removable personal data. Access remains active while the request
                is reviewed, and you may cancel until processing begins.
              </span>
              <span className="block">Type DELETE to confirm.</span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Input
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            aria-label="Type DELETE to confirm account deletion"
            autoComplete="off"
          />
          <AlertDialogFooter>
            <AlertDialogCancel disabled={actionLoading}>
              Keep account
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault()
                void handleRequestDeletion()
              }}
              disabled={confirmation.trim() !== "DELETE" || actionLoading}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {actionLoading ? "Submitting..." : "Submit request"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
