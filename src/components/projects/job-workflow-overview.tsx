import type { JobWorkflowOverview } from "@/app/actions/job-workflows"
import { JobWorkflowPanel } from "@/components/projects/job-workflow-panel"

/** A job's department workflow on its overview (departments other than Nu-Tech). */
export function JobWorkflowOverviewPanel({ overview }: { readonly overview: JobWorkflowOverview }): React.ReactElement {
  return (
    <JobWorkflowPanel
      projectId={overview.projectId}
      department={overview.department}
      progress={overview.progress}
      followUp={overview.followUp}
      catchUp={overview.catchUp ? { ...overview.catchUp, jobStatusLabel: overview.jobStatus.label } : null}
      statusSuggestion={
        overview.suggestedJobStatus ? { current: overview.jobStatus.label, suggested: overview.suggestedJobStatus } : null
      }
    />
  )
}
