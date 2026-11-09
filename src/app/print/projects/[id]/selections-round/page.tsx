export const dynamic = "force-dynamic"

import { notFound } from "next/navigation"

import { PrintSourceMode } from "@/components/print/print-source-mode"
import { DocumentReportActions } from "@/components/projects/document-report-actions"
import { SelectionRoundDocument } from "@/components/selections/selection-round-document"
import { currentDepartmentProfiles } from "@/lib/department-profiles-server"
import { staffSelectionContext } from "@/lib/domain/selections/access"
import { loadRoundSignaturePrintParts, loadRoundSigningView } from "@/lib/domain/selections/round-signing"
import { printPdfHref } from "@/lib/print/print-documents"
import { projectBrandFor } from "@/lib/project-branding"
import { requireProjectRouteId } from "@/lib/project-route-id"

/*
 * Print Preview of a selections round, and the source of its signing PDF.
 * With `signatureId`, it shows that signature's signers and the change order
 * or variance it carries.
 */
export default async function SelectionRoundPrintPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ id: string }>
  readonly searchParams: Promise<{ round?: string; signatureId?: string }>
}): Promise<React.ReactElement> {
  const [{ id: rawProjectId }, query] = await Promise.all([params, searchParams])
  const projectId = await requireProjectRouteId(rawProjectId)
  if (!query.round) notFound()
  const { db, organizationId } = await staffSelectionContext(projectId, "read")
  const view = await loadRoundSigningView(db, projectId, organizationId, query.round)
  if (!view) notFound()
  const parts = query.signatureId ? await loadRoundSignaturePrintParts(db, projectId, query.signatureId) : null
  const brand = projectBrandFor({
    profiles: await currentDepartmentProfiles(),
    projectId,
    projectNumber: view.project.projectNumber,
  })
  const treatment = view.document.treatment === "change_order" ? "Change order" : view.document.treatment === "variance" ? "Variance" : null
  return (
    <>
      <DocumentReportActions
        title={`${view.roundName} selections`}
        documentNumber={view.roundName}
        pdfHref={printPdfHref({ projectId, document: "selections-round", params: { round: view.roundKey, signatureId: query.signatureId }, number: `${view.roundName} selections` })}
      />
      <main className="mx-auto my-4 max-w-[8.5in] border bg-report-paper p-8 text-report-ink print:my-0 print:max-w-none print:border-0 print:p-0">
        <style>{"@page { size: letter; margin: 0.55in; } @media print { body { background: white !important; } .selection-round-signature-page { break-before: page; } }"}</style>
        <SelectionRoundDocument
          brand={brand}
          projectId={projectId}
          project={view.project}
          roundName={view.roundName}
          document={view.document}
          treatmentLabel={parts?.changeOrder ? (parts.changeOrder.recordType === "variance" ? "Variance" : "Change order") : treatment}
          changeOrder={parts?.changeOrder ?? null}
          signers={parts?.signers ?? view.ownerContacts}
        />
        <PrintSourceMode />
      </main>
    </>
  )
}
