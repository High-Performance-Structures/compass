"use client"

import * as React from "react"
import { IconPrinter } from "@tabler/icons-react"
import { Button } from "@/components/ui/button"
import { projectBrandFor } from "@/lib/project-branding"
import {
  portalReportHtml,
  type PortalReport,
  type ReportProject,
} from "@/lib/print/portal-report"
import { requiresSynchronousPrint } from "@/lib/print/ios-print"
import {
  IOS_PRINT_STATE_TIMEOUT_MS,
  PRINT_STATE_TIMEOUT_MS,
  waitForPrintLayout,
} from "@/lib/print/readiness"

export function ProjectPortalPrintButton({
  project,
  report,
  roomSheets = false,
  label = "Print / Save PDF",
}: {
  readonly project: ReportProject
  readonly report: PortalReport
  readonly roomSheets?: boolean
  readonly label?: string
}): React.ReactElement {
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const logoSrc = projectBrandFor({
    projectId: project.id,
    projectNumber: project.projectNumber,
  }).logoSrc
  React.useEffect(() => {
    const logo = new window.Image()
    logo.src = logoSrc
  }, [logoSrc])

  async function print(): Promise<void> {
    if (document.querySelector('[data-selection-print-root="true"]')) return
    setError(null)
    setPending(true)
    const root = document.createElement("article")
    root.dataset.selectionPrintRoot = "true"
    root.className = "selection-printable portal-report-printable hidden"
    root.innerHTML = portalReportHtml(project, report, roomSheets)
    document.body.appendChild(root)
    document.body.classList.add("selection-printing-selected")
    let timer: number | undefined
    let active = true
    const reset = (): void => {
      if (!active) return
      active = false
      window.clearTimeout(timer)
      root.remove()
      document.body.classList.remove("selection-printing-selected")
      window.removeEventListener("afterprint", reset)
      setPending(false)
    }
    try {
      const synchronous = requiresSynchronousPrint(window.navigator)
      // iOS snapshots after afterprint; retain the tree until its preview settles.
      if (!synchronous) {
        window.addEventListener("afterprint", reset)
        await waitForPrintLayout(root)
      }
      window.print()
      if (active)
        timer = window.setTimeout(
          reset,
          synchronous ? IOS_PRINT_STATE_TIMEOUT_MS : PRINT_STATE_TIMEOUT_MS,
        )
    } catch {
      reset()
      setError("Printing could not open. Please try again.")
    }
  }

  return (
    <div className="print:hidden">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={pending || report.groups.length === 0}
        onClick={() => void print()}
      >
        <IconPrinter className="size-4" />
        {pending ? "Preparing report…" : label}
      </Button>
      {error && (
        <p role="alert" className="mt-1 text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
