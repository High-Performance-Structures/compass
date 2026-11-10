"use client"

import * as React from "react"
import { toast } from "sonner"

import { getSageCostCodeSyncStatus, refreshSageCostCodes, type SageCostCodeSyncStatus } from "@/app/actions/sage-cost-codes"
import { Button } from "@/components/ui/button"
import { formatDateTime } from "@/lib/format"

/** Settings → Workflows → Sage export: the cost code list read from Sage, and a manual refresh. */
export function SageCostCodeSyncSection(): React.ReactElement {
  const [status, setStatus] = React.useState<SageCostCodeSyncStatus | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [pending, startTransition] = React.useTransition()

  const load = React.useCallback(() => {
    void getSageCostCodeSyncStatus().then((result) => {
      if (result.success) {
        setStatus(result.data)
        setError(null)
      } else {
        setError(result.error)
      }
    })
  }, [])

  React.useEffect(() => load(), [load])

  function refresh(): void {
    startTransition(async () => {
      const result = await refreshSageCostCodes()
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success("Compass will read the cost codes from Sage within a few minutes.")
      load()
    })
  }

  const waiting = Boolean(status?.refreshRequestedAt && (!status.lastSyncedAt || status.refreshRequestedAt > status.lastSyncedAt))
  return (
    <section aria-labelledby="sage-cost-code-sync" className="space-y-3 border-b pb-6">
      <div>
        <h2 id="sage-cost-code-sync" className="text-base font-semibold">Cost codes from Sage</h2>
        <p className="text-sm text-muted-foreground">
          Compass reads the cost code list from Sage every hour, so new and renamed Sage cost codes show up in estimates, budgets and orders.
          Codes removed from Sage stay on older records but are no longer offered.
        </p>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {!status && !error ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
      {status ? (
        <div className="space-y-2 text-sm">
          <p>
            {status.lastSyncedAt ? `Last read from Sage ${formatDateTime(status.lastSyncedAt)}.` : "Not read from Sage yet."}{" "}
            {status.activeFromSage > 0 ? `${status.activeFromSage} active codes from Sage` : null}
            {status.inactive > 0 ? `, ${status.inactive} no longer in Sage.` : status.activeFromSage > 0 ? "." : null}
          </p>
          {waiting ? <p className="text-muted-foreground">Refresh requested; waiting for the Sage reader.</p> : null}
          {status.available && !status.readerRunning ? (
            <p className="text-destructive">The Sage reader hasn&apos;t checked in recently, so a refresh may not run until it&apos;s back.</p>
          ) : null}
          {status.available ? (
            <Button type="button" size="sm" variant="outline" disabled={pending} onClick={refresh}>
              Refresh from Sage
            </Button>
          ) : (
            <p className="text-muted-foreground">Sage isn&apos;t connected for this company.</p>
          )}
        </div>
      ) : null}
    </section>
  )
}
