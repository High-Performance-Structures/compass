"use client"

import * as React from "react"
import Link from "next/link"

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}

export function SelectionPrintPageControls({
  backHref,
  documentTitle,
}: {
  readonly backHref: string
  readonly documentTitle: string
}): React.ReactElement {
  const [printFallbackVisible, setPrintFallbackVisible] = React.useState(false)

  const printPage = React.useCallback((): void => {
    setPrintFallbackVisible(false)
    window.focus()
    window.print()

    window.setTimeout(() => {
      setPrintFallbackVisible(true)
    }, 1_200)
  }, [])

  function downloadPrintFile(): void {
    const packet = document.querySelector(".selection-printable")
    if (!packet) {
      setPrintFallbackVisible(true)
      return
    }

    const styles = Array.from(document.querySelectorAll("style"))
      .map((style) => style.textContent ?? "")
      .join("\n")
    const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(documentTitle)}</title>
    <style>${styles}</style>
  </head>
  <body>
    ${packet.outerHTML}
  </body>
</html>`
    const url = URL.createObjectURL(
      new Blob([html], { type: "text/html;charset=utf-8" })
    )
    const link = document.createElement("a")
    link.href = url
    link.download = `${documentTitle
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "finish-selections"}.html`
    document.body.appendChild(link)
    link.click()
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000)
  }

  React.useEffect(() => {
    const timeout = window.setTimeout(() => {
      printPage()
    }, 450)

    return () => window.clearTimeout(timeout)
  }, [printPage])

  return (
    <>
      <div className="print-help">
        <button type="button" onClick={printPage}>
          Print / Save PDF
        </button>
        <button type="button" onClick={downloadPrintFile}>
          Download print file
        </button>
        <Link href={backHref}>Back to selections</Link>
      </div>
      {printFallbackVisible && (
        <p className="print-fallback">
          If the print window did not open, use your browser menu to print this
          page or download the print file and open it in Chrome or Brave.
        </p>
      )}
    </>
  )
}
