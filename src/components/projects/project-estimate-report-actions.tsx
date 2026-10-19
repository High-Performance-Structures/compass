"use client"

import { DocumentReportActions } from "@/components/projects/document-report-actions"

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
  return (
    <DocumentReportActions
      title={title}
      documentNumber={estimateNumber}
      pdfHref={projectId && estimateId ? `/api/projects/${projectId}/estimates/${estimateId}/pdf` : undefined}
    />
  )
}
