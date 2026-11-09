/*
 * Duplicate check for "Request add to Sage". Pure and client-safe: the
 * caller loads Compass's companies and people and Sage's vendor and client
 * lists; this decides which of them look like the record being requested.
 *
 * - Exact: the same vendor (or client) name once legal suffixes, punctuation,
 *   case and "&"/"and" are set aside, in Compass or Sage, or the same person
 *   name at the same company. Blocks the
 *   request; staff link or merge the existing record instead.
 * - Close: a similar name, the same email, the same company email domain, or
 *   the same phone. The request goes on, and the approver sees them.
 */

import type { SageDirectoryAddKind } from "@/lib/domain/sage-bridge/statuses"

type DirectoryCandidateSource = "compass" | "sage"

export type DirectoryCandidate = {
  /** Compass record id, or Sage record id for Sage-only rows. */
  readonly id: string
  readonly source: DirectoryCandidateSource
  readonly kind: SageDirectoryAddKind
  readonly name: string
  readonly email: string | null
  readonly phone: string | null
  /** Company id (Compass) for people; null for companies. */
  readonly parentId: string | null
  readonly parentName: string | null
  /** Sage number when the record is in Sage (or is a Sage row). */
  readonly sageNumber: string | null
}

export type DuplicateReason = "exact_name" | "same_name_other_list" | "similar_name" | "same_email" | "same_domain" | "same_phone"

export type DuplicateMatch = DirectoryCandidate & {
  readonly reasons: readonly DuplicateReason[]
}

export type DuplicateCheck = {
  /** Any exact match blocks the request. */
  readonly exact: readonly DuplicateMatch[]
  readonly close: readonly DuplicateMatch[]
}

export type DuplicateSubject = {
  readonly kind: SageDirectoryAddKind
  /** The record being requested, never matched against itself. */
  readonly id: string
  readonly name: string
  readonly email: string | null
  readonly phone: string | null
  readonly parentId: string | null
}

const LEGAL_SUFFIXES = new Set([
  "llc", "inc", "incorporated", "corp", "corporation", "co", "company", "ltd", "limited",
  "lp", "llp", "pllc", "pc", "plc", "the",
])

/** Shared mail providers: a matching domain says nothing about the company. */
const FREE_MAIL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "ymail.com", "hotmail.com", "outlook.com", "live.com",
  "msn.com", "aol.com", "icloud.com", "me.com", "mac.com", "comcast.net", "att.net", "sbcglobal.net",
  "protonmail.com", "proton.me", "gmx.com", "mail.com", "q.com", "centurylink.net", "earthlink.net",
])

export function isCompanyKind(kind: SageDirectoryAddKind): boolean {
  return kind === "vendor_company" || kind === "client_company"
}

/** "Tri-City Drywall, Inc." and "tri city drywall" both become "tri city drywall". */
export function normalizeDirectoryName(value: string): string {
  const words = value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
  const kept = words.filter((word) => !LEGAL_SUFFIXES.has(word))
  // A name made only of suffix words ("The Company") keeps them.
  return (kept.length > 0 ? kept : words).join(" ")
}

function normalizedEmail(value: string | null): string | null {
  const email = value?.trim().toLowerCase() ?? ""
  return email.includes("@") ? email : null
}

/** The company part of an email, or null for shared mail providers. */
export function companyEmailDomain(value: string | null): string | null {
  const email = normalizedEmail(value)
  const domain = email?.split("@")[1] ?? ""
  return domain && !FREE_MAIL_DOMAINS.has(domain) ? domain : null
}

/** The last ten digits, so "+1 (719) 900-8850" and "719.900.8850" match. */
export function phoneDigits(value: string | null): string | null {
  const digits = (value ?? "").replace(/\D/g, "")
  if (digits.length < 7) return null
  return digits.slice(-10)
}

function editDistance(left: string, right: string): number {
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index)
  for (let row = 1; row <= left.length; row++) {
    const current = [row]
    for (let column = 1; column <= right.length; column++) {
      const cost = left[row - 1] === right[column - 1] ? 0 : 1
      current.push(Math.min((previous[column] ?? 0) + 1, (current[column - 1] ?? 0) + 1, (previous[column - 1] ?? 0) + cost))
    }
    previous = current
  }
  return previous[right.length] ?? 0
}

/** Similar, not equal: one name inside the other, or only a small spelling difference. */
export function namesAreSimilar(left: string, right: string): boolean {
  const a = normalizeDirectoryName(left)
  const b = normalizeDirectoryName(right)
  if (!a || !b || a === b) return false
  const shorter = a.length <= b.length ? a : b
  const longer = a.length <= b.length ? b : a
  if (shorter.length >= 4 && (` ${longer} `).includes(` ${shorter} `)) return true
  const compactA = a.replace(/ /g, "")
  const compactB = b.replace(/ /g, "")
  if (compactA === compactB) return true
  const distance = editDistance(compactA, compactB)
  return distance / Math.max(compactA.length, compactB.length) <= 0.15
}

function reasonsFor(subject: DuplicateSubject, candidate: DirectoryCandidate): DuplicateReason[] {
  const reasons: DuplicateReason[] = []
  const subjectCompany = isCompanyKind(subject.kind)
  const candidateCompany = isCompanyKind(candidate.kind)
  // Companies are compared with companies, people with people.
  if (subjectCompany !== candidateCompany) return reasons
  const sameName = normalizeDirectoryName(subject.name) !== "" &&
    normalizeDirectoryName(subject.name) === normalizeDirectoryName(candidate.name)
  if (sameName) {
    // Sage keeps vendors and clients in separate lists, and one company can be
    // both; two people with one name at different companies are usually two
    // people. Those are shown to the approver, not blocked.
    const sameList = candidate.kind === subject.kind
    const exact = sameList && (subjectCompany || (subject.parentId !== null && subject.parentId === candidate.parentId))
    reasons.push(exact ? "exact_name" : sameList ? "similar_name" : "same_name_other_list")
  } else if (namesAreSimilar(subject.name, candidate.name)) {
    reasons.push("similar_name")
  }
  const email = normalizedEmail(subject.email)
  if (email && email === normalizedEmail(candidate.email)) reasons.push("same_email")
  // A shared domain only means something between companies; all of a company's people share it.
  const domain = subjectCompany ? companyEmailDomain(subject.email) : null
  if (domain && !reasons.includes("same_email") && domain === companyEmailDomain(candidate.email)) reasons.push("same_domain")
  const phone = phoneDigits(subject.phone)
  if (phone && phone === phoneDigits(candidate.phone)) reasons.push("same_phone")
  return reasons
}

/**
 * Splits the candidates into exact matches (which block the request) and
 * close ones (shown to the approver). A Sage row that a listed Compass record
 * is already linked to is reported once, as the Compass record.
 */
export function findDirectoryDuplicates(
  subject: DuplicateSubject,
  candidates: readonly DirectoryCandidate[],
  limit = 12
): DuplicateCheck {
  const linkedSageNumbers = new Set(
    candidates.filter((candidate) => candidate.source === "compass" && candidate.sageNumber)
      .map((candidate) => `${candidate.kind}:${candidate.sageNumber}`)
  )
  const exact: DuplicateMatch[] = []
  const close: DuplicateMatch[] = []
  for (const candidate of candidates) {
    if (candidate.source === "compass" && candidate.id === subject.id && candidate.kind === subject.kind) continue
    if (candidate.source === "sage" && linkedSageNumbers.has(`${candidate.kind}:${candidate.sageNumber}`)) continue
    const reasons = reasonsFor(subject, candidate)
    if (reasons.length === 0) continue
    const match = { ...candidate, reasons }
    if (reasons.includes("exact_name")) exact.push(match)
    else close.push(match)
  }
  return { exact: exact.slice(0, limit), close: close.slice(0, limit) }
}

export const DUPLICATE_REASON_LABELS: Readonly<Record<DuplicateReason, string>> = {
  exact_name: "Same name",
  same_name_other_list: "Same name (other list)",
  similar_name: "Similar name",
  same_email: "Same email",
  same_domain: "Same email domain",
  same_phone: "Same phone",
}
