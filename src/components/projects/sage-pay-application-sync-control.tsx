"use client"

import {
  IconAlertTriangle,
  IconCheck,
  IconClock,
  IconRefresh,
} from "@tabler/icons-react"
import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"

import {
  queueSagePayApplicationSync,
  type SagePayApplicationSyncState,
} from "@/app/actions/sage-pay-applications"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

function dateTime(value: string | null): string {
  if (!value) return "Not yet"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}

function statusBadge(
  status: SagePayApplicationSyncState["latest"]
): React.ReactElement {
  if (!status) return <Badge variant="outline">Never synced</Badge>
  if (status.status === "completed") {
    return (
      <Badge
        variant="outline"
        className="gap-1 border-emerald-300 text-emerald-700"
      >
        <IconCheck className="size-3" />
        Synced
      </Badge>
    )
  }
  if (
    status.status === "queued" ||
    status.status === "running" ||
    status.status === "processing"
  ) {
    return (
      <Badge
        variant="outline"
        className="gap-1 border-blue-300 text-blue-700"
      >
        <IconClock className="size-3" />
        {status.status === "queued"
          ? "Queued"
          : status.status === "processing"
            ? "Importing"
            : "Reading Sage"}
      </Badge>
    )
  }
  return (
    <Badge
      variant="outline"
      className="gap-1 border-amber-300 text-amber-700"
    >
      <IconAlertTriangle className="size-3" />
      {status.status === "needs_review" ? "Needs review" : "Failed"}
    </Badge>
  )
}

export function SagePayApplicationSyncControl({
  projectId,
  state,
}: {
  readonly projectId: string
  readonly state: SagePayApplicationSyncState
}): React.ReactElement {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [message, setMessage] = useState<string | null>(null)
  const active =
    state.latest?.status === "queued" ||
    state.latest?.status === "running" ||
    state.latest?.status === "processing"
  const disabled =
    isPending ||
    active ||
    !state.configured ||
    !state.online ||
    !state.canRequest ||
    !state.projectMapped

  function queueSync(): void {
    setMessage(null)
    startTransition(async () => {
      const result = await queueSagePayApplicationSync(projectId)
      setMessage(
        result.success
          ? result.reused
            ? "A read sync is already in progress."
            : "Sage pay application read queued."
          : result.error
      )
      router.refresh()
    })
  }

  return (
    <section className="mb-6 border-y py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold">
              Sage pay application sync
            </h2>
            {statusBadge(state.latest)}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Read-only import. New Sage data stays internal until separately
            reviewed and published.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Latest finished: {dateTime(state.latest?.completedAt ?? null)}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={queueSync}
        >
          <IconRefresh
            className={`mr-1.5 size-4 ${isPending ? "animate-spin" : ""}`}
          />
          {active ? "Sync in progress" : "Sync with Sage"}
        </Button>
      </div>

      {!state.projectMapped && (
        <p className="mt-2 text-xs text-amber-700">
          Add the Sage job mapping in Project Registry before syncing.
        </p>
      )}
      {!state.configured && (
        <p className="mt-2 text-xs text-amber-700">
          The private read-only Sage bridge still needs its shared secret and
          poller enabled.
        </p>
      )}
      {state.configured && !state.online && (
        <p className="mt-2 text-xs text-amber-700">
          The private Sage poller is offline or has not checked in recently.
        </p>
      )}
      {state.latest?.errorMessage && (
        <p className="mt-2 text-xs text-destructive">
          {state.latest.errorMessage}
        </p>
      )}
      {message && (
        <p className="mt-2 text-xs text-muted-foreground">{message}</p>
      )}
    </section>
  )
}
