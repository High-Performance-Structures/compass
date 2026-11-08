import type { BuiltDirectory } from "@/lib/domain/conversations/participant-directory"
import {
  identityFromKey,
  matchParticipant,
  normalizePersonName,
  parseParticipantText,
  type MatchType,
  type VendorSuggestion,
} from "@/lib/domain/conversations/participant-matching"

/*
 * Who an unassigned person (Contacts → Unassigned) is, with the matcher the
 * imported-participant review uses (owner decision 2026-11-08). Pure: the
 * automatic pass and the read-only dry-run script share it.
 *
 * - The importer gave each address its own identity, so identities with the
 *   same email (case-insensitive, also inside "Name <email>") are one person.
 * - Staff (sign-in and other email addresses, company domains) come first and
 *   are never connected to a vendor or client.
 * - The same email as a vendor or client person → that company (and person).
 * - A business domain used by exactly one vendor or client → that company.
 * - A company name that reads like the domain is a suggestion only; free
 *   mail never matches by domain.
 * - Rows on projects that keep imported conversations staff-only (legal
 *   hold) are never connected.
 */

export type UnassignedRow = {
  readonly contactId: string
  readonly identity: string | null
  readonly name: string
  readonly email: string | null
  readonly projectId: string
  readonly staffOnly: boolean
}

const EMAIL_SHAPE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/

/** A row's plain email: from its email field (also "Name <email>"), else from its name. */
function rowEmail(row: { readonly name: string; readonly email: string | null }): string | null {
  const fromEmail = row.email ? parseParticipantText(row.email).email : null
  return [fromEmail, parseParticipantText(row.name).email].find((value): value is string => value !== null && EMAIL_SHAPE.test(value)) ?? null
}

/**
 * Who each importer identity is: its email (from any of its rows), else the
 * identity itself. Identities with the same email are one person, and every
 * row of one identity stays with it (some rows carry no email).
 */
export function unassignedPersonKeys(
  rows: readonly { readonly identity: string; readonly name: string; readonly email: string | null }[],
): ReadonlyMap<string, { readonly key: string; readonly email: string | null }> {
  const emailOf = new Map<string, string>()
  for (const row of rows) {
    const email = rowEmail(row)
    if (email && !emailOf.has(row.identity)) emailOf.set(row.identity, email)
  }
  const keys = new Map<string, { readonly key: string; readonly email: string | null }>()
  for (const row of rows) {
    const email = emailOf.get(row.identity) ?? null
    keys.set(row.identity, email ? { key: `email:${email}`, email } : { key: `identity:${row.identity}`, email: null })
  }
  return keys
}

type UnassignedMatch =
  | {
      readonly kind: "connect"
      readonly matchType: MatchType
      readonly companyKind: "vendor" | "customer"
      readonly companyId: string
      readonly companyName: string
      /** The company's existing person with this email, when there is one. */
      readonly personId: string | null
    }
  | { readonly kind: "staff"; readonly name: string }
  | { readonly kind: "none"; readonly reason: string; readonly suggestion: VendorSuggestion | null }

export type UnassignedPlanGroup = {
  readonly key: string
  readonly name: string
  readonly email: string | null
  /** The importer identities of this one person. */
  readonly identities: readonly string[]
  readonly rows: number
  readonly legalHoldRows: number
  readonly projects: number
  readonly result: UnassignedMatch
}

/** The person groups and what the automatic pass would do with each (pure). */
export function planUnassigned(built: BuiltDirectory, rows: readonly UnassignedRow[]): readonly UnassignedPlanGroup[] {
  // The unassigned rows themselves are not who they are matched against.
  const directory = { ...built.directory, entries: built.directory.entries.filter((entry) => !entry.unassigned) }
  const entryByRef = new Map(directory.entries.map((entry) => [entry.ref, entry]))
  const companyName = new Map(directory.vendors.map((company) => [`${company.companyKind}:${company.id}`, company.name]))

  type Group = { name: string; email: string | null; identities: Set<string>; rows: UnassignedRow[] }
  const groups = new Map<string, Group>()
  const keys = unassignedPersonKeys(rows.map((row) => ({ identity: row.identity ?? row.contactId, name: row.name, email: row.email })))
  for (const row of rows) {
    const identity = row.identity ?? row.contactId
    const { key, email } = keys.get(identity) ?? { key: `identity:${identity}`, email: null }
    const group = groups.get(key) ?? { name: row.name, email, identities: new Set<string>(), rows: [] }
    group.identities.add(identity)
    group.rows.push(row)
    groups.set(key, group)
  }

  return [...groups.entries()].map(([key, group]) => {
    const writable = group.rows.filter((row) => !row.staffOnly)
    const base = {
      key, name: group.name, email: group.email, identities: [...group.identities].sort(),
      rows: group.rows.length, legalHoldRows: group.rows.length - writable.length,
      projects: new Set(group.rows.map((row) => row.projectId)).size,
    }
    const projectId = (writable[0] ?? group.rows[0])?.projectId ?? ""
    const parsedName = parseParticipantText(group.name).name
    const identity = group.email
      ? identityFromKey(`email:${group.email}`)
      : parsedName ? identityFromKey(`name:${normalizePersonName(parsedName)}`) : null
    if (!identity) return { ...base, result: { kind: "none", reason: "no_match", suggestion: null } }
    const match = matchParticipant(directory, identity, projectId)
    if (match.kind === "vendor") {
      return { ...base, result: { kind: "connect", matchType: match.matchType, companyKind: match.companyKind, companyId: match.vendorId, companyName: match.vendorName, personId: null } }
    }
    if (match.kind === "none") return { ...base, result: { kind: "none", reason: match.reason, suggestion: match.suggestion } }
    const entry = entryByRef.get(match.ref)
    if (!entry || entry.staff || entry.type === "internal" || entry.type === "user") {
      return { ...base, result: { kind: "staff", name: match.name ?? group.name } }
    }
    // A vendor or client person, or a project row tied to a company.
    const company: { readonly kind: "vendor" | "customer"; readonly id: string; readonly personId: string | null } | null =
      entry.vendorId ? { kind: "vendor", id: entry.vendorId, personId: entry.vendorContactId }
        : entry.customerId ? { kind: "customer", id: entry.customerId, personId: entry.customerContactId } : null
    const name = company ? companyName.get(`${company.kind}:${company.id}`) : undefined
    if (!company || !name) return { ...base, result: { kind: "none", reason: "no_company", suggestion: null } }
    return { ...base, result: { kind: "connect", matchType: match.matchType, companyKind: company.kind, companyId: company.id, companyName: name, personId: company.personId } }
  })
}

type UnassignedPlanTotals = { readonly people: number; readonly identities: number; readonly rows: number }

export type UnassignedPlanSummary = {
  readonly total: UnassignedPlanTotals
  /** People who had more than one importer identity (duplicates collapsed into one). */
  readonly duplicateGroups: number
  readonly duplicateIdentities: number
  readonly connect: UnassignedPlanTotals
  readonly byMatchType: Readonly<Partial<Record<MatchType, UnassignedPlanTotals>>>
  readonly staff: UnassignedPlanTotals
  readonly legalHoldOnly: UnassignedPlanTotals
  readonly leftover: UnassignedPlanTotals
  readonly withSuggestion: number
}

function totals(groups: readonly UnassignedPlanGroup[]): UnassignedPlanTotals {
  return { people: groups.length, identities: groups.reduce((sum, group) => sum + group.identities.length, 0), rows: groups.reduce((sum, group) => sum + group.rows, 0) }
}

export function summarizeUnassignedPlan(groups: readonly UnassignedPlanGroup[]): UnassignedPlanSummary {
  const legalHoldOnly = groups.filter((group) => group.legalHoldRows === group.rows)
  const writable = groups.filter((group) => group.legalHoldRows < group.rows)
  const connect = writable.filter((group) => group.result.kind === "connect")
  const byMatchType: Partial<Record<MatchType, UnassignedPlanTotals>> = {}
  for (const group of connect) {
    if (group.result.kind !== "connect") continue
    const type = group.result.matchType
    byMatchType[type] = totals(connect.filter((item) => item.result.kind === "connect" && item.result.matchType === type))
  }
  const leftover = writable.filter((group) => group.result.kind === "none")
  const duplicates = groups.filter((group) => group.identities.length > 1)
  return {
    total: totals(groups),
    duplicateGroups: duplicates.length,
    duplicateIdentities: duplicates.reduce((sum, group) => sum + group.identities.length, 0),
    connect: totals(connect),
    byMatchType,
    staff: totals(writable.filter((group) => group.result.kind === "staff")),
    legalHoldOnly: totals(legalHoldOnly),
    leftover: totals(leftover),
    withSuggestion: leftover.filter((group) => group.result.kind === "none" && group.result.suggestion !== null).length,
  }
}
