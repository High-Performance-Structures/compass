"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { IconCheck } from "@tabler/icons-react"
import { toast } from "sonner"
import { carryOverLinkedJobWorkflows, catchUpJobWorkflow, setJobWorkflowCheck } from "@/app/actions/job-workflows"
import { updateProjectJobStatus } from "@/app/actions/project-profile"
import { useDepartmentProfiles } from "@/components/branding/department-profiles-provider"
import { FollowUpSection } from "@/components/projects/project-follow-up-aging"
import { Button } from "@/components/ui/button"
import type { WorkflowItem, WorkflowProgress } from "@/lib/job-workflows/engine"
import type { ProjectDepartment } from "@/lib/project-branding"
import type { ProjectFollowUpSignal } from "@/lib/project-follow-up"
import { cn } from "@/lib/utils"

type StatusSuggestion = {
  readonly current: string
  readonly suggested: { readonly id: string; readonly label: string }
}

function checkedNote(item: WorkflowItem): string | null {
  if (item.source !== "tick" || !item.check) return null
  const date = new Date(item.check.checkedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })
  const note = item.check.checkedByName ? `${item.check.checkedByName}, ${date}` : date
  return item.check.carriedFromNumber ? `${note} · carried from ${item.check.carriedFromNumber}` : note
}

/**
 * A job's department workflow on its overview: the steps, the next thing to
 * do, and the current step's checklist (any step's, when picked, to undo a
 * mistaken tick). Items Compass records link to where
 * they are filled in; the rest are ticked here.
 */
export function JobWorkflowPanel({
  projectId,
  department,
  progress,
  cancelledMessage = null,
  completeMessage = "All steps are done.",
  headerAction = null,
  footer = null,
  followUp,
  statusSuggestion = null,
  catchUp = null,
  carryover = null,
}: {
  readonly projectId: string
  readonly department: ProjectDepartment
  readonly progress: WorkflowProgress
  /** Shown instead of the next action when the process was cancelled. */
  readonly cancelledMessage?: string | null
  readonly completeMessage?: string
  readonly headerAction?: React.ReactNode
  readonly footer?: React.ReactNode
  readonly followUp: ProjectFollowUpSignal | null
  readonly statusSuggestion?: StatusSuggestion | null
  /** The job's status is ahead of its checklist: offer to tick the earlier steps. */
  readonly catchUp?: { readonly jobStatusLabel: string; readonly stepLabel: string; readonly itemCount: number } | null
  /** Linked jobs completed items this job hasn't ticked: offer to carry them over. */
  readonly carryover?: { readonly itemCount: number } | null
}): React.ReactElement {
  const router = useRouter()
  const profiles = useDepartmentProfiles()
  const [pendingKey, setPendingKey] = React.useState<string | null>(null)
  const [optimistic, setOptimistic] = React.useState<ReadonlyMap<string, boolean>>(new Map())
  const [statusPending, startStatus] = React.useTransition()
  const base = `/dashboard/projects/${encodeURIComponent(projectId)}`
  const current = progress.current
  // The step whose checklist is open: the current one unless someone picked another.
  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const shown = progress.steps.find((step) => step.id === selectedId) ?? current ?? null
  const reviewing = shown !== null && shown.id !== current?.id
  const headingId = `job-workflow-${department}`
  const heading = `${profiles[department].shortName} ${progress.title}`.toUpperCase()

  // Server data replaces optimistic ticks once the page refreshes.
  React.useEffect(() => setOptimistic(new Map()), [progress])

  function toggle(item: WorkflowItem): void {
    const checked = !(optimistic.get(item.key) ?? item.done)
    setPendingKey(item.key)
    setOptimistic((map) => new Map(map).set(item.key, checked))
    void setJobWorkflowCheck({ projectId, itemKey: item.key, checked }).then((result) => {
      setPendingKey(null)
      if (!result.success) {
        setOptimistic((map) => {
          const next = new Map(map)
          next.delete(item.key)
          return next
        })
        toast.error(result.error)
        return
      }
      router.refresh()
    })
  }

  function applyCatchUp(): void {
    startStatus(async () => {
      const result = await catchUpJobWorkflow(projectId)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success(`Marked ${result.data.ticked} earlier item${result.data.ticked === 1 ? "" : "s"} done.`)
      router.refresh()
    })
  }

  function applyCarryover(): void {
    startStatus(async () => {
      const result = await carryOverLinkedJobWorkflows(projectId)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success(`Carried over ${result.data.ticked} item${result.data.ticked === 1 ? "" : "s"} from linked jobs.`)
      router.refresh()
    })
  }

  function applyStatus(suggestion: StatusSuggestion): void {
    startStatus(async () => {
      const result = await updateProjectJobStatus({ projectId, jobStatusId: suggestion.suggested.id })
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success(`Job status set to ${suggestion.suggested.label}.`)
      router.refresh()
    })
  }

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-4 rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 id={headingId} className="font-mono text-xs tracking-[0.12em] text-muted-foreground">
            {heading}
          </h2>
          <p className="text-base font-semibold">
            {cancelledMessage ?? (current ? `${current.label}: ${progress.nextAction ?? "Review this step."}` : completeMessage)}
          </p>
        </div>
        {headerAction}
      </div>

      <ol className="flex flex-wrap gap-x-1 gap-y-2" aria-label="Steps">
        {progress.steps.map((step, index) => (
          <li key={step.id} className="flex items-center gap-1">
            <button
              type="button"
              aria-current={step.state === "current" ? "step" : undefined}
              aria-pressed={shown?.id === step.id}
              onClick={() => setSelectedId(step.id === current?.id ? null : step.id)}
              className={cn(
                "flex items-center gap-1.5 border px-2 py-1 font-mono text-xs tracking-[0.06em] transition-colors",
                step.state === "done" && "border-transparent text-muted-foreground hover:border-border",
                step.state === "current" && "border-primary bg-primary text-primary-foreground",
                step.state === "upcoming" && "border-border text-muted-foreground hover:text-foreground",
                shown?.id === step.id && step.state !== "current" && "border-foreground text-foreground",
              )}
            >
              {step.state === "done" ? <IconCheck className="size-3" aria-hidden="true" /> : null}
              {step.label.toUpperCase()}
              <span className="sr-only">{step.state === "done" ? " (done)" : step.state === "current" ? " (current)" : ""}</span>
            </button>
            {index < progress.steps.length - 1 ? <span className="text-muted-foreground" aria-hidden="true">·</span> : null}
          </li>
        ))}
      </ol>

      {reviewing && shown ? (
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <span>
            Showing {shown.label}. Untick anything checked by mistake; recorded items follow the job&apos;s records.
          </span>
          {current ? (
            <Button type="button" size="sm" variant="ghost" onClick={() => setSelectedId(null)}>
              Back to {current.label}
            </Button>
          ) : null}
        </div>
      ) : null}

      {shown && !cancelledMessage ? (
        <ul className="flex flex-col" aria-label={`${shown.label} checklist`}>
          {shown.items.map((item) => {
            const done = optimistic.get(item.key) ?? item.done
            const note = checkedNote(item)
            const box = (
              <span
                className={cn(
                  "flex size-4 shrink-0 items-center justify-center border",
                  done ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground",
                )}
                aria-hidden="true"
              >
                {done ? <IconCheck className="size-3" /> : null}
              </span>
            )
            return (
              <li key={item.key} className="flex min-h-10 items-center gap-3 border-b px-1 text-sm">
                {item.tickable && item.source !== "record" ? (
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={done}
                    aria-label={item.label}
                    disabled={pendingKey === item.key}
                    onClick={() => toggle(item)}
                    className="-m-2 p-2 disabled:opacity-50"
                  >
                    {box}
                  </button>
                ) : (
                  box
                )}
                {item.path ? (
                  <Link href={`${base}/${item.path}`} className={cn("flex-1 hover:underline", done && "text-muted-foreground line-through")}>
                    {item.label}
                  </Link>
                ) : (
                  <span className={cn("flex-1", done && "text-muted-foreground line-through")}>{item.label}</span>
                )}
                <span className="text-xs text-muted-foreground">
                  {note ?? (item.source === "record" ? "Recorded" : item.path && !done ? <Link href={`${base}/${item.path}`}>Open →</Link> : null)}
                </span>
              </li>
            )
          })}
        </ul>
      ) : null}

      {catchUp && !cancelledMessage ? (
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <span>
            Job status is {catchUp.jobStatusLabel}, ahead of this checklist. If the earlier steps are behind you, mark their {catchUp.itemCount} open
            item{catchUp.itemCount === 1 ? "" : "s"} done in one click; you can untick any of them afterwards.
          </span>
          <Button type="button" size="sm" variant="outline" disabled={statusPending} onClick={applyCatchUp}>
            Mark steps before {catchUp.stepLabel} done
          </Button>
        </div>
      ) : null}

      {carryover && !cancelledMessage ? (
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <span>
            A linked job already completed {carryover.itemCount} item{carryover.itemCount === 1 ? "" : "s"} on this checklist. Carry them
            over with who did them and when; you can untick any afterwards.
          </span>
          <Button type="button" size="sm" variant="outline" disabled={statusPending} onClick={applyCarryover}>
            Carry over from linked jobs
          </Button>
        </div>
      ) : null}

      {statusSuggestion && !cancelledMessage ? (
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <span>
            Job status is {statusSuggestion.current}; this step usually goes with {statusSuggestion.suggested.label}.
          </span>
          <Button type="button" size="sm" variant="outline" disabled={statusPending} onClick={() => applyStatus(statusSuggestion)}>
            Set to {statusSuggestion.suggested.label}
          </Button>
        </div>
      ) : null}

      {footer ? <div className="border-t pt-3">{footer}</div> : null}

      {followUp ? (
        <div className="border-t pt-3">
          <FollowUpSection projectId={projectId} signal={followUp} compact />
        </div>
      ) : null}
    </section>
  )
}
