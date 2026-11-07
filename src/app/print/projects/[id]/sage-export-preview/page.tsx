export const dynamic = "force-dynamic"

import { notFound } from "next/navigation"

import { getSageExportPreview } from "@/app/actions/sage-export-preview"
import { SageExportPreviewDocument } from "@/components/financials/sage-export-preview"
import { PrintSourceMode } from "@/components/print/print-source-mode"
import { DocumentReportActions } from "@/components/projects/document-report-actions"
import { printPdfHref } from "@/lib/print/print-documents"
import { requireProjectRouteId } from "@/lib/project-route-id"

/** Print Preview of a pay application's Sage export preview (internal; office staff with finance access). */
export default async function SageExportPreviewPrintPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ id: string }>
  readonly searchParams: Promise<{ applicationId?: string }>
}): Promise<React.ReactElement> {
  const [{ id: rawProjectId }, query] = await Promise.all([params, searchParams])
  const projectId = await requireProjectRouteId(rawProjectId)
  const applicationId = query.applicationId
  if (!applicationId) notFound()
  const result = await getSageExportPreview(projectId, applicationId)
  if (!result.success) notFound()
  const preview = result.data
  const number = `Sage export ${preview.header.applicationNumber}`
  return (
    <>
      <DocumentReportActions
        title="Sage export preview"
        documentNumber={number}
        emailLink={false}
        pdfHref={printPdfHref({ projectId, document: "sage-export-preview", params: { applicationId }, number })}
      />
      <main className="mx-auto my-4 max-w-[11in] border bg-report-paper p-8 text-xs leading-tight text-report-ink print:my-0 print:max-w-none print:border-0 print:p-0">
        <style>{"@page { size: letter landscape; margin: 0.4in; } @media print { body { background: white !important; } }"}</style>
        <header className="mb-4">
          <h1 className="text-lg font-semibold">Sage export preview: pay application {preview.header.applicationNumber}</h1>
          <p className="text-sm">
            {preview.project.projectNumber ? `${preview.project.projectNumber} · ` : ""}
            {preview.project.name}
          </p>
        </header>
        <SageExportPreviewDocument preview={preview} />
        <PrintSourceMode />
      </main>
    </>
  )
}
