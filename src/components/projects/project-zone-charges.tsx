"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import {
  clearProjectTravelOverride,
  saveProjectTravelOverride,
  type ProjectTravelChargeView,
} from "@/app/actions/project-travel-charges"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import type { EffectiveTravelCharge } from "@/lib/portfolio-map/travel-overrides"
import { formatRateCents, rateLabel, zoneRangeLabel } from "@/lib/portfolio-map/travel-zones"

const DEFAULT = "default"

type Draft = {
  readonly zone: string
  readonly zoneRate: string
  readonly elevation: string
  readonly mountainRate: string
  readonly lodging: "default" | "yes" | "no"
  readonly lodgingRate: string
  readonly perDiem: string
  readonly note: string
}

function dollars(cents: number | null): string {
  return cents === null ? "" : (cents / 100).toFixed(2)
}

function centsOrNull(value: string): number | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  const amount = Number(trimmed)
  return Number.isFinite(amount) ? Math.round(amount * 100) : Number.NaN
}

function intOrNull(value: string): number | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  const amount = Number(trimmed)
  return Number.isInteger(amount) ? amount : Number.NaN
}

function draftFrom(view: ProjectTravelChargeView): Draft {
  const { override } = view
  return {
    zone: override.zoneIndex === null ? DEFAULT : String(override.zoneIndex),
    zoneRate: dollars(override.zoneRateCents),
    elevation: override.siteElevationFt === null ? "" : String(override.siteElevationFt),
    mountainRate: dollars(override.mountainRateCents),
    lodging: override.lodging,
    lodgingRate: dollars(override.lodgingPerNightCents),
    perDiem: dollars(override.perDiemPerDayCents),
    note: override.note ?? "",
  }
}

function perManHour(cents: number | null): string {
  return cents === null || cents === 0 ? rateLabel(cents) : `+${formatRateCents(cents)}/man-hr`
}

function Summary({ charge, label }: { readonly charge: EffectiveTravelCharge; readonly label: string }): React.ReactElement {
  const elevation =
    charge.elevationFt === null
      ? "Elevation not known"
      : `${charge.elevationFt.toLocaleString("en-US")} ft · ${
          charge.mountainBand === null ? "no mountain band" : `band ${charge.mountainBand}`
        }`
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
      <dt className="col-span-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dt className="text-muted-foreground">Zone</dt>
      <dd className="text-right tabular-nums">
        Zone {charge.zone} · {perManHour(charge.zoneRateCents)}
        <span className="block text-xs text-muted-foreground">
          {charge.approximate ? "≈" : ""}
          {charge.miles} mi{charge.approximate ? " (town center)" : ""}
        </span>
      </dd>
      <dt className="text-muted-foreground">Mountain</dt>
      <dd className="text-right">
        {elevation}
        <span className="block text-xs text-muted-foreground">{perManHour(charge.mountainRateCents)}</span>
      </dd>
      <dt className="text-muted-foreground">Lodging</dt>
      <dd className="text-right">
        {charge.lodgingAndPerDiem
          ? `${charge.lodgingPerNightCents === null ? "Rate not set" : `${formatRateCents(charge.lodgingPerNightCents)}/night`} + ${
              charge.perDiemPerDayCents === null ? "per diem not set" : `${formatRateCents(charge.perDiemPerDayCents)}/day per diem`
            }`
          : "Not included"}
      </dd>
    </dl>
  )
}

/**
 * Per-job zone charge adjustments on Project Information. Blank fields keep the
 * organization defaults from Settings → Zone charges.
 */
export function ProjectZoneCharges({
  projectId,
  view,
}: {
  readonly projectId: string
  readonly view: ProjectTravelChargeView
}): React.ReactElement {
  const router = useRouter()
  const [draft, setDraft] = React.useState<Draft>(() => draftFrom(view))
  const [message, setMessage] = React.useState<string | null>(null)
  const [pending, startTransition] = React.useTransition()
  const [confirmClear, setConfirmClear] = React.useState(false)
  React.useEffect(() => setDraft(draftFrom(view)), [view])
  const readOnly = !view.canEdit || pending
  const update = (next: Partial<Draft>): void => setDraft((current) => ({ ...current, ...next }))
  const isCustom = (view.effective?.custom.length ?? 0) > 0 || view.override.note !== null

  function save(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    const input = {
      zoneIndex: draft.zone === DEFAULT ? null : Number(draft.zone),
      zoneRateCents: centsOrNull(draft.zoneRate),
      siteElevationFt: intOrNull(draft.elevation),
      mountainRateCents: centsOrNull(draft.mountainRate),
      lodging: draft.lodging,
      lodgingPerNightCents: centsOrNull(draft.lodgingRate),
      perDiemPerDayCents: centsOrNull(draft.perDiem),
      note: draft.note,
    }
    if (Object.values(input).some((value) => typeof value === "number" && Number.isNaN(value))) {
      setMessage("Enter amounts as numbers, like 7.50, and elevation in whole feet.")
      return
    }
    startTransition(async () => {
      const result = await saveProjectTravelOverride(projectId, input)
      setMessage(result.success ? "Saved zone charges for this job." : result.error)
      if (result.success) router.refresh()
    })
  }

  function clear(): void {
    setConfirmClear(false)
    startTransition(async () => {
      const result = await clearProjectTravelOverride(projectId)
      setMessage(result.success ? "This job follows the default zone charges again." : result.error)
      if (result.success) router.refresh()
    })
  }

  const defaults = view.defaults
  return (
    <section id="zone-charges" className="scroll-mt-6 rounded-lg border bg-card p-4 sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-semibold">Zone charges for this job</h2>
        <span className="text-xs text-muted-foreground">{isCustom ? "Custom for this job" : "Using the defaults"}</span>
      </div>
      <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
        Leave a field blank to use the default from Settings → Zone charges. Changing the defaults later doesn&apos;t change what you set here.
      </p>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        {view.effective ? <Summary charge={view.effective} label={isCustom ? "This job" : "This job (defaults)"} /> : (
          <p className="text-sm text-muted-foreground">Add a town or site address so the distance zone can be worked out.</p>
        )}
        {isCustom && defaults ? <Summary charge={defaults} label="Defaults alone" /> : null}
      </div>
      <form className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4" onSubmit={save}>
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="zone-override">Distance zone</Label>
          <Select value={draft.zone} onValueChange={(value) => update({ zone: value })} disabled={readOnly}>
            <SelectTrigger id="zone-override" className="h-9 w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={DEFAULT}>
                {defaults ? `By distance (zone ${defaults.zone})` : "By distance"}
              </SelectItem>
              {view.settings.zones.map((zone, index) => (
                <SelectItem key={index} value={String(index)}>
                  Zone {index} · {zoneRangeLabel(view.settings.zones, index)} · {rateLabel(zone.ratePerManHourCents)}
                  {zone.lodgingAndPerDiem ? " + lodging" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="zone-rate-override">Zone rate ($/man-hr)</Label>
          <Input id="zone-rate-override" inputMode="decimal" placeholder="Zone's rate" value={draft.zoneRate}
            disabled={readOnly} onChange={(event) => update({ zoneRate: event.target.value })} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="lodging-override">Lodging and per diem</Label>
          <Select value={draft.lodging} onValueChange={(value) => {
            if (value === "default" || value === "yes" || value === "no") update({ lodging: value })
          }} disabled={readOnly}>
            <SelectTrigger id="lodging-override" className="h-9 w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="default">As the zone sets it</SelectItem>
              <SelectItem value="yes">Yes, needs lodging</SelectItem>
              <SelectItem value="no">No lodging</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="elevation-override">Site elevation (ft)</Label>
          <Input id="elevation-override" inputMode="numeric"
            placeholder={defaults?.elevationFt === null || !defaults ? "Not known" : `Looked up: ${defaults.elevationFt.toLocaleString("en-US")}`}
            value={draft.elevation} disabled={readOnly} onChange={(event) => update({ elevation: event.target.value })} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="mountain-rate-override">Mountain rate ($/man-hr)</Label>
          <Input id="mountain-rate-override" inputMode="decimal" placeholder="Band's rate" value={draft.mountainRate}
            disabled={readOnly} onChange={(event) => update({ mountainRate: event.target.value })} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="lodging-rate-override">Lodging per night ($)</Label>
          <Input id="lodging-rate-override" inputMode="decimal"
            placeholder={view.settings.lodgingPerNightCents === null ? "Not set" : `Default ${dollars(view.settings.lodgingPerNightCents)}`}
            value={draft.lodgingRate} disabled={readOnly} onChange={(event) => update({ lodgingRate: event.target.value })} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="per-diem-override">Per diem per day ($)</Label>
          <Input id="per-diem-override" inputMode="decimal"
            placeholder={view.settings.perDiemPerDayCents === null ? "Not set" : `Default ${dollars(view.settings.perDiemPerDayCents)}`}
            value={draft.perDiem} disabled={readOnly} onChange={(event) => update({ perDiem: event.target.value })} />
        </div>
        <div className="space-y-2 sm:col-span-2 lg:col-span-4">
          <Label htmlFor="zone-note">Note</Label>
          <Textarea id="zone-note" rows={2} maxLength={500} placeholder="For example: site road is above 10,000 ft; crew stays in Leadville"
            value={draft.note} disabled={readOnly} onChange={(event) => update({ note: event.target.value })} />
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:col-span-2 lg:col-span-4">
          {view.canEdit ? (
            <>
              <Button type="submit" disabled={pending}>Save zone charges</Button>
              {isCustom ? (
                <Button type="button" variant="outline" disabled={pending} onClick={() => setConfirmClear(true)}>
                  Use the defaults
                </Button>
              ) : null}
            </>
          ) : (
            <p className="text-xs text-muted-foreground">
              Administrators, company owners, the office manager, project administrators and estimators can change these.
            </p>
          )}
          {message ? <p className="text-sm text-muted-foreground" role="status">{message}</p> : null}
        </div>
      </form>
      <AlertDialog open={confirmClear} onOpenChange={setConfirmClear}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Use the default zone charges?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes every adjustment and the note for this job. The change is recorded in the project&apos;s history.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep adjustments</AlertDialogCancel>
            <AlertDialogAction onClick={clear}>Use the defaults</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}
