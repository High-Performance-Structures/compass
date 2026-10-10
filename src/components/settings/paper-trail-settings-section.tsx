"use client"

import * as React from "react"
import { toast } from "sonner"
import {
  getFeatureSettingsForEditor,
  resetFeatureSettings,
  saveFeatureSettings,
} from "@/app/actions/feature-settings"
import { getProjects } from "@/app/actions/projects"
import { SearchableCombobox } from "@/components/searchable-combobox"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import {
  FEATURE_SETTINGS,
  paperTrailSettingsSchema,
  type PaperTrailSettings,
} from "@/lib/feature-settings/registry"
import { projectNumberAndName } from "@/lib/project-display-name"

const DEFAULTS = FEATURE_SETTINGS["paper-trail"].defaults

const RECORD_SWITCHES = [
  { key: "purchaseOrders", label: "Purchase orders", folder: "12_Purchasing" },
  { key: "estimates", label: "Estimates", folder: "02_WorkingEstimate" },
  { key: "rfis", label: "RFIs", folder: "06_Communications" },
  { key: "changeOrders", label: "Change orders", folder: "11_ChangeOrders" },
] as const

type ProjectOption = { readonly value: string; readonly label: string }

/**
 * Project paper trail: which Compass records are copied as PDFs into each
 * project's Drive folder. Starts off; "Test projects" limits saving to a few
 * projects while the company checks the results.
 */
export function PaperTrailSettingsSection(): React.ReactElement {
  const [loaded, setLoaded] = React.useState(false)
  const [canEdit, setCanEdit] = React.useState(false)
  const [customized, setCustomized] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [settings, setSettings] = React.useState<PaperTrailSettings>(DEFAULTS)
  const [quiet, setQuiet] = React.useState(String(DEFAULTS.quietMinutes))
  const [domains, setDomains] = React.useState("")
  const [projects, setProjects] = React.useState<readonly ProjectOption[]>([])
  const [pending, startTransition] = React.useTransition()

  const apply = React.useCallback((value: PaperTrailSettings) => {
    setSettings(value)
    setQuiet(String(value.quietMinutes))
    setDomains(value.internalDomains.join(", "))
  }, [])

  const load = React.useCallback(async () => {
    const [result, projectRows] = await Promise.all([getFeatureSettingsForEditor("paper-trail"), getProjects()])
    if (!result.success) {
      setError(result.error)
      return
    }
    const parsed = paperTrailSettingsSchema.safeParse(result.data.settings)
    apply(parsed.success ? parsed.data : DEFAULTS)
    setCanEdit(result.data.canEdit)
    setCustomized(result.data.customized)
    setProjects(projectRows.map((project) => ({ value: project.id, label: projectNumberAndName(project) })))
    setLoaded(true)
  }, [apply])

  React.useEffect(() => {
    void load()
  }, [load])

  const disabled = !canEdit || pending
  const projectLabel = (id: string): string => projects.find((project) => project.value === id)?.label ?? id

  function save(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    const next = {
      ...settings,
      quietMinutes: Number(quiet),
      internalDomains: domains
        .split(/[\s,]+/)
        .map((domain) => domain.trim().toLowerCase().replace(/^@/, ""))
        .filter(Boolean),
    }
    startTransition(async () => {
      const result = await saveFeatureSettings("paper-trail", next)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success("Paper trail settings saved")
      await load()
    })
  }

  function reset(): void {
    startTransition(async () => {
      const result = await resetFeatureSettings("paper-trail")
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success("Paper trail settings reset")
      await load()
    })
  }

  return (
    <section aria-labelledby="paper-trail-settings" className="space-y-4 border-b pb-6">
      <div>
        <h2 id="paper-trail-settings" className="text-base font-semibold">{FEATURE_SETTINGS["paper-trail"].label}</h2>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          Saves a PDF copy of each record in the project&apos;s Google Drive folder, replaced a few minutes after each
          edit. Sending, signing, approving, or answering also keeps a dated copy that is never changed.
        </p>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {!loaded && !error ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
      {loaded ? (
        <form className="max-w-3xl space-y-5" onSubmit={save}>
          <div className="grid gap-1.5 sm:grid-cols-[minmax(0,1fr)_14rem] sm:items-center sm:gap-4">
            <div>
              <Label htmlFor="paper-trail-mode">Saving</Label>
              <p className="text-xs text-muted-foreground">Use test projects to check the Drive folders before turning it on everywhere.</p>
            </div>
            <Select
              value={settings.mode}
              onValueChange={(value) => {
                if (value === "off" || value === "pilot" || value === "on") setSettings({ ...settings, mode: value })
              }}
              disabled={disabled}
            >
              <SelectTrigger id="paper-trail-mode" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="off">Off</SelectItem>
                <SelectItem value="pilot">Test projects only</SelectItem>
                <SelectItem value="on">All projects</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {settings.mode === "pilot" ? (
            <div className="space-y-2">
              <Label>Test projects</Label>
              <SearchableCombobox
                value=""
                onValueChange={(value) => {
                  if (value && !settings.pilotProjectIds.includes(value)) {
                    setSettings({ ...settings, pilotProjectIds: [...settings.pilotProjectIds, value] })
                  }
                }}
                options={projects.filter((project) => !settings.pilotProjectIds.includes(project.value))}
                ariaLabel="Add a test project"
                placeholder="Add a test project"
                searchPlaceholder="Search projects..."
                emptyMessage="No matching projects."
                disabled={disabled}
                className="h-9 sm:max-w-md"
              />
              {settings.pilotProjectIds.length === 0 ? (
                <p className="text-xs text-muted-foreground">No test projects yet, so nothing is saved.</p>
              ) : (
                <ul className="divide-y border-y text-sm sm:max-w-md">
                  {settings.pilotProjectIds.map((id) => (
                    <li key={id} className="flex items-center justify-between gap-3 py-1.5">
                      <span className="min-w-0 truncate">{projectLabel(id)}</span>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={disabled}
                        onClick={() => setSettings({ ...settings, pilotProjectIds: settings.pilotProjectIds.filter((item) => item !== id) })}
                      >
                        Remove
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : null}

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Records to save</legend>
            <ul className="divide-y border-y">
              {RECORD_SWITCHES.map((item) => (
                <li key={item.key} className="flex items-center justify-between gap-3 py-2">
                  <Label htmlFor={`paper-trail-${item.key}`} className="font-normal">
                    {item.label} <span className="text-xs text-muted-foreground">→ {item.folder}</span>
                  </Label>
                  <Switch
                    id={`paper-trail-${item.key}`}
                    checked={settings[item.key]}
                    disabled={disabled}
                    onCheckedChange={(checked) => setSettings({ ...settings, [item.key]: checked })}
                  />
                </li>
              ))}
              <li className="flex items-center justify-between gap-3 py-2">
                <Label htmlFor="paper-trail-milestones" className="font-normal">Keep dated copies at milestones</Label>
                <Switch
                  id="paper-trail-milestones"
                  checked={settings.milestoneCopies}
                  disabled={disabled}
                  onCheckedChange={(checked) => setSettings({ ...settings, milestoneCopies: checked })}
                />
              </li>
            </ul>
          </fieldset>

          <div className="grid gap-1.5 sm:grid-cols-[minmax(0,1fr)_8rem] sm:items-center sm:gap-4">
            <div>
              <Label htmlFor="paper-trail-quiet">Wait after the last edit</Label>
              <p className="text-xs text-muted-foreground">A record is saved once it has gone this long without changes.</p>
            </div>
            <div className="flex items-center gap-2">
              <Input id="paper-trail-quiet" type="number" min={1} max={60} value={quiet} disabled={disabled}
                onChange={(event) => setQuiet(event.target.value)} className="h-9 w-20 tabular-nums" />
              <span className="text-xs text-muted-foreground">minutes</span>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="paper-trail-domains">Company email domains</Label>
            <Input id="paper-trail-domains" value={domains} disabled={disabled} placeholder="openrangeconstruction.ltd"
              onChange={(event) => setDomains(event.target.value)} className="h-9 sm:max-w-md" />
            <p className="text-xs text-muted-foreground">
              People on these domains count as inside the company. If a record&apos;s folder is shared with anyone else, the copy goes to a private
              &ldquo;Compass Records (internal)&rdquo; folder instead. The connected Google account&apos;s domain always counts.
            </p>
          </div>

          {canEdit ? (
            <div className="flex flex-wrap gap-2">
              <Button type="submit" size="sm" disabled={pending}>Save</Button>
              {customized ? (
                <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={reset}>Reset to defaults</Button>
              ) : null}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">Only admins can change these settings.</p>
          )}
        </form>
      ) : null}
    </section>
  )
}
