"use client"

import * as React from "react"
import { toast } from "sonner"

import { getFeatureSettingsForEditor, resetFeatureSettings, saveFeatureSettings } from "@/app/actions/feature-settings"
import {
  FEATURE_SETTINGS,
  type FeatureSettingsKey,
  type FeatureSettingsValue,
} from "@/lib/feature-settings/registry"

/*
 * The load / save / reset plumbing every company-settings section in
 * Settings shares (src/components/settings/*-settings-section.tsx). The
 * section only draws its inputs and decides what to save.
 *
 * - Loads the company's saved value for `key`, checked against the registry
 *   schema (src/lib/feature-settings/registry.ts); a value that no longer
 *   fits falls back to the defaults.
 * - `canEdit` comes from the server (admins, or the roles the registry names).
 * - `save(value)` and `reset()` show a toast and reload.
 */
export function useFeatureSettingsEditor<K extends FeatureSettingsKey>(
  key: K,
  {
    savedMessage,
    resetMessage,
    onLoaded,
  }: {
    /** Toast after a save, such as "Daily log reminder settings saved." */
    readonly savedMessage: string
    /** Toast after "Reset to defaults". */
    readonly resetMessage: string
    /** For sections that keep extra input state (text boxes for numbers). */
    readonly onLoaded?: (value: FeatureSettingsValue<K>) => void
  },
) {
  const group = FEATURE_SETTINGS[key]
  const [settings, setSettings] = React.useState<FeatureSettingsValue<K>>(group.defaults)
  const [loaded, setLoaded] = React.useState(false)
  const [canEdit, setCanEdit] = React.useState(false)
  const [customized, setCustomized] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [pending, startTransition] = React.useTransition()

  // Kept in a ref so a new callback each render doesn't reload the settings.
  const onLoadedRef = React.useRef(onLoaded)
  onLoadedRef.current = onLoaded

  const load = React.useCallback(async () => {
    const result = await getFeatureSettingsForEditor(key)
    if (!result.success) {
      setError(result.error)
      return
    }
    const parsed = group.schema.safeParse(result.data.settings)
    const value = parsed.success ? parsed.data : group.defaults
    setSettings(value)
    setCanEdit(result.data.canEdit)
    setCustomized(result.data.customized)
    setLoaded(true)
    onLoadedRef.current?.(value)
  }, [key, group])

  React.useEffect(() => {
    void load()
  }, [load])

  /** Merge a few fields into the unsaved settings. */
  function update(patch: Partial<FeatureSettingsValue<K>>): void {
    setSettings((current) => ({ ...current, ...patch }))
  }

  function save(value: FeatureSettingsValue<K>): void {
    startTransition(async () => {
      const result = await saveFeatureSettings(key, value)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success(savedMessage)
      await load()
    })
  }

  function reset(): void {
    startTransition(async () => {
      const result = await resetFeatureSettings(key)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success(resetMessage)
      await load()
    })
  }

  return {
    settings,
    setSettings,
    update,
    loaded,
    canEdit,
    customized,
    error,
    pending,
    /** True while saving or when this person can't edit company settings. */
    disabled: pending || !canEdit,
    save,
    reset,
    reload: load,
  }
}
