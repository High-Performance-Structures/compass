"use client"

import * as React from "react"
import { toast } from "sonner"

import { useFeatureSettingsEditor } from "@/hooks/use-feature-settings-editor"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  FEATURE_SETTINGS,
  internalDepartmentSettingsSchema
  } from "@/lib/feature-settings/registry"

const KEY = "internal-department"

/** Settings → Company: the name of the department that lists internal workspaces. */
export function InternalDepartmentSettingsSection(): React.ReactElement {
  const { canEdit, customized, error, pending, settings, setSettings, save: saveSettings, reset } = useFeatureSettingsEditor(KEY, {
    savedMessage: "Internal department saved.",
    resetMessage: "Back to the defaults."
  })

  const disabled = pending || !canEdit

  function save(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    const parsed = internalDepartmentSettingsSchema.safeParse(settings)
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Check the Internal department name.")
      return
    }
    saveSettings(parsed.data)
  }

  return (
    <section aria-labelledby="internal-department-settings" className="space-y-4 border-t pt-6">
      <div>
        <h2 id="internal-department-settings" className="text-base font-semibold">{FEATURE_SETTINGS[KEY].label}</h2>
        <p className="text-sm text-muted-foreground">{FEATURE_SETTINGS[KEY].description}</p>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <form onSubmit={save} className="grid max-w-2xl gap-4">
        <div className="grid gap-4 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)]">
          <div className="grid gap-1.5">
            <Label htmlFor="internal-department-name">Name</Label>
            <Input
              id="internal-department-name"
              value={settings.name}
              maxLength={24}
              disabled={disabled}
              onChange={(event) => setSettings((current) => ({ ...current, name: event.target.value }))}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="internal-department-description">Description</Label>
            <Input
              id="internal-department-description"
              value={settings.description}
              maxLength={200}
              disabled={disabled}
              onChange={(event) => setSettings((current) => ({ ...current, description: event.target.value }))}
            />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Shown as a Project Hub tab. Mark a project as an internal workspace on its Information page.
        </p>
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
