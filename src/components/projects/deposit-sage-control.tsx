"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { IconAlertTriangle, IconRefresh, IconSend } from "@tabler/icons-react"
import { toast } from "sonner"

import { sendProjectDepositToSage, type DepositSageRow } from "@/app/actions/project-deposit-sage"
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
import { useVisibleInterval } from "@/hooks/use-visible-interval"

/*
 * A deposit request's Sage AR invoice (<job>-DEP1): its state, why it can't
 * go yet, and Send to Sage for office staff with finance access.
 */

const SAGE_LABELS: Readonly<Record<string, string>> = {
  queued: "Queued for Sage",
  running: "Sending to Sage",
  succeeded: "In Sage",
  failed: "Sage didn't take it",
  needs_attention: "Sage: needs attention",
  cancelled: "Not in Sage",
}

const SENDING_REFRESH_MS = 10_000

export function DepositSageControl({
  projectId,
  depositId,
  row,
  writesEnabled,
}: {
  readonly projectId: string
  readonly depositId: string
  readonly row: DepositSageRow
  readonly writesEnabled: boolean
}): React.ReactElement {
  const router = useRouter()
  const [pending, startTransition] = React.useTransition()
  const [confirm, setConfirm] = React.useState(false)
  const status = row.export?.status ?? null
  const sending = status === "queued" || status === "running"
  const attention = status === "needs_attention" || status === "failed"
  useVisibleInterval(() => router.refresh(), SENDING_REFRESH_MS, { enabled: sending, immediate: false })
  const canSend = writesEnabled && (status === null || status === "cancelled" || attention)

  function send(): void {
    startTransition(async () => {
      const result = await sendProjectDepositToSage(projectId, depositId)
      setConfirm(false)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      if (result.data.status === "needs_attention") toast.warning(result.data.reason ?? "The Sage invoice needs attention.")
      else toast.success("Sent to Sage. This updates when Sage finishes.")
      router.refresh()
    })
  }

  return (
    <div className="flex w-full flex-col gap-1 sm:w-auto sm:items-end">
      <div className="flex flex-wrap items-center gap-2">
        {status ? (
          <Badge variant={attention ? "destructive" : status === "succeeded" ? "secondary" : "outline"} className="gap-1">
            {sending ? <IconRefresh className="size-3.5 animate-spin" aria-hidden /> : null}
            {attention ? <IconAlertTriangle className="size-3.5" aria-hidden /> : null}
            {SAGE_LABELS[status] ?? status}
            {status === "succeeded" ? ` ${row.export?.invoiceNumber ?? ""}` : ""}
          </Badge>
        ) : null}
        {canSend ? (
          <Button type="button" size="sm" variant={attention ? "default" : "outline"} disabled={pending} onClick={() => setConfirm(true)}>
            <IconSend className="size-4" aria-hidden />
            {attention ? "Retry Sage" : "Send to Sage"}
          </Button>
        ) : null}
      </div>
      {attention && row.export?.errorMessage ? <p className="text-xs text-destructive">{row.export.errorMessage}</p> : null}
      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Send deposit request {row.invoiceNumber || ""} to Sage?</AlertDialogTitle>
            <AlertDialogDescription>
              Sage adds it as its own AR invoice on the company&apos;s deposit account and posts it as soon as it saves it. Payments are not sent to Sage.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {row.blockers.length > 0 ? (
            <ul className="list-disc space-y-1 pl-5 text-sm text-destructive">
              {row.blockers.map((blocker) => (
                <li key={blocker}>{blocker}</li>
              ))}
            </ul>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={pending || row.blockers.length > 0} onClick={(event) => { event.preventDefault(); send() }}>
              Send to Sage
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
