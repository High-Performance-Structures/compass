import "server-only"

import { and, eq } from "drizzle-orm"

import { sageVendorDirectoryEntries } from "@/db/schema-sage"
import { compassCategoryForSageType } from "@/lib/domain/sage-bridge/vendor-directory-updates"
import { readFeatureSettings } from "@/lib/feature-settings/server"
import type { Db } from "@/lib/server/action-context"

/**
 * Sage's vendor type when it sets this Sage-linked vendor's Compass category
 * (the daily Sage vendor list applies it, #1142), else null. While it does,
 * the category is changed in Sage, not in Compass.
 */
export async function vendorCategoryFromSage(
  db: Db,
  organizationId: string,
  vendor: { readonly sageVendorId: string | null; readonly sageVendorNumber: string | null; readonly category: string }
): Promise<string | null> {
  if (!vendor.sageVendorId && !vendor.sageVendorNumber) return null
  const settings = await readFeatureSettings(db, organizationId, "trade-docs")
  if (!settings.sage.updateVendors) return null
  const entry = await db.select({ vendorType: sageVendorDirectoryEntries.vendorType })
    .from(sageVendorDirectoryEntries).where(and(
      eq(sageVendorDirectoryEntries.organizationId, organizationId),
      vendor.sageVendorNumber
        ? eq(sageVendorDirectoryEntries.sageVendorNumber, vendor.sageVendorNumber)
        : eq(sageVendorDirectoryEntries.sageRecordId, (vendor.sageVendorId ?? "").toLowerCase())
    )).get()
  const type = entry?.vendorType?.trim()
  if (!type) return null
  const categories = [vendor.category, ...settings.docTypes.flatMap((docType) => docType.requiredFor)]
  return compassCategoryForSageType(type, settings.sage.vendorTypes, categories) ? type : null
}

export function sageVendorTypeCategoryError(sageType: string): string {
  return `Category follows the Sage vendor type "${sageType}". Change the vendor type in Sage.`
}
