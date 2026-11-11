export const dynamic = "force-dynamic"

import { notFound } from "next/navigation"

import { PrintSourceMode } from "@/components/print/print-source-mode"
import { BtProposalDocument } from "@/components/projects/bt-proposal-document"
import { DocumentReportActions } from "@/components/projects/document-report-actions"
import { btProposalStaffContext, loadProjectBtProposal } from "@/lib/buildertrend/lead-proposals-server"
import { currentDepartmentProfiles } from "@/lib/department-profiles-server"
import { printProjectAccess } from "@/lib/print/print-access"
import { printPdfHref } from "@/lib/print/print-documents"
import { projectBrandFor } from "@/lib/project-branding"
import { requireProjectRouteId } from "@/lib/project-route-id"

/** Print Preview of a Buildertrend proposal as the customer saw it. Staff only. */
export default async function BtProposalPrintPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ id: string }>
  readonly searchParams: Promise<{ proposalId?: string }>
}): Promise<React.ReactElement> {
  const [{ id: rawProjectId }, query] = await Promise.all([params, searchParams])
  const projectId = await requireProjectRouteId(rawProjectId)
  const proposalId = query.proposalId
  if (!proposalId) notFound()
  const { project } = await printProjectAccess(projectId)
  // Buildertrend proposals are internal history: owners and vendors never see them.
  const context = await btProposalStaffContext(projectId, "read").catch(() => null)
  if (!context) notFound()
  const found = await loadProjectBtProposal(context, projectId, proposalId)
  if (!found) notFound()
  const brand = projectBrandFor({
    profiles: await currentDepartmentProfiles(),
    department: project.department,
    projectId,
    projectNumber: project.projectNumber,
  })
  const number = found.view.title
  return (
    <>
      <DocumentReportActions title="Proposal" documentNumber={number} pdfHref={printPdfHref({ projectId, document: "bt-proposal", params: { proposalId }, number })} emailLink={false} />
      <main className="mx-auto my-4 max-w-[8.5in] border bg-report-paper p-8 text-xs leading-tight text-report-ink print:my-0 print:max-w-none print:border-0 print:p-0">
        <style>{"@page { size: letter; margin: 0.5in; } @media print { body { background: white !important; } }"}</style>
        <BtProposalDocument brand={brand} proposal={found.view} project={project} />
        <PrintSourceMode />
      </main>
    </>
  )
}
