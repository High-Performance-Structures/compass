export const dynamic = "force-dynamic"

import { notFound } from "next/navigation"

import { PdfDocumentPreview } from "@/components/print/pdf-document-preview"
import { PRINT_DOCUMENTS, isPrintDocument, printPdfHref } from "@/lib/print/print-documents"
import { requireProjectRouteId } from "@/lib/project-route-id"

/** Print Preview for print-only documents: the server PDF's pages. */
export default async function PrintDocumentPreviewPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ id: string; document: string }>
  readonly searchParams: Promise<Readonly<Record<string, string | undefined>>>
}): Promise<React.ReactElement> {
  const [{ id: rawProjectId, document }, query] = await Promise.all([params, searchParams])
  if (!isPrintDocument(document) || PRINT_DOCUMENTS[document].render !== "pdf") notFound()
  const projectId = await requireProjectRouteId(rawProjectId)
  const title = PRINT_DOCUMENTS[document].title
  const number = query.number ?? title
  return (
    <PdfDocumentPreview
      title={title}
      documentNumber={number}
      pdfHref={printPdfHref({ projectId, document, params: query, number })}
    />
  )
}
