export const dynamic = "force-dynamic"

import { notFound } from "next/navigation"
import { IconFileInvoice } from "@tabler/icons-react"

import { getProjectInvoiceEditor } from "@/app/actions/project-invoice-views"
import { InvoiceWorkspace } from "@/components/financials/invoice-workspace"
import { PageHeader } from "@/components/page-header"
import { decodeProjectRouteId } from "@/lib/project-route-id"

export default async function ProjectInvoicePage({
  params,
}: {
  readonly params: Promise<{ id: string; invoiceId: string }>
}): Promise<React.ReactElement> {
  const { id: rawProjectId, invoiceId } = await params
  const id = decodeProjectRouteId(rawProjectId)
  const editor = await getProjectInvoiceEditor(id, invoiceId)
  if (!editor.success) notFound()
  const { project } = editor.data
  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4 md:p-6">
      <PageHeader
        back={{ href: `/dashboard/projects/${id}/financials`, label: "Project financials" }}
        icon={<IconFileInvoice className="size-5 text-primary" />}
        title={project.projectNumber ? `${project.projectNumber} · ${project.name}` : project.name}
      />
      {/* Remount when the saved invoice changes, so the editor starts from what the server saved. */}
      <InvoiceWorkspace key={editor.data.invoice.updatedAt} editor={editor.data} />
    </div>
  )
}
