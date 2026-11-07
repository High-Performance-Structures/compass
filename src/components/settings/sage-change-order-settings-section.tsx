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
import { sageDescription } from "@/lib/domain/sage-bridge/change-order-rules"
import { FEATURE_SETTINGS } from "@/lib/feature-settings/registry"
import {
  sageChangeOrderSettingsSchema,
  type SageChangeOrderSettings,
} from "@/lib/feature-settings/sage-change-order-settings"
import { formatSageInvoiceNumber } from "@/lib/financials/sage-invoice-number"

const KEY = "sage-change-orders"
const GROUP = FEATURE_SETTINGS[KEY]

/** Example numbers for the preview (not a real job). */
const EXAMPLE = { projectNumber: "X-100-200", sageJobNumber: "1200" } as const

function exampleDescription(format: string, name: string, title: string): string {
  return sageDescription(format.replaceAll(/\{(name|title)\}/g, (_token, key: string) => (key === "name" ? name : title)))
}

/** Settings → Workflows: how change orders and variances are numbered, described and coded in Sage. */
export function SageChangeOrderSettingsSection(): React.ReactElement {
  const [loaded, setLoaded] = React.useState(false)
  const [canEdit, setCanEdit] = React.useState(false)
  const [customized, setCustomized] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [value, setValue] = React.useState<SageChangeOrderSettings>(GROUP.defaults)
  const [pending, startTransition] = React.useTransition()

  const load = React.useCallback(async () => {
    const result = await getFeatureSettingsForEditor(KEY)
    if (!result.success) {
      setError(result.error)
      return
    }
    const parsed = sageChangeOrderSettingsSchema.safeParse(result.data.settings)
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
    const parsed = sageChangeOrderSettingsSchema.safeParse(value)
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Check the Sage change order settings.")
      return
    }
    startTransition(async () => {
      const result = await saveFeatureSettings(KEY, parsed.data)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success("Sage change order settings saved.")
      await load()
    })
  }

  function reset(): void {
    startTransition(async () => {
      const result = await resetFeatureSettings(KEY)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success("Sage change order settings reset to defaults.")
      await load()
    })
  }

  const disabled = pending || !canEdit
  const changeOrderNumber = formatSageInvoiceNumber(value.numberFormat, { ...EXAMPLE, number: "14" })
  const varianceNumber = formatSageInvoiceNumber(value.numberFormat, { ...EXAMPLE, number: "V-006" })
  return (
    <section aria-labelledby="sage-change-order-settings" className="space-y-4 border-b pb-6">
      <div>
        <h2 id="sage-change-order-settings" className="text-base font-semibold">{GROUP.label}</h2>
        <p className="text-sm text-muted-foreground">{GROUP.description}</p>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {!loaded && !error ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
      {loaded ? (
        <form onSubmit={save} className="space-y-4">
          <div className="grid max-w-3xl gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="sage-co-number-format">Sage change order number</Label>
              <Input
                id="sage-co-number-format"
                value={value.numberFormat}
                maxLength={60}
                disabled={disabled}
                onChange={(event) => setValue({ ...value, numberFormat: event.target.value })}
              />
              <p className={changeOrderNumber.error || varianceNumber.error ? "text-xs text-destructive" : "text-xs text-muted-foreground"}>
                Examples: {changeOrderNumber.value}, {varianceNumber.value}
                {changeOrderNumber.error ? ` (${changeOrderNumber.error})` : ""}
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="sage-co-description">Change order description</Label>
              <Input
                id="sage-co-description"
                value={value.changeOrderDescriptionFormat}
                maxLength={80}
                disabled={disabled}
                onChange={(event) => setValue({ ...value, changeOrderDescriptionFormat: event.target.value })}
              />
              <p className="text-xs text-muted-foreground">Example: {exampleDescription(value.changeOrderDescriptionFormat, "14", "Add covered deck")}</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="sage-variance-description">Variance description</Label>
              <Input
                id="sage-variance-description"
                value={value.varianceDescriptionFormat}
                maxLength={80}
                disabled={disabled}
                onChange={(event) => setValue({ ...value, varianceDescriptionFormat: event.target.value })}
              />
              <p className="text-xs text-muted-foreground">Example: {exampleDescription(value.varianceDescriptionFormat, "V-006", "September Variances")}</p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="sage-co-cost-type">Sage cost type</Label>
                <Input
                  id="sage-co-cost-type"
                  type="number"
                  min={0}
                  max={99}
                  value={value.costTypeNumber}
                  disabled={disabled}
                  onChange={(event) => setValue({ ...value, costTypeNumber: Number(event.target.value) })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="sage-co-status">Approved status</Label>
                <Input
                  id="sage-co-status"
                  type="number"
                  min={0}
                  max={99}
                  value={value.approvedStatusNumber}
                  disabled={disabled}
                  onChange={(event) => setValue({ ...value, approvedStatusNumber: Number(event.target.value) })}
                />
              </div>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            In the number, {"{n}"} is the Compass number (variances start with V-), {"{project}"} the project number and {"{job}"} the Sage
            job number; Sage allows 20 characters, and staff can change the number before sending. In descriptions, {"{name}"} is the
            Sage name and {"{title}"} the change order&apos;s title; Sage keeps 50 characters. Cost type and status are Sage&apos;s own
            numbers (in the standard setup, cost type 5 is Other and status 1 is Approved).
          </p>
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
