"use client"

import * as React from "react"
import { toast } from "sonner"
import {
  getFeatureSettingsForEditor,
  resetFeatureSettings,
  saveFeatureSettings,
} from "@/app/actions/feature-settings"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { FEATURE_SETTINGS, projectAgingSettingsSchema, type ProjectAgingSettings } from "@/lib/feature-settings/registry"
import { PROJECT_AGING_LEVELS } from "@/lib/project-follow-up"
import { PROJECT_JOB_STATUS_DEFINITIONS } from "@/lib/project-profile"

/** Statuses that are followed up, with their built-in cadence as the default. */
const FOLLOWED_STATUSES = PROJECT_JOB_STATUS_DEFINITIONS.flatMap((status) =>
  status.followUpCadenceDays === null
    ? []
    : [{ id: status.id, label: status.label, dueDays: status.followUpCadenceDays, overdueDays: status.followUpCadenceDays + 1 }],
)

type Row = { readonly due: string; readonly overdue: string }

function rowsFrom(settings: ProjectAgingSettings): Readonly<Record<string, Row>> {
  return Object.fromEntries(
    FOLLOWED_STATUSES.map((status) => {
      const custom = settings.statuses[status.id]
      return [status.id, { due: String(custom?.dueDays ?? status.dueDays), overdue: String(custom?.overdueDays ?? status.overdueDays) }]
    }),
  )
}

const DEFAULT_ROWS = rowsFrom(FEATURE_SETTINGS["project-aging"].defaults)

function Swatch({ token }: { readonly token: string }): React.ReactElement {
  return <span className="size-2" style={{ background: `var(${token})` }} aria-hidden="true" />
}

/**
 * Project aging: when each status's client follow-up turns due (amber) and
 * overdue (red), in business days since the last logged client contact. Same
 * levels and colors as Message Desk aging; rows left at the default follow
 * the status's built-in cadence.
 */
export function ProjectAgingSettingsSection(): React.ReactElement {
  const [loaded, setLoaded] = React.useState(false)
  const [canEdit, setCanEdit] = React.useState(false)
  const [customized, setCustomized] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [rows, setRows] = React.useState<Readonly<Record<string, Row>>>(DEFAULT_ROWS)
  const [pending, startTransition] = React.useTransition()

  const load = React.useCallback(async () => {
    const result = await getFeatureSettingsForEditor("project-aging")
    if (!result.success) {
      setError(result.error)
      return
    }
    const parsed = projectAgingSettingsSchema.safeParse(result.data.settings)
    setRows(rowsFrom(parsed.success ? parsed.data : FEATURE_SETTINGS["project-aging"].defaults))
    setCanEdit(result.data.canEdit)
    setCustomized(result.data.customized)
    setLoaded(true)
  }, [])

  React.useEffect(() => {
    void load()
  }, [load])

  const setRow = (statusId: string, next: Partial<Row>): void => {
    setRows((current) => {
      const row = current[statusId] ?? { due: "", overdue: "" }
      return { ...current, [statusId]: { ...row, ...next } }
    })
  }

  function save(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    // Store only statuses that differ from their cadence default.
    const statuses: ProjectAgingSettings["statuses"] = {}
    for (const status of FOLLOWED_STATUSES) {
      const row = rows[status.id]
      if (!row) continue
      const dueDays = Number(row.due)
      const overdueDays = Number(row.overdue)
      if (dueDays === status.dueDays && overdueDays === status.overdueDays) continue
      if (!(dueDays < overdueDays)) {
        toast.error(`${status.label}: Overdue must be longer than Follow-up due.`)
        return
      }
      statuses[status.id] = { dueDays, overdueDays }
    }
    startTransition(async () => {
      const result = await saveFeatureSettings("project-aging", { statuses })
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success("Project aging settings saved.")
      await load()
    })
  }

  function reset(): void {
    startTransition(async () => {
      const result = await resetFeatureSettings("project-aging")
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success("Project aging reset to each status's cadence.")
      await load()
    })
  }

  const disabled = pending || !canEdit
  return (
    <section aria-labelledby="project-aging-settings" className="space-y-4 border-b pb-6">
      <div>
        <h2 id="project-aging-settings" className="text-base font-semibold">{FEATURE_SETTINGS["project-aging"].label}</h2>
        <p className="text-sm text-muted-foreground">{FEATURE_SETTINGS["project-aging"].description}</p>
        <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5"><Swatch token={PROJECT_AGING_LEVELS.due.colorToken} />{PROJECT_AGING_LEVELS.due.label} flags the job amber</span>
          <span className="flex items-center gap-1.5"><Swatch token={PROJECT_AGING_LEVELS.overdue.colorToken} />{PROJECT_AGING_LEVELS.overdue.label} flags it red on the map, pipeline and job page</span>
        </p>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {!loaded && !error ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
      {loaded ? (
        <form onSubmit={save} className="space-y-4">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="py-2 font-medium">Job status</th>
                <th className="w-32 py-2 font-medium">Follow-up due</th>
                <th className="w-32 py-2 font-medium">Overdue</th>
              </tr>
            </thead>
            <tbody>
              {FOLLOWED_STATUSES.map((status) => {
                const row = rows[status.id] ?? { due: String(status.dueDays), overdue: String(status.overdueDays) }
                const changed = row.due !== String(status.dueDays) || row.overdue !== String(status.overdueDays)
                return (
                  <tr key={status.id} className="border-b">
                    <td className="py-1.5">
                      {status.label}
                      {changed ? <span className="ml-2 text-xs text-primary">Custom</span> : null}
                    </td>
                    <td className="py-1.5">
                      <Input type="number" inputMode="numeric" min={1} max={60} step={1} value={row.due} disabled={disabled}
                        aria-label={`${status.label} follow-up due, business days`}
                        onChange={(event) => setRow(status.id, { due: event.target.value })} className="h-8 w-20 tabular-nums" />
                    </td>
                    <td className="py-1.5">
                      <Input type="number" inputMode="numeric" min={2} max={120} step={1} value={row.overdue} disabled={disabled}
                        aria-label={`${status.label} overdue, business days`}
                        onChange={(event) => setRow(status.id, { overdue: event.target.value })} className="h-8 w-20 tabular-nums" />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
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
            <p className="ml-auto text-xs text-muted-foreground">
              Business days since the last logged client contact. Organization-specific statuses use the cadence set when they were added.
            </p>
          </div>
        </form>
      ) : null}
    </section>
  )
}
