export const dynamic = "force-dynamic"

import { decodeProjectRouteId } from "@/lib/project-route-id"
import { notFound } from "next/navigation"
import { IconFileDollar } from "@tabler/icons-react"

import { getProjectOwnerPayApplicationDraft } from "@/app/actions/project-financial-workflows"
import { getPayApplicationLineChangeOrders } from "@/app/actions/pay-application-line-change-orders"
import { ProjectOwnerPayApplicationEditor } from "@/components/projects/project-owner-pay-application-editor"
import { PageHeader } from "@/components/page-header"
import { getPayApplicationShopTickets } from "@/app/actions/shop-ticket-billing"
import { PayApplicationShopTickets } from "@/components/projects/pay-application-shop-tickets"
import { getProjectReceivablePayments } from "@/app/actions/received-payments"
import { ReceivedPaymentsPanel } from "@/components/financials/received-payments-panel"
import { getSageExportPreview } from "@/app/actions/sage-export-preview"
import { SageExportPreviewDocument } from "@/components/financials/sage-export-preview"
import { PrintPreviewButton } from "@/components/print/print-preview-button"
import { getPayRequestSageState, getSagePayRequestPanel } from "@/app/actions/sage-pay-requests"
import { PayRequestSageSection } from "@/components/financials/pay-request-sage-section"
import { getPayRequestSageInvoiceState } from "@/app/actions/sage-ar-invoices"
import { PayRequestSageInvoice } from "@/components/financials/pay-request-sage-invoice"
import { getPayRequestSageBillingCheck } from "@/app/actions/sage-billing-check"
import { SageBillingCheckSection } from "@/components/financials/sage-billing-check"
import { PayRequestFold } from "@/components/financials/pay-request-fold"
import { PayRequestWorkAreaEmpty } from "@/components/financials/pay-request-work-areas"
import { parsePayRequestWorkArea } from "@/lib/financials/pay-request-work-areas"

export default async function ProjectPayApplicationPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ id: string; applicationId: string }>
  readonly searchParams: Promise<{ readonly work?: string | string[] }>
}): Promise<React.ReactElement> {
  const { id: rawProjectId, applicationId } = await params
  const workArea = parsePayRequestWorkArea((await searchParams).work)
  const id = decodeProjectRouteId(rawProjectId)
  const application = await getProjectOwnerPayApplicationDraft(id, applicationId)
  if (!application) notFound()
  // The Sage export preview is for draws not yet billed (draft or ready); office staff only.
  const showSagePreview = application.status !== "billed"
  const [shopTickets, receivables, sagePreview, sageState, sagePanel, sageInvoice, sageBillingCheck, lineChangeOrders] = await Promise.all([
    getPayApplicationShopTickets(id, applicationId).catch(() => null),
    getProjectReceivablePayments(id),
    showSagePreview ? getSageExportPreview(id, applicationId).catch(() => null) : null,
    getPayRequestSageState(id, applicationId),
    getSagePayRequestPanel(id),
    // Office staff with finance access only; a failure just hides the panel.
    getPayRequestSageInvoiceState(id, applicationId).catch(() => null),
    // Companies whose pay requests are created in Sage; office finance staff only.
    getPayRequestSageBillingCheck(id, applicationId).catch(() => null),
    // Labels only; a failure leaves rows unlabeled.
    getPayApplicationLineChangeOrders(id, applicationId).catch(() => ({})),
  ])
  // Billed amounts synced from Sage are read only here; they change in Sage.
  const sageSynced = application.billingSource === "sage"
  // Payments are recorded once the draw is billed; viewers without financials access don't see the panel.
  const showPayments = receivables.success && application.status === "billed"
  // The Sage area: each part is one line until opened. The two Sage components
  // hide themselves when they don't apply, so the same checks decide here
  // whether the area is empty.
  const showSageSection = sageState !== null && (sageState.origin === "sage" || sageState.link !== null)
  const showSageInvoice = sageInvoice?.success === true && !sageSynced && !(sageInvoice.data.notApplicable && !sageInvoice.data.export)
  const sageArea = [
    showSageSection && sageState ? (
      <PayRequestSageSection
        key="sage"
        projectId={id}
        applicationId={applicationId}
        applicationNumber={application.applicationNumber}
        state={sageState}
        panel={sagePanel}
      />
    ) : null,
    sageBillingCheck?.success ? (
      <SageBillingCheckSection key="check" projectId={id} applicationId={applicationId} view={sageBillingCheck.data} />
    ) : null,
    showSageInvoice && sageInvoice?.success ? (
      <PayRequestSageInvoice key="invoice" projectId={id} applicationId={applicationId} state={sageInvoice.data} />
    ) : null,
    sagePreview?.success && !sageSynced ? (
      <PayRequestFold
        key="preview"
        id={`sage-export-preview-${applicationId}`}
        title="Sage export preview"
        summary={
          sagePreview.data.unmappedCount > 0 || (sagePreview.data.reconciliation.available && sagePreview.data.reconciliation.mismatchCount > 0)
            ? "What would go to Sage (has items to check)"
            : "What would go to Sage, and where Compass and Sage disagree"
        }
      >
        <PrintPreviewButton
          link={{ projectId: id, document: "sage-export-preview", params: { applicationId }, number: `Sage export ${application.applicationNumber}` }}
        />
        <SageExportPreviewDocument preview={sagePreview.data} />
      </PayRequestFold>
    ) : null,
  ]

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4 md:p-6">
      <PageHeader
        back={{ href: `/dashboard/projects/${id}/financials`, label: "Project financials" }}
        icon={<IconFileDollar className="size-5 text-primary" />}
        title="G702 / G703 Pay Application"
      />
      <ProjectOwnerPayApplicationEditor
        projectId={id}
        application={application}
        shopTicketProvenance={shopTickets?.lineProvenance ?? []}
        lineChangeOrders={lineChangeOrders}
        sageSynced={sageSynced}
        initialWorkArea={workArea}
        workAreas={{
          sage: sageArea.some((part) => part !== null) ? (
            sageArea
          ) : (
            <PayRequestWorkAreaEmpty>Nothing from Sage for this pay request.</PayRequestWorkAreaEmpty>
          ),
          payments:
            showPayments && receivables.success ? (
              <ReceivedPaymentsPanel projectId={id} data={receivables.data} applicationId={applicationId} />
            ) : (
              <PayRequestWorkAreaEmpty>
                {application.status === "billed" ? "Payments aren't available to you." : "Payments are recorded once this draw is billed."}
              </PayRequestWorkAreaEmpty>
            ),
          "shop-tickets":
            shopTickets && !sageSynced ? (
              <PayApplicationShopTickets projectId={id} applicationId={applicationId} data={shopTickets} />
            ) : (
              <PayRequestWorkAreaEmpty>
                {sageSynced ? "Shop tickets are billed in Sage for this pay request." : "Shop tickets aren't available to you."}
              </PayRequestWorkAreaEmpty>
            ),
        }}
      />
    </div>
  )
}
