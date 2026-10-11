"use client"

import * as React from "react"
import { toast } from "sonner"
import {
  getFeatureSettingsForEditor,
  resetFeatureSettings,
  saveFeatureSettings,
} from "@/app/actions/feature-settings"
import { useDepartmentProfiles } from "@/components/branding/department-profiles-provider"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { FEATURE_SETTINGS, projectDuplicateSettingsSchema } from "@/lib/feature-settings/registry"

const GROUP = FEATURE_SETTINGS["project-duplicates"]
const DEPARTMENTS = ["O", "H", "N", "D"] as const
type Department = (typeof DEPARTMENTS)[number]

/** Which departments' customers place repeat orders, for the duplicate project check. */
export function ProjectDuplicateSettingsSection(): React.ReactElement {
  const profiles = useDepartmentProfiles()
  const [loaded, setLoaded] = React.useState(false)
  const [canEdit, setCanEdit] = React.useState(false)
  const [customized, setCustomized] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [repeatOrders, setRepeatOrders] = React.useState<ReadonlySet<Department>>(
    new Set(GROUP.defaults.repeatOrderDepartments),
  )
  const [pending, startTransition] = React.useTransition()

  const load = React.useCallback(async () => {
    const result = await getFeatureSettingsForEditor("project-duplicates")
    if (!result.success) {
      setError(result.error)
      return
    }
    const parsed = projectDuplicateSettingsSchema.safeParse(result.data.settings)
    const settings = parsed.success ? parsed.data : GROUP.defaults
    setRepeatOrders(new Set(settings.repeatOrderDepartments))
    setCanEdit(result.data.canEdit)
    setCustomized(result.data.customized)
    setLoaded(true)
  }, [])

  React.useEffect(() => {
    void load()
  }, [load])

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
    startTransition(async () => {
      const result = await saveFeatureSettings("project-duplicates", {
        repeatOrderDepartments: DEPARTMENTS.filter((department) => repeatOrders.has(department)),
      })
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success("Duplicate project check saved.")
      await load()
    })
  }

  function reset(): void {
    startTransition(async () => {
      const result = await resetFeatureSettings("project-duplicates")
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success("Duplicate project check reset to defaults.")
      await load()
    })
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
