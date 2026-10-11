import type { ProjectFollowUpSignal } from "@/lib/project-follow-up"
import {
  nuTechCustomerReadinessIssues,
  type NuTechDeliveryMethod,
  type NuTechOrderStatus,
  type NuTechQuantitySource,
  type NuTechTakeoffAcknowledgementStatus,
} from "@/lib/nutech/workflow"
import {
  applyWorkflowOverrides,
  workflowProgress,
  type WorkflowCheck,
  type WorkflowDefinition,
  type WorkflowFacts,
  type WorkflowOverrides,
  type WorkflowProgress,
} from "@/lib/job-workflows/engine"

/** Everything the overview needs to place a Nu-Tech job in its order process. */
export type NuTechOrderSnapshot = {
  readonly projectId: string
  readonly address: string | null
  readonly clientContactCount: number
  /** From the job when there is no order yet (Nu-Tech Sales board). */
  readonly projectDeliveryMethod: "delivery" | "pickup" | null
  readonly followUp: ProjectFollowUpSignal | null
  readonly estimateStatus: string | null
  /** The estimate has a sales tax district (synced from Sage) chosen. */
  readonly estimateTaxChosen: boolean
  readonly order: {
    readonly quantitySource: NuTechQuantitySource
    readonly takeoffAcknowledgementStatus: NuTechTakeoffAcknowledgementStatus
    readonly deliveryMethod: NuTechDeliveryMethod
    readonly requestedDeliveryDate: string | null
    readonly customerPaidAt: string | null
    readonly trailerDimensions: string | null
    readonly trailerPhotoReceivedAt: string | null
    readonly itemCount: number
    readonly airlitePurchaseOrderLinked: boolean
    readonly airliteWorkbookGenerated: boolean
    readonly purchaseOrderReleasedAt: string | null
    readonly vendorConfirmationNumber: string | null
    readonly vendorInvoiceNumber: string | null
    readonly vendorInvoiceReleasedAt: string | null
    readonly orderStatus: NuTechOrderStatus
  } | null
}

export type NuTechStepId =
  | "intake"
  | "quantities"
  | "estimate"
  | "payment"
  | "ready"
  | "order"
  | "confirmed"
  | "vendor_invoice"
  | "complete"

export const NUTECH_STEP_IDS: readonly NuTechStepId[] = [
  "intake",
  "quantities",
  "estimate",
  "payment",
  "ready",
  "order",
  "confirmed",
  "vendor_invoice",
  "complete",
]

export type NuTechOrderProgress = WorkflowProgress & { readonly cancelled: boolean }

/**
 * The order process from the Nu-Tech cheat sheet. Every item is completed by
 * what Compass records on the order, estimate and job.
 */
export const NUTECH_ORDER_WORKFLOW: WorkflowDefinition = {
  title: "order",
  steps: [
    {
      id: "intake",
      label: "Intake",
      jobStatusId: null,
      items: [
        { id: "client", label: "Add the customer as a client contact", fact: "clientContact", path: "contacts" },
        { id: "fulfillment", label: "Choose delivery or customer pickup", fact: "fulfillmentChosen", path: "nutech#nutech-fulfillment" },
        { id: "address", label: "Add the delivery address", fact: "hasAddress", path: "information", when: "delivery" },
        { id: "order", label: "Start the order and record who supplies quantities", fact: "orderStarted", path: "nutech#nutech-intake" },
      ],
    },
    {
      id: "quantities",
      label: "Quantities",
      jobStatusId: null,
      items: [{ id: "items", label: "Add catalog items (whole bundles)", fact: "itemsAdded", path: "nutech#nutech-quantities" }],
    },
    {
      id: "estimate",
      label: "Estimate",
      jobStatusId: null,
      items: [
        { id: "built", label: "Build the estimate", fact: "estimateBuilt", path: "estimate" },
        { id: "tax", label: "Choose the sales tax district for the delivery address", fact: "estimateTaxChosen", path: "estimate" },
        { id: "sent", label: "Send the estimate to the customer", fact: "estimateSent", path: "estimate" },
      ],
    },
    {
      id: "payment",
      label: "Approval & payment",
      jobStatusId: null,
      items: [
        { id: "takeoff", label: "Get the signed takeoff acknowledgement", fact: "takeoffSigned", path: "nutech#nutech-intake", when: "staffTakeoff" },
        { id: "paid", label: "Record the customer's payment", fact: "customerPaid", path: "nutech#nutech-fulfillment" },
      ],
    },
    {
      id: "ready",
      label: "Ready to order",
      jobStatusId: null,
      items: [
        { id: "delivery_date", label: "Requested delivery date", fact: "requestedDate", path: "nutech#nutech-fulfillment", when: "delivery" },
        { id: "pickup_date", label: "Requested pickup date", fact: "requestedDate", path: "nutech#nutech-fulfillment", when: "!delivery" },
        { id: "trailer_size", label: "Trailer dimensions", fact: "trailerDimensions", path: "nutech#nutech-fulfillment", when: "pickup" },
        { id: "trailer_photo", label: "Trailer photo", fact: "trailerPhoto", path: "nutech#nutech-fulfillment", when: "pickup" },
        { id: "approved", label: "Signed acknowledgement and payment", fact: "approvedAndPaid", path: "nutech#nutech-fulfillment" },
      ],
    },
    {
      id: "order",
      label: "Order placed",
      jobStatusId: null,
      items: [
        { id: "po", label: "Create the Airlite PO and link it", fact: "purchaseOrderLinked", path: "purchase-orders" },
        { id: "form", label: "Generate the Airlite order form", fact: "workbookGenerated", path: "nutech#nutech-airlite" },
        { id: "released", label: "Send the order and record the release", fact: "released", path: "nutech#nutech-airlite" },
      ],
    },
    {
      id: "confirmed",
      label: "Confirmed",
      jobStatusId: null,
      items: [{ id: "confirmation", label: "Record Airlite's EPS confirmation number", fact: "confirmationRecorded", path: "nutech#nutech-airlite" }],
    },
    {
      id: "vendor_invoice",
      label: "Vendor invoice",
      jobStatusId: null,
      items: [
        { id: "number", label: "Record the Airlite invoice number", fact: "vendorInvoiceRecorded", path: "nutech#nutech-airlite" },
        { id: "released", label: "Release the invoice for payment", fact: "vendorInvoiceReleased", path: "nutech#nutech-airlite" },
      ],
    },
    {
      id: "complete",
      label: "Complete",
      jobStatusId: null,
      items: [{ id: "complete", label: "Mark the order complete after pickup or delivery", fact: "orderComplete", path: "nutech#nutech-fulfillment" }],
    },
  ],
}

const ESTIMATE_SENT = new Set(["signature_pending", "accepted"])

/** What Compass records about the order, as workflow facts. */
export function nuTechOrderFacts(snapshot: NuTechOrderSnapshot): WorkflowFacts {
  const order = snapshot.order
  const delivery: NuTechDeliveryMethod | null =
    order?.deliveryMethod ??
    (snapshot.projectDeliveryMethod === "delivery"
      ? "delivery"
      : snapshot.projectDeliveryMethod === "pickup"
        ? "customer_pickup"
        : null)
  const staffTakeoff = order?.quantitySource === "staff_takeoff"
  const ackDone = order !== null && (!staffTakeoff || order.takeoffAcknowledgementStatus === "signed")
  return {
    delivery: delivery === "delivery",
    pickup: delivery === "customer_pickup",
    staffTakeoff,
    clientContact: snapshot.clientContactCount > 0,
    fulfillmentChosen: delivery !== null,
    hasAddress: (snapshot.address?.trim() ?? "") !== "",
    orderStarted: order !== null,
    itemsAdded: (order?.itemCount ?? 0) > 0,
    estimateBuilt: snapshot.estimateStatus !== null,
    estimateTaxChosen: snapshot.estimateTaxChosen,
    estimateSent: snapshot.estimateStatus !== null && ESTIMATE_SENT.has(snapshot.estimateStatus),
    takeoffSigned: order?.takeoffAcknowledgementStatus === "signed",
    customerPaid: order?.customerPaidAt != null,
    requestedDate: order?.requestedDeliveryDate != null,
    trailerDimensions: order?.trailerDimensions != null,
    trailerPhoto: order?.trailerPhotoReceivedAt != null,
    approvedAndPaid: ackDone && order?.customerPaidAt != null,
    purchaseOrderLinked: order?.airlitePurchaseOrderLinked ?? false,
    workbookGenerated: order?.airliteWorkbookGenerated ?? false,
    released: order?.purchaseOrderReleasedAt != null,
    confirmationRecorded: (order?.vendorConfirmationNumber ?? null) !== null,
    vendorInvoiceRecorded: (order?.vendorInvoiceNumber ?? null) !== null,
    vendorInvoiceReleased: order?.vendorInvoiceReleasedAt != null,
    orderComplete: order?.orderStatus === "complete",
  }
}

export function isNuTechStepId(value: string): value is NuTechStepId {
  return NUTECH_STEP_IDS.some((id) => id === value)
}

/**
 * Where an N job stands in the order process. A step is done when its
 * checklist is complete; the first incomplete step is current.
 */
export function nuTechOrderProgress(
  snapshot: NuTechOrderSnapshot,
  overrides: WorkflowOverrides = {},
  checks: ReadonlyMap<string, WorkflowCheck> = new Map(),
): NuTechOrderProgress {
  const order = snapshot.order
  const progress = workflowProgress(applyWorkflowOverrides(NUTECH_ORDER_WORKFLOW, overrides), nuTechOrderFacts(snapshot), checks)
  const readinessIssues = order
    ? nuTechCustomerReadinessIssues({
        deliveryMethod: order.deliveryMethod,
        customerPaidAt: order.customerPaidAt,
        requestedDeliveryDate: order.requestedDeliveryDate,
        trailerDimensions: order.trailerDimensions,
        trailerPhotoReceivedAt: order.trailerPhotoReceivedAt,
      })
    : ["Start the order."]
  // Readiness issues are already phrased as instructions; prefer them on the ready step.
  const nextAction = progress.current?.id === "ready" && readinessIssues.length > 0 ? (readinessIssues[0] ?? null) : progress.nextAction
  return { ...progress, nextAction, cancelled: order?.orderStatus === "cancelled" }
}
