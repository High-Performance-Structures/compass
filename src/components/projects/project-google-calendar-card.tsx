"use client"

import * as React from "react"
import { IconBrandGoogle, IconCalendarPlus, IconRefresh } from "@tabler/icons-react"
import { toast } from "sonner"

import {
  addGoogleProjectCalendarToMine,
  deleteGoogleProjectCalendarForProject,
  enableGoogleProjectCalendar,
  getGoogleProjectCalendarStatus,
  setGoogleProjectCalendarDisabled,
  setGoogleProjectCalendarPaused,
  syncGoogleProjectCalendarAccess,
  syncGoogleProjectCalendarEvents,
  type GoogleProjectCalendarStatus,
} from "@/app/actions/google-project-calendars"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

export function ProjectGoogleCalendarCard({
  projectId,
}: {
  readonly projectId: string
}): React.ReactElement {
  const [status, setStatus] = React.useState<GoogleProjectCalendarStatus | null>(null)
  const [pendingAction, setPendingAction] = React.useState<string | null>(null)

  const load = React.useCallback(async (): Promise<void> => {
    setStatus(await getGoogleProjectCalendarStatus(projectId))
  }, [projectId])

  React.useEffect(() => { void load() }, [load])

  async function run(
    name: string,
    action: () => Promise<
      | { readonly success: true; readonly warning?: string }
      | { readonly success: false; readonly error: string }
    >,
    successMessage: string,
  ): Promise<void> {
    setPendingAction(name)
    const result = await action()
    setPendingAction(null)
    if (!result.success) {
      toast.error(result.error)
      return
    }
    if (result.warning) toast.warning(result.warning)
    else toast.success(successMessage)
    await load()
  }

  if (!status) {
    return (
      <section className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">
        Loading project calendar settings…
      </section>
    )
  }

  const calendar = status.calendar
  const busy = pendingAction !== null
  return (
    <section className="rounded-lg border bg-card p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <IconBrandGoogle className="mt-0.5 size-5" />
          <div>
            <h2 className="font-semibold">Project Google Calendar</h2>
            <p className="text-sm text-muted-foreground">
              Publishes this project’s Compass events to a dedicated Google calendar without mixing personal calendars into the shared Work Calendar.
            </p>
          </div>
        </div>
        <Badge variant={calendar?.status === "active" ? "default" : "outline"}>
          {calendar ? calendar.status : "Not enabled"}
        </Badge>
      </div>

      {!status.ownerConfigured ? (
        <p className="mt-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100">
          An administrator must connect and designate the organization Google Calendar account in Settings before a project calendar can be enabled.
        </p>
      ) : null}

      {calendar ? (
        <div className="mt-4 space-y-3">
          <div>
            <p className="text-sm font-medium">{calendar.summary}</p>
            <p className="text-xs text-muted-foreground">
              Owned by {status.ownerAccountEmail}. Project members receive Google access according to their Compass role.
            </p>
          </div>
          {calendar.lastError ? <p className="text-xs text-destructive">{calendar.lastError}</p> : null}
          {status.requiresReconnect ? (
            <p className="rounded-md border p-3 text-sm">
              Reconnect Google Calendar in Settings before adding this calendar to your account.
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {status.connected ? (
              <Button
                type="button"
                size="sm"
                disabled={busy || status.subscribed || calendar.status !== "active" || status.requiresReconnect}
                onClick={() => void run("subscribe", () => addGoogleProjectCalendarToMine(projectId), "Project calendar added to Google Calendar.")}
              >
                <IconCalendarPlus />
                {status.subscribed ? "Added to my Google Calendar" : "Add to my Google Calendar"}
              </Button>
            ) : (
              <Button size="sm" variant="outline" asChild>
                <a href="/dashboard/settings">Connect Google Calendar</a>
              </Button>
            )}
            {status.canEnable && calendar.status !== "disabled" ? (
              <>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={busy || calendar.status !== "active"}
                  onClick={() => void run("events", () => syncGoogleProjectCalendarEvents(projectId), "Project calendar events synchronized.")}
                >
                  <IconRefresh className={pendingAction === "events" ? "animate-spin" : ""} />
                  Sync events
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => void run("access", () => syncGoogleProjectCalendarAccess(projectId), "Project calendar access synchronized.")}
                >
                  <IconRefresh className={pendingAction === "access" ? "animate-spin" : ""} />
                  Sync access
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => void run("pause", () => setGoogleProjectCalendarPaused(projectId, calendar.status === "active"), calendar.status === "active" ? "Project calendar paused." : "Project calendar resumed.")}
                >
                  {calendar.status === "active" ? "Pause publishing" : "Resume publishing"}
                </Button>
              </>
            ) : null}
            {status.canDelete ? (
              <>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => void run("disable", () => setGoogleProjectCalendarDisabled(projectId, calendar.status !== "disabled"), calendar.status === "disabled" ? "Project calendar enabled." : "Project calendar disabled.")}
                >
                  {calendar.status === "disabled" ? "Enable calendar" : "Disable calendar"}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="destructive"
                  disabled={busy}
                  onClick={() => {
                    if (!window.confirm("Delete this project calendar from Google Calendar? This cannot be undone.")) return
                    void run("delete", () => deleteGoogleProjectCalendarForProject(projectId), "Project Google calendar deleted.")
                  }}
                >
                  Delete calendar
                </Button>
              </>
            ) : null}
          </div>
        </div>
      ) : status.canEnable ? (
        <div className="mt-4">
          <Button
            type="button"
            size="sm"
            disabled={busy || !status.ownerConfigured}
            onClick={() => void run("enable", () => enableGoogleProjectCalendar(projectId), "Project Google calendar enabled.")}
          >
            <IconCalendarPlus />
            {pendingAction === "enable" ? "Creating calendar…" : "Enable project Google Calendar"}
          </Button>
        </div>
      ) : (
        <p className="mt-4 text-sm text-muted-foreground">
          Office staff can enable a Google calendar for this project.
        </p>
      )}
    </section>
  )
}
