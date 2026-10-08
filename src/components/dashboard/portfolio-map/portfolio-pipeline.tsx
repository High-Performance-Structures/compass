"use client"

import type * as React from "react"
import { cn } from "@/lib/utils"
import { HEALTH_LABEL, healthColor, phaseColor } from "@/components/dashboard/portfolio-map/portfolio-style"
import {
  PORTFOLIO_PHASES,
  type PortfolioMapJob,
  type PortfolioPhaseId,
} from "@/lib/portfolio-map/model"

type PortfolioPipelineProps = {
  readonly jobs: readonly PortfolioMapJob[]
  readonly selectedJobId: string | null
  readonly selectedPhase: PortfolioPhaseId | null
  readonly onSelectJob: (jobId: string) => void
  readonly onSelectPhase: (phase: PortfolioPhaseId) => void
}

/**
 * The 2-D pipeline: one column per phase, each job with a progress ring. Used
 * on phones, with reduced motion, when 3D is unavailable, or by choice.
 */
export function PortfolioPipeline({
  jobs,
  selectedJobId,
  selectedPhase,
  onSelectJob,
  onSelectPhase,
}: PortfolioPipelineProps): React.ReactElement {
  return (
    <div className="h-full overflow-x-auto bg-card">
      <ol className="grid min-h-full min-w-[56rem] grid-cols-6">
        {PORTFOLIO_PHASES.map((phase) => {
          const phaseJobs = jobs.filter((job) => job.phase === phase.id)
          const dimPhase = selectedPhase !== null && selectedPhase !== phase.id
          return (
            <li key={phase.id} className={cn("flex flex-col border-r border-border last:border-r-0", dimPhase && "opacity-45")}>
              <button
                type="button"
                className="flex min-h-12 items-center justify-between gap-2 border-b border-border px-3 text-left transition-colors hover:bg-accent"
                onClick={() => onSelectPhase(phase.id)}
                aria-pressed={selectedPhase === phase.id}
              >
                <span className="flex items-center gap-2 font-mono text-xs tracking-[0.12em]">
                  <span className="size-2" style={{ background: phaseColor(phase.id) }} aria-hidden="true" />
                  {phase.label.toUpperCase()}
                </span>
                <span className="font-mono text-xs tabular-nums">{phaseJobs.length}</span>
              </button>
              <ul className="flex flex-col">
                {phaseJobs.map((job) => {
                  const selected = job.id === selectedJobId
                  const progress = job.progress ?? 0
                  return (
                    <li key={job.id}>
                      <button
                        type="button"
                        aria-pressed={selected}
                        className={cn(
                          "flex w-full items-center gap-3 border-b border-border px-3 py-2.5 text-left transition-colors hover:bg-accent",
                          selected && "bg-accent",
                        )}
                        onClick={() => onSelectJob(job.id)}
                      >
                        <span
                          className="relative size-9 shrink-0 rounded-full"
                          style={{ background: `conic-gradient(${phaseColor(job.phase)} ${progress}%, var(--muted) 0)` }}
                          aria-hidden="true"
                        >
                          <span className="absolute inset-1 flex items-center justify-center rounded-full bg-card font-mono text-xs tabular-nums">
                            {job.progress === null ? "—" : job.progress}
                          </span>
                          {job.health !== "ok" ? (
                            <span
                              className="absolute -right-0.5 -top-0.5 size-2.5 rounded-full border-2 border-card"
                              style={{ background: healthColor(job.health) }}
                            />
                          ) : null}
                        </span>
                        <span className="flex min-w-0 flex-col">
                          <span className="truncate text-xs">{job.name}</span>
                          <span className="font-mono text-xs tracking-[0.08em] text-muted-foreground">
                            {job.town ? job.town.toUpperCase() : "NO TOWN"}
                            {job.health !== "ok" ? ` · ${HEALTH_LABEL[job.health].toUpperCase()}` : ""}
                          </span>
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
