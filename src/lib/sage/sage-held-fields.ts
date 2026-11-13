/**
 * Sage-shared fields Compass is holding for an unfinished Sage change.
 *
 * An inline edit of a Sage-linked client, vendor or Sage person changes
 * Compass at once and sends the change to Sage for approval. Until Sage has
 * the value (or the change is rejected), Sage → Compass syncs must not put
 * Sage's old value back: every inbound path drops the held fields and keeps
 * syncing the rest. A change that failed or did not read back keeps holding
 * its fields, so Compass keeps the new value while staff retry or reject.
 */
import { and, asc, desc, eq, inArray, ne, sql, type SQL } from "drizzle-orm"
import { z } from "zod/v4"

import { sageContactChangeProposals } from "@/db/schema-sage"
import type { Db } from "@/lib/server/action-context"

/**
 * Proposal states that hold their fields in Compass. "queued" is a Compass
 * edit whose Sage request waits: for Compass's first Sage read of the record,
 * for the write Sage is running now, or for Sage contact sync to be set up.
 * It is never reviewed or sent as it is; once it can, it becomes a pending
 * request planned against the newest Sage read (contact-proposal-service.ts).
 */
export const HOLDING_SAGE_CHANGE_STATUSES = ["pending", "approved", "running", "conflict", "failed", "queued"] as const

/** Records whose Compass values the inline edits change (staff records keep the old flow). */
const HOLDING_KINDS: ReadonlySet<string> = new Set(["client_company", "vendor_company", "client_person", "vendor_person"])

const changesSchema = z.array(z.object({ field: z.string() }))

function changedFields(json: string): readonly string[] {
  let parsed: unknown
  try { parsed = JSON.parse(json) } catch { return [] }
  const changes = changesSchema.safeParse(parsed)
  return changes.success ? changes.data.map((change) => change.field) : []
}

/**
 * The fields one record's unfinished Sage change holds. `exceptProposalId`
 * releases the change whose confirmed write is being applied.
 */
export async function heldSageFields(
  db: Db,
  organizationId: string,
  kind: string,
  entityId: string,
  options: { readonly exceptProposalId?: string } = {}
): Promise<ReadonlySet<string>> {
  return (await sageHolds(db, organizationId, kind, entityId, options)).fields
}

/** A record's held fields and the unfinished changes holding them, for a guarded sync write. */
export type SageHolds = {
  readonly fields: ReadonlySet<string>
  readonly proposalIds: readonly string[]
}

/** heldSageFields, plus which changes hold them (see noNewSageHoldGuard). */
export async function sageHolds(
  db: Db,
  organizationId: string,
  kind: string,
  entityId: string,
  options: { readonly exceptProposalId?: string } = {}
): Promise<SageHolds> {
  if (!HOLDING_KINDS.has(kind)) return { fields: new Set(), proposalIds: [] }
  const rows = await db.select({ id: sageContactChangeProposals.id, changesJson: sageContactChangeProposals.changesJson })
    .from(sageContactChangeProposals).where(and(
      eq(sageContactChangeProposals.organizationId, organizationId),
      eq(sageContactChangeProposals.kind, kind),
      eq(sageContactChangeProposals.entityId, entityId),
      inArray(sageContactChangeProposals.status, [...HOLDING_SAGE_CHANGE_STATUSES]),
      options.exceptProposalId ? ne(sageContactChangeProposals.id, options.exceptProposalId) : undefined
    ))
  return {
    fields: new Set(rows.flatMap((row) => changedFields(row.changesJson))),
    proposalIds: rows.map((row) => row.id),
  }
}

/**
 * A WHERE fragment (raw SQL and its binds) for a Sage → Compass write: true
 * only while the record has no unfinished Sage change beyond `seen`, the ones
 * the sync already left out. A staff edit that lands between the sync's read
 * of the held fields and its write opens a change first (its request lands
 * before Compass changes), so the write then matches nothing instead of
 * putting Sage's old value over the new one. Null for kinds that hold nothing.
 */
export function noNewSageHoldGuard(input: {
  readonly organizationId: string
  readonly kind: string
  readonly entityId: string
  readonly seen: readonly string[]
}): { readonly sql: string; readonly binds: readonly string[] } | null {
  if (!HOLDING_KINDS.has(input.kind)) return null
  const statuses = HOLDING_SAGE_CHANGE_STATUSES.map(() => "?").join(", ")
  const seen = input.seen.length > 0 ? ` AND hold.id NOT IN (${input.seen.map(() => "?").join(", ")})` : ""
  return {
    sql: `NOT EXISTS (SELECT 1 FROM sage_contact_change_proposals hold
      WHERE hold.organization_id = ? AND hold.kind = ? AND hold.entity_id = ?
        AND hold.status IN (${statuses})${seen})`,
    binds: [input.organizationId, input.kind, input.entityId, ...HOLDING_SAGE_CHANGE_STATUSES, ...input.seen],
  }
}

/** noNewSageHoldGuard as a Drizzle condition, for a record whose id is `entityId`. */
export function noNewSageHoldCondition(input: {
  readonly organizationId: string
  readonly kind: string
  readonly entityId: string
  readonly seen: readonly string[]
}): SQL | undefined {
  if (!HOLDING_KINDS.has(input.kind)) return undefined
  const list = (values: readonly string[]): SQL => sql`(${sql.join(values.map((value) => sql`${value}`), sql`, `)})`
  const seen = input.seen.length > 0 ? sql` AND hold.id NOT IN ${list(input.seen)}` : sql``
  return sql`NOT EXISTS (SELECT 1 FROM sage_contact_change_proposals hold
    WHERE hold.organization_id = ${input.organizationId} AND hold.kind = ${input.kind} AND hold.entity_id = ${input.entityId}
      AND hold.status IN ${list(HOLDING_SAGE_CHANGE_STATUSES)}${seen})`
}

/** Held fields and holding changes of every record of one kind, for list-wide syncs (one query). */
export async function sageHoldsByEntity(
  db: Db,
  organizationId: string,
  kind: string
): Promise<ReadonlyMap<string, SageHolds>> {
  const holds = new Map<string, { fields: Set<string>; proposalIds: string[] }>()
  if (!HOLDING_KINDS.has(kind)) return holds
  const rows = await db.select({
    id: sageContactChangeProposals.id,
    entityId: sageContactChangeProposals.entityId,
    changesJson: sageContactChangeProposals.changesJson,
  }).from(sageContactChangeProposals).where(and(
    eq(sageContactChangeProposals.organizationId, organizationId),
    eq(sageContactChangeProposals.kind, kind),
    inArray(sageContactChangeProposals.status, [...HOLDING_SAGE_CHANGE_STATUSES])
  ))
  for (const row of rows) {
    const entry = holds.get(row.entityId) ?? { fields: new Set<string>(), proposalIds: [] }
    for (const field of changedFields(row.changesJson)) entry.fields.add(field)
    entry.proposalIds.push(row.id)
    holds.set(row.entityId, entry)
  }
  return holds
}

/** The record's latest unfinished Sage change, if any. */
export async function holdingSageChange(
  db: Db,
  organizationId: string,
  kind: string,
  entityId: string
): Promise<typeof sageContactChangeProposals.$inferSelect | undefined> {
  if (!HOLDING_KINDS.has(kind)) return undefined
  return db.select().from(sageContactChangeProposals).where(and(
    eq(sageContactChangeProposals.organizationId, organizationId),
    eq(sageContactChangeProposals.kind, kind),
    eq(sageContactChangeProposals.entityId, entityId),
    inArray(sageContactChangeProposals.status, [...HOLDING_SAGE_CHANGE_STATUSES])
  )).orderBy(desc(sageContactChangeProposals.requestedAt)).limit(1).get()
}

/** Every unfinished Sage change of one record, oldest first. */
export async function holdingSageChanges(
  db: Db,
  organizationId: string,
  kind: string,
  entityId: string
): Promise<readonly (typeof sageContactChangeProposals.$inferSelect)[]> {
  if (!HOLDING_KINDS.has(kind)) return []
  return db.select().from(sageContactChangeProposals).where(and(
    eq(sageContactChangeProposals.organizationId, organizationId),
    eq(sageContactChangeProposals.kind, kind),
    eq(sageContactChangeProposals.entityId, entityId),
    inArray(sageContactChangeProposals.status, [...HOLDING_SAGE_CHANGE_STATUSES])
  )).orderBy(asc(sageContactChangeProposals.requestedAt), asc(sageContactChangeProposals.id))
}

/** `fields` without the held ones. */
export function withoutHeldFields<T>(
  fields: Readonly<Record<string, T>>,
  held: ReadonlySet<string>
): Readonly<Record<string, T>> {
  if (held.size === 0) return fields
  return Object.fromEntries(Object.entries(fields).filter(([field]) => !held.has(field)))
}
