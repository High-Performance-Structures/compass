/**
 * The contacts module's writes for Sage's vendor list: linked vendors taking
 * the values Sage holds (see lib/domain/sage-bridge/vendor-directory-updates).
 * The statements themselves come from store.ts, the vendors table's writer.
 */
import { and, eq, isNotNull, isNull } from "drizzle-orm"

import { vendors } from "@/db/schema"
import type { Db } from "@/lib/server/action-context"
import { sageVendorUpdateStatement, vendorProjectContactNameStatement, type VendorPatch } from "./store"

/** The active vendors linked to a Sage record, with the fields Sage keeps in step. */
export async function listSageLinkedVendors(db: Db, organizationId: string): Promise<readonly SageLinkedVendorRow[]> {
  return db
    .select({
      id: vendors.id,
      sageRecordId: vendors.sageVendorId,
      name: vendors.name,
      category: vendors.category,
      ownerName: vendors.ownerName,
      addressLine1: vendors.addressLine1,
      addressLine2: vendors.addressLine2,
      city: vendors.city,
      state: vendors.state,
      postalCode: vendors.postalCode,
      phone: vendors.phone,
      primaryEmail: vendors.primaryEmail,
      address: vendors.address,
    })
    .from(vendors)
    .where(and(
      eq(vendors.organizationId, organizationId), eq(vendors.directoryStatus, "active"),
      isNull(vendors.mergedIntoVendorId), isNotNull(vendors.sageVendorId)
    ))
}

export type SageLinkedVendorRow = {
  readonly id: string
  readonly sageRecordId: string | null
  readonly name: string
  readonly category: string
  readonly ownerName: string | null
  readonly addressLine1: string | null
  readonly addressLine2: string | null
  readonly city: string | null
  readonly state: string | null
  readonly postalCode: string | null
  readonly phone: string | null
  readonly primaryEmail: string | null
  readonly address: string | null
}

/**
 * Writes the changes Sage's vendor list brought, fenced on the Sage link the
 * plan was made from (see sageVendorUpdateStatement); returns the vendors
 * actually written.
 */
export async function applySageVendorUpdates(
  db: Db,
  input: {
    readonly organizationId: string
    readonly now: string
    readonly updates: readonly { readonly vendorId: string; readonly sageRecordId: string; readonly patch: VendorPatch }[]
  }
): Promise<readonly string[]> {
  const written: string[] = []
  // Small batches keep one D1 call well under its statement limits.
  for (let index = 0; index < input.updates.length; index += 25) {
    const [first, ...rest] = input.updates.slice(index, index + 25)
      .map((update) => sageVendorUpdateStatement(db, { ...update, organizationId: input.organizationId, now: input.now }))
    if (!first) continue
    const results = await db.batch([first, ...rest])
    for (const rows of results) written.push(...rows.map((row) => row.id))
  }
  const renamed = input.updates.flatMap((update) =>
    update.patch.name !== undefined && written.includes(update.vendorId)
      ? [vendorProjectContactNameStatement(db, { vendorId: update.vendorId, name: update.patch.name, now: input.now })]
      : [])
  const [first, ...rest] = renamed
  if (first) await db.batch([first, ...rest])
  return written
}
