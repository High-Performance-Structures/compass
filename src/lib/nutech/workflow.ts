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

export type NuTechPaymentMethod = "check" | "cash" | "ach" | "card"

export const NUTECH_PAYMENT_METHOD_OPTIONS: readonly {
  readonly value: NuTechPaymentMethod
  readonly label: string
}[] = [
  { value: "check", label: "Check" },
  { value: "cash", label: "Cash" },
  { value: "ach", label: "ACH / online check" },
  { value: "card", label: "Card" },
]

export function isNuTechPaymentMethod(value: unknown): value is NuTechPaymentMethod {
  return NUTECH_PAYMENT_METHOD_OPTIONS.some((option) => option.value === value)
}

/**
 * What the customer must provide before the order goes to the manufacturer:
 * a paid invoice and a requested date, and for customer pickup the trailer
 * dimensions and a photo of the trailer.
 */
export function nuTechCustomerReadinessIssues({
  deliveryMethod,
  customerPaidAt,
  requestedDeliveryDate,
  trailerDimensions,
  trailerPhotoReceivedAt,
}: {
  readonly deliveryMethod: NuTechDeliveryMethod
  readonly customerPaidAt: string | null
  readonly requestedDeliveryDate: string | null
  readonly trailerDimensions: string | null
  readonly trailerPhotoReceivedAt: string | null
}): readonly string[] {
  const issues: string[] = []
  if (customerPaidAt === null) issues.push("Record the customer's payment.")
  if (requestedDeliveryDate === null) {
    issues.push(deliveryMethod === "delivery" ? "Get the requested delivery date." : "Get the requested pickup date.")
  }
  if (deliveryMethod === "customer_pickup") {
    if (trailerDimensions === null) issues.push("Get the trailer dimensions.")
    if (trailerPhotoReceivedAt === null) issues.push("Get a photo of the trailer.")
  }
  return issues
}

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
  customerReadinessIssues = [],
}: {
  readonly customerType: NuTechCustomerType | null
  readonly pricingMode: NuTechPricingMode | null
  readonly quantitySource: NuTechQuantitySource | null
  readonly takeoffAcknowledgementStatus: NuTechTakeoffAcknowledgementStatus
  readonly airlitePurchaseOrderOperationId: string | null
  readonly orderItemCount?: number | null
  readonly airliteWorkbookStatus?: string | null
  /** From nuTechCustomerReadinessIssues: payment, date, and pickup trailer details. */
  readonly customerReadinessIssues?: readonly string[]
}): NuTechPurchaseOrderReleaseReadiness {
  const issues: string[] = [...customerReadinessIssues]
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

/**
 * The job status (and so the Nu-Tech Sales pipeline stage) an order status
 * puts the job in. Null leaves the job status alone (cancelled orders are
 * closed on the job page, where the reason is chosen).
 */
const JOB_STATUS_BY_ORDER_STATUS: Readonly<Record<NuTechOrderStatus, string | null>> = {
  intake: "intake",
  quantities_ready: "estimating",
  estimate_ready: "estimating",
  customer_approved: "awaiting_payment",
  po_ready: "awaiting_payment",
  po_released: "ordered",
  vendor_confirmed: "ordered",
  invoice_received: "ordered",
  invoice_released: "ordered",
  complete: "complete",
  cancelled: null,
}

export function jobStatusForNuTechOrderStatus(status: NuTechOrderStatus): string | null {
  return JOB_STATUS_BY_ORDER_STATUS[status]
}

/** The project's delivery method (delivery or pickup) for an order's fulfillment. */
export function projectDeliveryMethodForNuTech(method: NuTechDeliveryMethod): "delivery" | "pickup" {
  return method === "delivery" ? "delivery" : "pickup"
}
