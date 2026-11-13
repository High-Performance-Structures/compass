"use client"

import * as React from "react"

import { useFeatureSettingsEditor } from "@/hooks/use-feature-settings-editor"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { FEATURE_SETTINGS } from "@/lib/feature-settings/registry"

const KEY = "schedule-confirmations"

/** Whether moving a schedule item's dates asks its subs and vendors to confirm again. */
export function ScheduleConfirmationSettingsSection(): React.ReactElement {
  const { canEdit, error, pending, settings, setSettings, save } = useFeatureSettingsEditor(KEY, {
    savedMessage: "Schedule confirmation settings saved.",
  })

  function submit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    save(settings)
  }

  return (
    <section aria-labelledby="schedule-confirmation-settings" className="space-y-4 border-b pb-6">
      <div>
        <h2 id="schedule-confirmation-settings" className="text-base font-semibold">{FEATURE_SETTINGS[KEY].label}</h2>
        <p className="text-sm text-muted-foreground">{FEATURE_SETTINGS[KEY].description}</p>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <form onSubmit={submit} className="grid max-w-2xl gap-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <Label htmlFor="schedule-reask-on-date-move">Ask again when dates move</Label>
            <p className="text-xs text-muted-foreground">
              When an item&apos;s start date or duration changes (by hand, through a dependency or a calendar change), its subs and vendors are asked to confirm the new dates. Off: answers given for the old dates stay.
            </p>
          </div>
          <Switch
            id="schedule-reask-on-date-move"
            checked={settings.reaskOnDateMove}
            disabled={pending || !canEdit}
            onCheckedChange={(reaskOnDateMove) => setSettings((current) => ({ ...current, reaskOnDateMove }))}
          />
        </div>
        <div>
          {canEdit ? (
            <Button type="submit" size="sm" disabled={pending}>Save</Button>
          ) : (
            <p className="text-xs text-muted-foreground">Only admins can change these settings.</p>
          )}
        </div>
      </form>
    </section>
  )
}
