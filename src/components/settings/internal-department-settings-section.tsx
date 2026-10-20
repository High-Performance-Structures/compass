"use client"

import * as React from "react"
import { toast } from "sonner"

import { getFeatureSettingsForEditor, resetFeatureSettings, saveFeatureSettings } from "@/app/actions/feature-settings"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  FEATURE_SETTINGS,
  internalDepartmentSettingsSchema,
  type InternalDepartmentSettings,
} from "@/lib/feature-settings/registry"

const KEY = "internal-department"
const DEFAULTS = FEATURE_SETTINGS[KEY].defaults

/** Settings → Company: the name of the department that lists internal workspaces. */
export function InternalDepartmentSettingsSection(): React.ReactElement {
  const [settings, setSettings] = React.useState<InternalDepartmentSettings>(DEFAULTS)
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
    const parsed = internalDepartmentSettingsSchema.safeParse(result.data.settings)
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
    const parsed = internalDepartmentSettingsSchema.safeParse(settings)
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Check the Internal department name.")
      return
    }
    startTransition(async () => {
      const result = await saveFeatureSettings(KEY, parsed.data)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success("Internal department saved.")
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
