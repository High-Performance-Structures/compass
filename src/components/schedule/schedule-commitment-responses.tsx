"use client"

import * as React from "react"
import {
  getScheduleTaskAssignees,
  type ScheduleTaskAssigneeView
} from "@/app/actions/schedule-confirmations"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

type ResponseState =
  | { readonly status: "loading" }
  | { readonly status: "error" }
  | {
      readonly status: "ready"
      readonly rows: readonly ScheduleTaskAssigneeView[]
    }

export function ScheduleCommitmentResponses({
  taskId,
  onUseProposal
}: {
  readonly taskId: string
  readonly onUseProposal: (proposal: {
    readonly startDate: string | null
    readonly workdays: number | null
  }) => void
}): React.ReactElement | null {
  const [state, setState] = React.useState<ResponseState>({ status: "loading" })
  const [refresh, setRefresh] = React.useState(0)
  React.useEffect(() => {
    let cancelled = false
    setState({ status: "loading" })
    void getScheduleTaskAssignees(taskId)
      .then((rows) => {
        if (!cancelled) setState({ status: "ready", rows })
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error" })
      })
    return () => {
      cancelled = true
    }
  }, [taskId, refresh])

  if (state.status === "loading")
    return (
      <p className="mt-3 text-xs text-muted-foreground">
        Loading individual commitments…
      </p>
    )
  if (state.status === "error")
    return (
      <div role="alert" className="mt-3 flex items-center gap-2 text-xs">
        Unable to load individual responses.
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => setRefresh((value) => value + 1)}
        >
          Retry
        </Button>
      </div>
    )
  if (state.rows.length === 0) return null
  return (
    <section className="mt-4 border-t pt-3" aria-label="Individual commitments">
      <h3 className="text-xs font-medium">Individual commitments</h3>
      <p className="mt-1 text-xs text-muted-foreground">
        Review each assignee’s availability and coordination notes. Save and
        publish any agreed date changes.
      </p>
      <div className="divide-y">
        {state.rows.map((row) => (
          <article key={row.id} className="space-y-2 py-3 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium">
                {row.displayName ?? row.sourceName ?? "Assigned participant"}
              </span>
              <Badge
                variant={
                  row.responseStatus === "confirmed" ? "secondary" : "outline"
                }
              >
                {row.responseStatus === "confirmed"
                  ? "Confirmed"
                  : row.responseStatus === "declined"
                    ? "Cannot commit"
                    : row.responseStatus === "proposed"
                      ? "Change proposed"
                      : row.responseStatus === "not_requested"
                        ? "Not requested"
                        : row.responseStatus === "unavailable"
                          ? "Compass account needed"
                          : "Awaiting confirmation"}
              </Badge>
            </div>
            {row.responseMessage && (
              <p className="whitespace-pre-wrap text-muted-foreground">
                {row.responseMessage}
              </p>
            )}
            {row.responseStatus === "proposed" &&
              (row.proposedStartDate !== null ||
                row.proposedWorkdays !== null) && (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-muted-foreground">
                    {row.proposedStartDate
                      ? `Proposed start: ${row.proposedStartDate}`
                      : "Start unchanged"}
                    {row.proposedWorkdays !== null
                      ? ` · ${row.proposedWorkdays} workdays`
                      : " · Duration unchanged"}
                  </p>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      onUseProposal({
                        startDate: row.proposedStartDate,
                        workdays: row.proposedWorkdays
                      })
                    }
                  >
                    Use proposed dates
                  </Button>
                </div>
              )}
          </article>
        ))}
      </div>
    </section>
  )
}
