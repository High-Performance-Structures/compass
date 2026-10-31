"use client"

import * as React from "react"
import Link from "next/link"
import { IconCircleCheck } from "@tabler/icons-react"

import type { ProjectTodoDetail } from "@/lib/domain/operations/types"
import { Button } from "@/components/ui/button"
import type { ProjectTodoHistoryItem } from "@/lib/daily-logs/log-followups-server"
import { projectTodoStatusLabel } from "@/lib/project-todos"

function eventLabel(event: ProjectTodoHistoryItem): string {
  switch (event.kind) {
    case "created":
      return event.dailyLogId ? "Created from a daily log" : "Created"
    case "worked":
      return event.fromStatus && event.toStatus && event.fromStatus !== event.toStatus
        ? `Worked on · ${projectTodoStatusLabel(event.fromStatus)} → ${projectTodoStatusLabel(event.toStatus)}`
        : "Worked on"
    case "still_blocked":
      return "Still blocked"
    case "unblocked":
      return "Cleared · back to In progress"
    case "status":
      if (event.toStatus === "complete") return "Marked finished"
      return `Status · ${projectTodoStatusLabel(event.fromStatus ?? "open")} → ${projectTodoStatusLabel(event.toStatus ?? "open")}`
    default:
      return event.kind
  }
}

function eventDate(event: ProjectTodoHistoryItem): string {
  const value = event.logDate ? new Date(`${event.logDate}T12:00:00`) : new Date(event.createdAt)
  return Number.isNaN(value.getTime())
    ? event.createdAt
    : value.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })
}

function hoursLabel(hours: number): string {
  return `${hours.toLocaleString("en-US", { maximumFractionDigits: 2 })} ${hours === 1 ? "hour" : "hours"}`
}

/**
 * A to-do's history: where it came from, each daily log that worked on it and
 * status changes, with the hours logged against it. Once it was worked on in
 * enough logs and is still open, asks whether it's finished; finishing stays a
 * person's choice.
 */
export function ProjectTodoHistory({
  projectId,
  detail,
  finished,
  onMarkFinished,
  busy,
}: {
  readonly projectId: string
  readonly detail: ProjectTodoDetail | null
  readonly finished: boolean
  readonly onMarkFinished: () => void
  readonly busy: boolean
}): React.ReactElement | null {
  if (!detail) return <p className="text-xs text-muted-foreground">Loading history…</p>
  const showNudge = !finished && detail.workedLogCount >= detail.finishNudgeAfterLogs
  if (detail.history.length === 0 && detail.hours === 0) return null
  return (
    <section aria-labelledby="todo-history-title" className="grid gap-3 border-t pt-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id="todo-history-title" className="text-sm font-medium">History</h3>
        {detail.hours > 0 && (
          <p className="text-sm tabular-nums">
            <span className="text-muted-foreground">Logged on daily logs: </span>
            <span className="font-medium">{hoursLabel(detail.hours)}</span>
          </p>
        )}
      </div>
      {showNudge && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-info/30 bg-info/10 p-3 text-sm">
          <span>
            Worked on in {detail.workedLogCount} daily logs and still open. Is it finished?
          </span>
          <Button type="button" size="sm" onClick={onMarkFinished} disabled={busy}>
            <IconCircleCheck className="size-4" />
            Mark finished
          </Button>
        </div>
      )}
      <ol className="grid gap-2">
        {detail.history.map((event) => (
          <li key={event.id} className="grid gap-0.5 border-l-2 border-border pl-3">
            <p className="text-xs text-muted-foreground">
              {eventDate(event)}
              {event.actorName ? ` · ${event.actorName}` : ""}
            </p>
            <p className="text-sm font-medium">{eventLabel(event)}</p>
            {(event.note || event.dailyLogId) && (
              <p className="text-xs text-muted-foreground break-words">
                {event.note}
                {event.dailyLogId && (
                  <>
                    {event.note ? " · " : ""}
                    <Link href={`/dashboard/projects/${encodeURIComponent(projectId)}/daily-logs#daily-log-${event.dailyLogId}`} className="underline underline-offset-2">
                      Open log
                    </Link>
                  </>
                )}
              </p>
            )}
          </li>
        ))}
      </ol>
    </section>
  )
}
