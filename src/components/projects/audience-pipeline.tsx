"use client"

import * as React from "react"
import { phaseColor } from "@/components/dashboard/portfolio-map/portfolio-style"
import type { AudiencePipelineColumn } from "@/lib/portfolio-map/audience-model"
import { cn } from "@/lib/utils"

export type AudienceMapView = "map" | "pipeline"

/**
 * Map / Pipeline choice for an owner or partner dashboard, remembered per
 * browser like the office dashboard's. Pipeline is the only view when the
 * map can't be drawn (phones, reduced motion, no placed jobs).
 */
export function useAudienceMapView(storageKey: string, mapAvailable: boolean): readonly [AudienceMapView, (view: AudienceMapView) => void] {
  const [stored, setStored] = React.useState<AudienceMapView>("map")
  React.useEffect(() => {
    try {
      if (window.localStorage.getItem(storageKey) === "pipeline") setStored("pipeline")
    } catch {
      // Storage blocked: open on the map.
    }
  }, [storageKey])
  const choose = React.useCallback((view: AudienceMapView): void => {
    setStored(view)
    try {
      window.localStorage.setItem(storageKey, view)
    } catch {
      // The choice still applies to this visit.
    }
  }, [storageKey])
  return [mapAvailable ? stored : "pipeline", choose]
}

/** The office dashboard's MAP / PIPELINE buttons. */
export function AudienceMapViewButtons({
  view,
  mapAvailable,
  onChange,
}: {
  readonly view: AudienceMapView
  readonly mapAvailable: boolean
  readonly onChange: (view: AudienceMapView) => void
}): React.ReactElement {
  return (
    <div role="group" aria-label="Jobs view" className="flex border border-border">
      {(["map", "pipeline"] as const).map((option) => (
        <button
          key={option}
          type="button"
          aria-pressed={view === option}
          disabled={option === "map" && !mapAvailable}
          onClick={() => onChange(option)}
          className={cn(
            "min-h-8 px-3 font-mono text-xs tracking-[0.12em] transition-colors disabled:opacity-50",
            view === option ? "bg-foreground text-background" : "bg-card hover:bg-accent",
          )}
        >
          {option.toUpperCase()}
        </button>
      ))}
    </div>
  )
}

/**
 * The office pipeline's layout for owners and partners: one column per
 * audience-safe stage, each job by name and town. Carries none of the office
 * signals (health, follow-ups, staff messages, files or schedule progress).
 */
export function AudiencePipeline({
  columns,
  selectedJobId,
  onSelectJob,
}: {
  readonly columns: readonly AudiencePipelineColumn[]
  readonly selectedJobId: string | null
  readonly onSelectJob: (jobId: string) => void
}): React.ReactElement {
  return (
    <div className="h-full overflow-auto bg-card">
      <ol
        className="grid min-h-full"
        style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(9rem, 1fr))` }}
      >
        {columns.map((column) => (
          <li key={column.id} className="flex flex-col border-r border-border last:border-r-0">
            <div className="flex min-h-12 items-center justify-between gap-2 border-b border-border px-3">
              <span className="flex items-center gap-2 font-mono text-xs tracking-[0.12em]">
                <span className="size-2 shrink-0" style={{ background: phaseColor(column.phase) }} aria-hidden="true" />
                {column.label.toUpperCase()}
              </span>
              <span className="font-mono text-xs tabular-nums">{column.jobs.length}</span>
            </div>
            <ul className="flex flex-col">
              {column.jobs.map((job) => (
                <li key={job.id} className={cn("border-b border-border", job.id === selectedJobId && "bg-accent")}>
                  <button
                    type="button"
                    aria-pressed={job.id === selectedJobId}
                    onClick={() => onSelectJob(job.id)}
                    className="flex w-full min-w-0 items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-accent"
                  >
                    <span className="size-3 shrink-0 rounded-full" style={{ background: phaseColor(job.phase) }} aria-hidden="true" />
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className="truncate text-xs">{job.name}</span>
                      <span className="font-mono text-xs tracking-[0.08em] text-muted-foreground">
                        {job.town ? job.town.toUpperCase() : "NO TOWN"}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
    </div>
  )
}
