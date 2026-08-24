export type NuTechCustomerType = "new" | "returning"
export type NuTechPricingMode = "standard" | "cash_discount"
export type NuTechQuantitySource = "customer_provided" | "staff_takeoff"
export type NuTechTakeoffAcknowledgementStatus =
  | "not_required"
  | "pending"
  | "sent"
  | "signed"
export type NuTechScopeType = "block_sale" | "block_and_bracing" | "bracing_only"
export type NuTechDeliveryMethod = "delivery" | "customer_pickup" | "will_call"
export type NuTechOrderStatus =
  | "intake"
  | "quantities_ready"
  | "estimate_ready"
  | "customer_approved"
  | "po_ready"
  | "po_released"
  | "vendor_confirmed"
  | "invoice_received"
  | "invoice_released"
  | "complete"
  | "cancelled"
export type NuTechVendorInvoiceStatus =
  | "not_received"
  | "received"
  | "released"
  | "posted"

export const NUTECH_CUSTOMER_TYPE_OPTIONS: readonly {
  readonly value: NuTechCustomerType
  readonly label: string
}[] = [
  { value: "new", label: "New client" },
  { value: "returning", label: "Returning customer" },
]

export const NUTECH_PRICING_MODE_OPTIONS: readonly {
  readonly value: NuTechPricingMode
  readonly label: string
  readonly description: string
}[] = [
  {
    value: "standard",
    label: "Standard pricing",
    description: "Use for non-discounted terms; do not label this credit-card pricing.",
  },
  {
    value: "cash_discount",
    label: "Cash-discount pricing",
    description: "Cash, wire, or check terms.",
  },
]

export const NUTECH_QUANTITY_SOURCE_OPTIONS: readonly {
  readonly value: NuTechQuantitySource
  readonly label: string
}[] = [
  { value: "customer_provided", label: "Customer provided quantities" },
  { value: "staff_takeoff", label: "Nu-Tech staff prepared takeoff" },
]

export const NUTECH_TAKEOFF_STATUS_OPTIONS: readonly {
  readonly value: NuTechTakeoffAcknowledgementStatus
  readonly label: string
}[] = [
  { value: "not_required", label: "Not required" },
  { value: "pending", label: "Required / pending" },
  { value: "sent", label: "Sent for signature" },
  { value: "signed", label: "Signed" },
]

export const NUTECH_SCOPE_TYPE_OPTIONS: readonly {
  readonly value: NuTechScopeType
  readonly label: string
}[] = [
  { value: "block_sale", label: "Fox Blocks sale" },
  { value: "block_and_bracing", label: "Fox Blocks sale + bracing rental" },
  { value: "bracing_only", label: "Bracing rental only" },
]

export const NUTECH_DELIVERY_METHOD_OPTIONS: readonly {
  readonly value: NuTechDeliveryMethod
  readonly label: string
}[] = [
  { value: "delivery", label: "Delivery" },
  { value: "customer_pickup", label: "Customer pickup" },
  { value: "will_call", label: "Airlite will call" },
]

export const NUTECH_ORDER_STATUS_OPTIONS: readonly {
  readonly value: NuTechOrderStatus
  readonly label: string
}[] = [
  { value: "intake", label: "Intake" },
  { value: "quantities_ready", label: "Quantities ready" },
  { value: "estimate_ready", label: "Estimate ready" },
  { value: "customer_approved", label: "Customer approved" },
  { value: "po_ready", label: "Airlite PO ready" },
  { value: "po_released", label: "Airlite PO released" },
  { value: "vendor_confirmed", label: "Vendor confirmed" },
  { value: "invoice_received", label: "Vendor invoice received" },
  { value: "invoice_released", label: "Vendor invoice released" },
  { value: "complete", label: "Complete" },
  { value: "cancelled", label: "Cancelled" },
]

export const NUTECH_VENDOR_INVOICE_STATUS_OPTIONS: readonly {
  readonly value: NuTechVendorInvoiceStatus
  readonly label: string
}[] = [
  { value: "not_received", label: "Not received" },
  { value: "received", label: "Received" },
  { value: "released", label: "Released" },
  { value: "posted", label: "Posted" },
]

export function nuTechTakeoffAcknowledgementRequired(
  quantitySource: NuTechQuantitySource
): boolean {
  return quantitySource === "staff_takeoff"
}

export function normalizedNuTechTakeoffStatus({
  quantitySource,
  requestedStatus,
}: {
  readonly quantitySource: NuTechQuantitySource
  readonly requestedStatus: NuTechTakeoffAcknowledgementStatus
}): NuTechTakeoffAcknowledgementStatus {
  if (!nuTechTakeoffAcknowledgementRequired(quantitySource)) {
    return "not_required"
  }
  if (requestedStatus === "not_required") return "pending"
  return requestedStatus
}

export type NuTechPurchaseOrderReleaseReadiness = {
  readonly ready: boolean
  readonly issues: readonly string[]
}

const NUTECH_PRE_RELEASE_ORDER_STATUSES = new Set<NuTechOrderStatus>([
  "intake",
  "quantities_ready",
  "estimate_ready",
  "customer_approved",
  "po_ready",
])

const NUTECH_POST_RELEASE_ORDER_STATUSES = new Set<NuTechOrderStatus>([
  "po_released",
  "vendor_confirmed",
  "invoice_received",
  "invoice_released",
])

export function nuTechReleaseAuditIssues({
  orderStatus,
  vendorInvoiceStatus,
  purchaseOrderReleasedAt,
  vendorInvoiceReleasedAt,
}: {
  readonly orderStatus: NuTechOrderStatus
  readonly vendorInvoiceStatus: NuTechVendorInvoiceStatus
  readonly purchaseOrderReleasedAt: string | null
  readonly vendorInvoiceReleasedAt: string | null
}): readonly string[] {
  const issues: string[] = []
  if (
    purchaseOrderReleasedAt === null &&
    NUTECH_POST_RELEASE_ORDER_STATUSES.has(orderStatus)
  ) {
    issues.push("Record the Airlite PO release before selecting a post-release status.")
  }
  if (
    purchaseOrderReleasedAt !== null &&
    NUTECH_PRE_RELEASE_ORDER_STATUSES.has(orderStatus)
  ) {
    issues.push("A released Airlite PO cannot be moved back to a pre-release status.")
  }
  if (orderStatus === "invoice_released" && vendorInvoiceReleasedAt === null) {
    issues.push("Use the vendor-invoice release action before selecting invoice released.")
  }
  if (
    vendorInvoiceReleasedAt !== null &&
    orderStatus !== "invoice_released" &&
    orderStatus !== "complete" &&
    orderStatus !== "cancelled"
  ) {
    issues.push(
      "A released vendor invoice can only remain released, complete, or cancelled."
    )
  }
  if (
    (vendorInvoiceStatus === "released" || vendorInvoiceStatus === "posted") &&
    vendorInvoiceReleasedAt === null
  ) {
    issues.push("Release the vendor invoice before marking it released or posted.")
  }
  return issues
}

export function nuTechPurchaseOrderReleaseReadiness({
  customerType,
  pricingMode,
  quantitySource,
  takeoffAcknowledgementStatus,
  airlitePurchaseOrderOperationId,
  orderItemCount,
  airliteWorkbookStatus,
}: {
  readonly customerType: NuTechCustomerType | null
  readonly pricingMode: NuTechPricingMode | null
  readonly quantitySource: NuTechQuantitySource | null
  readonly takeoffAcknowledgementStatus: NuTechTakeoffAcknowledgementStatus
  readonly airlitePurchaseOrderOperationId: string | null
  readonly orderItemCount?: number | null
  readonly airliteWorkbookStatus?: string | null
}): NuTechPurchaseOrderReleaseReadiness {
  const issues: string[] = []
  if (customerType === null) issues.push("Select new or returning customer pricing.")
  if (pricingMode === null) issues.push("Select standard or cash-discount pricing.")
  if (quantitySource === null) issues.push("Record who supplied the quantities.")
  if (
    quantitySource === "staff_takeoff" &&
    takeoffAcknowledgementStatus !== "signed"
  ) {
    issues.push("Obtain the signed takeoff acknowledgement.")
  }
  if (airlitePurchaseOrderOperationId === null) {
    issues.push("Link the Compass Airlite purchase order.")
  }
  if (orderItemCount !== null && orderItemCount !== undefined && orderItemCount < 1) {
    issues.push("Add at least one catalog item to the order.")
  }
  if (
    airliteWorkbookStatus !== null &&
    airliteWorkbookStatus !== undefined &&
    !airliteWorkbookStatus.startsWith("generated")
  ) {
    issues.push("Generate the Airlite workbook from the saved order items.")
  }
  return { ready: issues.length === 0, issues }
}

export function nuTechOrderStatusLabel(value: string): string {
  const match = NUTECH_ORDER_STATUS_OPTIONS.find((option) => option.value === value)
  return match?.label ?? value
}
