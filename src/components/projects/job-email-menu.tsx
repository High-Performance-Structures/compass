"use client"

import * as React from "react"
import { getJobEmailDraft, sendJobEmail } from "@/app/actions/job-emails"
import { TemplateEmailMenu } from "@/components/email/template-email-menu"
import { jobTemplatesFor } from "@/lib/job-workflows/email-templates"
import type { ProjectDepartment } from "@/lib/project-branding"

/** The emails for an HPS, ORC or Design job, current step's first. */
export function JobEmailMenu({
  projectId,
  department,
  step,
}: {
  readonly projectId: string
  readonly department: ProjectDepartment
  readonly step: string | null
}): React.ReactElement | null {
  const { suggested, other } = jobTemplatesFor(department, step)
  if (suggested.length === 0 && other.length === 0) return null
  return (
    <TemplateEmailMenu
      projectId={projectId}
      suggested={suggested}
      other={other}
      loadDraft={getJobEmailDraft}
      send={sendJobEmail}
      attachmentHint="Estimate, agreement, change order, invoice, plans or photos."
    />
  )
}
