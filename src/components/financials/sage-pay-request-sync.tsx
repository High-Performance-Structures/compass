"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { IconRefresh } from "@tabler/icons-react"

import {
  getSagePayRequestSyncStatus,
  requestSagePayRequestSync,
  type SagePayRequestPanel,
} from "@/app/actions/sage-pay-requests"
import { Button } from "@/components/ui/button"
import { useVisibleInterval } from "@/hooks/use-visible-interval"
import { formatDateTime } from "@/lib/format"

const ACTIVE = new Set(["queued", "running", "processing"])
const POLL_MS = 10_000

type Run = SagePayRequestPanel["latestRun"]

function runText(run: Run): string | null {
  if (!run) return "Not synced with Sage yet."
  if (ACTIVE.has(run.status)) return "Reading the progress billing from Sage. This usually takes a minute or two."
  const when = formatDateTime(run.completedAt ?? run.requestedAt)
  if (run.status === "completed") return `Last synced from Sage ${when}.`
  if (run.status === "needs_review") return `Sage's billing totals didn't add up at ${when}, so it wasn't synced. Check the billing in Sage, then sync again.`
  return `The last sync didn't finish (${when})${run.errorMessage ? `: ${run.errorMessage}` : "."}`
}

/**
 * "Sync with Sage" for a company whose pay requests are created in Sage: the
 * job's latest progress billing becomes (or updates) the Compass pay request.
 * Follows the read until it finishes, then refreshes the page.
 */
export function SagePayRequestSyncButton({
  projectId,
  panel,
}: {
  readonly projectId: string
  readonly panel: SagePayRequestPanel
}): React.ReactElement {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [run, setRun] = useState<Run>(panel.latestRun)
  const [message, setMessage] = useState<string | null>(null)
  const active = run !== null && ACTIVE.has(run.status)

  useVisibleInterval(
    () => {
      void getSagePayRequestSyncStatus(projectId).then((result) => {
        if (!result.success) return
        setRun(result.data)
        if (!result.data || !ACTIVE.has(result.data.status)) router.refresh()
      })
    },
    POLL_MS,
    { enabled: active, immediate: false }
  )

  function sync(): void {
    setMessage(null)
    startTransition(async () => {
      const result = await requestSagePayRequestSync(projectId)
      if (!result.success) {
        setMessage(result.error)
        return
      }
      setMessage(result.data.note)
      setRun({ status: "queued", requestedAt: new Date().toISOString(), completedAt: null, errorMessage: null })
      router.refresh()
    })
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button type="button" variant="outline" onClick={sync} disabled={isPending || active || !panel.canSync}>
        <IconRefresh className="size-4" />
        Sync with Sage
      </Button>
      <p className="text-sm text-muted-foreground">{message ?? panel.unavailableReason ?? runText(run)}</p>
    </div>
  )
}

/** The pay request area's Sage section, for a company whose pay requests are created in Sage. */
export function SagePayRequestsPanel({
  projectId,
  panel,
}: {
  readonly projectId: string
  readonly panel: SagePayRequestPanel
}): React.ReactElement {
  return (
    <section aria-labelledby="sage-pay-requests" className="clarity-panel space-y-2 px-4 py-3">
      <h2 id="sage-pay-requests" className="font-semibold">Pay requests from Sage</h2>
      <p className="text-sm text-muted-foreground">
        Build the progress billing in Sage, then sync. Compass makes it this job&apos;s pay request for review, owner approval, email and
        payments, with the billed amounts as Sage has them.
      </p>
      <SagePayRequestSyncButton projectId={projectId} panel={panel} />
    </section>
  )
}
