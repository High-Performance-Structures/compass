"use client"

import Link from "next/link"
import { useEffect, useRef, useState } from "react"
import {
  IconArrowLeft,
  IconDownload,
  IconLoader2,
  IconRefresh,
} from "@tabler/icons-react"
import type {
  PDFDocumentLoadingTask,
  PDFDocumentProxy,
  PDFPageProxy,
} from "pdfjs-dist/types/src/display/api"

import { Button } from "@/components/ui/button"

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Unable to render the contract packet preview."
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

  return (
    <article
      ref={wrapperRef}
      className="contract-preview-page mx-auto w-full max-w-[8.5in] overflow-hidden bg-white shadow-lg print:shadow-none"
      aria-label={`Contract page ${pageNumber}`}
    >
      <canvas ref={canvasRef} className="block h-auto w-full bg-white" />
    </article>
  )
}

export function ProjectContractPacketPreview({
  projectId,
  packetId,
  packetNumber,
  versionNumber,
}: {
  readonly projectId: string
  readonly packetId: string
  readonly packetNumber: string
  readonly versionNumber: number
}): React.ReactElement {
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const pdfUrl = `/api/projects/${projectId}/contract-packets/${packetId}/pdf`

  useEffect(() => {
    let active = true
    let loadingTask: PDFDocumentLoadingTask | null = null
    setDocument(null)
    setError(null)
    void import("pdfjs-dist").then(async (pdfjs) => {
      if (!active) return
      pdfjs.GlobalWorkerOptions.workerSrc = new URL(
        "pdfjs-dist/build/pdf.worker.min.mjs",
        import.meta.url
      ).toString()
      loadingTask = pdfjs.getDocument({ url: pdfUrl })
      try {
        const loadedDocument = await loadingTask.promise
        if (active) setDocument(loadedDocument)
      } catch (loadError) {
        if (active) setError(errorMessage(loadError))
      }
    }).catch((loadError: unknown) => {
      if (active) setError(errorMessage(loadError))
    })
    return () => {
      active = false
      if (loadingTask) void loadingTask.destroy()
    }
  }, [pdfUrl, reloadKey])

  return (
    <div className="min-h-screen bg-muted/50 text-foreground">
      <style>{`
        @page { size: letter; margin: 0; }
        @media print {
          body { background: white !important; }
          .contract-preview-actions { display: none !important; }
          .contract-preview-pages { gap: 0 !important; padding: 0 !important; }
          .contract-preview-page { break-after: page; max-width: none !important; }
          .contract-preview-page:last-child { break-after: auto; }
        }
      `}</style>
      <header className="contract-preview-actions sticky top-0 z-10 border-b bg-background/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-[8.5in] flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <Button variant="ghost" size="sm" asChild>
              <Link href={`/dashboard/projects/${projectId}/contracts?packetId=${packetId}`}>
                <IconArrowLeft className="size-4" />Contract packet
              </Link>
            </Button>
            <div className="min-w-0 border-l pl-3">
              <h1 className="truncate text-sm font-semibold">
                {packetNumber} · contract packet preview
              </h1>
              <p className="text-xs text-muted-foreground">Version {versionNumber}</p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" asChild>
              <a
                href={pdfUrl}
                download={`${packetNumber}-contract-v${versionNumber}.pdf`}
              >
                <IconDownload className="size-4" />Download PDF
              </a>
            </Button>
          </div>
        </div>
      </header>

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
          <IconLoader2 className="size-5 animate-spin" />Preparing the numbered contract packet...
        </main>
      )}

      {document && (
        <main className="contract-preview-pages space-y-6 p-4 md:p-8">
          {Array.from({ length: document.numPages }, (_, index) => (
            <PdfPageCanvas
              key={`${packetId}-${index + 1}`}
              document={document}
              pageNumber={index + 1}
            />
          ))}
        </main>
      )}
    </div>
  )
}
