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
import { and, asc, desc, eq, inArray, ne } from "drizzle-orm"
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
  if (!HOLDING_KINDS.has(kind)) return new Set()
  const rows = await db.select({ changesJson: sageContactChangeProposals.changesJson })
    .from(sageContactChangeProposals).where(and(
      eq(sageContactChangeProposals.organizationId, organizationId),
      eq(sageContactChangeProposals.kind, kind),
      eq(sageContactChangeProposals.entityId, entityId),
      inArray(sageContactChangeProposals.status, [...HOLDING_SAGE_CHANGE_STATUSES]),
      options.exceptProposalId ? ne(sageContactChangeProposals.id, options.exceptProposalId) : undefined
    ))
  return new Set(rows.flatMap((row) => changedFields(row.changesJson)))
}

/** Held fields of every record of one kind, for list-wide syncs (one query). */
export async function heldSageFieldsByEntity(
  db: Db,
  organizationId: string,
  kind: string
): Promise<ReadonlyMap<string, ReadonlySet<string>>> {
  const held = new Map<string, Set<string>>()
  if (!HOLDING_KINDS.has(kind)) return held
  const rows = await db.select({
    entityId: sageContactChangeProposals.entityId,
    changesJson: sageContactChangeProposals.changesJson,
  }).from(sageContactChangeProposals).where(and(
    eq(sageContactChangeProposals.organizationId, organizationId),
    eq(sageContactChangeProposals.kind, kind),
    inArray(sageContactChangeProposals.status, [...HOLDING_SAGE_CHANGE_STATUSES])
  ))
  for (const row of rows) {
    const fields = held.get(row.entityId) ?? new Set<string>()
    for (const field of changedFields(row.changesJson)) fields.add(field)
    held.set(row.entityId, fields)
  }
  return held
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
