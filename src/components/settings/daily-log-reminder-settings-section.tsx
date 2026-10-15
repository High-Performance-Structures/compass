"use client"

import * as React from "react"
import { IconBell } from "@tabler/icons-react"
import { toast } from "sonner"

import { getFeatureSettingsForEditor, resetFeatureSettings, saveFeatureSettings } from "@/app/actions/feature-settings"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import {
  clockLabel,
  DAILY_LOG_REMINDER_AUDIENCE_LABELS,
  DAILY_LOG_REMINDER_AUDIENCES,
  reminderBody,
  WEEKDAY_LABELS,
} from "@/lib/daily-logs/reminders"
import {
  dailyLogReminderSettingsSchema,
  FEATURE_SETTINGS,
  type DailyLogReminderSettings,
} from "@/lib/feature-settings/registry"

const KEY = "daily-log-reminders"
const DEFAULTS = FEATURE_SETTINGS[KEY].defaults
// Monday first, the way work weeks are usually read.
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0] as const

function SwitchRow({
  id,
  label,
  help,
  checked,
  disabled,
  onChange,
}: {
  readonly id: string
  readonly label: string
  readonly help: string
  readonly checked: boolean
  readonly disabled: boolean
  readonly onChange: (checked: boolean) => void
}): React.ReactElement {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <Label htmlFor={id}>{label}</Label>
        <p className="text-xs text-muted-foreground">{help}</p>
      </div>
      <Switch id={id} checked={checked} disabled={disabled} onCheckedChange={onChange} />
    </div>
  )
}

/** When staff are reminded to write a daily log, and who sees who's missing. */
export function DailyLogReminderSettingsSection(): React.ReactElement {
  const [settings, setSettings] = React.useState<DailyLogReminderSettings>(DEFAULTS)
  const [canEdit, setCanEdit] = React.useState(false)
  const [customized, setCustomized] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [pending, startTransition] = React.useTransition()

  const load = React.useCallback(async () => {
    const result = await getFeatureSettingsForEditor(KEY)
    if (!result.success) {
      setError(result.error)
      return
    }
    const parsed = dailyLogReminderSettingsSchema.safeParse(result.data.settings)
    setSettings(parsed.success ? parsed.data : DEFAULTS)
    setCanEdit(result.data.canEdit)
    setCustomized(result.data.customized)
  }, [])

  React.useEffect(() => {
    void load()
  }, [load])

  const disabled = pending || !canEdit
  const off = disabled || !settings.enabled
  const update = (patch: Partial<DailyLogReminderSettings>): void => setSettings((current) => ({ ...current, ...patch }))

  function save(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    const parsed = dailyLogReminderSettingsSchema.safeParse(settings)
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Check the reminder settings.")
      return
    }
    startTransition(async () => {
      const result = await saveFeatureSettings(KEY, parsed.data)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success("Daily log reminder settings saved.")
      await load()
    })
  }

  function reset(): void {
    startTransition(async () => {
      const result = await resetFeatureSettings(KEY)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success("Back to the defaults.")
      await load()
    })
  }

  return (
    <section aria-labelledby="daily-log-reminder-settings" className="space-y-6 border-b pb-6">
      <div>
        <h2 id="daily-log-reminder-settings" className="text-base font-semibold">{FEATURE_SETTINGS[KEY].label}</h2>
        <p className="text-sm text-muted-foreground">{FEATURE_SETTINGS[KEY].description}</p>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <form onSubmit={save} className="grid max-w-2xl gap-6">
        <SwitchRow
          id="daily-log-reminders-on"
          label="Send missing daily log reminders"
          help="Anyone who already logged that day, on any job or workspace, or entered time on the duty log, is skipped."
          checked={settings.enabled}
          disabled={disabled}
          onChange={(enabled) => update({ enabled })}
        />

        <div className="grid gap-4 sm:grid-cols-3">
          <div className="grid gap-1.5">
            <Label htmlFor="daily-log-reminders-audience">Remind</Label>
            <Select
              value={settings.audience}
              onValueChange={(value) => {
                const audience = DAILY_LOG_REMINDER_AUDIENCES.find((item) => item === value)
                if (audience) update({ audience })
              }}
              disabled={off}
            >
              <SelectTrigger id="daily-log-reminders-audience" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DAILY_LOG_REMINDER_AUDIENCES.map((audience) => (
                  <SelectItem key={audience} value={audience}>{DAILY_LOG_REMINDER_AUDIENCE_LABELS[audience]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="daily-log-reminders-office">Office staff at</Label>
            <Input id="daily-log-reminders-office" type="time" value={settings.officeTime} disabled={off} onChange={(event) => update({ officeTime: event.target.value })} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="daily-log-reminders-field">Field staff at</Label>
            <Input id="daily-log-reminders-field" type="time" value={settings.fieldTime} disabled={off} onChange={(event) => update({ fieldTime: event.target.value })} />
          </div>
        </div>
        <p className="-mt-3 text-xs text-muted-foreground">
          Field staff are people with a field role; everyone else on staff gets the office time. Times are the company&apos;s time zone from the work calendar settings. Only staff are reminded; clients, subs and suppliers never are.
        </p>

        <fieldset className="grid gap-2">
          <legend className="text-sm font-medium">Work days</legend>
          <div className="flex flex-wrap gap-4">
            {WEEK_ORDER.map((day) => (
              <label key={day} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={settings.workDays.includes(day)}
                  disabled={off}
                  onCheckedChange={(checked) =>
                    update({
                      workDays: checked === true
                        ? [...new Set([...settings.workDays, day])].sort((a, b) => a - b)
                        : settings.workDays.filter((item) => item !== day),
                    })
                  }
                />
                {WEEKDAY_LABELS[day]}
              </label>
            ))}
          </div>
        </fieldset>

        <SwitchRow
          id="daily-log-reminders-absence"
          label="Skip people who are away"
          help="Anyone on an Absence on the work calendar that day."
          checked={settings.skipAbsences}
          disabled={off}
          onChange={(skipAbsences) => update({ skipAbsences })}
        />
        <SwitchRow
          id="daily-log-reminders-own-time"
          label="Staff can pick their own time"
          help="In Settings → Preferences. The times above apply until someone changes theirs."
          checked={settings.staffPickOwnTime}
          disabled={off}
          onChange={(staffPickOwnTime) => update({ staffPickOwnTime })}
        />
        <SwitchRow
          id="daily-log-reminders-admin-list"
          label="Show admins who's still missing"
          help="The next morning on admins' dashboards, and the last five work days in Office alerts. No extra message to staff."
          checked={settings.adminMissingList}
          disabled={disabled}
          onChange={(adminMissingList) => update({ adminMissingList })}
        />

        <div className="grid gap-1.5">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">What staff see</p>
          <div className="flex items-start gap-3 rounded-lg border bg-muted p-3">
            <IconBell className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" />
            <div className="grid min-w-0 gap-0.5">
              <p className="flex justify-between gap-2 text-sm font-medium">
                Daily log
                <span className="text-xs font-normal text-muted-foreground tabular-nums">{clockLabel(settings.fieldTime)}</span>
              </p>
              <p className="text-sm text-muted-foreground">{reminderBody("the job they were scheduled on", true)}</p>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {canEdit ? (
            <>
              <Button type="submit" size="sm" disabled={pending}>Save</Button>
              {customized ? (
                <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={reset}>Reset to defaults</Button>
              ) : null}
            </>
          ) : (
            <p className="text-xs text-muted-foreground">Only admins can change these settings.</p>
          )}
        </div>
      </form>
    </section>
  )
}
