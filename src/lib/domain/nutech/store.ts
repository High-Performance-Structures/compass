/**
 * The only code that writes the Nu-Tech tables (architecture standard,
 * section 1): price-list versions, products and prices, orders and their
 * items, and bracing rentals. Callers resolve access first; nothing here
 * checks who is asking. Functions named `…Statement(s)` return statements
 * for the caller's `db.batch`, so writes that must land together (with an
 * audit row or a purchase order) stay in one batch.
 */
import { and, eq, isNull, ne, sql } from "drizzle-orm"
import type { BatchItem } from "drizzle-orm/batch"

import {
  nuTechBracingRentalLines,
  nuTechBracingRentals,
  nuTechCatalogPrices,
  nuTechCatalogVersions,
  nuTechOrderItems,
  nuTechOrderWorkflows,
  nuTechProducts,
  type NewNuTechOrderWorkflow,
} from "@/db/schema-nutech"
import { chunkD1InsertRows } from "@/lib/d1-query"
import { NUTECH_FREIGHT_CATEGORY, NUTECH_FREIGHT_SKU } from "@/lib/nutech/freight"
import type { Db } from "@/lib/server/action-context"

type Statement = BatchItem<"sqlite">

async function runBatch(db: Db, statements: readonly Statement[]): Promise<void> {
  const [first, ...rest] = statements
  if (first) await db.batch([first, ...rest])
}

// ---------------------------------------------------------------------------
// Price list
// ---------------------------------------------------------------------------

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

/** Records an imported price-list version, or refreshes the import stamp of the one with that name. */
export async function upsertNuTechCatalogVersion(
  db: Db,
  values: typeof nuTechCatalogVersions.$inferInsert & { readonly sourceHash: string; readonly importedAt: string; readonly importedBy: string },
): Promise<void> {
  await db
    .insert(nuTechCatalogVersions)
    .values(values)
    .onConflictDoUpdate({
      target: [nuTechCatalogVersions.organizationId, nuTechCatalogVersions.name],
      set: {
        sourceHash: values.sourceHash,
        importedAt: values.importedAt,
        importedBy: values.importedBy,
        updatedAt: values.importedAt,
      },
    })
}

/** Inserts or refreshes imported products by SKU, in one batch of parameter-sized chunks. */
export async function upsertNuTechCatalogProducts(
  db: Db,
  rows: readonly (typeof nuTechProducts.$inferInsert)[],
  now: string,
): Promise<void> {
  // One INSERT per chunk: D1 caps bound parameters at 100 per statement.
  const set = {
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
  await runBatch(
    db,
    chunkD1InsertRows(nuTechProducts, rows, 2).map((chunk) =>
      db
        .insert(nuTechProducts)
        .values(chunk)
        .onConflictDoUpdate({ target: [nuTechProducts.organizationId, nuTechProducts.manufacturerSku], set }),
    ),
  )
}

/** Replaces a version's prices in one batch. */
export async function replaceNuTechCatalogPrices(
  db: Db,
  catalogVersionId: string,
  rows: readonly (typeof nuTechCatalogPrices.$inferInsert)[],
): Promise<void> {
  await db.batch([
    db.delete(nuTechCatalogPrices).where(eq(nuTechCatalogPrices.catalogVersionId, catalogVersionId)),
    ...chunkD1InsertRows(nuTechCatalogPrices, rows).map((chunk) => db.insert(nuTechCatalogPrices).values(chunk)),
  ])
}

/** Makes one version the active price list and archives the one it replaces. */
export async function activateNuTechCatalogVersion(
  db: Db,
  input: { readonly organizationId: string; readonly versionId: string; readonly userId: string; readonly now: string },
): Promise<void> {
  await db.batch([
    db
      .update(nuTechCatalogVersions)
      .set({ status: "archived", updatedAt: input.now })
      .where(
        and(
          eq(nuTechCatalogVersions.organizationId, input.organizationId),
          eq(nuTechCatalogVersions.status, "active"),
          ne(nuTechCatalogVersions.id, input.versionId),
        ),
      ),
    db
      .update(nuTechCatalogVersions)
      .set({ status: "active", activatedAt: input.now, activatedBy: input.userId, updatedAt: input.now })
      .where(eq(nuTechCatalogVersions.id, input.versionId)),
  ])
}

export async function deleteNuTechCatalogVersion(db: Db, versionId: string): Promise<void> {
  await db.delete(nuTechCatalogVersions).where(eq(nuTechCatalogVersions.id, versionId))
}

/** A product's Sage cost code: a numbered code, a named company code, or neither (unmapped). */
export async function setNuTechProductCostCode(
  db: Db,
  input: {
    readonly productId: string
    readonly sageCostCodeId: string | null
    readonly sageCostCodeName: string | null
    readonly mapped: boolean
    readonly userId: string
    readonly now: string
  },
): Promise<void> {
  await db
    .update(nuTechProducts)
    .set({
      sageCostCodeId: input.sageCostCodeId,
      sageCostCodeName: input.sageCostCodeName,
      sageMappingStatus: input.mapped ? "mapped" : "unmapped",
      sageMappedAt: input.mapped ? input.now : null,
      sageMappedBy: input.mapped ? input.userId : null,
      updatedAt: input.now,
    })
    .where(eq(nuTechProducts.id, input.productId))
}

/** Sets a product's sales-tax flag; false when the product isn't the company's. */
export async function setNuTechProductTaxable(
  db: Db,
  input: { readonly organizationId: string; readonly productId: string; readonly taxable: boolean; readonly now: string },
): Promise<boolean> {
  const updated = await db
    .update(nuTechProducts)
    .set({ taxable: input.taxable, updatedAt: input.now })
    .where(and(eq(nuTechProducts.id, input.productId), eq(nuTechProducts.organizationId, input.organizationId)))
    .returning({ id: nuTechProducts.id })
  return updated.length > 0
}

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

/** Which list price an order's items take. */
type NuTechPriceColumn = "newStandard" | "newCash" | "returningStandard" | "returningCash"

const PRICE_COLUMNS = {
  newStandard: nuTechCatalogPrices.newStandardPriceCents,
  newCash: nuTechCatalogPrices.newCashPriceCents,
  returningStandard: nuTechCatalogPrices.returningStandardPriceCents,
  returningCash: nuTechCatalogPrices.returningCashPriceCents,
} as const

/**
 * Saves an order's intake. With `reprice`, its items are repriced from the
 * order's price list in the same batch (customer type or pricing may have
 * changed).
 */
export async function saveNuTechOrder(
  db: Db,
  input: {
    readonly values: NewNuTechOrderWorkflow
    readonly workbookStatus: string
    readonly userId: string
    readonly now: string
    readonly reprice: { readonly catalogVersionId: string; readonly priceColumn: NuTechPriceColumn } | null
  },
): Promise<void> {
  const { values, now } = input
  const saveWorkflow = db
    .insert(nuTechOrderWorkflows)
    .values(values)
    .onConflictDoUpdate({
      target: nuTechOrderWorkflows.id,
      set: {
        title: values.title,
        catalogVersionId: values.catalogVersionId,
        customerType: values.customerType,
        pricingMode: values.pricingMode,
        quantitySource: values.quantitySource,
        takeoffAcknowledgementStatus: values.takeoffAcknowledgementStatus,
        scopeType: values.scopeType,
        blockQuantityNotes: values.blockQuantityNotes,
        bracingIncluded: values.bracingIncluded,
        bracingRentalStartDate: values.bracingRentalStartDate,
        bracingRentalEndDate: values.bracingRentalEndDate,
        bracingNotes: values.bracingNotes,
        deliveryMethod: values.deliveryMethod,
        requestedDeliveryDate: values.requestedDeliveryDate,
        customerPaidAt: values.customerPaidAt,
        customerPaymentMethod: values.customerPaymentMethod,
        trailerDimensions: values.trailerDimensions,
        trailerPhotoReceivedAt: values.trailerPhotoReceivedAt,
        airlitePurchaseOrderOperationId: values.airlitePurchaseOrderOperationId,
        orderStatus: values.orderStatus,
        vendorConfirmationNumber: values.vendorConfirmationNumber,
        vendorInvoiceNumber: values.vendorInvoiceNumber,
        vendorInvoiceStatus: values.vendorInvoiceStatus,
        vendorInvoiceReceivedAt: values.vendorInvoiceReceivedAt,
        airliteWorkbookStatus: input.workbookStatus,
        shippingCents: values.shippingCents,
        shippingNote: values.shippingNote,
        taxEntityId: values.taxEntityId,
        notes: values.notes,
        updatedBy: input.userId,
        updatedAt: now,
      },
    })
  if (input.reprice === null) {
    await saveWorkflow
    return
  }
  const priceColumn = PRICE_COLUMNS[input.reprice.priceColumn]
  const repriceItems = db
    .update(nuTechOrderItems)
    .set({
      unitPriceCents: sql`(
        SELECT ${priceColumn}
        FROM ${nuTechCatalogPrices}
        WHERE ${nuTechCatalogPrices.catalogVersionId} = ${input.reprice.catalogVersionId}
          AND ${nuTechCatalogPrices.productId} = ${nuTechOrderItems.productId}
        LIMIT 1
      )`,
      updatedAt: now,
    })
    .where(eq(nuTechOrderItems.workflowId, values.id))
  await db.batch([saveWorkflow, repriceItems])
}

/** Starts a new order row. Throws on a duplicate order number, so the caller can retry. */
export async function insertNuTechOrder(db: Db, values: NewNuTechOrderWorkflow): Promise<void> {
  await db.insert(nuTechOrderWorkflows).values(values)
}

export async function deleteNuTechOrder(db: Db, orderId: string): Promise<void> {
  await db.delete(nuTechOrderWorkflows).where(eq(nuTechOrderWorkflows.id, orderId))
}

/** Marks the manufacturer PO released; batched with the purchase order's own status change. */
export function releaseNuTechOrderPurchaseOrderStatement(
  db: Db,
  input: { readonly orderId: string; readonly userId: string; readonly now: string },
): Statement {
  return db
    .update(nuTechOrderWorkflows)
    .set({
      orderStatus: "po_released",
      purchaseOrderReleasedAt: input.now,
      purchaseOrderReleasedBy: input.userId,
      updatedBy: input.userId,
      updatedAt: input.now,
    })
    .where(eq(nuTechOrderWorkflows.id, input.orderId))
}

export async function releaseNuTechOrderVendorInvoice(
  db: Db,
  input: { readonly orderId: string; readonly receivedAt: string; readonly userId: string; readonly now: string },
): Promise<void> {
  await db
    .update(nuTechOrderWorkflows)
    .set({
      orderStatus: "invoice_released",
      vendorInvoiceStatus: "released",
      vendorInvoiceReceivedAt: input.receivedAt,
      vendorInvoiceReleasedAt: input.now,
      vendorInvoiceReleasedBy: input.userId,
      updatedBy: input.userId,
      updatedAt: input.now,
    })
    .where(eq(nuTechOrderWorkflows.id, input.orderId))
}

/** The estimate the order now fills. */
export async function linkNuTechOrderEstimate(db: Db, orderId: string, estimateId: string, now: string): Promise<void> {
  await db.update(nuTechOrderWorkflows).set({ estimateId, updatedAt: now }).where(eq(nuTechOrderWorkflows.id, orderId))
}

/** The manufacturer purchase order made for the order. */
export async function linkNuTechOrderPurchaseOrder(
  db: Db,
  input: { readonly orderId: string; readonly purchaseOrderId: string; readonly userId: string; readonly now: string },
): Promise<void> {
  await db
    .update(nuTechOrderWorkflows)
    .set({ airlitePurchaseOrderOperationId: input.purchaseOrderId, updatedBy: input.userId, updatedAt: input.now })
    .where(eq(nuTechOrderWorkflows.id, input.orderId))
}

export async function setNuTechOrderAirlitePoSequence(db: Db, orderId: string, sequence: number): Promise<void> {
  await db.update(nuTechOrderWorkflows).set({ airlitePoSequence: sequence }).where(eq(nuTechOrderWorkflows.id, orderId))
}

/** Frees the PO number and clears the order form of the unreleased order linked to a purchase order. */
export async function clearNuTechOrderAirlitePoNumber(db: Db, purchaseOrderId: string, now: string): Promise<void> {
  await db
    .update(nuTechOrderWorkflows)
    .set({
      airlitePoSequence: null,
      airliteWorkbookId: null,
      airliteWorkbookUrl: null,
      airliteWorkbookStatus: "not_generated",
      airliteWorkbookGeneratedAt: null,
      airliteWorkbookGeneratedBy: null,
      updatedAt: now,
    })
    .where(
      and(
        eq(nuTechOrderWorkflows.airlitePurchaseOrderOperationId, purchaseOrderId),
        isNull(nuTechOrderWorkflows.purchaseOrderReleasedAt),
      ),
    )
}

/** The filled manufacturer order form. */
export async function recordNuTechOrderWorkbook(
  db: Db,
  input: {
    readonly orderId: string
    readonly workbookId: string
    readonly workbookUrl: string
    readonly workbookStatus: string
    readonly orderStatus: string
    readonly userId: string
    readonly now: string
  },
): Promise<void> {
  await db
    .update(nuTechOrderWorkflows)
    .set({
      airliteWorkbookId: input.workbookId,
      airliteWorkbookUrl: input.workbookUrl,
      airliteWorkbookStatus: input.workbookStatus,
      airliteWorkbookGeneratedAt: input.now,
      airliteWorkbookGeneratedBy: input.userId,
      orderStatus: input.orderStatus,
      updatedBy: input.userId,
      updatedAt: input.now,
    })
    .where(eq(nuTechOrderWorkflows.id, input.orderId))
}

// ---------------------------------------------------------------------------
// Order items
// ---------------------------------------------------------------------------

/** Adds a product to an order (or sets its quantity) and updates the order's status, together. */
export async function saveNuTechOrderItem(
  db: Db,
  input: {
    readonly item: typeof nuTechOrderItems.$inferInsert & {
      readonly quantity: number
      readonly unitCostCents: number
      readonly unitPriceCents: number
    }
    readonly order: { readonly id: string; readonly orderStatus: string; readonly workbookStatus: string }
    readonly userId: string
    readonly now: string
  },
): Promise<void> {
  const { item, order, now } = input
  await db.batch([
    db
      .insert(nuTechOrderItems)
      .values(item)
      .onConflictDoUpdate({
        target: [nuTechOrderItems.workflowId, nuTechOrderItems.productId],
        set: {
          quantity: item.quantity,
          unitCostCents: item.unitCostCents,
          unitPriceCents: item.unitPriceCents,
          updatedAt: now,
        },
      }),
    db
      .update(nuTechOrderWorkflows)
      .set({ orderStatus: order.orderStatus, airliteWorkbookStatus: order.workbookStatus, updatedBy: input.userId, updatedAt: now })
      .where(eq(nuTechOrderWorkflows.id, order.id)),
  ])
}

/** Removes a product from an order and updates the order's form status, together. */
export async function deleteNuTechOrderItem(
  db: Db,
  input: { readonly itemId: string; readonly orderId: string; readonly workbookStatus: string; readonly userId: string; readonly now: string },
): Promise<void> {
  await db.batch([
    db.delete(nuTechOrderItems).where(eq(nuTechOrderItems.id, input.itemId)),
    db
      .update(nuTechOrderWorkflows)
      .set({ airliteWorkbookStatus: input.workbookStatus, updatedBy: input.userId, updatedAt: input.now })
      .where(eq(nuTechOrderWorkflows.id, input.orderId)),
  ])
}

// ---------------------------------------------------------------------------
// Bracing rentals
// ---------------------------------------------------------------------------

type BracingRentalValues = Omit<
  typeof nuTechBracingRentals.$inferInsert,
  "id" | "organizationId" | "projectId" | "dailyRateCents" | "createdBy" | "createdAt"
>

type BracingRentalLineValues = Omit<typeof nuTechBracingRentalLines.$inferInsert, "rentalId">

/** Saves a rental and replaces its lines; the caller adds its audit row to the same batch. */
export function saveNuTechBracingRentalStatements(
  db: Db,
  input: {
    readonly rentalId: string
    /** Null updates an existing rental; set, inserts a new one. */
    readonly create: {
      readonly organizationId: string
      readonly projectId: string
      readonly dailyRateCents: number
      readonly createdBy: string
      readonly createdAt: string
    } | null
    readonly values: BracingRentalValues
    readonly lines: readonly BracingRentalLineValues[]
  },
): readonly [Statement, ...Statement[]] {
  return [
    input.create
      ? db.insert(nuTechBracingRentals).values({ id: input.rentalId, ...input.create, ...input.values })
      : db.update(nuTechBracingRentals).set(input.values).where(eq(nuTechBracingRentals.id, input.rentalId)),
    db.delete(nuTechBracingRentalLines).where(eq(nuTechBracingRentalLines.rentalId, input.rentalId)),
    ...input.lines.map((line) => db.insert(nuTechBracingRentalLines).values({ ...line, rentalId: input.rentalId })),
  ]
}

/** Deletes a rental (its lines cascade); the caller adds its audit row to the same batch. */
export function deleteNuTechBracingRentalStatement(db: Db, rentalId: string): Statement {
  return db.delete(nuTechBracingRentals).where(eq(nuTechBracingRentals.id, rentalId))
}
