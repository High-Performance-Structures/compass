"use client"

import * as React from "react"
import { toast } from "sonner"
import { useFeatureSettingsEditor } from "@/hooks/use-feature-settings-editor"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Switch } from "@/components/ui/switch"
import { arInvoiceDescription } from "@/lib/domain/sage-bridge/ar-invoice-rules"
import { FEATURE_SETTINGS } from "@/lib/feature-settings/registry"
import { INVOICE_DATE_SOURCES, type InvoiceDateSource } from "@/lib/feature-settings/sage-ar-invoice-settings"
import {
  sagePayRequestCheckSettingsSchema
  } from "@/lib/feature-settings/sage-pay-request-check-settings"

const KEY = "sage-pay-request-check"
const GROUP = FEATURE_SETTINGS[KEY]

const DATE_LABELS: Readonly<Record<InvoiceDateSource, string>> = {
  period_end: "Pay request period end",
  billed_date: "Day it was approved for billing"
}

function isDateSource(value: string): value is InvoiceDateSource {
  return INVOICE_DATE_SOURCES.some((source) => source === value)
}

function wholeNumber(text: string, fallback: number): number {
  const parsed = Number(text)
  return Number.isInteger(parsed) ? parsed : fallback
}

/** Settings → Workflows → Sage export: the Enter in Sage checklist and the posted invoice check. */
export function SagePayRequestCheckSettingsSection(): React.ReactElement {
  const { loaded, canEdit, customized, error, pending, settings: value, setSettings: setValue, save: saveSettings, reset } = useFeatureSettingsEditor(KEY, {
    savedMessage: "Sage pay request check settings saved.",
    resetMessage: "Sage pay request check settings reset to defaults."
  })

  function save(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    const parsed = sagePayRequestCheckSettingsSchema.safeParse(value)
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Check the Sage pay request check settings.")
      return
    }
    saveSettings(parsed.data)
  }

  const disabled = pending || !canEdit
  const example = arInvoiceDescription(value.descriptionFormat, { date: "2026-11-30", sequence: "3", projectNumber: "X-100-200" })
  return (
    <section aria-labelledby="sage-pay-request-check-settings" className="space-y-4 border-b pb-6">
      <div>
        <h2 id="sage-pay-request-check-settings" className="text-base font-semibold">{GROUP.label}</h2>
        <p className="text-sm text-muted-foreground">{GROUP.description}</p>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {!loaded && !error ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
      {loaded ? (
        <form onSubmit={save} className="space-y-4">
          <div className="grid max-w-3xl gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="sage-check-description">Billing description</Label>
              <Input id="sage-check-description" value={value.descriptionFormat} maxLength={50} disabled={disabled}
                onChange={(event) => setValue({ ...value, descriptionFormat: event.target.value })} />
              <p className="text-xs text-muted-foreground">{"{month} {year} {n} {project}"}. Example: {example}</p>
            </div>
            <div className="space-y-2">
              <Label>Billing date</Label>
              <RadioGroup value={value.billingDate} disabled={disabled} className="space-y-1"
                onValueChange={(next) => { if (isDateSource(next)) setValue({ ...value, billingDate: next }) }}>
                {INVOICE_DATE_SOURCES.map((source) => (
                  <Label key={source} htmlFor={`sage-check-date-${source}`} className="flex items-center gap-2 font-normal">
                    <RadioGroupItem id={`sage-check-date-${source}`} value={source} />
                    {DATE_LABELS[source]}
                  </Label>
                ))}
              </RadioGroup>
            </div>
            <div className="space-y-2">
              <Label htmlFor="sage-check-tolerance">Sales tax tolerance (cents per taxable line)</Label>
              <Input id="sage-check-tolerance" inputMode="numeric" value={String(value.taxToleranceCentsPerLine)} disabled={disabled}
                onChange={(event) => setValue({ ...value, taxToleranceCentsPerLine: wholeNumber(event.target.value, value.taxToleranceCentsPerLine) })} />
              <p className="text-xs text-muted-foreground">How far Sage&apos;s sales tax may differ from Compass&apos;s before the invoice needs attention.</p>
            </div>
            <div className="flex items-start justify-between gap-4">
              <div>
                <Label htmlFor="sage-check-notify">Notify finance staff</Label>
                <p className="text-xs text-muted-foreground">Tell office staff with finance access when a posted invoice needs attention.</p>
              </div>
              <Switch id="sage-check-notify" checked={value.notifyOnNeedsAttention} disabled={disabled}
                onCheckedChange={(checked) => setValue({ ...value, notifyOnNeedsAttention: checked })} />
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
          </div>
        </form>
      ) : null}
    </section>
  )
}
