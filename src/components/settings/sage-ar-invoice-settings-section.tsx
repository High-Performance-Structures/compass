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
import { PROJECT_DEPARTMENTS } from "@/lib/domain/project/statuses"
import { FEATURE_SETTINGS } from "@/lib/feature-settings/registry"
import {
  INVOICE_DATE_SOURCES,
  sageArInvoiceSettingsSchema,
  type InvoiceDateSource
  } from "@/lib/feature-settings/sage-ar-invoice-settings"

const KEY = "sage-ar-invoices"
const GROUP = FEATURE_SETTINGS[KEY]

const DATE_LABELS: Readonly<Record<InvoiceDateSource, string>> = {
  period_end: "Pay request period end",
  billed_date: "Day it was approved for billing"
}

function isDateSource(value: string): value is InvoiceDateSource {
  return INVOICE_DATE_SOURCES.some((source) => source === value)
}

/** "" → null; digits → the number; anything else stays as typed until saved. */
function accountValue(text: string): number | null {
  const trimmed = text.trim()
  return trimmed === "" ? null : Number(trimmed)
}

function wholeNumber(text: string, fallback: number): number {
  const parsed = Number(text)
  return Number.isInteger(parsed) ? parsed : fallback
}

/** Settings → Workflows → Sage export: billed pay requests as Sage AR invoices. */
export function SageArInvoiceSettingsSection(): React.ReactElement {
  const { loaded, canEdit, customized, error, pending, settings: value, setSettings: setValue, save: saveSettings, reset } = useFeatureSettingsEditor(KEY, {
    savedMessage: "Sage AR invoice settings saved.",
    resetMessage: "Sage AR invoice settings reset to defaults."
  })

  function save(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    const parsed = sageArInvoiceSettingsSchema.safeParse(value)
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Check the Sage AR invoice settings.")
      return
    }
    saveSettings(parsed.data)
  }

  const disabled = pending || !canEdit
  const example = arInvoiceDescription(value.descriptionFormat, { date: "2026-11-30", sequence: "3", projectNumber: "X-100-200" })
  return (
    <section aria-labelledby="sage-ar-invoice-settings" className="space-y-4 border-b pb-6">
      <div>
        <h2 id="sage-ar-invoice-settings" className="text-base font-semibold">{GROUP.label}</h2>
        <p className="text-sm text-muted-foreground">{GROUP.description}</p>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {!loaded && !error ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
      {loaded ? (
        <form onSubmit={save} className="space-y-4">
          <div className="flex max-w-3xl items-start justify-between gap-4">
            <div>
              <Label htmlFor="sage-ar-invoice-send">Send billed pay requests to Sage as AR invoices</Label>
              <p className="text-xs text-muted-foreground">
                When pay requests are created in Compass, approving one for billing sends it to Sage as an AR invoice: this period&apos;s billing on
                every cost code (change orders and variances each on their own line, taxable work on its own line), with the period&apos;s retention.
                Anything that doesn&apos;t tie shows on the pay request as Needs attention. Office staff can also send or retry from the pay request. Off by default: pay requests built in Sage never go as AR invoices.
              </p>
            </div>
            <Switch
              id="sage-ar-invoice-send"
              checked={value.sendBilledPayRequests}
              disabled={disabled}
              onCheckedChange={(checked) => setValue({ ...value, sendBilledPayRequests: checked })}
            />
          </div>
          <div className="grid max-w-3xl gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="sage-ar-invoice-type">Sage invoice type</Label>
              <Input id="sage-ar-invoice-type" inputMode="numeric" value={String(value.invoiceType)} disabled={disabled}
                onChange={(event) => setValue({ ...value, invoiceType: wholeNumber(event.target.value, value.invoiceType) })} />
              <p className="text-xs text-muted-foreground">Sage&apos;s number for the invoice type; 1 is Contract in the standard setup.</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="sage-ar-invoice-status">Sage invoice status</Label>
              <Input id="sage-ar-invoice-status" inputMode="numeric" value={String(value.invoiceStatus)} disabled={disabled}
                onChange={(event) => setValue({ ...value, invoiceStatus: wholeNumber(event.target.value, value.invoiceStatus) })} />
              <p className="text-xs text-muted-foreground">Sage&apos;s number for the status; 1 is Open in the standard setup.</p>
            </div>
            <div className="space-y-2">
              <Label>Invoice date</Label>
              <RadioGroup value={value.invoiceDate} disabled={disabled} className="space-y-1"
                onValueChange={(next) => { if (isDateSource(next)) setValue({ ...value, invoiceDate: next }) }}>
                {INVOICE_DATE_SOURCES.map((source) => (
                  <Label key={source} htmlFor={`sage-ar-invoice-date-${source}`} className="flex items-center gap-2 font-normal">
                    <RadioGroupItem id={`sage-ar-invoice-date-${source}`} value={source} />
                    {DATE_LABELS[source]}
                  </Label>
                ))}
              </RadioGroup>
            </div>
            <div className="space-y-2">
              <Label htmlFor="sage-ar-invoice-due-days">Due in (days)</Label>
              <Input id="sage-ar-invoice-due-days" inputMode="numeric" value={String(value.dueDays)} disabled={disabled}
                onChange={(event) => setValue({ ...value, dueDays: wholeNumber(event.target.value, value.dueDays) })} />
              <p className="text-xs text-muted-foreground">Payment terms: the due date is this many days after the invoice date.</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="sage-ar-invoice-description">Invoice description</Label>
              <Input id="sage-ar-invoice-description" value={value.descriptionFormat} maxLength={80} disabled={disabled}
                onChange={(event) => setValue({ ...value, descriptionFormat: event.target.value })} />
              <p className={example.length > 50 ? "text-xs text-destructive" : "text-xs text-muted-foreground"}>
                {"{month} {year} {n} {project}"}. Example: {example}{example.length > 50 ? " (over Sage's 50 characters)" : ""}
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="sage-ar-invoice-co-line">Change order line description</Label>
              <Input id="sage-ar-invoice-co-line" value={value.changeOrderLineFormat} maxLength={80} disabled={disabled}
                onChange={(event) => setValue({ ...value, changeOrderLineFormat: event.target.value })} />
              <p className="text-xs text-muted-foreground">{"{costCode}"} is the cost code&apos;s name, {"{changeOrder}"} &quot;CO #14&quot; or &quot;V-006&quot;.</p>
            </div>
          </div>
          <div className="max-w-3xl space-y-2">
            <h3 className="text-sm font-medium">Sage ledger accounts</h3>
            <p className="text-xs text-muted-foreground">
              The Sage income account each line posts to, by the job&apos;s department (blank uses the default), and the contract deposits account
              for a draw&apos;s &quot;deposit applied&quot; line. A pay request needs attention until its account is chosen.
            </p>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1">
                <Label htmlFor="sage-ar-invoice-income">Default income account</Label>
                <Input id="sage-ar-invoice-income" inputMode="numeric" value={value.incomeAccount === null ? "" : String(value.incomeAccount)} disabled={disabled}
                  onChange={(event) => setValue({ ...value, incomeAccount: accountValue(event.target.value) })} />
              </div>
              {PROJECT_DEPARTMENTS.map((department) => (
                <div key={department} className="space-y-1">
                  <Label htmlFor={`sage-ar-invoice-income-${department}`}>{department} jobs</Label>
                  <Input id={`sage-ar-invoice-income-${department}`} inputMode="numeric"
                    value={value.departmentIncomeAccounts[department] === null ? "" : String(value.departmentIncomeAccounts[department])}
                    disabled={disabled}
                    onChange={(event) => setValue({ ...value, departmentIncomeAccounts: { ...value.departmentIncomeAccounts, [department]: accountValue(event.target.value) } })} />
                </div>
              ))}
              <div className="space-y-1">
                <Label htmlFor="sage-ar-invoice-deposit">Deposit account</Label>
                <Input id="sage-ar-invoice-deposit" inputMode="numeric" value={value.depositAccount === null ? "" : String(value.depositAccount)} disabled={disabled}
                  onChange={(event) => setValue({ ...value, depositAccount: accountValue(event.target.value) })} />
              </div>
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
