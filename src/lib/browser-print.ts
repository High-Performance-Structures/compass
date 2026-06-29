"use client"

function escapeDocumentText(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}

export function printAfterDomUpdate(cleanup: () => void, timeoutMs = 5000): void {
  let cleaned = false

  const resetPrintState = (): void => {
    if (cleaned) return
    cleaned = true
    cleanup()
    window.removeEventListener("afterprint", resetPrintState)
  }

  window.addEventListener("afterprint", resetPrintState)
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      window.focus()
      window.print()
      window.setTimeout(resetPrintState, timeoutMs)
    })
  })
}

export function printNow(cleanup: () => void, timeoutMs = 5000): void {
  let cleaned = false

  const resetPrintState = (): void => {
    if (cleaned) return
    cleaned = true
    cleanup()
    window.removeEventListener("afterprint", resetPrintState)
  }

  window.addEventListener("afterprint", resetPrintState)
  window.focus()
  window.print()
  window.setTimeout(resetPrintState, timeoutMs)
}

export function openPrintDocument({
  bodyHtml,
  styles,
  title,
}: {
  readonly bodyHtml: string
  readonly styles: string
  readonly title: string
}): boolean {
  const printWindow = window.open("", "_blank")

  if (!printWindow) {
    return false
  }

  printWindow.opener = null
  printWindow.document.open()
  const safeTitle = escapeDocumentText(title)
  printWindow.document.write(`
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>${safeTitle}</title>
        <style>${styles}</style>
      </head>
      <body>
        <div class="print-help">
          <button type="button" onclick="window.print()">Print / Save PDF</button>
        </div>
        <article class="selection-printable">
          ${bodyHtml}
        </article>
        <script>
          window.addEventListener("load", function () {
            window.setTimeout(function () {
              window.focus();
              window.print();
            }, 300);
          });
        </script>
      </body>
    </html>
  `)
  printWindow.document.close()

  return true
}
