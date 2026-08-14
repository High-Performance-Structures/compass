export type InboundRoutingCandidate = {
  readonly toAddress: string | null
  readonly subject: string
  readonly textBody: string | null
  readonly htmlBody: string | null
  readonly snippet: string | null
}

export type InboundRoutingProject = {
  readonly id: string
  readonly projectNumber: string | null
  readonly name: string
}

export type InboundRecordKind = "rfi"

function searchableText(candidate: InboundRoutingCandidate): string {
  return [
    candidate.toAddress ?? "",
    candidate.subject,
    candidate.textBody ?? "",
    candidate.htmlBody ?? "",
    candidate.snippet ?? "",
  ]
    .join("\n")
    .toLowerCase()
}

function compact(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "")
}

export function inboundRecordKind(subject: string): InboundRecordKind | null {
  return /^\s*\[\s*(?:rfi|request\s+for\s+information)\s*\]/i.test(subject)
    ? "rfi"
    : null
}

export function inboundRecordSubject(subject: string): string {
  const cleaned = subject
    .replace(/^\s*\[\s*(?:rfi|request\s+for\s+information)\s*\]\s*/i, "")
    .trim()
  return cleaned.length > 0 ? cleaned : "Email-submitted RFI"
}

export function matchInboundProject(
  candidate: InboundRoutingCandidate,
  projects: readonly InboundRoutingProject[]
): InboundRoutingProject | null {
  const searchable = searchableText(candidate)
  const compactSearchable = compact(searchable)
  const exactMatches = projects.filter((project) => {
    const projectNumber = project.projectNumber?.trim() ?? ""
    if (projectNumber.length < 4) return false
    return (
      searchable.includes(projectNumber.toLowerCase()) ||
      compactSearchable.includes(compact(projectNumber))
    )
  })

  if (exactMatches.length === 1) return exactMatches[0] ?? null

  const officeProject = projects.find(
    (project) => project.projectNumber?.trim().toUpperCase() === "H-OFFICE"
  )
  const officeSignal = /\boffice\b/i.test(
    `${candidate.toAddress ?? ""}\n${candidate.subject}`
  )
  if (officeProject && officeSignal) return officeProject

  return null
}
