"use server"

import { readEstimateMode } from "@/lib/estimates/numbering"
import { findNuTechOrder } from "@/lib/nutech/order-select"
import { and, asc, count, desc, eq, isNull } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { getDb } from "@/db"
import { projects, sageCostCodes } from "@/db/schema"
import { projectEstimateLines, projectEstimates, sageTaxEntities } from "@/db/schema-estimates"
import { nuTechOrderItems, nuTechOrderWorkflows, nuTechProducts } from "@/db/schema-nutech"
import {
  createProjectEstimateDraft,
  deleteProjectEstimateLine,
  saveProjectEstimateLine,
  type ProjectEstimateLineInput,
} from "@/app/actions/project-estimates"
import { requireAuth } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import { isDemoOrg, isDemoUser } from "@/lib/demo"
import { readFeatureSettings } from "@/lib/feature-settings/server"
import { loadNuTechFreight, nuTechProductCostCode } from "@/lib/nutech/freight"
import { nuTechEstimateLineDescription } from "@/lib/nutech/estimate-wording"
import { requireOrg } from "@/lib/org-scope"
import { requireFeaturePermission } from "@/lib/permission-enforcement"
import { projectDepartment } from "@/lib/project-branding"

type Result<T> = { readonly success: true; readonly data: T } | { readonly success: false; readonly error: string }

export type NuTechEstimateFromOrderResult =
  | { readonly kind: "done"; readonly estimateId: string; readonly lineCount: number; readonly created: boolean }
  /** The draft estimate already has lines; ask before replacing them. */
  | { readonly kind: "confirm_replace"; readonly estimateNumber: string; readonly lineCount: number }

const EDITABLE = new Set(["draft", "internal_review"])

/**
 * Fill an order's Compass estimate from the order: one line per product at
 * the customer's price (taxed in the order's district) and a non-taxed
 * shipping line for deliveries. Each order fills its own estimate (the newest
 * version of it); an order without one gets a new estimate. Replaces a
 * draft's lines only after the caller confirms. Sent or accepted estimates
 * are left alone.
 */
export async function createNuTechEstimateFromOrder(
  projectId: string,
  replaceExistingLines: boolean,
  orderId?: string | null,
): Promise<Result<NuTechEstimateFromOrderResult>> {
  try {
    const user = await requireAuth()
    if (isDemoUser(user.id)) return { success: false, error: "Demo data cannot be changed." }
    await requireFeaturePermission(user, "nutech-orders", "update")
    const organizationId = requireOrg(user)
    if (isDemoOrg(organizationId)) return { success: false, error: "Demo data cannot be changed." }
    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)
    const project = await db
      .select({ id: projects.id, projectNumber: projects.projectNumber })
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.organizationId, organizationId)))
      .get()
    if (!project || projectDepartment({ projectId: project.id, projectNumber: project.projectNumber }) !== "N") {
      return { success: false, error: "Estimates from an order are made on N jobs." }
    }
    const order = await findNuTechOrder(db, projectId, orderId)
    if (!order) return { success: false, error: "Add products to the order first." }
    const items = await db
      .select({
        quantity: nuTechOrderItems.quantity,
        sku: nuTechOrderItems.manufacturerSkuSnapshot,
        name: nuTechOrderItems.productNameSnapshot,
        unit: nuTechOrderItems.priceUnitSnapshot,
        unitPriceCents: nuTechOrderItems.unitPriceCents,
        packageLabel: nuTechProducts.packageLabel,
        sageCode: sageCostCodes.code,
        sageCostCodeName: nuTechProducts.sageCostCodeName,
        taxable: nuTechProducts.taxable,
      })
      .from(nuTechOrderItems)
      .innerJoin(nuTechProducts, eq(nuTechProducts.id, nuTechOrderItems.productId))
      .leftJoin(sageCostCodes, eq(sageCostCodes.id, nuTechProducts.sageCostCodeId))
      .where(eq(nuTechOrderItems.workflowId, order.id))
      .orderBy(asc(nuTechOrderItems.sortOrder))
    if (items.length === 0) return { success: false, error: "Add products to the order first." }
    if (!order.taxEntityId) return { success: false, error: "Choose the order's sales tax district first (section 3)." }
    const district = await db
      .select({ id: sageTaxEntities.id, rateBasisPoints: sageTaxEntities.rateBasisPoints })
      .from(sageTaxEntities)
      .where(eq(sageTaxEntities.id, order.taxEntityId))
      .get()
    if (!district) return { success: false, error: "The order's sales tax district is no longer active; choose another." }

    const settings = await readFeatureSettings(db, organizationId, "nutech-emails")
    const productCode = settings.productCostCode.trim()
    const freight = await loadNuTechFreight(db, organizationId)
    const shippingCode = freight.costCode ?? settings.shippingCostCode.trim()
    const missingCode = items.find((item) => !nuTechProductCostCode(item) && !productCode)
    if (missingCode) {
      return { success: false, error: "Set the cost code for catalog products in Settings → Workflows → Nu-Tech emails first." }
    }
    const shippingCents = order.deliveryMethod === "delivery" ? (order.shippingCents ?? 0) : 0
    if (shippingCents > 0 && !shippingCode) {
      return { success: false, error: "Map Freight to its Sage cost code on the Nu-Tech price list first." }
    }

    // The order's own estimate, at its newest version. A job with one
    // estimate per job and an unlinked (older) order uses the job's newest.
    const mode = await readEstimateMode(db, organizationId, "N")
    const linked = order.estimateId
      ? await db
          .select({ number: projectEstimates.estimateNumber })
          .from(projectEstimates)
          .where(eq(projectEstimates.id, order.estimateId))
          .get()
      : undefined
    const latestRow =
      linked || mode === "single"
        ? await db
            .select({ id: projectEstimates.id, status: projectEstimates.status, number: projectEstimates.estimateNumber })
            .from(projectEstimates)
            .where(
              linked
                ? and(eq(projectEstimates.projectId, projectId), eq(projectEstimates.estimateNumber, linked.number))
                : and(eq(projectEstimates.projectId, projectId), isNull(projectEstimates.changeOrderId)),
            )
            .orderBy(desc(projectEstimates.versionNumber))
            .limit(1)
            .get()
        : undefined
    const latest = latestRow ?? null
    if (latest && !EDITABLE.has(latest.status)) {
      return { success: false, error: `Estimate ${latest.number} was already sent. Duplicate it as a new version on the estimate page, then try again.` }
    }
    let estimateId = latest?.id ?? null
    let created = false
    if (estimateId) {
      const existingLines = await db
        .select({ id: projectEstimateLines.id })
        .from(projectEstimateLines)
        .where(eq(projectEstimateLines.estimateId, estimateId))
      if (existingLines.length > 0 && !replaceExistingLines) {
        return { success: true, data: { kind: "confirm_replace", estimateNumber: latest?.number ?? "", lineCount: existingLines.length } }
      }
      for (const line of existingLines) {
        const removed = await deleteProjectEstimateLine(projectId, estimateId, line.id)
        if (!removed.success) return { success: false, error: removed.error }
      }
    } else {
      const draft = await createProjectEstimateDraft(projectId)
      if (!draft.success) return { success: false, error: draft.error }
      estimateId = draft.id
      created = true
      if (order.title) {
        await db.update(projectEstimates).set({ title: order.title }).where(eq(projectEstimates.id, estimateId))
      }
    }

    // The order now fills this estimate (a new version or a new estimate).
    if (order.estimateId !== estimateId) {
      await db
        .update(nuTechOrderWorkflows)
        .set({ estimateId, updatedAt: new Date().toISOString() })
        .where(eq(nuTechOrderWorkflows.id, order.id))
    }
    // The order's district becomes the estimate's default, so new lines and the checklist follow it.
    await db
      .update(projectEstimates)
      .set({ defaultTaxEntityId: district.id, defaultTaxRateBasisPoints: district.rateBasisPoints, updatedAt: new Date().toISOString() })
      .where(eq(projectEstimates.id, estimateId))

    const base = { assemblyId: null, reportPhaseId: null, markupPercent: 0, ownerVisible: true, includeInBuilderFee: false, insertAfterLineId: null }
    const lines: ProjectEstimateLineInput[] = items.map((item) => ({
      ...base,
      costCode: nuTechProductCostCode(item) ?? productCode,
      // Lines carry the customer's price; the manufacturer cost stays on the order and its PO.
      description: nuTechEstimateLineDescription({ quantity: item.quantity, unit: item.unit, name: item.name, sku: item.sku, packageLabel: item.packageLabel }),
      specifications: null,
      quantity: item.quantity,
      unit: item.unit,
      unitCost: item.unitPriceCents / 100,
      taxable: item.taxable,
      taxEntityId: item.taxable ? district.id : null,
    }))
    if (shippingCents > 0) {
      lines.push({
        ...base,
        costCode: shippingCode,
        description: order.shippingNote ? `Shipping (${order.shippingNote})` : "Shipping",
        specifications: null,
        quantity: 1,
        unit: "LS",
        unitCost: shippingCents / 100,
        taxable: freight.taxable,
        taxEntityId: freight.taxable ? district.id : null,
      })
    }
    for (const line of lines) {
      const saved = await saveProjectEstimateLine(projectId, estimateId, null, line)
      if (!saved.success) return { success: false, error: `${line.description}: ${saved.error}` }
    }
    const total = await db.select({ n: count() }).from(projectEstimateLines).where(eq(projectEstimateLines.estimateId, estimateId)).get()
    revalidatePath(`/dashboard/projects/${projectId}/estimate`)
    revalidatePath(`/dashboard/projects/${projectId}/nutech`)
    revalidatePath(`/dashboard/projects/${projectId}`)
    return { success: true, data: { kind: "done", estimateId, lineCount: total?.n ?? lines.length, created } }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Unable to fill the estimate." }
  }
}
