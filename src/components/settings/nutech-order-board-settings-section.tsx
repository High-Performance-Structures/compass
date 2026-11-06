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
import { FEATURE_SETTINGS } from "@/lib/feature-settings/registry"
import type { NuTechOrderBoardSettings } from "@/lib/nutech/settings"

const GROUP = FEATURE_SETTINGS["nutech-order-board"]
const DEFAULTS = GROUP.defaults

function readWhole(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) ? value : fallback
}

function CountField({
  id,
  label,
  help,
  unit,
  min,
  value,
  onChange,
  disabled,
}: {
  readonly id: string
  readonly label: string
  readonly help: string
  readonly unit: string
  readonly min: number
  readonly value: string
  readonly onChange: (value: string) => void
  readonly disabled: boolean
}): React.ReactElement {
  return (
    <div className="grid gap-1.5 sm:grid-cols-[minmax(0,1fr)_11rem] sm:items-center sm:gap-4">
      <div>
        <Label htmlFor={id}>{label}</Label>
        <p className="text-xs text-muted-foreground">{help}</p>
      </div>
      <div className="flex items-center gap-2">
        <Input id={id} type="number" inputMode="numeric" min={min} step={1} value={value} disabled={disabled}
          onChange={(event) => onChange(event.target.value)} className="h-9 w-20 tabular-nums" />
        <span className="text-xs text-muted-foreground">{unit}</span>
      </div>
    </div>
  )
}

/** When orders land in the Nu-Tech order board's needs-attention boxes. */
export function NuTechOrderBoardSettingsSection(): React.ReactElement {
  const [loaded, setLoaded] = React.useState(false)
  const [canEdit, setCanEdit] = React.useState(false)
  const [customized, setCustomized] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [shipsWithin, setShipsWithin] = React.useState(String(DEFAULTS.shipsWithinDays))
  const [confirmation, setConfirmation] = React.useState(String(DEFAULTS.confirmationBusinessDays))
  const [invoiceAfter, setInvoiceAfter] = React.useState(String(DEFAULTS.invoiceAfterDeliveryDays))
  const [pending, startTransition] = React.useTransition()

  const load = React.useCallback(async () => {
    const result = await getFeatureSettingsForEditor("nutech-order-board")
    if (!result.success) {
      setError(result.error)
      return
    }
    const settings = result.data.settings
    setShipsWithin(String(readWhole(settings.shipsWithinDays, DEFAULTS.shipsWithinDays)))
    setConfirmation(String(readWhole(settings.confirmationBusinessDays, DEFAULTS.confirmationBusinessDays)))
    setInvoiceAfter(String(readWhole(settings.invoiceAfterDeliveryDays, DEFAULTS.invoiceAfterDeliveryDays)))
    setCanEdit(result.data.canEdit)
    setCustomized(result.data.customized)
    setLoaded(true)
  }, [])

  React.useEffect(() => {
    void load()
  }, [load])

  function save(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    const value: NuTechOrderBoardSettings = {
      shipsWithinDays: Number(shipsWithin),
      confirmationBusinessDays: Number(confirmation),
      invoiceAfterDeliveryDays: Number(invoiceAfter),
    }
    startTransition(async () => {
      const result = await saveFeatureSettings("nutech-order-board", value)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success("Nu-Tech order board settings saved.")
      await load()
    })
  }

  function reset(): void {
    startTransition(async () => {
      const result = await resetFeatureSettings("nutech-order-board")
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success("Nu-Tech order board settings reset to defaults.")
      await load()
    })
  }

  const disabled = pending || !canEdit
  return (
    <section aria-labelledby="nutech-order-board-settings" className="space-y-4 border-b pb-6">
      <div>
        <h2 id="nutech-order-board-settings" className="text-base font-semibold">{GROUP.label}</h2>
        <p className="text-sm text-muted-foreground">{GROUP.description}</p>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {!loaded && !error ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
      {loaded ? (
        <form onSubmit={save} className="space-y-4">
          <CountField id="nutech-board-ships" label="Ships soon" help="A pickup or delivery requested within this many days."
            unit="days" min={1} value={shipsWithin} onChange={setShipsWithin} disabled={disabled} />
          <CountField id="nutech-board-confirmation" label="Manufacturer hasn't confirmed" help="A sent PO with no confirmation number after this long."
            unit="business days" min={0} value={confirmation} onChange={setConfirmation} disabled={disabled} />
          <CountField id="nutech-board-invoice" label="No vendor invoice" help="A confirmed order this many days past its pickup or delivery date with no invoice."
            unit="days" min={0} value={invoiceAfter} onChange={setInvoiceAfter} disabled={disabled} />
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
              Defaults: {DEFAULTS.shipsWithinDays} days, {DEFAULTS.confirmationBusinessDays} business day, {DEFAULTS.invoiceAfterDeliveryDays} days.
            </p>
          </div>
        </form>
      ) : null}
    </section>
  )
}
