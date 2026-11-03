"use server"

import { and, asc, eq, ne } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { findNuTechOrder } from "@/lib/nutech/order-select"

import { projectOperations } from "@/db/schema"
import {
  nuTechCatalogPrices,
  nuTechCatalogVersions,
  nuTechOrderItems,
  nuTechOrderWorkflows,
  nuTechProducts,
} from "@/db/schema-nutech"
import type { AuthUser } from "@/lib/auth"
import { isDemoUser } from "@/lib/demo"
import { isNuTechJob, nuTechOrgContext, readNuTechProject, type NuTechProject } from "@/lib/domain/nutech/access"
import {
  nuTechShippingCents,
  nuTechWorkbookStatusAfterChange,
  storedNuTechCustomerType,
  storedNuTechPricingMode,
} from "@/lib/domain/nutech/rules"
import {
  deleteNuTechOrderItem as deleteNuTechOrderItemRow,
  recordNuTechOrderWorkbook,
  saveNuTechOrderItem as saveNuTechOrderItemRow,
} from "@/lib/domain/nutech/store"
import type { Db } from "@/lib/server/action-context"
import { getOrganizationDriveContext } from "@/lib/google/organization-drive"
import {
  airlitePurchaseOrderLabel,
  buildNuTechAirliteWorkbookPlan,
  formatAirliteDate,
  readNuTechAirliteFormLayout,
  type NuTechAirliteOrderHeader,
} from "@/lib/nutech/airlite-workbook"
import { assignNuTechAirlitePoNumber } from "@/lib/nutech/airlite-po-number"
import { NUTECH_2026_CATALOG_SOURCES } from "@/lib/nutech/resources"
import { readFeatureSettings } from "@/lib/feature-settings/server"
import {
  nuTechCustomerPriceCents,
  validateNuTechOrderQuantity,
} from "@/lib/nutech/catalog-pricing"
import { requireFeaturePermission } from "@/lib/permission-enforcement"
import { NUTECH_FREIGHT_CATEGORY } from "@/lib/nutech/freight"

type NuTechItemAccess = {
  readonly db: Db
  readonly env: CloudflareEnv
  readonly user: AuthUser
  readonly organizationId: string
  readonly project: NuTechProject
}

export type NuTechOrderItemActionResult =
  | { readonly success: true; readonly id: string; readonly workbookUrl?: string }
  | { readonly success: false; readonly error: string }

async function nuTechItemAccess(projectId: string): Promise<NuTechItemAccess> {
  const { db, env, user, organizationId } = await nuTechOrgContext()
  if (isDemoUser(user.id)) throw new Error("DEMO_READ_ONLY")
  await requireFeaturePermission(user, "nutech-orders", "update")
  const project = await readNuTechProject(db, organizationId, projectId)
  if (!project) throw new Error("Project not found.")
  if (!isNuTechJob(project)) {
    throw new Error("The Nu-Tech order workflow is available only for N projects.")
  }
  return { db, env, user, organizationId, project }
}

function revalidateNuTechOrder(projectId: string): void {
  revalidatePath("/dashboard/nutech")
  revalidatePath(`/dashboard/projects/${projectId}/nutech`)
}

function actionError(error: unknown, fallback: string): NuTechOrderItemActionResult {
  return {
    success: false,
    error: error instanceof Error ? error.message : fallback,
  }
}

export async function saveNuTechOrderItem(
  projectId: string,
  input: { readonly productId: string; readonly quantity: number; readonly orderId?: string | null }
): Promise<NuTechOrderItemActionResult> {
  try {
    const access = await nuTechItemAccess(projectId)
    const workflow = await findNuTechOrder(access.db, projectId, input.orderId)
    if (!workflow) throw new Error("Save the Nu-Tech intake before adding products.")
    if (workflow.purchaseOrderReleasedAt !== null) {
      throw new Error("Released Airlite PO quantities are locked.")
    }
    if (!workflow.catalogVersionId) {
      throw new Error("Activate a Nu-Tech product catalog before adding products.")
    }
    const product = await access.db
      .select({
        id: nuTechProducts.id,
        manufacturerSku: nuTechProducts.manufacturerSku,
        name: nuTechProducts.name,
        priceUnit: nuTechProducts.priceUnit,
        minimumOrderIncrement: nuTechProducts.minimumOrderIncrement,
        airliteCostCents: nuTechCatalogPrices.airliteCostCents,
        newStandardPriceCents: nuTechCatalogPrices.newStandardPriceCents,
        newCashPriceCents: nuTechCatalogPrices.newCashPriceCents,
        returningStandardPriceCents:
          nuTechCatalogPrices.returningStandardPriceCents,
        returningCashPriceCents: nuTechCatalogPrices.returningCashPriceCents,
      })
      .from(nuTechCatalogPrices)
      .innerJoin(
        nuTechProducts,
        eq(nuTechProducts.id, nuTechCatalogPrices.productId)
      )
      .where(
        and(
          eq(nuTechCatalogPrices.catalogVersionId, workflow.catalogVersionId),
          eq(nuTechProducts.id, input.productId),
          eq(nuTechProducts.organizationId, access.organizationId),
          eq(nuTechProducts.active, true),
          // Freight is the order's shipping charge, not a product line.
          ne(nuTechProducts.category, NUTECH_FREIGHT_CATEGORY)
        )
      )
      .limit(1)
      .get()
    if (!product) throw new Error("Choose a product from this order's catalog.")
    validateNuTechOrderQuantity({
      manufacturerSku: product.manufacturerSku,
      quantity: input.quantity,
      minimumOrderIncrement: product.minimumOrderIncrement,
    })
    const existingItems = await access.db
      .select({
        id: nuTechOrderItems.id,
        productId: nuTechOrderItems.productId,
        sortOrder: nuTechOrderItems.sortOrder,
      })
      .from(nuTechOrderItems)
      .where(eq(nuTechOrderItems.workflowId, workflow.id))
    const existing = existingItems.find((item) => item.productId === product.id)
    const id = existing?.id ?? crypto.randomUUID()
    const now = new Date().toISOString()
    const unitPriceCents = nuTechCustomerPriceCents(
      product,
      storedNuTechCustomerType(workflow.customerType),
      storedNuTechPricingMode(workflow.pricingMode)
    )
    await saveNuTechOrderItemRow(access.db, {
      item: {
        id,
        workflowId: workflow.id,
        productId: product.id,
        catalogVersionId: workflow.catalogVersionId,
        quantity: input.quantity,
        manufacturerSkuSnapshot: product.manufacturerSku,
        productNameSnapshot: product.name,
        priceUnitSnapshot: product.priceUnit,
        unitCostCents: product.airliteCostCents,
        unitPriceCents,
        sortOrder: existing?.sortOrder ?? existingItems.length,
        createdAt: now,
        updatedAt: now,
      },
      order: {
        id: workflow.id,
        orderStatus: workflow.orderStatus === "intake" ? "quantities_ready" : workflow.orderStatus,
        workbookStatus: nuTechWorkbookStatusAfterChange(workflow.airliteWorkbookStatus),
      },
      userId: access.user.id,
      now,
    })
    revalidateNuTechOrder(projectId)
    return { success: true, id }
  } catch (error) {
    return actionError(error, "Failed to save the Nu-Tech order item.")
  }
}

export async function deleteNuTechOrderItem(
  projectId: string,
  itemId: string
): Promise<NuTechOrderItemActionResult> {
  try {
    const access = await nuTechItemAccess(projectId)
    const item = await access.db
      .select({
        id: nuTechOrderItems.id,
        workflowId: nuTechOrderItems.workflowId,
        airliteWorkbookStatus: nuTechOrderWorkflows.airliteWorkbookStatus,
        purchaseOrderReleasedAt: nuTechOrderWorkflows.purchaseOrderReleasedAt,
      })
      .from(nuTechOrderItems)
      .innerJoin(
        nuTechOrderWorkflows,
        eq(nuTechOrderWorkflows.id, nuTechOrderItems.workflowId)
      )
      .where(
        and(
          eq(nuTechOrderItems.id, itemId),
          eq(nuTechOrderWorkflows.projectId, projectId)
        )
      )
      .limit(1)
      .get()
    if (!item) throw new Error("Nu-Tech order item not found.")
    if (item.purchaseOrderReleasedAt !== null) {
      throw new Error("Released Airlite PO quantities are locked.")
    }
    const now = new Date().toISOString()
    await deleteNuTechOrderItemRow(access.db, {
      itemId: item.id,
      orderId: item.workflowId,
      workbookStatus: nuTechWorkbookStatusAfterChange(item.airliteWorkbookStatus),
      userId: access.user.id,
      now,
    })
    revalidateNuTechOrder(projectId)
    return { success: true, id: item.id }
  } catch (error) {
    return actionError(error, "Failed to delete the Nu-Tech order item.")
  }
}

/** "11730 Red Lodge Rd., Peyton, CO 80831" → street, then city/state/ZIP. */
function splitShipTo(address: string | null): readonly string[] {
  const value = address?.trim() ?? ""
  if (!value) return []
  const comma = value.indexOf(",")
  return comma < 0 ? [value] : [value.slice(0, comma).trim(), value.slice(comma + 1).trim()]
}

/** A Drive file ID from a pasted link or a bare ID. */
function driveFileId(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  const fromLink = /\/d\/([\w-]{20,})/.exec(trimmed)?.[1] ?? /[?&]id=([\w-]{20,})/.exec(trimmed)?.[1]
  if (fromLink) return fromLink
  return /^[\w-]{20,}$/.test(trimmed) ? trimmed : null
}

export async function generateNuTechAirliteWorkbook(
  projectId: string,
  orderId?: string | null
): Promise<NuTechOrderItemActionResult> {
  try {
    const access = await nuTechItemAccess(projectId)
    if (!access.project.googleDriveFolderId) {
      throw new Error("This job has no Google Drive folder yet, so the order form has nowhere to go. Use “Create Drive folder” on the project or purchase order page.")
    }
    const workflow = await findNuTechOrder(access.db, projectId, orderId)
    if (!workflow?.catalogVersionId) {
      throw new Error("Save the order with an active Nu-Tech catalog first.")
    }
    if (workflow.purchaseOrderReleasedAt !== null) {
      throw new Error("The released Airlite PO workbook is locked.")
    }
    if (!workflow.airlitePurchaseOrderOperationId) {
      throw new Error("Link the Compass Airlite purchase order before generating its workbook.")
    }
    const [catalogVersion, purchaseOrder, lineRows] = await Promise.all([
      access.db
        .select({ airliteTemplateId: nuTechCatalogVersions.airliteTemplateId })
        .from(nuTechCatalogVersions)
        .where(
          and(
            eq(nuTechCatalogVersions.id, workflow.catalogVersionId),
            eq(nuTechCatalogVersions.organizationId, access.organizationId)
          )
        )
        .limit(1)
        .get(),
      access.db
        .select({
          number: projectOperations.sourceRecordNumber,
          siteContactName: projectOperations.assigneeName,
          siteContactPhone: projectOperations.siteContactPhone,
        })
        .from(projectOperations)
        .where(
          and(
            eq(projectOperations.id, workflow.airlitePurchaseOrderOperationId),
            eq(projectOperations.projectId, projectId),
            eq(projectOperations.sourceRecordType, "purchase_order")
          )
        )
        .limit(1)
        .get(),
      access.db
        .select({
          manufacturerSku: nuTechOrderItems.manufacturerSkuSnapshot,
          name: nuTechOrderItems.productNameSnapshot,
          origin: nuTechProducts.origin,
          quantity: nuTechOrderItems.quantity,
          minimumOrderIncrement: nuTechProducts.minimumOrderIncrement,
          packageLabel: nuTechProducts.packageLabel,
          priceUnit: nuTechOrderItems.priceUnitSnapshot,
          unitCostCents: nuTechOrderItems.unitCostCents,
        })
        .from(nuTechOrderItems)
        .innerJoin(nuTechProducts, eq(nuTechProducts.id, nuTechOrderItems.productId))
        .where(eq(nuTechOrderItems.workflowId, workflow.id))
        .orderBy(asc(nuTechOrderItems.sortOrder)),
    ])
    if (!catalogVersion) throw new Error("The linked Nu-Tech catalog was not found.")
    if (!purchaseOrder?.number) {
      throw new Error("The linked Compass purchase order needs a PO number.")
    }
    const settings = await readFeatureSettings(access.db, access.organizationId, "nutech-emails")
    const poSequence = await assignNuTechAirlitePoNumber(access.db, {
      organizationId: access.organizationId,
      workflowId: workflow.id,
      projectId,
      projectNumber: access.project.projectNumber,
      assigned: workflow.airlitePoSequence,
      purchaseOrderId: workflow.airlitePurchaseOrderOperationId,
      purchaseOrderReleased: false,
    })
    const now = new Date().toISOString()
    const delivery = workflow.deliveryMethod === "delivery"
    const clientLastName = (access.project.clientName ?? "").replace(/[,&].*$/, "").trim().split(/\s+/).pop() ?? ""
    const shippingCents = nuTechShippingCents(workflow.deliveryMethod, workflow.shippingCents)
    const header: NuTechAirliteOrderHeader = {
      purchaseOrderLabel: airlitePurchaseOrderLabel({
        projectNumber: access.project.projectNumber,
        sequence: poSequence,
        fallbackNumber: purchaseOrder.number,
        clientLastName,
      }),
      purchaseOrderDate: formatAirliteDate(now),
      fulfillment: delivery ? "delivery" : "pickup",
      requestedDate: workflow.requestedDeliveryDate ? formatAirliteDate(workflow.requestedDeliveryDate) : null,
      freight:
        shippingCents > 0
          ? `${shippingCents % 100 === 0 ? shippingCents / 100 : (shippingCents / 100).toFixed(2)}${workflow.shippingNote ? ` (${workflow.shippingNote})` : ""}`
          : null,
      fob: (delivery ? settings.fobDelivery : settings.fobPickup).trim() || null,
      shippingWarehouse: settings.warehouseName.trim() || null,
      shipToLines: splitShipTo(access.project.address),
      // "Jody Reeves 304-293-4503": the PO's site contact, else the client.
      deliveryContact:
        [purchaseOrder.siteContactName?.trim() || access.project.clientName, purchaseOrder.siteContactPhone?.trim()]
          .filter(Boolean)
          .join(" ") || null,
      miscNote: !delivery && workflow.trailerDimensions ? `Trailer: ${workflow.trailerDimensions}.` : null,
    }
    const { client, sheetsClient, userEmail } = await getOrganizationDriveContext({
      db: access.db,
      environment: access.env,
      organizationId: access.organizationId,
      user: access.user,
    })
    const formFileId = driveFileId(settings.orderFormFile) ?? NUTECH_2026_CATALOG_SOURCES.airliteTemplateId
    // Copies convert to a Google Sheet, so the form can be a Sheet or an .xlsx.
    const workbook = await client.copyFile(userEmail, formFileId, {
      name: `PO ${header.purchaseOrderLabel}`,
      parentId: access.project.googleDriveFolderId,
      mimeType: "application/vnd.google-apps.spreadsheet",
    })
    const layout = readNuTechAirliteFormLayout(
      await sheetsClient.getValues(userEmail, { spreadsheetId: workbook.id, range: "USLvl3!A1:J200" })
    )
    const plan = buildNuTechAirliteWorkbookPlan({ layout, header, lines: lineRows })
    await sheetsClient.batchUpdateValues(userEmail, {
      spreadsheetId: workbook.id,
      updates: plan.updates,
    })
    if (plan.addendumValues.length > 0) {
      await sheetsClient.addSheet(userEmail, {
        spreadsheetId: workbook.id,
        title: "Compass Addendum",
        rowCount: Math.max(100, plan.addendumValues.length + 10),
        columnCount: 8,
      })
      await sheetsClient.batchUpdateValues(userEmail, {
        spreadsheetId: workbook.id,
        updates: [
          {
            range: `'Compass Addendum'!A1:H${plan.addendumValues.length}`,
            values: plan.addendumValues,
          },
        ],
      })
    }
    const workbookUrl =
      workbook.webViewLink ??
      `https://docs.google.com/spreadsheets/d/${workbook.id}/edit`
    await recordNuTechOrderWorkbook(access.db, {
      orderId: workflow.id,
      workbookId: workbook.id,
      workbookUrl,
      workbookStatus: plan.addendumItemCount > 0 ? "generated_with_addendum" : "generated",
      orderStatus: ["intake", "quantities_ready", "estimate_ready", "customer_approved"].includes(workflow.orderStatus)
        ? "po_ready"
        : workflow.orderStatus,
      userId: access.user.id,
      now,
    })
    revalidateNuTechOrder(projectId)
    return { success: true, id: workflow.id, workbookUrl }
  } catch (error) {
    return actionError(error, "Failed to generate the Airlite workbook.")
  }
}
