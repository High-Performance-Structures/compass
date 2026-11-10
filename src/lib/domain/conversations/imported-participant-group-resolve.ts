import { and, eq, isNull, sql } from "drizzle-orm"

import { vendors } from "@/db/schema"
import type { ActionResult } from "@/lib/action-result"
import { findDirectoryPerson } from "@/lib/domain/contacts/people-search"
import { readFeatureSettings } from "@/lib/feature-settings/server"
import { cleanText, field } from "@/lib/shared/guards"
import type { Db } from "@/lib/server/action-context"

import { LEGAL_HOLD_ERROR, resolveImportedParticipant, type ReviewDecision } from "./imported-participant-resolve"
import { loadReviewGroup } from "./imported-participant-review"
import { decideIdentity, identityKeyOfRow, isHeldGroup, knownContactsFor, listIdentityGroups } from "./participant-auto-resolve"
import { IDENTITY_KEY_SQL, identityFromKey, isFreeMailDomain, suggestVendorForDomain, type VendorSuggestion } from "./participant-matching"

/*
 * Contacts → Needs review lists one row per identity (a name or email across
 * every project and conversation). One decision applies to every unresolved
 * row of that identity; rows on legal-hold projects stay unchanged unless
 * staff explicitly include them (their conversations stay staff-only). Names
 * run together are still split one conversation at a time by the single
 * review (resolveImportedParticipant), applied to each conversation that
 * shows the same text.
 */

export type GroupDecision =
  | ReviewDecision
  /** Add the person as a new, uninvited contact of this vendor (from an email domain suggestion). */
  | { readonly type: "vendor"; readonly vendorId: string }

export type GroupReviewOutcome = {
  readonly changed: boolean
  readonly decision: GroupDecision["type"]
  readonly literal: string
  readonly people: readonly string[]
  readonly refs: readonly string[]
  readonly projects: number
  readonly conversations: number
  readonly rowsReviewed: number
  /** Rows left as they were because their project keeps imported conversations staff-only. */
  readonly legalHoldRows: number
  /** Imported conversations stay staff-only; sharing stays a staff decision per conversation. */
  readonly stillStaffOnly: boolean
  /** The single project, for revalidation and Activity, when there is exactly one. */
  readonly projectId: string | null
}

type Fail = { readonly success: false; readonly error: string }
const fail = (error: string): Fail => ({ success: false, error })

const MAX_SPLIT_CONVERSATIONS = 50

/** One anchor row per conversation for a run-together text (bounded). */
async function runTogetherAnchors(db: Db, organizationId: string, key: string): Promise<readonly string[]> {
  const rows = await db.all(sql`SELECT MIN(p.id) AS id FROM project_source_record_participants p
    LEFT JOIN messages m ON m.source_message_id = p.source_record_id
      AND m.source_system = substr(p.source_record_type, 1, length(p.source_record_type) - 8)
    WHERE p.organization_id = ${organizationId} AND p.review_status = 'unreviewed'
      AND p.participant_role LIKE '%\\_literal' ESCAPE '\\' AND ${sql.raw(IDENTITY_KEY_SQL)} = ${key}
    GROUP BY p.project_id, COALESCE(m.channel_id, p.id)
    LIMIT ${MAX_SPLIT_CONVERSATIONS}`)
  return rows.flatMap((row) => {
    const id = cleanText(field(row, "id"))
    return id ? [id] : []
  })
}

/** A split (or leave) of names run together, applied to each conversation that shows the same text. */
async function resolveRunTogether(
  db: Db,
  input: { readonly organizationId: string; readonly rowId: string; readonly key: string; readonly decision: ReviewDecision; readonly apply: boolean; readonly now: string; readonly includeStaffOnlyProjects: boolean },
): Promise<ActionResult<GroupReviewOutcome>> {
  const anchors = await runTogetherAnchors(db, input.organizationId, input.key)
  const ids = anchors.includes(input.rowId) ? anchors : [input.rowId, ...anchors]
  const people = new Set<string>()
  const refs = new Set<string>()
  const projects = new Set<string>()
  let rows = 0
  let conversations = 0
  let legalHoldRows = 0
  let literal = input.key.slice("literal:".length)
  for (const id of ids) {
    const result = await resolveImportedParticipant({
      db, organizationId: input.organizationId, rowId: id, decision: input.decision, apply: input.apply, now: input.now, includeStaffOnlyProjects: input.includeStaffOnlyProjects,
    })
    if (!result.success) {
      if (result.error === LEGAL_HOLD_ERROR) {
        legalHoldRows += 1
        continue
      }
      // The anchor the staff member opened must succeed; other conversations already reviewed differently are skipped.
      if (id === input.rowId) return result
      continue
    }
    literal = result.data.literal
    if (result.data.rowsReviewed > 0) {
      conversations += 1
      projects.add(result.data.projectId)
    }
    rows += result.data.rowsReviewed
    result.data.people.forEach((name) => people.add(name))
    result.data.refs.forEach((ref) => refs.add(ref))
  }
  if (rows === 0 && legalHoldRows > 0) return fail(LEGAL_HOLD_ERROR)
  const [onlyProject] = projects
  return {
    success: true,
    data: {
      changed: input.apply && rows > 0, decision: input.decision.type, literal, people: [...people], refs: [...refs],
      projects: projects.size, conversations, rowsReviewed: rows, legalHoldRows, stillStaffOnly: true,
      projectId: projects.size === 1 && onlyProject ? onlyProject : null,
    },
  }
}

/**
 * Applies one staff decision to every unresolved row of the identity the
 * listed row belongs to. `apply: false` describes the outcome without writing.
 * `includeStaffOnlyProjects` (default off) also changes rows on projects that
 * keep imported conversations staff-only; those conversations stay staff-only.
 */
export async function resolveParticipantGroup(input: {
  readonly db: Db
  readonly organizationId: string
  readonly rowId: string
  readonly decision: GroupDecision
  readonly apply: boolean
  readonly now: string
  readonly includeStaffOnlyProjects?: boolean
}): Promise<ActionResult<GroupReviewOutcome>> {
  const { db, organizationId, decision } = input
  const include = input.includeStaffOnlyProjects === true
  const anchor = await loadReviewGroup(db, organizationId, input.rowId)
  if (!anchor) return fail("This participant was not found.")
  const key = await identityKeyOfRow(db, organizationId, input.rowId)
  if (!key) return fail("This participant was not found.")

  if (key.startsWith("literal:")) {
    if (decision.type === "vendor") return fail("Split names run together into people instead.")
    return resolveRunTogether(db, { organizationId, rowId: input.rowId, key, decision, apply: input.apply, now: input.now, includeStaffOnlyProjects: include })
  }
  if (decision.type === "split") return fail("Only names run together can be split.")

  const groups = await listIdentityGroups(db, organizationId, key)
  const writable = groups.filter((group) => !isHeldGroup(group, include))
  const legalHoldRows = groups.filter((group) => isHeldGroup(group, include)).reduce((sum, group) => sum + group.rows, 0)
  if (writable.length === 0) return groups.length > 0 ? fail(LEGAL_HOLD_ERROR) : fail("Every row of this participant has already been reviewed.")

  let target: Parameters<typeof decideIdentity>[1]["target"]
  let known = new Map<string, string>()
  if (decision.type === "leave") {
    target = { kind: "leave" }
  } else if (decision.type === "vendor") {
    const vendor = await db
      .select({ id: vendors.id, name: vendors.name })
      .from(vendors)
      .where(and(eq(vendors.id, decision.vendorId), eq(vendors.organizationId, organizationId), isNull(vendors.mergedIntoVendorId)))
      .get()
    if (!vendor) return fail("That company was not found in this company's directory.")
    target = { kind: "vendor", vendorId: vendor.id, vendorName: vendor.name }
  } else {
    // Any person in this organization's directory; a reference from another company is not found.
    const person = await findDirectoryPerson(db, organizationId, anchor.anchor.projectId, decision.ref)
    if (!person) return fail("That person was not found in this company's directory.")
    target = { kind: "person", person }
    known = await knownContactsFor(db, organizationId, person)
  }

  const literal = groups[0]?.literal ?? anchor.literal
  const rowsReviewed = writable.reduce((sum, group) => sum + group.rows, 0)
  const preview = target.kind === "leave" ? [] : [target.kind === "vendor" ? target.vendorName : target.person.name]
  const [onlyGroup] = writable
  const common = { decision: decision.type, literal, projects: writable.length, conversations: 0, legalHoldRows, stillStaffOnly: true, projectId: writable.length === 1 && onlyGroup ? onlyGroup.projectId : null }
  if (!input.apply) {
    return { success: true, data: { ...common, changed: false, people: preview, refs: decision.type === "pick" ? [decision.ref] : [], rowsReviewed } }
  }
  const decided = await decideIdentity(db, { organizationId, key, target, known, now: input.now, includeStaffOnlyProjects: include })
  if (!decided.success) return decided
  const outcome = decided.data
  return { success: true, data: { ...common, changed: outcome.rowsReviewed > 0, people: outcome.people, refs: outcome.refs, rowsReviewed: outcome.rowsReviewed, projects: outcome.projects } }
}

export type CompanySuggestion = VendorSuggestion & { readonly reason: "domain" | "name" }

/**
 * Companies an email's domain points to, for the pick dialog: a vendor
 * whose people (or itself) use the same business domain, or whose name reads
 * like the domain. A suggestion only; staff decide.
 */
export async function companySuggestions(db: Db, organizationId: string, rowId: string): Promise<ActionResult<readonly CompanySuggestion[]>> {
  const key = await identityKeyOfRow(db, organizationId, rowId)
  const identity = key ? identityFromKey(key) : null
  if (!identity || identity.kind !== "email" || isFreeMailDomain(identity.domain)) return { success: true, data: [] }
  const settings = await readFeatureSettings(db, organizationId, "company-email-domains")
  if (settings.domains.includes(identity.domain)) return { success: true, data: [] }
  const pattern = `%@${identity.domain}`
  const [byDomain, named] = await Promise.all([
    db.all(sql`SELECT DISTINCT v.id AS id, v.name AS name FROM vendors v
      LEFT JOIN vendor_contacts vc ON vc.vendor_id = v.id AND vc.merged_into_person_id IS NULL
      WHERE v.organization_id = ${organizationId} AND v.merged_into_vendor_id IS NULL
        AND (lower(COALESCE(v.email, '')) LIKE ${pattern} OR lower(COALESCE(v.primary_email, '')) LIKE ${pattern} OR lower(COALESCE(vc.email, '')) LIKE ${pattern})
      LIMIT 5`),
    db.select({ id: vendors.id, name: vendors.name }).from(vendors)
      .where(and(eq(vendors.organizationId, organizationId), isNull(vendors.mergedIntoVendorId)))
      .limit(5000),
  ])
  const suggestions: CompanySuggestion[] = byDomain.flatMap((row) => {
    const id = cleanText(field(row, "id"))
    const name = cleanText(field(row, "name"))
    return id && name ? [{ companyKind: "vendor" as const, vendorId: id, vendorName: name, reason: "domain" as const }] : []
  })
  const byName = suggestVendorForDomain(identity.domain, named.map((row) => ({ companyKind: "vendor" as const, id: row.id, name: row.name, emails: [] })))
  if (byName && !suggestions.some((item) => item.vendorId === byName.vendorId)) suggestions.push({ ...byName, reason: "name" })
  return { success: true, data: suggestions }
}
