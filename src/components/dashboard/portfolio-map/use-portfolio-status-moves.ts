"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { updateProjectJobStatus } from "@/app/actions/project-profile"
import { jobStatusLabel } from "@/components/dashboard/portfolio-map/portfolio-job-actions"
import type { PortfolioStatusMove } from "@/components/dashboard/portfolio-map/portfolio-panel"
import { phaseForJobStatus, type PortfolioMapJob } from "@/lib/portfolio-map/model"

type StatusOverride = Pick<PortfolioMapJob, "jobStatusId" | "statusLabel" | "phase">

/**
 * Status moves from the map panel. The job shows its new status and phase at
 * once (the map recolors, the pipeline regroups); the save runs in the
 * background, is audited by the action, and a failure puts the job back.
 */
export function usePortfolioStatusMoves(jobs: readonly PortfolioMapJob[]): {
  readonly jobs: readonly PortfolioMapJob[]
  readonly statusMove: PortfolioStatusMove
} {
  const router = useRouter()
  const [overrides, setOverrides] = React.useState<ReadonlyMap<string, StatusOverride>>(new Map())
  const [error, setError] = React.useState<string | null>(null)
  const [pending, startSaving] = React.useTransition()
  // Fresh server data already carries the saved statuses.
  React.useEffect(() => setOverrides(new Map()), [jobs])

  const shownJobs = React.useMemo(
    () =>
      overrides.size === 0
        ? jobs
        : jobs.map((job) => {
            const override = overrides.get(job.id)
            return override ? { ...job, ...override } : job
          }),
    [jobs, overrides],
  )

  const onMove = React.useCallback(
    (job: PortfolioMapJob, statusId: string): void => {
      if (statusId === job.jobStatusId) return
      const statusLabel = jobStatusLabel(statusId)
      const phase = phaseForJobStatus(statusId, statusLabel) ?? job.phase
      setOverrides((current) => new Map(current).set(job.id, { jobStatusId: statusId, statusLabel, phase }))
      setError(null)
      startSaving(async () => {
        const result = await updateProjectJobStatus({ projectId: job.id, jobStatusId: statusId })
        if (!result.success) {
          setOverrides((current) => {
            const next = new Map(current)
            next.delete(job.id)
            return next
          })
          setError(result.error)
          return
        }
        router.refresh()
      })
    },
    [router],
  )

  const statusMove = React.useMemo<PortfolioStatusMove>(() => ({ pending, error, onMove }), [error, onMove, pending])
  return { jobs: shownJobs, statusMove }
}
