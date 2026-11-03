"use client"

import * as React from "react"
import { toast } from "sonner"

import {
  getSageVendorCertificateOverview,
  linkSageVendorMatches,
  syncAllSageVendorCertificates,
  type SageVendorCertificateOverview,
} from "@/app/actions/sage-vendor-certificates"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { formatDateTime } from "@/lib/format"
import { sendsToSage } from "@/lib/domain/sage-bridge/certificate-rules"
import type { TradeDocSageSettings, TradeDocType } from "@/lib/trade-docs/settings"

const PREVIEW_MATCHES = 8

type SageOverviewState = {
  readonly overview: SageVendorCertificateOverview | null
  readonly error: string | null
  readonly load: () => Promise<void>
}

function useSageOverview(): SageOverviewState {
  const [overview, setOverview] = React.useState<SageVendorCertificateOverview | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  const load = React.useCallback(async () => {
    const result = await getSageVendorCertificateOverview()
    if (result.success) {
      setOverview(result.data)
      setError(null)
    } else {
      setError(result.error)
    }
  }, [])

  React.useEffect(() => {
    void load()
  }, [load])
  return { overview, error, load }
}

/** Leaves a vendor's Compass category alone; Select items can't be blank. */
const KEEP_CATEGORY = "__keep__"

/**
 * Sage's vendor list also updates linked vendors' name, owner, address,
 * phone and email, and their category through Sage's vendor type.
 */
function SageVendorUpdates({
  value,
  onChange,
  overview,
}: {
  readonly value: TradeDocSageSettings
  readonly onChange: (next: TradeDocSageSettings) => void
  readonly overview: SageVendorCertificateOverview | null
}): React.ReactElement {
  const categories = [...new Set([...(overview?.compassCategories ?? []), ...Object.values(value.vendorTypes)])]
  function setType(sageType: string, category: string): void {
    const vendorTypes = { ...value.vendorTypes }
    if (category === KEEP_CATEGORY) delete vendorTypes[sageType]
    else vendorTypes[sageType] = category
    onChange({ ...value, vendorTypes })
  }
  function shown(sageType: string): string {
    const mapped = value.vendorTypes[sageType]
    if (mapped) return mapped
    // A type with no mapping uses the Compass category of the same name.
    return categories.find((category) => category.toLowerCase() === sageType.toLowerCase()) ?? KEEP_CATEGORY
  }
  const types = overview?.sageVendorTypes ?? []
  return (
    <div className="grid gap-3">
      <div className="flex items-start gap-3">
        <Switch
          id="trade-doc-sage-update-vendors"
          checked={value.updateVendors}
          onCheckedChange={(checked) => onChange({ ...value, updateVendors: checked })}
        />
        <Label htmlFor="trade-doc-sage-update-vendors" className="grid gap-0.5 font-normal">
          <span className="font-medium">Update vendors from Sage</span>
          <span className="text-muted-foreground">
            Each time Sage&apos;s vendor list arrives (daily), linked vendors take Sage&apos;s name, owner, address, phone and
            email. A blank in Sage leaves Compass&apos;s value alone. Changes show on the vendor&apos;s Activity.
          </span>
        </Label>
      </div>
      {value.updateVendors && (
        <div className="grid gap-2">
          <span className="text-sm font-medium">Category from Sage&apos;s vendor type</span>
          <p className="text-xs text-muted-foreground">
            A vendor whose type changes in Sage moves to the Compass category below, and its Sage certificates are re-sent.
            Vendors with no type in Sage keep their Compass category.
          </p>
          {overview && !overview.detailsReceived && (
            <p className="text-xs text-muted-foreground">
              Sage&apos;s vendor types arrive once the Sage writer&apos;s update is installed.
            </p>
          )}
          {types.map((type) => (
            <div key={type.name} className="grid gap-1 sm:grid-cols-[14rem_1fr] sm:items-center">
              <span className="text-sm">
                {type.name} <span className="text-muted-foreground">({type.count})</span>
              </span>
              <Select value={shown(type.name)} onValueChange={(next) => setType(type.name, next)}>
                <SelectTrigger aria-label={`Compass category for Sage type ${type.name}`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={KEEP_CATEGORY}>Keep Compass&apos;s category</SelectItem>
                  {categories.map((category) => (
                    <SelectItem key={category} value={category}>{category}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function SageVendorLinks({
  disabled,
  syncEnabled,
  state,
}: {
  readonly disabled: boolean
  readonly syncEnabled: boolean
  readonly state: SageOverviewState
}): React.ReactElement {
  const { overview, error, load } = state
  const [showAll, setShowAll] = React.useState(false)
  const [pending, startTransition] = React.useTransition()

  function link(): void {
    startTransition(async () => {
      const result = await linkSageVendorMatches()
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success(`Linked ${result.data.linked} vendor${result.data.linked === 1 ? "" : "s"} to Sage`)
      await load()
    })
  }

  function syncAll(): void {
    startTransition(async () => {
      const result = await syncAllSageVendorCertificates()
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success(`${result.data.queued} vendor${result.data.queued === 1 ? "" : "s"} queued for Sage`)
      await load()
    })
  }

  if (error) return <p className="text-sm text-destructive">{error}</p>
  if (!overview) return <p className="text-sm text-muted-foreground">Loading Sage vendors…</p>
  const shown = showAll ? overview.matches : overview.matches.slice(0, PREVIEW_MATCHES)
  const { syncCounts } = overview
  return (
    <div className="grid gap-3 text-sm">
      <p className="text-muted-foreground">
        {overview.directoryCapturedAt
          ? `Sage's vendor list: ${overview.sageVendorCount} vendors, received ${formatDateTime(overview.directoryCapturedAt)}.`
          : "Sage's vendor list hasn't arrived yet. The Sage writer sends it once a day after its update is installed."}{" "}
        {overview.linkedCount} of {overview.compassVendorCount} Compass vendors are linked to Sage.
      </p>
      {overview.matches.length > 0 && (
        <div className="grid gap-2">
          <span className="font-medium">
            {overview.matches.length} exact match{overview.matches.length === 1 ? "" : "es"} ready to link
          </span>
          <ul className="grid gap-0.5 text-xs text-muted-foreground">
            {shown.map((match) => (
              <li key={match.vendorId}>
                {match.vendorName} → Sage #{match.sageVendorNumber} {match.sageName}
                {match.by === "email" ? " (same email)" : ""}
              </li>
            ))}
          </ul>
          {overview.matches.length > PREVIEW_MATCHES && (
            <button type="button" className="justify-self-start text-xs underline" onClick={() => setShowAll((value) => !value)}>
              {showAll ? "Show fewer" : `Show all ${overview.matches.length}`}
            </button>
          )}
          <div>
            <Button type="button" variant="outline" size="sm" disabled={disabled || pending} onClick={link}>
              Link {overview.matches.length} vendor{overview.matches.length === 1 ? "" : "s"}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Only the same company name or email, with no second candidate, is matched. Link the rest from each vendor&apos;s record.
          </p>
        </div>
      )}
      {syncEnabled && (
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-muted-foreground">
            Certificates: {syncCounts.succeeded} in step · {syncCounts.queued + syncCounts.running} waiting for Sage
            {syncCounts.failed > 0 ? ` · ${syncCounts.failed} failed` : ""}
          </span>
          <Button type="button" variant="outline" size="sm" disabled={disabled || pending} onClick={syncAll}>
            Send all again
          </Button>
        </div>
      )}
    </div>
  )
}

/**
 * Settings → Trade docs: keeping Sage's vendor certificates (Warning, Stop
 * Pay, expiry) in step with the documents on file in Compass.
 */
export function TradeDocSageSettingsFields({
  value,
  onChange,
  docTypes,
  disabled,
}: {
  readonly value: TradeDocSageSettings
  readonly onChange: (next: TradeDocSageSettings) => void
  readonly docTypes: readonly TradeDocType[]
  readonly disabled: boolean
}): React.ReactElement {
  function set(patch: Partial<TradeDocSageSettings>): void {
    onChange({ ...value, ...patch })
  }
  function setName(typeId: string, name: string): void {
    const names = { ...value.names }
    if (name.trim().length === 0) delete names[typeId]
    else names[typeId] = name.slice(0, 50)
    set({ names })
  }
  function setSend(typeId: string, on: boolean): void {
    // Sent is the default, so only the types kept in Compass are stored.
    const send = { ...value.send }
    if (on) delete send[typeId]
    else send[typeId] = false
    set({ send })
  }
  const overviewState = useSageOverview()
  const active = docTypes.filter((type) => type.active && type.requiredFor.length > 0)
  return (
    <fieldset className="grid gap-4 border-t pt-4 sm:max-w-2xl" disabled={disabled}>
      <legend className="sr-only">Sage certificates</legend>
      <div className="grid gap-1">
        <h3 className="text-sm font-semibold">Sage certificates</h3>
        <p className="text-sm text-muted-foreground">
          Compass keeps each linked vendor&apos;s certificates in Sage (Vendors → Certificates) matched to the documents on file
          here: dates, Warning and Stop Pay. A document that was never received goes to Sage as already expired. Rows in Sage
          that Compass doesn&apos;t recognise are left alone.
        </p>
      </div>
      <div className="flex items-start gap-3">
        <Switch id="trade-doc-sage-enabled" checked={value.enabled} onCheckedChange={(checked) => set({ enabled: checked })} />
        <Label htmlFor="trade-doc-sage-enabled" className="grid gap-0.5 font-normal">
          <span className="font-medium">Keep Sage&apos;s vendor certificates in step</span>
        </Label>
      </div>
      <div className="flex items-start gap-3">
        <Switch id="trade-doc-sage-warn-only" checked={value.warnOnly} onCheckedChange={(checked) => set({ warnOnly: checked })} />
        <Label htmlFor="trade-doc-sage-warn-only" className="grid gap-0.5 font-normal">
          <span className="font-medium">Warn only while we catch up on documents</span>
          <span className="text-muted-foreground">
            Every vendor gets a warning and no stop, even those set to hold payment. Turn this off to stop payment to the vendors
            set to hold, once their documents are collected.
          </span>
        </Label>
      </div>
      {active.length > 0 && (
        <div className="grid gap-2">
          <span className="text-sm font-medium">Documents sent to Sage</span>
          <p className="text-xs text-muted-foreground">
            Untick a document to keep it in Compass only; Sage rows for it are left alone. For the rest, use the name your Sage
            rows already have, so Compass updates them instead of adding new ones.
          </p>
          {active.map((type) => {
            const sent = sendsToSage(type.id, value.send)
            return (
              <div key={type.id} className="grid gap-1 sm:grid-cols-[14rem_1fr] sm:items-center">
                <div className="flex items-center gap-2">
                  <Checkbox
                    id={`trade-doc-sage-send-${type.id}`}
                    checked={sent}
                    onCheckedChange={(checked) => setSend(type.id, checked === true)}
                  />
                  <Label htmlFor={`trade-doc-sage-send-${type.id}`} className="font-normal">{type.label}</Label>
                </div>
                <Input
                  id={`trade-doc-sage-name-${type.id}`}
                  aria-label={`Name in Sage for ${type.label}`}
                  value={value.names[type.id] ?? ""}
                  maxLength={50}
                  placeholder={sent ? type.label.slice(0, 50) : "Kept in Compass only"}
                  disabled={!sent}
                  onChange={(event) => setName(type.id, event.target.value)}
                />
              </div>
            )
          })}
        </div>
      )}
      <SageVendorLinks disabled={disabled} syncEnabled={value.enabled} state={overviewState} />
      <SageVendorUpdates value={value} onChange={onChange} overview={overviewState.overview} />
    </fieldset>
  )
}
