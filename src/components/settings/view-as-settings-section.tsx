"use client"

import * as React from "react"

import { getViewAsStaffOptions } from "@/app/actions/view-as"
import { useFeatureSettingsEditor } from "@/hooks/use-feature-settings-editor"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { FEATURE_SETTINGS } from "@/lib/feature-settings/registry"

const GROUP = FEATURE_SETTINGS["view-as"]

type Person = { readonly id: string; readonly name: string }

/**
 * Settings > People > View as: on/off for the company, and which staff
 * besides admins may use it. Only staff are offered; the server also
 * re-checks on every request that each listed person is still staff.
 */
export function ViewAsSettingsSection(): React.ReactElement {
  const { loaded, canEdit, error, pending, settings, save } = useFeatureSettingsEditor("view-as", {
    savedMessage: "View as setting saved.",
  })
  const [people, setPeople] = React.useState<readonly Person[]>([])

  React.useEffect(() => {
    void getViewAsStaffOptions().then((result) => {
      if (result.success) setPeople(result.data)
    })
  }, [])

  function toggleStaff(userId: string, on: boolean): void {
    const next = new Set(settings.extraStaffUserIds)
    if (on) next.add(userId)
    else next.delete(userId)
    save({ ...settings, extraStaffUserIds: [...next] })
  }

  return (
    <section aria-labelledby="view-as-settings" className="space-y-4 border-b pb-6">
      <div>
        <h2 id="view-as-settings" className="text-base font-semibold">
          {GROUP.label}
        </h2>
        <p className="max-w-prose text-sm text-muted-foreground">{GROUP.description}</p>
      </div>
      {error ? <p className="text-sm text-muted-foreground">{error}</p> : null}
      {!loaded && !error ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
      {loaded ? (
        <>
          <div className="flex items-start gap-3">
            <Switch
              id="view-as-enabled"
              checked={settings.enabled}
              disabled={pending || !canEdit}
              onCheckedChange={(checked) => save({ ...settings, enabled: checked })}
            />
            <div className="space-y-1">
              <Label htmlFor="view-as-enabled">Allow View as</Label>
              <p className="text-xs text-muted-foreground">
                {settings.enabled
                  ? "On: admins can use View as from developer mode."
                  : "Off: nobody in this company can use View as, admins included."}
                {canEdit ? "" : " Only the full admin can change this."}
              </p>
            </div>
          </div>
          {settings.enabled ? (
            <fieldset className="grid gap-2" disabled={pending || !canEdit}>
              <legend className="text-sm font-medium">Also allow these staff</legend>
              <p className="max-w-prose text-sm text-muted-foreground">
                Admins can always use it. People chosen here get the developer mode switch too, because View as only
                works with developer mode on. Owners and vendors can never use View as.
              </p>
              <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
                {people.map((person) => {
                  const id = `view-as-staff-${person.id}`
                  return (
                    <label key={person.id} htmlFor={id} className="flex items-center gap-2 text-sm">
                      <Checkbox
                        id={id}
                        checked={settings.extraStaffUserIds.includes(person.id)}
                        onCheckedChange={(value) => toggleStaff(person.id, value === true)}
                      />
                      <span>{person.name}</span>
                    </label>
                  )
                })}
              </div>
            </fieldset>
          ) : null}
        </>
      ) : null}
    </section>
  )
}
