"use client"

import { useRouter } from "next/navigation"

import { DocumentReportActions } from "@/components/projects/document-report-actions"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { EstimateReportSectionOption } from "@/lib/estimates/report-sections"

const ENTIRE_ESTIMATE = "__entire__"

export function ProjectEstimateReportActions({
  title,
  estimateNumber,
  projectId,
  estimateId,
  sections = [],
  sectionId = null,
}: {
  readonly title: string
  readonly estimateNumber: string
  readonly projectId?: string
  readonly estimateId?: string
  /** Assemblies or divisions the print can be limited to. */
  readonly sections?: readonly EstimateReportSectionOption[]
  readonly sectionId?: string | null
}): React.ReactElement {
  const router = useRouter()
  const sectionQuery = sectionId ? `?section=${encodeURIComponent(sectionId)}` : ""

  function chooseSection(value: string): void {
    if (!projectId || !estimateId) return
    const query = new URLSearchParams({ estimateId })
    if (value !== ENTIRE_ESTIMATE) query.set("section", value)
    router.replace(`/print/projects/${projectId}/estimate?${query.toString()}`)
  }

  return (
    <DocumentReportActions
      title={title}
      documentNumber={estimateNumber}
      pdfHref={projectId && estimateId ? `/api/projects/${projectId}/estimates/${estimateId}/pdf${sectionQuery}` : undefined}
      leading={
        projectId && estimateId && sections.length > 1 ? (
          <Select value={sectionId ?? ENTIRE_ESTIMATE} onValueChange={chooseSection}>
            <SelectTrigger className="w-72 max-w-full" aria-label="Print">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ENTIRE_ESTIMATE}>Entire estimate</SelectItem>
              {sections.map((section) => (
                <SelectItem key={section.id} value={section.id}>
                  {section.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : undefined
      }
    />
  )
}
