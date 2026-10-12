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
import { FEATURE_SETTINGS, clientInteractionSettingsSchema } from "@/lib/feature-settings/registry"

const GROUP = FEATURE_SETTINGS["client-interactions"]

/** What a logged client contact must include before it counts toward follow-up. */
export function ClientInteractionSettingsSection(): React.ReactElement {
  const [loaded, setLoaded] = React.useState(false)
  const [canEdit, setCanEdit] = React.useState(false)
  const [customized, setCustomized] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [minimum, setMinimum] = React.useState(String(GROUP.defaults.minimumSummaryCharacters))
  const [backdate, setBackdate] = React.useState(String(GROUP.defaults.maximumBackdateDays))
  const [pending, startTransition] = React.useTransition()

  const load = React.useCallback(async () => {
    const result = await getFeatureSettingsForEditor("client-interactions")
    if (!result.success) {
      setError(result.error)
      return
    }
    const parsed = clientInteractionSettingsSchema.safeParse(result.data.settings)
    const settings = parsed.success ? parsed.data : GROUP.defaults
    setMinimum(String(settings.minimumSummaryCharacters))
    setBackdate(String(settings.maximumBackdateDays))
    setCanEdit(result.data.canEdit)
    setCustomized(result.data.customized)
    setLoaded(true)
  }, [])

  React.useEffect(() => {
    void load()
  }, [load])

  function save(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    startTransition(async () => {
      const result = await saveFeatureSettings("client-interactions", {
        minimumSummaryCharacters: Number(minimum),
        maximumBackdateDays: Number(backdate),
      })
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success("Client contact record settings saved.")
      await load()
    })
  }

  function reset(): void {
    startTransition(async () => {
      const result = await resetFeatureSettings("client-interactions")
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success("Client contact record settings reset to defaults.")
      await load()
    })
  }

  const disabled = pending || !canEdit
  return (
    <section aria-labelledby="client-interaction-settings" className="space-y-4 border-b pb-6">
      <div>
        <h2 id="client-interaction-settings" className="text-base font-semibold">{GROUP.label}</h2>
        <p className="text-sm text-muted-foreground">{GROUP.description}</p>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {!loaded && !error ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
      {loaded ? (
        <form onSubmit={save} className="space-y-4">
          <div className="grid gap-1.5 sm:grid-cols-[minmax(0,1fr)_10rem] sm:items-center sm:gap-4">
            <div>
              <Label htmlFor="client-interaction-minimum">Minimum summary length</Label>
              <p className="text-xs text-muted-foreground">How much the person logging it must write about what happened.</p>
            </div>
            <div className="flex items-center gap-2">
              <Input id="client-interaction-minimum" type="number" inputMode="numeric" min={1} max={500} step={1} value={minimum}
                disabled={disabled} onChange={(event) => setMinimum(event.target.value)} className="h-9 w-20 tabular-nums" />
              <span className="text-xs text-muted-foreground">characters</span>
            </div>
          </div>
          <div className="grid gap-1.5 sm:grid-cols-[minmax(0,1fr)_10rem] sm:items-center sm:gap-4">
            <div>
              <Label htmlFor="client-interaction-backdate">Latest backdating</Label>
              <p className="text-xs text-muted-foreground">How far in the past a contact may be dated. Future dates are never allowed.</p>
            </div>
            <div className="flex items-center gap-2">
              <Input id="client-interaction-backdate" type="number" inputMode="numeric" min={1} max={365} step={1} value={backdate}
                disabled={disabled} onChange={(event) => setBackdate(event.target.value)} className="h-9 w-20 tabular-nums" />
              <span className="text-xs text-muted-foreground">days</span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {canEdit ? (
              <>
                <Button type="submit" size="sm" disabled={pending}>Save</Button>
                {customized ? <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={reset}>Reset to defaults</Button> : null}
              </>
            ) : (
              <p className="text-xs text-muted-foreground">Only admins can change these settings.</p>
            )}
            <p className="ml-auto text-xs text-muted-foreground">
              Defaults: {GROUP.defaults.minimumSummaryCharacters} characters, {GROUP.defaults.maximumBackdateDays} days.
            </p>
          </div>
        </form>
      ) : null}
    </section>
  )
}
