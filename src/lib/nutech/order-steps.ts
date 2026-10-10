import type { ProjectFollowUpSignal } from "@/lib/project-follow-up"
import {
  nuTechCustomerReadinessIssues,
  type NuTechDeliveryMethod,
  type NuTechOrderStatus,
  type NuTechQuantitySource,
  type NuTechTakeoffAcknowledgementStatus,
} from "@/lib/nutech/workflow"

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

export type NuTechChecklistItem = {
  readonly label: string
  readonly done: boolean
  /** Where to fill it in, relative to the job. */
  readonly path: string
}

export type NuTechOrderStep = {
  readonly id: NuTechStepId
  readonly label: string
  readonly state: "done" | "current" | "upcoming"
  readonly checklist: readonly NuTechChecklistItem[]
}

export type NuTechOrderProgress = {
  readonly steps: readonly NuTechOrderStep[]
  readonly current: NuTechOrderStep | null
  /** The first open item of the current step, as an instruction. */
  readonly nextAction: string | null
  readonly cancelled: boolean
}

const ESTIMATE_SENT = new Set(["signature_pending", "accepted"])

function item(label: string, done: boolean, path: string): NuTechChecklistItem {
  return { label, done, path }
}

/**
 * The order process from Rebekah's cheat sheet as checklists over what
 * Compass already records. A step is done when its checklist is complete;
 * the first incomplete step is current.
 */
export function nuTechOrderProgress(snapshot: NuTechOrderSnapshot): NuTechOrderProgress {
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
  const readinessIssues = order
    ? nuTechCustomerReadinessIssues({
        deliveryMethod: order.deliveryMethod,
        customerPaidAt: order.customerPaidAt,
        requestedDeliveryDate: order.requestedDeliveryDate,
        trailerDimensions: order.trailerDimensions,
        trailerPhotoReceivedAt: order.trailerPhotoReceivedAt,
      })
    : ["Start the order."]
  const released = order?.purchaseOrderReleasedAt != null

  const definitions: readonly { readonly id: NuTechStepId; readonly label: string; readonly checklist: readonly NuTechChecklistItem[] }[] = [
    {
      id: "intake",
      label: "Intake",
      checklist: [
        item("Add the customer as a client contact", snapshot.clientContactCount > 0, "contacts"),
        item("Choose delivery or customer pickup", delivery !== null, "nutech#nutech-fulfillment"),
        ...(delivery === "delivery"
          ? [item("Add the delivery address", (snapshot.address?.trim() ?? "") !== "", "information")]
          : []),
        item("Start the order and record who supplies quantities", order !== null, "nutech#nutech-intake"),
      ],
    },
    {
      id: "quantities",
      label: "Quantities",
      checklist: [item("Add catalog items (whole bundles)", (order?.itemCount ?? 0) > 0, "nutech#nutech-quantities")],
    },
    {
      id: "estimate",
      label: "Estimate",
      checklist: [
        item("Build the estimate", snapshot.estimateStatus !== null, "estimate"),
        item("Choose the sales tax district for the delivery address", snapshot.estimateTaxChosen, "estimate"),
        item("Send the estimate to the customer", snapshot.estimateStatus !== null && ESTIMATE_SENT.has(snapshot.estimateStatus), "estimate"),
      ],
    },
    {
      id: "payment",
      label: "Approval & payment",
      checklist: [
        ...(staffTakeoff
          ? [item("Get the signed takeoff acknowledgement", order?.takeoffAcknowledgementStatus === "signed", "nutech#nutech-intake")]
          : []),
        item("Record the customer's payment", order?.customerPaidAt != null, "nutech#nutech-fulfillment"),
      ],
    },
    {
      id: "ready",
      label: "Ready to order",
      checklist: [
        item(delivery === "delivery" ? "Requested delivery date" : "Requested pickup date", order?.requestedDeliveryDate != null, "nutech#nutech-fulfillment"),
        ...(delivery === "customer_pickup"
          ? [
              item("Trailer dimensions", order?.trailerDimensions != null, "nutech#nutech-fulfillment"),
              item("Trailer photo", order?.trailerPhotoReceivedAt != null, "nutech#nutech-fulfillment"),
            ]
          : []),
        item("Signed acknowledgement and payment", ackDone && order?.customerPaidAt != null, "nutech#nutech-fulfillment"),
      ],
    },
    {
      id: "order",
      label: "Order placed",
      checklist: [
        item("Create the Airlite PO and link it", order?.airlitePurchaseOrderLinked ?? false, "purchase-orders"),
        item("Generate the Airlite order form", order?.airliteWorkbookGenerated ?? false, "nutech#nutech-airlite"),
        item("Send the order and record the release", released, "nutech#nutech-airlite"),
      ],
    },
    {
      id: "confirmed",
      label: "Confirmed",
      checklist: [item("Record Airlite's EPS confirmation number", (order?.vendorConfirmationNumber ?? null) !== null, "nutech#nutech-airlite")],
    },
    {
      id: "vendor_invoice",
      label: "Vendor invoice",
      checklist: [
        item("Record the Airlite invoice number", (order?.vendorInvoiceNumber ?? null) !== null, "nutech#nutech-airlite"),
        item("Release the invoice for payment", order?.vendorInvoiceReleasedAt != null, "nutech#nutech-airlite"),
      ],
    },
    {
      id: "complete",
      label: "Complete",
      checklist: [item("Mark the order complete after pickup or delivery", order?.orderStatus === "complete", "nutech#nutech-fulfillment")],
    },
  ]

  let currentFound = false
  const steps = definitions.map((definition): NuTechOrderStep => {
    const complete = definition.checklist.every((entry) => entry.done)
    const state = !currentFound && !complete ? "current" : currentFound ? "upcoming" : "done"
    if (state === "current") currentFound = true
    return { ...definition, state }
  })
  const current = steps.find((step) => step.state === "current") ?? null
  const nextItem = current?.checklist.find((entry) => !entry.done) ?? null
  // Readiness issues are already phrased as instructions; prefer them on the ready step.
  const nextAction =
    current?.id === "ready" && readinessIssues.length > 0 ? (readinessIssues[0] ?? null) : nextItem ? `${nextItem.label}.` : null
  return { steps, current, nextAction, cancelled: order?.orderStatus === "cancelled" }
}
