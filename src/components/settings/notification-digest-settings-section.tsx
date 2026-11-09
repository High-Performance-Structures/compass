"use client"

import * as React from "react"
import { toast } from "sonner"
import { IconPlus, IconX } from "@tabler/icons-react"

import { getFeatureSettingsForEditor, resetFeatureSettings, saveFeatureSettings } from "@/app/actions/feature-settings"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import {
  DEFAULT_NOTIFICATION_DIGEST_SETTINGS,
  INSTANT_NOTIFICATION_KINDS,
  INSTANT_NOTIFICATION_KIND_LABELS,
  notificationDigestSettingsSchema,
  type InstantNotificationKind,
  type NotificationDigestSettings,
} from "@/lib/feature-settings/notification-digest-settings"
import { FEATURE_SETTINGS } from "@/lib/feature-settings/registry"
import { clockLabel } from "@/lib/daily-logs/reminders"

const GROUP = FEATURE_SETTINGS["notification-digest"]
const MAX_TIMES = 6

/** Settings → Workflows → Notification digest: when change notices go out, and what is still sent right away. */
export function NotificationDigestSettingsSection(): React.ReactElement {
  const [loaded, setLoaded] = React.useState(false)
  const [canEdit, setCanEdit] = React.useState(false)
  const [customized, setCustomized] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [settings, setSettings] = React.useState<NotificationDigestSettings>(DEFAULT_NOTIFICATION_DIGEST_SETTINGS)
  const [pending, startTransition] = React.useTransition()

  const load = React.useCallback(async () => {
    const result = await getFeatureSettingsForEditor("notification-digest")
    if (!result.success) {
      setError(result.error)
      return
    }
    const parsed = notificationDigestSettingsSchema.safeParse(result.data.settings)
    setSettings(parsed.success ? parsed.data : DEFAULT_NOTIFICATION_DIGEST_SETTINGS)
    setCanEdit(result.data.canEdit)
    setCustomized(result.data.customized)
    setLoaded(true)
  }, [])

  React.useEffect(() => {
    void load()
  }, [load])

  function setTime(index: number, value: string): void {
    setSettings((current) => ({ ...current, times: current.times.map((time, at) => (at === index ? value : time)) }))
  }

  function toggleKind(kind: InstantNotificationKind, checked: boolean): void {
    setSettings((current) => ({
      ...current,
      instantKinds: checked
        ? [...new Set([...current.instantKinds, kind])]
        : current.instantKinds.filter((value) => value !== kind),
    }))
  }

  function save(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    const times = [...new Set(settings.times.filter(Boolean))].sort()
    startTransition(async () => {
      const result = await saveFeatureSettings("notification-digest", { ...settings, times })
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success("Notification digest saved.")
      await load()
    })
  }

  function reset(): void {
    startTransition(async () => {
      const result = await resetFeatureSettings("notification-digest")
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success("Notification digest reset to noon and 5 pm.")
      await load()
    })
  }

  const disabled = pending || !canEdit
  return (
    <section aria-labelledby="notification-digest-settings" className="space-y-4 border-b pb-6">
      <div>
        <h2 id="notification-digest-settings" className="text-base font-semibold">{GROUP.label}</h2>
        <p className="text-sm text-muted-foreground">{GROUP.description}</p>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {!loaded && !error ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
      {loaded ? (
        <form onSubmit={save} className="space-y-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <Label htmlFor="notification-digest-mode">Collect changes into a digest</Label>
              <p className="text-xs text-muted-foreground">Off sends every notice right away, one per change.</p>
            </div>
            <Switch
              id="notification-digest-mode"
              checked={settings.mode === "on"}
              disabled={disabled}
              onCheckedChange={(checked) => setSettings((current) => ({ ...current, mode: checked ? "on" : "off" }))}
            />
          </div>

          <div className="space-y-2">
            <Label>Digest times (company time)</Label>
            <div className="flex flex-wrap items-center gap-2">
              {settings.times.map((time, index) => (
                <div key={index} className="flex items-center gap-1">
                  <Input
                    type="time"
                    aria-label={`Digest time ${index + 1}`}
                    className="h-8 w-32"
                    value={time}
                    disabled={disabled || settings.mode === "off"}
                    onChange={(event) => setTime(index, event.target.value)}
                  />
                  {settings.times.length > 1 ? (
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="size-8"
                      aria-label={`Remove ${time ? clockLabel(time) : "time"}`}
                      disabled={disabled || settings.mode === "off"}
                      onClick={() => setSettings((current) => ({ ...current, times: current.times.filter((_, at) => at !== index) }))}
                    >
                      <IconX className="size-4" />
                    </Button>
                  ) : null}
                </div>
              ))}
              {settings.times.length < MAX_TIMES ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={disabled || settings.mode === "off"}
                  onClick={() => setSettings((current) => ({ ...current, times: [...current.times, "08:00"] }))}
                >
                  <IconPlus className="mr-1 size-4" />
                  Add time
                </Button>
              ) : null}
            </div>
            <p className="text-xs text-muted-foreground">
              Each person gets one summary per time covering everything since the last one. Notices they already read in Compass are left out.
            </p>
          </div>

          <div className="space-y-2">
            <Label>Always send right away</Label>
            <div className="space-y-2">
              {INSTANT_NOTIFICATION_KINDS.map((kind) => (
                <label key={kind} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={settings.instantKinds.includes(kind)}
                    disabled={disabled || settings.mode === "off"}
                    onCheckedChange={(checked) => toggleKind(kind, checked === true)}
                  />
                  {INSTANT_NOTIFICATION_KIND_LABELS[kind]}
                </label>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {canEdit ? (
              <>
                <Button type="submit" size="sm" disabled={pending}>Save</Button>
                {customized ? <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={reset}>Reset</Button> : null}
              </>
            ) : (
              <p className="text-xs text-muted-foreground">Only admins can change these settings.</p>
            )}
          </div>
        </form>
      ) : null}
    </section>
  )
}
