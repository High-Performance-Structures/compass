"use client"

import * as React from "react"
import type {
  PDFDocumentLoadingTask,
  PDFDocumentProxy,
  RenderTask,
} from "pdfjs-dist/types/src/display/api"
import { Button } from "@/components/ui/button"

export function CorrespondencePdfPreview({
  href,
  name,
}: {
  readonly href: string
  readonly name: string
}): React.ReactElement {
  const [document, setDocument] = React.useState<PDFDocumentProxy | null>(null)
  const [pageNumber, setPageNumber] = React.useState(1)
  const [error, setError] = React.useState(false)
  const [rendering, setRendering] = React.useState(true)
  const [width, setWidth] = React.useState(0)
  const wrapperRef = React.useRef<HTMLDivElement>(null)
  const canvasRef = React.useRef<HTMLCanvasElement>(null)
  React.useEffect(() => {
    let active = true
    let task: PDFDocumentLoadingTask | null = null
    setDocument(null)
    setError(false)
    setPageNumber(1)
    void import("pdfjs-dist")
      .then(async (pdfjs) => {
        if (!active) return
        pdfjs.GlobalWorkerOptions.workerSrc = new URL(
          "pdfjs-dist/build/pdf.worker.min.mjs",
          import.meta.url,
        ).toString()
        task = pdfjs.getDocument({ url: href })
        const loaded = await task.promise
        if (active) setDocument(loaded)
      })
      .catch(() => {
        if (active) setError(true)
      })
    return () => {
      active = false
      if (task) void task.destroy().catch(() => undefined)
    }
  }, [href])
  React.useEffect(() => {
    const wrapper = wrapperRef.current
    if (!wrapper) return
    const update = (): void => setWidth(wrapper.clientWidth)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(wrapper)
    return () => observer.disconnect()
  }, [])
  React.useEffect(() => {
    if (!document || !canvasRef.current || width <= 0) return
    const canvas = canvasRef.current
    let active = true
    let task: RenderTask | null = null
    setRendering(true)
    void document
      .getPage(pageNumber)
      .then(async (page) => {
        if (!active) return
        const base = page.getViewport({ scale: 1 })
        const scale = Math.min(width / base.width, 2)
        const pixelRatio = Math.min(window.devicePixelRatio || 1, 2)
        const viewport = page.getViewport({ scale: scale * pixelRatio })
        canvas.width = Math.floor(viewport.width)
        canvas.height = Math.floor(viewport.height)
        canvas.style.width = `${Math.floor(viewport.width / pixelRatio)}px`
        canvas.style.height = `${Math.floor(viewport.height / pixelRatio)}px`
        task = page.render({ canvas, viewport })
        await task.promise
        if (active) setRendering(false)
      })
      .catch(() => {
        if (active) setError(true)
      })
    return () => {
      active = false
      task?.cancel()
    }
  }, [document, pageNumber, width])
  return (
    <div ref={wrapperRef} className="min-w-0">
      {error ? (
        <p role="alert" className="p-6 text-sm">
          This PDF could not be previewed. Download it to open in a PDF reader.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-center gap-3 border-b p-2">
            <Button
              size="sm"
              variant="outline"
              disabled={!document || pageNumber <= 1}
              onClick={() => setPageNumber((page) => page - 1)}
            >
              Previous page
            </Button>
            <span className="text-sm">
              {document
                ? `Page ${pageNumber} of ${document.numPages}`
                : "Loading PDF…"}
            </span>
            <Button
              size="sm"
              variant="outline"
              disabled={!document || pageNumber >= document.numPages}
              onClick={() => setPageNumber((page) => page + 1)}
            >
              Next page
            </Button>
          </div>
          <div className="max-h-[60dvh] overflow-auto">
            {rendering && (
              <p
                role="status"
                className="p-3 text-center text-sm text-muted-foreground"
              >
                Preparing preview…
              </p>
            )}
            <canvas
              ref={canvasRef}
              className="mx-auto block max-w-full"
              aria-label={`${name}, page ${pageNumber}`}
              role="img"
              hidden={rendering}
            />
          </div>
        </>
      )}
    </div>
  )
}
