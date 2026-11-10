"use client"

import * as React from "react"
import { useFeatureSettingsEditor } from "@/hooks/use-feature-settings-editor"
import { useDepartmentProfiles } from "@/components/branding/department-profiles-provider"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { FEATURE_SETTINGS } from "@/lib/feature-settings/registry"

const GROUP = FEATURE_SETTINGS["project-duplicates"]
const DEPARTMENTS = ["O", "H", "N", "D"] as const
type Department = (typeof DEPARTMENTS)[number]

/** Which departments' customers place repeat orders, for the duplicate project check. */
export function ProjectDuplicateSettingsSection(): React.ReactElement {
  const profiles = useDepartmentProfiles()
  const [repeatOrders, setRepeatOrders] = React.useState<ReadonlySet<Department>>(
    new Set(GROUP.defaults.repeatOrderDepartments),
  )
  const { loaded, canEdit, customized, error, pending, save: saveSettings, reset } = useFeatureSettingsEditor(
    "project-duplicates",
    {
      savedMessage: "Duplicate project check saved.",
      resetMessage: "Duplicate project check reset to defaults.",
      onLoaded: (settings) => setRepeatOrders(new Set(settings.repeatOrderDepartments))
    },
  )

  function toggle(department: Department, checked: boolean): void {
    setRepeatOrders((current) => {
      const next = new Set(current)
      if (checked) next.add(department)
      else next.delete(department)
      return next
    })
  }

  function save(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    saveSettings({ repeatOrderDepartments: DEPARTMENTS.filter((department) => repeatOrders.has(department)) })
  }

  const disabled = pending || !canEdit
  const defaultNames = GROUP.defaults.repeatOrderDepartments
    .map((department) => profiles[department].shortName)
    .join(", ")
  return (
    <section aria-labelledby="project-duplicate-settings" className="space-y-4 border-b pb-6">
      <div>
        <h2 id="project-duplicate-settings" className="text-base font-semibold">{GROUP.label}</h2>
        <p className="text-sm text-muted-foreground">{GROUP.description}</p>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {!loaded && !error ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
      {loaded ? (
        <form onSubmit={save} className="space-y-4">
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Customers place repeat orders in</legend>
            <p className="text-xs text-muted-foreground">
              Jobs in these departments with different project numbers aren&apos;t flagged just for sharing a
              customer and name. A shared site address, Sage job, Drive folder or Buildertrend project is still
              flagged.
            </p>
            <div className="flex flex-wrap gap-x-6 gap-y-2 pt-1">
              {DEPARTMENTS.map((department) => (
                <div key={department} className="flex items-center gap-2">
                  <Checkbox
                    id={`repeat-orders-${department}`}
                    checked={repeatOrders.has(department)}
                    disabled={disabled}
                    onCheckedChange={(checked) => toggle(department, checked === true)}
                  />
                  <Label htmlFor={`repeat-orders-${department}`} className="font-normal">
                    {profiles[department].shortName}
                  </Label>
                </div>
              ))}
            </div>
          </fieldset>
          <div className="flex flex-wrap items-center gap-2">
            {canEdit ? (
              <>
                <Button type="submit" size="sm" disabled={pending}>Save</Button>
                {customized ? <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={reset}>Reset to defaults</Button> : null}
              </>
            ) : (
              <p className="text-xs text-muted-foreground">Only admins can change these settings.</p>
            )}
            <p className="ml-auto text-xs text-muted-foreground">Default: {defaultNames}.</p>
          </div>
        </form>
      ) : null}
    </section>
  )
}
