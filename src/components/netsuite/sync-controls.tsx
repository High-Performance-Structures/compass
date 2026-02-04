"use client"

import * as React from "react"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import {
  syncCustomers,
  syncVendors,
} from "@/app/actions/netsuite-sync"
import { toast } from "sonner"

export function SyncControls() {
  const [syncing, setSyncing] = React.useState<string | null>(null)

  const handleSync = async (
    type: string,
    action: () => Promise<{
      success: boolean
      error?: string
      pulled?: number
      created?: number
      updated?: number
    }>
  ) => {
    setSyncing(type)
    const result = await action()

    if (result.success) {
      toast.success(
        `Synced ${type}: ${result.pulled ?? 0} pulled, ${result.created ?? 0} created, ${result.updated ?? 0} updated`
      )
    } else {
      toast.error(result.error ?? "Sync failed")
    }
    setSyncing(null)
  }

  return (
    <div className="space-y-3">
      <p className="text-muted-foreground text-sm">
        Manually trigger a sync for each record type.
        Delta sync runs automatically every 15 minutes.
      </p>

      <Separator />

      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={syncing !== null}
          onClick={() => handleSync("customers", syncCustomers)}
        >
          {syncing === "customers" ? "Syncing..." : "Sync Customers"}
        </Button>

        <Button
          variant="outline"
          size="sm"
          disabled={syncing !== null}
          onClick={() => handleSync("vendors", syncVendors)}
        >
          {syncing === "vendors" ? "Syncing..." : "Sync Vendors"}
        </Button>
      </div>
    </div>
  )
}
