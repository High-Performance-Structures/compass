"use client"

import * as React from "react"
import { toast } from "sonner"

import { useFeatureSettingsEditor } from "@/hooks/use-feature-settings-editor"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { FEATURE_SETTINGS, projectTimelineSettingsSchema } from "@/lib/feature-settings/registry"
import { PROJECT_TIMELINE_KIND_LABELS, PROJECT_TIMELINE_KINDS } from "@/lib/project-timeline/model"

const KEY = "project-timeline"

/** What each job's Overview timeline shows, and how many days at a time. */
export function ProjectTimelineSettingsSection(): React.ReactElement {
  const { canEdit, customized, error, pending, settings, setSettings, save: saveSettings, reset } = useFeatureSettingsEditor(KEY, {
    savedMessage: "Project timeline settings saved.",
    resetMessage: "Back to the defaults."
  })

  const disabled = pending || !canEdit

  function save(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    const parsed = projectTimelineSettingsSchema.safeParse(settings)
    if (!parsed.success) {
      toast.error("Show between 3 and 60 days at a time.")
      return
    }
    saveSettings(parsed.data)
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
                        : settings.kinds.filter((item) => item !== kind)
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
