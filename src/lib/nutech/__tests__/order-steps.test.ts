import { describe, expect, it } from "vitest"
import { nuTechOrderProgress, type NuTechOrderSnapshot } from "@/lib/nutech/order-steps"
import {
  jobStatusForNuTechOrderStatus,
  nuTechCustomerReadinessIssues,
  projectDeliveryMethodForNuTech,
} from "@/lib/nutech/workflow"

type Order = NonNullable<NuTechOrderSnapshot["order"]>

const order = (overrides: Partial<Order> = {}): Order => ({
  quantitySource: "customer_provided",
  takeoffAcknowledgementStatus: "not_required",
  deliveryMethod: "customer_pickup",
  requestedDeliveryDate: null,
  customerPaidAt: null,
  trailerDimensions: null,
  trailerPhotoReceivedAt: null,
  itemCount: 0,
  airlitePurchaseOrderLinked: false,
  airliteWorkbookGenerated: false,
  purchaseOrderReleasedAt: null,
  vendorConfirmationNumber: null,
  vendorInvoiceNumber: null,
  vendorInvoiceReleasedAt: null,
  orderStatus: "intake",
  ...overrides,
})

const snapshot = (overrides: Partial<NuTechOrderSnapshot> = {}): NuTechOrderSnapshot => ({
  projectId: "n1",
  address: "12 Main St, Fairplay, CO",
  clientContactCount: 1,
  projectDeliveryMethod: null,
  followUp: null,
  estimateStatus: null,
  estimateTaxChosen: false,
  order: null,
  ...overrides,
})

describe("nuTechOrderProgress", () => {
  it("starts at intake and asks for the order to be started", () => {
    const progress = nuTechOrderProgress(snapshot({ projectDeliveryMethod: "pickup" }))
    expect(progress.current?.id).toBe("intake")
    expect(progress.nextAction).toBe("Start the order and record who supplies quantities.")
  })

  it("asks for the delivery address only for deliveries", () => {
    const progress = nuTechOrderProgress(snapshot({ address: null, projectDeliveryMethod: "delivery" }))
    expect(progress.current?.checklist.map((entry) => entry.label)).toContain("Add the delivery address")
    const pickup = nuTechOrderProgress(snapshot({ address: null, projectDeliveryMethod: "pickup" }))
    expect(pickup.current?.checklist.map((entry) => entry.label)).not.toContain("Add the delivery address")
  })

  it("moves through quantities and estimate to payment", () => {
    const progress = nuTechOrderProgress(
      snapshot({ order: order({ itemCount: 3 }), estimateStatus: "signature_pending", estimateTaxChosen: true }),
    )
    expect(progress.steps.slice(0, 3).map((step) => step.state)).toEqual(["done", "done", "done"])
    expect(progress.current?.id).toBe("payment")
    expect(progress.nextAction).toBe("Record the customer's payment.")
  })

  it("requires the signed acknowledgement for a staff takeoff", () => {
    const progress = nuTechOrderProgress(
      snapshot({
        order: order({ itemCount: 3, quantitySource: "staff_takeoff", takeoffAcknowledgementStatus: "sent", customerPaidAt: "2026-10-10" }),
        estimateStatus: "accepted",
        estimateTaxChosen: true,
      }),
    )
    expect(progress.current?.id).toBe("payment")
    expect(progress.nextAction).toBe("Get the signed takeoff acknowledgement.")
  })

  it("holds a pickup at ready to order until the trailer details are in", () => {
    const progress = nuTechOrderProgress(
      snapshot({
        order: order({ itemCount: 3, customerPaidAt: "2026-10-10", requestedDeliveryDate: "2026-10-20" }),
        estimateStatus: "accepted",
        estimateTaxChosen: true,
      }),
    )
    expect(progress.current?.id).toBe("ready")
    expect(progress.nextAction).toBe("Get the trailer dimensions.")
  })

  it("is complete when every step is done", () => {
    const progress = nuTechOrderProgress(
      snapshot({
        order: order({
          deliveryMethod: "delivery",
          itemCount: 3,
          customerPaidAt: "2026-10-10",
          requestedDeliveryDate: "2026-10-20",
          airlitePurchaseOrderLinked: true,
          airliteWorkbookGenerated: true,
          purchaseOrderReleasedAt: "2026-10-11T00:00:00Z",
          vendorConfirmationNumber: "81532-EPS",
          vendorInvoiceNumber: "Inv. 1-EPS",
          vendorInvoiceReleasedAt: "2026-10-30T00:00:00Z",
          orderStatus: "complete",
        }),
        estimateStatus: "accepted",
        estimateTaxChosen: true,
      }),
    )
    expect(progress.current).toBeNull()
    expect(progress.steps.every((step) => step.state === "done")).toBe(true)
  })
})

describe("Nu-Tech readiness and job sync", () => {
  it("lists what the customer still owes before ordering", () => {
    expect(
      nuTechCustomerReadinessIssues({
        deliveryMethod: "delivery",
        customerPaidAt: null,
        requestedDeliveryDate: null,
        trailerDimensions: null,
        trailerPhotoReceivedAt: null,
      }),
    ).toEqual(["Record the customer's payment.", "Get the requested delivery date."])
    expect(
      nuTechCustomerReadinessIssues({
        deliveryMethod: "customer_pickup",
        customerPaidAt: "2026-10-10",
        requestedDeliveryDate: "2026-10-20",
        trailerDimensions: null,
        trailerPhotoReceivedAt: null,
      }),
    ).toEqual(["Get the trailer dimensions.", "Get a photo of the trailer."])
  })

  it("maps order statuses to pipeline job statuses", () => {
    expect(jobStatusForNuTechOrderStatus("customer_approved")).toBe("awaiting_payment")
    expect(jobStatusForNuTechOrderStatus("po_released")).toBe("ordered")
    expect(jobStatusForNuTechOrderStatus("complete")).toBe("complete")
    expect(jobStatusForNuTechOrderStatus("cancelled")).toBeNull()
    expect(projectDeliveryMethodForNuTech("will_call")).toBe("pickup")
  })
})
