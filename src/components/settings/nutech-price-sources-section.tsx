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
import {
  FEATURE_SETTINGS,
  nuTechPriceSourcesSettingsSchema,
  type NuTechPriceSourcesSettings,
} from "@/lib/feature-settings/registry"
import { spreadsheetIdFromValue } from "@/lib/nutech/resources"

const DEFAULTS = FEATURE_SETTINGS["nutech-price-sources"].defaults

type SheetKey = "newStandardSheet" | "newCashSheet" | "returningStandardSheet" | "returningCashSheet"

const SHEET_FIELDS: readonly { readonly key: SheetKey; readonly label: string }[] = [
  { key: "newStandardSheet", label: "New client – standard" },
  { key: "newCashSheet", label: "New client – cash" },
  { key: "returningStandardSheet", label: "Returning customer – standard" },
  { key: "returningCashSheet", label: "Returning customer – cash" },
]

/**
 * Nu-Tech price list sources: the four Google Sheets the catalog import reads
 * and the tab it reads. Admins point these at the new files each price year;
 * nothing changes until someone imports and activates the catalog.
 */
export function NuTechPriceSourcesSection(): React.ReactElement {
  const [settings, setSettings] = React.useState<NuTechPriceSourcesSettings>(DEFAULTS)
  const [canEdit, setCanEdit] = React.useState(false)
  const [customized, setCustomized] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [pending, startTransition] = React.useTransition()

  const load = React.useCallback(async () => {
    const result = await getFeatureSettingsForEditor("nutech-price-sources")
    if (!result.success) {
      setError(result.error)
      return
    }
    const parsed = nuTechPriceSourcesSettingsSchema.safeParse(result.data.settings)
    setSettings(parsed.success ? parsed.data : DEFAULTS)
    setCanEdit(result.data.canEdit)
    setCustomized(result.data.customized)
  }, [])

  React.useEffect(() => {
    void load()
  }, [load])

  function save(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    const parsed = nuTechPriceSourcesSettingsSchema.safeParse(settings)
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Check the price list sources.")
      return
    }
    startTransition(async () => {
      const result = await saveFeatureSettings("nutech-price-sources", parsed.data)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success("Price list sources saved. Import the catalog to use them.")
      await load()
    })
  }

  function reset(): void {
    if (!window.confirm("Go back to the original 2026 price sheets?")) return
    startTransition(async () => {
      const result = await resetFeatureSettings("nutech-price-sources")
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success("Price list sources reset.")
      await load()
    })
  }

  const disabled = pending || !canEdit
  return (
    <section aria-labelledby="nutech-price-sources" className="space-y-4 border-b pb-6">
      <div>
        <h2 id="nutech-price-sources" className="text-base font-semibold">
          {FEATURE_SETTINGS["nutech-price-sources"].label}
        </h2>
        <p className="text-sm text-muted-foreground">
          {FEATURE_SETTINGS["nutech-price-sources"].description} Each sheet needs a “Target gross
          margin” row and a header row with Origin in column A and SKU in column C.
        </p>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <form className="grid gap-4 sm:grid-cols-2" onSubmit={save}>
        <div className="grid gap-1.5">
          <Label htmlFor="nutech-catalog-name">Price list name</Label>
          <Input
            id="nutech-catalog-name"
            value={settings.catalogName}
            disabled={disabled}
            placeholder="2027 Fox Blocks pricing"
            onChange={(event) => setSettings({ ...settings, catalogName: event.target.value })}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="nutech-catalog-effective">Effective date</Label>
          <Input
            id="nutech-catalog-effective"
            type="date"
            value={settings.effectiveDate}
            disabled={disabled}
            onChange={(event) => setSettings({ ...settings, effectiveDate: event.target.value })}
          />
        </div>
        {SHEET_FIELDS.map((field) => {
          const value = settings[field.key]
          const invalid = value.trim().length > 0 && spreadsheetIdFromValue(value) === null
          return (
            <div key={field.key} className="grid gap-1.5">
              <Label htmlFor={`nutech-sheet-${field.key}`}>{field.label} sheet</Label>
              <Input
                id={`nutech-sheet-${field.key}`}
                value={value}
                disabled={disabled}
                placeholder="Paste the Google Sheets link"
                aria-invalid={invalid}
                aria-describedby={invalid ? `nutech-sheet-${field.key}-error` : undefined}
                onChange={(event) => setSettings({ ...settings, [field.key]: event.target.value })}
              />
              {invalid ? (
                <p id={`nutech-sheet-${field.key}-error`} className="text-sm text-destructive">
                  That doesn’t look like a Google Sheets link.
                </p>
              ) : null}
            </div>
          )
        })}
        <div className="grid gap-1.5">
          <Label htmlFor="nutech-catalog-tab">Tab to read in each sheet</Label>
          <Input
            id="nutech-catalog-tab"
            value={settings.sourceTab}
            disabled={disabled}
            placeholder="2027 Cost & Margin"
            onChange={(event) => setSettings({ ...settings, sourceTab: event.target.value })}
          />
        </div>
        <div className="flex items-end gap-2">
          <Button type="submit" disabled={disabled}>
            Save
          </Button>
          {customized ? (
            <Button type="button" variant="outline" disabled={disabled} onClick={reset}>
              Reset to original
            </Button>
          ) : null}
        </div>
      </form>
      {!canEdit ? (
        <p className="text-sm text-muted-foreground">Only administrators can change the price list sources.</p>
      ) : null}
    </section>
  )
}
