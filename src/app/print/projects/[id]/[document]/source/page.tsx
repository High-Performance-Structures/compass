export const dynamic = "force-dynamic"

import { notFound } from "next/navigation"

import { PRINT_DOCUMENTS, isPrintDocument } from "@/lib/print/print-documents"
import { printDocumentSource } from "@/components/print/print-document-sources"
import { getCloudflareContext } from "@/lib/db"
import { requireProjectRouteId } from "@/lib/project-route-id"

/** The page the PDF renderer opens for a print-only document. */
export default async function PrintDocumentSourcePage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ id: string; document: string }>
  readonly searchParams: Promise<Readonly<Record<string, string | undefined>>>
}): Promise<React.ReactElement> {
  const [{ id: rawProjectId, document }, query] = await Promise.all([params, searchParams])
  if (!isPrintDocument(document) || PRINT_DOCUMENTS[document].render !== "pdf") notFound()
  const projectId = await requireProjectRouteId(rawProjectId)
  const { env } = await getCloudflareContext()
  const source = await printDocumentSource(projectId, document, query, new URL(env.WORKOS_REDIRECT_URI).origin)
  if (!source) notFound()
  return source
}
