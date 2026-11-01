"use client"

import * as React from "react"
import { toast } from "sonner"

import { getFeatureSettingsForEditor, resetFeatureSettings, saveFeatureSettings } from "@/app/actions/feature-settings"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { FEATURE_SETTINGS } from "@/lib/feature-settings/registry"
import { weatherAlertSettingsSchema, type WeatherAlertSettings } from "@/lib/weather/settings"
import { SMOKE_LEVEL_LABEL, SMOKE_LEVELS, type SmokeLevel } from "@/lib/weather/air"
import { WEATHER_RULE_CHECK_LABEL, WEATHER_RULE_CHECKS, type WeatherRuleCheck } from "@/lib/weather/schedule-risk"

const KEY = "weather-alerts"
const DEFAULTS = FEATURE_SETTINGS[KEY].defaults

type LimitField = "snowIn" | "rainIn" | "gustMph" | "coldF" | "heatF" | "fireMiles" | "aqi"

/** A work rule as edited: keywords and numbers as typed. */
type RuleDraft = {
  readonly id: string
  readonly label: string
  readonly keywords: string
  readonly check: WeatherRuleCheck
  readonly value: string
  readonly daysAfter: string
}

const toDrafts = (settings: WeatherAlertSettings): RuleDraft[] =>
  settings.workRules.map((rule) => ({
    id: rule.id,
    label: rule.label,
    keywords: rule.keywords.join(", "),
    check: rule.check,
    value: String(rule.value),
    daysAfter: String(rule.daysAfter),
  }))

function isRuleCheck(value: string): value is WeatherRuleCheck {
  return WEATHER_RULE_CHECKS.some((check) => check === value)
}

const FIELDS: readonly { readonly key: LimitField; readonly label: string; readonly unit: string; readonly min: number; readonly max: number; readonly step: number }[] = [
  { key: "snowIn", label: "Heavy snow: more than", unit: "in. in 24 hours", min: 0.5, max: 48, step: 0.5 },
  { key: "rainIn", label: "Heavy rain: more than", unit: "in. in 24 hours", min: 0.1, max: 10, step: 0.1 },
  { key: "gustMph", label: "Strong wind: gusts over", unit: "mph", min: 10, max: 120, step: 1 },
  { key: "coldF", label: "Extreme cold: a low at or below", unit: "°F", min: -60, max: 50, step: 1 },
  { key: "heatF", label: "Extreme heat: a high at or above", unit: "°F", min: 60, max: 130, step: 1 },
  { key: "fireMiles", label: "Wildfire: an active fire within", unit: "miles of a job", min: 1, max: 200, step: 1 },
  { key: "aqi", label: "Air quality: an AQI at or above", unit: "now or forecast near a job (151 = Unhealthy)", min: 51, max: 500, step: 1 },
]

function isSmokeLevel(value: string): value is SmokeLevel {
  return SMOKE_LEVELS.some((level) => level === value)
}

const asText = (settings: WeatherAlertSettings): Readonly<Record<LimitField, string>> => ({
  snowIn: String(settings.snowIn),
  rainIn: String(settings.rainIn),
  gustMph: String(settings.gustMph),
  coldF: String(settings.coldF),
  heatF: String(settings.heatF),
  fireMiles: String(settings.fireMiles),
  aqi: String(settings.aqi),
})

/** Company limits that flag jobs on the map's Weather and Fire & smoke layers. */
export function WeatherAlertSettingsSection(): React.ReactElement {
  const [loaded, setLoaded] = React.useState(false)
  const [canEdit, setCanEdit] = React.useState(false)
  const [customized, setCustomized] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [values, setValues] = React.useState<Readonly<Record<LimitField, string>>>(asText(DEFAULTS))
  const [rules, setRules] = React.useState<readonly RuleDraft[]>(toDrafts(DEFAULTS))
  const [notify, setNotify] = React.useState(DEFAULTS.notifyScheduleRisks)
  const [smokeLevel, setSmokeLevel] = React.useState<SmokeLevel>(DEFAULTS.smokeLevel)
  const [pending, startTransition] = React.useTransition()

  const load = React.useCallback(async () => {
    const result = await getFeatureSettingsForEditor(KEY)
    if (!result.success) {
      setError(result.error)
      return
    }
    const parsed = weatherAlertSettingsSchema.safeParse(result.data.settings)
    const settings = parsed.success ? parsed.data : DEFAULTS
    setValues(asText(settings))
    setRules(toDrafts(settings))
    setNotify(settings.notifyScheduleRisks)
    setSmokeLevel(settings.smokeLevel)
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
      aqi: Number(values.aqi),
      smokeLevel,
      workRules: rules.map((rule) => ({
        id: rule.id,
        label: rule.label.trim(),
        keywords: rule.keywords.split(",").map((keyword) => keyword.trim()).filter((keyword) => keyword.length > 0),
        check: rule.check,
        value: Number(rule.value),
        daysAfter: Number(rule.daysAfter),
      })),
      notifyScheduleRisks: notify,
    })
    if (!parsed.success) {
      toast.error("Check each limit and rule: every rule needs a name, at least one word to match, and numbers in range.")
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
          gets the mountain forecast. Wildfires come from the national interagency fire map, smoke from NOAA satellite smoke
          mapping and air quality from EPA AirNow. Turn the layers on from Layers on the dashboard map.
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
            <li className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
              <Label htmlFor="weather-smokeLevel" className="min-w-56 font-normal">Smoke: over a job at</Label>
              <Select value={smokeLevel} disabled={disabled} onValueChange={(value) => { if (isSmokeLevel(value)) setSmokeLevel(value) }}>
                <SelectTrigger id="weather-smokeLevel" className="h-9 w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SMOKE_LEVELS.map((level) => (
                    <SelectItem key={level} value={level}>{SMOKE_LEVEL_LABEL[level]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <span className="text-sm text-muted-foreground">density or heavier</span>
            </li>
          </ul>
          <fieldset className="space-y-3">
            <legend className="text-sm font-medium">Scheduled work</legend>
            <p className="text-xs text-muted-foreground">
              Schedule items starting in the next 5 days are checked against their job site&apos;s forecast. An item matches a
              rule when its title contains one of the rule&apos;s words. Every item is also checked for weather warnings, heavy
              snow, extreme cold or heat and the air quality forecast using the limits above. At-risk items show on the job&apos;s overview.
            </p>
            <ul className="space-y-3">
              {rules.map((rule, index) => {
                const setRule = (next: Partial<RuleDraft>): void =>
                  setRules((current) => current.map((item, i) => (i === index ? { ...item, ...next } : item)))
                return (
                  <li key={rule.id} className="space-y-2 border p-3">
                    <div className="flex flex-wrap items-end gap-2">
                      <div className="min-w-48 flex-1 space-y-1">
                        <Label htmlFor={`weather-rule-${rule.id}-label`} className="text-xs">Rule name</Label>
                        <Input id={`weather-rule-${rule.id}-label`} value={rule.label} disabled={disabled} onChange={(event) => setRule({ label: event.target.value })} className="h-9" />
                      </div>
                      <Button type="button" size="sm" variant="ghost" disabled={disabled} onClick={() => setRules((current) => current.filter((_, i) => i !== index))}>
                        Delete rule
                      </Button>
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor={`weather-rule-${rule.id}-keywords`} className="text-xs">Items whose title contains (comma-separated)</Label>
                      <Input id={`weather-rule-${rule.id}-keywords`} value={rule.keywords} disabled={disabled} onChange={(event) => setRule({ keywords: event.target.value })} className="h-9" />
                    </div>
                    <div className="flex flex-wrap items-end gap-2">
                      <div className="space-y-1">
                        <Label htmlFor={`weather-rule-${rule.id}-check`} className="text-xs">Flag when</Label>
                        <Select value={rule.check} disabled={disabled} onValueChange={(value) => { if (isRuleCheck(value)) setRule({ check: value }) }}>
                          <SelectTrigger id={`weather-rule-${rule.id}-check`} className="h-9 w-40"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {WEATHER_RULE_CHECKS.map((check) => (
                              <SelectItem key={check} value={check}>{WEATHER_RULE_CHECK_LABEL[check].before}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor={`weather-rule-${rule.id}-value`} className="text-xs">{WEATHER_RULE_CHECK_LABEL[rule.check].unit}</Label>
                        <Input id={`weather-rule-${rule.id}-value`} type="number" inputMode="decimal" step="any" value={rule.value} disabled={disabled} onChange={(event) => setRule({ value: event.target.value })} className="h-9 w-24 tabular-nums" />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor={`weather-rule-${rule.id}-days`} className="text-xs">Also check days after</Label>
                        <Input id={`weather-rule-${rule.id}-days`} type="number" min={0} max={7} step={1} value={rule.daysAfter} disabled={disabled} onChange={(event) => setRule({ daysAfter: event.target.value })} className="h-9 w-20 tabular-nums" />
                      </div>
                    </div>
                  </li>
                )
              })}
            </ul>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={disabled || rules.length >= 20}
              onClick={() => setRules((current) => [...current, { id: `rule-${Date.now().toString(36)}`, label: "", keywords: "", check: "gust_over", value: "30", daysAfter: "0" }])}
            >
              Add rule
            </Button>
            <div className="flex items-center justify-between gap-3 border-t pt-3">
              <Label htmlFor="weather-notify" className="font-normal">
                Notify the item&apos;s assignee and the job&apos;s staff when scheduled work is at risk (once per item, rule and day)
              </Label>
              <Switch id="weather-notify" checked={notify} disabled={disabled} onCheckedChange={setNotify} />
            </div>
          </fieldset>
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
