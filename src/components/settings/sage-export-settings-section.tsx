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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { FEATURE_SETTINGS } from "@/lib/feature-settings/registry"
import { PAY_REQUEST_ORIGINS, sageExportSettingsSchema, type PayRequestOrigin, type SageExportSettings } from "@/lib/feature-settings/contract-settings"
import { formatSageInvoiceNumber } from "@/lib/financials/sage-invoice-number"

const KEY = "sage-export"
const GROUP = FEATURE_SETTINGS[KEY]

type FormatField = Exclude<keyof SageExportSettings, "billingCycle" | "payRequestsCreatedIn">

const FORMAT_FIELDS: readonly { readonly field: FormatField; readonly label: string; readonly exampleNumber: string }[] = [
  { field: "payRequestInvoiceFormat", label: "Pay request", exampleNumber: "3" },
  { field: "depositInvoiceFormat", label: "Deposit", exampleNumber: "1" },
  { field: "otherBillingInvoiceFormat", label: "Other billing", exampleNumber: "2" },
  { field: "creditMemoInvoiceFormat", label: "Credit memo", exampleNumber: "1" },
  { field: "materialSaleInvoiceFormat", label: "Material sale", exampleNumber: "4" },
]

const ORIGIN_LABELS: Readonly<Record<PayRequestOrigin, string>> = { compass: "Compass", sage: "Sage" }

function isPayRequestOrigin(value: string): value is PayRequestOrigin {
  return PAY_REQUEST_ORIGINS.some((origin) => origin === value)
}

/** Example job numbers for the format preview (not a real job). */
const EXAMPLE = { projectNumber: "X-100-200", sageJobNumber: "1200" } as const

/** Settings → Workflows: billing cycle and invoice number formats for the Sage export. */
export function SageExportSettingsSection(): React.ReactElement {
  const [loaded, setLoaded] = React.useState(false)
  const [canEdit, setCanEdit] = React.useState(false)
  const [customized, setCustomized] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [value, setValue] = React.useState<SageExportSettings>(GROUP.defaults)
  const [pending, startTransition] = React.useTransition()

  const load = React.useCallback(async () => {
    const result = await getFeatureSettingsForEditor(KEY)
    if (!result.success) {
      setError(result.error)
      return
    }
    const parsed = sageExportSettingsSchema.safeParse(result.data.settings)
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
    const parsed = sageExportSettingsSchema.safeParse(value)
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Check the invoice number formats.")
      return
    }
    startTransition(async () => {
      const result = await saveFeatureSettings(KEY, parsed.data)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success("Sage export settings saved.")
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
      toast.success("Sage export settings reset to defaults.")
      await load()
    })
  }

  const disabled = pending || !canEdit
  return (
    <section aria-labelledby="sage-export-settings" className="space-y-4 border-b pb-6">
      <div>
        <h2 id="sage-export-settings" className="text-base font-semibold">{GROUP.label}</h2>
        <p className="text-sm text-muted-foreground">{GROUP.description}</p>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {!loaded && !error ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
      {loaded ? (
        <form onSubmit={save} className="space-y-4">
          <div className="max-w-xl space-y-2">
            <Label>Pay requests are created in</Label>
            <RadioGroup
              value={value.payRequestsCreatedIn}
              disabled={disabled}
              className="flex flex-wrap gap-4"
              onValueChange={(next) => {
                if (isPayRequestOrigin(next)) setValue({ ...value, payRequestsCreatedIn: next })
              }}
            >
              {PAY_REQUEST_ORIGINS.map((origin) => (
                <Label key={origin} htmlFor={`sage-export-origin-${origin}`} className="flex items-center gap-2 font-normal">
                  <RadioGroupItem id={`sage-export-origin-${origin}`} value={origin} />
                  {ORIGIN_LABELS[origin]}
                </Label>
              ))}
            </RadioGroup>
            <p className="text-xs text-muted-foreground">
              Compass: staff build each pay request in Compass. Sage: the office builds the progress billing in Sage, and Sync with Sage
              brings it into Compass as the pay request for review, owner approval, email and payments. Billed amounts then stay as Sage has them.
            </p>
          </div>
          <div className="max-w-xs space-y-2">
            <Label htmlFor="sage-export-billing-cycle">Billing cycle</Label>
            <Input
              id="sage-export-billing-cycle"
              value={value.billingCycle}
              maxLength={10}
              disabled={disabled}
              onChange={(event) => setValue({ ...value, billingCycle: event.target.value })}
            />
            <p className="text-xs text-muted-foreground">The Sage billing cycle code a pay request uses, such as 1MO.</p>
          </div>
          <div className="grid max-w-3xl gap-4 sm:grid-cols-2">
            {FORMAT_FIELDS.map(({ field, label, exampleNumber }) => {
              const example = formatSageInvoiceNumber(value[field], { ...EXAMPLE, number: exampleNumber })
              return (
                <div key={field} className="space-y-2">
                  <Label htmlFor={`sage-export-${field}`}>{label} invoice number</Label>
                  <Input
                    id={`sage-export-${field}`}
                    value={value[field]}
                    maxLength={60}
                    disabled={disabled}
                    onChange={(event) => setValue({ ...value, [field]: event.target.value })}
                  />
                  <p className={example.error ? "text-xs text-destructive" : "text-xs text-muted-foreground"}>
                    Example: {example.value}
                    {example.error ? ` (${example.error})` : ""}
                  </p>
                </div>
              )
            })}
          </div>
          <p className="text-xs text-muted-foreground">
            {"{project}"} is the project number, {"{job}"} the Sage job number, {"{n}"} the document&apos;s number and {"{n:2}"} that number
            with two digits. Examples use project X-100-200.
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
