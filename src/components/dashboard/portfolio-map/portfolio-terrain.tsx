"use client"

import * as React from "react"
import { Minus, Plus, RotateCcw, RotateCw } from "lucide-react"
import { PORTFOLIO_PHASES, type PortfolioMapJob } from "@/lib/portfolio-map/model"
import {
  PortfolioScene,
  terrainUrlForState,
  type SceneHighlight,
  type SceneLabel,
} from "@/components/dashboard/portfolio-map/portfolio-scene"
import { DEFAULT_MAP_STATE, mapStateName, type MapStateCode } from "@/lib/portfolio-map/states"
import {
  MESSAGE_KIND_COLOR_TOKEN,
  PHASE_COLOR_TOKEN,
  phaseColor,
  themeColorHex,
} from "@/components/dashboard/portfolio-map/portfolio-style"
import type { MessageStacks } from "@/lib/notifications/message-stacks"
import {
  LAYER_COLOR_TOKEN,
  PortfolioLayerControl,
  PortfolioLayerLegend,
  type PortfolioLayerState,
} from "@/components/dashboard/portfolio-map/portfolio-layers"
import type { TravelChargeSettings } from "@/lib/portfolio-map/travel-zones"
import {
  AIR_COLOR_TOKEN,
  FIRE_COLOR_TOKEN,
  WEATHER_COLOR_TOKEN,
} from "@/components/dashboard/portfolio-map/portfolio-layers"
import type { WeatherSublayers } from "@/components/dashboard/portfolio-map/portfolio-weather-scene"
import { WeatherTimeBar } from "@/components/dashboard/portfolio-map/portfolio-weather-panel"
import type { AlertKind } from "@/lib/weather/alerts"
import { areaGrid, DEFAULT_WEATHER_AREA, weatherArea } from "@/lib/weather/areas"
import { DEFAULT_WEATHER_LIMITS, type FireLayerData, type WeatherLayerData, type WeatherLimits } from "@/lib/weather/layer"

/** Weather and Fire & smoke layer data, loaded by the dashboard only while a layer is on. */
export type PortfolioWeatherProps = {
  readonly weather: WeatherLayerData | null
  readonly fire: FireLayerData | null
  readonly limits: WeatherLimits | null
  readonly parts: WeatherSublayers
  readonly onParts: (next: WeatherSublayers) => void
  readonly error: string | null
  /** The time bar's step (3 hours each, 0 = now). */
  readonly step: number
  readonly onStep: (next: number) => void
}

const ALERT_COLOR_TOKEN: Readonly<Record<AlertKind, string>> = {
  winter: "--info",
  wind: WEATHER_COLOR_TOKEN.wind,
  flood: "--info",
  storm: "--warning",
  heat: WEATHER_COLOR_TOKEN.heat,
  cold: WEATHER_COLOR_TOKEN.cold,
  fire: FIRE_COLOR_TOKEN.redFlag,
}

/**
 * A different marker key in place of the phase key (a sales pipeline's
 * stages): each job's color token and the key entries shown under the map.
 */
export type PortfolioMarkerKey = {
  readonly entries: readonly { readonly id: string; readonly label: string; readonly colorToken: string }[]
  readonly colorTokenByJobId: ReadonlyMap<string, string>
}

type PortfolioTerrainProps = {
  readonly jobs: readonly PortfolioMapJob[]
  readonly highlight: SceneHighlight
  readonly onSelectJob: (jobId: string | null) => void
  readonly onSelectNotification?: (notificationId: string) => void
  readonly onHoverJob: (jobId: string | null) => void
  readonly onUnavailable: () => void
  /** Open zoomed to the selected job instead of the statewide view. */
  readonly focusSelectedOnLoad?: boolean
  /** The office phase key under the map; the owner view uses its own stepper instead. */
  readonly showPhaseKey?: boolean
  readonly markerKey?: PortfolioMarkerKey | null
  /** Messages layer: unread item kinds per job id, or null when the layer is off. */
  readonly messageStacks?: MessageStacks | null
  /** Zone and mountain layers; omitted where travel charges do not apply (owner and vendor maps). */
  readonly layers?: {
    readonly state: PortfolioLayerState
    /** Null on client and trade partner maps: only Weather and Fire & smoke are offered. */
    readonly settings: TravelChargeSettings | null
    readonly onChange: (next: PortfolioLayerState) => void
  }
  readonly weather?: PortfolioWeatherProps
  /** The state whose terrain is shown. */
  readonly mapState?: MapStateCode
}

function supportsWebGL2(): boolean {
  try {
    return document.createElement("canvas").getContext("webgl2") !== null
  } catch {
    return false
  }
}

const CONTROL_CLASS =
  "flex size-11 items-center justify-center border border-border bg-background/85 text-foreground backdrop-blur transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2"

/**
 * Lazily loaded with three.js (see PortfolioSection), so the 3D engine never
 * ships with the dashboard's initial JavaScript.
 */
export default function PortfolioTerrain({
  jobs,
  highlight,
  onSelectJob,
  onSelectNotification,
  onHoverJob,
  onUnavailable,
  focusSelectedOnLoad = false,
  showPhaseKey = true,
  markerKey = null,
  layers,
  messageStacks = null,
  weather,
  mapState = DEFAULT_MAP_STATE,
}: PortfolioTerrainProps): React.ReactElement {
  const containerRef = React.useRef<HTMLDivElement | null>(null)
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null)
  const sceneRef = React.useRef<PortfolioScene | null>(null)
  const [labels, setLabels] = React.useState<readonly SceneLabel[]>([])
  const [ready, setReady] = React.useState(false)
  const callbacks = React.useRef({ onSelectJob, onSelectNotification, onHoverJob, onUnavailable })
  callbacks.current = { onSelectJob, onSelectNotification, onHoverJob, onUnavailable }
  // Read once when the scene starts.
  const focusOnLoad = React.useRef(focusSelectedOnLoad)
  // Bumped to rebuild the scene on a fresh canvas after the browser takes the
  // GPU context back (another tab such as a video call can cause it).
  const [generation, setGeneration] = React.useState(0)

  React.useEffect(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return
    if (!supportsWebGL2()) {
      callbacks.current.onUnavailable()
      return
    }
    let scene: PortfolioScene
    try {
      scene = new PortfolioScene(canvas, container, {
        onSelect: (jobId, notificationId) => {
          callbacks.current.onSelectJob(jobId)
          if (notificationId) callbacks.current.onSelectNotification?.(notificationId)
        },
        onHover: (jobId) => callbacks.current.onHoverJob(jobId),
        onLabels: setLabels,
        onReady: () => setReady(true),
        onError: () => callbacks.current.onUnavailable(),
      }, terrainUrlForState(mapState))
    } catch (error) {
      console.error("Portfolio map could not start", error)
      callbacks.current.onUnavailable()
      return
    }
    if (focusOnLoad.current) scene.focusSelectedWhenPlaced()
    sceneRef.current = scene
    let lost = false
    const rebuild = (): void => {
      setReady(false)
      setLabels([])
      setGeneration((value) => value + 1)
    }
    const handleLost = (event: Event): void => {
      // Ask the browser to give the context back instead of leaving a blank map.
      event.preventDefault()
      lost = true
    }
    const handleRestored = (): void => {
      if (lost) rebuild()
    }
    const handleVisible = (): void => {
      if (lost && document.visibilityState === "visible") rebuild()
    }
    canvas.addEventListener("webglcontextlost", handleLost)
    canvas.addEventListener("webglcontextrestored", handleRestored)
    document.addEventListener("visibilitychange", handleVisible)
    return () => {
      canvas.removeEventListener("webglcontextlost", handleLost)
      canvas.removeEventListener("webglcontextrestored", handleRestored)
      document.removeEventListener("visibilitychange", handleVisible)
      sceneRef.current = null
      scene.dispose()
    }
    // A new state rebuilds the scene with its terrain.
  }, [generation, mapState])

  React.useEffect(() => {
    // Theme colors are lifted for contrast against the dark terrain.
    const hexByToken = new Map(
      (markerKey?.entries ?? []).map((entry) => [entry.colorToken, themeColorHex(entry.colorToken, 0.35)]),
    )
    const byJobId = new Map(
      [...(markerKey?.colorTokenByJobId ?? [])].flatMap(([jobId, token]): [string, number][] => {
        const hex = hexByToken.get(token)
        return hex === undefined ? [] : [[jobId, hex]]
      }),
    )
    sceneRef.current?.setJobs(jobs, {
      byJobId,
      phase: {
        intake: themeColorHex(PHASE_COLOR_TOKEN.intake, 0.4),
        estimating: themeColorHex(PHASE_COLOR_TOKEN.estimating, 0.45),
        design: themeColorHex(PHASE_COLOR_TOKEN.design, 0.4),
        permitting: themeColorHex(PHASE_COLOR_TOKEN.permitting, 0.3),
        negotiation: themeColorHex(PHASE_COLOR_TOKEN.negotiation, 0.4),
        construction: themeColorHex(PHASE_COLOR_TOKEN.construction, 0.35),
        closeout: themeColorHex(PHASE_COLOR_TOKEN.closeout, 0.2),
      },
      risk: themeColorHex("--warning", 0.35),
      late: themeColorHex("--destructive", 0.3),
    })
  }, [jobs, markerKey, generation])

  React.useEffect(() => {
    sceneRef.current?.setHighlight(highlight)
  }, [highlight, generation])

  React.useEffect(() => {
    sceneRef.current?.setMessageStacks(messageStacks, {
      message: themeColorHex(MESSAGE_KIND_COLOR_TOKEN.message, 0.25),
      mail: themeColorHex(MESSAGE_KIND_COLOR_TOKEN.mail, 0.3),
      rfi: themeColorHex(MESSAGE_KIND_COLOR_TOKEN.rfi, 0.15),
      schedule: themeColorHex(MESSAGE_KIND_COLOR_TOKEN.schedule, 0.3),
      other: themeColorHex(MESSAGE_KIND_COLOR_TOKEN.other, 0.3),
    })
  }, [messageStacks, ready, generation])

  const weatherStep = weather?.step ?? 0
  const weatherOn = Boolean(layers?.state.weather)
  const fireOn = Boolean(layers?.state.fire)
  const weatherData = weatherOn ? (weather?.weather ?? null) : null
  const fireData = fireOn ? (weather?.fire ?? null) : null
  const limits = weather?.limits ?? DEFAULT_WEATHER_LIMITS
  const parts = weather?.parts
  const steps = weatherData?.steps ?? 1
  const step = Math.min(weatherStep, steps - 1)

  React.useEffect(() => {
    if (!weatherData || !parts) {
      sceneRef.current?.setWeather(null)
      return
    }
    const grid = areaGrid(weatherArea(weatherData.areaKey) ?? DEFAULT_WEATHER_AREA)
    sceneRef.current?.setWeather({
      cells: weatherData.cells.map((cell) => ({
        lon: cell.lon,
        lat: cell.lat,
        precipIn: cell.series.precipIn[step] ?? 0,
        snowIn: cell.series.snowIn[step] ?? 0,
        tempMinF: cell.series.tempMinF[step] ?? null,
        tempMaxF: cell.series.tempMaxF[step] ?? null,
        gustMph: cell.series.gustMph[step] ?? null,
        windDir: cell.series.windDir[step] ?? null,
      })),
      spacing: { lon: grid.lonStep, lat: grid.latStep },
      limits: { gustMph: limits.gustMph, coldF: limits.coldF, heatF: limits.heatF },
      alerts: weatherData.alerts
        .filter((alert) => {
          const from = Date.parse(weatherData.start) + step * 3 * 60 * 60 * 1000
          const onset = alert.onset ? Date.parse(alert.onset) : Number.NEGATIVE_INFINITY
          const ends = alert.ends ? Date.parse(alert.ends) : Number.POSITIVE_INFINITY
          return onset <= from + 3 * 60 * 60 * 1000 && ends > from
        })
        .map((alert) => ({ rings: alert.rings, solid: alert.level === "warning", color: themeColorHex(ALERT_COLOR_TOKEN[alert.kind], 0.25) })),
      show: parts,
      colors: {
        rain: themeColorHex(WEATHER_COLOR_TOKEN.rain, 0.35),
        snow: themeColorHex(WEATHER_COLOR_TOKEN.snow, 0.9),
        wind: themeColorHex(WEATHER_COLOR_TOKEN.wind, 0.4),
        cold: themeColorHex(WEATHER_COLOR_TOKEN.cold, 0.2),
        heat: themeColorHex(WEATHER_COLOR_TOKEN.heat, 0.1),
      },
    })
  }, [weatherData, parts, step, limits, ready, generation])

  React.useEffect(() => {
    if (!fireData) {
      sceneRef.current?.setFire(null)
      return
    }
    sceneRef.current?.setFire({
      fires: fireData.fires,
      alerts: fireData.alerts.map((alert) => ({ rings: alert.rings, solid: alert.level === "warning" })),
      smoke: fireData.smoke.map((plume) => ({ density: plume.density, rings: plume.rings })),
      air: fireData.air.flatMap((reading) => {
        // Today's reading, else the first forecast, so every area shows a color.
        const value = reading.now ?? reading.forecasts[0] ?? null
        return value ? [{ id: reading.id, name: reading.name, lon: reading.lon, lat: reading.lat, aqi: value.aqi, category: value.category }] : []
      }),
      colors: {
        fire: themeColorHex(FIRE_COLOR_TOKEN.fire, 0.15),
        redFlag: themeColorHex(FIRE_COLOR_TOKEN.redFlag, 0.2),
        smoke: themeColorHex(FIRE_COLOR_TOKEN.smoke, 0.1),
        air: {
          good: themeColorHex(AIR_COLOR_TOKEN.good, 0.15),
          moderate: themeColorHex(AIR_COLOR_TOKEN.moderate, 0.15),
          sensitive: themeColorHex(AIR_COLOR_TOKEN.sensitive, 0.15),
          unhealthy: themeColorHex(AIR_COLOR_TOKEN.unhealthy, 0.15),
          very_unhealthy: themeColorHex(AIR_COLOR_TOKEN.very_unhealthy, 0.15),
          hazardous: themeColorHex(AIR_COLOR_TOKEN.hazardous, 0.15),
        },
      },
    })
  }, [fireData, ready, generation])

  const weatherStatus = !weatherOn
    ? null
    : weather?.error && !weatherData
      ? weather.error
      : !weatherData
        ? "LOADING WEATHER…"
        : weatherData.warming
          ? "GATHERING FORECASTS · THE FIRST LOAD TAKES A FEW MINUTES"
          : null

  const layerState = layers?.state
  const layerSettings = layers?.settings
  React.useEffect(() => {
    if (!layerState || !layerSettings) return
    sceneRef.current?.setLayers({
      zones: layerState.zones
        ? {
            home: layerSettings.homeBase,
            edgesMiles: layerSettings.zones.flatMap((zone) => (zone.maxMiles === null ? [] : [zone.maxMiles])),
            color: themeColorHex(LAYER_COLOR_TOKEN.zones, 0.15),
          }
        : null,
      elevation: layerState.elevation
        ? {
            bandsFeet: layerSettings.mountainBands.map((band) => band.minElevationFt),
            color: themeColorHex(LAYER_COLOR_TOKEN.elevation, 0.2),
          }
        : null,
    })
  }, [layerState, layerSettings, generation])

  return (
    <div className="flex h-full min-h-[420px] w-full flex-col">
    {/* The scene sizes itself to this area; the key sits below it, off the terrain. */}
    <div ref={containerRef} className="relative min-h-0 w-full flex-1 overflow-hidden">
      <canvas
        key={generation}
        ref={canvasRef}
        aria-label={`3D terrain map of ${mapStateName(mapState)} with job markers. Use the job list for keyboard access.`}
        className="absolute inset-0 block size-full cursor-grab touch-none active:cursor-grabbing"
      />
      {labels.map((label) => (
        <div
          key={label.key}
          className="pointer-events-none absolute -translate-y-full"
          style={{ left: label.x, top: label.y }}
        >
          <span
            className={
              label.tone === "landmark"
                ? "absolute bottom-0 left-0 h-3.5 w-px bg-foreground/40"
                : "absolute bottom-0 left-0 h-6 w-px bg-foreground/70"
            }
          />
          {/* A light chip keeps labels readable over terrain in either theme. */}
          <div className={label.tone === "landmark" ? "pb-3.5 pl-2" : "pb-6 pl-2"}>
            <div className="bg-background/75 px-1 backdrop-blur-[2px]">
            <p
              className={
                label.tone === "selected"
                  ? "whitespace-nowrap font-mono text-xs font-semibold tracking-[0.14em] text-primary"
                  : label.tone === "hover"
                    ? "whitespace-nowrap font-mono text-xs tracking-[0.14em] text-foreground"
                    : "whitespace-nowrap font-mono text-xs tracking-[0.14em] text-foreground/85"
              }
            >
              {label.title}
            </p>
            {label.sub ? (
              <p className="whitespace-nowrap font-mono text-xs tracking-[0.1em] text-muted-foreground">{label.sub}</p>
            ) : null}
            </div>
          </div>
        </div>
      ))}
      <div className="absolute right-4 top-4 flex flex-col gap-1.5">
        <button type="button" aria-label="Zoom in" className={CONTROL_CLASS} onClick={() => sceneRef.current?.zoomBy(1.3)}>
          <Plus className="size-4" aria-hidden="true" />
        </button>
        <button type="button" aria-label="Zoom out" className={CONTROL_CLASS} onClick={() => sceneRef.current?.zoomBy(1 / 1.3)}>
          <Minus className="size-4" aria-hidden="true" />
        </button>
        <button type="button" aria-label="Rotate left" className={CONTROL_CLASS} onClick={() => sceneRef.current?.rotateBy(0.35)}>
          <RotateCcw className="size-4" aria-hidden="true" />
        </button>
        <button type="button" aria-label="Rotate right" className={CONTROL_CLASS} onClick={() => sceneRef.current?.rotateBy(-0.35)}>
          <RotateCw className="size-4" aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-label="Reset view"
          className={`${CONTROL_CLASS} font-mono text-xs tracking-[0.08em]`}
          onClick={() => {
            onSelectJob(null)
            sceneRef.current?.resetView()
          }}
        >
          RESET
        </button>
      </div>
      {layers ? (
        <PortfolioLayerControl
          state={layers.state}
          onChange={layers.onChange}
          weatherParts={weather?.parts}
          onWeatherParts={weather?.onParts}
          available={layers.settings ? undefined : ["weather", "fire"]}
        />
      ) : null}
      {weatherOn && weather ? (
        <div className="pointer-events-none absolute inset-x-3 bottom-3 flex flex-col items-start">
          {weatherOn ? (
            <div className="pointer-events-auto w-full max-w-xl">
              {weatherData && !weatherData.warming ? (
                <WeatherTimeBar start={weatherData.start} steps={weatherData.steps} step={step} onStep={weather.onStep} />
              ) : (
                <p className="border border-border bg-background/85 px-3 py-2 font-mono text-xs tracking-[0.1em] text-muted-foreground backdrop-blur" role="status">
                  {weatherStatus}
                </p>
              )}
            </div>
          ) : null}
        </div>
      ) : null}
      {!ready ? (
        <p className="pointer-events-none absolute inset-0 flex items-center justify-center font-mono text-xs tracking-[0.16em] text-muted-foreground">
          LOADING TERRAIN…
        </p>
      ) : null}
    </div>
      {/* Legend and credits share one wrapping bar below the map so they never cover it. */}
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-1.5 px-4 pb-3 pt-1.5">
      {layers ? (
        <div className="basis-full">
          <PortfolioLayerLegend state={layers.state} settings={layers.settings} />
        </div>
      ) : null}
      {markerKey ? (
        <ul className="flex flex-wrap gap-x-3.5 gap-y-1 font-mono text-xs tracking-[0.12em] text-muted-foreground">
          {markerKey.entries.map((entry) => (
            <li key={entry.id} className="flex items-center gap-1.5">
              <span className="size-2" style={{ background: `var(${entry.colorToken})` }} aria-hidden="true" />
              {entry.label.toUpperCase()}
            </li>
          ))}
        </ul>
      ) : showPhaseKey ? (
        <ul className="flex flex-wrap gap-x-3.5 gap-y-1 font-mono text-xs tracking-[0.12em] text-muted-foreground">
          {PORTFOLIO_PHASES.map((phase) => (
            <li key={phase.id} className="flex items-center gap-1.5">
              <span className="size-2" style={{ background: phaseColor(phase.id) }} aria-hidden="true" />
              {phase.label.toUpperCase()}
            </li>
          ))}
        </ul>
      ) : null}
      <p className="ml-auto text-right font-mono text-xs tracking-[0.06em] text-muted-foreground">
        Elevation: AWS Terrain Tiles (USGS 3DEP, SRTM) ·{" "}
        {mapState === "CO" ? "Roads © OpenStreetMap contributors" : "Outline and roads: U.S. Census Bureau"}
        {weatherOn ? " · Weather: NOAA National Weather Service" : ""}
        {fireOn ? " · Fires: NIFC WFIGS · Smoke: NOAA HMS · Air quality: EPA AirNow" : ""}
      </p>
      </div>
    </div>
  )
}
