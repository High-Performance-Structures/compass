"use client"

/*
 * Settings > Workflows > Selections: the company's selection rounds (name,
 * the schedule item that sets the due date, days before it), default lead
 * times by category, how many days ahead a long lead time is flagged, the
 * owner-price markup, and the variance-to-change-order threshold. Also
 * offers the "Save to Compass" bookmarks-bar button.
 */
import * as React from "react"
import { IconArrowDown, IconArrowUp, IconPlus, IconTrash } from "@tabler/icons-react"
import { toast } from "sonner"

import { getFeatureSettingsForEditor, resetFeatureSettings, saveFeatureSettings } from "@/app/actions/feature-settings"
import { SaveToCompassBookmarklet } from "@/components/selections/save-to-compass-bookmarklet"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { FEATURE_SETTINGS } from "@/lib/feature-settings/registry"
import { newRoundId, selectionSettingsSchema, type SelectionRound, type SelectionSettings } from "@/lib/feature-settings/selection-settings"
import { moveLine } from "@/lib/shared/line-order"

const GROUP = FEATURE_SETTINGS.selections

type LeadRow = { readonly key: string; readonly category: string; readonly days: string }

function leadRows(settings: SelectionSettings): readonly LeadRow[] {
  return Object.entries(settings.leadTimeDays).map(([category, days]) => ({ key: crypto.randomUUID(), category, days: String(days) }))
}

function numberOrNull(text: string): number | null {
  const value = text.trim() === "" ? Number.NaN : Number(text)
  return Number.isFinite(value) ? value : null
}

export function SelectionSettingsSection(): React.ReactElement {
  const [loaded, setLoaded] = React.useState(false)
  const [canEdit, setCanEdit] = React.useState(false)
  const [customized, setCustomized] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [rounds, setRounds] = React.useState<readonly SelectionRound[]>(GROUP.defaults.rounds)
  const [leads, setLeads] = React.useState<readonly LeadRow[]>([])
  const [warnDays, setWarnDays] = React.useState(String(GROUP.defaults.leadTimeWarningDays))
  const [markup, setMarkup] = React.useState("")
  const [threshold, setThreshold] = React.useState(String(GROUP.defaults.changeOrderThresholdPercent))
  const [pending, startTransition] = React.useTransition()

  const load = React.useCallback(async () => {
    const result = await getFeatureSettingsForEditor("selections")
    if (!result.success) {
      setError(result.error)
      return
    }
    const parsed = selectionSettingsSchema.safeParse(result.data.settings)
    const value = parsed.success ? parsed.data : GROUP.defaults
    setRounds(value.rounds)
    setLeads(leadRows(value))
    setWarnDays(String(value.leadTimeWarningDays))
    setMarkup(value.ownerMarkupPercent === null ? "" : String(value.ownerMarkupPercent))
    setThreshold(String(value.changeOrderThresholdPercent))
    setCanEdit(result.data.canEdit)
    setCustomized(result.data.customized)
    setLoaded(true)
  }, [])

  React.useEffect(() => {
    void load()
  }, [load])

  function updateRound(index: number, patch: Partial<SelectionRound>): void {
    setRounds((current) => current.map((round, at) => (at === index ? { ...round, ...patch } : round)))
  }

  function save(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    const thresholdValue = numberOrNull(threshold)
    const warnDaysValue = numberOrNull(warnDays)
    const value: SelectionSettings = {
      rounds: [...rounds],
      leadTimeDays: Object.fromEntries(
        leads.flatMap((row) => {
          const days = numberOrNull(row.days)
          return row.category.trim() && days !== null ? [[row.category.trim(), Math.round(days)]] : []
        }),
      ),
      leadTimeWarningDays: warnDaysValue === null ? GROUP.defaults.leadTimeWarningDays : Math.round(warnDaysValue),
      ownerMarkupPercent: numberOrNull(markup),
      changeOrderThresholdPercent: thresholdValue ?? GROUP.defaults.changeOrderThresholdPercent,
    }
    const checked = selectionSettingsSchema.safeParse(value)
    if (!checked.success) {
      toast.error("Check the Selection Phases, lead times and percents: names are required, days are 0-730, the lead-time warning is 0-90 days, percents can't be negative.")
      return
    }
    startTransition(async () => {
      const result = await saveFeatureSettings("selections", checked.data)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success("Selection settings saved.")
      await load()
    })
  }

  function reset(): void {
    startTransition(async () => {
      const result = await resetFeatureSettings("selections")
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success("Selection settings reset to the defaults.")
      await load()
    })
  }

  const disabled = pending || !canEdit
  return (
    <section aria-labelledby="selection-settings" className="space-y-4 border-b pb-6">
      <div>
        <h2 id="selection-settings" className="text-base font-semibold">{GROUP.label}</h2>
        <p className="text-sm text-muted-foreground">{GROUP.description}</p>
      </div>
      <SaveToCompassBookmarklet />
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {!loaded && !error ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
      {loaded ? (
        <form onSubmit={save} className="space-y-6">
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Selection Phases</legend>
            <p className="text-xs text-muted-foreground">
              Selections are released to the owner in Selection Phases. A Selection Phase is due the given number of days before the first schedule
              item whose title contains the text you enter (for example &quot;Drywall&quot;). Leave the schedule item blank for a Selection Phase without a date.
            </p>
            {rounds.map((round, index) => (
              <div key={round.id} className="grid items-end gap-2 sm:grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)_7rem_auto]">
                <div className="flex gap-1">
                  <Button type="button" variant="ghost" size="icon" className="size-8" aria-label={`Move ${round.name} up`} disabled={disabled || index === 0}
                    onClick={() => setRounds((current) => moveLine(current, index, index - 1))}>
                    <IconArrowUp className="size-4" />
                  </Button>
                  <Button type="button" variant="ghost" size="icon" className="size-8" aria-label={`Move ${round.name} down`} disabled={disabled || index === rounds.length - 1}
                    onClick={() => setRounds((current) => moveLine(current, index, index + 1))}>
                    <IconArrowDown className="size-4" />
                  </Button>
                </div>
                <div className="space-y-1">
                  <Label htmlFor={`round-name-${round.id}`}>Selection Phase name</Label>
                  <Input id={`round-name-${round.id}`} value={round.name} maxLength={80} disabled={disabled} onChange={(event) => updateRound(index, { name: event.target.value })} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor={`round-item-${round.id}`}>Schedule item</Label>
                  <Input id={`round-item-${round.id}`} value={round.scheduleItem} maxLength={120} disabled={disabled} placeholder="e.g. Drywall"
                    onChange={(event) => updateRound(index, { scheduleItem: event.target.value })} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor={`round-buffer-${round.id}`}>Days before</Label>
                  <Input id={`round-buffer-${round.id}`} inputMode="numeric" value={String(round.bufferDays)} disabled={disabled}
                    onChange={(event) => updateRound(index, { bufferDays: Math.max(0, Math.min(365, Math.round(Number(event.target.value) || 0))) })} />
                </div>
                <Button type="button" variant="ghost" size="icon" className="size-8" aria-label={`Remove ${round.name}`} disabled={disabled}
                  onClick={() => setRounds((current) => current.filter((_, at) => at !== index))}>
                  <IconTrash className="size-4" />
                </Button>
              </div>
            ))}
            {canEdit && (
              <Button type="button" variant="outline" size="sm" disabled={pending || rounds.length >= 20}
                onClick={() => setRounds((current) => [...current, { id: newRoundId(`round-${current.length + 1}`, current.map((round) => round.id)), name: `Selection Phase ${current.length + 1}`, scheduleItem: "", bufferDays: 21 }])}>
                <IconPlus className="size-4" /> Add Selection Phase
              </Button>
            )}
          </fieldset>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Default lead time by category</legend>
            <p className="text-xs text-muted-foreground">New choices in a selection of this category start with this lead time; staff can change it per choice.</p>
            {leads.map((row, index) => (
              <div key={row.key} className="grid items-end gap-2 sm:grid-cols-[minmax(0,1fr)_8rem_auto]">
                <div className="space-y-1">
                  <Label htmlFor={`lead-category-${row.key}`}>Category</Label>
                  <Input id={`lead-category-${row.key}`} value={row.category} maxLength={80} disabled={disabled}
                    onChange={(event) => setLeads((current) => current.map((item, at) => (at === index ? { ...item, category: event.target.value } : item)))} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor={`lead-days-${row.key}`}>Days</Label>
                  <Input id={`lead-days-${row.key}`} inputMode="numeric" value={row.days} disabled={disabled}
                    onChange={(event) => setLeads((current) => current.map((item, at) => (at === index ? { ...item, days: event.target.value } : item)))} />
                </div>
                <Button type="button" variant="ghost" size="icon" className="size-8" aria-label={`Remove ${row.category || "category"}`} disabled={disabled}
                  onClick={() => setLeads((current) => current.filter((_, at) => at !== index))}>
                  <IconTrash className="size-4" />
                </Button>
              </div>
            ))}
            {canEdit && (
              <Button type="button" variant="outline" size="sm" disabled={pending}
                onClick={() => setLeads((current) => [...current, { key: crypto.randomUUID(), category: "", days: "" }])}>
                <IconPlus className="size-4" /> Add category
              </Button>
            )}
            <div className="max-w-xs space-y-1 pt-2">
              <Label htmlFor="selection-lead-warning">Warn about long lead times (days ahead)</Label>
              <Input id="selection-lead-warning" inputMode="numeric" value={warnDays} disabled={disabled} onChange={(event) => setWarnDays(event.target.value)} />
              <p className="text-xs text-muted-foreground">
                A choice must be ordered by its selection&apos;s due date minus its lead time. This many days before that order-by date, staff see a warning
                on the selection, the owner sees &quot;choose by&quot; on that choice, and the project manager gets a to-do to order it.
              </p>
            </div>
          </fieldset>

          <div className="grid max-w-xl gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="selection-markup">Owner price markup (%)</Label>
              <Input id="selection-markup" inputMode="decimal" value={markup} disabled={disabled} placeholder="No markup" onChange={(event) => setMarkup(event.target.value)} />
              <p className="text-xs text-muted-foreground">Fills in a choice&apos;s owner price from the supplier price when staff leave it blank. Staff can change it.</p>
            </div>
            <div className="space-y-1">
              <Label htmlFor="selection-threshold">Variance becomes a change order at (%)</Label>
              <Input id="selection-threshold" inputMode="decimal" value={threshold} disabled={disabled} onChange={(event) => setThreshold(event.target.value)} />
              <p className="text-xs text-muted-foreground">A selection variance more than this percent over budget is handled as a change order needing the owner&apos;s signature.</p>
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
