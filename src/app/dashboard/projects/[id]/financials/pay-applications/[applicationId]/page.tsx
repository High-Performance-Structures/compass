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

export default async function ProjectPayApplicationPage({
  params,
}: {
  readonly params: Promise<{ id: string; applicationId: string }>
}): Promise<React.ReactElement> {
  const { id: rawProjectId, applicationId } = await params
  const id = decodeProjectRouteId(rawProjectId)
  const application = await getProjectOwnerPayApplicationDraft(id, applicationId)
  if (!application) notFound()
  const [shopTickets, receivables] = await Promise.all([
    getPayApplicationShopTickets(id, applicationId).catch(() => null),
    getProjectReceivablePayments(id),
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
      <ProjectOwnerPayApplicationEditor projectId={id} application={application} />
      {showPayments && receivables.success ? (
        <div className="mt-6">
          <ReceivedPaymentsPanel projectId={id} data={receivables.data} applicationId={applicationId} />
        </div>
      ) : null}
      {shopTickets ? <PayApplicationShopTickets projectId={id} data={shopTickets} /> : null}
    </div>
  )
}
