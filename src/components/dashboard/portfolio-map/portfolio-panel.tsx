"use client"

import Link from "next/link"
import type * as React from "react"
import { X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { formatDateKeyShort } from "@/components/dashboard/portfolio-map/portfolio-dates"
import {
  HEALTH_LABEL,
  healthColor,
  phaseColor,
} from "@/components/dashboard/portfolio-map/portfolio-style"
import {
  PORTFOLIO_PHASES,
  type PortfolioMapJob,
  type PortfolioPhaseId,
} from "@/lib/portfolio-map/model"
import type { PortfolioUnplacedJob } from "@/lib/portfolio-map/load"

export type PortfolioSelection =
  | { readonly kind: "none" }
  | { readonly kind: "phase"; readonly phase: PortfolioPhaseId }
  | { readonly kind: "job"; readonly jobId: string }

type PortfolioPanelProps = {
  readonly jobs: readonly PortfolioMapJob[]
  readonly unplaced: readonly PortfolioUnplacedJob[]
  readonly selection: PortfolioSelection
  readonly onSelectJob: (jobId: string) => void
  readonly onSelectPhase: (phase: PortfolioPhaseId) => void
  readonly onClear: () => void
}

const LABEL = "font-mono text-xs tracking-[0.12em] text-muted-foreground"
const ROW = "flex min-h-11 w-full items-center justify-between gap-3 border-b border-border px-1 text-left text-sm transition-colors hover:bg-accent"

function HealthTag({ job }: { readonly job: PortfolioMapJob }): React.ReactElement {
  return (
    <span
      className="shrink-0 border px-1.5 py-0.5 font-mono text-xs tracking-[0.1em]"
      style={{ borderColor: healthColor(job.health), color: healthColor(job.health) }}
    >
      {HEALTH_LABEL[job.health].toUpperCase()}
    </span>
  )
}

function CloseButton({ onClear }: { readonly onClear: () => void }): React.ReactElement {
  return (
    <Button type="button" variant="outline" size="icon" aria-label="Close" onClick={onClear}>
      <X aria-hidden="true" />
    </Button>
  )
}

function JobDetail({
  job,
  onClear,
}: {
  readonly job: PortfolioMapJob
  readonly onClear: () => void
}): React.ReactElement {
  const phaseIndex = PORTFOLIO_PHASES.findIndex((phase) => phase.id === job.phase)
  const phaseLabel = PORTFOLIO_PHASES[phaseIndex]?.label ?? job.statusLabel
  const base = `/dashboard/projects/${encodeURIComponent(job.id)}`
  return (
    <div className="flex h-full flex-col gap-5 p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          {job.projectNumber ? <span className={LABEL}>{job.projectNumber}</span> : null}
          <h3 className="text-xl font-semibold leading-tight">{job.name}</h3>
          <span className="text-sm text-muted-foreground">{job.town ? `${job.town}, CO` : "Town not set"}</span>
        </div>
        <CloseButton onClear={onClear} />
      </div>
      <HealthTag job={job} />
      <div className="flex flex-col gap-2">
        <span className={LABEL}>PIPELINE</span>
        <ol className="grid grid-cols-6 gap-1" aria-label={`Phase: ${phaseLabel}`}>
          {PORTFOLIO_PHASES.map((phase, index) => (
            <li key={phase.id} className="flex flex-col gap-1">
              <span
                className="block h-1"
                style={{
                  background:
                    index === phaseIndex
                      ? phaseColor(phase.id)
                      : index < phaseIndex
                        ? "var(--muted-foreground)"
                        : "var(--border)",
                }}
              />
              <span className={index === phaseIndex ? "font-mono text-xs text-foreground" : "font-mono text-xs text-muted-foreground"}>
                {phase.short}
              </span>
            </li>
          ))}
        </ol>
      </div>
      <div className="flex items-baseline justify-between border-t border-border pt-4">
        <span className={LABEL}>{job.phase === "construction" ? "BUILT" : "SCHEDULE COMPLETE"}</span>
        <span className="text-3xl font-semibold tabular-nums">
          {job.progress === null ? "—" : `${job.progress}%`}
        </span>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
        <dt className="text-muted-foreground">Status</dt>
        <dd className="text-right">{job.statusLabel}</dd>
        <dt className="text-muted-foreground">Next</dt>
        <dd className="text-right">
          {job.nextTaskTitle
            ? `${job.nextTaskTitle}${job.nextTaskStart ? ` · ${formatDateKeyShort(job.nextTaskStart)}` : ""}`
            : "No upcoming schedule items"}
        </dd>
        <dt className="text-muted-foreground">Past due</dt>
        <dd className="text-right" style={job.pastDueCount > 0 ? { color: "var(--destructive)" } : undefined}>
          {job.pastDueCount === 0 ? "None" : `${job.pastDueCount} ${job.pastDueCount === 1 ? "item" : "items"}`}
        </dd>
      </dl>
      <div className="mt-auto flex flex-wrap gap-2 pt-2">
        <Button asChild className="flex-[1_1_9rem]">
          <Link href={base}>Open job →</Link>
        </Button>
        <Button asChild variant="outline" className="flex-[1_1_6rem]">
          <Link href={`${base}/schedule`}>Schedule</Link>
        </Button>
        <Button asChild variant="outline" className="flex-[1_1_6rem]">
          <Link href={`${base}/daily-logs`}>Daily logs</Link>
        </Button>
      </div>
    </div>
  )
}

export function PortfolioPanel({
  jobs,
  unplaced,
  selection,
  onSelectJob,
  onSelectPhase,
  onClear,
}: PortfolioPanelProps): React.ReactElement {
  if (selection.kind === "job") {
    const job = jobs.find((item) => item.id === selection.jobId)
    if (job) return <JobDetail job={job} onClear={onClear} />
  }

  if (selection.kind === "phase") {
    const phase = PORTFOLIO_PHASES.find((item) => item.id === selection.phase)
    const phaseJobs = jobs.filter((job) => job.phase === selection.phase)
    return (
      <div className="flex flex-col gap-4 p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <span className={LABEL}>PHASE · {phaseJobs.length} JOBS</span>
            <h3 className="text-xl font-semibold">{phase?.label}</h3>
          </div>
          <CloseButton onClear={onClear} />
        </div>
        <ul>
          {phaseJobs.map((job) => (
            <li key={job.id}>
              <button type="button" className="flex w-full flex-col gap-2 border-b border-border px-1 py-3 text-left transition-colors hover:bg-accent" onClick={() => onSelectJob(job.id)}>
                <span className="flex w-full justify-between gap-3 text-sm">
                  <span>{job.name}</span>
                  <span className="font-mono text-xs tabular-nums">{job.progress === null ? "—" : `${job.progress}%`}</span>
                </span>
                <span className="block h-1 w-full bg-muted">
                  <span className="block h-1" style={{ width: `${job.progress ?? 0}%`, background: phaseColor(job.phase) }} />
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    )
  }

  const attention = jobs
    .filter((job) => job.health !== "ok")
    .sort((a, b) => Number(b.health === "late") - Number(a.health === "late") || b.pastDueCount - a.pastDueCount)
  return (
    <div className="flex flex-col gap-5 p-5">
      <div className="flex flex-col gap-1">
        <span className={LABEL}>PIPELINE</span>
        <span className="text-sm text-muted-foreground">Select a job on the map, or a phase below.</span>
      </div>
      <ul>
        {PORTFOLIO_PHASES.map((phase) => (
          <li key={phase.id}>
            <button type="button" className={ROW} onClick={() => onSelectPhase(phase.id)}>
              <span className="flex items-center gap-2.5">
                <span className="size-2.5" style={{ background: phaseColor(phase.id) }} aria-hidden="true" />
                {phase.label}
              </span>
              <span className="font-mono text-sm tabular-nums">
                {jobs.filter((job) => job.phase === phase.id).length}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {attention.length > 0 ? (
        <div className="flex flex-col gap-1">
          <span className="font-mono text-xs tracking-[0.12em]" style={{ color: "var(--destructive)" }}>
            ● NEEDS ATTENTION · {attention.length}
          </span>
          <ul>
            {attention.slice(0, 8).map((job) => (
              <li key={job.id}>
                <button type="button" className={ROW} onClick={() => onSelectJob(job.id)}>
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate">{job.name}</span>
                    <span className="font-mono text-xs tracking-[0.08em] text-muted-foreground">
                      {job.town ? job.town.toUpperCase() : "NO TOWN"}
                    </span>
                  </span>
                  <HealthTag job={job} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {unplaced.length > 0 ? (
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer py-1 hover:text-foreground">
            {unplaced.length === 1
              ? "1 job is not on the map yet: it needs a site address with a town."
              : `${unplaced.length} jobs are not on the map yet: they need a site address with a town.`}
          </summary>
          <ul className="mt-1">
            {unplaced.map((job) => (
              <li key={job.id}>
                <Link
                  href={`/dashboard/projects/${encodeURIComponent(job.id)}/information`}
                  className="flex min-h-9 items-center justify-between gap-3 border-b border-border px-1 text-foreground hover:bg-accent"
                >
                  <span className="truncate">{job.name}</span>
                  <span className="shrink-0 font-mono text-muted-foreground">{job.projectNumber ?? "Add address →"}</span>
                </Link>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  )
}
