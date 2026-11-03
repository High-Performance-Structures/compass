/**
 * Plans the backfill of the directory links added in migration 0280, plus
 * the existing project_contacts directory columns. Pure: the
 * `scripts/relational-links-backfill.mjs` script reads the rows, calls
 * `planRelationalLinks`, writes the JSON report and, only with `--apply`,
 * runs `relationalLinkUpdateSql` after writing a backup.
 *
 * Matching (src/lib/domain/contacts/link-matching.ts):
 *   1. exact email, trimmed and case-insensitive;
 *   2. otherwise the exact normalized name (and company where the record has
 *      one), only when exactly one directory record in the company matches.
 * Anything with several matches goes to review; nothing is guessed. An RFI
 * assignee links to a contact on the same project, matched by exact name
 * among that project's contacts.
 */
import {
  buildLinkReport,
  directoryKindsForContactType,
  type DirectoryCandidate,
  type DirectoryKind,
  type LinkProposal,
  type LinkSubject,
} from "./link-matching"
import { normalizeDirectoryKey } from "./rules"

/** A directory row; people carry their company's id so a link can set both. */
export type DirectoryRow = DirectoryCandidate & { readonly parentId: string | null }

type NamedRow = { readonly id: string; readonly organizationId: string; readonly name: string }

export type RelationalLinkInput = {
  readonly directory: readonly DirectoryRow[]
  /** projects with no client_customer_id and a client_name. */
  readonly projects: readonly NamedRow[]
  /** RFQs and POs with no vendor_id and a company name; email is the RFQ recipient. */
  readonly operations: readonly (NamedRow & { readonly email: string | null })[]
  /** Budget lines with no vendor_id and a vendor_name. */
  readonly budgetLines: readonly NamedRow[]
  /** RFIs with no assigned_project_contact_id and an assignee name. */
  readonly rfis: readonly { readonly id: string; readonly projectId: string; readonly name: string }[]
  /** Active contacts of the RFIs' projects. */
  readonly rfiContacts: readonly { readonly id: string; readonly projectId: string; readonly name: string }[]
  /** Project contacts with none of their directory columns set. */
  readonly projectContacts: readonly (NamedRow & {
    readonly contactType: string
    readonly company: string | null
    readonly email: string | null
  })[]
}

const RELATIONAL_LINK_SECTIONS = [
  "projectClients",
  "operationVendors",
  "budgetLineVendors",
  "rfiAssignees",
  "projectContacts",
] as const
type RelationalLinkSection = (typeof RELATIONAL_LINK_SECTIONS)[number]

const SECTION_TABLE: Readonly<Record<RelationalLinkSection, string>> = {
  projectClients: "projects",
  operationVendors: "project_operations",
  budgetLineVendors: "project_budget_lines",
  rfiAssignees: "project_rfis",
  projectContacts: "project_contacts",
}

/** Every column the backfill may fill; nothing else is ever written. */
const LINK_COLUMNS = [
  "client_customer_id",
  "vendor_id",
  "assigned_project_contact_id",
  "customer_id",
  "customer_contact_id",
  "vendor_contact_id",
  "internal_contact_id",
] as const
type LinkColumn = (typeof LINK_COLUMNS)[number]

type LinkRule = "email" | "name_company" | "name"

export type PlannedLink = {
  readonly section: RelationalLinkSection
  readonly table: string
  readonly id: string
  readonly name: string
  readonly rule: LinkRule
  /** Only NULL columns are filled; the update re-checks that they are still NULL. */
  readonly set: Readonly<Partial<Record<LinkColumn, string>>>
}

type ReviewLink = {
  readonly section: RelationalLinkSection
  readonly table: string
  readonly id: string
  readonly name: string
  readonly rule: LinkRule
  readonly candidates: readonly { readonly kind: string; readonly id: string; readonly name: string }[]
}

type SectionCounts = {
  readonly checked: number
  readonly exactByEmail: number
  readonly exactByName: number
  readonly ambiguous: number
  readonly noMatch: number
}

export type RelationalLinkPlan = {
  readonly counts: Readonly<Record<RelationalLinkSection, SectionCounts>>
  readonly links: readonly PlannedLink[]
  readonly review: readonly ReviewLink[]
}

type Outcome =
  | { readonly kind: "exact"; readonly rule: LinkRule; readonly set: PlannedLink["set"] }
  | { readonly kind: "ambiguous"; readonly rule: LinkRule; readonly candidates: ReviewLink["candidates"] }
  | { readonly kind: "none" }

type Decided = { readonly id: string; readonly name: string; readonly outcome: Outcome }

/**
 * Vendor-linked records match the vendor, or the vendor through one of its
 * people's email addresses (folded onto the vendor, so a name never matches
 * a person).
 */
function vendorPool(directory: readonly DirectoryRow[]): readonly DirectoryCandidate[] {
  const vendorNames = new Map(directory.filter((row) => row.kind === "vendor").map((row) => [row.id, row.name]))
  return directory.flatMap((row): DirectoryCandidate[] => {
    if (row.kind === "vendor") return [row]
    if (row.kind !== "vendor_contact" || !row.parentId) return []
    const vendorName = vendorNames.get(row.parentId)
    // Only the email is the person's; the name stays the vendor's.
    return vendorName === undefined
      ? []
      : [{ kind: "vendor", id: row.parentId, organizationId: row.organizationId, name: vendorName, company: vendorName, email: row.email }]
  })
}

function setFor(candidate: DirectoryCandidate, parentOf: ReadonlyMap<string, string | null>): PlannedLink["set"] {
  const parent = parentOf.get(`${candidate.kind}:${candidate.id}`) ?? null
  switch (candidate.kind) {
    case "customer":
      return { customer_id: candidate.id }
    case "customer_contact":
      return parent ? { customer_id: parent, customer_contact_id: candidate.id } : {}
    case "vendor":
      return { vendor_id: candidate.id }
    case "vendor_contact":
      return parent ? { vendor_id: parent, vendor_contact_id: candidate.id } : {}
    case "internal_contact":
      return { internal_contact_id: candidate.id }
  }
}

function fromProposal(proposal: LinkProposal, set: (candidate: DirectoryCandidate) => PlannedLink["set"]): Outcome {
  if (proposal.outcome === "none") return { kind: "none" }
  if (proposal.outcome === "ambiguous") {
    return {
      kind: "ambiguous",
      rule: proposal.rule,
      candidates: proposal.candidates.map((candidate) => ({ kind: candidate.kind, id: candidate.id, name: candidate.name })),
    }
  }
  const values = set(proposal.candidate)
  return Object.keys(values).length === 0 ? { kind: "none" } : { kind: "exact", rule: proposal.rule, set: values }
}

function decideAll(
  subjects: readonly LinkSubject[],
  pool: readonly DirectoryCandidate[],
  set: (candidate: DirectoryCandidate) => PlannedLink["set"]
): readonly Decided[] {
  return buildLinkReport(subjects, pool).proposals.map(({ subject, proposal }) => ({
    id: subject.id,
    name: subject.name,
    outcome: fromProposal(proposal, set),
  }))
}

function subject(
  row: NamedRow,
  kinds: readonly DirectoryKind[],
  extra: { readonly email?: string | null; readonly company?: string | null; readonly compareCompany?: boolean } = {}
): LinkSubject {
  return {
    id: row.id,
    organizationId: row.organizationId,
    name: row.name,
    company: extra.company ?? null,
    email: extra.email ?? null,
    kinds,
    compareCompany: extra.compareCompany ?? false,
  }
}

/** An RFI assignee: the one contact on the same project with exactly that name. */
function decideRfis(input: RelationalLinkInput): readonly Decided[] {
  const byProject = new Map<string, { readonly id: string; readonly name: string }[]>()
  for (const contact of input.rfiContacts) {
    const list = byProject.get(contact.projectId) ?? []
    list.push(contact)
    byProject.set(contact.projectId, list)
  }
  return input.rfis.map((rfi): Decided => {
    const key = normalizeDirectoryKey(rfi.name)
    const matches = key ? (byProject.get(rfi.projectId) ?? []).filter((contact) => normalizeDirectoryKey(contact.name) === key) : []
    const [first, ...rest] = matches
    if (!first) return { id: rfi.id, name: rfi.name, outcome: { kind: "none" } }
    if (rest.length > 0) {
      return {
        id: rfi.id,
        name: rfi.name,
        outcome: { kind: "ambiguous", rule: "name", candidates: matches.map((contact) => ({ kind: "project_contact", ...contact })) },
      }
    }
    return { id: rfi.id, name: rfi.name, outcome: { kind: "exact", rule: "name", set: { assigned_project_contact_id: first.id } } }
  })
}

function countsFor(decided: readonly Decided[]): SectionCounts {
  const exact = decided.flatMap((entry) => (entry.outcome.kind === "exact" ? [entry.outcome] : []))
  return {
    checked: decided.length,
    exactByEmail: exact.filter((outcome) => outcome.rule === "email").length,
    exactByName: exact.filter((outcome) => outcome.rule !== "email").length,
    ambiguous: decided.filter((entry) => entry.outcome.kind === "ambiguous").length,
    noMatch: decided.filter((entry) => entry.outcome.kind === "none").length,
  }
}

export function planRelationalLinks(input: RelationalLinkInput): RelationalLinkPlan {
  const vendors = vendorPool(input.directory)
  const parentOf = new Map(input.directory.map((row) => [`${row.kind}:${row.id}`, row.parentId]))
  const vendorSet = (candidate: DirectoryCandidate): PlannedLink["set"] => ({ vendor_id: candidate.id })
  const sections: Readonly<Record<RelationalLinkSection, readonly Decided[]>> = {
    // A project stores only the client's name, so the company is not compared.
    projectClients: decideAll(
      input.projects.map((row) => subject(row, ["customer"])),
      input.directory,
      (candidate) => ({ client_customer_id: candidate.id })
    ),
    operationVendors: decideAll(
      input.operations.map((row) => subject(row, ["vendor"], { email: row.email })),
      vendors,
      vendorSet
    ),
    budgetLineVendors: decideAll(
      input.budgetLines.map((row) => subject(row, ["vendor"])),
      vendors,
      vendorSet
    ),
    rfiAssignees: decideRfis(input),
    projectContacts: decideAll(
      input.projectContacts.map((row) =>
        subject(row, directoryKindsForContactType(row.contactType), { email: row.email, company: row.company, compareCompany: true })
      ),
      input.directory,
      (candidate) => setFor(candidate, parentOf)
    ),
  }
  const links: PlannedLink[] = []
  const review: ReviewLink[] = []
  for (const section of RELATIONAL_LINK_SECTIONS) {
    const table = SECTION_TABLE[section]
    for (const entry of sections[section]) {
      if (entry.outcome.kind === "exact") links.push({ section, table, id: entry.id, name: entry.name, rule: entry.outcome.rule, set: entry.outcome.set })
      if (entry.outcome.kind === "ambiguous") {
        review.push({ section, table, id: entry.id, name: entry.name, rule: entry.outcome.rule, candidates: entry.outcome.candidates })
      }
    }
  }
  const counts = {
    projectClients: countsFor(sections.projectClients),
    operationVendors: countsFor(sections.operationVendors),
    budgetLineVendors: countsFor(sections.budgetLineVendors),
    rfiAssignees: countsFor(sections.rfiAssignees),
    projectContacts: countsFor(sections.projectContacts),
  }
  return { counts, links, review }
}

function literal(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}

function isLinkColumn(value: string): value is LinkColumn {
  return LINK_COLUMNS.some((column) => column === value)
}

const LINK_TABLES: readonly string[] = Object.values(SECTION_TABLE)

/**
 * One UPDATE per planned link. It fills only columns that are still NULL, so
 * re-running the backfill, or a link a person set in the meantime, is never
 * overwritten. Values are inlined literals (no bound parameters), and only
 * known tables and link columns are accepted.
 */
export function relationalLinkUpdateSql(link: PlannedLink): string {
  if (!LINK_TABLES.includes(link.table)) throw new Error(`Unknown link table ${link.table}`)
  const entries = Object.entries(link.set).flatMap(([column, value]) =>
    isLinkColumn(column) && typeof value === "string" ? [[column, value] as const] : []
  )
  if (entries.length === 0) throw new Error(`Nothing to set for ${link.table} ${link.id}`)
  const assignments = entries.map(([column, value]) => `${column} = ${literal(value)}`).join(", ")
  const guards = entries.map(([column]) => `${column} IS NULL`).join(" AND ")
  return `UPDATE ${link.table} SET ${assignments} WHERE id = ${literal(link.id)} AND ${guards};`
}

/** The statement that undoes one applied link (used in the backup file). */
export function relationalLinkRestoreSql(link: PlannedLink): string {
  const entries = Object.entries(link.set).flatMap(([column, value]) =>
    isLinkColumn(column) && typeof value === "string" ? [[column, value] as const] : []
  )
  const assignments = entries.map(([column]) => `${column} = NULL`).join(", ")
  const guards = entries.map(([column, value]) => `${column} = ${literal(value)}`).join(" AND ")
  return `UPDATE ${link.table} SET ${assignments} WHERE id = ${literal(link.id)} AND ${guards};`
}
