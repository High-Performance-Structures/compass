"use client"

import { IconMail, IconPrinter } from "@tabler/icons-react"

import { Button } from "@/components/ui/button"
import { trackedMailtoHref } from "@/lib/email/mailto"

/**
 * The bar on top of every print preview: Print / Save PDF opens the server
 * rendered PDF in a browser tab, Email report link mails this page's link.
 */
export function DocumentReportActions({
  title,
  documentNumber,
  pdfHref,
  leading,
}: {
  readonly title: string
  readonly documentNumber: string
  /** Server PDF for this document; without one the browser prints the page. */
  readonly pdfHref?: string
  /** Shown at the start of the bar, such as a link back to the record. */
  readonly leading?: React.ReactNode
}): React.ReactElement {
  function emailReport(): void {
    const href = trackedMailtoHref({
      to: [],
      cc: [],
      subject: `${title} - ${documentNumber}`,
      body: `Please review ${title} ${documentNumber}:\n\n${window.location.href}\n\nUse Print / Save PDF to attach a PDF copy when needed.`,
    })
    window.location.href = href
  }

  return (
    <div className="estimate-report-actions document-report-actions sticky top-0 z-10 flex flex-wrap items-center justify-center gap-2 border-b bg-background/95 p-3 backdrop-blur print:hidden">
      {leading ? <div className="mr-auto flex min-w-0 items-center gap-3">{leading}</div> : null}
      {pdfHref ? (
        <Button asChild>
          <a href={pdfHref} target="_blank" rel="noopener">
            <IconPrinter className="size-4" />
            Print / Save PDF
          </a>
        </Button>
      ) : (
        <Button type="button" onClick={() => window.print()}>
          <IconPrinter className="size-4" />
          Print / Save PDF
        </Button>
      )}
      <Button type="button" variant="outline" onClick={emailReport}>
        <IconMail className="size-4" />
        Email report link
      </Button>
    </div>
  )
}
