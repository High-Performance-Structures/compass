"use server"

import { findNuTechOrder } from "@/lib/nutech/order-select"
import { and, count, desc, eq } from "drizzle-orm"
import { projectContacts } from "@/db/schema"
import { projectEstimates } from "@/db/schema-estimates"
import { nuTechBracingRentals, nuTechOrderItems } from "@/db/schema-nutech"
import { isNuTechJob, readNuTechProject } from "@/lib/domain/nutech/access"
import { requireFeaturePermission } from "@/lib/permission-enforcement"
import { orgContext } from "@/lib/server/action-context"
import { loadWorkflowChecks, readWorkflowCustomization } from "@/lib/job-workflows/server"
import { loadProjectFollowUpSignals } from "@/lib/project-aging-server"
import { isInternalStaffRole } from "@/lib/user-roles"
import type { ProjectFollowUpSignal } from "@/lib/project-follow-up"
import { nuTechOrderProgress, type NuTechOrderProgress, type NuTechOrderSnapshot } from "@/lib/nutech/order-steps"
import {
  NUTECH_DELIVERY_METHOD_OPTIONS,
  NUTECH_ORDER_STATUS_OPTIONS,
  NUTECH_QUANTITY_SOURCE_OPTIONS,
  NUTECH_TAKEOFF_STATUS_OPTIONS,
} from "@/lib/nutech/workflow"

export type NuTechOrderOverview = {
  readonly projectId: string
  readonly progress: NuTechOrderProgress
  readonly hasOrder: boolean
  readonly followUp: ProjectFollowUpSignal | null
  /** Delivery or pickup, from the order, else the job; null when not chosen. */
  readonly fulfillment: "delivery" | "pickup" | null
}

function pick<T extends string>(options: readonly { readonly value: T }[], value: string, fallback: T): T {
  return options.find((option) => option.value === value)?.value ?? fallback
}

/**
 * Where an N job stands in the Nu-Tech order process, for the job overview.
 * Null for other departments and for people without office access to the
 * Nu-Tech workflow.
 */
export async function getNuTechOrderOverview(projectId: string): Promise<NuTechOrderOverview | null> {
  try {
    const context = await orgContext()
    // No user, company or database: no overview.
    if (!context.success) return null
    const { db, user, organizationId } = context.data
    if (!isInternalStaffRole(user.role)) return null
    await requireFeaturePermission(user, "nutech-orders", "read")
    const project = await readNuTechProject(db, organizationId, projectId)
    if (!project) return null
    if (!isNuTechJob(project)) return null

    // The job overview follows the newest order and that order's estimate.
    const latestOrder = await findNuTechOrder(db, projectId, null)
    const [order, estimate, contacts, followUps, customization, checks, rentals] = await Promise.all([
      Promise.resolve(latestOrder),
      db
        .select({ status: projectEstimates.status, taxEntityId: projectEstimates.defaultTaxEntityId })
        .from(projectEstimates)
        .where(latestOrder?.estimateId ? eq(projectEstimates.id, latestOrder.estimateId) : eq(projectEstimates.projectId, projectId))
        .orderBy(desc(projectEstimates.updatedAt))
        .limit(1)
        .get(),
      db
        .select({ total: count() })
        .from(projectContacts)
        .where(
          and(
            eq(projectContacts.projectId, projectId),
            eq(projectContacts.contactType, "owner"),
            eq(projectContacts.active, true),
          ),
        )
        .get(),
      loadProjectFollowUpSignals(db, organizationId, [project], new Date()).catch(() => new Map()),
      readWorkflowCustomization(db, organizationId, "N"),
      loadWorkflowChecks(db, organizationId, projectId),
      db
        .select({ status: nuTechBracingRentals.status })
        .from(nuTechBracingRentals)
        .where(and(eq(nuTechBracingRentals.projectId, projectId), eq(nuTechBracingRentals.organizationId, organizationId))),
    ])
    const itemCount = order
      ? ((await db.select({ total: count() }).from(nuTechOrderItems).where(eq(nuTechOrderItems.workflowId, order.id)).get())?.total ?? 0)
      : 0

    const snapshot: NuTechOrderSnapshot = {
      projectId,
      address: project.address,
      clientContactCount: contacts?.total ?? 0,
      projectDeliveryMethod:
        project.deliveryMethod === "delivery" || project.deliveryMethod === "pickup" ? project.deliveryMethod : null,
      followUp: followUps.get(projectId) ?? null,
      estimateStatus: estimate?.status ?? null,
      estimateTaxChosen: (estimate?.taxEntityId ?? null) !== null,
      bracing: {
        included: (order?.bracingIncluded ?? false) || rentals.length > 0,
        signedOut: rentals.some((rental) => rental.status === "out" || rental.status === "returned"),
        returned: rentals.length > 0 && rentals.every((rental) => rental.status === "returned"),
      },
      order: order
        ? {
            quantitySource: pick(NUTECH_QUANTITY_SOURCE_OPTIONS, order.quantitySource, "customer_provided"),
            takeoffAcknowledgementStatus: pick(NUTECH_TAKEOFF_STATUS_OPTIONS, order.takeoffAcknowledgementStatus, "not_required"),
            deliveryMethod: pick(NUTECH_DELIVERY_METHOD_OPTIONS, order.deliveryMethod, "delivery"),
            requestedDeliveryDate: order.requestedDeliveryDate,
            customerPaidAt: order.customerPaidAt,
            trailerDimensions: order.trailerDimensions,
            trailerPhotoReceivedAt: order.trailerPhotoReceivedAt,
            itemCount,
            airlitePurchaseOrderLinked: order.airlitePurchaseOrderOperationId !== null,
            airliteWorkbookGenerated: order.airliteWorkbookStatus.startsWith("generated"),
            purchaseOrderReleasedAt: order.purchaseOrderReleasedAt,
            vendorConfirmationNumber: order.vendorConfirmationNumber,
            vendorInvoiceNumber: order.vendorInvoiceNumber,
            vendorInvoiceReleasedAt: order.vendorInvoiceReleasedAt,
            orderStatus: pick(NUTECH_ORDER_STATUS_OPTIONS, order.orderStatus, "intake"),
          }
        : null,
    }
    const fulfillment = snapshot.order
      ? snapshot.order.deliveryMethod === "delivery"
        ? "delivery"
        : "pickup"
      : snapshot.projectDeliveryMethod
    return { projectId, progress: nuTechOrderProgress(snapshot, customization.overrides, checks, customization.layout), hasOrder: order !== undefined, followUp: snapshot.followUp, fulfillment }
  } catch (error) {
    console.error("Nu-Tech order overview unavailable", error)
    return null
  }
}
