"use client"

import * as React from "react"
import dynamic from "next/dynamic"
import { cn } from "@/lib/utils"
import { PortfolioPanel, type PortfolioSelection } from "@/components/dashboard/portfolio-map/portfolio-panel"
import { PortfolioPipeline } from "@/components/dashboard/portfolio-map/portfolio-pipeline"
import type { SceneHighlight } from "@/components/dashboard/portfolio-map/portfolio-scene"
import type { PortfolioMapJob, PortfolioPhaseId } from "@/lib/portfolio-map/model"
import type { PortfolioHiddenJob, PortfolioUnplacedJob } from "@/lib/portfolio-map/load"

// three.js and the terrain scene load only when the map is about to be seen.
const PortfolioTerrain = dynamic(
  () => import("@/components/dashboard/portfolio-map/portfolio-terrain"),
  { ssr: false, loading: () => <div className="h-full min-h-[420px] bg-black" /> },
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

function defaultView(): PortfolioView {
  if (typeof window.matchMedia !== "function") return "pipeline"
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches
  const narrow = window.matchMedia("(max-width: 767px)").matches
  return reducedMotion || narrow ? "pipeline" : "map"
}

export function PortfolioSection({
  jobs,
  unplaced,
  hidden,
}: {
  readonly jobs: readonly PortfolioMapJob[]
  readonly unplaced: readonly PortfolioUnplacedJob[]
  readonly hidden: readonly PortfolioHiddenJob[]
}): React.ReactElement | null {
  const sectionRef = React.useRef<HTMLElement | null>(null)
  const [view, setView] = React.useState<PortfolioView>("pipeline")
  const [mapUnavailable, setMapUnavailable] = React.useState(false)
  const [nearViewport, setNearViewport] = React.useState(false)
  const [selection, setSelection] = React.useState<PortfolioSelection>({ kind: "none" })
  const [hoveredJobId, setHoveredJobId] = React.useState<string | null>(null)

  React.useEffect(() => {
    setView(readStoredView() ?? defaultView())
  }, [])

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

  const selectJob = React.useCallback((jobId: string | null): void => {
    setSelection(jobId ? { kind: "job", jobId } : { kind: "none" })
  }, [])
  const selectPhase = React.useCallback((phase: PortfolioPhaseId): void => {
    setSelection({ kind: "phase", phase })
  }, [])
  const clear = React.useCallback((): void => setSelection({ kind: "none" }), [])
  const handleUnavailable = React.useCallback((): void => setMapUnavailable(true), [])

  const highlight = React.useMemo<SceneHighlight>(
    () => ({
      selectedJobId: selection.kind === "job" ? selection.jobId : null,
      selectedPhase: selection.kind === "phase" ? selection.phase : null,
      hoveredJobId,
    }),
    [hoveredJobId, selection],
  )

  if (jobs.length === 0 && unplaced.length === 0 && hidden.length === 0) return null

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
            {building} BUILDING · {pipeline} IN PIPELINE · {closing} CLOSING OUT
          </span>
        </div>
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
      {mapUnavailable && view === "map" ? (
        <p className="text-xs text-muted-foreground">The 3D map isn&apos;t available in this browser, so the pipeline view is shown.</p>
      ) : null}
      {/* Map and panel share one fixed height; the panel scrolls instead of growing the row. */}
      <div className="flex flex-wrap gap-0 border border-border">
        <div className="h-[34rem] min-w-0 flex-[999_1_40rem]">
          {showMap ? (
            nearViewport ? (
              <PortfolioTerrain
                jobs={jobs}
                highlight={highlight}
                onSelectJob={selectJob}
                onHoverJob={setHoveredJobId}
                onUnavailable={handleUnavailable}
              />
            ) : (
              <div className="h-full bg-black" />
            )
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
          <PortfolioPanel
            jobs={jobs}
            unplaced={unplaced}
            hidden={hidden}
            selection={selection}
            onSelectJob={selectJob}
            onSelectPhase={selectPhase}
            onClear={clear}
          />
        </aside>
      </div>
    </section>
  )
}
