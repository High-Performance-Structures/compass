import { and, eq } from "drizzle-orm"

import type { getDb } from "@/db"
import { sageCostCodes } from "@/db/schema"
import { nuTechCatalogPrices, nuTechProducts } from "@/db/schema-nutech"

/**
 * Freight lives on the price list as its own item so it carries a Sage cost
 * code and is non-taxable, but its amount is quoted per order (the order's
 * shipping charge), so its list prices are zero and it never appears in the
 * order's product picker.
 */
export const NUTECH_FREIGHT_SKU = "FREIGHT"
export const NUTECH_FREIGHT_CATEGORY = "freight"

export function isNuTechFreight(product: { readonly category: string }): boolean {
  return product.category === NUTECH_FREIGHT_CATEGORY
}

type Db = ReturnType<typeof getDb>

/** Adds the Freight item (and its zero price row) to a catalog version if missing. Imports and edits never overwrite its mapping or tax setting. */
export async function ensureNuTechFreightProduct(db: Db, organizationId: string, catalogVersionId: string): Promise<void> {
  const now = new Date().toISOString()
  await db
    .insert(nuTechProducts)
    .values({
      id: crypto.randomUUID(),
      organizationId,
      manufacturerSku: NUTECH_FREIGHT_SKU,
      name: "Freight",
      category: NUTECH_FREIGHT_CATEGORY,
      origin: "Quoted per order",
      priceUnit: "load",
      packageQuantity: 1,
      packageLabel: "Quoted per order",
      minimumOrderIncrement: 1,
      airliteMappingStatus: "addendum_required",
      taxable: false,
      active: true,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing({ target: [nuTechProducts.organizationId, nuTechProducts.manufacturerSku] })
  const freight = await db
    .select({ id: nuTechProducts.id })
    .from(nuTechProducts)
    .where(and(eq(nuTechProducts.organizationId, organizationId), eq(nuTechProducts.manufacturerSku, NUTECH_FREIGHT_SKU)))
    .get()
  if (!freight) return
  await db
    .insert(nuTechCatalogPrices)
    .values({
      id: crypto.randomUUID(),
      catalogVersionId,
      productId: freight.id,
      airliteCostCents: 0,
      newStandardPriceCents: 0,
      newCashPriceCents: 0,
      returningStandardPriceCents: 0,
      returningCashPriceCents: 0,
      newStandardMarginBasisPoints: 0,
      newCashMarginBasisPoints: 0,
      returningStandardMarginBasisPoints: 0,
      returningCashMarginBasisPoints: 0,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing({ target: [nuTechCatalogPrices.catalogVersionId, nuTechCatalogPrices.productId] })
}

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
