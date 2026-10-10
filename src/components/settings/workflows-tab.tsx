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
import { FEATURE_SETTINGS, type MessageDeskSettings } from "@/lib/feature-settings/registry"

const DEFAULTS = FEATURE_SETTINGS["message-desk"].defaults

function readNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback
}

function DaysField({
  id,
  label,
  help,
  value,
  onChange,
  disabled,
}: {
  readonly id: string
  readonly label: string
  readonly help: string
  readonly value: string
  readonly onChange: (value: string) => void
  readonly disabled: boolean
}): React.ReactElement {
  return (
    <div className="grid gap-1.5 sm:grid-cols-[minmax(0,1fr)_8rem] sm:items-center sm:gap-4">
      <div>
        <Label htmlFor={id}>{label}</Label>
        <p className="text-xs text-muted-foreground">{help}</p>
      </div>
      <div className="flex items-center gap-2">
        <Input id={id} type="number" inputMode="decimal" min={0.25} step={0.5} value={value} disabled={disabled}
          onChange={(event) => onChange(event.target.value)} className="h-9 w-20 tabular-nums" />
        <span className="text-xs text-muted-foreground">days</span>
      </div>
    </div>
  )
}

/** Message Desk follow-up rules: aging thresholds and stale reminders. */
function MessageDeskSettingsSection(): React.ReactElement {
  const [loaded, setLoaded] = React.useState(false)
  const [canEdit, setCanEdit] = React.useState(false)
  const [customized, setCustomized] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [firstResponse, setFirstResponse] = React.useState(String(DEFAULTS.firstResponseDays))
  const [aging, setAging] = React.useState(String(DEFAULTS.agingDays))
  const [stale, setStale] = React.useState(String(DEFAULTS.staleDays))
  const [remind, setRemind] = React.useState(DEFAULTS.remindOnStale)
  const [pending, startTransition] = React.useTransition()

  const apply = React.useCallback((settings: Readonly<Record<string, unknown>>) => {
    setFirstResponse(String(readNumber(settings.firstResponseDays, DEFAULTS.firstResponseDays)))
    setAging(String(readNumber(settings.agingDays, DEFAULTS.agingDays)))
    setStale(String(readNumber(settings.staleDays, DEFAULTS.staleDays)))
    setRemind(typeof settings.remindOnStale === "boolean" ? settings.remindOnStale : DEFAULTS.remindOnStale)
  }, [])

  const load = React.useCallback(async () => {
    const result = await getFeatureSettingsForEditor("message-desk")
    if (!result.success) {
      setError(result.error)
      return
    }
    apply(result.data.settings)
    setCanEdit(result.data.canEdit)
    setCustomized(result.data.customized)
    setLoaded(true)
  }, [apply])

  React.useEffect(() => {
    void load()
  }, [load])

  function save(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    const value: MessageDeskSettings = {
      firstResponseDays: Number(firstResponse),
      agingDays: Number(aging),
      staleDays: Number(stale),
      remindOnStale: remind,
    }
    startTransition(async () => {
      const result = await saveFeatureSettings("message-desk", value)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success("Message Desk settings saved.")
      await load()
    })
  }

  function reset(): void {
    startTransition(async () => {
      const result = await resetFeatureSettings("message-desk")
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success("Message Desk settings reset to defaults.")
      await load()
    })
  }

  const disabled = pending || !canEdit
  return (
    <section aria-labelledby="message-desk-settings" className="space-y-4 border-b pb-6">
      <div>
        <h2 id="message-desk-settings" className="text-base font-semibold">{FEATURE_SETTINGS["message-desk"].label}</h2>
        <p className="text-sm text-muted-foreground">{FEATURE_SETTINGS["message-desk"].description}</p>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {!loaded && !error ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
      {loaded ? (
        <form onSubmit={save} className="space-y-4">
          <DaysField id="desk-first-response" label="Needs first response" help="A new message with no response after this long."
            value={firstResponse} onChange={setFirstResponse} disabled={disabled} />
          <DaysField id="desk-aging" label="Aging" help="An open message with no follow-up for this long."
            value={aging} onChange={setAging} disabled={disabled} />
          <DaysField id="desk-stale" label="Stale (red)" help="An open message with no follow-up for this long. Must be longer than Aging."
            value={stale} onChange={setStale} disabled={disabled} />
          <div className="flex items-start justify-between gap-4">
            <div>
              <Label htmlFor="desk-remind">Remind the assignee when a message goes stale</Label>
              <p className="text-xs text-muted-foreground">Sends a notification and turns their Message Desk link and bell red.</p>
            </div>
            <Switch id="desk-remind" checked={remind} onCheckedChange={setRemind} disabled={disabled} />
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
              Defaults: {DEFAULTS.firstResponseDays}, {DEFAULTS.agingDays} and {DEFAULTS.staleDays} business days.
            </p>
          </div>
        </form>
      ) : null}
    </section>
  )
}

/** Company workflow rules. Each feature's editable settings get a section here. */
export function WorkflowsTab(): React.ReactElement {
  return (
    <div className="space-y-6">
      <MessageDeskSettingsSection />
    </div>
  )
}
