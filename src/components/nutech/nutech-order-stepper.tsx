import Link from "next/link"
import type { NuTechOrderOverview } from "@/app/actions/nutech-order-overview"
import { NuTechEmailMenu } from "@/components/nutech/nutech-email-composer"
import { JobWorkflowPanel } from "@/components/projects/job-workflow-panel"
import { Button } from "@/components/ui/button"
import { isNuTechStepId } from "@/lib/nutech/order-steps"

/**
 * The order process on an N job's overview: the shared job workflow panel
 * with the order link and the Nu-Tech email templates.
 */
export function NuTechOrderStepper({ overview }: { readonly overview: NuTechOrderOverview }): React.ReactElement {
  const { progress, projectId } = overview
  const currentId = progress.current?.id ?? null
  return (
    <JobWorkflowPanel
      projectId={projectId}
      department="N"
      progress={progress}
      cancelledMessage={progress.cancelled ? "This order was cancelled." : null}
      completeMessage="Order complete."
      followUp={overview.followUp}
      headerAction={
        <Button asChild size="sm">
          <Link href={`/dashboard/projects/${encodeURIComponent(projectId)}/nutech`}>{overview.hasOrder ? "Open order" : "Start order"} →</Link>
        </Button>
      }
      footer={
        <NuTechEmailMenu
          projectId={projectId}
          step={currentId !== null && isNuTechStepId(currentId) ? currentId : null}
          fulfillment={overview.fulfillment}
        />
      }
    />
  )
}
