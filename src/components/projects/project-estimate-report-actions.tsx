"use client"

import { IconMail, IconPrinter } from "@tabler/icons-react"

import { Button } from "@/components/ui/button"
import { trackedMailtoHref } from "@/lib/email/mailto"

export function ProjectEstimateReportActions({
  title,
  estimateNumber,
  projectId,
  estimateId,
}: {
  readonly title: string
  readonly estimateNumber: string
  readonly projectId?: string
  readonly estimateId?: string
}): React.ReactElement {
  function emailReport(): void {
    const href = trackedMailtoHref({
      to: [],
      cc: [],
      subject: `${title} - ${estimateNumber}`,
      body: `Please review ${title} ${estimateNumber}:\n\n${window.location.href}\n\nUse Print / Save PDF to attach a PDF copy when needed.`,
    })
    window.location.href = href
  }

  return (
    <div className="estimate-report-actions sticky top-0 z-10 flex justify-center gap-2 border-b bg-background/95 p-3 backdrop-blur">
      {projectId && estimateId ? (
        <Button asChild>
          <a href={`/api/projects/${projectId}/estimates/${estimateId}/pdf`} target="_blank">
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
