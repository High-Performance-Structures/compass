import "server-only"

import { and, eq, isNull } from "drizzle-orm"

import { customers } from "@/db/schema"
import { sageClientDirectoryEntries } from "@/db/schema-sage"
import { sageClientIdFromDirectoryStatement } from "@/lib/domain/contacts/store"
import { directoryClientIdFor } from "@/lib/sage/client-directory-match"
import type { Db } from "@/lib/server/action-context"

/**
 * Many clients were imported from Sage with only their Sage client number.
 * Sage changes are addressed by the stable Sage id, so an edit on such a
 * client used to save in Compass only and never reach Sage. When the Sage
 * client directory (read from Sage by the writer) has exactly that number
 * under the same name, and no other client claims it, the id is filled in.
 *
 * Returns true only when this call linked the client.
 */
export async function linkSageClientIdFromDirectory(
  db: Db,
  database: D1Database,
  organizationId: string,
  customerId: string
): Promise<boolean> {
  const customer = await db.select({
    name: customers.name, sageClientId: customers.sageClientId, sageClientNumber: customers.sageClientNumber,
  }).from(customers).where(and(
    eq(customers.id, customerId), eq(customers.organizationId, organizationId), isNull(customers.mergedIntoCustomerId)
  )).get()
  const number = customer?.sageClientNumber?.trim()
  if (!customer || !number || customer.sageClientId?.trim()) return false
  const entry = await db.select({
    sageRecordId: sageClientDirectoryEntries.sageRecordId,
    sageClientNumber: sageClientDirectoryEntries.sageClientNumber,
    name: sageClientDirectoryEntries.name,
  }).from(sageClientDirectoryEntries).where(and(
    eq(sageClientDirectoryEntries.organizationId, organizationId),
    eq(sageClientDirectoryEntries.sageClientNumber, number)
  )).get()
  const sageClientId = directoryClientIdFor(customer, entry)
  if (!sageClientId) return false
  const result = await sageClientIdFromDirectoryStatement(database, {
    customerId, organizationId, sageClientId, sageClientNumber: number, now: new Date().toISOString(),
  }).run()
  return result.meta.changes === 1
}
