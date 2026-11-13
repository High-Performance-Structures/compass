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

/**
 * Every job whose number (four characters or more) appears in the email's
 * To address, subject or body. Exactly one match identifies the job; none or
 * several leave it unknown.
 */
export function exactJobNumberMatches<T extends InboundRoutingProject>(
  candidate: InboundRoutingCandidate,
  projects: readonly T[]
): readonly T[] {
  const searchable = searchableText(candidate)
  const compactSearchable = compact(searchable)
  return projects.filter((project) => {
    const projectNumber = project.projectNumber?.trim() ?? ""
    if (projectNumber.length < 4) return false
    return (
      searchable.includes(projectNumber.toLowerCase()) ||
      compactSearchable.includes(compact(projectNumber))
    )
  })
}

/** The one job an email names by number, else the office job for "office" emails (subject-tagged routing). */
export function matchInboundProject(
  candidate: InboundRoutingCandidate,
  projects: readonly InboundRoutingProject[]
): InboundRoutingProject | null {
  const exactMatches = exactJobNumberMatches(candidate, projects)

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
