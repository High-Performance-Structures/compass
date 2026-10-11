export const dynamic = "force-dynamic"

import { notFound } from "next/navigation"

import { getShopTicketWorkspace } from "@/app/actions/shop-tickets"
import { ShopTicketDocument } from "@/components/projects/shop-ticket-document"
import { ShopTicketPrintButton } from "@/components/projects/shop-ticket-print-button"
import { currentDepartmentProfiles } from "@/lib/department-profiles-server"
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
    <main className="mx-auto max-w-[8.5in] bg-white p-8 text-black print:p-0">
      <style>{"@page { size: letter; margin: 0.5in; }"}</style>
      <div className="mb-6 flex justify-end print:hidden">
        <ShopTicketPrintButton />
      </div>
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
    </main>
  )
}
