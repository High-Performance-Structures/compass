"use client"

import * as React from "react"
import { toast } from "sonner"
import { getFeatureSettingsForEditor, saveFeatureSettings } from "@/app/actions/feature-settings"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { FEATURE_SETTINGS, shopTicketSettingsSchema, type ShopTicketSettings } from "@/lib/feature-settings/registry"
import { formatTicketNumber } from "@/lib/shop-tickets/model"

const DEFAULTS = FEATURE_SETTINGS["shop-tickets"].defaults

const DEPARTMENTS: readonly { readonly value: ShopTicketSettings["issuingDepartment"]; readonly label: string }[] = [
  { value: "H", label: "HPS" },
  { value: "O", label: "ORC" },
  { value: "N", label: "Nu-Tech" },
  { value: "D", label: "Design" },
]

/**
 * Shop tickets: ticket numbering and the letterhead the printed ticket uses.
 * Rates are not here; they come from the rate book's Labor and Machine entries.
 */
export function ShopTicketSettingsSection(): React.ReactElement {
  const [settings, setSettings] = React.useState<ShopTicketSettings>(DEFAULTS)
  const [startNumber, setStartNumber] = React.useState(String(DEFAULTS.startNumber))
  const [canEdit, setCanEdit] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [pending, startTransition] = React.useTransition()

  const load = React.useCallback(async () => {
    const result = await getFeatureSettingsForEditor("shop-tickets")
    if (!result.success) {
      setError(result.error)
      return
    }
    const parsed = shopTicketSettingsSchema.safeParse(result.data.settings)
    const next = parsed.success ? parsed.data : DEFAULTS
    setSettings(next)
    setStartNumber(String(next.startNumber))
    setCanEdit(result.data.canEdit)
  }, [])

  React.useEffect(() => {
    void load()
  }, [load])

  function save(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    const parsed = shopTicketSettingsSchema.safeParse({ ...settings, startNumber: Number(startNumber) })
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Check the shop ticket settings.")
      return
    }
    startTransition(async () => {
      const result = await saveFeatureSettings("shop-tickets", parsed.data)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success("Shop ticket settings saved.")
      await load()
    })
  }

  const disabled = pending || !canEdit
  return (
    <section aria-labelledby="shop-ticket-settings" className="space-y-4 border-b pb-6">
      <div>
        <h2 id="shop-ticket-settings" className="text-base font-semibold">{FEATURE_SETTINGS["shop-tickets"].label}</h2>
        <p className="text-sm text-muted-foreground">
          {FEATURE_SETTINGS["shop-tickets"].description} Labor and Machine rates are set in the Rate book.
        </p>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <form className="grid gap-4 sm:grid-cols-2" onSubmit={save}>
        <div className="grid gap-1.5">
          <Label htmlFor="shop-ticket-prefix">Number prefix</Label>
          <Input
            id="shop-ticket-prefix"
            value={settings.numberPrefix}
            disabled={disabled}
            onChange={(event) => setSettings({ ...settings, numberPrefix: event.target.value })}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="shop-ticket-start">Starting number</Label>
          <Input
            id="shop-ticket-start"
            inputMode="numeric"
            value={startNumber}
            disabled={disabled}
            onChange={(event) => setStartNumber(event.target.value.replace(/\D/g, ""))}
            aria-describedby="shop-ticket-start-help"
          />
          <p id="shop-ticket-start-help" className="text-sm text-muted-foreground">
            The first ticket is {formatTicketNumber(settings.numberPrefix, Number(startNumber) || 1)}; later tickets continue from the highest number.
          </p>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="shop-ticket-title">Ticket heading</Label>
          <Input
            id="shop-ticket-title"
            value={settings.title}
            disabled={disabled}
            onChange={(event) => setSettings({ ...settings, title: event.target.value })}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="shop-ticket-subtitle">Line under the company name</Label>
          <Input
            id="shop-ticket-subtitle"
            value={settings.subtitle}
            disabled={disabled}
            onChange={(event) => setSettings({ ...settings, subtitle: event.target.value })}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="shop-ticket-department">Letterhead</Label>
          <Select
            value={settings.issuingDepartment}
            disabled={disabled}
            onValueChange={(value) => {
              const department = DEPARTMENTS.find((option) => option.value === value)
              if (department) setSettings({ ...settings, issuingDepartment: department.value })
            }}
          >
            <SelectTrigger id="shop-ticket-department">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DEPARTMENTS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-end">
          <Button type="submit" disabled={disabled}>
            Save
          </Button>
        </div>
      </form>
    </section>
  )
}
