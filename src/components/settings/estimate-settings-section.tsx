"use client"

import * as React from "react"
import { toast } from "sonner"

import { getFeatureSettingsForEditor, resetFeatureSettings, saveFeatureSettings } from "@/app/actions/feature-settings"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { DEFAULT_DEPARTMENT_PROFILES, DEPARTMENT_CODES } from "@/lib/department-profiles"
import { DEFAULT_ESTIMATE_MODES, type EstimateMode } from "@/lib/estimates/estimate-modes"
import { departmentProfilesSchema, estimateSettingsSchema } from "@/lib/feature-settings/registry"

const MODE_LABEL: Readonly<Record<EstimateMode, string>> = {
  single: "One contract estimate",
  multiple: "Several at once",
}

const ACCEPTED_TEXT: Readonly<Record<EstimateMode, string>> = {
  single: "Becomes the contract budget; later changes go through change orders",
  multiple: "Each estimate is accepted on its own; no contract budget",
}

function builtIn(code: string): EstimateMode {
  return DEFAULT_ESTIMATE_MODES[code] ?? "single"
}

/**
 * Settings → Workflows → Estimates: per department, one contract estimate per
 * job or several at once. Existing estimates are never changed by this.
 */
export function EstimateSettingsSection(): React.ReactElement {
  const [loaded, setLoaded] = React.useState(false)
  const [canEdit, setCanEdit] = React.useState(false)
  const [customized, setCustomized] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [modes, setModes] = React.useState<Readonly<Record<string, EstimateMode>>>({})
  const [names, setNames] = React.useState<Readonly<Record<string, string>>>(
    Object.fromEntries(DEPARTMENT_CODES.map((code) => [code, DEFAULT_DEPARTMENT_PROFILES[code].displayName])),
  )
  const [pending, startTransition] = React.useTransition()

  const load = React.useCallback(async () => {
    const [result, departments] = await Promise.all([
      getFeatureSettingsForEditor("estimates"),
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
    const parsed = estimateSettingsSchema.safeParse(result.data.settings)
    const stored = parsed.success ? parsed.data.modes : {}
    setModes(Object.fromEntries(DEPARTMENT_CODES.map((code) => [code, stored[code] ?? builtIn(code)])))
    setCanEdit(result.data.canEdit)
    setCustomized(result.data.customized)
    setLoaded(true)
  }, [])

  React.useEffect(() => {
    void load()
  }, [load])

  function save(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    // Store only departments that differ from the built-in mode.
    const changed: Record<string, EstimateMode> = {}
    for (const code of DEPARTMENT_CODES) {
      const mode = modes[code]
      if (mode && mode !== builtIn(code)) changed[code] = mode
    }
    startTransition(async () => {
      const result = await saveFeatureSettings("estimates", { modes: changed })
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success("Estimate settings saved")
      await load()
    })
  }

  function reset(): void {
    startTransition(async () => {
      const result = await resetFeatureSettings("estimates")
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success("Estimate settings reset")
      await load()
    })
  }

  if (error) return <p className="text-sm text-destructive">{error}</p>
  if (!loaded) return <p className="text-sm text-muted-foreground">Loading…</p>

  return (
    <form onSubmit={save} className="grid gap-5">
      <p className="max-w-prose text-sm text-muted-foreground">
        How estimates work in each department. A job follows its department&apos;s setting; existing estimates are never
        changed by it.
      </p>
      <fieldset className="grid gap-2" disabled={!canEdit || pending}>
        <legend className="sr-only">Estimates per job</legend>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="py-2 pr-4 font-medium">Department</th>
                <th className="py-2 pr-4 font-medium">Estimates per job</th>
                <th className="py-2 font-medium">When an estimate is accepted</th>
              </tr>
            </thead>
            <tbody>
              {DEPARTMENT_CODES.map((code) => {
                const mode = modes[code] ?? builtIn(code)
                return (
                  <tr key={code} className="border-b">
                    <td className="py-2 pr-4">
                      <Label htmlFor={`estimate-mode-${code}`} className="font-medium">
                        {names[code] ?? code}
                      </Label>
                    </td>
                    <td className="py-2 pr-4">
                      <Select
                        value={mode}
                        onValueChange={(value) => setModes((current) => ({ ...current, [code]: value === "multiple" ? "multiple" : "single" }))}
                      >
                        <SelectTrigger id={`estimate-mode-${code}`} className="h-8 w-56">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="single">{MODE_LABEL.single}</SelectItem>
                          <SelectItem value="multiple">{MODE_LABEL.multiple}</SelectItem>
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="py-2 text-muted-foreground">{ACCEPTED_TEXT[mode]}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </fieldset>
      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-lg border p-4 text-sm">
          <p className="font-medium">{MODE_LABEL.single}</p>
          <p className="mt-1 text-muted-foreground">Duplicate makes a new version. Accepting one replaces any earlier accepted estimate as the job&apos;s baseline.</p>
        </div>
        <div className="rounded-lg border p-4 text-sm">
          <p className="font-medium">{MODE_LABEL.multiple}</p>
          <p className="mt-1 text-muted-foreground">Each estimate gets its own number (-01, -02) and versions. Duplicate asks: a separate estimate or a new version. Accepting one leaves the others as they are.</p>
        </div>
      </div>
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
