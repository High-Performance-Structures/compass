"use client"

import * as React from "react"
import Link from "next/link"
import { updateProjectDeliveryMethod, updateProjectJobStatus } from "@/app/actions/project-profile"
import { PROJECT_JOB_STATUS_DEFINITIONS } from "@/lib/project-profile"
import type { SalesPipeline, SalesPipelineJob } from "@/lib/sales-pipeline/load"
import {
  SALES_STAGES,
  salesStageColor,
  salesStageForJobStatus,
  type DeliveryMethod,
} from "@/lib/sales-pipeline/stages"
import { cn } from "@/lib/utils"

const STATUS_LABEL: ReadonlyMap<string, string> = new Map(
  PROJECT_JOB_STATUS_DEFINITIONS.map((status) => [status.id, status.label]),
)

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

/**
 * A material-sales pipeline (Nu-Tech Sales): one column per stage. Selecting
 * a job opens its panel, where one click moves it to another stage or sets
 * delivery or customer pickup. Changes save immediately and are audited.
 */
export function SalesPipelineSection({ pipeline }: { readonly pipeline: SalesPipeline }): React.ReactElement {
  const [jobs, setJobs] = React.useState<readonly SalesPipelineJob[]>(pipeline.jobs)
  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [saving, startSaving] = React.useTransition()
  React.useEffect(() => setJobs(pipeline.jobs), [pipeline.jobs])

  const selected = jobs.find((job) => job.id === selectedId) ?? null
  const headingId = `sales-pipeline-${pipeline.department}`

  const patch = (jobId: string, next: Partial<SalesPipelineJob>): void => {
    setJobs((current) => current.map((job) => (job.id === jobId ? { ...job, ...next } : job)))
  }

  const moveTo = (job: SalesPipelineJob, jobStatusId: string): void => {
    const stage = salesStageForJobStatus(jobStatusId)
    if (!stage || jobStatusId === job.jobStatusId) return
    const before = job
    patch(job.id, { jobStatusId, stage, statusLabel: STATUS_LABEL.get(jobStatusId) ?? jobStatusId })
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

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline gap-3">
        <h2 id={headingId} className="text-lg font-semibold">{pipeline.title}</h2>
        <span className="font-mono text-xs tracking-[0.12em] text-muted-foreground">
          {jobs.length} OPEN · {jobs.filter((job) => job.stage === "awaiting_payment").length} AWAITING PAYMENT ·{" "}
          {jobs.filter((job) => job.stage === "ordered").length} ORDERED
        </span>
      </div>
      <div className="flex flex-wrap border border-border">
        <div className="h-[30rem] min-w-0 flex-[999_1_40rem] overflow-auto bg-card">
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
                          onClick={() => setSelectedId(job.id === selectedId ? null : job.id)}
                          className={cn(
                            "flex w-full flex-col gap-0.5 border-b border-border px-3 py-2.5 text-left transition-colors hover:bg-accent",
                            job.id === selectedId && "bg-accent",
                          )}
                        >
                          <span className="truncate text-xs">{job.name}</span>
                          <span className="truncate font-mono text-xs tracking-[0.08em] text-muted-foreground">
                            {[job.projectNumber, job.town?.toUpperCase()].filter(Boolean).join(" · ") || "NO TOWN"}
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
        <aside
          aria-label={`${pipeline.title} job details`}
          className="max-h-[30rem] min-w-0 flex-[1_1_20rem] overflow-y-auto border-l border-border bg-card p-4"
        >
          {selected ? (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1">
                <span className="font-mono text-xs tracking-[0.12em] text-muted-foreground">
                  {selected.projectNumber ?? "NO NUMBER"}
                </span>
                <h3 className="text-base font-semibold">{selected.name}</h3>
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                  <dt className="text-muted-foreground">Customer</dt>
                  <dd>{selected.clientName ?? "—"}</dd>
                  <dt className="text-muted-foreground">Assigned</dt>
                  <dd>{selected.assignedTo ?? "—"}</dd>
                  <dt className="text-muted-foreground">Delivery location</dt>
                  <dd>{selected.address ?? "Needs a project address"}</dd>
                  {dateLabel(selected.updatedAt) ? (
                    <>
                      <dt className="text-muted-foreground">Updated</dt>
                      <dd>{dateLabel(selected.updatedAt)}</dd>
                    </>
                  ) : null}
                </dl>
                <Link
                  href={`/dashboard/projects/${encodeURIComponent(selected.id)}`}
                  className="text-sm text-primary underline-offset-4 hover:underline"
                >
                  Open job
                </Link>
              </div>

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

              <fieldset className="flex flex-col gap-2" disabled={saving}>
                <legend className="mb-1 font-mono text-xs tracking-[0.12em] text-muted-foreground">MOVE TO</legend>
                {SALES_STAGES.map((stage) => (
                  <div key={stage.id} className="flex flex-col gap-1">
                    <span className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span className="size-2" style={{ background: salesStageColor(stage.id) }} aria-hidden="true" />
                      {stage.label}
                    </span>
                    <div className="flex flex-wrap gap-1 pl-4">
                      {stage.statuses.map((status) => (
                        <button
                          key={status}
                          type="button"
                          aria-pressed={selected.jobStatusId === status}
                          onClick={() => moveTo(selected, status)}
                          className={cn(
                            "min-h-7 border border-border px-2 text-xs transition-colors disabled:opacity-50",
                            selected.jobStatusId === status ? "bg-foreground text-background" : "hover:bg-accent",
                          )}
                        >
                          {STATUS_LABEL.get(status) ?? status}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
                <p className="text-xs text-muted-foreground">
                  To close a job (complete, inactive, or bid refused), change its status on the job page.
                </p>
              </fieldset>
              {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Select a job to move it to another stage or set delivery or customer pickup.
            </p>
          )}
        </aside>
      </div>
    </section>
  )
}
