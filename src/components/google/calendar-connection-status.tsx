"use client"

import * as React from "react"
import { IconBrandGoogle, IconCheck, IconLoader2, IconRefresh } from "@tabler/icons-react"
import { toast } from "sonner"

import {
  disconnectGoogleCalendar,
  configureGoogleCalendarSelection,
  getGoogleCalendarConnectionStatus,
  refreshGoogleCalendarList,
  syncSelectedGoogleCalendar,
  type GoogleCalendarConnectionStatus,
  type GoogleCalendarSelectionConfiguration,
  type GoogleCalendarSelectionStatus,
} from "@/app/actions/google-calendar"
import { setOwnGoogleCalendarAsOrganizationOwner } from "@/app/actions/google-project-calendars"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { DeveloperOnly } from "@/components/developer-mode-provider"

function CalendarSettingRow({
  calendar,
  canManageOrganization,
  onSaved,
}: {
  readonly calendar: GoogleCalendarSelectionStatus
  readonly canManageOrganization: boolean
  readonly onSaved: () => Promise<void>
}): React.ReactElement {
  const [saving, setSaving] = React.useState(false)
  const [syncing, setSyncing] = React.useState(false)
  const writable = calendar.accessRole === "owner" || calendar.accessRole === "writer"

  async function save(
    changes: Partial<GoogleCalendarSelectionConfiguration>,
  ): Promise<void> {
    setSaving(true)
    const result = await configureGoogleCalendarSelection({
      selectionId: calendar.id,
      selected: calendar.selected,
      importEvents: calendar.importEvents,
      exportCompassEvents: calendar.exportCompassEvents,
      isCompassDestination: calendar.isCompassDestination,
      calendarScope:
        calendar.calendarScope === "organization" ? "organization" : "personal",
      internalVisibility:
        calendar.internalVisibility === "details" ? "details" : "busy",
      internalCanCreate: calendar.internalCanCreate,
      internalCanEdit: calendar.internalCanEdit,
      internalCanDelete: calendar.internalCanDelete,
      ...changes,
    })
    setSaving(false)
    if (!result.success) {
      toast.error(result.error)
      return
    }
    await onSaved()
  }

  async function sync(): Promise<void> {
    setSyncing(true)
    const result = await syncSelectedGoogleCalendar(calendar.id)
    setSyncing(false)
    if (!result.success) {
      toast.error(result.error)
      return
    }
    toast.success(
      `Calendar synced: ${result.imported} new, ${result.updated} updated${
        result.conflicts > 0 ? `, ${result.conflicts} conflicts` : ""
      }.`,
    )
    await onSaved()
  }

  return (
    <div className="space-y-3 rounded-md border p-3">
      <div className="flex items-start gap-3">
        <Checkbox
          aria-label={`Show ${calendar.summary}`}
          checked={calendar.selected}
          disabled={saving}
          onCheckedChange={(checked) => void save({ selected: checked === true })}
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate text-sm font-medium">{calendar.summary}</p>
            {calendar.isPrimary ? <Badge variant="secondary">Primary</Badge> : null}
            <Badge variant="outline">{calendar.accessRole}</Badge>
          </div>
          {calendar.description ? (
            <p className="mt-1 text-xs text-muted-foreground">{calendar.description}</p>
          ) : null}
        </div>
      </div>

      {calendar.selected ? (
        <div className="ml-7 grid gap-3 text-xs">
          <label className="flex items-center gap-2">
            <Checkbox
              checked={calendar.importEvents}
              disabled={saving}
              onCheckedChange={(checked) => void save({ importEvents: checked === true })}
            />
            Import events into the Work Calendar
          </label>

          {canManageOrganization ? (
            <label className="grid gap-1">
              <span className="text-muted-foreground">Calendar use</span>
              <Select
                value={calendar.calendarScope === "organization" ? "organization" : "personal"}
                disabled={saving}
                onValueChange={(value) =>
                  void save({
                    calendarScope: value === "organization" ? "organization" : "personal",
                  })
                }
              >
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="personal">Personal — others see Busy</SelectItem>
                  <SelectItem value="organization">Organization shared calendar</SelectItem>
                </SelectContent>
              </Select>
            </label>
          ) : null}

          {calendar.calendarScope === "organization" && canManageOrganization ? (
            <div className="grid gap-2 rounded-md bg-muted/40 p-3">
              <p className="font-medium">Internal access</p>
              <label className="grid gap-1">
                <span className="text-muted-foreground">Event visibility</span>
                <Select
                  value={calendar.internalVisibility === "details" ? "details" : "busy"}
                  disabled={saving}
                  onValueChange={(value) =>
                    void save({ internalVisibility: value === "details" ? "details" : "busy" })
                  }
                >
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="details">Show event details</SelectItem>
                    <SelectItem value="busy">Show Busy only</SelectItem>
                  </SelectContent>
                </Select>
              </label>
              <label className="flex items-center gap-2">
                <Checkbox
                  checked={calendar.internalCanCreate}
                  disabled={saving || !writable}
                  onCheckedChange={(checked) => void save({ internalCanCreate: checked === true })}
                />
                Internal users can create events
              </label>
              <label className="flex items-center gap-2">
                <Checkbox
                  checked={calendar.internalCanEdit}
                  disabled={saving || !writable}
                  onCheckedChange={(checked) => void save({ internalCanEdit: checked === true })}
                />
                Internal users can edit events
              </label>
              <label className="flex items-center gap-2">
                <Checkbox
                  checked={calendar.internalCanDelete}
                  disabled={saving || !writable}
                  onCheckedChange={(checked) => void save({ internalCanDelete: checked === true })}
                />
                Internal users can delete events
              </label>
              <label className="flex items-center gap-2">
                <Checkbox
                  checked={calendar.isCompassDestination}
                  disabled={saving || !writable}
                  onCheckedChange={(checked) =>
                    void save({
                      isCompassDestination: checked === true,
                      exportCompassEvents: checked === true || calendar.exportCompassEvents,
                    })
                  }
                />
                Offer as a Compass event destination
              </label>
            </div>
          ) : null}

          {calendar.importEvents ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" size="sm" variant="outline" disabled={syncing} onClick={() => void sync()}>
                {syncing ? "Syncing..." : "Sync now"}
              </Button>
              {calendar.lastSyncedAt ? (
                <span className="text-muted-foreground">
                  Last synced {new Date(calendar.lastSyncedAt).toLocaleString()}
                </span>
              ) : null}
            </div>
          ) : null}
          {calendar.lastError ? <p className="text-destructive">{calendar.lastError}</p> : null}
        </div>
      ) : null}
    </div>
  )
}

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
  "owner-account-mismatch": {
    type: "error",
    message: "This connection owns managed project calendars. Reconnect using the same Google account.",
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
  const [refreshing, setRefreshing] = React.useState(false)
  const [settingOwner, setSettingOwner] = React.useState(false)

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

  async function refreshCalendars(): Promise<void> {
    setRefreshing(true)
    const result = await refreshGoogleCalendarList()
    setRefreshing(false)
    if (!result.success) {
      toast.error(result.error)
      return
    }
    toast.success("Google calendars refreshed.")
    await loadStatus()
  }

  async function setOrganizationOwner(): Promise<void> {
    setSettingOwner(true)
    const result = await setOwnGoogleCalendarAsOrganizationOwner()
    setSettingOwner(false)
    if (!result.success) {
      toast.error(result.error)
      return
    }
    toast.success("This account now owns Compass-managed organization and project calendars.")
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
            <div className="flex gap-2">
              <dt>Organization calendar owner:</dt>
              <dd className="text-foreground">
                {status.organizationOwnerAccountEmail ?? "Not designated"}
              </dd>
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
          {status.requiresReconnect ? (
            <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100">
              Reconnect Google Calendar to authorize managed project calendars and subscriptions.
              <div className="mt-2">
                <Button size="sm" asChild><a href="/api/google/calendar/connect">Reconnect</a></Button>
              </div>
            </div>
          ) : null}
          {status.lastError ? (
            <DeveloperOnly>
              <p className="text-xs text-destructive">
                Last sync issue: {status.lastError}
              </p>
            </DeveloperOnly>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={refreshing}
              onClick={() => void refreshCalendars()}
            >
              <IconRefresh className={refreshing ? "animate-spin" : ""} />
              {refreshing ? "Refreshing..." : "Refresh calendars"}
            </Button>
            {status.canManageOrganizationCalendars && !status.isOrganizationCalendarOwner ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={settingOwner || status.requiresReconnect}
                onClick={() => void setOrganizationOwner()}
              >
                {settingOwner ? "Designating..." : "Use for Compass-managed calendars"}
              </Button>
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
          </div>
          {status.calendars.length > 0 ? (
            <div className="grid gap-3">
              <div>
                <p className="text-sm font-medium">Calendars</p>
                <p className="text-xs text-muted-foreground">
                  Personal calendars remain owner-scoped. Shared organization calendars can be published to everyone.
                </p>
              </div>
              {status.calendars.map((calendar) => (
                <CalendarSettingRow
                  key={calendar.id}
                  calendar={calendar}
                  canManageOrganization={status.canManageOrganizationCalendars}
                  onSaved={loadStatus}
                />
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              Refresh calendars to choose which Google calendars Compass should import.
            </p>
          )}
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
