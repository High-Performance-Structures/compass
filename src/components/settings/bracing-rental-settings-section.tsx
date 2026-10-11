"use client"

import * as React from "react"
import { IconPlus, IconTrash } from "@tabler/icons-react"
import { toast } from "sonner"
import { getFeatureSettingsForEditor, resetFeatureSettings, saveFeatureSettings } from "@/app/actions/feature-settings"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { bracingRentalSettingsSchema, FEATURE_SETTINGS, type BracingRentalSettings } from "@/lib/feature-settings/registry"

const GROUP = FEATURE_SETTINGS["bracing-rentals"]

function itemKey(label: string, taken: ReadonlySet<string>): string {
  const base = label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 32) || "item"
  let key = base
  for (let suffix = 2; taken.has(key); suffix += 1) key = `${base}_${suffix}`
  return key
}

/**
 * Settings → Workflows → Bracing rentals: the rental equipment and sizes,
 * how much the company owns, the daily rate, and sign-out rules.
 */
export function BracingRentalSettingsSection(): React.ReactElement {
  const [loaded, setLoaded] = React.useState(false)
  const [canEdit, setCanEdit] = React.useState(false)
  const [customized, setCustomized] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [settings, setSettings] = React.useState<BracingRentalSettings>(GROUP.defaults)
  const [rate, setRate] = React.useState("")
  const [sizes, setSizes] = React.useState("")
  const [newItem, setNewItem] = React.useState("")
  const [pending, startTransition] = React.useTransition()

  const load = React.useCallback(async () => {
    const result = await getFeatureSettingsForEditor("bracing-rentals")
    if (!result.success) {
      setError(result.error)
      return
    }
    const parsed = bracingRentalSettingsSchema.safeParse(result.data.settings)
    const next = parsed.success ? parsed.data : GROUP.defaults
    setSettings(next)
    setRate((next.dailyRateCents / 100).toFixed(2))
    setSizes(next.sizes.join(", "))
    setCanEdit(result.data.canEdit)
    setCustomized(result.data.customized)
    setLoaded(true)
  }, [])

  React.useEffect(() => {
    void load()
  }, [load])

  const sizeList = sizes
    .split(",")
    .map((size) => size.trim())
    .filter(Boolean)
  const columns = sizeList.length > 0 ? sizeList : [""]
  const disabled = pending || !canEdit

  function setOwned(key: string, size: string, value: string): void {
    const parsed = Number.parseInt(value, 10)
    const owned = Number.isFinite(parsed) && parsed > 0 ? parsed : 0
    setSettings((current) => ({
      ...current,
      items: current.items.map((item) => (item.key === key ? { ...item, owned: { ...item.owned, [size]: owned } } : item)),
    }))
  }

  function addItem(): void {
    const label = newItem.trim()
    if (!label) return
    setSettings((current) => ({
      ...current,
      items: [...current.items, { key: itemKey(label, new Set(current.items.map((item) => item.key))), label, owned: {} }],
    }))
    setNewItem("")
  }

  function save(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    const dailyRateCents = Math.round(Number.parseFloat(rate.replace(/[$,]/g, "")) * 100)
    if (!Number.isFinite(dailyRateCents) || dailyRateCents < 0) {
      toast.error("Enter the daily rate per brace.")
      return
    }
    // Keep owned counts only for sizes still listed.
    const items = settings.items.map((item) => ({
      ...item,
      owned: Object.fromEntries(Object.entries(item.owned).filter(([size, count]) => columns.includes(size) && count > 0)),
    }))
    startTransition(async () => {
      const result = await saveFeatureSettings("bracing-rentals", { ...settings, dailyRateCents, sizes: sizeList, items })
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success("Bracing rental settings saved.")
      await load()
    })
  }

  function reset(): void {
    startTransition(async () => {
      const result = await resetFeatureSettings("bracing-rentals")
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success("Bracing rental settings reset.")
      await load()
    })
  }

  return (
    <section aria-labelledby="bracing-rental-settings-heading" id="bracing-rental-settings" className="scroll-mt-4 space-y-4 border-b pb-6">
      <div>
        <h2 id="bracing-rental-settings-heading" className="text-base font-semibold">{GROUP.label}</h2>
        <p className="text-sm text-muted-foreground">{GROUP.description}</p>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {!loaded && !error ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
      {loaded ? (
        <form onSubmit={save} className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-4">
            <div className="space-y-1.5">
              <Label htmlFor="bracing-rate">Daily rate per brace ($)</Label>
              <Input id="bracing-rate" inputMode="decimal" value={rate} disabled={disabled} onChange={(event) => setRate(event.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bracing-billed">Counted as a brace</Label>
              <Select value={settings.billedItemKey} disabled={disabled} onValueChange={(value) => setSettings((current) => ({ ...current, billedItemKey: value }))}>
                <SelectTrigger id="bracing-billed" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {settings.items.map((item) => (
                    <SelectItem key={item.key} value={item.key}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bracing-deposit">Deposit before sign-out (%)</Label>
              <Input
                id="bracing-deposit"
                inputMode="numeric"
                value={String(settings.minDepositPercent)}
                disabled={disabled}
                onChange={(event) => {
                  const parsed = Number.parseInt(event.target.value, 10)
                  setSettings((current) => ({ ...current, minDepositPercent: Number.isFinite(parsed) ? Math.min(100, Math.max(0, parsed)) : 0 }))
                }}
              />
            </div>
            <div className="flex items-end gap-2 pb-2">
              <Switch
                id="bracing-id"
                checked={settings.requireIdCopy}
                disabled={disabled}
                onCheckedChange={(checked) => setSettings((current) => ({ ...current, requireIdCopy: checked }))}
              />
              <Label htmlFor="bracing-id">Require a copy of ID</Label>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="bracing-sizes">Sizes (comma-separated)</Label>
            <Input id="bracing-sizes" value={sizes} disabled={disabled} onChange={(event) => setSizes(event.target.value)} className="max-w-md" />
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[36rem] text-sm">
              <caption className="pb-2 text-left text-xs text-muted-foreground">Equipment and how many you own, by size. Leave a size blank or 0 when you don&apos;t stock it.</caption>
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="py-2 pr-2 font-medium">Item</th>
                  {columns.map((size) => (
                    <th key={size} className="py-2 pr-2 font-medium">{size || "Owned"}</th>
                  ))}
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {settings.items.map((item) => (
                  <tr key={item.key} className="border-b">
                    <td className="min-w-52 py-1.5 pr-2">
                      <Input
                        aria-label={`${item.label} name`}
                        className="h-8"
                        value={item.label}
                        disabled={disabled}
                        onChange={(event) =>
                          setSettings((current) => ({
                            ...current,
                            items: current.items.map((entry) => (entry.key === item.key ? { ...entry, label: event.target.value } : entry)),
                          }))
                        }
                      />
                    </td>
                    {columns.map((size) => (
                      <td key={size} className="w-24 py-1.5 pr-2">
                        <Input
                          aria-label={`${item.label} ${size || ""} owned`}
                          inputMode="numeric"
                          className="h-8"
                          value={item.owned[size] ? String(item.owned[size]) : ""}
                          disabled={disabled}
                          onChange={(event) => setOwned(item.key, size, event.target.value)}
                        />
                      </td>
                    ))}
                    <td className="w-10 py-1.5">
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        aria-label={`Remove ${item.label}`}
                        disabled={disabled || item.key === settings.billedItemKey || settings.items.length <= 1}
                        onClick={() => setSettings((current) => ({ ...current, items: current.items.filter((entry) => entry.key !== item.key) }))}
                      >
                        <IconTrash className="size-4" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {canEdit ? (
            <div className="flex flex-wrap items-center gap-2">
              <Input aria-label="Add a bracing item" placeholder="Add an item" value={newItem} onChange={(event) => setNewItem(event.target.value)} className="h-9 max-w-xs" disabled={pending} />
              <Button type="button" size="sm" variant="outline" onClick={addItem} disabled={pending || !newItem.trim()}>
                <IconPlus className="size-4" />
                Add item
              </Button>
            </div>
          ) : null}

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
          </div>
        </form>
      ) : null}
    </section>
  )
}
