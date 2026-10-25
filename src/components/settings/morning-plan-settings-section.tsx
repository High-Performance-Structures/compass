"use client"

import * as React from "react"
import { toast } from "sonner"

import { getFeatureSettingsForEditor, resetFeatureSettings, saveFeatureSettings } from "@/app/actions/feature-settings"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import {
  FEATURE_SETTINGS,
  morningPlanSettingsSchema,
  type MorningPlanSettings,
} from "@/lib/feature-settings/registry"

const KEY = "morning-plan"
const DEFAULTS = FEATURE_SETTINGS[KEY].defaults

/** Company settings for Today's plan and weekly overload warnings. */
export function MorningPlanSettingsSection(): React.ReactElement {
  const [loaded, setLoaded] = React.useState(false)
  const [canEdit, setCanEdit] = React.useState(false)
  const [customized, setCustomized] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [settings, setSettings] = React.useState<MorningPlanSettings>(DEFAULTS)
  const [threshold, setThreshold] = React.useState(String(DEFAULTS.overloadThresholdPercent))
  const [todoWorkdays, setTodoWorkdays] = React.useState(String(DEFAULTS.todoWorkdays))
  const [pending, startTransition] = React.useTransition()

  const load = React.useCallback(async () => {
    const result = await getFeatureSettingsForEditor(KEY)
    if (!result.success) {
      setError(result.error)
      return
    }
    const parsed = morningPlanSettingsSchema.safeParse(result.data.settings)
    const value = parsed.success ? parsed.data : DEFAULTS
    setSettings(value)
    setThreshold(String(value.overloadThresholdPercent))
    setTodoWorkdays(String(value.todoWorkdays))
    setCanEdit(result.data.canEdit)
    setCustomized(result.data.customized)
    setLoaded(true)
  }, [])

  React.useEffect(() => {
    void load()
  }, [load])

  const disabled = !canEdit || pending

  function save(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    const parsed = morningPlanSettingsSchema.safeParse({
      ...settings,
      overloadThresholdPercent: Number(threshold),
      todoWorkdays: Number(todoWorkdays),
    })
    if (!parsed.success) {
      toast.error("Use a threshold from 50% to 300%, and 0 to 2 workdays per to-do.")
      return
    }
    startTransition(async () => {
      const result = await saveFeatureSettings(KEY, parsed.data)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success("Today's plan settings saved")
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
      toast.success("Today's plan settings reset")
      await load()
    })
  }

  const switches = [
    { key: "enabled", label: "Show Today's plan on staff dashboards" },
    { key: "overloadWarnings", label: "Warn when someone's week is over capacity" },
    { key: "allowDailyDigest", label: "Let staff get their plan by email and push each morning" },
  ] as const

  return (
    <section aria-labelledby="morning-plan-settings" className="space-y-4 border-b pb-6">
      <div>
        <h2 id="morning-plan-settings" className="text-base font-semibold">{FEATURE_SETTINGS[KEY].label}</h2>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          Each staff member sees an ordered plan for the day: overdue work, what&apos;s due or underway today, today&apos;s
          meetings, then what starts later this week. Compass compares each person&apos;s assigned workdays this week with
          the workdays available on the company calendar and warns them, and office managers, when it&apos;s more than the
          threshold.
        </p>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {!loaded && !error ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
      {loaded ? (
        <form className="max-w-3xl space-y-5" onSubmit={save}>
          <ul className="divide-y border-y">
            {switches.map((item) => (
              <li key={item.key} className="flex items-center justify-between gap-3 py-2">
                <Label htmlFor={`morning-plan-${item.key}`} className="font-normal">{item.label}</Label>
                <Switch
                  id={`morning-plan-${item.key}`}
                  checked={settings[item.key]}
                  disabled={disabled}
                  onCheckedChange={(checked) => setSettings({ ...settings, [item.key]: checked })}
                />
              </li>
            ))}
          </ul>
          <div className="grid gap-3 sm:max-w-md sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="morning-plan-threshold">Warn above (% of workdays)</Label>
              <Input id="morning-plan-threshold" type="number" min={50} max={300} value={threshold} disabled={disabled}
                onChange={(event) => setThreshold(event.target.value)} className="h-9 w-24 tabular-nums" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="morning-plan-todo-workdays">Workdays per to-do</Label>
              <Input id="morning-plan-todo-workdays" type="number" min={0} max={2} step={0.25} value={todoWorkdays} disabled={disabled}
                onChange={(event) => setTodoWorkdays(event.target.value)} className="h-9 w-24 tabular-nums" />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Schedule items count the workdays they cover this week. Two items on the same days count twice.
          </p>
          {canEdit ? (
            <div className="flex flex-wrap gap-2">
              <Button type="submit" size="sm" disabled={pending}>Save</Button>
              {customized ? (
                <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={reset}>Reset to defaults</Button>
              ) : null}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">Only admins can change these settings.</p>
          )}
        </form>
      ) : null}
    </section>
  )
}
