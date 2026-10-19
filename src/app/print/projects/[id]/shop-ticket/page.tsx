export const dynamic = "force-dynamic"

import { notFound } from "next/navigation"

import { getShopTicketWorkspace } from "@/app/actions/shop-tickets"
import { ShopTicketDocument } from "@/components/projects/shop-ticket-document"
import { DocumentReportActions } from "@/components/projects/document-report-actions"
import { currentDepartmentProfiles } from "@/lib/department-profiles-server"
import { printPdfHref } from "@/lib/print/print-documents"
import { brandForDepartment } from "@/lib/project-branding"
import { requireProjectRouteId } from "@/lib/project-route-id"

export default async function ShopTicketPrintPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ id: string }>
  readonly searchParams: Promise<{ ticketId?: string }>
}): Promise<React.ReactElement> {
  const [{ id: rawProjectId }, query] = await Promise.all([params, searchParams])
  const id = await requireProjectRouteId(rawProjectId)
  const workspace = await getShopTicketWorkspace(id)
  const ticket = workspace?.tickets.find((item) => item.id === query.ticketId)
  if (!workspace || !ticket) notFound()
  const brand = brandForDepartment(workspace.settings.issuingDepartment, await currentDepartmentProfiles())
  return (
    <>
    <DocumentReportActions
      title={workspace.settings.title}
      documentNumber={ticket.ticketNumber}
      pdfHref={printPdfHref({ projectId: id, document: "shop-ticket", params: { ticketId: ticket.id }, number: ticket.ticketNumber })}
    />
    <main className="mx-auto my-4 max-w-[8.5in] border bg-white p-8 text-black print:my-0 print:border-0 print:p-0">
      <style>{"@page { size: letter; margin: 0.5in; }"}</style>
      <ShopTicketDocument
        brand={brand}
        title={workspace.settings.title}
        subtitle={workspace.settings.subtitle}
        ticket={{
          ...ticket,
          projectNumber: workspace.project.projectNumber,
          clientName: workspace.project.clientName,
          address: workspace.project.address,
        }}
      />
      <span data-print-ready="true" hidden />
    </main>
    </>
  )
}
