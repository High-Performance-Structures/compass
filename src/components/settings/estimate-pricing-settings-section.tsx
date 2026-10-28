"use client"

import * as React from "react"
import { toast } from "sonner"

import { getFeatureSettingsForEditor, resetFeatureSettings, saveFeatureSettings } from "@/app/actions/feature-settings"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import {
  PRICING_SOURCE_ACTIONS,
  PRICING_SOURCE_ACTION_LABELS,
  SAGE_COST_TYPES,
  SAGE_COST_TYPE_LABELS,
  estimatePricingSettingsSchema,
  type PricingSource,
} from "@/lib/estimates/pricing-sources"

function isAction(value: string): value is PricingSource["action"] {
  return PRICING_SOURCE_ACTIONS.some((action) => action === value)
}

function isCostType(value: string): value is PricingSource["sageCostType"] {
  return SAGE_COST_TYPES.some((type) => type === value)
}

/** A stable id from the label, unique among existing choices. */
function newSourceId(label: string, taken: ReadonlySet<string>): string {
  const base = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32) || "choice"
  let id = base
  for (let n = 2; taken.has(id); n += 1) id = `${base}-${n}`
  return id
}

/**
 * Settings → Workflows → Estimates: the "Priced by" choices on estimate lines.
 * Choices are turned off rather than deleted so lines that use one keep it.
 */
export function EstimatePricingSettingsSection(): React.ReactElement {
  const [loaded, setLoaded] = React.useState(false)
  const [canEdit, setCanEdit] = React.useState(false)
  const [customized, setCustomized] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [sources, setSources] = React.useState<readonly PricingSource[]>([])
  // Ids saved before this edit can't be renamed; lines store them.
  const [savedIds, setSavedIds] = React.useState<ReadonlySet<string>>(new Set())
  const [pending, startTransition] = React.useTransition()

  const load = React.useCallback(async () => {
    const result = await getFeatureSettingsForEditor("estimate-pricing")
    if (!result.success) {
      setError(result.error)
      return
    }
    const parsed = estimatePricingSettingsSchema.safeParse(result.data.settings)
    const next = parsed.success ? parsed.data.sources : []
    setSources(next)
    setSavedIds(new Set(next.map((source) => source.id)))
    setCanEdit(result.data.canEdit)
    setCustomized(result.data.customized)
    setLoaded(true)
  }, [])

  React.useEffect(() => {
    void load()
  }, [load])

  function update(index: number, patch: Partial<PricingSource>): void {
    setSources((current) => current.map((source, i) => (i === index ? { ...source, ...patch } : source)))
  }

  function addChoice(): void {
    setSources((current) => [
      ...current,
      { id: newSourceId("New choice", new Set(current.map((source) => source.id))), label: "New choice", action: "rfq", sageCostType: "other", ownerScope: false, active: true },
    ])
  }

  function save(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    // New choices take their id from the label they were saved with.
    const taken = new Set(savedIds)
    const prepared = sources.map((source) => {
      if (savedIds.has(source.id)) return source
      const id = newSourceId(source.label, taken)
      taken.add(id)
      return { ...source, id }
    })
    const parsed = estimatePricingSettingsSchema.safeParse({ sources: prepared })
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Check the choices and try again.")
      return
    }
    startTransition(async () => {
      const result = await saveFeatureSettings("estimate-pricing", parsed.data)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success("Estimate pricing saved")
      await load()
    })
  }

  function reset(): void {
    startTransition(async () => {
      const result = await resetFeatureSettings("estimate-pricing")
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success("Estimate pricing reset")
      await load()
    })
  }

  if (error) return <p className="text-sm text-destructive">{error}</p>
  if (!loaded) return <p className="text-sm text-muted-foreground">Loading…</p>

  return (
    <form onSubmit={save} className="grid gap-4 border-t pt-5">
      <div className="grid gap-1">
        <h3 className="text-sm font-semibold">Priced by</h3>
        <p className="max-w-prose text-sm text-muted-foreground">
          The choices on each estimate line for who gives us its number. Each choice sets the Sage cost type and what
          Compass does next. Owner scope keeps the line out of the builder fee and sales tax. Turn a choice off instead of
          removing it, so lines that already use it keep it.
        </p>
      </div>
      <fieldset className="grid gap-2" disabled={!canEdit || pending}>
        <legend className="sr-only">Priced by choices</legend>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="py-2 pr-4 font-medium">Choice</th>
                <th className="py-2 pr-4 font-medium">What Compass does</th>
                <th className="py-2 pr-4 font-medium">Sage cost type</th>
                <th className="py-2 pr-4 font-medium">Owner scope</th>
                <th className="py-2 font-medium">On</th>
              </tr>
            </thead>
            <tbody>
              {sources.map((source, index) => (
                <tr key={source.id} className="border-b">
                  <td className="py-2 pr-4">
                    <Input
                      aria-label={`Name of choice ${index + 1}`}
                      className="h-8 w-48"
                      value={source.label}
                      maxLength={40}
                      onChange={(event) => update(index, { label: event.target.value })}
                    />
                  </td>
                  <td className="py-2 pr-4">
                    <Select value={source.action} onValueChange={(value) => { if (isAction(value)) update(index, { action: value }) }}>
                      <SelectTrigger aria-label={`What Compass does for ${source.label}`} className="h-8 w-60">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {PRICING_SOURCE_ACTIONS.map((action) => (
                          <SelectItem key={action} value={action}>
                            {PRICING_SOURCE_ACTION_LABELS[action]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="py-2 pr-4">
                    <Select value={source.sageCostType} onValueChange={(value) => { if (isCostType(value)) update(index, { sageCostType: value }) }}>
                      <SelectTrigger aria-label={`Sage cost type for ${source.label}`} className="h-8 w-36">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {SAGE_COST_TYPES.map((type) => (
                          <SelectItem key={type} value={type}>
                            {SAGE_COST_TYPE_LABELS[type]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="py-2 pr-4">
                    <Checkbox
                      aria-label={`${source.label} is owner scope`}
                      checked={source.ownerScope}
                      onCheckedChange={(checked) => update(index, { ownerScope: checked === true })}
                    />
                  </td>
                  <td className="py-2">
                    <Switch
                      aria-label={`Offer ${source.label} on estimate lines`}
                      checked={source.active}
                      onCheckedChange={(active) => update(index, { active })}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div>
          <Button type="button" variant="outline" size="sm" onClick={addChoice} disabled={sources.length >= 20}>
            Add choice
          </Button>
        </div>
      </fieldset>
      {canEdit ? (
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={pending}>
            Save
          </Button>
          {customized ? (
            <Button type="button" variant="outline" disabled={pending} onClick={reset}>
              Reset to defaults
            </Button>
          ) : null}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Only admins can change these settings.</p>
      )}
    </form>
  )
}
