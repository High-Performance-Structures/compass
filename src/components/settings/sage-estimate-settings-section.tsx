"use client"

import * as React from "react"
import { toast } from "sonner"
import {
  getFeatureSettingsForEditor,
  resetFeatureSettings,
  saveFeatureSettings,
} from "@/app/actions/feature-settings"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { FEATURE_SETTINGS } from "@/lib/feature-settings/registry"
import {
  sageEstimateSettingsSchema,
  type SageEstimateSettings,
} from "@/lib/feature-settings/sage-change-order-settings"

const GROUP = FEATURE_SETTINGS["sage-estimates"]

/** Settings → Workflows: how received contract deposits reach pay applications. */
export function SageEstimateSettingsSection(): React.ReactElement {
  const [loaded, setLoaded] = React.useState(false)
  const [canEdit, setCanEdit] = React.useState(false)
  const [customized, setCustomized] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [value, setValue] = React.useState<SageEstimateSettings>(GROUP.defaults)
  const [pending, startTransition] = React.useTransition()

  const load = React.useCallback(async () => {
    const result = await getFeatureSettingsForEditor("sage-estimates")
    if (!result.success) {
      setError(result.error)
      return
    }
    const parsed = sageEstimateSettingsSchema.safeParse(result.data.settings)
    setValue(parsed.success ? parsed.data : GROUP.defaults)
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
      const result = await saveFeatureSettings("sage-estimates", value)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success("Sage estimate settings saved.")
      await load()
    })
  }

  function reset(): void {
    startTransition(async () => {
      const result = await resetFeatureSettings("sage-estimates")
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success("Sage estimate settings reset to defaults.")
      await load()
    })
  }

  return (
    <section aria-labelledby="sage-estimate-settings" className="space-y-4 border-b pb-6">
      <div>
        <h2 id="sage-estimate-settings" className="text-base font-semibold">{GROUP.label}</h2>
        <p className="text-sm text-muted-foreground">{GROUP.description}</p>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {!loaded && !error ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
      {loaded ? (
        <form onSubmit={save} className="space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <Label htmlFor="sage-estimate-auto-sync">Sync accepted estimates to Sage automatically</Label>
              <p className="text-xs text-muted-foreground">
                When an estimate is accepted, Compass creates the Sage job if it's missing and adds the estimate as the job&apos;s proposal, with no
                extra step. Anything that needs a person (a line without a Sage cost code, a proposal already in Sage) shows on the estimate as Needs attention.
              </p>
            </div>
            <Switch
              id="sage-estimate-auto-sync"
              checked={value.autoSync}
              disabled={pending || !canEdit}
              onCheckedChange={(checked) => setValue({ ...value, autoSync: checked })}
            />
          </div>
          <div className="flex items-start justify-between gap-4">
            <div>
              <Label htmlFor="sage-estimate-budget">Also send the job budget to Sage</Label>
              <p className="text-xs text-muted-foreground">
                Adds the estimate&apos;s cost by cost code as the Sage job budget, in Sage&apos;s Other column. Compass won&apos;t add one when Sage already has a budget.
              </p>
            </div>
            <Switch
              id="sage-estimate-budget"
              checked={value.sendBudget}
              disabled={pending || !canEdit}
              onCheckedChange={(checked) => setValue({ ...value, sendBudget: checked })}
            />
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
          </div>
        </form>
      ) : null}
    </section>
  )
}
