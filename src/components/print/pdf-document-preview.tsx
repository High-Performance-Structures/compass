"use client"

import { useEffect, useRef, useState } from "react"
import { IconLoader2, IconRefresh } from "@tabler/icons-react"
import type {
  PDFDocumentLoadingTask,
  PDFDocumentProxy,
  PDFPageProxy,
} from "pdfjs-dist/types/src/display/api"

import { DocumentReportActions } from "@/components/projects/document-report-actions"
import { Button } from "@/components/ui/button"

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unable to show the preview."
}

function PdfPageCanvas({
  document,
  pageNumber,
}: {
  readonly document: PDFDocumentProxy
  readonly pageNumber: number
}): React.ReactElement {
  const wrapperRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [page, setPage] = useState<PDFPageProxy | null>(null)
  const [width, setWidth] = useState(0)

  useEffect(() => {
    let active = true
    void document.getPage(pageNumber).then((loadedPage) => {
      if (active) setPage(loadedPage)
    })
    return () => {
      active = false
    }
  }, [document, pageNumber])

  useEffect(() => {
    const wrapper = wrapperRef.current
    if (!wrapper) return
    const updateWidth = (): void => setWidth(wrapper.clientWidth)
    updateWidth()
    const observer = new ResizeObserver(updateWidth)
    observer.observe(wrapper)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !page || width <= 0) return
    const baseViewport = page.getViewport({ scale: 1 })
    const cssScale = width / baseViewport.width
    const outputScale = Math.min(window.devicePixelRatio || 1, 2)
    const viewport = page.getViewport({ scale: cssScale * outputScale })
    canvas.width = Math.floor(viewport.width)
    canvas.height = Math.floor(viewport.height)
    canvas.style.width = `${Math.floor(viewport.width / outputScale)}px`
    canvas.style.height = `${Math.floor(viewport.height / outputScale)}px`
    const task = page.render({ canvas, viewport })
    void task.promise.catch(() => undefined)
    return () => task.cancel()
  }, [page, width])

  // PDF points are 1/72 in, so landscape pages get a wider sheet than portrait.
  const pageWidthInches = page ? page.getViewport({ scale: 1 }).width / 72 : 8.5
  return (
    <article
      ref={wrapperRef}
      style={{ maxWidth: `${pageWidthInches}in` }}
      className="pdf-preview-page mx-auto w-full overflow-hidden bg-white shadow-lg print:shadow-none"
      aria-label={`Page ${pageNumber}`}
    >
      <canvas ref={canvasRef} className="block h-auto w-full bg-white" />
    </article>
  )
}

/**
 * Print Preview for documents rendered to PDF on the server: the standard
 * report bar, then the PDF's pages exactly as they print.
 */
export function PdfDocumentPreview({
  title,
  documentNumber,
  pdfHref,
  leading,
  preparingLabel = "Preparing the preview...",
  emailLink = true,
}: {
  readonly title: string
  readonly documentNumber: string
  readonly pdfHref: string
  readonly leading?: React.ReactNode
  readonly preparingLabel?: string
  /** Off for previews only their creator can open. */
  readonly emailLink?: boolean
}): React.ReactElement {
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let active = true
    let loadingTask: PDFDocumentLoadingTask | null = null
    setDocument(null)
    setError(null)
    void import("pdfjs-dist")
      .then(async (pdfjs) => {
        if (!active) return
        pdfjs.GlobalWorkerOptions.workerSrc = new URL(
          "pdfjs-dist/build/pdf.worker.min.mjs",
          import.meta.url
        ).toString()
        loadingTask = pdfjs.getDocument({ url: pdfHref })
        try {
          const loadedDocument = await loadingTask.promise
          if (active) setDocument(loadedDocument)
        } catch (loadError) {
          if (active) setError(errorMessage(loadError))
        }
      })
      .catch((loadError: unknown) => {
        if (active) setError(errorMessage(loadError))
      })
    return () => {
      active = false
      if (loadingTask) void loadingTask.destroy()
    }
  }, [pdfHref, reloadKey])

  return (
    <div className="min-h-screen bg-muted/50 text-foreground">
      <style>{`
        @page { margin: 0; }
        @media print {
          body { background: white !important; }
          .pdf-preview-pages { gap: 0 !important; padding: 0 !important; }
          .pdf-preview-page { break-after: page; max-width: none !important; }
          .pdf-preview-page:last-child { break-after: auto; }
        }
      `}</style>
      <DocumentReportActions title={title} documentNumber={documentNumber} pdfHref={pdfHref} leading={leading} emailLink={emailLink} />

      {error && (
        <main className="mx-auto max-w-2xl p-8 text-center">
          <h2 className="font-semibold">The preview could not be displayed</h2>
          <p className="mt-2 text-sm text-muted-foreground">{error}</p>
          <Button className="mt-4" onClick={() => setReloadKey((value) => value + 1)}>
            <IconRefresh className="size-4" />Try again
          </Button>
        </main>
      )}

      {!error && !document && (
        <main className="flex min-h-[70vh] items-center justify-center gap-2 text-sm text-muted-foreground">
          <IconLoader2 className="size-5 animate-spin" />
          {preparingLabel}
        </main>
      )}

      {document && (
        <main className="pdf-preview-pages space-y-6 p-4 md:p-8">
          {Array.from({ length: document.numPages }, (_, index) => (
            <PdfPageCanvas key={`${pdfHref}-${index + 1}`} document={document} pageNumber={index + 1} />
          ))}
        </main>
      )}
    </div>
  )
}
