/**
 * Nu-Tech order rules: sales tax and order totals, and how stored order
 * values are read back. Pure: no database or network access. The order
 * workspace previews totals with these same functions the server uses.
 */
import type { nuTechOrderWorkflows } from "@/db/schema-nutech"
import {
  NUTECH_CUSTOMER_TYPE_OPTIONS,
  NUTECH_DELIVERY_METHOD_OPTIONS,
  NUTECH_ORDER_STATUS_OPTIONS,
  NUTECH_PRICING_MODE_OPTIONS,
  NUTECH_QUANTITY_SOURCE_OPTIONS,
  NUTECH_SCOPE_TYPE_OPTIONS,
  NUTECH_TAKEOFF_STATUS_OPTIONS,
  NUTECH_VENDOR_INVOICE_STATUS_OPTIONS,
  isNuTechPaymentMethod,
  type NuTechCustomerType,
  type NuTechDeliveryMethod,
  type NuTechOrderStatus,
  type NuTechPaymentMethod,
  type NuTechPricingMode,
  type NuTechQuantitySource,
  type NuTechScopeType,
  type NuTechTakeoffAcknowledgementStatus,
  type NuTechVendorInvoiceStatus,
} from "@/lib/nutech/workflow"

// ---------------------------------------------------------------------------
// Sales tax and totals
// ---------------------------------------------------------------------------

/**
 * Whether a product line is taxed. Items follow their price-list setting;
 * catalog rows from before the setting existed (or a product no longer on
 * the order's price list) count as taxable.
 */
export function nuTechItemTaxable(taxable: boolean | null | undefined): boolean {
  return taxable !== false
}

/** The shipping charge that applies: deliveries only, never negative. */
export function nuTechShippingCents(deliveryMethod: string, shippingCents: number | null | undefined): number {
  return deliveryMethod === "delivery" ? Math.max(0, shippingCents ?? 0) : 0
}

/** A typed shipping amount ("$1,250.50") as whole cents; blank or invalid is 0. */
export function nuTechShippingInputCents(text: string): number {
  return Math.max(0, Math.round((Number.parseFloat(text.replace(/[$,]/g, "")) || 0) * 100))
}

/**
 * The order's sales tax district: the one chosen, else for pickups the
 * warehouse's district (Settings → Nu-Tech emails). Deliveries without a
 * chosen district have none.
 */
export function nuTechEffectiveTaxEntityId(input: {
  readonly chosenTaxEntityId: string | null | undefined
  readonly deliveryMethod: string
  readonly warehouseTaxEntityId: string | null | undefined
}): string | null {
  const chosen = input.chosenTaxEntityId?.trim() ?? ""
  if (chosen) return chosen
  if (input.deliveryMethod === "delivery") return null
  return input.warehouseTaxEntityId || null
}

/** Sales tax on a taxable amount at a rate in basis points (825 = 8.25%), rounded half up to the cent. */
export function nuTechSalesTaxCents(taxableCents: number, rateBasisPoints: number): number {
  return Math.round((taxableCents * rateBasisPoints) / 10_000)
}

export type NuTechTotalsItem = {
  readonly quantity: number
  readonly unitPriceCents: number
  /** The product's price-list tax setting; missing means taxable. */
  readonly taxable: boolean | null | undefined
}

export type NuTechOrderTotals = {
  readonly itemsCents: number
  readonly shippingCents: number
  readonly taxableCents: number
  readonly taxCents: number
  readonly totalCents: number
}

/**
 * The customer's order total: products at the customer's price, shipping,
 * and sales tax on the taxable items (plus shipping when the price list's
 * Freight item is taxable). No district means no tax yet.
 */
export function nuTechOrderTotals(input: {
  readonly items: readonly NuTechTotalsItem[]
  /** Already resolved with `nuTechShippingCents` (0 for pickups). */
  readonly shippingCents: number
  readonly shippingTaxable: boolean
  readonly taxRateBasisPoints: number | null
}): NuTechOrderTotals {
  let itemsCents = 0
  let taxableItemsCents = 0
  for (const item of input.items) {
    const lineCents = item.quantity * item.unitPriceCents
    itemsCents += lineCents
    if (nuTechItemTaxable(item.taxable)) taxableItemsCents += lineCents
  }
  const taxableCents = taxableItemsCents + (input.shippingTaxable ? input.shippingCents : 0)
  const taxCents = input.taxRateBasisPoints === null ? 0 : nuTechSalesTaxCents(taxableCents, input.taxRateBasisPoints)
  return {
    itemsCents,
    shippingCents: input.shippingCents,
    taxableCents,
    taxCents,
    totalCents: itemsCents + input.shippingCents + taxCents,
  }
}

/** The manufacturer's cost of the order's products. */
export function nuTechOrderCostCents(items: readonly { readonly quantity: number; readonly unitCostCents: number }[]): number {
  return items.reduce((total, item) => total + item.quantity * item.unitCostCents, 0)
}

/** A filled order form goes stale when the order changes after it was filled. */
export function nuTechWorkbookStatusAfterChange(status: string): string {
  return status.startsWith("generated") ? "stale" : status
}

// ---------------------------------------------------------------------------
// Reading and validating order values
// ---------------------------------------------------------------------------

export function parseNuTechDate(value: string | null, label: string): string | null {
  const cleaned = value?.trim() ?? ""
  if (cleaned.length === 0) return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cleaned)) {
    throw new Error(`${label} must be a valid date.`)
  }
  const parsed = new Date(`${cleaned}T12:00:00Z`)
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== cleaned) {
    throw new Error(`${label} must be a valid date.`)
  }
  return cleaned
}

export function parseNuTechCustomerType(value: string): NuTechCustomerType {
  const match = NUTECH_CUSTOMER_TYPE_OPTIONS.find((option) => option.value === value)
  if (!match) throw new Error("Choose new or returning customer pricing.")
  return match.value
}

export function storedNuTechCustomerType(value: string): NuTechCustomerType {
  return value === "returning" ? "returning" : "new"
}

export function parseNuTechPricingMode(value: string): NuTechPricingMode {
  const match = NUTECH_PRICING_MODE_OPTIONS.find((option) => option.value === value)
  if (!match) throw new Error("Choose standard or cash-discount pricing.")
  return match.value
}

export function storedNuTechPricingMode(value: string): NuTechPricingMode {
  return value === "cash_discount" ? "cash_discount" : "standard"
}

export function parseNuTechQuantitySource(value: string): NuTechQuantitySource {
  const match = NUTECH_QUANTITY_SOURCE_OPTIONS.find((option) => option.value === value)
  if (!match) throw new Error("Record who supplied the order quantities.")
  return match.value
}

export function storedNuTechQuantitySource(value: string): NuTechQuantitySource {
  return value === "staff_takeoff" ? "staff_takeoff" : "customer_provided"
}

export function storedNuTechTakeoffStatus(value: string): NuTechTakeoffAcknowledgementStatus {
  const match = NUTECH_TAKEOFF_STATUS_OPTIONS.find((option) => option.value === value)
  return match?.value ?? "pending"
}

export function parseNuTechScopeType(value: string): NuTechScopeType {
  const match = NUTECH_SCOPE_TYPE_OPTIONS.find((option) => option.value === value)
  if (!match) throw new Error("Choose the Nu-Tech order scope.")
  return match.value
}

function storedScopeType(value: string): NuTechScopeType {
  if (value === "block_and_bracing" || value === "bracing_only") return value
  return "block_sale"
}

export function parseNuTechDeliveryMethod(value: string): NuTechDeliveryMethod {
  const match = NUTECH_DELIVERY_METHOD_OPTIONS.find((option) => option.value === value)
  if (!match) throw new Error("Choose delivery, pickup, or will call.")
  return match.value
}

export function storedNuTechDeliveryMethod(value: string): NuTechDeliveryMethod {
  if (value === "customer_pickup" || value === "will_call") return value
  return "delivery"
}

export function storedNuTechOrderStatus(value: string): NuTechOrderStatus {
  const match = NUTECH_ORDER_STATUS_OPTIONS.find((option) => option.value === value)
  return match?.value ?? "intake"
}

export function storedNuTechVendorInvoiceStatus(value: string): NuTechVendorInvoiceStatus {
  const match = NUTECH_VENDOR_INVOICE_STATUS_OPTIONS.find((option) => option.value === value)
  return match?.value ?? "not_received"
}

export type NuTechOrderRecord = {
  readonly id: string
  /** The order's number on its job (1, 2, …). */
  readonly orderNumber: number
  readonly title: string | null
  /** The estimate this order fills and is sold on. */
  readonly estimateId: string | null
  readonly catalogVersionId: string | null
  readonly customerType: NuTechCustomerType
  readonly pricingMode: NuTechPricingMode
  readonly quantitySource: NuTechQuantitySource
  readonly takeoffAcknowledgementStatus: NuTechTakeoffAcknowledgementStatus
  readonly scopeType: NuTechScopeType
  readonly blockQuantityNotes: string | null
  readonly bracingIncluded: boolean
  readonly bracingRentalStartDate: string | null
  readonly bracingRentalEndDate: string | null
  readonly bracingNotes: string | null
  readonly deliveryMethod: NuTechDeliveryMethod
  readonly requestedDeliveryDate: string | null
  readonly customerPaidAt: string | null
  readonly customerPaymentMethod: NuTechPaymentMethod | null
  readonly trailerDimensions: string | null
  readonly trailerPhotoReceivedAt: string | null
  readonly airlitePurchaseOrderOperationId: string | null
  readonly orderStatus: NuTechOrderStatus
  readonly vendorConfirmationNumber: string | null
  readonly airliteWorkbookUrl: string | null
  readonly airliteWorkbookStatus: string
  readonly airliteWorkbookGeneratedAt: string | null
  readonly purchaseOrderReleasedAt: string | null
  readonly vendorInvoiceNumber: string | null
  readonly vendorInvoiceStatus: NuTechVendorInvoiceStatus
  readonly vendorInvoiceReceivedAt: string | null
  readonly vendorInvoiceReleasedAt: string | null
  readonly shippingCents: number | null
  readonly shippingNote: string | null
  readonly taxEntityId: string | null
  readonly notes: string | null
  readonly updatedAt: string
}

export function toNuTechOrderRecord(row: typeof nuTechOrderWorkflows.$inferSelect): NuTechOrderRecord {
  return {
    id: row.id,
    orderNumber: row.orderNumber,
    title: row.title,
    estimateId: row.estimateId,
    catalogVersionId: row.catalogVersionId,
    customerType: storedNuTechCustomerType(row.customerType),
    pricingMode: storedNuTechPricingMode(row.pricingMode),
    quantitySource: storedNuTechQuantitySource(row.quantitySource),
    takeoffAcknowledgementStatus: storedNuTechTakeoffStatus(row.takeoffAcknowledgementStatus),
    scopeType: storedScopeType(row.scopeType),
    blockQuantityNotes: row.blockQuantityNotes,
    bracingIncluded: row.bracingIncluded,
    bracingRentalStartDate: row.bracingRentalStartDate,
    bracingRentalEndDate: row.bracingRentalEndDate,
    bracingNotes: row.bracingNotes,
    deliveryMethod: storedNuTechDeliveryMethod(row.deliveryMethod),
    requestedDeliveryDate: row.requestedDeliveryDate,
    customerPaidAt: row.customerPaidAt,
    customerPaymentMethod: isNuTechPaymentMethod(row.customerPaymentMethod) ? row.customerPaymentMethod : null,
    trailerDimensions: row.trailerDimensions,
    trailerPhotoReceivedAt: row.trailerPhotoReceivedAt,
    airlitePurchaseOrderOperationId: row.airlitePurchaseOrderOperationId,
    orderStatus: storedNuTechOrderStatus(row.orderStatus),
    vendorConfirmationNumber: row.vendorConfirmationNumber,
    airliteWorkbookUrl: row.airliteWorkbookUrl,
    airliteWorkbookStatus: row.airliteWorkbookStatus,
    airliteWorkbookGeneratedAt: row.airliteWorkbookGeneratedAt,
    purchaseOrderReleasedAt: row.purchaseOrderReleasedAt,
    vendorInvoiceNumber: row.vendorInvoiceNumber,
    vendorInvoiceStatus: storedNuTechVendorInvoiceStatus(row.vendorInvoiceStatus),
    vendorInvoiceReceivedAt: row.vendorInvoiceReceivedAt,
    vendorInvoiceReleasedAt: row.vendorInvoiceReleasedAt,
    shippingCents: row.shippingCents,
    shippingNote: row.shippingNote,
    taxEntityId: row.taxEntityId,
    notes: row.notes,
    updatedAt: row.updatedAt,
  }
}
