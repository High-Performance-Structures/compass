"use client"

import * as React from "react"
import { toast } from "sonner"

import { getFeatureSettingsForEditor, resetFeatureSettings, saveFeatureSettings } from "@/app/actions/feature-settings"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { FEATURE_SETTINGS, projectTimelineSettingsSchema, type ProjectTimelineSettings } from "@/lib/feature-settings/registry"
import { PROJECT_TIMELINE_KIND_LABELS, PROJECT_TIMELINE_KINDS } from "@/lib/project-timeline/model"

const KEY = "project-timeline"
const DEFAULTS = FEATURE_SETTINGS[KEY].defaults

/** What each job's Overview timeline shows, and how many days at a time. */
export function ProjectTimelineSettingsSection(): React.ReactElement {
  const [settings, setSettings] = React.useState<ProjectTimelineSettings>(DEFAULTS)
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
    const parsed = projectTimelineSettingsSchema.safeParse(result.data.settings)
    setSettings(parsed.success ? parsed.data : DEFAULTS)
    setCanEdit(result.data.canEdit)
    setCustomized(result.data.customized)
  }, [])

  React.useEffect(() => {
    void load()
  }, [load])

  const disabled = pending || !canEdit

  function save(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    const parsed = projectTimelineSettingsSchema.safeParse(settings)
    if (!parsed.success) {
      toast.error("Show between 3 and 60 days at a time.")
      return
    }
    startTransition(async () => {
      const result = await saveFeatureSettings(KEY, parsed.data)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success("Project timeline settings saved.")
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
    <section aria-labelledby="project-timeline-settings" className="space-y-6 border-b pb-6">
      <div>
        <h2 id="project-timeline-settings" className="text-base font-semibold">{FEATURE_SETTINGS[KEY].label}</h2>
        <p className="text-sm text-muted-foreground">{FEATURE_SETTINGS[KEY].description}</p>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <form onSubmit={save} className="grid max-w-2xl gap-6">
        <fieldset className="grid gap-2">
          <legend className="text-sm font-semibold">Show</legend>
          <p className="text-xs text-muted-foreground">Staff see the timeline. Owner updates still use only daily logs and photos marked for the owner.</p>
          <div className="grid gap-2 sm:grid-cols-3">
            {PROJECT_TIMELINE_KINDS.map((kind) => (
              <label key={kind} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={settings.kinds.includes(kind)}
                  disabled={disabled}
                  onCheckedChange={(checked) =>
                    setSettings({
                      ...settings,
                      kinds: checked === true
                        ? PROJECT_TIMELINE_KINDS.filter((item) => item === kind || settings.kinds.includes(item))
                        : settings.kinds.filter((item) => item !== kind),
                    })
                  }
                />
                {PROJECT_TIMELINE_KIND_LABELS[kind]}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="flex items-start justify-between gap-4">
          <div>
            <Label htmlFor="project-timeline-days">Days shown at a time</Label>
            <p className="text-xs text-muted-foreground">“Show earlier” adds the same number of days again.</p>
          </div>
          <Input
            id="project-timeline-days"
            type="number"
            min={3}
            max={60}
            value={settings.days}
            disabled={disabled}
            onChange={(event) => setSettings({ ...settings, days: Number(event.target.value) })}
            className="w-20"
          />
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
