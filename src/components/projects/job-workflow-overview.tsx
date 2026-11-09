import type { JobWorkflowOverview } from "@/app/actions/job-workflows"
import { JobChecklistEmailAction, JobEmailMenu } from "@/components/projects/job-email-menu"
import { JobWorkflowPanel } from "@/components/projects/job-workflow-panel"
import { REQUEST_COI_TEMPLATE, SEND_W9_TEMPLATE } from "@/lib/job-workflows/email-delivery"

/** A job's department workflow on its overview (departments other than Nu-Tech). */
export function JobWorkflowOverviewPanel({ overview }: { readonly overview: JobWorkflowOverview }): React.ReactElement {
  return (
    <JobWorkflowPanel
      projectId={overview.projectId}
      department={overview.department}
      progress={overview.progress}
      followUp={overview.followUp}
      itemActions={overview.department === "H" ? {
        "agreement.coi": (
          <JobChecklistEmailAction projectId={overview.projectId} department={overview.department} templateId={REQUEST_COI_TEMPLATE} variant="outline" />
        ),
        "agreement.w9": (
          <JobChecklistEmailAction projectId={overview.projectId} department={overview.department} templateId={SEND_W9_TEMPLATE} variant="link" />
        ),
      } : undefined}
      footer={<JobEmailMenu projectId={overview.projectId} department={overview.department} step={overview.progress.current?.id ?? null} />}
      catchUp={overview.catchUp ? { ...overview.catchUp, jobStatusLabel: overview.jobStatus.label } : null}
      carryover={overview.carryover}
      statusSuggestion={
        overview.suggestedJobStatus ? { current: overview.jobStatus.label, suggested: overview.suggestedJobStatus } : null
      }
    />
  )
}
