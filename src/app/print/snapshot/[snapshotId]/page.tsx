export const dynamic = "force-dynamic"

import { notFound } from "next/navigation"

import { PdfDocumentPreview } from "@/components/print/pdf-document-preview"
import { loadOwnPrintSnapshot } from "@/lib/print/snapshots"

/** Print Preview for a document assembled in the browser. */
export default async function PrintSnapshotPreviewPage({
  params,
}: {
  readonly params: Promise<{ snapshotId: string }>
}): Promise<React.ReactElement> {
  const { snapshotId } = await params
  const snapshot = await loadOwnPrintSnapshot(snapshotId)
  if (!snapshot) notFound()
  return (
    <PdfDocumentPreview
      title={snapshot.title}
      documentNumber={snapshot.documentNumber ?? snapshot.title}
      pdfHref={`/api/print/snapshots/${snapshot.id}`}
      emailLink={false}
    />
  )
}
