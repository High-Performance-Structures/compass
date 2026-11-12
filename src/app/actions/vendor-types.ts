"use server"

import { and, count, eq, isNotNull } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { z } from "zod/v4"

import { sageVendorDirectoryEntries } from "@/db/schema-sage"
import { actionFailure, type ActionFailure } from "@/lib/action-result"
import { vendorCountsByType } from "@/lib/domain/contacts/directory-page"
import { moveVendorsToType } from "@/lib/domain/contacts/store"
import { readVendorTypes } from "@/lib/feature-settings/vendor-types-server"
import { vendorTypeNamed } from "@/lib/feature-settings/vendor-types-settings"
import { orgContext } from "@/lib/server/action-context"

/**
 * Settings › Company › Vendor types, beyond the setting itself: how many
 * vendors have each type, the types Sage uses that aren't listed yet, and
 * carrying a rename or removal over to the vendors that have the type.
 */
export type VendorTypeUsage = {
  /** Active vendors per type name, lowercased. */
  readonly vendorCounts: Readonly<Record<string, number>>
  /** Types on Sage vendors that are not on the company's list, with how many Sage vendors have each. */
  readonly sageTypesNotListed: readonly { readonly name: string; readonly count: number }[]
}

export async function getVendorTypeUsage(): Promise<{ readonly success: true; readonly data: VendorTypeUsage } | ActionFailure> {
  const context = await orgContext({ feature: "vendors", action: "read" })
  if (!context.success) return context
  const { db, organizationId } = context.data
  const [vendorCounts, sageRows, types] = await Promise.all([
    vendorCountsByType(db, organizationId),
    db
      .select({ type: sageVendorDirectoryEntries.vendorType, n: count() })
      .from(sageVendorDirectoryEntries)
      .where(and(eq(sageVendorDirectoryEntries.organizationId, organizationId), isNotNull(sageVendorDirectoryEntries.vendorType)))
      .groupBy(sageVendorDirectoryEntries.vendorType),
    readVendorTypes(db, organizationId),
  ])
  return {
    success: true,
    data: {
      vendorCounts,
      sageTypesNotListed: sageRows.flatMap((row) => {
        const name = row.type?.trim() ?? ""
        return name && !vendorTypeNamed(types, name) ? [{ name, count: row.n }] : []
      }),
    },
  }
}

const changesSchema = z.object({
  moves: z.array(z.object({ from: z.string().trim().min(1).max(60), to: z.string().trim().min(1).max(60) })).max(60),
})

/**
 * Moves vendors from renamed or removed types onto their new type. Called
 * after the vendor-types setting is saved; every target must be on the saved
 * list, so a vendor can never land on a type the company doesn't have.
 */
export async function applyVendorTypeMoves(
  raw: z.input<typeof changesSchema>,
): Promise<{ readonly success: true; readonly moved: number } | ActionFailure> {
  const parsed = changesSchema.safeParse(raw)
  if (!parsed.success) return actionFailure("Check the vendor type changes.")
  const context = await orgContext({ feature: "vendors", action: "update", mutation: true })
  if (!context.success) return context
  const { db, organizationId } = context.data
  const types = await readVendorTypes(db, organizationId)
  const moves = parsed.data.moves.filter((move) => move.from.toLowerCase() !== move.to.toLowerCase())
  if (moves.some((move) => !vendorTypeNamed(types, move.to))) return actionFailure("Vendors can only move to a type on the list.")
  const now = new Date().toISOString()
  let moved = 0
  for (const move of moves) moved += await moveVendorsToType(db, { organizationId, from: move.from, to: move.to, now })
  revalidatePath("/dashboard/contacts")
  return { success: true, moved }
}
