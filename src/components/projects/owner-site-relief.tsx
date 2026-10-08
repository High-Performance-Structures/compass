"use client"

import * as React from "react"
import dynamic from "next/dynamic"
import type { SceneHighlight } from "@/components/dashboard/portfolio-map/portfolio-scene"
import { ownerPhaseSteps } from "@/lib/portfolio-map/audience-model"
import type { PortfolioMapJob } from "@/lib/portfolio-map/model"
import { cn } from "@/lib/utils"

// three.js loads only when the map is shown.
const PortfolioTerrain = dynamic(
  () => import("@/components/dashboard/portfolio-map/portfolio-terrain"),
  { ssr: false, loading: () => <div className="h-full min-h-[320px] bg-black" /> },
)

function canShowMap(): boolean {
  if (typeof window.matchMedia !== "function") return false
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches
  const narrow = window.matchMedia("(max-width: 767px)").matches
  return !reducedMotion && !narrow
}

const noop = (): void => {}

/**
 * The owner's project on the Colorado relief, zoomed to its town. The pin
 * marks the town, never the site, and only owner-visible schedule work feeds
 * the progress figure.
 */
export function OwnerSiteRelief({
  job,
  progress,
}: {
  readonly job: PortfolioMapJob
  readonly progress: number | null
}): React.ReactElement {
  const [showMap, setShowMap] = React.useState(false)
  React.useEffect(() => {
    setShowMap(canShowMap() && job.lat !== null && job.lon !== null)
  }, [job.lat, job.lon])
  const hideMap = React.useCallback((): void => setShowMap(false), [])
  const jobs = React.useMemo(() => [job], [job])
  const highlight = React.useMemo<SceneHighlight>(
    () => ({ selectedJobId: job.id, hoveredJobId: null, selectedPhase: null }),
    [job.id],
  )
  const steps = ownerPhaseSteps(job.phase)
  const current = steps.find((step) => step.state === "current")

  return (
    <section aria-labelledby="owner-relief-title" className="flex w-full flex-col gap-3 border-b py-4">
      <div className="flex flex-wrap items-baseline gap-3">
        <h2 id="owner-relief-title" className="text-sm font-semibold">Where things stand</h2>
        {job.town ? (
          <span className="font-mono text-xs tracking-[0.12em] text-muted-foreground">
            NEAR {job.town.toUpperCase()}
          </span>
        ) : null}
      </div>
      <div className="flex w-full flex-wrap border border-border">
        {showMap ? (
          <div className="h-[27rem] min-w-0 flex-[999_1_32rem]">
            <PortfolioTerrain
              jobs={jobs}
              highlight={highlight}
              onSelectJob={noop}
              onHoverJob={noop}
              onUnavailable={hideMap}
              focusSelectedOnLoad
            />
          </div>
        ) : null}
        <div className={cn("flex min-w-0 flex-[1_1_18rem] flex-col gap-4 bg-card p-4", showMap && "border-l border-border")}>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Stage</p>
            <p className="mt-1 text-lg font-semibold">{current?.label ?? job.statusLabel}</p>
          </div>
          <ol className="grid gap-1.5" aria-label="Project stages">
            {steps.map((step) => (
              <li
                key={step.id}
                aria-current={step.state === "current" ? "step" : undefined}
                className={cn(
                  "flex items-center gap-2 text-sm",
                  step.state === "upcoming" && "text-muted-foreground",
                  step.state === "current" && "font-semibold",
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    "size-2.5 shrink-0 rounded-full border",
                    step.state === "done" && "border-primary bg-primary",
                    step.state === "current" && "border-primary bg-primary/40",
                    step.state === "upcoming" && "border-border",
                  )}
                />
                {step.label}
              </li>
            ))}
          </ol>
          {progress !== null ? (
            <div>
              <div className="flex items-baseline justify-between text-xs text-muted-foreground">
                <span>Scheduled work complete</span>
                <span className="font-mono">{progress}%</span>
              </div>
              <div
                className="mt-1 h-2 w-full overflow-hidden rounded-full bg-muted"
                role="progressbar"
                aria-label="Scheduled work complete"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={progress}
              >
                <div className="h-full rounded-full bg-primary" style={{ width: `${progress}%` }} />
              </div>
            </div>
          ) : null}
          {showMap ? (
            <p className="mt-auto text-xs text-muted-foreground">The map shows the general area, not the exact site.</p>
          ) : null}
        </div>
      </div>
    </section>
  )
}
