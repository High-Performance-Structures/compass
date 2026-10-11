"use server"

import { and, asc, eq, inArray } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { getDb } from "@/db"
import { projectOperations, projects, sageCostCodes } from "@/db/schema"
import { nuTechOrderItems, nuTechOrderWorkflows, nuTechProducts } from "@/db/schema-nutech"
import { createPurchaseOrderRequest, type CreatePurchaseOrderLineInput } from "@/app/actions/project-operations"
import { requireAuth } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import { isDemoOrg, isDemoUser } from "@/lib/demo"
import { readFeatureSettings } from "@/lib/feature-settings/server"
import { requireOrg } from "@/lib/org-scope"
import { requireFeaturePermission } from "@/lib/permission-enforcement"
import { projectDepartment } from "@/lib/project-branding"

type Result<T> = { readonly success: true; readonly data: T } | { readonly success: false; readonly error: string }

/**
 * The manufacturer purchase order for an N job, built from its Nu-Tech order:
 * the manufacturer as vendor, each catalog item at cost with its cost code,
 * ship-to for delivery or warehouse pickup, the requested date, and the
 * dealer account. The new PO is linked to the order. When the order already
 * has a linked PO, that one is returned instead of creating a second.
 */
export async function createNuTechManufacturerPurchaseOrder(projectId: string): Promise<Result<{ readonly purchaseOrderId: string; readonly created: boolean }>> {
  try {
    const user = await requireAuth()
    if (isDemoUser(user.id)) return { success: false, error: "Demo data cannot be changed." }
    await requireFeaturePermission(user, "nutech-orders", "update")
    const organizationId = requireOrg(user)
    if (isDemoOrg(organizationId)) return { success: false, error: "Demo data cannot be changed." }
    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)
    const project = await db
      .select({ id: projects.id, projectNumber: projects.projectNumber, name: projects.name, address: projects.address })
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.organizationId, organizationId)))
      .get()
    if (!project) return { success: false, error: "Project not found." }
    if (projectDepartment({ projectId: project.id, projectNumber: project.projectNumber }) !== "N") {
      return { success: false, error: "Manufacturer purchase orders are built from Nu-Tech orders on N jobs." }
    }
    const order = await db.select().from(nuTechOrderWorkflows).where(eq(nuTechOrderWorkflows.projectId, projectId)).get()
    if (!order) return { success: false, error: "Start the Nu-Tech order first, then add its catalog items." }

    if (order.airlitePurchaseOrderOperationId) {
      const linked = await db
        .select({ id: projectOperations.id })
        .from(projectOperations)
        .where(and(eq(projectOperations.id, order.airlitePurchaseOrderOperationId), eq(projectOperations.projectId, projectId)))
        .get()
      if (linked) return { success: true, data: { purchaseOrderId: linked.id, created: false } }
    }
    if (order.purchaseOrderReleasedAt !== null) {
      return { success: false, error: "This order's purchase order was already released; it can't be replaced." }
    }

    const items = await db
      .select({
        quantity: nuTechOrderItems.quantity,
        sku: nuTechOrderItems.manufacturerSkuSnapshot,
        name: nuTechOrderItems.productNameSnapshot,
        unit: nuTechOrderItems.priceUnitSnapshot,
        unitCostCents: nuTechOrderItems.unitCostCents,
        costCodeId: nuTechProducts.sageCostCodeId,
      })
      .from(nuTechOrderItems)
      .innerJoin(nuTechProducts, eq(nuTechProducts.id, nuTechOrderItems.productId))
      .where(eq(nuTechOrderItems.workflowId, order.id))
      .orderBy(asc(nuTechOrderItems.sortOrder))
    if (items.length === 0) return { success: false, error: "Add the catalog items to the Nu-Tech order first." }

    const settings = await readFeatureSettings(db, organizationId, "nutech-emails")
    const vendor = settings.manufacturerName.trim()
    if (!vendor) {
      return { success: false, error: "Enter the manufacturer's name in Settings → Workflows → Nu-Tech emails first." }
    }
    const costCodeIds = [...new Set(items.flatMap((item) => (item.costCodeId ? [item.costCodeId] : [])))]
    const codes = costCodeIds.length
      ? await db.select({ id: sageCostCodes.id, code: sageCostCodes.code }).from(sageCostCodes).where(inArray(sageCostCodes.id, costCodeIds))
      : []
    const codeById = new Map(codes.map((code) => [code.id, code.code]))

    const pickup = order.deliveryMethod !== "delivery"
    const warehouse = [settings.warehouseName, settings.warehouseAddress].map((part) => part.trim()).filter(Boolean).join(", ")
    const shipTo = pickup ? `Customer pickup${warehouse ? `: ${warehouse}` : ""}` : project.address
    const lines: CreatePurchaseOrderLineInput[] = items.map((item) => ({
      description: `${item.sku} ${item.name}`.trim(),
      costCode: item.costCodeId ? (codeById.get(item.costCodeId) ?? null) : null,
      phaseCode: null,
      quantity: item.quantity,
      unitCost: item.unitCostCents / 100,
      unit: item.unit,
      amount: (item.unitCostCents * item.quantity) / 100,
      taxGroup: null,
    }))
    const description = [
      settings.dealerAccountNumber ? `Dealer account ${settings.dealerAccountNumber}.` : null,
      pickup ? "Customer pickup" : `Deliver to ${project.address ?? "the job site"}`,
      order.requestedDeliveryDate ? `requested ${order.requestedDeliveryDate}.` : null,
      pickup && order.trailerDimensions ? `Trailer: ${order.trailerDimensions}.` : null,
    ]
      .filter((part): part is string => part !== null)
      .join(" ")

    const created = await createPurchaseOrderRequest(projectId, {
      title: `${vendor} order${project.projectNumber ? ` ${project.projectNumber}` : ""}`,
      description,
      companyName: vendor,
      sageVendorId: settings.manufacturerVendorId.trim() || null,
      assigneeName: null,
      siteContactPhone: null,
      shipTo,
      orderDate: null,
      dueDate: order.requestedDeliveryDate,
      priority: "normal",
      lines,
    })
    if (!created.success) return { success: false, error: created.error }
    const purchaseOrderId = created.id

    await db
      .update(nuTechOrderWorkflows)
      .set({ airlitePurchaseOrderOperationId: purchaseOrderId, updatedBy: user.id, updatedAt: new Date().toISOString() })
      .where(eq(nuTechOrderWorkflows.id, order.id))
    revalidatePath(`/dashboard/projects/${projectId}/purchase-orders`)
    revalidatePath(`/dashboard/projects/${projectId}/nutech`)
    revalidatePath(`/dashboard/projects/${projectId}`)
    return { success: true, data: { purchaseOrderId, created: true } }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Unable to create the purchase order." }
  }
}

/** The manufacturer's name for button labels; blank when not set. */
export async function getNuTechManufacturerName(): Promise<string> {
  try {
    const user = await requireAuth()
    const organizationId = requireOrg(user)
    const { env } = await getCloudflareContext()
    const settings = await readFeatureSettings(getDb(env.DB), organizationId, "nutech-emails")
    return settings.manufacturerName.trim()
  } catch {
    return ""
  }
}
