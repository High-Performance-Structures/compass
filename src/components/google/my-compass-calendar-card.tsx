"use client"

import * as React from "react"
import { IconCalendarEvent, IconExternalLink, IconLoader2, IconRefresh } from "@tabler/icons-react"
import { toast } from "sonner"

import {
  getMyCompassCalendarStatus,
  saveMyCompassCalendarNames,
  setMyCompassCalendarEnabled,
  syncMyCompassCalendarNow,
  type MyCompassCalendarStatus,
} from "@/app/actions/my-compass-calendar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"

function syncedLabel(value: string | null): string {
  if (!value) return "Not yet"
  return new Date(value).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
}

/**
 * The signed-in person's My Compass calendar: a Google calendar Compass keeps
 * filled with the schedule items and to-dos assigned to them.
 */
export function MyCompassCalendarCard(): React.ReactElement | null {
  const [status, setStatus] = React.useState<MyCompassCalendarStatus | null>(null)
  const [names, setNames] = React.useState("")
  const [pending, startTransition] = React.useTransition()

  const load = React.useCallback(async (): Promise<void> => {
    const result = await getMyCompassCalendarStatus()
    if (!result.success) {
      toast.error(result.error)
      return
    }
    setStatus(result.data)
    if (result.data.available) setNames(result.data.otherNames.join(", "))
  }, [])

  React.useEffect(() => {
    void load()
  }, [load])

  function run(action: () => Promise<{ readonly success: boolean; readonly error?: string }>, done: string): void {
    startTransition(async () => {
      const result = await action()
      if (!result.success) toast.error(result.error ?? "Something went wrong.")
      else toast.success(done)
      await load()
    })
  }

  if (!status) {
    return (
      <div className="flex items-center gap-3 border p-4">
        <IconLoader2 className="size-5 animate-spin text-muted-foreground" />
        <span className="text-sm text-muted-foreground">Checking your My Compass calendar...</span>
      </div>
    )
  }

  return (
    <section className="space-y-3 border p-4" aria-labelledby="my-compass-calendar-title">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <IconCalendarEvent className="size-5" />
          <div>
            <p id="my-compass-calendar-title" className="text-sm font-medium">My Compass calendar</p>
            <p className="text-xs text-muted-foreground">
              Your schedule items and to-dos on a &ldquo;My Compass&rdquo; calendar in your Google Calendar.
            </p>
          </div>
        </div>
        {status.available ? (
          <Switch
            aria-label="Show my Compass work in Google Calendar"
            checked={status.enabled && status.status !== "removed"}
            disabled={pending}
            onCheckedChange={(checked) =>
              run(
                () => setMyCompassCalendarEnabled(checked),
                checked ? "My Compass calendar is on. It's in your Google Calendar now." : "My Compass calendar removed from Google."
              )
            }
          />
        ) : (
          <Badge variant="outline">Not available</Badge>
        )}
      </div>

      {!status.available ? (
        <p className="text-xs text-muted-foreground">{status.reason}</p>
      ) : (
        <>
          <dl className="grid gap-1 text-xs text-muted-foreground">
            <div className="flex gap-2">
              <dt>Google account:</dt>
              <dd className="text-foreground">{status.googleEmail}</dd>
            </div>
            <div className="flex gap-2">
              <dt>Items on the calendar:</dt>
              <dd className="text-foreground">{status.itemCount}</dd>
            </div>
            <div className="flex gap-2">
              <dt>Last updated:</dt>
              <dd className="text-foreground">{syncedLabel(status.lastSyncedAt)}</dd>
            </div>
          </dl>
          {status.status === "removed" ? (
            <p className="text-xs text-muted-foreground">
              The calendar was deleted in Google. Turn it back on to make a new one.
            </p>
          ) : null}
          {status.lastError ? (
            <p role="alert" className="text-xs text-destructive">{status.lastError}</p>
          ) : null}
          {status.enabled && status.status !== "removed" ? (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" disabled={pending} onClick={() => run(syncMyCompassCalendarNow, "My Compass calendar updated.")}>
                <IconRefresh className="size-4" /> Update now
              </Button>
              {status.calendarUrl ? (
                <Button size="sm" variant="ghost" asChild>
                  <a href={status.calendarUrl} target="_blank" rel="noreferrer">
                    <IconExternalLink className="size-4" /> Open in Google Calendar
                  </a>
                </Button>
              ) : null}
            </div>
          ) : null}
          <form
            className="space-y-1.5"
            onSubmit={(event) => {
              event.preventDefault()
              run(() => saveMyCompassCalendarNames(names.split(",")), "Names saved. Matching items appear within a few minutes.")
            }}
          >
            <Label htmlFor="my-compass-other-names" className="text-xs">Other names you're assigned under</Label>
            <div className="flex gap-2">
              <Input
                id="my-compass-other-names"
                value={names}
                onChange={(event) => setNames(event.target.value)}
                placeholder="e.g. Wesley Jones, WJ"
                className="h-8 text-sm"
                disabled={pending}
              />
              <Button type="submit" size="sm" variant="outline" disabled={pending}>Save</Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Compass already matches your name and email. Add other spellings, separated by commas.
            </p>
          </form>
        </>
      )}
    </section>
  )
}
