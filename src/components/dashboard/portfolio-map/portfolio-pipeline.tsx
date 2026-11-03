"use client"

import type * as React from "react"
import Link from "next/link"
import { FolderOpen, Scroll } from "lucide-react"
import { cn } from "@/lib/utils"
import { projectFilesHref } from "@/components/dashboard/portfolio-map/portfolio-job-actions"
import { HEALTH_LABEL, healthColor, phaseColor } from "@/components/dashboard/portfolio-map/portfolio-style"
import { FollowUpChip } from "@/components/projects/project-follow-up-aging"
import { PortfolioNotificationIndicator } from "./portfolio-notification-indicator"
import type { PortfolioMessagesForJob } from "./use-portfolio-messages"
import {
  PORTFOLIO_PHASES,
  portfolioMarkerAlert,
  type PortfolioMapJob,
  type PortfolioPhaseId,
} from "@/lib/portfolio-map/model"

type PortfolioPipelineProps = {
  readonly jobs: readonly PortfolioMapJob[]
  readonly selectedJobId: string | null
  readonly selectedPhase: PortfolioPhaseId | null
  readonly onSelectJob: (jobId: string) => void
  readonly onSelectPhase: (phase: PortfolioPhaseId) => void
  /** Shows a Files link on each job row; staff only. */
  readonly canOpenFiles?: boolean
  readonly messagesForJob?: PortfolioMessagesForJob
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
  canOpenFiles = false,
  messagesForJob,
}: PortfolioPipelineProps): React.ReactElement {
  return (
    <div className="h-full overflow-auto bg-card">
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
                  const alert = portfolioMarkerAlert(job)
                  return (
                    <li key={job.id} className={cn("grid grid-cols-[minmax(0,1fr)_auto] border-b border-border", selected && "bg-accent")}>
                      <button
                        type="button"
                        aria-pressed={selected}
                        className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-accent"
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
                          {alert ? (
                            <span
                              className="absolute -right-0.5 -top-0.5 size-2.5 rounded-full border-2 border-card"
                              style={{ background: healthColor(alert) }}
                            />
                          ) : null}
                        </span>
                        <span className="flex min-w-0 flex-col gap-0.5">
                          <span className="truncate text-xs">{job.name}</span>
                          <span className="font-mono text-xs tracking-[0.08em] text-muted-foreground">
                            {job.town ? job.town.toUpperCase() : "NO TOWN"}
                            {job.health !== "ok" ? ` · ${HEALTH_LABEL[job.health].toUpperCase()}` : ""}
                          </span>
                          <span className="flex">
                            <FollowUpChip signal={job.followUp} />
                          </span>
                        </span>
                      </button>
                      <div className="col-span-2 row-start-2">
                        <PortfolioNotificationIndicator
                          messages={messagesForJob?.(job.id) ?? null}
                          jobName={job.name}
                          onOpen={() => onSelectJob(job.id)}
                        />
                      </div>
                      {canOpenFiles ? (
                        <div className="col-start-2 row-start-1 flex w-9 shrink-0 flex-col border-l border-border">
                          <Link
                            href={projectFilesHref(job.id)}
                            aria-label={`All files for ${job.name}`}
                            title="All files"
                            className="flex flex-1 items-center justify-center text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                          >
                            <FolderOpen className="size-4" aria-hidden="true" />
                          </Link>
                          {job.planSetDocumentId ? (
                            <a
                              href={`/api/projects/${job.id}/documents/${job.planSetDocumentId}/download`}
                              target="_blank"
                              rel="noopener noreferrer"
                              aria-label={`Open plan set for ${job.name}`}
                              title="Open plan set"
                              className="flex flex-1 items-center justify-center border-t border-border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                            >
                              <Scroll className="size-4" aria-hidden="true" />
                            </a>
                          ) : (
                            <span
                              title="No plan set pinned"
                              aria-hidden="true"
                              className="flex flex-1 items-center justify-center border-t border-border text-muted-foreground/30"
                            >
                              <Scroll className="size-4" />
                            </span>
                          )}
                        </div>
                      ) : null}
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
