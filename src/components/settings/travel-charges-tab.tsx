"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Plus, Trash2 } from "lucide-react"

import {
  getTravelChargeSettings,
  resetTravelChargeSettings,
  saveTravelChargeSettings,
  type TravelChargeSettingsView,
} from "@/app/actions/travel-charges"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import {
  zoneRangeLabel,
  type TravelChargeSettings,
} from "@/lib/portfolio-map/travel-zones"

type ZoneDraft = { readonly maxMiles: string; readonly rate: string; readonly lodging: boolean }
type BandDraft = { readonly minFeet: string; readonly rate: string }
type Draft = {
  readonly homeLabel: string
  readonly homeLat: string
  readonly homeLon: string
  readonly zones: readonly ZoneDraft[]
  readonly bands: readonly BandDraft[]
  readonly lodging: string
  readonly perDiem: string
}

function dollars(cents: number | null): string {
  return cents === null ? "" : (cents / 100).toFixed(2)
}

function toDraft(settings: TravelChargeSettings): Draft {
  return {
    homeLabel: settings.homeBase.label,
    homeLat: String(settings.homeBase.lat),
    homeLon: String(settings.homeBase.lon),
    zones: settings.zones.map((zone) => ({
      maxMiles: zone.maxMiles === null ? "" : String(zone.maxMiles),
      rate: dollars(zone.ratePerManHourCents),
      lodging: zone.lodgingAndPerDiem,
    })),
    bands: settings.mountainBands.map((band) => ({
      minFeet: String(band.minElevationFt),
      rate: dollars(band.ratePerManHourCents),
    })),
    lodging: dollars(settings.lodgingPerNightCents),
    perDiem: dollars(settings.perDiemPerDayCents),
  }
}

function centsOf(value: string): number {
  const number = Number(value.replace(/[$,\s]/g, ""))
  return Number.isFinite(number) ? Math.round(number * 100) : Number.NaN
}

function optionalCents(value: string): number | null {
  return value.trim() === "" ? null : centsOf(value)
}

/** Draft to the settings shape; the server validates it again. */
function fromDraft(draft: Draft): unknown {
  return {
    homeBase: { label: draft.homeLabel.trim(), lat: Number(draft.homeLat), lon: Number(draft.homeLon) },
    zones: draft.zones.map((zone, index) => ({
      maxMiles: index === draft.zones.length - 1 ? null : Number(zone.maxMiles),
      ratePerManHourCents: optionalCents(zone.rate),
      lodgingAndPerDiem: zone.lodging,
    })),
    mountainBands: draft.bands.map((band) => ({
      minElevationFt: Number(band.minFeet),
      ratePerManHourCents: optionalCents(band.rate),
    })),
    lodgingPerNightCents: optionalCents(draft.lodging),
    perDiemPerDayCents: optionalCents(draft.perDiem),
  }
}

/** "9,000–9,999 ft", "10,000+ ft" as the draft currently reads. */
function bandRangeLabel(bands: readonly BandDraft[], index: number): string {
  const start = Number(bands[index]?.minFeet)
  const next = Number(bands[index + 1]?.minFeet)
  if (!Number.isFinite(start)) return ""
  const feet = (value: number): string => value.toLocaleString("en-US")
  return Number.isFinite(next) && next > start ? `${feet(start)}–${feet(next - 1)} ft` : `${feet(start)}+ ft`
}

/** Ranges as the draft currently reads, for the zone labels. */
function previewZones(draft: Draft): TravelChargeSettings["zones"] {
  return draft.zones.map((zone, index) => ({
    maxMiles: index === draft.zones.length - 1 ? null : Number(zone.maxMiles) || 0,
    ratePerManHourCents: 0,
    lodgingAndPerDiem: zone.lodging,
  }))
}

export function TravelChargesTab(): React.ReactElement {
  const router = useRouter()
  const [view, setView] = React.useState<TravelChargeSettingsView | null>(null)
  const [draft, setDraft] = React.useState<Draft | null>(null)
  const [message, setMessage] = React.useState<{ readonly tone: "ok" | "error"; readonly text: string } | null>(null)
  const [pending, startTransition] = React.useTransition()

  const load = React.useCallback(async (): Promise<void> => {
    const result = await getTravelChargeSettings()
    if (!result.success) {
      setMessage({ tone: "error", text: result.error })
      return
    }
    setView(result.view)
    setDraft(toDraft(result.view.settings))
  }, [])

  React.useEffect(() => {
    void load()
  }, [load])

  if (!draft || !view) {
    return <p className="text-sm text-muted-foreground">{message?.text ?? "Loading zone charges…"}</p>
  }

  const readOnly = !view.canEdit || pending
  const update = (next: Partial<Draft>): void => setDraft({ ...draft, ...next })
  const updateZone = (index: number, next: Partial<ZoneDraft>): void =>
    update({ zones: draft.zones.map((zone, i) => (i === index ? { ...zone, ...next } : zone)) })
  const updateBand = (index: number, next: Partial<BandDraft>): void =>
    update({ bands: draft.bands.map((band, i) => (i === index ? { ...band, ...next } : band)) })
  const zonesPreview = previewZones(draft)

  const save = (): void => {
    setMessage(null)
    startTransition(async () => {
      const result = await saveTravelChargeSettings(fromDraft(draft))
      if (!result.success) {
        setMessage({ tone: "error", text: result.error })
        return
      }
      await load()
      router.refresh()
      setMessage({ tone: "ok", text: "Zone charges saved." })
    })
  }

  const reset = (): void => {
    setMessage(null)
    startTransition(async () => {
      const result = await resetTravelChargeSettings()
      if (!result.success) {
        setMessage({ tone: "error", text: result.error })
        return
      }
      await load()
      router.refresh()
      setMessage({ tone: "ok", text: "Zone charges reset to the defaults." })
    })
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold">Zone charges</h2>
        <p className="text-sm text-muted-foreground">
          Added cost per man-hour by straight-line distance from home base, plus a mountain charge by site elevation.
          Rates follow fuel costs; changes show on the dashboard map right away. Leave a rate blank until you
          know it.
          {view.canEdit
            ? ""
            : " Administrators, company owners, the office manager, project administrators and estimators can change these."}
        </p>
      </div>

      <section className="flex flex-col gap-3" aria-labelledby="travel-home">
        <h3 id="travel-home" className="text-sm font-medium">Home base</h3>
        <div className="grid gap-3 sm:grid-cols-[2fr_1fr_1fr]">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="travel-home-label">Name</Label>
            <Input id="travel-home-label" value={draft.homeLabel} disabled={readOnly}
              onChange={(event) => update({ homeLabel: event.target.value })} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="travel-home-lat">Latitude</Label>
            <Input id="travel-home-lat" inputMode="decimal" value={draft.homeLat} disabled={readOnly}
              onChange={(event) => update({ homeLat: event.target.value })} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="travel-home-lon">Longitude</Label>
            <Input id="travel-home-lon" inputMode="decimal" value={draft.homeLon} disabled={readOnly}
              onChange={(event) => update({ homeLon: event.target.value })} />
          </div>
        </div>
      </section>

      <Separator />

      <section className="flex flex-col gap-3" aria-labelledby="travel-zones">
        <h3 id="travel-zones" className="text-sm font-medium">Distance zones</h3>
        <div className="flex flex-col gap-2">
          {draft.zones.map((zone, index) => {
            const last = index === draft.zones.length - 1
            return (
              <div key={index} className="grid items-end gap-3 sm:grid-cols-[5rem_8rem_8rem_1fr_auto]">
                <div className="flex min-h-9 flex-col justify-end text-sm">
                  <span className="font-medium">Zone {index}</span>
                  <span className="text-xs text-muted-foreground">{zoneRangeLabel(zonesPreview, index)}</span>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor={`zone-miles-${index}`}>Up to (miles)</Label>
                  <Input id={`zone-miles-${index}`} inputMode="numeric" disabled={readOnly || last}
                    value={last ? "" : zone.maxMiles} placeholder={last ? "and beyond" : ""}
                    onChange={(event) => updateZone(index, { maxMiles: event.target.value })} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor={`zone-rate-${index}`}>$ per man-hour</Label>
                  <Input id={`zone-rate-${index}`} inputMode="decimal" placeholder="Not set" value={zone.rate} disabled={readOnly}
                    onChange={(event) => updateZone(index, { rate: event.target.value })} />
                </div>
                <label className="flex min-h-9 items-center gap-2 text-sm">
                  <Checkbox checked={zone.lodging} disabled={readOnly}
                    onCheckedChange={(checked) => updateZone(index, { lodging: checked === true })} />
                  Lodging + per diem
                </label>
                <Button type="button" variant="ghost" size="icon" aria-label={`Remove zone ${index}`}
                  disabled={readOnly || draft.zones.length <= 1}
                  onClick={() => update({ zones: draft.zones.filter((_, i) => i !== index) })}>
                  <Trash2 aria-hidden="true" />
                </Button>
              </div>
            )
          })}
        </div>
        <div>
          <Button type="button" variant="outline" size="sm" disabled={readOnly || draft.zones.length >= 8}
            onClick={() => {
              // Insert before the open-ended last zone, 20 miles past the previous edge.
              const bounded = draft.zones.slice(0, -1)
              const lastEdge = Number(bounded[bounded.length - 1]?.maxMiles ?? 0) || 0
              const open = draft.zones[draft.zones.length - 1] ?? { maxMiles: "", rate: "", lodging: false }
              update({ zones: [...bounded, { maxMiles: String(lastEdge + 20), rate: open.rate, lodging: false }, open] })
            }}>
            <Plus aria-hidden="true" />
            Add zone
          </Button>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="travel-lodging">Lodging ($ per night)</Label>
            <Input id="travel-lodging" inputMode="decimal" placeholder="Not set" value={draft.lodging} disabled={readOnly}
              onChange={(event) => update({ lodging: event.target.value })} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="travel-per-diem">Per diem ($ per day)</Label>
            <Input id="travel-per-diem" inputMode="decimal" placeholder="Not set" value={draft.perDiem} disabled={readOnly}
              onChange={(event) => update({ perDiem: event.target.value })} />
          </div>
        </div>
      </section>

      <Separator />

      <section className="flex flex-col gap-3" aria-labelledby="travel-mountain">
        <div className="flex flex-col gap-1">
          <h3 id="travel-mountain" className="text-sm font-medium">Mountain charge</h3>
          <p className="text-sm text-muted-foreground">
            Applies by the ground elevation at the site address. A site uses the highest band it reaches; sites
            below the first band have no mountain charge. Add, remove or change bands and rates the same way as
            the distance zones.
          </p>
        </div>
        <div className="flex flex-col gap-2">
          {draft.bands.map((band, index) => (
            <div key={index} className="grid items-end gap-3 sm:grid-cols-[5rem_8rem_8rem_auto]">
              <div className="flex min-h-9 flex-col justify-end text-sm">
                <span className="font-medium">Band {index + 1}</span>
                <span className="text-xs text-muted-foreground">{bandRangeLabel(draft.bands, index)}</span>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`band-feet-${index}`}>At or above (ft)</Label>
                <Input id={`band-feet-${index}`} inputMode="numeric" value={band.minFeet} disabled={readOnly}
                  onChange={(event) => updateBand(index, { minFeet: event.target.value })} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`band-rate-${index}`}>$ per man-hour</Label>
                <Input id={`band-rate-${index}`} inputMode="decimal" placeholder="Not set" value={band.rate} disabled={readOnly}
                  onChange={(event) => updateBand(index, { rate: event.target.value })} />
              </div>
              <Button type="button" variant="ghost" size="icon" aria-label={`Remove band ${index + 1}`} disabled={readOnly}
                onClick={() => update({ bands: draft.bands.filter((_, i) => i !== index) })}>
                <Trash2 aria-hidden="true" />
              </Button>
            </div>
          ))}
        </div>
        <div>
          <Button type="button" variant="outline" size="sm" disabled={readOnly || draft.bands.length >= 6}
            onClick={() => {
              const lastFeet = Number(draft.bands[draft.bands.length - 1]?.minFeet ?? 8000) || 8000
              update({ bands: [...draft.bands, { minFeet: String(lastFeet + 1000), rate: "" }] })
            }}>
            <Plus aria-hidden="true" />
            Add band
          </Button>
        </div>
      </section>

      {message ? (
        <p role={message.tone === "error" ? "alert" : "status"}
          className={message.tone === "error" ? "text-sm text-destructive" : "text-sm text-muted-foreground"}>
          {message.text}
        </p>
      ) : null}

      {view.canEdit ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" disabled={pending} onClick={save}>Save zone charges</Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button type="button" variant="outline" disabled={pending || view.isDefault}>Reset to defaults</Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Reset zone charges?</AlertDialogTitle>
                <AlertDialogDescription>
                  This removes your saved rates and goes back to the built-in defaults (Woodland Park; no charge to
                  20 miles, then $4.50, $6.00, $7.50 and $10.00 per man-hour; $50.00 per diem). Write down any rates you
                  want to keep first.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={reset}>Reset</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          {view.updatedAt ? (
            <span className="text-xs text-muted-foreground">
              Last saved {new Date(view.updatedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
