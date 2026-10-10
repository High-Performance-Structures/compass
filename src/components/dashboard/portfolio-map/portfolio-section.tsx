"use client"

import * as React from "react"
import dynamic from "next/dynamic"
import { useSearchParams } from "next/navigation"
import { cn } from "@/lib/utils"
import { PortfolioPanel, type PortfolioSelection } from "@/components/dashboard/portfolio-map/portfolio-panel"
import { usePortfolioStatusMoves } from "@/components/dashboard/portfolio-map/use-portfolio-status-moves"
import { PortfolioPipeline } from "@/components/dashboard/portfolio-map/portfolio-pipeline"
import type { SceneHighlight } from "@/components/dashboard/portfolio-map/portfolio-scene"
import type { PortfolioMapJob, PortfolioPhaseId } from "@/lib/portfolio-map/model"
import type { PortfolioHiddenJob, PortfolioTravelData, PortfolioUnplacedJob } from "@/lib/portfolio-map/load"
import {
  NO_LAYERS,
  readStoredLayers,
  storeLayers,
  type PortfolioLayerState,
} from "@/components/dashboard/portfolio-map/portfolio-layers"
import type { PortfolioJobMessages } from "@/components/dashboard/portfolio-map/portfolio-job-messages"
import { useNotificationInbox } from "@/hooks/use-notification-inbox"
import { groupInbox } from "@/lib/notifications/inbox"
import { messageStacksFrom } from "@/lib/notifications/message-stacks"
import {
  SalesJobPanel,
  SalesPipelineColumns,
  salesPipelineSummary,
  useSalesPipeline,
} from "@/components/dashboard/sales-pipeline/sales-pipeline-board"
import type { PortfolioMarkerKey } from "@/components/dashboard/portfolio-map/portfolio-terrain"
import type { SalesPipeline } from "@/lib/sales-pipeline/load"
import { SALES_MAP_KEY_ENTRIES, salesMapJobs, salesMarkerColorTokens } from "@/lib/sales-pipeline/map"

// three.js and the terrain scene load only when the map is about to be seen.
const PortfolioTerrain = dynamic(
  () => import("@/components/dashboard/portfolio-map/portfolio-terrain"),
  { ssr: false, loading: () => <div className="h-full min-h-[420px]" /> },
)

type PortfolioView = "map" | "pipeline"
const VIEW_STORAGE_KEY = "compass:portfolio-view:v1"

function readStoredView(): PortfolioView | null {
  try {
    const value = window.localStorage.getItem(VIEW_STORAGE_KEY)
    return value === "map" || value === "pipeline" ? value : null
  } catch {
    return null
  }
}

// Which jobs the map and pipeline show: the projects (null) or a sales
// department's pipeline, by department code.
const SCOPE_STORAGE_KEY = "compass:portfolio-scope:v1"

function readStoredScope(salesPipelines: readonly SalesPipeline[]): string | null {
  try {
    const value = window.localStorage.getItem(SCOPE_STORAGE_KEY)
    return salesPipelines.some((pipeline) => pipeline.department === value) ? value : null
  } catch {
    return null
  }
}

function defaultView(): PortfolioView {
  if (typeof window.matchMedia !== "function") return "pipeline"
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches
  const narrow = window.matchMedia("(max-width: 767px)").matches
  return reducedMotion || narrow ? "pipeline" : "map"
}

export function PortfolioSection({
  jobs: serverJobs,
  unplaced,
  hidden,
  travel,
  salesPipelines = [],
}: {
  readonly jobs: readonly PortfolioMapJob[]
  readonly unplaced: readonly PortfolioUnplacedJob[]
  readonly hidden: readonly PortfolioHiddenJob[]
  readonly travel: PortfolioTravelData | null
  readonly salesPipelines?: readonly SalesPipeline[]
}): React.ReactElement | null {
  const sectionRef = React.useRef<HTMLElement | null>(null)
  const { jobs, statusMove } = usePortfolioStatusMoves(serverJobs)
  const [view, setView] = React.useState<PortfolioView>("pipeline")
  const [mapUnavailable, setMapUnavailable] = React.useState(false)
  const [nearViewport, setNearViewport] = React.useState(false)
  const [selection, setSelection] = React.useState<PortfolioSelection>({ kind: "none" })
  const [hoveredJobId, setHoveredJobId] = React.useState<string | null>(null)
  const [layerState, setLayerState] = React.useState<PortfolioLayerState>(NO_LAYERS)
  const [scope, setScope] = React.useState<string | null>(null)
  const activeSales = salesPipelines.find((pipeline) => pipeline.department === scope) ?? null
  const sales = useSalesPipeline(activeSales)

  const firstSalesPipelines = React.useRef(salesPipelines)
  React.useEffect(() => {
    setView(readStoredView() ?? defaultView())
    setLayerState(readStoredLayers())
    setScope(readStoredScope(firstSalesPipelines.current))
  }, [])

  // "Show on map" from the bell: map view, Messages layer on, that job
  // selected. Watches the URL because the bell navigates within the page.
  const searchParams = useSearchParams()
  const linkedLayer = searchParams.get("layer")
  const linkedJob = searchParams.get("job")
  React.useEffect(() => {
    if (linkedLayer !== "messages" || !linkedJob) return
    const next = { ...readStoredLayers(), messages: true }
    setView("map")
    setScope(null)
    setLayerState(next)
    storeLayers(next)
    setSelection({ kind: "job", jobId: linkedJob })
    sectionRef.current?.scrollIntoView({ block: "start" })
  }, [linkedJob, linkedLayer])

  React.useEffect(() => {
    const element = sectionRef.current
    if (!element || nearViewport) return
    if (typeof IntersectionObserver === "undefined") {
      setNearViewport(true)
      return
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setNearViewport(true)
      },
      { rootMargin: "300px" },
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [nearViewport])

  const chooseView = (next: PortfolioView): void => {
    setView(next)
    try {
      window.localStorage.setItem(VIEW_STORAGE_KEY, next)
    } catch {
      // The choice still applies to this visit.
    }
  }

  const chooseScope = (next: string | null): void => {
    setScope(next)
    sales.select(null)
    try {
      if (next) window.localStorage.setItem(SCOPE_STORAGE_KEY, next)
      else window.localStorage.removeItem(SCOPE_STORAGE_KEY)
    } catch {
      // The choice still applies to this visit.
    }
  }

  const selectJob = React.useCallback((jobId: string | null): void => {
    setSelection(jobId ? { kind: "job", jobId } : { kind: "none" })
  }, [])
  const selectPhase = React.useCallback((phase: PortfolioPhaseId): void => {
    setSelection({ kind: "phase", phase })
  }, [])
  const clear = React.useCallback((): void => setSelection({ kind: "none" }), [])
  const handleUnavailable = React.useCallback((): void => setMapUnavailable(true), [])
  const changeLayers = React.useCallback((next: PortfolioLayerState): void => {
    setLayerState(next)
    storeLayers(next)
  }, [])
  // Messages layer: the viewer's bell items, stacked per job on the map.
  const messagesOn = layerState.messages && travel !== null && view === "map" && !mapUnavailable
  const inbox = useNotificationInbox(messagesOn)
  const messageStacks = React.useMemo(
    () => (messagesOn ? messageStacksFrom(inbox.items) : null),
    [inbox.items, messagesOn],
  )
  const selectedJobId = selection.kind === "job" ? selection.jobId : null
  const { markRead: markInboxRead, done: markInboxDone } = inbox
  const jobMessages = React.useMemo<PortfolioJobMessages | null>(() => {
    if (!messagesOn || !selectedJobId) return null
    const sections = groupInbox(inbox.items.filter((item) => item.projectId === selectedJobId))
    return {
      rows: sections.flatMap((section) => section.rows.filter((row) => row.unreadCount > 0)),
      loaded: inbox.loaded,
      onMarkRead: (row) => void markInboxRead(row),
      onDone: (row) => void markInboxDone(row),
    }
  }, [inbox.items, inbox.loaded, markInboxDone, markInboxRead, messagesOn, selectedJobId])

  const travelSettings = travel?.settings
  const layers = React.useMemo(
    () => (travelSettings ? { state: layerState, settings: travelSettings, onChange: changeLayers } : undefined),
    [changeLayers, layerState, travelSettings],
  )

  const salesSelectedId = sales.selected?.id ?? null
  const highlight = React.useMemo<SceneHighlight>(
    () =>
      activeSales
        ? { selectedJobId: salesSelectedId, selectedPhase: null, hoveredJobId }
        : {
            selectedJobId: selection.kind === "job" ? selection.jobId : null,
            selectedPhase: selection.kind === "phase" ? selection.phase : null,
            hoveredJobId,
          },
    [activeSales, hoveredJobId, salesSelectedId, selection],
  )

  // A sales scope puts its jobs on the map, colored by sales stage, with its own key.
  const salesJobs = sales.jobs
  const mapJobs = React.useMemo(() => (activeSales ? salesMapJobs(salesJobs) : jobs), [activeSales, jobs, salesJobs])
  const markerKey = React.useMemo<PortfolioMarkerKey | null>(
    () =>
      activeSales ? { entries: SALES_MAP_KEY_ENTRIES, colorTokenByJobId: salesMarkerColorTokens(salesJobs) } : null,
    [activeSales, salesJobs],
  )

  if (jobs.length === 0 && unplaced.length === 0 && hidden.length === 0 && salesPipelines.length === 0) return null

  const scopes: readonly { readonly scope: string | null; readonly label: string }[] = [
    { scope: null, label: "PROJECTS" },
    ...salesPipelines.map((pipeline) => ({ scope: pipeline.department, label: pipeline.title.toUpperCase() })),
  ]

  const showMap = view === "map" && !mapUnavailable
  const building = jobs.filter((job) => job.phase === "construction").length
  const closing = jobs.filter((job) => job.phase === "closeout").length
  const pipeline = jobs.length - building - closing

  return (
    <section ref={sectionRef} aria-labelledby="portfolio-title" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div className="flex flex-wrap items-baseline gap-3">
          <h2 id="portfolio-title" className="text-lg font-semibold">Portfolio</h2>
          <span className="font-mono text-xs tracking-[0.12em] text-muted-foreground">
            {activeSales
              ? salesPipelineSummary(sales.jobs)
              : `${building} BUILDING · ${pipeline} IN PIPELINE · ${closing} CLOSING OUT`}
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          {scopes.length > 1 ? (
            <div role="group" aria-label="Portfolio jobs" className="flex border border-border">
              {scopes.map((option) => (
                <button
                  key={option.label}
                  type="button"
                  aria-pressed={scope === option.scope}
                  onClick={() => chooseScope(option.scope)}
                  className={cn(
                    "min-h-8 px-3 font-mono text-xs tracking-[0.12em] transition-colors",
                    scope === option.scope ? "bg-foreground text-background" : "bg-card hover:bg-accent",
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
          ) : null}
          <div role="group" aria-label="Portfolio view" className="flex border border-border">
            {(["map", "pipeline"] as const).map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={view === option}
                disabled={option === "map" && mapUnavailable}
                onClick={() => chooseView(option)}
                className={cn(
                  "min-h-8 px-3 font-mono text-xs tracking-[0.12em] transition-colors disabled:opacity-50",
                  view === option ? "bg-foreground text-background" : "bg-card hover:bg-accent",
                )}
              >
                {option.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
      </div>
      {mapUnavailable && view === "map" ? (
        <p className="text-xs text-muted-foreground">The 3D map isn&apos;t available in this browser, so the pipeline view is shown.</p>
      ) : null}
      {/* Map and panel share one fixed height; the panel scrolls instead of growing the row. */}
      <div className="flex flex-wrap gap-0 border border-border">
        <div className="h-[34rem] min-w-0 flex-[999_1_40rem]">
          {showMap ? (
            nearViewport ? (
              <PortfolioTerrain
                jobs={mapJobs}
                highlight={highlight}
                onSelectJob={activeSales ? sales.select : selectJob}
                markerKey={markerKey}
                onHoverJob={setHoveredJobId}
                onUnavailable={handleUnavailable}
                layers={layers}
                messageStacks={messageStacks}
                focusSelectedOnLoad={linkedLayer === "messages" && linkedJob !== null}
              />
            ) : (
              <div className="h-full" />
            )
          ) : activeSales ? (
            <SalesPipelineColumns state={sales} />
          ) : (
            <PortfolioPipeline
              jobs={jobs}
              selectedJobId={highlight.selectedJobId}
              selectedPhase={highlight.selectedPhase}
              onSelectJob={selectJob}
              onSelectPhase={selectPhase}
            />
          )}
        </div>
        <aside aria-label="Job details" className="max-h-[34rem] min-w-0 flex-[1_1_20rem] overflow-y-auto border-l border-border bg-card">
          {activeSales ? (
            <SalesJobPanel state={sales} title={activeSales.title} />
          ) : (
            <PortfolioPanel
              jobs={jobs}
              unplaced={unplaced}
              hidden={hidden}
              travel={travel}
              selection={selection}
              onSelectJob={selectJob}
              onSelectPhase={selectPhase}
              onClear={clear}
              jobMessages={jobMessages}
              statusMove={statusMove}
            />
          )}
        </aside>
      </div>
    </section>
  )
}
