"use client"

/*
 * Settings › Workflows › Field app: the company's rules for which jobs the
 * field app shows on Automatic, whether active Sage employees see them
 * without being added to each job, and the list of jobs that aren't closed
 * with each job's choice (Automatic / Always show / Hide).
 */
import * as React from "react"
import type { ColumnDef } from "@tanstack/react-table"
import { toast } from "sonner"

import { getFieldAppJobChecklist } from "@/app/actions/field-app-settings"
import { updateProjectFieldAppVisibility } from "@/app/actions/project-profile"
import { useDepartmentProfiles } from "@/components/branding/department-profiles-provider"
import { useListSheetFilterLabel, useListSheetStartFilter } from "@/components/list-sheets/use-list-sheet"
import { FIELD_APP_CHOICE_OPTIONS, fieldAppChoiceOption } from "@/components/projects/project-field-app-setting"
import { RecordSearchInput, RecordTable, useRecordTable } from "@/components/record-table"
import { StatusFilterBar } from "@/components/status-filter-bar"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { useFeatureSettingsEditor } from "@/hooks/use-feature-settings-editor"
import { DEPARTMENT_CODES } from "@/lib/department-profiles"
import type { FieldAppChoice, FieldAppJobListRow } from "@/lib/domain/field/field-app-rules"
import { FEATURE_SETTINGS } from "@/lib/feature-settings/registry"
import { PORTFOLIO_PHASES, type PortfolioPhaseId } from "@/lib/portfolio-map/phases"
import { projectNumberAndName } from "@/lib/project-display-name"

const GROUP = FEATURE_SETTINGS["field-app"]
const SHEET_ID = "settings.field-app-jobs"

type JobFilter = "shown" | "not-shown" | "all"

const JOB_FILTERS: readonly { readonly value: JobFilter; readonly label: string; readonly pinned?: boolean }[] = [
  { value: "shown", label: "In field app" },
  { value: "not-shown", label: "Not in field app" },
  { value: "all", label: "All", pinned: true },
]

function isJobFilter(value: string): value is JobFilter {
  return JOB_FILTERS.some((option) => option.value === value)
}

function toggled<T>(list: readonly T[], value: T, on: boolean): T[] {
  return on ? [...new Set([...list, value])] : list.filter((item) => item !== value)
}

function FieldAppRulesEditor(): React.ReactElement {
  const departmentProfiles = useDepartmentProfiles()
  const { loaded, canEdit, customized, error, settings, save, reset, disabled } = useFeatureSettingsEditor("field-app", {
    savedMessage: "Field app settings saved.",
    resetMessage: "Field app settings are back to the defaults.",
  })

  return (
    <section aria-labelledby="field-app-rules" className="space-y-4 border-b pb-6">
      <div>
        <h2 id="field-app-rules" className="text-base font-semibold">Field app</h2>
        <p className="text-sm text-muted-foreground">{GROUP.description}</p>
      </div>
      {error ? <p className="text-sm text-muted-foreground">{error}</p> : null}
      {!loaded && !error ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
      {loaded ? (
        <div className="space-y-5">
          <div className="flex items-start gap-3">
            <Switch
              id="field-app-auto-access"
              checked={settings.autoAccessForSageEmployees}
              disabled={disabled}
              onCheckedChange={(checked) => save({ ...settings, autoAccessForSageEmployees: checked })}
            />
            <div className="space-y-1">
              <Label htmlFor="field-app-auto-access">Active Sage employees see every field app job automatically</Label>
              <p className="text-xs text-muted-foreground">
                {settings.autoAccessForSageEmployees
                  ? "On: staff whose internal contact is active and linked to a Sage employee see every job in the field app, without being added to each job. Anyone added to a job still sees it."
                  : "Off: people see only the field app jobs they are added to."}
              </p>
            </div>
          </div>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Field app phases</legend>
            <p className="text-xs text-muted-foreground">
              On Automatic, a job shows while its job status is in one of these phases. Which statuses belong to each phase is set in
              Settings → Workflows → Portfolio map, so moving a status into Under construction there brings its jobs into the field app.
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              {PORTFOLIO_PHASES.map((phase) => {
                const id = `field-app-phase-${phase.id}`
                return (
                  <div key={phase.id} className="flex items-center gap-2">
                    <Checkbox
                      id={id}
                      checked={settings.phases.includes(phase.id)}
                      disabled={disabled}
                      onCheckedChange={(checked) =>
                        save({ ...settings, phases: toggled<PortfolioPhaseId>(settings.phases, phase.id, checked === true) })
                      }
                    />
                    <Label htmlFor={id} className="font-normal">{phase.label}</Label>
                  </div>
                )
              })}
            </div>
          </fieldset>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Departments left out on Automatic</legend>
            <p className="text-xs text-muted-foreground">
              Jobs in these departments show only when set to Always show.
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              {DEPARTMENT_CODES.map((code) => {
                const id = `field-app-department-${code}`
                return (
                  <div key={code} className="flex items-center gap-2">
                    <Checkbox
                      id={id}
                      checked={settings.excludedDepartments.includes(code)}
                      disabled={disabled}
                      onCheckedChange={(checked) =>
                        save({ ...settings, excludedDepartments: toggled(settings.excludedDepartments, code, checked === true) })
                      }
                    />
                    <Label htmlFor={id} className="font-normal">
                      {departmentProfiles[code].shortName} ({code})
                    </Label>
                  </div>
                )
              })}
            </div>
          </fieldset>

          <div className="flex items-center gap-3">
            {canEdit && customized ? (
              <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={reset}>
                Reset to defaults
              </Button>
            ) : null}
            {canEdit ? null : <p className="text-xs text-muted-foreground">Only admins can change these settings.</p>}
          </div>
        </div>
      ) : null}
    </section>
  )
}

function ChoiceSelect(props: {
  readonly job: FieldAppJobListRow
  readonly disabled: boolean
  readonly onChange: (job: FieldAppJobListRow, choice: FieldAppChoice) => void
}): React.ReactElement {
  return (
    <Select
      value={props.job.choice}
      disabled={props.disabled}
      onValueChange={(value) => {
        const next = fieldAppChoiceOption(value)
        if (next && next !== props.job.choice) props.onChange(props.job, next)
      }}
    >
      <SelectTrigger className="h-8 w-36" aria-label={`Field app for ${projectNumberAndName(props.job)}`}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {FIELD_APP_CHOICE_OPTIONS.map((option) => (
          <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function choiceLabel(choice: FieldAppChoice): string {
  return FIELD_APP_CHOICE_OPTIONS.find((option) => option.value === choice)?.label ?? choice
}

/** The field app job sheet's columns ("settings.field-app-jobs" in the list sheet registry). */
export function fieldAppJobColumns(control: {
  readonly canEdit: boolean
  readonly busyId: string | null
  readonly onChange: (job: FieldAppJobListRow, choice: FieldAppChoice) => void
}): ColumnDef<FieldAppJobListRow>[] {
  return [
    {
      id: "job",
      header: "Job",
      accessorFn: (job) => projectNumberAndName(job),
      cell: ({ row }) => (
        <a className="text-sm hover:underline" href={`/dashboard/projects/${row.original.id}/information`}>
          {projectNumberAndName(row.original)}
        </a>
      ),
    },
    {
      id: "department",
      header: "Department",
      accessorFn: (job) => job.department ?? "",
      cell: ({ row }) => <span className="text-sm">{row.original.department ?? ""}</span>,
    },
    {
      id: "jobStatus",
      header: "Job status",
      accessorFn: (job) => job.jobStatusLabel,
      cell: ({ row }) => <span className="text-sm">{row.original.jobStatusLabel}</span>,
    },
    {
      id: "inFieldApp",
      header: "In field app",
      accessorFn: (job) => (job.shown ? "Yes" : "No"),
      cell: ({ row }) => (
        <div className="max-w-sm">
          <div className="text-sm">{row.original.shown ? "Yes" : "No"}</div>
          <div className="text-xs text-muted-foreground">{row.original.summary}</div>
        </div>
      ),
    },
    {
      id: "choice",
      header: "Field app",
      accessorFn: (job) => choiceLabel(job.choice),
      cell: ({ row }) =>
        control.canEdit ? (
          <ChoiceSelect job={row.original} disabled={control.busyId === row.original.id} onChange={control.onChange} />
        ) : (
          <span className="text-sm">{choiceLabel(row.original.choice)}</span>
        ),
    },
  ]
}

const jobRowId = (job: FieldAppJobListRow): string => job.id

function FieldAppJobsSheet(): React.ReactElement {
  const [jobs, setJobs] = React.useState<readonly FieldAppJobListRow[] | null>(null)
  const [canEdit, setCanEdit] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [busyId, setBusyId] = React.useState<string | null>(null)
  const [search, setSearch] = React.useState("")
  const startFilter = useListSheetStartFilter(SHEET_ID, "all")
  const [filter, setFilter] = React.useState<JobFilter>(isJobFilter(startFilter) ? startFilter : "all")
  const filterLabel = useListSheetFilterLabel(SHEET_ID)

  const refresh = React.useCallback(async () => {
    const result = await getFieldAppJobChecklist()
    if (result.success) {
      setJobs(result.data.jobs)
      setCanEdit(result.data.canEdit)
      setError(null)
    } else {
      setError(result.error)
    }
  }, [])

  React.useEffect(() => {
    void refresh()
  }, [refresh])

  const onChange = React.useCallback(
    (job: FieldAppJobListRow, choice: FieldAppChoice) => {
      setBusyId(job.id)
      void updateProjectFieldAppVisibility({ projectId: job.id, choice }).then(async (result) => {
        if (result.success) {
          toast.success(`${projectNumberAndName(job)}: ${choiceLabel(choice)}.`)
          await refresh()
        } else {
          toast.error(result.error)
        }
        setBusyId(null)
      })
    },
    [refresh],
  )

  const columns = React.useMemo(() => fieldAppJobColumns({ canEdit, busyId, onChange }), [canEdit, busyId, onChange])
  const query = search.trim().toLowerCase()
  const visible = React.useMemo(
    () =>
      (jobs ?? []).filter((job) => {
        if (filter === "shown" && !job.shown) return false
        if (filter === "not-shown" && job.shown) return false
        if (!query) return true
        return [projectNumberAndName(job), job.department ?? "", job.jobStatusLabel].some((text) => text.toLowerCase().includes(query))
      }),
    [jobs, filter, query],
  )
  const table = useRecordTable({
    data: visible,
    columns,
    getRowId: jobRowId,
    resetKey: `${filter}:${query}`,
    sheetId: "settings.field-app-jobs",
  })

  return (
    <section aria-labelledby="field-app-jobs-heading" className="space-y-3">
      <div className="space-y-1">
        <h2 id="field-app-jobs-heading" className="text-base font-semibold">Jobs in the field app</h2>
        <p className="text-sm text-muted-foreground">
          Every job that isn&apos;t closed. The choice is the same for everyone: Automatic follows the rules above, Always show puts the
          job in the field app in any phase, and Hide keeps it out. Closed jobs never show.
        </p>
      </div>
      {error ? <p className="text-sm text-muted-foreground">{error}</p> : null}
      {jobs === null && !error ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
      {jobs !== null ? (
        <div className="flex min-w-0 flex-col gap-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <StatusFilterBar
              kind="button"
              label="Filter jobs by field app"
              selected={filter}
              onSelect={setFilter}
              options={JOB_FILTERS.map((option) => ({
                ...option,
                label: filterLabel(option.value, option.label),
                count:
                  option.value === "all"
                    ? jobs.length
                    : jobs.filter((job) => (option.value === "shown" ? job.shown : !job.shown)).length,
              }))}
            />
            <RecordSearchInput
              value={search}
              onChange={setSearch}
              label="Search jobs"
              placeholder="Search jobs"
              className="sm:max-w-xs"
            />
          </div>
          <RecordTable table={table} itemLabel="jobs" emptyMessage="No jobs match." rowIdPrefix="field-app-job" />
        </div>
      ) : null}
    </section>
  )
}

/** Settings › Workflows › Field app. */
export function FieldAppSettingsSection(): React.ReactElement {
  return (
    <div className="space-y-8">
      <FieldAppRulesEditor />
      <FieldAppJobsSheet />
    </div>
  )
}
