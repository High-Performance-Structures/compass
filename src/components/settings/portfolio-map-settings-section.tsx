"use client"

import * as React from "react"
import { toast } from "sonner"
import {
  getFeatureSettingsForEditor,
  resetFeatureSettings,
  saveFeatureSettings,
} from "@/app/actions/feature-settings"
import { getProjectAgingStatusRows, type ProjectAgingStatusRow } from "@/app/actions/project-profile"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { DEFAULT_DEPARTMENT_PROFILES, DEPARTMENT_CODES } from "@/lib/department-profiles"
import { departmentProfilesSchema, portfolioMapSettingsSchema, type PortfolioMapSettings } from "@/lib/feature-settings/registry"
import { DEFAULT_PORTFOLIO_MAP_RULES, PORTFOLIO_PHASES, phaseForJobStatus, type PortfolioPhaseId } from "@/lib/portfolio-map/model"
import { DEFAULT_UNMAPPED_DEPARTMENTS } from "@/lib/portfolio-map/phases"

type Choice = PortfolioPhaseId | "off"

/** A status's built-in choice: its phase, or off the map. */
function builtInChoice(status: ProjectAgingStatusRow): Choice {
  return phaseForJobStatus(status.id, status.label, DEFAULT_PORTFOLIO_MAP_RULES) ?? "off"
}

/**
 * Portfolio map: which job statuses appear on the dashboard map and in which
 * pipeline phase, and which departments appear. Rows left at the built-in
 * choice aren't stored. Internal workspaces have their own Internal view, and
 * a single job can still be shown or hidden from the map itself.
 */
export function PortfolioMapSettingsSection(): React.ReactElement {
  const [loaded, setLoaded] = React.useState(false)
  const [canEdit, setCanEdit] = React.useState(false)
  const [customized, setCustomized] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [statuses, setStatuses] = React.useState<readonly ProjectAgingStatusRow[]>([])
  const [choices, setChoices] = React.useState<Readonly<Record<string, Choice>>>({})
  const [departments, setDepartments] = React.useState<Readonly<Record<string, boolean>>>({})
  const [departmentNames, setDepartmentNames] = React.useState<Readonly<Record<string, string>>>(
    Object.fromEntries(DEPARTMENT_CODES.map((code) => [code, DEFAULT_DEPARTMENT_PROFILES[code].displayName])),
  )
  const [pending, startTransition] = React.useTransition()

  const load = React.useCallback(async () => {
    const [result, statusResult, departmentResult] = await Promise.all([
      getFeatureSettingsForEditor("portfolio-map"),
      getProjectAgingStatusRows(),
      getFeatureSettingsForEditor("department-profiles"),
    ])
    if (departmentResult.success) {
      const parsed = departmentProfilesSchema.safeParse(departmentResult.data.settings)
      if (parsed.success) {
        setDepartmentNames(Object.fromEntries(DEPARTMENT_CODES.map((code) => [code, parsed.data.departments[code].displayName])))
      }
    }
    if (!result.success) {
      setError(result.error)
      return
    }
    if (!statusResult.success) {
      setError(statusResult.error)
      return
    }
    const parsed = portfolioMapSettingsSchema.safeParse(result.data.settings)
    const settings: PortfolioMapSettings = parsed.success ? parsed.data : { statusPhases: {}, departments: {} }
    setStatuses(statusResult.rows)
    setChoices(Object.fromEntries(statusResult.rows.map((status) => [status.id, settings.statusPhases[status.id] ?? builtInChoice(status)])))
    setDepartments(
      Object.fromEntries(DEPARTMENT_CODES.map((code) => [code, settings.departments[code] ?? !DEFAULT_UNMAPPED_DEPARTMENTS.includes(code)])),
    )
    setCanEdit(result.data.canEdit)
    setCustomized(result.data.customized)
    setLoaded(true)
  }, [])

  React.useEffect(() => {
    void load()
  }, [load])

  function save(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    // Store only the changes from the built-in mapping.
    const statusPhases: Record<string, Choice> = {}
    for (const status of statuses) {
      const choice = choices[status.id]
      if (choice && choice !== builtInChoice(status)) statusPhases[status.id] = choice
    }
    const changedDepartments: Record<string, boolean> = {}
    for (const code of DEPARTMENT_CODES) {
      const shown = departments[code]
      if (shown !== undefined && shown === DEFAULT_UNMAPPED_DEPARTMENTS.includes(code)) changedDepartments[code] = shown
    }
    startTransition(async () => {
      const result = await saveFeatureSettings("portfolio-map", { statusPhases, departments: changedDepartments })
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success("Portfolio map settings saved")
      await load()
    })
  }

  function reset(): void {
    startTransition(async () => {
      const result = await resetFeatureSettings("portfolio-map")
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success("Portfolio map settings reset")
      await load()
    })
  }

  if (error) return <p className="text-sm text-destructive">{error}</p>
  if (!loaded) return <p className="text-sm text-muted-foreground">Loading…</p>

  return (
    <form onSubmit={save} className="grid gap-6">
      <p className="max-w-prose text-sm text-muted-foreground">
        Which jobs appear on the dashboard map and pipelines by default, and the phase each job status falls in. Any job can
        still be shown or hidden from the map itself. Offices and yards appear on the map&apos;s Internal view instead.
      </p>

      <fieldset className="grid gap-3" disabled={!canEdit || pending}>
        <legend className="text-sm font-medium">Departments on the map</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {DEPARTMENT_CODES.map((code) => (
            <div key={code} className="flex items-center justify-between gap-3 border-b py-2">
              <Label htmlFor={`map-department-${code}`}>{departmentNames[code]}</Label>
              <Switch
                id={`map-department-${code}`}
                checked={departments[code] ?? false}
                onCheckedChange={(checked) => setDepartments((current) => ({ ...current, [code]: checked }))}
              />
            </div>
          ))}
        </div>
      </fieldset>

      <fieldset className="grid gap-2" disabled={!canEdit || pending}>
        <legend className="text-sm font-medium">Job statuses</legend>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="py-2 pr-4 font-medium">Status</th>
                <th className="py-2 font-medium">On the map</th>
              </tr>
            </thead>
            <tbody>
              {statuses.map((status) => {
                const choice = choices[status.id] ?? builtInChoice(status)
                return (
                  <tr key={status.id} className="border-b">
                    <td className="py-1.5 pr-4">
                      {status.label}
                      {status.custom ? <span className="ml-2 text-xs text-muted-foreground">Custom</span> : null}
                    </td>
                    <td className="py-1.5">
                      <Select
                        value={choice}
                        onValueChange={(value) =>
                          setChoices((current) => ({ ...current, [status.id]: value === "off" ? "off" : PORTFOLIO_PHASES.find((phase) => phase.id === value)?.id ?? "off" }))
                        }
                      >
                        <SelectTrigger className="h-8 w-56" aria-label={`${status.label} on the map`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="off">Not on the map</SelectItem>
                          {PORTFOLIO_PHASES.map((phase) => (
                            <SelectItem key={phase.id} value={phase.id}>
                              {phase.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </fieldset>

      {canEdit ? (
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={pending}>
            Save
          </Button>
          {customized ? (
            <Button type="button" variant="outline" disabled={pending} onClick={reset}>
              Reset to defaults
            </Button>
          ) : null}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Only admins can change these settings.</p>
      )}
    </form>
  )
}
