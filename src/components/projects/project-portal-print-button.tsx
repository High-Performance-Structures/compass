"use client"

import { useDepartmentProfiles } from "@/components/branding/department-profiles-provider"
import * as React from "react"
import { IconEye } from "@tabler/icons-react"
import { Button } from "@/components/ui/button"
import { openPrintSnapshot } from "@/components/print/open-print-snapshot"
import {
  portalReportHtml,
  type PortalReport,
  type ReportProject,
} from "@/lib/print/portal-report"

export function ProjectPortalPrintButton({
  project,
  report,
  roomSheets = false,
  label = "Print Preview",
}: {
  readonly project: ReportProject
  readonly report: PortalReport
  readonly roomSheets?: boolean
  readonly label?: string
}): React.ReactElement {
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const departmentProfiles = useDepartmentProfiles()

  async function preview(): Promise<void> {
    setError(null)
    setPending(true)
    const result = await openPrintSnapshot({
      projectId: project.id,
      kind: "portal-report",
      title: report.title,
      documentNumber: project.projectNumber ? `${project.projectNumber} ${report.title}` : report.title,
      html: portalReportHtml(project, report, roomSheets, undefined, departmentProfiles),
    })
    setPending(false)
    if (!result.success) setError(result.error)
  }

  return (
    <div className="print:hidden">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={pending || report.groups.length === 0}
        onClick={() => void preview()}
      >
        <IconEye className="size-4" />
        {pending ? "Preparing preview…" : label}
      </Button>
      {error && (
        <p role="alert" className="mt-1 text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
