export const dynamic = "force-dynamic"

import { decodeProjectRouteId } from "@/lib/project-route-id"
import { notFound } from "next/navigation"
import { IconFileDollar } from "@tabler/icons-react"

import { getProjectOwnerPayApplicationDraft } from "@/app/actions/project-financial-workflows"
import { ProjectOwnerPayApplicationEditor } from "@/components/projects/project-owner-pay-application-editor"
import { PageHeader } from "@/components/page-header"
import { getPayApplicationShopTickets } from "@/app/actions/shop-ticket-billing"
import { PayApplicationShopTickets } from "@/components/projects/pay-application-shop-tickets"
import { getProjectReceivablePayments } from "@/app/actions/received-payments"
import { ReceivedPaymentsPanel } from "@/components/financials/received-payments-panel"
import { getSageExportPreview } from "@/app/actions/sage-export-preview"
import { SageExportPreviewDocument } from "@/components/financials/sage-export-preview"
import { PrintPreviewButton } from "@/components/print/print-preview-button"

export default async function ProjectPayApplicationPage({
  params,
}: {
  readonly params: Promise<{ id: string; applicationId: string }>
}): Promise<React.ReactElement> {
  const { id: rawProjectId, applicationId } = await params
  const id = decodeProjectRouteId(rawProjectId)
  const application = await getProjectOwnerPayApplicationDraft(id, applicationId)
  if (!application) notFound()
  // The Sage export preview is for draws not yet billed (draft or ready); office staff only.
  const showSagePreview = application.status !== "billed"
  const [shopTickets, receivables, sagePreview] = await Promise.all([
    getPayApplicationShopTickets(id, applicationId).catch(() => null),
    getProjectReceivablePayments(id),
    showSagePreview ? getSageExportPreview(id, applicationId).catch(() => null) : null,
  ])
  // Payments are recorded once the draw is billed; viewers without financials access don't see the panel.
  const showPayments = receivables.success && application.status === "billed"

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4 md:p-6">
      <PageHeader
        back={{ href: `/dashboard/projects/${id}/financials`, label: "Project financials" }}
        icon={<IconFileDollar className="size-5 text-primary" />}
        title="G702 / G703 Pay Application"
      />
      <ProjectOwnerPayApplicationEditor projectId={id} application={application} shopTicketProvenance={shopTickets?.lineProvenance ?? []} />
      {showPayments && receivables.success ? (
        <div className="mt-6">
          <ReceivedPaymentsPanel projectId={id} data={receivables.data} applicationId={applicationId} />
        </div>
      ) : null}
      {sagePreview?.success ? (
        <details className="mt-6 rounded-lg border p-4">
          <summary className="cursor-pointer text-base font-semibold">
            Sage export preview
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              What would go to Sage, and where Compass and Sage disagree
              {sagePreview.data.unmappedCount > 0 || (sagePreview.data.reconciliation.available && sagePreview.data.reconciliation.mismatchCount > 0)
                ? " (has items to check)"
                : ""}
            </span>
          </summary>
          <div className="mt-4 space-y-4">
            <PrintPreviewButton
              link={{ projectId: id, document: "sage-export-preview", params: { applicationId }, number: `Sage export ${application.applicationNumber}` }}
            />
            <SageExportPreviewDocument preview={sagePreview.data} />
          </div>
        </details>
      ) : null}
      {shopTickets ? <PayApplicationShopTickets projectId={id} applicationId={applicationId} data={shopTickets} /> : null}
    </div>
  )
}
