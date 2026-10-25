"use client"

import * as React from "react"
import { IconBrandGoogle, IconExternalLink, IconRefresh } from "@tabler/icons-react"
import { toast } from "sonner"

import {
  getProjectCalendarStatus,
  setProjectCalendarChoice,
  syncProjectCalendarNow,
  type ProjectCalendarStatus,
} from "@/app/actions/project-calendars"
import { Button } from "@/components/ui/button"

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
}

type Available = Extract<ProjectCalendarStatus, { readonly available: true }>

function statusLine(status: Available): string {
  if (!status.included) {
    if (status.mode === "off") return "Your company doesn't offer project calendars."
    return status.choice === false
      ? "Turned off for this job."
      : "This job doesn't have a Google calendar. Create one to share its schedule with staff."
  }
  if (status.status === "error") return "Compass couldn't update the calendar. It will try again shortly."
  if (status.status !== "active") return "Compass is setting up the calendar. It appears within a few minutes."
  const people = `${status.memberCount} staff member${status.memberCount === 1 ? "" : "s"}`
  const events = `${status.eventCount} event${status.eventCount === 1 ? "" : "s"}`
  return `Shared with ${people}, ${events}.`
}

/** Staff-only: this job's Google calendar, owned by the company account. */
export function ProjectGoogleCalendarCard({
  projectId,
}: {
  readonly projectId: string
}): React.ReactElement | null {
  const [status, setStatus] = React.useState<Available | null>(null)
  const [hidden, setHidden] = React.useState(false)
  const [pending, startTransition] = React.useTransition()

  const load = React.useCallback(async (): Promise<void> => {
    const result = await getProjectCalendarStatus(projectId)
    if (!result.success) {
      toast.error(result.error)
      return
    }
    if (!result.data.available) {
      setHidden(true)
      return
    }
    setStatus(result.data)
  }, [projectId])

  React.useEffect(() => {
    void load()
  }, [load])

  function run(action: () => Promise<{ readonly success: boolean; readonly error?: string }>, done: string): void {
    startTransition(async () => {
      const result = await action()
      if (!result.success) {
        toast.error(result.error ?? "Something went wrong.")
        return
      }
      toast.success(done)
      await load()
    })
  }

  if (hidden) return null
  if (!status) {
    return <section className="border-t pt-5 text-sm text-muted-foreground">Loading project calendar…</section>
  }

  const followsCompany = status.choice === null
  return (
    <section className="border-t pt-5" aria-labelledby="project-google-calendar">
      <div className="flex items-start gap-3">
        <IconBrandGoogle className="mt-0.5 size-5 shrink-0" />
        <div className="min-w-0 space-y-1">
          <h2 id="project-google-calendar" className="font-semibold">Project Google calendar</h2>
          <p className="text-sm text-muted-foreground">
            This job&apos;s schedule, events and client meetings in Google Calendar, shared only with staff. Compass keeps
            it up to date every few minutes.
          </p>
          <p className="text-sm">{statusLine(status)}</p>
          {status.included && status.lastSyncedAt ? (
            <p className="text-xs text-muted-foreground">Last updated {formatDateTime(status.lastSyncedAt)}</p>
          ) : null}
          {status.lastError ? <p className="text-xs text-destructive">{status.lastError}</p> : null}
        </div>
      </div>

      {status.mode !== "off" ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {status.calendarUrl && status.sharedWithMe ? (
            <Button size="sm" variant="outline" asChild>
              <a href={status.calendarUrl} target="_blank" rel="noreferrer">
                <IconExternalLink />
                Open in Google Calendar
              </a>
            </Button>
          ) : null}
          {status.canManage && status.included ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => run(() => syncProjectCalendarNow(projectId), "Project calendar updated.")}
            >
              <IconRefresh className={pending ? "animate-spin" : ""} />
              Update now
            </Button>
          ) : null}
          {status.canManage && !status.included ? (
            <Button
              type="button"
              size="sm"
              disabled={pending}
              onClick={() => run(() => setProjectCalendarChoice(projectId, true), "Project calendar created.")}
            >
              {pending ? "Setting up…" : "Create Google calendar"}
            </Button>
          ) : null}
          {status.canManage && status.included ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={() => {
                if (!window.confirm("Remove this job's Google calendar? Compass deletes it from Google for everyone it's shared with. Nothing in Compass changes.")) return
                run(() => setProjectCalendarChoice(projectId, false), "Project calendar removed.")
              }}
            >
              Remove Google calendar
            </Button>
          ) : null}
          {status.canManage && !followsCompany && status.mode === "open" ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={() => run(() => setProjectCalendarChoice(projectId, null), "This job now follows the company setting.")}
            >
              Use company setting
            </Button>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
