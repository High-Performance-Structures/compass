"use client"

import * as React from "react"
import { Layers } from "lucide-react"
import {
  rateLabel,
  zoneRangeLabel,
  type TravelChargeSettings,
} from "@/lib/portfolio-map/travel-zones"
import { MESSAGE_KIND_LABEL, MESSAGE_KINDS } from "@/lib/notifications/message-stacks"
import { MESSAGE_KIND_COLOR_TOKEN } from "@/components/dashboard/portfolio-map/portfolio-style"

export type PortfolioLayerId = "zones" | "elevation" | "messages"
export type PortfolioLayerState = Readonly<Record<PortfolioLayerId, boolean>>

export const NO_LAYERS: PortfolioLayerState = { zones: false, elevation: false, messages: false }

/** Overlay colors (theme tokens); the scene lifts them for the dark terrain. */
export const LAYER_COLOR_TOKEN: Readonly<Record<PortfolioLayerId, string>> = {
  zones: "--warning",
  elevation: "--info",
  messages: "--brand-hps-green",
}

const LAYERS: readonly { readonly id: PortfolioLayerId; readonly label: string; readonly hint: string }[] = [
  { id: "zones", label: "Zone charges", hint: "Distance rings from home base" },
  { id: "elevation", label: "Mountain charge", hint: "Ground above each elevation band" },
  { id: "messages", label: "Messages", hint: "Your unread items, stacked on each job" },
]

const STORAGE_KEY = "compass:portfolio-layers:v1"

export function readStoredLayers(): PortfolioLayerState {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null")
    if (typeof parsed !== "object" || parsed === null) return NO_LAYERS
    return {
      zones: "zones" in parsed && parsed.zones === true,
      elevation: "elevation" in parsed && parsed.elevation === true,
      messages: "messages" in parsed && parsed.messages === true,
    }
  } catch {
    return NO_LAYERS
  }
}

export function storeLayers(state: PortfolioLayerState): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // The choice still applies to this visit.
  }
}

/** Layer toggles, shown over the map's top-left corner. */
export function PortfolioLayerControl({
  state,
  onChange,
}: {
  readonly state: PortfolioLayerState
  readonly onChange: (next: PortfolioLayerState) => void
}): React.ReactElement {
  const [open, setOpen] = React.useState(false)
  const panelId = React.useId()
  const activeCount = LAYERS.filter((layer) => state[layer.id]).length
  return (
    <div className="absolute left-4 top-4 flex flex-col items-start gap-1.5">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
        className="flex min-h-11 items-center gap-2 border border-border bg-background/85 px-3 font-mono text-xs tracking-[0.12em] text-foreground backdrop-blur transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2"
      >
        <Layers className="size-4" aria-hidden="true" />
        LAYERS{activeCount > 0 ? ` · ${activeCount}` : ""}
      </button>
      {open ? (
        <ul id={panelId} className="flex w-64 flex-col border border-border bg-popover text-popover-foreground">
          {LAYERS.map((layer) => (
            <li key={layer.id}>
              <label className="flex min-h-11 cursor-pointer items-center gap-3 px-3 py-2 text-foreground hover:bg-accent">
                <input
                  type="checkbox"
                  className="size-4 accent-current"
                  checked={state[layer.id]}
                  onChange={(event) => onChange({ ...state, [layer.id]: event.target.checked })}
                />
                <span
                  className="size-2.5 shrink-0"
                  style={{ background: `var(${LAYER_COLOR_TOKEN[layer.id]})` }}
                  aria-hidden="true"
                />
                <span className="flex flex-col">
                  <span className="text-sm">{layer.label}</span>
                  <span className="text-xs text-muted-foreground">{layer.hint}</span>
                </span>
              </label>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

function zoneSwatch(index: number): string {
  // Mirrors the shader: zone 0 is untinted, then the tint grows with each zone.
  return index === 0
    ? "transparent"
    : `color-mix(in oklab, var(${LAYER_COLOR_TOKEN.zones}) ${15 + index * 18}%, transparent)`
}

/** Rates for the visible layers, one compact line each, above the phase legend. */
export function PortfolioLayerLegend({
  state,
  settings,
}: {
  readonly state: PortfolioLayerState
  readonly settings: TravelChargeSettings
}): React.ReactElement | null {
  if (!state.zones && !state.elevation && !state.messages) return null
  return (
    <div className="inline-flex max-w-full flex-col gap-1 border border-border bg-background/85 px-3 py-1.5 font-mono text-xs tracking-[0.06em] text-foreground backdrop-blur">
      {state.zones ? (
        <p className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
          <span className="text-muted-foreground">ZONES FROM {settings.homeBase.label.toUpperCase()} · /MAN-HR</span>
          {settings.zones.map((zone, index) => (
            <span key={index} className="flex items-center gap-1.5 whitespace-nowrap tabular-nums">
              <span className="size-2.5 border border-foreground/30" style={{ background: zoneSwatch(index) }} aria-hidden="true" />
              {index}: {zoneRangeLabel(settings.zones, index)} {rateLabel(zone.ratePerManHourCents).toLowerCase()}
              {zone.lodgingAndPerDiem ? " + lodging + per diem" : ""}
            </span>
          ))}
        </p>
      ) : null}
      {state.elevation ? (
        <p className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
          <span className="text-muted-foreground">MOUNTAIN · SITE ELEVATION · /MAN-HR</span>
          {settings.mountainBands.length === 0 ? (
            <span>No elevation bands set</span>
          ) : (
            settings.mountainBands.map((band, index) => (
              <span key={index} className="whitespace-nowrap tabular-nums">
                {band.minElevationFt.toLocaleString("en-US")}+ ft{" "}
                {rateLabel(band.ratePerManHourCents).toLowerCase()}
              </span>
            ))
          )}
        </p>
      ) : null}
      {state.messages ? (
        <p className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
          <span className="text-muted-foreground">UNREAD · ONE TILE EACH</span>
          {MESSAGE_KINDS.map((kind) => (
            <span key={kind} className="flex items-center gap-1.5 whitespace-nowrap">
              <span className="size-2.5" style={{ background: `var(${MESSAGE_KIND_COLOR_TOKEN[kind]})` }} aria-hidden="true" />
              {MESSAGE_KIND_LABEL[kind]}
            </span>
          ))}
        </p>
      ) : null}
    </div>
  )
}
