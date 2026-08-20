"use client"

import * as React from "react"
import { IconBrandGoogle, IconCheck, IconLoader2 } from "@tabler/icons-react"
import { toast } from "sonner"

import {
  disconnectGoogleCalendar,
  getGoogleCalendarConnectionStatus,
  type GoogleCalendarConnectionStatus,
} from "@/app/actions/google-calendar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DeveloperOnly } from "@/components/developer-mode-provider"

const GOOGLE_CALENDAR_CALLBACK_MESSAGES: Readonly<
  Record<string, { readonly type: "success" | "error"; readonly message: string }>
> = {
  connected: {
    type: "success",
    message: "Google Calendar connected. Choose calendars before enabling sync.",
  },
  cancelled: {
    type: "error",
    message: "Google Calendar connection was cancelled.",
  },
  "invalid-state": {
    type: "error",
    message: "Google Calendar authorization expired. Please try connecting again.",
  },
  "missing-scopes": {
    type: "error",
    message: "Compass needs calendar access to complete the connection.",
  },
  "email-not-verified": {
    type: "error",
    message: "The selected Google account does not have a verified email address.",
  },
  "missing-refresh-token": {
    type: "error",
    message: "Google did not grant offline access. Remove Compass from your Google Account and try again.",
  },
  "not-configured": {
    type: "error",
    message: "Google Calendar has not been configured by a Compass administrator.",
  },
  unauthorized: {
    type: "error",
    message: "Your Compass account cannot connect Google Calendar.",
  },
  "missing-code": {
    type: "error",
    message: "Google did not return an authorization code. Please try again.",
  },
  error: {
    type: "error",
    message: "Google Calendar could not be connected. Please try again.",
  },
}

export function GoogleCalendarConnectionCard(): React.ReactElement {
  const [status, setStatus] =
    React.useState<GoogleCalendarConnectionStatus | null>(null)
  const [disconnecting, setDisconnecting] = React.useState(false)

  const loadStatus = React.useCallback(async (): Promise<void> => {
    const result = await getGoogleCalendarConnectionStatus()
    setStatus(result)
  }, [])

  React.useEffect(() => {
    void loadStatus()
  }, [loadStatus])

  React.useEffect(() => {
    const url = new URL(window.location.href)
    const callbackStatus = url.searchParams.get("google-calendar")
    if (!callbackStatus) return

    const feedback = GOOGLE_CALENDAR_CALLBACK_MESSAGES[callbackStatus]
    if (feedback?.type === "success") {
      toast.success(feedback.message)
    } else if (feedback) {
      toast.error(feedback.message)
    }

    url.searchParams.delete("google-calendar")
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`)
  }, [])

  async function disconnect(): Promise<void> {
    setDisconnecting(true)
    const result = await disconnectGoogleCalendar()
    setDisconnecting(false)
    if (!result.success) {
      toast.error(result.error)
      return
    }
    toast.success(
      result.revoked
        ? "Google Calendar disconnected."
        : "Google Calendar disconnected from Compass. Google access may also need to be removed from your Google Account.",
    )
    await loadStatus()
  }

  if (!status) {
    return (
      <div className="flex items-center gap-3 border p-4">
        <IconLoader2 className="size-5 animate-spin text-muted-foreground" />
        <span className="text-sm text-muted-foreground">
          Checking Google Calendar connection...
        </span>
      </div>
    )
  }

  return (
    <section className="space-y-3 border p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <IconBrandGoogle className="size-5" />
          <div>
            <p className="text-sm font-medium">Google Calendar</p>
            <p className="text-xs text-muted-foreground">
              Display selected Google calendars alongside Compass work.
            </p>
          </div>
        </div>
        {status.connected ? (
          <Badge variant="outline" className="gap-1 text-green-700">
            <IconCheck className="size-3" />
            Connected
          </Badge>
        ) : (
          <Badge variant="outline">Not connected</Badge>
        )}
      </div>

      {status.connected ? (
        <>
          <dl className="grid gap-1 text-xs text-muted-foreground">
            <div className="flex gap-2">
              <dt>Account:</dt>
              <dd className="text-foreground">{status.accountEmail}</dd>
            </div>
            <DeveloperOnly>
              <div className="flex gap-2">
                <dt>Calendar sync:</dt>
                <dd className="text-foreground">
                  {status.calendarSyncEnabled
                    ? "Enabled"
                    : "Calendar selection required"}
                </dd>
              </div>
            </DeveloperOnly>
          </dl>
          {status.lastError ? (
            <DeveloperOnly>
              <p className="text-xs text-destructive">
                Last sync issue: {status.lastError}
              </p>
            </DeveloperOnly>
          ) : null}
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={disconnecting}
            onClick={() => void disconnect()}
          >
            {disconnecting ? "Disconnecting..." : "Disconnect"}
          </Button>
        </>
      ) : (
        <>
          {!status.configured ? (
            <p className="text-xs text-muted-foreground">
              Google OAuth must be configured by a Compass administrator
              before staff can connect.
            </p>
          ) : null}
          {!status.canConnect ? (
            <p className="text-xs text-muted-foreground">
              Google Calendar connections are available to internal staff
              accounts.
            </p>
          ) : null}
          {status.configured && status.canConnect ? (
            <Button size="sm" asChild>
              <a href="/api/google/calendar/connect">
                Connect Google Calendar
              </a>
            </Button>
          ) : (
            <Button size="sm" disabled>
              Connect Google Calendar
            </Button>
          )}
        </>
      )}
    </section>
  )
}
