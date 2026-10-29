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
import { Input } from "@/components/ui/input"
import { DEFAULT_DEPARTMENT_PROFILES, DEPARTMENT_CODES } from "@/lib/department-profiles"
import { departmentProfilesSchema, portfolioMapSettingsSchema, type PortfolioMapSettings } from "@/lib/feature-settings/registry"
import { DEFAULT_PORTFOLIO_MAP_RULES, PORTFOLIO_PHASES, phaseForJobStatus, type PortfolioPhaseId } from "@/lib/portfolio-map/model"
import { DEFAULT_DEPARTMENT_VIEWS, type PortfolioDepartmentView } from "@/lib/portfolio-map/phases"
import { DEFAULT_MAP_STATE, MAP_STATES, isMapStateCode, type MapStateCode } from "@/lib/portfolio-map/states"
import { SALES_PIPELINE_DEPARTMENTS } from "@/lib/sales-pipeline/stages"
import type { ProjectDepartment } from "@/lib/project-branding"

const VIEW_OPTIONS: readonly { readonly value: PortfolioDepartmentView; readonly label: string }[] = [
  { value: "projects", label: "Projects" },
  { value: "sales", label: "Its own sales pipeline" },
  { value: "internal", label: "Internal" },
  { value: "off", label: "Not on the map" },
]

function builtInView(code: string): PortfolioDepartmentView {
  return DEFAULT_DEPARTMENT_VIEWS[code] ?? "projects"
}

function builtInSalesTitle(code: ProjectDepartment, displayName: string): string {
  return SALES_PIPELINE_DEPARTMENTS[code] ?? `${displayName} Sales`
}

type Choice = PortfolioPhaseId | "off"

/** A status's built-in choice: its phase, or off the map. */
function builtInChoice(status: ProjectAgingStatusRow): Choice {
  return phaseForJobStatus(status.id, status.label, DEFAULT_PORTFOLIO_MAP_RULES) ?? "off"
}

/**
 * Portfolio map: which view each department's jobs appear on (projects, its
 * own sales pipeline, internal, or none), and which job statuses appear and in
 * which pipeline phase. Rows left at the built-in
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
  const [views, setViews] = React.useState<Readonly<Record<string, PortfolioDepartmentView>>>({})
  const [salesTitles, setSalesTitles] = React.useState<Readonly<Record<string, string>>>({})
  const [mapState, setMapState] = React.useState<MapStateCode>(DEFAULT_MAP_STATE)
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
    const settings: PortfolioMapSettings = parsed.success ? parsed.data : DEFAULT_PORTFOLIO_MAP_RULES
    setStatuses(statusResult.rows)
    setChoices(Object.fromEntries(statusResult.rows.map((status) => [status.id, settings.statusPhases[status.id] ?? builtInChoice(status)])))
    setViews(Object.fromEntries(DEPARTMENT_CODES.map((code) => [code, settings.departmentViews[code] ?? builtInView(code)])))
    setSalesTitles(settings.salesTitles)
    setMapState(settings.mapState)
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
    const departmentViews: Record<string, PortfolioDepartmentView> = {}
    const titles: Record<string, string> = {}
    for (const code of DEPARTMENT_CODES) {
      const view = views[code]
      if (view && view !== builtInView(code)) departmentViews[code] = view
      const title = salesTitles[code]?.trim() ?? ""
      if (title && title !== builtInSalesTitle(code, departmentNames[code] ?? code)) titles[code] = title
    }
    startTransition(async () => {
      const result = await saveFeatureSettings("portfolio-map", { statusPhases, departmentViews, salesTitles: titles, mapState })
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

      <fieldset className="grid gap-2" disabled={!canEdit || pending}>
        <legend className="text-sm font-medium">Map state</legend>
        <p className="max-w-prose text-xs text-muted-foreground">
          The state shown on the dashboard map and on client and trade partner maps, with its terrain, major roads,
          weather and wildfires.
        </p>
        <Select
          value={mapState}
          onValueChange={(value) => {
            if (isMapStateCode(value)) setMapState(value)
          }}
        >
          <SelectTrigger aria-label="Map state" className="h-8 w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {MAP_STATES.map((state) => (
              <SelectItem key={state.code} value={state.code}>
                {state.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </fieldset>

      <fieldset className="grid gap-2" disabled={!canEdit || pending}>
        <legend className="text-sm font-medium">Where each department&apos;s jobs appear</legend>
        <p className="max-w-prose text-xs text-muted-foreground">
          Projects puts jobs in the construction pipeline. A sales pipeline gets its own button next to Projects, with
          the title you give it. Internal adds them to the Internal view with the offices and yards.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="py-2 pr-4 font-medium">Department</th>
                <th className="py-2 pr-4 font-medium">Map view</th>
                <th className="py-2 font-medium">Pipeline title</th>
              </tr>
            </thead>
            <tbody>
              {DEPARTMENT_CODES.map((code) => {
                const view = views[code] ?? builtInView(code)
                const name = departmentNames[code] ?? code
                return (
                  <tr key={code} className="border-b">
                    <td className="py-1.5 pr-4">
                      <Label htmlFor={`map-view-${code}`}>{name}</Label>
                    </td>
                    <td className="py-1.5 pr-4">
                      <Select
                        value={view}
                        onValueChange={(value) => {
                          const next = VIEW_OPTIONS.find((option) => option.value === value)?.value
                          if (next) setViews((current) => ({ ...current, [code]: next }))
                        }}
                      >
                        <SelectTrigger id={`map-view-${code}`} className="h-8 w-56">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {VIEW_OPTIONS.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="py-1.5">
                      {view === "sales" ? (
                        <Input
                          className="h-8 w-56"
                          aria-label={`${name} pipeline title`}
                          maxLength={60}
                          placeholder={builtInSalesTitle(code, name)}
                          value={salesTitles[code] ?? ""}
                          onChange={(event) => setSalesTitles((current) => ({ ...current, [code]: event.target.value }))}
                        />
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
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
