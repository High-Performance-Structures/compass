/*
 * Who an unresolved imported participant is: pure rules, no database
 * (owner-approved plan 2026-11-08). Used by the automatic pass and the
 * grouped review on Contacts → Needs review, and by the read-only dry-run
 * script. Generic: nothing here names one company.
 *
 * One identity per text. The importer stored one row per message, so the
 * same person shows up as thousands of rows; review works on the identity
 * the text names: the email (from "Name <email>" or a bare address), else
 * the whole name.
 *
 * Matching, in order:
 *  1. Staff win. An email that is a staff member's sign-in email or one of
 *     their other email addresses is that staff member, even when a vendor
 *     or client record carries the same address.
 *  2. A company domain (Settings) is the company's own: an address on it is
 *     the staff member with the same name before the @, or nobody (shared
 *     mailboxes stay for review). It is never matched to a vendor or client.
 *  3. Everyone else found by the exact email is ONE person, however many
 *     project contact rows they have; so are people found by the exact name
 *     who share an email or the same directory person or account.
 *  4. No exact match: a business domain (never free mail) used by exactly one
 *     vendor's people or the vendor itself is that vendor; the person is
 *     added as the vendor's contact.
 *  5. Otherwise nothing is decided. A domain that reads like a vendor's name
 *     ("acmesteel.com" for "Acme Steel Inc") is offered as a
 *     suggestion only.
 */

/** Free email services: an address on one says nothing about a company. */
const FREE_MAIL_DOMAINS: ReadonlySet<string> = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "ymail.com", "rocketmail.com", "hotmail.com", "outlook.com", "live.com",
  "msn.com", "aol.com", "icloud.com", "me.com", "mac.com", "comcast.net", "att.net", "sbcglobal.net", "verizon.net",
  "bellsouth.net", "cox.net", "charter.net", "earthlink.net", "protonmail.com", "proton.me", "gmx.com", "mail.com",
  "zoho.com", "yandex.com", "q.com", "centurylink.net", "frontier.com", "frontiernet.net", "windstream.net",
  "privaterelay.appleid.com", "qwestoffice.net", "qwest.net", "centurytel.net", "embarqmail.com", "juno.com", "netzero.net",
  "roadrunner.com", "rr.com", "twc.com", "optonline.net", "mindspring.com", "peoplepc.com", "hughes.net", "wildblue.net", "xfinity.com",
])

/** Legal suffixes dropped when a company name is compared with a domain. */
const COMPANY_SUFFIXES: ReadonlySet<string> = new Set(["inc", "incorporated", "llc", "co", "corp", "corporation", "company", "ltd", "limited", "lp", "llp", "pllc", "pc"])

export type ParticipantIdentity =
  | { readonly kind: "email"; readonly key: string; readonly email: string; readonly local: string; readonly domain: string }
  | { readonly kind: "name"; readonly key: string; readonly name: string }

/** "Jane Doe <jane@x.com>", "jane@x.com" or "Jane Doe": the name and email the text shows. */
export function parseParticipantText(value: string): { readonly name: string | null; readonly email: string | null } {
  const text = value.trim().replace(/\s+/g, " ")
  const angled = /^(.*?)\s*<\s*([^<>\s]+@[^<>\s]+)\s*>$/.exec(text)
  if (angled) return { name: angled[1]?.replace(/^["']|["']$/g, "").trim() || null, email: angled[2]?.toLowerCase() ?? null }
  if (text.includes("@") && !text.includes(" ")) return { name: null, email: text.toLowerCase() }
  return { name: text || null, email: null }
}

export function normalizePersonName(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase()
}

function splitEmail(email: string): { readonly local: string; readonly domain: string } | null {
  const at = email.lastIndexOf("@")
  if (at <= 0 || at === email.length - 1) return null
  return { local: email.slice(0, at), domain: email.slice(at + 1) }
}

/** The identity of a text, keyed as IDENTITY_KEY_SQL keys it. */
export function identityOfText(value: string): ParticipantIdentity | null {
  const parsed = parseParticipantText(value)
  if (parsed.email) return identityFromKey(`email:${parsed.email}`)
  return parsed.name ? identityFromKey(`name:${normalizePersonName(parsed.name)}`) : null
}

/** Reads a key produced by IDENTITY_KEY_SQL (`email:…` or `name:…`); run-together `literal:…` keys are not identities. */
export function identityFromKey(key: string): ParticipantIdentity | null {
  if (key.startsWith("email:")) {
    const email = key.slice(6).trim().toLowerCase()
    const parts = splitEmail(email)
    return parts ? { kind: "email", key: `email:${email}`, email, ...parts } : null
  }
  if (key.startsWith("name:")) {
    const name = normalizePersonName(key.slice(5))
    return name ? { kind: "name", key: `name:${name}`, name } : null
  }
  return null
}

/*
 * The same identity key in SQL, over a participant row aliased `p`, so the
 * list, the grouped decision and the automatic pass all group rows the same
 * way without loading them. Run-together rows keep their own literal key.
 * (SQLite has no regex: the email is the importer's `:email:` key, else the
 * text between < and > when it is one address that ends the text, else a
 * bare address; double spaces are collapsed a few times, which covers
 * imported names. Nested or listed "<…>" text stays a name.)
 */
/** The text between the first < and the first >, trimmed. */
const ANGLED = "trim(substr(p.source_contact_name, instr(p.source_contact_name, '<') + 1, instr(p.source_contact_name, '>') - instr(p.source_contact_name, '<') - 1))"
const NAME_TEXT = "COALESCE(p.source_contact_name, CASE WHEN instr(p.source_participant_id, ':name:') > 0 THEN substr(p.source_participant_id, instr(p.source_participant_id, ':name:') + 6) END, p.source_participant_id)"
export const IDENTITY_KEY_SQL = `(CASE
  WHEN p.identity_status LIKE 'boundary\\_unproven:%' ESCAPE '\\' THEN 'literal:' || COALESCE(p.source_contact_name, '')
  WHEN instr(p.source_participant_id, ':email:') > 0 THEN 'email:' || lower(trim(substr(p.source_participant_id, instr(p.source_participant_id, ':email:') + 7)))
  WHEN instr(COALESCE(p.source_contact_name, ''), '<') > 0 AND instr(p.source_contact_name, '>') = length(rtrim(p.source_contact_name))
    AND instr(${ANGLED}, '@') > 0 AND instr(${ANGLED}, ' ') = 0 AND instr(${ANGLED}, '<') = 0
    THEN 'email:' || lower(${ANGLED})
  WHEN instr(COALESCE(p.source_contact_name, ''), '@') > 0 AND instr(trim(p.source_contact_name), ' ') = 0 THEN 'email:' || lower(trim(p.source_contact_name))
  ELSE 'name:' || lower(trim(replace(replace(replace(${NAME_TEXT}, '  ', ' '), '  ', ' '), '  ', ' ')))
END)`

// ---- The directory, as the matcher sees it ---------------------------------------

type DirectoryEntryType = "user" | "internal" | "vendor_contact" | "customer_contact" | "project_contact"

export type DirectoryEntry = {
  /** `<type>:<id>`, the reference a review decision uses (people-search). */
  readonly ref: string
  readonly type: DirectoryEntryType
  readonly name: string | null
  /** Exact addresses (lowercased) that are this person. */
  readonly emails: readonly string[]
  /** Staff only: their other addresses (lowercased), also in `emails`. */
  readonly otherEmails: readonly string[]
  /** A staff member with a current staff account. */
  readonly staff: boolean
  readonly active: boolean
  /** Links that make two entries the same person. */
  readonly userId: string | null
  readonly internalContactId: string | null
  readonly vendorContactId: string | null
  readonly customerContactId: string | null
  /** The company the person belongs to, when known. */
  readonly vendorId: string | null
  readonly customerId: string | null
  /** Project contacts only. */
  readonly projectId: string | null
  /** A project contact added by an import as an unassigned person (usable on other projects). */
  readonly unassigned: boolean
}

export type DirectoryVendor = {
  /** A vendor, or (only where a flow can connect people to clients) a client company. */
  readonly companyKind: "vendor" | "customer"
  readonly id: string
  readonly name: string
  /** The vendor's own addresses and its people's addresses (lowercased). */
  readonly emails: readonly string[]
}

export type MatchDirectory = {
  readonly entries: readonly DirectoryEntry[]
  readonly vendors: readonly DirectoryVendor[]
  /** The company's own domains (Settings → Company email domains), lowercased. */
  readonly companyDomains: readonly string[]
}

export const MATCH_TYPES = [
  "staff_email",
  "staff_other_email",
  "staff_company_domain",
  "staff_name",
  "same_email",
  "same_name",
  "vendor_domain",
] as const
export type MatchType = (typeof MATCH_TYPES)[number]

export const MATCH_TYPE_LABELS: Readonly<Record<MatchType, string>> = {
  staff_email: "Staff sign-in email",
  staff_other_email: "Staff other email address",
  staff_company_domain: "Staff on a company domain",
  staff_name: "Staff name",
  same_email: "Same email, one person",
  same_name: "Same name, one person",
  vendor_domain: "Company's email domain",
}

type NoMatchReason = "no_match" | "several_people" | "company_mailbox" | "several_vendors"

export type VendorSuggestion = { readonly companyKind: "vendor" | "customer"; readonly vendorId: string; readonly vendorName: string }

export type MatchResult =
  | { readonly kind: "person"; readonly matchType: MatchType; readonly ref: string; readonly name: string | null; readonly staff: boolean }
  | { readonly kind: "vendor"; readonly matchType: "vendor_domain"; readonly companyKind: "vendor" | "customer"; readonly vendorId: string; readonly vendorName: string }
  | { readonly kind: "none"; readonly reason: NoMatchReason; readonly suggestion: VendorSuggestion | null }

const none = (reason: NoMatchReason, suggestion: VendorSuggestion | null = null): MatchResult => ({ kind: "none", reason, suggestion })

export function isFreeMailDomain(domain: string): boolean {
  return FREE_MAIL_DOMAINS.has(domain.toLowerCase())
}

function domainOf(email: string): string | null {
  return splitEmail(email)?.domain ?? null
}

/** "Acme Steel, Inc." → "acmesteel". */
export function compactCompanyName(name: string): string {
  const words = name.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean)
  while (words.length > 1 && COMPANY_SUFFIXES.has(words[words.length - 1] ?? "")) words.pop()
  return words.join("")
}

/** The labels of a domain that could be a company name ("orders.acmesteel.com" → ["orders", "acmesteel"]). */
function domainNameLabels(domain: string): readonly string[] {
  const labels = domain.toLowerCase().split(".")
  return labels.slice(0, -1).map((label) => label.replace(/[^a-z0-9]/g, "")).filter((label) => label.length >= 4)
}

/** A vendor whose name reads like the domain: a suggestion, never automatic. */
export function suggestVendorForDomain(domain: string, vendors: readonly DirectoryVendor[]): VendorSuggestion | null {
  if (isFreeMailDomain(domain)) return null
  const labels = new Set(domainNameLabels(domain))
  const hits = vendors.filter((vendor) => {
    const compact = compactCompanyName(vendor.name)
    return compact.length >= 4 && labels.has(compact)
  })
  const [hit] = hits
  return hit && hits.length === 1 ? { companyKind: hit.companyKind, vendorId: hit.id, vendorName: hit.name } : null
}

// ---- One person from several entries ------------------------------------------------

/** Groups entries that are the same person: a shared address, account or directory person. */
function collapseEntries(entries: readonly DirectoryEntry[]): readonly (readonly DirectoryEntry[])[] {
  const parent = entries.map((_, index) => index)
  const find = (index: number): number => {
    let root = index
    while (parent[root] !== root) root = parent[root] ?? root
    return root
  }
  const owner = new Map<string, number>()
  entries.forEach((entry, index) => {
    const keys = [
      ...entry.emails.map((email) => `email:${email}`),
      entry.userId ? `user:${entry.userId}` : null,
      entry.internalContactId ? `internal:${entry.internalContactId}` : null,
      entry.vendorContactId ? `vendor_contact:${entry.vendorContactId}` : null,
      entry.customerContactId ? `customer_contact:${entry.customerContactId}` : null,
    ]
    for (const key of keys) {
      if (!key) continue
      const seen = owner.get(key)
      if (seen === undefined) owner.set(key, index)
      else parent[find(index)] = find(seen)
    }
  })
  const groups = new Map<number, DirectoryEntry[]>()
  entries.forEach((entry, index) => {
    const root = find(index)
    groups.set(root, [...(groups.get(root) ?? []), entry])
  })
  return [...groups.values()]
}

/** Each entry's whole person (every linked entry in the directory), computed once per directory. */
const personCache = new WeakMap<MatchDirectory, ReadonlyMap<DirectoryEntry, readonly DirectoryEntry[]>>()

function personsOf(directory: MatchDirectory): ReadonlyMap<DirectoryEntry, readonly DirectoryEntry[]> {
  const cached = personCache.get(directory)
  if (cached) return cached
  const map = new Map<DirectoryEntry, readonly DirectoryEntry[]>()
  for (const group of collapseEntries(directory.entries)) for (const entry of group) map.set(entry, group)
  personCache.set(directory, map)
  return map
}

/** The distinct people (whole linked groups) the hits belong to. */
function peopleOf(directory: MatchDirectory, hits: readonly DirectoryEntry[]): readonly (readonly DirectoryEntry[])[] {
  const persons = personsOf(directory)
  const seen = new Set<readonly DirectoryEntry[]>()
  for (const hit of hits) seen.add(persons.get(hit) ?? [hit])
  return [...seen]
}

const TYPE_RANK: Readonly<Record<DirectoryEntryType, number>> = { internal: 0, user: 1, vendor_contact: 2, customer_contact: 3, project_contact: 4 }

/**
 * The entry a decision links to for one person: staff first, then a
 * directory person (vendor or client), then the project's own contact row,
 * then an unassigned person; active before archived.
 */
function canonicalEntry(group: readonly DirectoryEntry[], projectId: string | null, otherProjects = false): DirectoryEntry | null {
  // Another project's own contact row is the same person only when an address proves it (otherProjects).
  const usable = otherProjects ? group : group.filter((entry) => entry.type !== "project_contact" || entry.projectId === projectId || entry.unassigned)
  const ranked = [...usable].sort((a, b) =>
    Number(b.staff) - Number(a.staff)
    || TYPE_RANK[a.type] - TYPE_RANK[b.type]
    || Number(b.active) - Number(a.active)
    || Number(b.projectId === projectId) - Number(a.projectId === projectId)
    || a.ref.localeCompare(b.ref))
  return ranked[0] ?? null
}

/** Distinct companies the people in a group belong to (vendor or client). */
function companiesOf(group: readonly DirectoryEntry[]): number {
  return new Set(group.flatMap((entry) => [entry.vendorId ? `v:${entry.vendorId}` : null, entry.customerId ? `c:${entry.customerId}` : null]).filter(Boolean)).size
}

function person(matchType: MatchType, entry: DirectoryEntry): MatchResult {
  return { kind: "person", matchType, ref: entry.ref, name: entry.name, staff: entry.staff }
}

/** The one staff member among entries, by account; several accounts decide nothing. */
function oneStaff(entries: readonly DirectoryEntry[]): DirectoryEntry | "several" | null {
  const staff = entries.filter((entry) => entry.staff && entry.userId)
  const accounts = new Set(staff.map((entry) => entry.userId))
  if (accounts.size > 1) return "several"
  return canonicalEntry(staff, null)
}

function matchEmail(directory: MatchDirectory, identity: Extract<ParticipantIdentity, { kind: "email" }>, projectId: string): MatchResult {
  const { email, local, domain } = identity
  // Everyone with the address, plus every entry linked to them (account, directory person).
  const candidates = peopleOf(directory, directory.entries.filter((entry) => entry.emails.includes(email))).flat()

  // 1. Staff win over any vendor or client record with the same address.
  const staff = oneStaff(candidates)
  if (staff === "several") return none("several_people")
  if (staff) return person(staff.otherEmails.includes(email) ? "staff_other_email" : "staff_email", staff)

  // 2. The company's own domain: the staff member with the same name before the @, or nobody.
  const companyDomains = new Set(directory.companyDomains)
  if (companyDomains.has(domain)) {
    const sameLocal = directory.entries.filter((entry) => entry.staff && entry.emails.some((address) => {
      const parts = splitEmail(address)
      return parts !== null && parts.local === local && companyDomains.has(parts.domain)
    }))
    const byLocal = oneStaff(sameLocal)
    if (byLocal && byLocal !== "several") return person("staff_company_domain", byLocal)
    return none(byLocal === "several" ? "several_people" : "company_mailbox")
  }

  // 3. Everyone found by the exact address is one person.
  if (candidates.length > 0) {
    const pick = canonicalEntry(candidates, projectId, true)
    // One mailbox shared by people at two different companies is not one person.
    if (!pick || companiesOf(candidates) > 1) return none("several_people")
    return person("same_email", pick)
  }

  // 4. A business domain used by exactly one vendor. A domain a staff member
  // uses is the company's own even when Settings does not list it yet.
  if (isFreeMailDomain(domain)) return none("no_match")
  const staffDomains = new Set(directory.entries.filter((entry) => entry.staff).flatMap((entry) => entry.emails.map(domainOf)))
  if (staffDomains.has(domain)) return none("company_mailbox")
  const vendors = directory.vendors.filter((vendor) => vendor.emails.some((address) => domainOf(address) === domain))
  const [vendor] = vendors
  if (vendor && vendors.length === 1) return { kind: "vendor", matchType: "vendor_domain", companyKind: vendor.companyKind, vendorId: vendor.id, vendorName: vendor.name }
  if (vendors.length > 1) return none("several_vendors")

  // 5. A domain that reads like a vendor's name: a suggestion only.
  return none("no_match", suggestVendorForDomain(domain, directory.vendors))
}

function matchName(directory: MatchDirectory, identity: Extract<ParticipantIdentity, { kind: "name" }>, projectId: string): MatchResult {
  const named = directory.entries.filter((entry) => entry.name !== null && normalizePersonName(entry.name) === identity.name)
  // The project's own people (and staff) first, like the importer; then the rest of the directory.
  const projectTier = named.filter((entry) => entry.staff || (entry.type === "project_contact" && entry.projectId === projectId))
  const tier = projectTier.length > 0 ? projectTier : named.filter((entry) => entry.type !== "project_contact" || entry.unassigned)
  if (tier.length === 0) return none("no_match")
  // Name-only text gives no address to collapse on, so the tier's people must
  // already be linked (same address, account or directory person).
  const groups = peopleOf(directory, tier).filter((group) => canonicalEntry(group, projectId) !== null)
  const [group] = groups
  if (!group || groups.length > 1) return none(groups.length > 1 ? "several_people" : "no_match")
  const staff = oneStaff(group)
  if (staff === "several") return none("several_people")
  if (staff) return person("staff_name", staff)
  const pick = canonicalEntry(group, projectId)
  return pick && companiesOf(group) <= 1 ? person("same_name", pick) : none("several_people")
}

/** Who this identity is on this project, or why nobody is decided. */
export function matchParticipant(directory: MatchDirectory, identity: ParticipantIdentity, projectId: string): MatchResult {
  return identity.kind === "email" ? matchEmail(directory, identity, projectId) : matchName(directory, identity, projectId)
}
