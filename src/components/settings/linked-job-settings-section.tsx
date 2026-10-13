"use client"

import * as React from "react"
import { IconPlus, IconTrash } from "@tabler/icons-react"
import { toast } from "sonner"

import { getFeatureSettingsForEditor, resetFeatureSettings, saveFeatureSettings } from "@/app/actions/feature-settings"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { DEFAULT_DEPARTMENT_PROFILES, DEPARTMENT_CODES } from "@/lib/department-profiles"
import { departmentProfilesSchema, linkedJobSettingsSchema, type LinkedJobShortcut } from "@/lib/feature-settings/registry"

type Row = {
  readonly key: string
  readonly id: string
  readonly label: string
  readonly fromDepartment: string
  readonly toDepartment: string
  /** Comma-separated while editing. */
  readonly workItems: string
}

function toRow(shortcut: LinkedJobShortcut): Row {
  return { key: crypto.randomUUID(), ...shortcut, workItems: shortcut.workItems.join(", ") }
}

function slug(label: string, taken: ReadonlySet<string>): string {
  const base = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32) || "shortcut"
  let id = base
  for (let n = 2; taken.has(id); n += 1) id = `${base}-${n}`
  return id
}

/**
 * Settings → Workflows → Linked jobs: shortcuts for creating a linked job in
 * another department (same customer and site). Any job can still create a
 * linked job in any department.
 */
export function LinkedJobSettingsSection(): React.ReactElement {
  const [loaded, setLoaded] = React.useState(false)
  const [canEdit, setCanEdit] = React.useState(false)
  const [customized, setCustomized] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [rows, setRows] = React.useState<readonly Row[]>([])
  const [names, setNames] = React.useState<Readonly<Record<string, string>>>(
    Object.fromEntries(DEPARTMENT_CODES.map((code) => [code, DEFAULT_DEPARTMENT_PROFILES[code].displayName])),
  )
  const [pending, startTransition] = React.useTransition()

  const load = React.useCallback(async () => {
    const [result, departments] = await Promise.all([
      getFeatureSettingsForEditor("linked-jobs"),
      getFeatureSettingsForEditor("department-profiles"),
    ])
    if (departments.success) {
      const parsed = departmentProfilesSchema.safeParse(departments.data.settings)
      if (parsed.success) setNames(Object.fromEntries(DEPARTMENT_CODES.map((code) => [code, parsed.data.departments[code].displayName])))
    }
    if (!result.success) {
      setError(result.error)
      return
    }
    const parsed = linkedJobSettingsSchema.safeParse(result.data.settings)
    setRows((parsed.success ? parsed.data.shortcuts : []).map(toRow))
    setCanEdit(result.data.canEdit)
    setCustomized(result.data.customized)
    setLoaded(true)
  }, [])

  React.useEffect(() => {
    void load()
  }, [load])

  function update(key: string, patch: Partial<Omit<Row, "key">>): void {
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)))
  }

  function save(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    const taken = new Set<string>()
    const shortcuts = rows
      .filter((row) => row.label.trim() !== "")
      .map((row) => {
        const id = row.id && !taken.has(row.id) ? row.id : slug(row.label, taken)
        taken.add(id)
        return {
          id,
          label: row.label.trim(),
          fromDepartment: row.fromDepartment,
          toDepartment: row.toDepartment,
          workItems: row.workItems.split(",").map((item) => item.trim()).filter(Boolean).slice(0, 12),
        }
      })
    startTransition(async () => {
      const result = await saveFeatureSettings("linked-jobs", { shortcuts })
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success("Linked job shortcuts saved")
      await load()
    })
  }

  function reset(): void {
    startTransition(async () => {
      const result = await resetFeatureSettings("linked-jobs")
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success("Linked job shortcuts reset")
      await load()
    })
  }

  if (error) return <p className="text-sm text-destructive">{error}</p>
  if (!loaded) return <p className="text-sm text-muted-foreground">Loading…</p>

  const departmentSelect = (value: string, onChange: (next: string) => void, label: string, allowAny: boolean): React.ReactElement => (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-8 w-48" aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {allowAny ? <SelectItem value="*">Any department</SelectItem> : null}
        {DEPARTMENT_CODES.map((code) => (
          <SelectItem key={code} value={code}>
            {names[code] ?? code}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )

  return (
    <form onSubmit={save} className="grid gap-5">
      <p className="max-w-prose text-sm text-muted-foreground">
        Any job can create a linked job in another department, with the same customer and site, from <strong>Linked jobs</strong> on
        its Overview. Shortcuts pre-fill the department and the work for common cases. Both jobs show the link.
      </p>
      <fieldset className="grid gap-2" disabled={!canEdit || pending}>
        <legend className="sr-only">Shortcuts</legend>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="py-2 pr-3 font-medium">Offered on</th>
                <th className="py-2 pr-3 font-medium">Shortcut</th>
                <th className="py-2 pr-3 font-medium">Creates a job in</th>
                <th className="py-2 pr-3 font-medium">Work to choose from (comma-separated)</th>
                <th className="w-10 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={row.key} className="border-b align-top">
                  <td className="py-2 pr-3">{departmentSelect(row.fromDepartment, (next) => update(row.key, { fromDepartment: next }), `Shortcut ${index + 1} offered on`, true)}</td>
                  <td className="py-2 pr-3">
                    <Input className="h-8" aria-label={`Shortcut ${index + 1} name`} value={row.label} maxLength={80} onChange={(event) => update(row.key, { label: event.target.value })} />
                  </td>
                  <td className="py-2 pr-3">{departmentSelect(row.toDepartment, (next) => update(row.key, { toDepartment: next }), `Shortcut ${index + 1} creates a job in`, false)}</td>
                  <td className="py-2 pr-3">
                    <Input className="h-8" aria-label={`Shortcut ${index + 1} work`} value={row.workItems} onChange={(event) => update(row.key, { workItems: event.target.value })} />
                  </td>
                  <td className="py-2">
                    <Button type="button" variant="ghost" size="icon" aria-label={`Remove shortcut ${index + 1}`} onClick={() => setRows((current) => current.filter((item) => item.key !== row.key))}>
                      <IconTrash className="size-4" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setRows((current) => [...current, { key: crypto.randomUUID(), id: "", label: "", fromDepartment: "*", toDepartment: "H", workItems: "" }])}
          >
            <IconPlus className="size-4" />
            Add shortcut
          </Button>
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
