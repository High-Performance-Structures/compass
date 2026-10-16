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
import {
  FEATURE_SETTINGS,
  contractDepositSettingsSchema,
  type ContractDepositSettings,
} from "@/lib/feature-settings/registry"

const GROUP = FEATURE_SETTINGS["contract-deposits"]

/** Settings → Workflows: how received contract deposits reach pay applications. */
export function ContractDepositSettingsSection(): React.ReactElement {
  const [loaded, setLoaded] = React.useState(false)
  const [canEdit, setCanEdit] = React.useState(false)
  const [customized, setCustomized] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [value, setValue] = React.useState<ContractDepositSettings>(GROUP.defaults)
  const [pending, startTransition] = React.useTransition()

  const load = React.useCallback(async () => {
    const result = await getFeatureSettingsForEditor("contract-deposits")
    if (!result.success) {
      setError(result.error)
      return
    }
    const parsed = contractDepositSettingsSchema.safeParse(result.data.settings)
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
      const result = await saveFeatureSettings("contract-deposits", value)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success("Contract deposit settings saved.")
      await load()
    })
  }

  function reset(): void {
    startTransition(async () => {
      const result = await resetFeatureSettings("contract-deposits")
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success("Contract deposit settings reset to defaults.")
      await load()
    })
  }

  return (
    <section aria-labelledby="contract-deposit-settings" className="space-y-4 border-b pb-6">
      <div>
        <h2 id="contract-deposit-settings" className="text-base font-semibold">{GROUP.label}</h2>
        <p className="text-sm text-muted-foreground">{GROUP.description}</p>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {!loaded && !error ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
      {loaded ? (
        <form onSubmit={save} className="space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <Label htmlFor="deposit-auto-apply">Apply deposits to pay applications automatically</Label>
              <p className="text-xs text-muted-foreground">
                New pay applications take as much of the unapplied deposit as the draw allows. Turn off to start each draw at $0 and apply deposits by hand.
              </p>
            </div>
            <Switch
              id="deposit-auto-apply"
              checked={value.autoApplyToPayApplications}
              disabled={pending || !canEdit}
              onCheckedChange={(checked) => setValue({ autoApplyToPayApplications: checked })}
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
