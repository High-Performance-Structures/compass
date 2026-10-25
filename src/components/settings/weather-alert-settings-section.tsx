"use client"

import * as React from "react"
import { toast } from "sonner"

import { getFeatureSettingsForEditor, resetFeatureSettings, saveFeatureSettings } from "@/app/actions/feature-settings"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  FEATURE_SETTINGS,
  weatherAlertSettingsSchema,
  type WeatherAlertSettings,
} from "@/lib/feature-settings/registry"

const KEY = "weather-alerts"
const DEFAULTS = FEATURE_SETTINGS[KEY].defaults

type LimitField = keyof WeatherAlertSettings

const FIELDS: readonly { readonly key: LimitField; readonly label: string; readonly unit: string; readonly min: number; readonly max: number; readonly step: number }[] = [
  { key: "snowIn", label: "Heavy snow: more than", unit: "in. in 24 hours", min: 0.5, max: 48, step: 0.5 },
  { key: "rainIn", label: "Heavy rain: more than", unit: "in. in 24 hours", min: 0.1, max: 10, step: 0.1 },
  { key: "gustMph", label: "Strong wind: gusts over", unit: "mph", min: 10, max: 120, step: 1 },
  { key: "coldF", label: "Extreme cold: a low at or below", unit: "°F", min: -60, max: 50, step: 1 },
  { key: "heatF", label: "Extreme heat: a high at or above", unit: "°F", min: 60, max: 130, step: 1 },
  { key: "fireMiles", label: "Wildfire: an active fire within", unit: "miles of a job", min: 1, max: 200, step: 1 },
]

const asText = (settings: WeatherAlertSettings): Readonly<Record<LimitField, string>> => ({
  snowIn: String(settings.snowIn),
  rainIn: String(settings.rainIn),
  gustMph: String(settings.gustMph),
  coldF: String(settings.coldF),
  heatF: String(settings.heatF),
  fireMiles: String(settings.fireMiles),
})

/** Company limits that flag jobs on the map's Weather and Fire & smoke layers. */
export function WeatherAlertSettingsSection(): React.ReactElement {
  const [loaded, setLoaded] = React.useState(false)
  const [canEdit, setCanEdit] = React.useState(false)
  const [customized, setCustomized] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [values, setValues] = React.useState<Readonly<Record<LimitField, string>>>(asText(DEFAULTS))
  const [pending, startTransition] = React.useTransition()

  const load = React.useCallback(async () => {
    const result = await getFeatureSettingsForEditor(KEY)
    if (!result.success) {
      setError(result.error)
      return
    }
    const parsed = weatherAlertSettingsSchema.safeParse(result.data.settings)
    setValues(asText(parsed.success ? parsed.data : DEFAULTS))
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
    const parsed = weatherAlertSettingsSchema.safeParse({
      snowIn: Number(values.snowIn),
      rainIn: Number(values.rainIn),
      gustMph: Number(values.gustMph),
      coldF: Number(values.coldF),
      heatF: Number(values.heatF),
      fireMiles: Number(values.fireMiles),
    })
    if (!parsed.success) {
      toast.error("Check each limit: whole numbers for wind, temperatures and miles, within the allowed range.")
      return
    }
    startTransition(async () => {
      const result = await saveFeatureSettings(KEY, parsed.data)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success("Weather and fire limits saved")
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
      toast.success("Weather and fire limits reset")
      await load()
    })
  }

  return (
    <section aria-labelledby="weather-alert-settings" className="space-y-4 border-b pb-6">
      <div>
        <h2 id="weather-alert-settings" className="text-base font-semibold">{FEATURE_SETTINGS[KEY].label}</h2>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{FEATURE_SETTINGS[KEY].description}</p>
        <p className="mt-1 max-w-3xl text-xs text-muted-foreground">
          Forecasts come from the National Weather Service for each job site&apos;s own forecast area, so a job in the mountains
          gets the mountain forecast. Wildfires come from the national interagency fire map. Turn the layers on from Layers on
          the dashboard map.
        </p>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {!loaded && !error ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
      {loaded ? (
        <form className="max-w-3xl space-y-4" onSubmit={save}>
          <ul className="divide-y border-y">
            {FIELDS.map((field) => (
              <li key={field.key} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                <Label htmlFor={`weather-${field.key}`} className="min-w-56 font-normal">{field.label}</Label>
                <Input
                  id={`weather-${field.key}`}
                  type="number"
                  inputMode="decimal"
                  min={field.min}
                  max={field.max}
                  step={field.step}
                  value={values[field.key]}
                  disabled={disabled}
                  onChange={(event) => setValues({ ...values, [field.key]: event.target.value })}
                  className="h-9 w-24 tabular-nums"
                />
                <span className="text-sm text-muted-foreground">{field.unit}</span>
              </li>
            ))}
          </ul>
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
