"use client"

import * as React from "react"
import { IconPlus, IconTrash } from "@tabler/icons-react"
import { toast } from "sonner"
import { getFeatureSettingsForEditor, saveFeatureSettings } from "@/app/actions/feature-settings"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { DAILY_LOG_FIELD_LABELS, DAILY_LOG_OPTIONAL_FIELDS } from "@/lib/daily-logs/daily-log-form"
import { DEFAULT_DEPARTMENT_PROFILES, DEPARTMENT_CODES } from "@/lib/department-profiles"
import {
  dailyLogSettingsSchema,
  FEATURE_SETTINGS,
  internalDutySettingsSchema,
  type DailyLogSettings,
  type InternalDutySettings,
} from "@/lib/feature-settings/registry"

const DAILY_DEFAULTS = FEATURE_SETTINGS["daily-logs"].defaults
const DUTY_DEFAULTS = FEATURE_SETTINGS["internal-duties"].defaults

type CodeRow = {
  readonly code: string
  readonly name: string
  readonly active: boolean
  /** Sage payroll ID for labor codes; "office" or "field" for duties. */
  readonly extra: string
}

/**
 * One list of cost codes: turn each on or off, add, remove and search. Codes
 * turned off stay on the list but are no longer offered on new logs.
 */
function CodeListEditor({
  id,
  title,
  help,
  rows,
  extraLabel,
  example,
  extraChoices,
  disabled,
  onChange,
}: {
  readonly id: string
  readonly title: string
  readonly help: string
  readonly rows: readonly CodeRow[]
  readonly extraLabel: string
  /** Example code and name shown in the add row. */
  readonly example: { readonly code: string; readonly name: string; readonly extra: string }
  /** Fixed choices for the extra column (duties' workspace); free text when absent. */
  readonly extraChoices?: readonly { readonly value: string; readonly label: string }[]
  readonly disabled: boolean
  readonly onChange: (rows: readonly CodeRow[]) => void
}): React.ReactElement {
  const [query, setQuery] = React.useState("")
  const [draft, setDraft] = React.useState<CodeRow>({ code: "", name: "", active: true, extra: extraChoices?.[0]?.value ?? "" })
  const needle = query.trim().toLowerCase()
  const visible = rows
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => !needle || `${row.code} ${row.name}`.toLowerCase().includes(needle))
  const activeCount = rows.filter((row) => row.active).length

  function update(index: number, patch: Partial<CodeRow>): void {
    onChange(rows.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row)))
  }

  function add(): void {
    const code = draft.code.trim()
    const name = draft.name.trim()
    if (!code || !name) {
      toast.error("Enter the code and its name.")
      return
    }
    if (rows.some((row) => row.code === code)) {
      toast.error(`${code} is already on the list.`)
      return
    }
    onChange([...rows, { ...draft, code, name }])
    setDraft({ code: "", name: "", active: true, extra: extraChoices?.[0]?.value ?? "" })
  }

  return (
    <section aria-labelledby={`${id}-title`} className="grid gap-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 id={`${id}-title`} className="text-sm font-semibold">{title}</h3>
          <p className="text-sm text-muted-foreground">{help}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {activeCount} of {rows.length} offered on daily logs
          </p>
        </div>
        <Input
          aria-label={`Search ${title.toLowerCase()}`}
          placeholder="Search codes..."
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="h-9 w-full sm:w-64"
        />
      </div>
      <div className="max-h-96 overflow-y-auto border-y">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-background text-left text-xs text-muted-foreground">
            <tr className="border-b">
              <th className="w-16 py-2 font-medium">Offered</th>
              <th className="py-2 font-medium">Code</th>
              <th className="py-2 font-medium">Name</th>
              <th className="py-2 font-medium">{extraLabel}</th>
              <th className="w-10 py-2"><span className="sr-only">Remove</span></th>
            </tr>
          </thead>
          <tbody>
            {visible.map(({ row, index }) => (
              <tr key={`${row.code}-${index}`} className="border-b last:border-b-0">
                <td className="py-1.5">
                  <Switch
                    checked={row.active}
                    disabled={disabled}
                    aria-label={`Offer ${row.code} ${row.name}`}
                    onCheckedChange={(active) => update(index, { active })}
                  />
                </td>
                <td className="py-1.5 pr-3 font-mono text-xs whitespace-nowrap">{row.code}</td>
                <td className={row.active ? "py-1.5 pr-3" : "py-1.5 pr-3 text-muted-foreground"}>{row.name}</td>
                <td className="py-1.5 pr-3 text-xs text-muted-foreground">
                  {extraChoices ? (extraChoices.find((choice) => choice.value === row.extra)?.label ?? row.extra) : row.extra || "—"}
                </td>
                <td className="py-1.5">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    disabled={disabled}
                    aria-label={`Remove ${row.code} ${row.name}`}
                    onClick={() => onChange(rows.filter((_, rowIndex) => rowIndex !== index))}
                  >
                    <IconTrash className="size-4" />
                  </Button>
                </td>
              </tr>
            ))}
            {visible.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-4 text-center text-muted-foreground">No codes match.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <div className="grid gap-2 sm:grid-cols-[8rem_minmax(0,1fr)_10rem_auto] sm:items-end">
        <div className="grid gap-1">
          <Label htmlFor={`${id}-new-code`}>Code</Label>
          <Input id={`${id}-new-code`} value={draft.code} disabled={disabled} placeholder={example.code} onChange={(event) => setDraft({ ...draft, code: event.target.value })} />
        </div>
        <div className="grid gap-1">
          <Label htmlFor={`${id}-new-name`}>Name</Label>
          <Input id={`${id}-new-name`} value={draft.name} disabled={disabled} placeholder={example.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
        </div>
        <div className="grid gap-1">
          <Label htmlFor={`${id}-new-extra`}>{extraLabel}</Label>
          {extraChoices ? (
            <Select value={draft.extra} disabled={disabled} onValueChange={(extra) => setDraft({ ...draft, extra })}>
              <SelectTrigger id={`${id}-new-extra`} className="h-9 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {extraChoices.map((choice) => (
                  <SelectItem key={choice.value} value={choice.value}>
                    {choice.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Input id={`${id}-new-extra`} value={draft.extra} disabled={disabled} placeholder={example.extra} onChange={(event) => setDraft({ ...draft, extra: event.target.value })} />
          )}
        </div>
        <Button type="button" variant="outline" disabled={disabled} onClick={add}>
          <IconPlus className="size-4" />
          Add code
        </Button>
      </div>
    </section>
  )
}

function laborRows(settings: DailyLogSettings): readonly CodeRow[] {
  return settings.laborCostCodes.map((code) => ({ code: code.code, name: code.name, active: code.active, extra: code.payrollId }))
}

function dutyRows(settings: InternalDutySettings): readonly CodeRow[] {
  return settings.duties.map((duty) => ({ code: duty.code, name: duty.label, active: duty.active, extra: duty.workspace }))
}

/**
 * Daily logs: what every log must include, and the cost codes logs offer —
 * the labor list for jobs and the duty list for internal workspaces. Field
 * Mode picks up changes the next time a phone refreshes its projects.
 */
export function DailyLogSettingsSection(): React.ReactElement {
  const [settings, setSettings] = React.useState<DailyLogSettings>(DAILY_DEFAULTS)
  const [duties, setDuties] = React.useState<readonly CodeRow[]>(dutyRows(DUTY_DEFAULTS))
  const [canEdit, setCanEdit] = React.useState(false)
  const [canEditDuties, setCanEditDuties] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [pending, startTransition] = React.useTransition()

  const load = React.useCallback(async () => {
    const [daily, duty] = await Promise.all([
      getFeatureSettingsForEditor("daily-logs"),
      getFeatureSettingsForEditor("internal-duties"),
    ])
    if (!daily.success) {
      setError(daily.error)
      return
    }
    const parsed = dailyLogSettingsSchema.safeParse(daily.data.settings)
    setSettings(parsed.success ? parsed.data : DAILY_DEFAULTS)
    setCanEdit(daily.data.canEdit)
    if (duty.success) {
      const parsedDuties = internalDutySettingsSchema.safeParse(duty.data.settings)
      setDuties(dutyRows(parsedDuties.success ? parsedDuties.data : DUTY_DEFAULTS))
      setCanEditDuties(duty.data.canEdit)
    }
  }, [])

  React.useEffect(() => {
    void load()
  }, [load])

  function save(): void {
    const parsed = dailyLogSettingsSchema.safeParse(settings)
    const parsedDuties = internalDutySettingsSchema.safeParse({
      duties: duties.map((row) => ({ code: row.code, label: row.name, active: row.active, workspace: row.extra === "field" ? "field" : "office" })),
    })
    if (!parsed.success || !parsedDuties.success) {
      toast.error((parsed.error ?? parsedDuties.error)?.issues[0]?.message ?? "Check the daily log settings.")
      return
    }
    startTransition(async () => {
      const result = await saveFeatureSettings("daily-logs", parsed.data)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      if (canEditDuties) {
        const dutyResult = await saveFeatureSettings("internal-duties", parsedDuties.data)
        if (!dutyResult.success) {
          toast.error(dutyResult.error)
          return
        }
      }
      toast.success("Daily log settings saved. Phones pick up the change when they next refresh.")
      await load()
    })
  }

  const disabled = pending || !canEdit
  function toggleField(field: (typeof DAILY_LOG_OPTIONAL_FIELDS)[number], on: boolean): void {
    setSettings({
      ...settings,
      requiredFields: on
        ? DAILY_LOG_OPTIONAL_FIELDS.filter((item) => item === field || settings.requiredFields.includes(item))
        : settings.requiredFields.filter((item) => item !== field),
    })
  }

  return (
    <section aria-labelledby="daily-log-settings" className="space-y-6 border-b pb-6">
      <div>
        <h2 id="daily-log-settings" className="text-base font-semibold">{FEATURE_SETTINGS["daily-logs"].label}</h2>
        <p className="text-sm text-muted-foreground">{FEATURE_SETTINGS["daily-logs"].description}</p>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <section aria-labelledby="daily-log-required" className="grid gap-3">
        <h3 id="daily-log-required" className="text-sm font-semibold">Required on every log</h3>
        <p className="text-sm text-muted-foreground">The date and the work completed are always required.</p>
        <label className="flex items-center gap-3 text-sm">
          <Switch
            checked={settings.requireCostCodeTime}
            disabled={disabled}
            onCheckedChange={(requireCostCodeTime) => setSettings({ ...settings, requireCostCodeTime })}
          />
          At least one cost code with its time
        </label>
        <div className="grid gap-2 sm:grid-cols-3">
          {DAILY_LOG_OPTIONAL_FIELDS.map((field) => (
            <label key={field} className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={settings.requiredFields.includes(field)}
                disabled={disabled}
                onCheckedChange={(checked) => toggleField(field, checked === true)}
              />
              {DAILY_LOG_FIELD_LABELS[field]}
            </label>
          ))}
        </div>
      </section>

      <section aria-labelledby="daily-log-departments" className="grid gap-2">
        <h3 id="daily-log-departments" className="text-sm font-semibold">Jobs that use the labor list</h3>
        <p className="text-sm text-muted-foreground">Other departments&apos; jobs offer every company cost code, with the job&apos;s budget codes first.</p>
        <div className="flex flex-wrap gap-4">
          {DEPARTMENT_CODES.map((code) => (
            <label key={code} className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={settings.laborCodeDepartments.includes(code)}
                disabled={disabled}
                onCheckedChange={(checked) =>
                  setSettings({
                    ...settings,
                    laborCodeDepartments: checked === true
                      ? DEPARTMENT_CODES.filter((item) => item === code || settings.laborCodeDepartments.includes(item))
                      : settings.laborCodeDepartments.filter((item) => item !== code),
                  })
                }
              />
              {DEFAULT_DEPARTMENT_PROFILES[code].displayName}
            </label>
          ))}
        </div>
      </section>

      <CodeListEditor
        id="daily-log-labor-codes"
        title="Labor cost codes"
        help="Offered on daily logs for the jobs above. Matches the Sage Time & Attendance list."
        rows={laborRows(settings)}
        extraLabel="Sage payroll ID"
        example={{ code: "01 71 13", name: "Mobilization", extra: "1711300" }}
        disabled={disabled}
        onChange={(rows) =>
          setSettings({
            ...settings,
            laborCostCodes: rows.map((row) => ({ code: row.code, name: row.name, active: row.active, payrollId: row.extra })),
          })
        }
      />

      <CodeListEditor
        id="daily-log-duty-codes"
        title="Internal duties"
        help="Offered on daily logs and the duty log in internal workspaces, such as H-Office or the yard."
        rows={duties}
        extraLabel="Workspace"
        example={{ code: "515", name: "Insurance", extra: "" }}
        extraChoices={[
          { value: "office", label: "Office" },
          { value: "field", label: "Field / yard" },
        ]}
        disabled={pending || !canEditDuties}
        onChange={setDuties}
      />

      <div>
        <Button type="button" disabled={disabled} onClick={save}>
          Save daily log settings
        </Button>
      </div>
    </section>
  )
}
