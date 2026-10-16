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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  FEATURE_SETTINGS,
  payApplicationSettingsSchema,
  type PayApplicationSettings,
} from "@/lib/feature-settings/registry"
import {
  PAY_APPLICATION_OWNER_DETAILS,
  PAY_APPLICATION_OWNER_DETAIL_LABELS,
  isPayApplicationOwnerDetail,
} from "@/lib/financials/pay-application-detail"

const GROUP = FEATURE_SETTINGS["pay-applications"]

/** Settings → Workflows: how much pay application detail clients see. */
export function PayApplicationSettingsSection(): React.ReactElement {
  const [loaded, setLoaded] = React.useState(false)
  const [canEdit, setCanEdit] = React.useState(false)
  const [customized, setCustomized] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [value, setValue] = React.useState<PayApplicationSettings>(GROUP.defaults)
  const [pending, startTransition] = React.useTransition()

  const load = React.useCallback(async () => {
    const result = await getFeatureSettingsForEditor("pay-applications")
    if (!result.success) {
      setError(result.error)
      return
    }
    const parsed = payApplicationSettingsSchema.safeParse(result.data.settings)
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
      const result = await saveFeatureSettings("pay-applications", value)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success("Pay application settings saved.")
      await load()
    })
  }

  function reset(): void {
    startTransition(async () => {
      const result = await resetFeatureSettings("pay-applications")
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success("Pay application settings reset to defaults.")
      await load()
    })
  }

  return (
    <section aria-labelledby="pay-application-settings" className="space-y-4 border-b pb-6">
      <div>
        <h2 id="pay-application-settings" className="text-base font-semibold">{GROUP.label}</h2>
        <p className="text-sm text-muted-foreground">{GROUP.description}</p>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {!loaded && !error ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
      {loaded ? (
        <form onSubmit={save} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="pay-application-owner-detail">What the client sees</Label>
            <Select
              value={value.ownerDetail}
              disabled={pending || !canEdit}
              onValueChange={(next) => {
                if (isPayApplicationOwnerDetail(next)) setValue({ ownerDetail: next })
              }}
            >
              <SelectTrigger id="pay-application-owner-detail" className="w-72">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAY_APPLICATION_OWNER_DETAILS.map((detail) => (
                  <SelectItem key={detail} value={detail}>
                    {PAY_APPLICATION_OWNER_DETAIL_LABELS[detail]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Percent only shows each division's percent complete and the payment due, with no line amounts.
            </p>
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
