"use server"

import { and, count, desc, eq } from "drizzle-orm"
import { getDb } from "@/db"
import { projectContacts, projects } from "@/db/schema"
import { projectEstimates } from "@/db/schema-estimates"
import { nuTechOrderItems, nuTechOrderWorkflows } from "@/db/schema-nutech"
import { requireAuth } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import { requireOrg } from "@/lib/org-scope"
import { requireFeaturePermission } from "@/lib/permission-enforcement"
import { projectDepartment } from "@/lib/project-branding"
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
    const user = await requireAuth()
    if (!isInternalStaffRole(user.role)) return null
    await requireFeaturePermission(user, "nutech-orders", "read")
    const organizationId = requireOrg(user)
    const { env } = await getCloudflareContext()
    if (!env?.DB) return null
    const db = getDb(env.DB)
    const project = await db
      .select({
        id: projects.id,
        projectNumber: projects.projectNumber,
        address: projects.address,
        jobStatusId: projects.jobStatusId,
        deliveryMethod: projects.deliveryMethod,
      })
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.organizationId, organizationId)))
      .limit(1)
      .get()
    if (!project) return null
    if (projectDepartment({ projectId: project.id, projectNumber: project.projectNumber }) !== "N") return null

    const [order, estimate, contacts, followUps] = await Promise.all([
      db.select().from(nuTechOrderWorkflows).where(eq(nuTechOrderWorkflows.projectId, projectId)).limit(1).get(),
      db
        .select({ status: projectEstimates.status, taxEntityId: projectEstimates.defaultTaxEntityId })
        .from(projectEstimates)
        .where(eq(projectEstimates.projectId, projectId))
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
    return { projectId, progress: nuTechOrderProgress(snapshot), hasOrder: order !== undefined, followUp: snapshot.followUp, fulfillment }
  } catch (error) {
    console.error("Nu-Tech order overview unavailable", error)
    return null
  }
}
