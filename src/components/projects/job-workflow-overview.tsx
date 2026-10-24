import type { JobWorkflowOverview } from "@/app/actions/job-workflows"
import { JobEmailMenu } from "@/components/projects/job-email-menu"
import { JobWorkflowPanel } from "@/components/projects/job-workflow-panel"

/** A job's department workflow on its overview (departments other than Nu-Tech). */
export function JobWorkflowOverviewPanel({ overview }: { readonly overview: JobWorkflowOverview }): React.ReactElement {
  return (
    <JobWorkflowPanel
      projectId={overview.projectId}
      department={overview.department}
      progress={overview.progress}
      followUp={overview.followUp}
      footer={<JobEmailMenu projectId={overview.projectId} department={overview.department} step={overview.progress.current?.id ?? null} />}
      catchUp={overview.catchUp ? { ...overview.catchUp, jobStatusLabel: overview.jobStatus.label } : null}
      carryover={overview.carryover}
      statusSuggestion={
        overview.suggestedJobStatus ? { current: overview.jobStatus.label, suggested: overview.suggestedJobStatus } : null
      }
    />
  )
}
