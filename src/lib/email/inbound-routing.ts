import { isProjectInboxTagAddress } from "@/lib/email/project-address"

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

/**
 * A job number as a whole token: its letter and digit groups in order, with
 * an optional separator between groups, and no letter or digit right before
 * or after ("Ph 430-1900" is not H-430-1900; "2026" is not O-20). Only
 * numbers with a digit and at least four letters and digits count, so a
 * word-like number such as an office job never matches by itself.
 */
function jobNumberPattern(projectNumber: string): RegExp | null {
  const groups = projectNumber.toLowerCase().match(/[a-z0-9]+/g) ?? []
  const compacted = groups.join("")
  if (compacted.length < 4 || !/[0-9]/.test(compacted)) return null
  return new RegExp(`(?<![a-z0-9])${groups.join("[\\s._/-]?")}(?![a-z0-9])`, "i")
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
 * Every job whose number appears as a whole token (jobNumberPattern) in the
 * email's To address, subject or body. Exactly one match identifies the job;
 * none or several leave it unknown.
 */
export function exactJobNumberMatches<T extends InboundRoutingProject>(
  candidate: InboundRoutingCandidate,
  projects: readonly T[]
): readonly T[] {
  const searchable = searchableText(candidate)
  return projects.filter((project) => {
    const pattern = jobNumberPattern(project.projectNumber ?? "")
    return pattern !== null && pattern.test(searchable)
  })
}

/**
 * True when the email explicitly asks for the office job: an `[OFFICE]` tag
 * or the office job's own number in the subject, or the Compass project
 * inbox's `+office` address. Other mailboxes named "office" (a vendor's
 * office@ address) and the plain word "office" in a subject do not count.
 */
function explicitOfficeSignal(candidate: InboundRoutingCandidate, officeProjectNumber: string): boolean {
  if (/\[\s*office\s*\]/i.test(candidate.subject)) return true
  const groups = officeProjectNumber.toLowerCase().match(/[a-z0-9]+/g) ?? []
  if (groups.length > 0 && new RegExp(`(?<![a-z0-9])${groups.join("[\\s._/-]?")}(?![a-z0-9])`, "i").test(candidate.subject)) return true
  return isProjectInboxTagAddress(candidate.toAddress, "office")
}

/** The one job an email names by number, else the office job when the email explicitly asks for it (subject-tagged routing). */
export function matchInboundProject(
  candidate: InboundRoutingCandidate,
  projects: readonly InboundRoutingProject[]
): InboundRoutingProject | null {
  const exactMatches = exactJobNumberMatches(candidate, projects)

  if (exactMatches.length === 1) return exactMatches[0] ?? null

  const officeProject = projects.find(
    (project) => project.projectNumber?.trim().toUpperCase() === "H-OFFICE"
  )
  if (officeProject?.projectNumber && explicitOfficeSignal(candidate, officeProject.projectNumber)) return officeProject

  return null
}
