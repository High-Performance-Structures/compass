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
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { FEATURE_SETTINGS, projectAgingSettingsSchema, type ProjectAgingSettings } from "@/lib/feature-settings/registry"
import { PROJECT_AGING_LEVELS } from "@/lib/project-follow-up"
import { getProjectAgingStatusRows, type ProjectAgingStatusRow } from "@/app/actions/project-profile"

/** A status row: its default timing as text ("" when not followed by default). */
type StatusOption = {
  readonly id: string
  readonly label: string
  readonly custom: boolean
  readonly dueDays: string
  readonly overdueDays: string
}

type Row = { readonly due: string; readonly overdue: string }

function statusOptions(rows: readonly ProjectAgingStatusRow[]): readonly StatusOption[] {
  return rows.map((row) => ({
    id: row.id,
    label: row.label,
    custom: row.custom,
    dueDays: row.defaultThresholds ? String(row.defaultThresholds.dueDays) : "",
    overdueDays: row.defaultThresholds ? String(row.defaultThresholds.overdueDays) : "",
  }))
}

function rowsFrom(statuses: readonly StatusOption[], settings: ProjectAgingSettings): Readonly<Record<string, Row>> {
  return Object.fromEntries(
    statuses.map((status) => {
      const configured = settings.statuses[status.id]
      return [status.id, configured ? { due: String(configured.dueDays), overdue: String(configured.overdueDays) } : { due: status.dueDays, overdue: status.overdueDays }]
    }),
  )
}

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
  const [remindOnOverdue, setRemindOnOverdue] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [statuses, setStatuses] = React.useState<readonly StatusOption[]>([])
  const [rows, setRows] = React.useState<Readonly<Record<string, Row>>>({})
  const [pending, startTransition] = React.useTransition()

  const load = React.useCallback(async () => {
    const [result, statusResult] = await Promise.all([getFeatureSettingsForEditor("project-aging"), getProjectAgingStatusRows()])
    if (!result.success) {
      setError(result.error)
      return
    }
    if (!statusResult.success) {
      setError(statusResult.error)
      return
    }
    const options = statusOptions(statusResult.rows)
    const parsed = projectAgingSettingsSchema.safeParse(result.data.settings)
    setStatuses(options)
    const settings = parsed.success ? parsed.data : FEATURE_SETTINGS["project-aging"].defaults
    setRows(rowsFrom(options, settings))
    setRemindOnOverdue(settings.remindOnOverdue !== false)
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
    // Store only statuses that differ from their default; blank means "not followed up".
    const configured: ProjectAgingSettings["statuses"] = {}
    for (const status of statuses) {
      const row = rows[status.id]
      if (!row) continue
      if (row.due === status.dueDays && row.overdue === status.overdueDays) continue
      if (row.due.trim() === "" && row.overdue.trim() === "") continue
      const dueDays = Number(row.due)
      const overdueDays = Number(row.overdue)
      if (!Number.isInteger(dueDays) || !Number.isInteger(overdueDays) || dueDays < 1 || !(dueDays < overdueDays)) {
        toast.error(`${status.label}: enter whole days, with Overdue longer than Follow-up due.`)
        return
      }
      configured[status.id] = { dueDays, overdueDays }
    }
    startTransition(async () => {
      const result = await saveFeatureSettings("project-aging", { statuses: configured, remindOnOverdue })
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
              {statuses.map((status) => {
                const row = rows[status.id] ?? { due: status.dueDays, overdue: status.overdueDays }
                const changed = row.due !== status.dueDays || row.overdue !== status.overdueDays
                return (
                  <tr key={status.id} className="border-b">
                    <td className="py-1.5">
                      {status.label}
                      {status.custom ? <span className="ml-2 text-xs text-muted-foreground">Your status</span> : null}
                      {changed ? <span className="ml-2 text-xs text-primary">Changed</span> : null}
                      {row.due === "" && row.overdue === "" ? <span className="ml-2 text-xs text-muted-foreground">Not followed up</span> : null}
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
          <div className="flex items-start justify-between gap-4">
            <div>
              <Label htmlFor="project-aging-remind">Remind when a job&apos;s follow-up is overdue</Label>
              <p className="text-xs text-muted-foreground">
                Sends the follow-up owner (or whoever last contacted the client) one urgent reminder per overdue stretch, and turns their Client follow-up link and bell red.
              </p>
            </div>
            <Switch id="project-aging-remind" checked={remindOnOverdue} onCheckedChange={setRemindOnOverdue} disabled={disabled} />
          </div>
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
              Business days since the last logged client contact. Leave both blank for statuses that shouldn&apos;t be followed up. This is the one place follow-up timing is set.
            </p>
          </div>
        </form>
      ) : null}
    </section>
  )
}
