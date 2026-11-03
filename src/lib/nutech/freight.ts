import { and, eq } from "drizzle-orm"

import type { getDb } from "@/db"
import { sageCostCodes } from "@/db/schema"
import { nuTechProducts } from "@/db/schema-nutech"

/**
 * Freight lives on the price list as its own item so it carries a Sage cost
 * code and is non-taxable, but its amount is quoted per order (the order's
 * shipping charge), so its list prices are zero and it never appears in the
 * order's product picker. The store adds it to each price list
 * (`ensureNuTechFreightProduct`).
 */
export const NUTECH_FREIGHT_SKU = "FREIGHT"
export const NUTECH_FREIGHT_CATEGORY = "freight"

export function isNuTechFreight(product: { readonly category: string }): boolean {
  return product.category === NUTECH_FREIGHT_CATEGORY
}

type Db = ReturnType<typeof getDb>

/** A product's effective cost code: the mapped Sage code, else its named company code. */
export function nuTechProductCostCode(row: { readonly sageCode: string | null; readonly sageCostCodeName: string | null }): string | null {
  return row.sageCode ?? (row.sageCostCodeName?.trim() || null)
}

/** The price list's Freight item: its cost code (null when unmapped) and whether shipping is taxed. */
export async function loadNuTechFreight(db: Db, organizationId: string): Promise<{ readonly costCode: string | null; readonly taxable: boolean }> {
  const row = await db
    .select({ sageCode: sageCostCodes.code, sageCostCodeName: nuTechProducts.sageCostCodeName, taxable: nuTechProducts.taxable })
    .from(nuTechProducts)
    .leftJoin(sageCostCodes, eq(sageCostCodes.id, nuTechProducts.sageCostCodeId))
    .where(and(eq(nuTechProducts.organizationId, organizationId), eq(nuTechProducts.manufacturerSku, NUTECH_FREIGHT_SKU)))
    .get()
  return { costCode: row ? nuTechProductCostCode(row) : null, taxable: row?.taxable ?? false }
}
