"use server"

import { and, asc, desc, eq, inArray } from "drizzle-orm"
import { findNuTechOrder } from "@/lib/nutech/order-select"
import { revalidatePath } from "next/cache"
import { getDb } from "@/db"
import { projectOperations, projects, sageCostCodes } from "@/db/schema"
import { nuTechCatalogPrices, nuTechCatalogVersions, nuTechOrderItems, nuTechOrderWorkflows, nuTechProducts } from "@/db/schema-nutech"
import { generateNuTechAirliteWorkbook } from "@/app/actions/nutech-order-items"
import { createPurchaseOrderRequest, type CreatePurchaseOrderLineInput, type ProjectPurchaseOrderCostCodeOption } from "@/app/actions/project-operations"
import type { PurchaseOrderCatalogItem } from "@/lib/purchase-orders/catalog-item"
import { requireAuth } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import { isDemoOrg, isDemoUser } from "@/lib/demo"
import { readFeatureSettings } from "@/lib/feature-settings/server"
import { requireOrg } from "@/lib/org-scope"
import { requireFeaturePermission } from "@/lib/permission-enforcement"
import { projectEstimateCostCodeCatalog } from "@/lib/estimates/project-cost-code-catalog"
import { assignNuTechAirlitePoNumber } from "@/lib/nutech/airlite-po-number"
import { isNuTechFreight, loadNuTechFreight, nuTechProductCostCode } from "@/lib/nutech/freight"
import { projectDepartment } from "@/lib/project-branding"

type Result<T> = { readonly success: true; readonly data: T } | { readonly success: false; readonly error: string }

type NuTechManufacturerPoResult = {
  readonly purchaseOrderId: string
  readonly created: boolean
  /** The manufacturer's filled order form; null with formError when it couldn't be filled. */
  readonly workbookUrl: string | null
  readonly formError: string | null
}

/** Fills the manufacturer's order form for the new PO, unless one is already filled. */
async function fillOrderForm(
  projectId: string,
  existingUrl: string | null
): Promise<{ readonly workbookUrl: string | null; readonly formError: string | null }> {
  if (existingUrl) return { workbookUrl: existingUrl, formError: null }
  const result = await generateNuTechAirliteWorkbook(projectId)
  return result.success
    ? { workbookUrl: result.workbookUrl ?? null, formError: null }
    : { workbookUrl: null, formError: result.error }
}

/**
 * The manufacturer purchase order for an N job, built from its Nu-Tech order:
 * the manufacturer as vendor, each catalog item at cost with its cost code,
 * ship-to for delivery or warehouse pickup, the requested date, and the
 * dealer account. The new PO is linked to the order. When the order already
 * has a linked PO, that one is returned instead of creating a second. Either
 * way the manufacturer's own order form is filled for it.
 */
export async function createNuTechManufacturerPurchaseOrder(projectId: string, orderId?: string | null): Promise<Result<NuTechManufacturerPoResult>> {
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
    const order = await findNuTechOrder(db, projectId, orderId)
    if (!order) return { success: false, error: "Start the Nu-Tech order first, then add its catalog items." }

    if (order.airlitePurchaseOrderOperationId) {
      const linked = await db
        .select({ id: projectOperations.id })
        .from(projectOperations)
        .where(and(eq(projectOperations.id, order.airlitePurchaseOrderOperationId), eq(projectOperations.projectId, projectId)))
        .get()
      if (linked) {
        await assignNuTechAirlitePoNumber(db, {
          organizationId,
          workflowId: order.id,
          projectId,
          projectNumber: project.projectNumber,
          assigned: order.airlitePoSequence,
          purchaseOrderId: linked.id,
          purchaseOrderReleased: order.purchaseOrderReleasedAt !== null,
        })
        return { success: true, data: { purchaseOrderId: linked.id, created: false, ...(await fillOrderForm(projectId, order.airliteWorkbookUrl)) } }
      }
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
        costCodeName: nuTechProducts.sageCostCodeName,
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
      costCode:
        nuTechProductCostCode({ sageCode: (item.costCodeId ? codeById.get(item.costCodeId) : undefined) ?? null, sageCostCodeName: item.costCodeName }) ??
        (settings.productCostCode.trim() || null),
      phaseCode: null,
      quantity: item.quantity,
      unitCost: item.unitCostCents / 100,
      unit: item.unit,
      amount: (item.unitCostCents * item.quantity) / 100,
      taxGroup: null,
    }))
    // The freight quoted for a delivery is the manufacturer's charge too.
    const freightCents = order.deliveryMethod === "delivery" ? (order.shippingCents ?? 0) : 0
    if (freightCents > 0) {
      const freight = await loadNuTechFreight(db, organizationId)
      lines.push({
        description: order.shippingNote ? `Freight (${order.shippingNote})` : "Freight",
        costCode: freight.costCode ?? (settings.shippingCostCode.trim() || null),
        phaseCode: null,
        quantity: 1,
        unitCost: freightCents / 100,
        unit: "LS",
        amount: freightCents / 100,
        taxGroup: null,
      })
    }
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
    await assignNuTechAirlitePoNumber(db, {
      organizationId,
      workflowId: order.id,
      projectId,
      projectNumber: project.projectNumber,
      assigned: order.airlitePoSequence,
      purchaseOrderId,
      purchaseOrderReleased: false,
    })
    revalidatePath(`/dashboard/projects/${projectId}/purchase-orders`)
    revalidatePath(`/dashboard/projects/${projectId}/nutech`)
    revalidatePath(`/dashboard/projects/${projectId}`)
    return { success: true, data: { purchaseOrderId, created: true, ...(await fillOrderForm(projectId, null)) } }
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

/**
 * The active Fox Blocks price list as PO line choices for an N job: each
 * product with its manufacturer cost and cost code. Empty for other jobs
 * or when no catalog is active.
 */
export async function getNuTechPurchaseOrderCatalog(projectId: string): Promise<readonly PurchaseOrderCatalogItem[]> {
  try {
    const user = await requireAuth()
    await requireFeaturePermission(user, "nutech-orders", "read")
    const organizationId = requireOrg(user)
    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)
    const project = await db
      .select({ id: projects.id, projectNumber: projects.projectNumber })
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.organizationId, organizationId)))
      .get()
    if (!project || projectDepartment({ projectId: project.id, projectNumber: project.projectNumber }) !== "N") return []
    const version = await db
      .select({ id: nuTechCatalogVersions.id })
      .from(nuTechCatalogVersions)
      .where(and(eq(nuTechCatalogVersions.organizationId, organizationId), eq(nuTechCatalogVersions.status, "active")))
      .orderBy(desc(nuTechCatalogVersions.effectiveDate))
      .limit(1)
      .get()
    if (!version) return []
    const settings = await readFeatureSettings(db, organizationId, "nutech-emails")
    const rows = await db
      .select({
        id: nuTechProducts.id,
        sku: nuTechProducts.manufacturerSku,
        name: nuTechProducts.name,
        unit: nuTechProducts.priceUnit,
        packageLabel: nuTechProducts.packageLabel,
        category: nuTechProducts.category,
        costCents: nuTechCatalogPrices.airliteCostCents,
        sageCode: sageCostCodes.code,
        sageCostCodeName: nuTechProducts.sageCostCodeName,
      })
      .from(nuTechCatalogPrices)
      .innerJoin(nuTechProducts, eq(nuTechProducts.id, nuTechCatalogPrices.productId))
      .leftJoin(sageCostCodes, eq(sageCostCodes.id, nuTechProducts.sageCostCodeId))
      .where(
        and(
          eq(nuTechCatalogPrices.catalogVersionId, version.id),
          eq(nuTechProducts.organizationId, organizationId),
          eq(nuTechProducts.active, true),
        ),
      )
      .orderBy(asc(nuTechProducts.manufacturerSku))
    return rows.map((row): PurchaseOrderCatalogItem => {
      const costCode = nuTechProductCostCode(row)
      // Freight is quoted per order: the line takes its cost code, and the amount is typed in.
      if (isNuTechFreight(row)) {
        const code = costCode ?? (settings.shippingCostCode.trim() || null)
        return {
          id: row.id,
          description: `Freight (${settings.manufacturerName.trim() || "manufacturer"})`,
          unit: "LS",
          unitCost: 0,
          costCode: code,
          detail: `Quoted per order · enter the amount${code ? ` · ${code}` : ""}`,
        }
      }
      return {
        id: row.id,
        description: `${row.sku} ${row.name}`.trim(),
        unit: row.unit,
        unitCost: row.costCents / 100,
        costCode: costCode ?? (settings.productCostCode.trim() || null),
        detail: `$${(row.costCents / 100).toFixed(2)} per ${row.unit}${row.packageLabel ? ` · ${row.packageLabel}` : ""}`,
      }
    })
  } catch {
    return []
  }
}

export type NuTechCostCodeOption = { readonly value: string; readonly label: string; readonly divisionCode: string }

/** The company cost code list (numbered Sage codes plus named items like "ICF Shipping") for the Nu-Tech settings pickers. */
export async function getNuTechCostCodeOptions(): Promise<readonly NuTechCostCodeOption[]> {
  try {
    const user = await requireAuth()
    await requireFeaturePermission(user, "nutech-orders", "read")
    const { env } = await getCloudflareContext()
    const sageRows = await getDb(env.DB)
      .select({
        code: sageCostCodes.code,
        description: sageCostCodes.description,
        displayLabel: sageCostCodes.displayLabel,
        divisionCode: sageCostCodes.divisionCode,
        divisionDescription: sageCostCodes.divisionDescription,
        divisionDisplayLabel: sageCostCodes.divisionDisplayLabel,
      })
      .from(sageCostCodes)
      .where(eq(sageCostCodes.active, true))
    return projectEstimateCostCodeCatalog(sageRows, []).map((item) => ({ value: item.code, label: item.displayLabel, divisionCode: item.divisionCode }))
  } catch {
    return []
  }
}

/**
 * The shipping cost code from Settings as a PO cost code choice. Named
 * company codes such as "ICF Shipping" aren't in the numbered Sage list the
 * PO picker reads, so the manufacturer PO adds this one.
 */
export async function getNuTechShippingCostCodeOption(): Promise<ProjectPurchaseOrderCostCodeOption | null> {
  try {
    const user = await requireAuth()
    await requireFeaturePermission(user, "nutech-orders", "read")
    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)
    const organizationId = requireOrg(user)
    const code = (await loadNuTechFreight(db, organizationId)).costCode ?? (await readFeatureSettings(db, organizationId, "nutech-emails")).shippingCostCode.trim()
    if (!code) return null
    const match = (await getNuTechCostCodeOptions()).find((option) => option.value === code)
    return { value: code, label: match?.label ?? code, description: match?.label ?? code, divisionCode: match?.divisionCode ?? "" }
  } catch {
    return null
  }
}

/** The PO linked to a job's Nu-Tech order and its filled order form, for the Purchase Orders page; null when none is linked. */
export type NuTechOrderFormLink = {
  readonly orderId: string
  readonly purchaseOrderId: string
  readonly workbookUrl: string | null
  readonly released: boolean
}

/** Each of the job's orders that has a manufacturer PO, with its order form. */
export async function getNuTechOrderFormLinks(projectId: string): Promise<readonly NuTechOrderFormLink[]> {
  try {
    const user = await requireAuth()
    await requireFeaturePermission(user, "nutech-orders", "read")
    const organizationId = requireOrg(user)
    const { env } = await getCloudflareContext()
    const rows = await getDb(env.DB)
      .select({
        orderId: nuTechOrderWorkflows.id,
        purchaseOrderId: nuTechOrderWorkflows.airlitePurchaseOrderOperationId,
        workbookUrl: nuTechOrderWorkflows.airliteWorkbookUrl,
        releasedAt: nuTechOrderWorkflows.purchaseOrderReleasedAt,
      })
      .from(nuTechOrderWorkflows)
      .innerJoin(projects, eq(projects.id, nuTechOrderWorkflows.projectId))
      .where(and(eq(nuTechOrderWorkflows.projectId, projectId), eq(projects.organizationId, organizationId)))
    return rows.flatMap((row) =>
      row.purchaseOrderId
        ? [{ orderId: row.orderId, purchaseOrderId: row.purchaseOrderId, workbookUrl: row.workbookUrl, released: row.releasedAt !== null }]
        : [],
    )
  } catch {
    return []
  }
}
