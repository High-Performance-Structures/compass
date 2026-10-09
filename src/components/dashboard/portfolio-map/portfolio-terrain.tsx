"use client"

import * as React from "react"
import { Minus, Plus, RotateCcw, RotateCw } from "lucide-react"
import { PORTFOLIO_PHASES, type PortfolioMapJob } from "@/lib/portfolio-map/model"
import {
  PortfolioScene,
  type SceneHighlight,
  type SceneLabel,
} from "@/components/dashboard/portfolio-map/portfolio-scene"
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

type PortfolioTerrainProps = {
  readonly jobs: readonly PortfolioMapJob[]
  readonly highlight: SceneHighlight
  readonly onSelectJob: (jobId: string | null) => void
  readonly onHoverJob: (jobId: string | null) => void
  readonly onUnavailable: () => void
  /** Open zoomed to the selected job instead of the statewide view. */
  readonly focusSelectedOnLoad?: boolean
  /** Messages layer: unread item kinds per job id, or null when the layer is off. */
  readonly messageStacks?: MessageStacks | null
  /** Zone and mountain layers; omitted where travel charges do not apply (owner and vendor maps). */
  readonly layers?: {
    readonly state: PortfolioLayerState
    readonly settings: TravelChargeSettings
    readonly onChange: (next: PortfolioLayerState) => void
  }
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
  onHoverJob,
  onUnavailable,
  focusSelectedOnLoad = false,
  layers,
  messageStacks = null,
}: PortfolioTerrainProps): React.ReactElement {
  const containerRef = React.useRef<HTMLDivElement | null>(null)
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null)
  const sceneRef = React.useRef<PortfolioScene | null>(null)
  const [labels, setLabels] = React.useState<readonly SceneLabel[]>([])
  const [ready, setReady] = React.useState(false)
  const callbacks = React.useRef({ onSelectJob, onHoverJob, onUnavailable })
  callbacks.current = { onSelectJob, onHoverJob, onUnavailable }
  // Read once when the scene starts.
  const focusOnLoad = React.useRef(focusSelectedOnLoad)

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
        onSelect: (jobId) => callbacks.current.onSelectJob(jobId),
        onHover: (jobId) => callbacks.current.onHoverJob(jobId),
        onLabels: setLabels,
        onReady: () => setReady(true),
        onError: () => callbacks.current.onUnavailable(),
      })
    } catch (error) {
      console.error("Portfolio map could not start", error)
      callbacks.current.onUnavailable()
      return
    }
    if (focusOnLoad.current) scene.focusSelectedWhenPlaced()
    sceneRef.current = scene
    return () => {
      sceneRef.current = null
      scene.dispose()
    }
  }, [])

  React.useEffect(() => {
    // Theme colors are lifted for contrast against the dark terrain.
    sceneRef.current?.setJobs(jobs, {
      phase: {
        estimating: themeColorHex(PHASE_COLOR_TOKEN.estimating, 0.45),
        design: themeColorHex(PHASE_COLOR_TOKEN.design, 0.4),
        permitting: themeColorHex(PHASE_COLOR_TOKEN.permitting, 0.3),
        precon: themeColorHex(PHASE_COLOR_TOKEN.precon, 0.4),
        construction: themeColorHex(PHASE_COLOR_TOKEN.construction, 0.35),
        closeout: themeColorHex(PHASE_COLOR_TOKEN.closeout, 0.2),
      },
      risk: themeColorHex("--warning", 0.35),
      late: themeColorHex("--destructive", 0.3),
    })
  }, [jobs])

  React.useEffect(() => {
    sceneRef.current?.setHighlight(highlight)
  }, [highlight])

  React.useEffect(() => {
    sceneRef.current?.setMessageStacks(messageStacks, {
      message: themeColorHex(MESSAGE_KIND_COLOR_TOKEN.message, 0.25),
      mail: themeColorHex(MESSAGE_KIND_COLOR_TOKEN.mail, 0.3),
      rfi: themeColorHex(MESSAGE_KIND_COLOR_TOKEN.rfi, 0.15),
      schedule: themeColorHex(MESSAGE_KIND_COLOR_TOKEN.schedule, 0.3),
      other: themeColorHex(MESSAGE_KIND_COLOR_TOKEN.other, 0.3),
    })
  }, [messageStacks, ready])

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
  }, [layerState, layerSettings])

  return (
    <div className="flex h-full min-h-[420px] w-full flex-col">
    {/* The scene sizes itself to this area; the key sits below it, off the terrain. */}
    <div ref={containerRef} className="relative min-h-0 w-full flex-1 overflow-hidden">
      <canvas
        ref={canvasRef}
        aria-label="3D terrain map of Colorado with job markers. Use the job list for keyboard access."
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
      {layers ? <PortfolioLayerControl state={layers.state} onChange={layers.onChange} /> : null}
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
      <ul className="flex flex-wrap gap-x-3.5 gap-y-1 font-mono text-xs tracking-[0.12em] text-muted-foreground">
        {PORTFOLIO_PHASES.map((phase) => (
          <li key={phase.id} className="flex items-center gap-1.5">
            <span className="size-2" style={{ background: phaseColor(phase.id) }} aria-hidden="true" />
            {phase.label.toUpperCase()}
          </li>
        ))}
      </ul>
      <p className="ml-auto text-right font-mono text-xs tracking-[0.06em] text-muted-foreground">
        Elevation: AWS Terrain Tiles (USGS 3DEP, SRTM) · Roads © OpenStreetMap contributors
      </p>
      </div>
    </div>
  )
}
