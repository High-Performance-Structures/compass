"use client"

import * as React from "react"
import { Layers } from "lucide-react"
import type { AirCategory } from "@/lib/weather/air"
import {
  rateLabel,
  zoneRangeLabel,
  type TravelChargeSettings,
} from "@/lib/portfolio-map/travel-zones"
import { MESSAGE_KIND_LABEL, MESSAGE_KINDS } from "@/lib/notifications/message-stacks"
import { MESSAGE_KIND_COLOR_TOKEN } from "@/components/dashboard/portfolio-map/portfolio-style"
import type { WeatherSublayers } from "@/components/dashboard/portfolio-map/portfolio-weather-scene"

export type PortfolioLayerId = "zones" | "elevation" | "messages" | "weather" | "fire"
export type PortfolioLayerState = Readonly<Record<PortfolioLayerId, boolean>>

export const NO_LAYERS: PortfolioLayerState = { zones: false, elevation: false, messages: false, weather: false, fire: false }

/** Overlay colors (theme tokens); the scene lifts them for the dark terrain. */
export const LAYER_COLOR_TOKEN: Readonly<Record<PortfolioLayerId, string>> = {
  zones: "--warning",
  elevation: "--info",
  messages: "--brand-hps-green",
  weather: "--brand-compass-blue",
  fire: "--brand-compass-red",
}

const LAYERS: readonly { readonly id: PortfolioLayerId; readonly label: string; readonly hint: string }[] = [
  { id: "zones", label: "Zone charges", hint: "Distance rings from home base" },
  { id: "elevation", label: "Mountain charge", hint: "Ground above each elevation band" },
  { id: "messages", label: "Messages", hint: "Your unread items, stacked on each job" },
  { id: "weather", label: "Weather", hint: "Rain, snow, wind, cold and heat, now to 48 hours" },
  { id: "fire", label: "Fire & smoke", hint: "Wildfires, Red Flag Warnings, smoke and air quality" },
]

/** Weather layer colors (theme tokens); the scene lifts them for the dark terrain. */
export const WEATHER_COLOR_TOKEN = {
  rain: "--info",
  snow: "--info",
  wind: "--chart-2",
  cold: "--brand-compass-violet",
  heat: "--warning",
} as const

export const FIRE_COLOR_TOKEN = { fire: "--brand-compass-red", redFlag: "--destructive", smoke: "--muted-foreground" } as const

/** Air quality dots by EPA category, echoing the EPA's green-to-maroon scale. */
export const AIR_COLOR_TOKEN: Readonly<Record<AirCategory, string>> = {
  good: "--success",
  moderate: "--brand-nutech-gold",
  sensitive: "--warning",
  unhealthy: "--destructive",
  very_unhealthy: "--brand-compass-violet",
  hazardous: "--brand-orc-brown",
}

const AIR_LEGEND: readonly { readonly label: string; readonly category: AirCategory }[] = [
  { label: "Good", category: "good" },
  { label: "Moderate", category: "moderate" },
  { label: "Sensitive", category: "sensitive" },
  { label: "Unhealthy", category: "unhealthy" },
  { label: "Very unhealthy+", category: "very_unhealthy" },
]

const WEATHER_LEGEND: readonly { readonly label: string; readonly token: string }[] = [
  { label: "Rain", token: WEATHER_COLOR_TOKEN.rain },
  { label: "Snow (white)", token: "--muted" },
  { label: "Strong wind", token: WEATHER_COLOR_TOKEN.wind },
  { label: "Extreme cold", token: WEATHER_COLOR_TOKEN.cold },
  { label: "Extreme heat", token: WEATHER_COLOR_TOKEN.heat },
]

/** Parts of the Weather layer people can turn off. */
const WEATHER_SUBLAYERS: readonly { readonly id: keyof WeatherSublayers; readonly label: string }[] = [
  { id: "rain", label: "Rain" },
  { id: "snow", label: "Snow" },
  { id: "wind", label: "Strong wind" },
  { id: "temperature", label: "Extreme cold / heat" },
  { id: "warnings", label: "Weather warnings" },
]

export const ALL_WEATHER_SUBLAYERS: WeatherSublayers = { rain: true, snow: true, wind: true, temperature: true, warnings: true }
const SUBLAYER_STORAGE_KEY = "compass:portfolio-weather-parts:v1"

export function readStoredWeatherSublayers(): WeatherSublayers {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(SUBLAYER_STORAGE_KEY) ?? "null")
    if (typeof parsed !== "object" || parsed === null) return ALL_WEATHER_SUBLAYERS
    const flag = (key: keyof WeatherSublayers): boolean => !(key in parsed) || Reflect.get(parsed, key) !== false
    return { rain: flag("rain"), snow: flag("snow"), wind: flag("wind"), temperature: flag("temperature"), warnings: flag("warnings") }
  } catch {
    return ALL_WEATHER_SUBLAYERS
  }
}

export function storeWeatherSublayers(state: WeatherSublayers): void {
  try {
    window.localStorage.setItem(SUBLAYER_STORAGE_KEY, JSON.stringify(state))
  } catch {
    // The choice still applies to this visit.
  }
}

const STORAGE_KEY = "compass:portfolio-layers:v1"

export function readStoredLayers(): PortfolioLayerState {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null")
    if (typeof parsed !== "object" || parsed === null) return NO_LAYERS
    return {
      zones: "zones" in parsed && parsed.zones === true,
      elevation: "elevation" in parsed && parsed.elevation === true,
      messages: "messages" in parsed && parsed.messages === true,
      weather: "weather" in parsed && parsed.weather === true,
      fire: "fire" in parsed && parsed.fire === true,
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
  weatherParts,
  onWeatherParts,
  available,
}: {
  readonly state: PortfolioLayerState
  readonly onChange: (next: PortfolioLayerState) => void
  /** Layers offered here; all of them when omitted. */
  readonly available?: readonly PortfolioLayerId[]
  readonly weatherParts?: WeatherSublayers
  readonly onWeatherParts?: (next: WeatherSublayers) => void
}): React.ReactElement {
  const [open, setOpen] = React.useState(false)
  const panelId = React.useId()
  const shown = available ? LAYERS.filter((layer) => available.includes(layer.id)) : LAYERS
  const activeCount = shown.filter((layer) => state[layer.id]).length
  return (
    // Spans the map's height so the open menu scrolls instead of running off the bottom;
    // only the button and menu take clicks, so the map still drags beside them.
    <div className="pointer-events-none absolute bottom-4 left-4 top-4 z-10 flex flex-col items-start gap-1.5">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
        className="pointer-events-auto flex min-h-11 shrink-0 items-center gap-2 border border-border bg-background/85 px-3 font-mono text-xs tracking-[0.12em] text-foreground backdrop-blur transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2"
      >
        <Layers className="size-4" aria-hidden="true" />
        LAYERS{activeCount > 0 ? ` · ${activeCount}` : ""}
      </button>
      {open ? (
        <ul id={panelId} className="pointer-events-auto flex min-h-0 w-64 flex-col overflow-y-auto overscroll-contain border border-border bg-popover text-popover-foreground">
          {shown.map((layer) => (
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
              {layer.id === "weather" && state.weather && weatherParts && onWeatherParts ? (
                <ul aria-label="Weather layer parts" className="pb-1 pl-10">
                  {WEATHER_SUBLAYERS.map((part) => (
                    <li key={part.id}>
                      <label className="flex min-h-11 cursor-pointer items-center gap-3 px-3 text-sm text-foreground hover:bg-accent">
                        <input
                          type="checkbox"
                          className="size-4 accent-current"
                          checked={weatherParts[part.id]}
                          onChange={(event) => onWeatherParts({ ...weatherParts, [part.id]: event.target.checked })}
                        />
                        {part.label}
                      </label>
                    </li>
                  ))}
                </ul>
              ) : null}
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
  /** Null where travel charges don't apply (client and trade partner maps). */
  readonly settings: TravelChargeSettings | null
}): React.ReactElement | null {
  if (!state.zones && !state.elevation && !state.messages && !state.weather && !state.fire) return null
  return (
    <div className="inline-flex max-w-full flex-col gap-1 border border-border bg-background/85 px-3 py-1.5 font-mono text-xs tracking-[0.06em] text-foreground backdrop-blur">
      {state.zones && settings ? (
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
      {state.elevation && settings ? (
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
      {state.weather ? (
        <p className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
          <span className="text-muted-foreground">WEATHER · NWS FORECAST</span>
          {WEATHER_LEGEND.map((entry) => (
            <span key={entry.label} className="flex items-center gap-1.5 whitespace-nowrap">
              <span className="size-2.5" style={{ background: `var(${entry.token})` }} aria-hidden="true" />
              {entry.label}
            </span>
          ))}
        </p>
      ) : null}
      {state.fire ? (
        <p className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
          <span className="text-muted-foreground">FIRE &amp; SMOKE · NIFC, NWS, NOAA, AIRNOW</span>
          <span className="flex items-center gap-1.5 whitespace-nowrap">
            <span className="size-2.5" style={{ background: `var(${FIRE_COLOR_TOKEN.fire})` }} aria-hidden="true" />
            Active fire and outline
          </span>
          <span className="flex items-center gap-1.5 whitespace-nowrap">
            <span className="size-2.5 border-2 border-dashed" style={{ borderColor: `var(${FIRE_COLOR_TOKEN.redFlag})` }} aria-hidden="true" />
            Red Flag Warning / Fire Weather Watch
          </span>
          <span className="flex items-center gap-1.5 whitespace-nowrap">
            <span className="size-2.5 opacity-60" style={{ background: `var(${FIRE_COLOR_TOKEN.smoke})` }} aria-hidden="true" />
            Smoke (darker = heavier)
          </span>
          <span className="flex items-center gap-1.5 whitespace-nowrap">
            AQI
            {AIR_LEGEND.map((entry) => (
              <span key={entry.category} className="size-2.5 rounded-full" title={entry.label} style={{ background: `var(${AIR_COLOR_TOKEN[entry.category]})` }} aria-label={entry.label} />
            ))}
          </span>
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
