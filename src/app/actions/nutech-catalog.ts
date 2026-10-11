"use server"

import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import { getDb } from "@/db"
import { sageCostCodes } from "@/db/schema"
import {
  nuTechCatalogPrices,
  nuTechCatalogVersions,
  nuTechOrderWorkflows,
  nuTechProducts,
} from "@/db/schema-nutech"
import { requireAuth } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import { isDemoUser } from "@/lib/demo"
import { getOrganizationDriveContext } from "@/lib/google/organization-drive"
import { buildNuTechCatalogImport } from "@/lib/nutech/catalog-import"
import { ensureNuTechFreightProduct, isNuTechFreight } from "@/lib/nutech/freight"
import { projectEstimateCostCodeCatalog } from "@/lib/estimates/project-cost-code-catalog"
import {
  NUTECH_2026_CATALOG_SOURCES,
  nuTechCatalogSourceRange,
  spreadsheetIdFromValue,
} from "@/lib/nutech/resources"
import { readFeatureSettings } from "@/lib/feature-settings/server"
import { canEditFeatureSettings } from "@/lib/feature-settings/registry"
import { chunkD1Rows, chunkD1Values } from "@/lib/d1-query"
import { requireOrg } from "@/lib/org-scope"
import {
  canFeature,
  requireFeaturePermission,
} from "@/lib/permission-enforcement"

export type NuTechCatalogVersionSummary = {
  readonly id: string
  readonly name: string
  readonly effectiveDate: string
  readonly status: string
  readonly productCount: number
  readonly importedAt: string
  readonly activatedAt: string | null
}

export type NuTechCatalogProductItem = {
  readonly id: string
  readonly manufacturerSku: string
  readonly name: string
  readonly category: string
  readonly origin: string
  readonly priceUnit: string
  readonly packageLabel: string
  readonly minimumOrderIncrement: number
  readonly airliteMappingStatus: string
  readonly airliteTemplateRow: number | null
  readonly sageMappingStatus: string
  readonly sageCostCodeId: string | null
  readonly sageCostCodeLabel: string | null
  readonly sageCostCodeName: string | null
  readonly taxable: boolean
  /** Freight: its amount is quoted per order, not priced here. */
  readonly quotedPerOrder: boolean
  readonly airliteCostCents: number
  readonly newStandardPriceCents: number
  readonly newCashPriceCents: number
  readonly returningStandardPriceCents: number
  readonly returningCashPriceCents: number
}

export type NuTechCatalogWorkspace = {
  readonly canImport: boolean
  readonly canDelete: boolean
  /** Where the next import reads from (Settings → Workflows → Nu-Tech product catalog). */
  readonly priceSources: {
    readonly catalogName: string
    readonly effectiveDate: string
    readonly sourceTab: string
    readonly sheets: readonly { readonly label: string; readonly id: string | null }[]
  }
  readonly canEditPriceSources: boolean
  readonly versions: readonly NuTechCatalogVersionSummary[]
  readonly activeVersionId: string | null
  readonly products: readonly NuTechCatalogProductItem[]
  readonly sageCostCodes: readonly {
    readonly id: string
    readonly code: string
    readonly description: string
    readonly displayLabel: string
  }[]
  /** Named company cost codes (e.g. "ICF Shipping") that aren't numbered Sage codes. */
  readonly namedCostCodes: readonly { readonly name: string; readonly label: string }[]
}

/** A price-list item's Sage cost code: a numbered code, a named company code, or none. */
export type NuTechProductCostCodeMapping =
  | { readonly kind: "sage"; readonly id: string }
  | { readonly kind: "named"; readonly name: string }
  | null

export type NuTechCatalogActionResult =
  | { readonly success: true; readonly id: string; readonly productCount?: number }
  | { readonly success: false; readonly error: string }

function errorResult(error: unknown, fallback: string): NuTechCatalogActionResult {
  return {
    success: false,
    error: error instanceof Error ? error.message : fallback,
  }
}

function revalidateCatalogPaths(): void {
  revalidatePath("/dashboard/nutech")
  revalidatePath("/dashboard/nutech/catalog")
}

async function sourceHash(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(value))
  const digest = await crypto.subtle.digest("SHA-256", bytes)
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("")
}

export async function getNuTechCatalogWorkspace(): Promise<NuTechCatalogWorkspace> {
  const user = await requireAuth()
  await requireFeaturePermission(user, "nutech-orders", "read")
  const organizationId = requireOrg(user)
  const { env } = await getCloudflareContext()
  const db = getDb(env.DB)
  const [versionRows, priceRows, sageRows, canImport, canDelete] =
    await Promise.all([
      db
        .select()
        .from(nuTechCatalogVersions)
        .where(eq(nuTechCatalogVersions.organizationId, organizationId))
        .orderBy(desc(nuTechCatalogVersions.effectiveDate)),
      db
        .select({
          versionId: nuTechCatalogPrices.catalogVersionId,
          productId: nuTechProducts.id,
          manufacturerSku: nuTechProducts.manufacturerSku,
          name: nuTechProducts.name,
          category: nuTechProducts.category,
          origin: nuTechProducts.origin,
          priceUnit: nuTechProducts.priceUnit,
          packageLabel: nuTechProducts.packageLabel,
          minimumOrderIncrement: nuTechProducts.minimumOrderIncrement,
          airliteMappingStatus: nuTechProducts.airliteMappingStatus,
          airliteTemplateRow: nuTechProducts.airliteTemplateRow,
          sageMappingStatus: nuTechProducts.sageMappingStatus,
          sageCostCodeId: nuTechProducts.sageCostCodeId,
          sageCostCodeLabel: sageCostCodes.displayLabel,
          sageCostCodeName: nuTechProducts.sageCostCodeName,
          taxable: nuTechProducts.taxable,
          airliteCostCents: nuTechCatalogPrices.airliteCostCents,
          newStandardPriceCents: nuTechCatalogPrices.newStandardPriceCents,
          newCashPriceCents: nuTechCatalogPrices.newCashPriceCents,
          returningStandardPriceCents:
            nuTechCatalogPrices.returningStandardPriceCents,
          returningCashPriceCents: nuTechCatalogPrices.returningCashPriceCents,
        })
        .from(nuTechCatalogPrices)
        .innerJoin(
          nuTechProducts,
          eq(nuTechProducts.id, nuTechCatalogPrices.productId)
        )
        .leftJoin(sageCostCodes, eq(sageCostCodes.id, nuTechProducts.sageCostCodeId))
        .where(eq(nuTechProducts.organizationId, organizationId))
        .orderBy(asc(nuTechProducts.category), asc(nuTechProducts.manufacturerSku)),
      db
        .select({
          id: sageCostCodes.id,
          code: sageCostCodes.code,
          description: sageCostCodes.description,
          displayLabel: sageCostCodes.displayLabel,
          divisionCode: sageCostCodes.divisionCode,
          divisionDescription: sageCostCodes.divisionDescription,
          divisionDisplayLabel: sageCostCodes.divisionDisplayLabel,
        })
        .from(sageCostCodes)
        .where(eq(sageCostCodes.active, true))
        .orderBy(asc(sageCostCodes.displayLabel)),
      canFeature(user, "nutech-orders", "approve"),
      canFeature(user, "nutech-orders", "delete"),
    ])
  const activeVersion = versionRows.find((version) => version.status === "active")
  // Catalogs imported before Freight existed get it the first time an approver opens the page.
  if (
    activeVersion &&
    canImport &&
    !isDemoUser(user.id) &&
    !priceRows.some((row) => row.versionId === activeVersion.id && isNuTechFreight(row))
  ) {
    await ensureNuTechFreightProduct(db, organizationId, activeVersion.id)
    return getNuTechCatalogWorkspace()
  }
  const sageCodes = new Set(sageRows.map((row) => row.code))
  const sources = await readFeatureSettings(db, organizationId, "nutech-price-sources")
  return {
    canImport: canImport && !isDemoUser(user.id),
    canDelete: canDelete && !isDemoUser(user.id),
    priceSources: {
      catalogName: sources.catalogName,
      effectiveDate: sources.effectiveDate,
      sourceTab: sources.sourceTab,
      sheets: [
        { label: "New client – standard", id: spreadsheetIdFromValue(sources.newStandardSheet) },
        { label: "New client – cash", id: spreadsheetIdFromValue(sources.newCashSheet) },
        { label: "Returning customer – standard", id: spreadsheetIdFromValue(sources.returningStandardSheet) },
        { label: "Returning customer – cash", id: spreadsheetIdFromValue(sources.returningCashSheet) },
      ],
    },
    canEditPriceSources: canEditFeatureSettings(user.role, "nutech-price-sources"),
    activeVersionId: activeVersion?.id ?? null,
    versions: versionRows.map((version) => ({
      id: version.id,
      name: version.name,
      effectiveDate: version.effectiveDate,
      status: version.status,
      productCount: priceRows.filter((row) => row.versionId === version.id).length,
      importedAt: version.importedAt,
      activatedAt: version.activatedAt,
    })),
    products: activeVersion
      ? priceRows
          .filter((row) => row.versionId === activeVersion.id)
          .map((row) => ({
            id: row.productId,
            manufacturerSku: row.manufacturerSku,
            name: row.name,
            category: row.category,
            origin: row.origin,
            priceUnit: row.priceUnit,
            packageLabel: row.packageLabel,
            minimumOrderIncrement: row.minimumOrderIncrement,
            airliteMappingStatus: row.airliteMappingStatus,
            airliteTemplateRow: row.airliteTemplateRow,
            sageMappingStatus: row.sageMappingStatus,
            sageCostCodeId: row.sageCostCodeId,
            sageCostCodeLabel: row.sageCostCodeLabel ?? row.sageCostCodeName,
            sageCostCodeName: row.sageCostCodeName,
            taxable: row.taxable,
            quotedPerOrder: isNuTechFreight(row),
            airliteCostCents: row.airliteCostCents,
            newStandardPriceCents: row.newStandardPriceCents,
            newCashPriceCents: row.newCashPriceCents,
            returningStandardPriceCents: row.returningStandardPriceCents,
            returningCashPriceCents: row.returningCashPriceCents,
          }))
      : [],
    sageCostCodes: sageRows.map((row) => ({ id: row.id, code: row.code, description: row.description, displayLabel: row.displayLabel })),
    namedCostCodes: projectEstimateCostCodeCatalog(sageRows, [])
      .filter((item) => !sageCodes.has(item.code))
      .map((item) => ({ name: item.code, label: item.displayLabel })),
  }
}

export async function importNuTechCatalog(): Promise<NuTechCatalogActionResult> {
  try {
    const user = await requireAuth()
    if (isDemoUser(user.id)) throw new Error("DEMO_READ_ONLY")
    await requireFeaturePermission(user, "nutech-orders", "approve")
    const organizationId = requireOrg(user)
    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)
    // The sheets come from Settings → Workflows → Nu-Tech product catalog, so
    // a new price year doesn't need a code change.
    const sources = await readFeatureSettings(db, organizationId, "nutech-price-sources")
    const sheetIds = {
      newStandard: spreadsheetIdFromValue(sources.newStandardSheet),
      newCash: spreadsheetIdFromValue(sources.newCashSheet),
      returningStandard: spreadsheetIdFromValue(sources.returningStandardSheet),
      returningCash: spreadsheetIdFromValue(sources.returningCashSheet),
    }
    if (
      !sheetIds.newStandard ||
      !sheetIds.newCash ||
      !sheetIds.returningStandard ||
      !sheetIds.returningCash
    ) {
      throw new Error(
        "Check the price sheet links in Settings → Workflows → Nu-Tech product catalog."
      )
    }
    const { sheetsClient, userEmail } = await getOrganizationDriveContext({
      db,
      environment: env,
      organizationId,
      user,
    })
    const sourceIds = [
      sheetIds.newStandard,
      sheetIds.newCash,
      sheetIds.returningStandard,
      sheetIds.returningCash,
    ]
    const sourceRows = await Promise.all(
      sourceIds.map((spreadsheetId) =>
        sheetsClient.getValues(userEmail, {
          spreadsheetId,
          range: nuTechCatalogSourceRange(sources.sourceTab),
          valueRenderOption: "UNFORMATTED_VALUE",
        })
      )
    )
    const newStandardRows = sourceRows[0]
    const newCashRows = sourceRows[1]
    const returningStandardRows = sourceRows[2]
    const returningCashRows = sourceRows[3]
    if (
      !newStandardRows ||
      !newCashRows ||
      !returningStandardRows ||
      !returningCashRows
    ) {
      throw new Error(
        `One or more Nu-Tech price sheets could not be read. Check the links and the "${sources.sourceTab}" tab in Settings → Workflows → Nu-Tech product catalog.`
      )
    }
    const imported = buildNuTechCatalogImport({
      newStandard: newStandardRows,
      newCash: newCashRows,
      returningStandard: returningStandardRows,
      returningCash: returningCashRows,
    })
    const hash = await sourceHash(imported)
    const now = new Date().toISOString()
    const existingVersions = await db
      .select({
        id: nuTechCatalogVersions.id,
        name: nuTechCatalogVersions.name,
        status: nuTechCatalogVersions.status,
        sourceHash: nuTechCatalogVersions.sourceHash,
      })
      .from(nuTechCatalogVersions)
      .where(eq(nuTechCatalogVersions.organizationId, organizationId))
    const matchingVersion = existingVersions.find(
      (version) => version.sourceHash === hash
    )
    if (matchingVersion && matchingVersion.status !== "draft") {
      await ensureNuTechFreightProduct(db, organizationId, matchingVersion.id)
      return {
        success: true,
        id: matchingVersion.id,
        productCount: imported.products.length,
      }
    }
    const baseDraft = existingVersions.find(
      (version) =>
        version.name === sources.catalogName &&
        version.status === "draft"
    )
    const existingVersion = matchingVersion ?? baseDraft
    const versionName =
      existingVersion?.name ??
      (existingVersions.some(
        (version) => version.name === sources.catalogName
      )
        ? `${sources.catalogName} · revision ${hash.slice(0, 8)}`
        : sources.catalogName)
    const versionId = existingVersion?.id ?? crypto.randomUUID()
    await db
      .insert(nuTechCatalogVersions)
      .values({
        id: versionId,
        organizationId,
        name: versionName,
        effectiveDate: sources.effectiveDate,
        status: existingVersion?.status ?? "draft",
        newStandardSheetId: sheetIds.newStandard,
        newCashSheetId: sheetIds.newCash,
        returningStandardSheetId: sheetIds.returningStandard,
        returningCashSheetId: sheetIds.returningCash,
        airliteTemplateId: NUTECH_2026_CATALOG_SOURCES.airliteTemplateId,
        sourceHash: hash,
        importedAt: now,
        importedBy: user.id,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [nuTechCatalogVersions.organizationId, nuTechCatalogVersions.name],
        set: {
          // Refreshing a draft picks up sheet links changed in Settings.
          effectiveDate: sources.effectiveDate,
          newStandardSheetId: sheetIds.newStandard,
          newCashSheetId: sheetIds.newCash,
          returningStandardSheetId: sheetIds.returningStandard,
          returningCashSheetId: sheetIds.returningCash,
          sourceHash: hash,
          importedAt: now,
          importedBy: user.id,
          updatedAt: now,
        },
      })

    const existingProducts = await db
      .select({ id: nuTechProducts.id, manufacturerSku: nuTechProducts.manufacturerSku })
      .from(nuTechProducts)
      .where(eq(nuTechProducts.organizationId, organizationId))
    const existingIds = new Map(
      existingProducts.map((product) => [product.manufacturerSku, product.id])
    )
    const productRows = imported.products.map((product) => ({
      id: existingIds.get(product.manufacturerSku) ?? crypto.randomUUID(),
      organizationId,
      manufacturerSku: product.manufacturerSku,
      name: product.name,
      category: product.category,
      origin: product.origin,
      priceUnit: product.priceUnit,
      packageQuantity: product.packageQuantity,
      packageLabel: product.packageLabel,
      minimumOrderIncrement: product.minimumOrderIncrement,
      squareFeetPerUnitMils: product.squareFeetPerUnitMils,
      airliteTemplateSku: product.airliteTemplateSku,
      airliteTemplateRow: product.airliteTemplateRow,
      airliteMappingStatus: product.airliteMappingStatus,
      active: true,
      createdAt: now,
      updatedAt: now,
    }))
    // One INSERT per chunk: D1 caps bound parameters at 100 per statement.
    const productConflictSet = {
      name: sql`excluded.name`,
      category: sql`excluded.category`,
      origin: sql`excluded.origin`,
      priceUnit: sql`excluded.price_unit`,
      packageQuantity: sql`excluded.package_quantity`,
      packageLabel: sql`excluded.package_label`,
      minimumOrderIncrement: sql`excluded.minimum_order_increment`,
      squareFeetPerUnitMils: sql`excluded.square_feet_per_unit_mils`,
      airliteTemplateSku: sql`excluded.airlite_template_sku`,
      airliteTemplateRow: sql`excluded.airlite_template_row`,
      airliteMappingStatus: sql`excluded.airlite_mapping_status`,
      active: true,
      updatedAt: now,
    }
    const productInserts = chunkD1Rows(productRows, 2).map((chunk) =>
      db
        .insert(nuTechProducts)
        .values(chunk)
        .onConflictDoUpdate({
          target: [nuTechProducts.organizationId, nuTechProducts.manufacturerSku],
          set: productConflictSet,
        })
    )
    const [firstProductInsert, ...restProductInserts] = productInserts
    if (firstProductInsert) await db.batch([firstProductInsert, ...restProductInserts])
    const storedProducts = (
      await Promise.all(
        chunkD1Values(imported.products.map((product) => product.manufacturerSku)).map((skus) =>
          db
            .select({ id: nuTechProducts.id, manufacturerSku: nuTechProducts.manufacturerSku })
            .from(nuTechProducts)
            .where(and(eq(nuTechProducts.organizationId, organizationId), inArray(nuTechProducts.manufacturerSku, skus)))
        )
      )
    ).flat()
    const storedIds = new Map(
      storedProducts.map((product) => [product.manufacturerSku, product.id])
    )
    const priceRows = imported.products.map((product) => {
      const productId = storedIds.get(product.manufacturerSku)
      if (!productId) throw new Error(`Catalog product ${product.manufacturerSku} was not saved.`)
      return {
        id: crypto.randomUUID(),
        catalogVersionId: versionId,
        productId,
        airliteCostCents: product.airliteCostCents,
        newStandardPriceCents: product.newStandardPriceCents,
        newCashPriceCents: product.newCashPriceCents,
        returningStandardPriceCents: product.returningStandardPriceCents,
        returningCashPriceCents: product.returningCashPriceCents,
        newStandardMarginBasisPoints: product.newStandardMarginBasisPoints,
        newCashMarginBasisPoints: product.newCashMarginBasisPoints,
        returningStandardMarginBasisPoints:
          product.returningStandardMarginBasisPoints,
        returningCashMarginBasisPoints: product.returningCashMarginBasisPoints,
        createdAt: now,
        updatedAt: now,
      }
    })
    await db.batch([
      db
        .delete(nuTechCatalogPrices)
        .where(eq(nuTechCatalogPrices.catalogVersionId, versionId)),
      ...chunkD1Rows(priceRows).map((chunk) => db.insert(nuTechCatalogPrices).values(chunk)),
    ])
    await ensureNuTechFreightProduct(db, organizationId, versionId)
    revalidateCatalogPaths()
    return { success: true, id: versionId, productCount: priceRows.length }
  } catch (error) {
    return errorResult(error, "Failed to import the 2026 Nu-Tech catalog.")
  }
}

export async function activateNuTechCatalogVersion(
  versionId: string
): Promise<NuTechCatalogActionResult> {
  try {
    const user = await requireAuth()
    if (isDemoUser(user.id)) throw new Error("DEMO_READ_ONLY")
    await requireFeaturePermission(user, "nutech-orders", "approve")
    const organizationId = requireOrg(user)
    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)
    const version = await db
      .select({ id: nuTechCatalogVersions.id })
      .from(nuTechCatalogVersions)
      .where(
        and(
          eq(nuTechCatalogVersions.id, versionId),
          eq(nuTechCatalogVersions.organizationId, organizationId)
        )
      )
      .limit(1)
      .get()
    if (!version) throw new Error("Nu-Tech catalog version not found.")
    await ensureNuTechFreightProduct(db, organizationId, versionId)
    const now = new Date().toISOString()
    await db.batch([
      db
        .update(nuTechCatalogVersions)
        .set({ status: "archived", updatedAt: now })
        .where(
          and(
            eq(nuTechCatalogVersions.organizationId, organizationId),
            eq(nuTechCatalogVersions.status, "active"),
            ne(nuTechCatalogVersions.id, versionId)
          )
        ),
      db
        .update(nuTechCatalogVersions)
        .set({
          status: "active",
          activatedAt: now,
          activatedBy: user.id,
          updatedAt: now,
        })
        .where(eq(nuTechCatalogVersions.id, versionId)),
    ])
    revalidateCatalogPaths()
    return { success: true, id: versionId }
  } catch (error) {
    return errorResult(error, "Failed to activate the Nu-Tech catalog.")
  }
}

export async function mapNuTechProductToSageCostCode(
  productId: string,
  mapping: NuTechProductCostCodeMapping
): Promise<NuTechCatalogActionResult> {
  try {
    const user = await requireAuth()
    if (isDemoUser(user.id)) throw new Error("DEMO_READ_ONLY")
    await requireFeaturePermission(user, "nutech-orders", "approve")
    const organizationId = requireOrg(user)
    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)
    const product = await db
      .select({ id: nuTechProducts.id })
      .from(nuTechProducts)
      .where(
        and(
          eq(nuTechProducts.id, productId),
          eq(nuTechProducts.organizationId, organizationId)
        )
      )
      .limit(1)
      .get()
    if (!product) throw new Error("Nu-Tech product not found.")
    const sageCostCodeId = mapping?.kind === "sage" ? mapping.id : null
    const sageCostCodeName = mapping?.kind === "named" ? mapping.name.trim() || null : null
    if (sageCostCodeId !== null) {
      const costCode = await db
        .select({ id: sageCostCodes.id })
        .from(sageCostCodes)
        .where(and(eq(sageCostCodes.id, sageCostCodeId), eq(sageCostCodes.active, true)))
        .limit(1)
        .get()
      if (!costCode) throw new Error("Choose an active Sage cost code.")
    }
    const now = new Date().toISOString()
    await db
      .update(nuTechProducts)
      .set({
        sageCostCodeId,
        sageCostCodeName,
        sageMappingStatus: mapping === null ? "unmapped" : "mapped",
        sageMappedAt: mapping === null ? null : now,
        sageMappedBy: mapping === null ? null : user.id,
        updatedAt: now,
      })
      .where(eq(nuTechProducts.id, productId))
    revalidateCatalogPaths()
    return { success: true, id: productId }
  } catch (error) {
    return errorResult(error, "Failed to update the Sage cost-code mapping.")
  }
}

/** Whether a price-list item is sales-taxable on estimates and order totals. */
export async function setNuTechProductTaxable(productId: string, taxable: boolean): Promise<NuTechCatalogActionResult> {
  try {
    const user = await requireAuth()
    if (isDemoUser(user.id)) throw new Error("DEMO_READ_ONLY")
    await requireFeaturePermission(user, "nutech-orders", "approve")
    const organizationId = requireOrg(user)
    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)
    const updated = await db
      .update(nuTechProducts)
      .set({ taxable, updatedAt: new Date().toISOString() })
      .where(and(eq(nuTechProducts.id, productId), eq(nuTechProducts.organizationId, organizationId)))
      .returning({ id: nuTechProducts.id })
    if (updated.length === 0) throw new Error("Nu-Tech product not found.")
    revalidateCatalogPaths()
    return { success: true, id: productId }
  } catch (error) {
    return errorResult(error, "Failed to update the tax setting.")
  }
}

export async function deleteNuTechCatalogVersion(
  versionId: string
): Promise<NuTechCatalogActionResult> {
  try {
    const user = await requireAuth()
    if (isDemoUser(user.id)) throw new Error("DEMO_READ_ONLY")
    await requireFeaturePermission(user, "nutech-orders", "delete")
    const organizationId = requireOrg(user)
    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)
    const version = await db
      .select({ id: nuTechCatalogVersions.id, status: nuTechCatalogVersions.status })
      .from(nuTechCatalogVersions)
      .where(
        and(
          eq(nuTechCatalogVersions.id, versionId),
          eq(nuTechCatalogVersions.organizationId, organizationId)
        )
      )
      .limit(1)
      .get()
    if (!version) throw new Error("Nu-Tech catalog version not found.")
    if (version.status !== "draft") {
      throw new Error("Only a draft catalog version can be deleted.")
    }
    const linkedOrder = await db
      .select({ id: nuTechOrderWorkflows.id })
      .from(nuTechOrderWorkflows)
      .where(eq(nuTechOrderWorkflows.catalogVersionId, versionId))
      .limit(1)
      .get()
    if (linkedOrder) throw new Error("This catalog is already linked to a Nu-Tech order.")
    await db
      .delete(nuTechCatalogVersions)
      .where(eq(nuTechCatalogVersions.id, versionId))
    revalidateCatalogPaths()
    return { success: true, id: versionId }
  } catch (error) {
    return errorResult(error, "Failed to delete the Nu-Tech catalog version.")
  }
}
