/**
 * Proposes directory links for records that only hold a copied name
 * (unlinked project contacts, and projects.client_name). Pure: the
 * read-only `scripts/contacts-link-report.mjs` feeds it rows and prints the
 * result. Nothing here writes, and an ambiguous match is never guessed.
 *
 * Order of rules:
 *   1. exact normalized email (trimmed, lowercased);
 *   2. otherwise exact normalized name and company (letters and digits
 *      only, case-insensitive).
 * One candidate is an exact match; several go to review; none is no match.
 */
import { normalizeDirectoryKey, normalizeEmailKey } from "./rules"

export const DIRECTORY_KINDS = ["customer", "customer_contact", "vendor", "vendor_contact", "internal_contact"] as const
export type DirectoryKind = (typeof DIRECTORY_KINDS)[number]

export type DirectoryCandidate = {
  readonly kind: DirectoryKind
  readonly id: string
  readonly organizationId: string
  readonly name: string
  readonly company: string | null
  readonly email: string | null
}

export type LinkSubject = {
  readonly id: string
  readonly organizationId: string
  readonly name: string
  readonly company: string | null
  readonly email: string | null
  /** Which directories may hold this record. */
  readonly kinds: readonly DirectoryKind[]
  /** projects.client_name has no company to compare. */
  readonly compareCompany: boolean
}

export type LinkRule = "email" | "name_company"

export type LinkProposal =
  | { readonly outcome: "exact"; readonly rule: LinkRule; readonly candidate: DirectoryCandidate }
  | { readonly outcome: "ambiguous"; readonly rule: LinkRule; readonly candidates: readonly DirectoryCandidate[] }
  | { readonly outcome: "none" }

/** Directories a project contact of this type can link to. */
export function directoryKindsForContactType(contactType: string): readonly DirectoryKind[] {
  switch (contactType) {
    case "owner":
      return ["customer", "customer_contact"]
    case "supplier":
    case "subcontractor":
      return ["vendor", "vendor_contact"]
    case "internal":
      return ["internal_contact"]
    default:
      return []
  }
}

function decide(rule: LinkRule, matches: readonly DirectoryCandidate[]): LinkProposal | null {
  const [first, ...rest] = matches
  if (!first) return null
  return rest.length === 0 ? { outcome: "exact", rule, candidate: first } : { outcome: "ambiguous", rule, candidates: matches }
}

export function proposeDirectoryLink(subject: LinkSubject, candidates: readonly DirectoryCandidate[]): LinkProposal {
  const pool = candidates.filter(
    (candidate) => candidate.organizationId === subject.organizationId && subject.kinds.includes(candidate.kind)
  )
  const email = normalizeEmailKey(subject.email)
  if (email) {
    const byEmail = decide(
      "email",
      pool.filter((candidate) => normalizeEmailKey(candidate.email) === email)
    )
    if (byEmail) return byEmail
  }
  const name = normalizeDirectoryKey(subject.name)
  if (!name) return { outcome: "none" }
  const company = normalizeDirectoryKey(subject.company)
  const byName = decide(
    "name_company",
    pool.filter(
      (candidate) =>
        normalizeDirectoryKey(candidate.name) === name &&
        (!subject.compareCompany || normalizeDirectoryKey(candidate.company) === company)
    )
  )
  return byName ?? { outcome: "none" }
}

export type LinkReportCounts = {
  readonly total: number
  readonly exactByEmail: number
  readonly exactByNameCompany: number
  readonly ambiguous: number
  readonly noMatch: number
}

export type LinkReport = {
  readonly counts: LinkReportCounts
  readonly proposals: readonly { readonly subject: LinkSubject; readonly proposal: LinkProposal }[]
}

export function buildLinkReport(subjects: readonly LinkSubject[], candidates: readonly DirectoryCandidate[]): LinkReport {
  const byOrganization = new Map<string, DirectoryCandidate[]>()
  for (const candidate of candidates) {
    const current = byOrganization.get(candidate.organizationId) ?? []
    current.push(candidate)
    byOrganization.set(candidate.organizationId, current)
  }
  const proposals = subjects.map((subject) => ({
    subject,
    proposal: proposeDirectoryLink(subject, byOrganization.get(subject.organizationId) ?? []),
  }))
  const count = (test: (proposal: LinkProposal) => boolean): number =>
    proposals.filter((entry) => test(entry.proposal)).length
  return {
    counts: {
      total: proposals.length,
      exactByEmail: count((proposal) => proposal.outcome === "exact" && proposal.rule === "email"),
      exactByNameCompany: count((proposal) => proposal.outcome === "exact" && proposal.rule === "name_company"),
      ambiguous: count((proposal) => proposal.outcome === "ambiguous"),
      noMatch: count((proposal) => proposal.outcome === "none"),
    },
    proposals,
  }
}
