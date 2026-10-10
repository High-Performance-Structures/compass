"use client"

import * as React from "react"
import { updateProjectDeliveryMethod, updateProjectJobStatus } from "@/app/actions/project-profile"
import {
  CloseButton,
  JobLinks,
  StatusMovePicker,
  jobStatusLabel,
  type StatusMoveGroup,
} from "@/components/dashboard/portfolio-map/portfolio-job-actions"
import type { SalesPipeline, SalesPipelineJob } from "@/lib/sales-pipeline/load"
import {
  SALES_STAGES,
  salesStageColor,
  salesStageForJobStatus,
  type DeliveryMethod,
  type SalesStageId,
} from "@/lib/sales-pipeline/stages"
import { FollowUpChip, FollowUpSection } from "@/components/projects/project-follow-up-aging"
import { needsFollowUp } from "@/lib/project-follow-up"
import { cn } from "@/lib/utils"

const STAGE_MOVE_GROUPS: readonly StatusMoveGroup[] = SALES_STAGES.map((stage) => ({
  id: stage.id,
  label: stage.label,
  color: salesStageColor(stage.id),
  statuses: stage.statuses,
}))

const LABEL = "font-mono text-xs tracking-[0.12em] text-muted-foreground"
const ROW = "flex min-h-11 w-full items-center justify-between gap-3 border-b border-border px-1 text-left text-sm transition-colors hover:bg-accent"

const DELIVERY_OPTIONS: readonly { readonly value: DeliveryMethod | null; readonly label: string }[] = [
  { value: "delivery", label: "Delivery" },
  { value: "pickup", label: "Customer pickup" },
  { value: null, label: "Not set" },
]

function dateLabel(value: string | null): string | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? null
    : date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}

/** Header counts for a sales pipeline, shown where the portfolio counts are. */
export function salesPipelineSummary(jobs: readonly SalesPipelineJob[]): string {
  const awaiting = jobs.filter((job) => job.stage === "awaiting_payment").length
  const ordered = jobs.filter((job) => job.stage === "ordered").length
  return `${jobs.length} OPEN · ${awaiting} AWAITING PAYMENT · ${ordered} ORDERED`
}

export type SalesPipelineState = {
  readonly jobs: readonly SalesPipelineJob[]
  readonly selected: SalesPipelineJob | null
  readonly select: (jobId: string | null) => void
  /** A stage picked in the panel's stage list, when no job is selected. */
  readonly stage: SalesStageId | null
  readonly selectStage: (stage: SalesStageId | null) => void
  readonly moveTo: (job: SalesPipelineJob, jobStatusId: string) => void
  readonly setDelivery: (job: SalesPipelineJob, deliveryMethod: DeliveryMethod | null) => void
  readonly saving: boolean
  readonly error: string | null
}

/**
 * A material-sales pipeline's jobs and selection, shared by its map and its
 * stage board. Moves and delivery changes show at once and save in the
 * background (audited); a failed save puts the job back.
 */
export function useSalesPipeline(pipeline: SalesPipeline | null): SalesPipelineState {
  const pipelineJobs = pipeline?.jobs
  const [jobs, setJobs] = React.useState<readonly SalesPipelineJob[]>(pipelineJobs ?? [])
  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const [stage, setStage] = React.useState<SalesStageId | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [saving, startSaving] = React.useTransition()
  React.useEffect(() => setJobs(pipelineJobs ?? []), [pipelineJobs])

  const patch = (jobId: string, next: Partial<SalesPipelineJob>): void => {
    setJobs((current) => current.map((job) => (job.id === jobId ? { ...job, ...next } : job)))
  }

  const moveTo = (job: SalesPipelineJob, jobStatusId: string): void => {
    const stage = salesStageForJobStatus(jobStatusId)
    if (!stage || jobStatusId === job.jobStatusId) return
    const before = job
    patch(job.id, { jobStatusId, stage, statusLabel: jobStatusLabel(jobStatusId) })
    setError(null)
    startSaving(async () => {
      const result = await updateProjectJobStatus({ projectId: job.id, jobStatusId })
      if (!result.success) {
        patch(job.id, before)
        setError(result.error)
      }
    })
  }

  const setDelivery = (job: SalesPipelineJob, deliveryMethod: DeliveryMethod | null): void => {
    if (deliveryMethod === job.deliveryMethod) return
    const before = job.deliveryMethod
    patch(job.id, { deliveryMethod })
    setError(null)
    startSaving(async () => {
      const result = await updateProjectDeliveryMethod({ projectId: job.id, deliveryMethod })
      if (!result.success) {
        patch(job.id, { deliveryMethod: before })
        setError(result.error)
      }
    })
  }

  const select = React.useCallback((jobId: string | null): void => setSelectedId(jobId), [])
  const selected = jobs.find((job) => job.id === selectedId) ?? null
  const selectStage = React.useCallback((next: SalesStageId | null): void => {
    setSelectedId(null)
    setStage(next)
  }, [])
  return { jobs, selected, select, stage, selectStage, moveTo, setDelivery, saving, error }
}

/** One column per sales stage; selecting a job opens it in the panel. */
export function SalesPipelineColumns({ state }: { readonly state: SalesPipelineState }): React.ReactElement {
  const { jobs, selected, select } = state
  const selectedId = selected?.id ?? null
  return (
    <div className="h-full overflow-auto bg-card">
      <ol className="grid min-h-full min-w-[64rem] grid-cols-8">
        {SALES_STAGES.map((stage) => {
          const stageJobs = jobs.filter((job) => job.stage === stage.id)
          return (
            <li key={stage.id} className="flex flex-col border-r border-border last:border-r-0">
              <div className="flex min-h-12 items-center justify-between gap-2 border-b border-border px-3">
                <span className="flex items-center gap-2 font-mono text-xs tracking-[0.12em]">
                  <span className="size-2" style={{ background: salesStageColor(stage.id) }} aria-hidden="true" />
                  {stage.label.toUpperCase()}
                </span>
                <span className="font-mono text-xs tabular-nums">{stageJobs.length}</span>
              </div>
              <ul className="flex flex-col">
                {stageJobs.map((job) => (
                  <li key={job.id}>
                    <button
                      type="button"
                      aria-pressed={job.id === selectedId}
                      onClick={() => select(job.id === selectedId ? null : job.id)}
                      className={cn(
                        "flex w-full flex-col gap-0.5 border-b border-border px-3 py-2.5 text-left transition-colors hover:bg-accent",
                        job.id === selectedId && "bg-accent",
                      )}
                    >
                      <span className="truncate text-xs">{job.name}</span>
                      <span className="truncate font-mono text-xs tracking-[0.08em] text-muted-foreground">
                        {[job.projectNumber, job.town?.toUpperCase()].filter(Boolean).join(" · ") || "NO TOWN"}
                      </span>
                      <span className="flex">
                        <FollowUpChip signal={job.followUp} />
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

/**
 * The sales panel beside the map or board, laid out like the project panel:
 * the stage list, a stage's jobs, or the selected job with its links,
 * delivery or pickup, and one-click status moves.
 */
export function SalesJobPanel({ state, title }: { readonly state: SalesPipelineState; readonly title: string }): React.ReactElement {
  const { jobs, selected, select, stage, selectStage, saving, error, moveTo, setDelivery } = state

  if (selected) {
    const stageLabel = SALES_STAGES.find((item) => item.id === selected.stage)?.label ?? selected.statusLabel
    const updated = dateLabel(selected.updatedAt)
    return (
      <div aria-label={`${title} job details`} className="flex flex-col gap-5 p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            {selected.projectNumber ? <span className={LABEL}>{selected.projectNumber}</span> : null}
            <h3 className="text-xl font-semibold leading-tight">{selected.name}</h3>
            <span className="text-sm text-muted-foreground">{selected.town ? `${selected.town}, CO` : "Town not set"}</span>
          </div>
          <CloseButton onClear={() => select(null)} />
        </div>
        <span
          className="self-start border px-1.5 py-0.5 font-mono text-xs tracking-[0.1em]"
          style={{ borderColor: salesStageColor(selected.stage), color: salesStageColor(selected.stage) }}
        >
          {stageLabel.toUpperCase()}
        </span>
        {selected.followUp ? <FollowUpSection projectId={selected.id} signal={selected.followUp} compact /> : null}
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          <dt className="text-muted-foreground">Status</dt>
          <dd className="text-right">{selected.statusLabel}</dd>
          <dt className="text-muted-foreground">Customer</dt>
          <dd className="text-right">{selected.clientName ?? "—"}</dd>
          <dt className="text-muted-foreground">Assigned</dt>
          <dd className="text-right">{selected.assignedTo ?? "—"}</dd>
          <dt className="text-muted-foreground">Delivery location</dt>
          <dd className="text-right">{selected.address ?? "Needs a project address"}</dd>
          {updated ? (
            <>
              <dt className="text-muted-foreground">Updated</dt>
              <dd className="text-right">{updated}</dd>
            </>
          ) : null}
        </dl>
        <JobLinks jobId={selected.id} links={[["Information", "information"]]} />
        <fieldset className="flex flex-col gap-2" disabled={saving}>
          <legend className="mb-1 font-mono text-xs tracking-[0.12em] text-muted-foreground">DELIVERY</legend>
          <div role="group" aria-label="Delivery method" className="flex flex-wrap border border-border">
            {DELIVERY_OPTIONS.map((option) => (
              <button
                key={option.label}
                type="button"
                aria-pressed={selected.deliveryMethod === option.value}
                onClick={() => setDelivery(selected, option.value)}
                className={cn(
                  "min-h-8 flex-1 px-3 text-xs transition-colors disabled:opacity-50",
                  selected.deliveryMethod === option.value ? "bg-foreground text-background" : "hover:bg-accent",
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        </fieldset>
        <StatusMovePicker
          groups={STAGE_MOVE_GROUPS}
          currentStatusId={selected.jobStatusId}
          disabled={saving}
          error={error}
          onMove={(statusId) => moveTo(selected, statusId)}
        />
      </div>
    )
  }

  if (stage) {
    const stageInfo = SALES_STAGES.find((item) => item.id === stage)
    const stageJobs = jobs.filter((job) => job.stage === stage)
    return (
      <div className="flex flex-col gap-4 p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <span className={LABEL}>STAGE · {stageJobs.length} JOBS</span>
            <h3 className="text-xl font-semibold">{stageInfo?.label}</h3>
          </div>
          <CloseButton onClear={() => selectStage(null)} />
        </div>
        <ul>
          {stageJobs.map((job) => (
            <li key={job.id}>
              <button type="button" className={ROW} onClick={() => select(job.id)}>
                <span className="flex min-w-0 flex-col">
                  <span className="truncate">{job.name}</span>
                  <span className="font-mono text-xs tracking-[0.08em] text-muted-foreground">
                    {[job.projectNumber, job.town?.toUpperCase()].filter(Boolean).join(" · ") || "NO TOWN"}
                  </span>
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">{job.statusLabel}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    )
  }

  const unplaced = jobs.filter((job) => job.lon === null || job.lat === null).length
  const attention = jobs
    .filter((job) => needsFollowUp(job.followUp))
    .sort(
      (a, b) =>
        Number(b.followUp?.level === "overdue") - Number(a.followUp?.level === "overdue") ||
        (b.followUp?.businessDaysSinceLastTouch ?? 0) - (a.followUp?.businessDaysSinceLastTouch ?? 0),
    )
  return (
    <div className="flex flex-col gap-5 p-5">
      <div className="flex flex-col gap-1">
        <span className={LABEL}>{title.toUpperCase()}</span>
        <span className="text-sm text-muted-foreground">Select a job on the map, or a stage below.</span>
      </div>
      <ul>
        {SALES_STAGES.map((item) => (
          <li key={item.id}>
            <button type="button" className={ROW} onClick={() => selectStage(item.id)}>
              <span className="flex items-center gap-2.5">
                <span className="size-2.5" style={{ background: salesStageColor(item.id) }} aria-hidden="true" />
                {item.label}
              </span>
              <span className="font-mono text-sm tabular-nums">
                {jobs.filter((job) => job.stage === item.id).length}
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
                <button type="button" className={ROW} onClick={() => select(job.id)}>
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate">{job.name}</span>
                    <span className="font-mono text-xs tracking-[0.08em] text-muted-foreground">
                      {job.town ? job.town.toUpperCase() : "NO TOWN"}
                    </span>
                  </span>
                  <FollowUpChip signal={job.followUp} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {unplaced > 0 ? (
        <p className="text-xs text-muted-foreground">
          {unplaced === 1
            ? "1 job is not on the map yet: it needs a site address with a town."
            : `${unplaced} jobs are not on the map yet: they need a site address with a town.`}
        </p>
      ) : null}
    </div>
  )
}
