/**
 * A vendor company's "merge family": the live (surviving) vendor plus every
 * duplicate that was merged into it, directly or through a chain.
 *
 * Merges move references to the kept vendor (company-merge-references.ts),
 * but older "repair" merges and rows written by offline imports can still name
 * an archived duplicate. Readers that match "is this row for this vendor?"
 * compare against the whole family so a merge never hides a row from the
 * company it now belongs to, and never shows it to anyone else.
 */
import { and, eq, inArray } from "drizzle-orm"

import { vendors } from "@/db/schema"
import { chunkD1Values } from "@/lib/d1-query"
import type { Db } from "@/lib/server/action-context"

/** Merge chains are short; the cap only stops a corrupt cycle from looping. */
const MAX_MERGE_HOPS = 8

/**
 * The surviving vendor for `vendorId` and all vendor ids merged into it, in
 * this company. Empty when the vendor is not this company's. Costs one small
 * query per merge hop (usually two queries in total).
 */
export async function vendorMergeFamily(
  db: Db,
  organizationId: string,
  vendorId: string
): Promise<readonly string[]> {
  // Walk up to the survivor.
  let survivorId: string | null = null
  let cursor: string | null = vendorId
  const seenUp = new Set<string>()
  for (let hop = 0; cursor !== null && hop < MAX_MERGE_HOPS && !seenUp.has(cursor); hop += 1) {
    seenUp.add(cursor)
    const [row] = await db
      .select({ id: vendors.id, mergedInto: vendors.mergedIntoVendorId })
      .from(vendors)
      .where(and(eq(vendors.id, cursor), eq(vendors.organizationId, organizationId)))
      .limit(1)
    if (!row) break
    survivorId = row.id
    cursor = row.mergedInto
  }
  if (survivorId === null) return []

  // Walk down to every duplicate merged into it.
  const family = new Set<string>([survivorId])
  let frontier: readonly string[] = [survivorId]
  for (let hop = 0; frontier.length > 0 && hop < MAX_MERGE_HOPS; hop += 1) {
    const chunks = await Promise.all(
      chunkD1Values(frontier).map((chunk) =>
        db
          .select({ id: vendors.id })
          .from(vendors)
          .where(and(inArray(vendors.mergedIntoVendorId, chunk), eq(vendors.organizationId, organizationId)))
      )
    )
    const next = chunks.flat().map((row) => row.id).filter((id) => !family.has(id))
    for (const id of next) family.add(id)
    frontier = next
  }
  return [...family]
}
