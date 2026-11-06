"use server"

import { and, asc, eq, isNotNull } from "drizzle-orm"

import { nuTechProducts } from "@/db/schema-nutech"
import { nuTechOrgContext } from "@/lib/domain/nutech/access"
import { requireFeaturePermission } from "@/lib/permission-enforcement"

export type NuTechTruckloadProduct = {
  readonly id: string
  readonly manufacturerSku: string
  readonly name: string
  readonly category: string
  readonly priceUnit: string
  readonly packageQuantity: number
  readonly bundlesPerTruckload: number
}

/** Active products with a truckload size, for the what-if truckload calculator. */
export async function getNuTechTruckloadProducts(): Promise<readonly NuTechTruckloadProduct[]> {
  const { db, user, organizationId } = await nuTechOrgContext()
  await requireFeaturePermission(user, "nutech-orders", "read")
  const rows = await db
    .select({
      id: nuTechProducts.id,
      manufacturerSku: nuTechProducts.manufacturerSku,
      name: nuTechProducts.name,
      category: nuTechProducts.category,
      priceUnit: nuTechProducts.priceUnit,
      packageQuantity: nuTechProducts.packageQuantity,
      bundlesPerTruckload: nuTechProducts.bundlesPerTruckload,
    })
    .from(nuTechProducts)
    .where(
      and(
        eq(nuTechProducts.organizationId, organizationId),
        eq(nuTechProducts.active, true),
        isNotNull(nuTechProducts.bundlesPerTruckload)
      )
    )
    .orderBy(asc(nuTechProducts.manufacturerSku))
  return rows.flatMap((row) => (row.bundlesPerTruckload ? [{ ...row, bundlesPerTruckload: row.bundlesPerTruckload }] : []))
}
