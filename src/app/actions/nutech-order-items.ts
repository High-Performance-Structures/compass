"use server"

import { and, asc, eq, ne } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import { getDb } from "@/db"
import { projectOperations, projects } from "@/db/schema"
import {
  nuTechCatalogPrices,
  nuTechCatalogVersions,
  nuTechOrderItems,
  nuTechOrderWorkflows,
  nuTechProducts,
} from "@/db/schema-nutech"
import { requireAuth, type AuthUser } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import { isDemoUser } from "@/lib/demo"
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
import { requireOrg } from "@/lib/org-scope"
import { requireFeaturePermission } from "@/lib/permission-enforcement"
import { NUTECH_FREIGHT_CATEGORY } from "@/lib/nutech/freight"
import { projectDepartment } from "@/lib/project-branding"

type CompassDb = ReturnType<typeof getDb>

type NuTechItemAccess = {
  readonly db: CompassDb
  readonly user: AuthUser
  readonly organizationId: string
  readonly project: {
    readonly id: string
    readonly projectNumber: string | null
    readonly name: string
    readonly clientName: string | null
    readonly address: string | null
    readonly googleDriveFolderId: string | null
  }
}

export type NuTechOrderItemActionResult =
  | { readonly success: true; readonly id: string; readonly workbookUrl?: string }
  | { readonly success: false; readonly error: string }

async function nuTechItemAccess(projectId: string): Promise<NuTechItemAccess> {
  const user = await requireAuth()
  if (isDemoUser(user.id)) throw new Error("DEMO_READ_ONLY")
  await requireFeaturePermission(user, "nutech-orders", "update")
  const organizationId = requireOrg(user)
  const { env } = await getCloudflareContext()
  const db = getDb(env.DB)
  const project = await db
    .select({
      id: projects.id,
      projectNumber: projects.projectNumber,
      name: projects.name,
      clientName: projects.clientName,
      address: projects.address,
      googleDriveFolderId: projects.googleDriveFolderId,
    })
    .from(projects)
    .where(
      and(eq(projects.id, projectId), eq(projects.organizationId, organizationId))
    )
    .limit(1)
    .get()
  if (!project) throw new Error("Project not found.")
  if (
    projectDepartment({
      projectId: project.id,
      projectNumber: project.projectNumber,
    }) !== "N"
  ) {
    throw new Error("The Nu-Tech order workflow is available only for N projects.")
  }
  return { db, user, organizationId, project }
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

function storedCustomerType(value: string): "new" | "returning" {
  return value === "returning" ? "returning" : "new"
}

function storedPricingMode(value: string): "standard" | "cash_discount" {
  return value === "cash_discount" ? "cash_discount" : "standard"
}

export async function saveNuTechOrderItem(
  projectId: string,
  input: { readonly productId: string; readonly quantity: number }
): Promise<NuTechOrderItemActionResult> {
  try {
    const access = await nuTechItemAccess(projectId)
    const workflow = await access.db
      .select()
      .from(nuTechOrderWorkflows)
      .where(eq(nuTechOrderWorkflows.projectId, projectId))
      .limit(1)
      .get()
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
      storedCustomerType(workflow.customerType),
      storedPricingMode(workflow.pricingMode)
    )
    await access.db.batch([
      access.db
        .insert(nuTechOrderItems)
        .values({
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
        })
        .onConflictDoUpdate({
          target: [nuTechOrderItems.workflowId, nuTechOrderItems.productId],
          set: {
            quantity: input.quantity,
            unitCostCents: product.airliteCostCents,
            unitPriceCents,
            updatedAt: now,
          },
        }),
      access.db
        .update(nuTechOrderWorkflows)
        .set({
          orderStatus:
            workflow.orderStatus === "intake"
              ? "quantities_ready"
              : workflow.orderStatus,
          airliteWorkbookStatus:
            workflow.airliteWorkbookStatus.startsWith("generated")
              ? "stale"
              : workflow.airliteWorkbookStatus,
          updatedBy: access.user.id,
          updatedAt: now,
        })
        .where(eq(nuTechOrderWorkflows.id, workflow.id)),
    ])
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
    await access.db.batch([
      access.db.delete(nuTechOrderItems).where(eq(nuTechOrderItems.id, item.id)),
      access.db
        .update(nuTechOrderWorkflows)
        .set({
          airliteWorkbookStatus: item.airliteWorkbookStatus.startsWith("generated")
            ? "stale"
            : item.airliteWorkbookStatus,
          updatedBy: access.user.id,
          updatedAt: now,
        })
        .where(eq(nuTechOrderWorkflows.id, item.workflowId)),
    ])
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
  projectId: string
): Promise<NuTechOrderItemActionResult> {
  try {
    const access = await nuTechItemAccess(projectId)
    if (!access.project.googleDriveFolderId) {
      throw new Error("This job has no Google Drive folder yet, so the order form has nowhere to go. Use “Create Drive folder” on the project or purchase order page.")
    }
    const workflow = await access.db
      .select()
      .from(nuTechOrderWorkflows)
      .where(eq(nuTechOrderWorkflows.projectId, projectId))
      .limit(1)
      .get()
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
    const shippingCents = delivery ? (workflow.shippingCents ?? 0) : 0
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
    const { env } = await getCloudflareContext()
    const { client, sheetsClient, userEmail } = await getOrganizationDriveContext({
      db: access.db,
      environment: env,
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
    await access.db
      .update(nuTechOrderWorkflows)
      .set({
        airliteWorkbookId: workbook.id,
        airliteWorkbookUrl: workbookUrl,
        airliteWorkbookStatus:
          plan.addendumItemCount > 0 ? "generated_with_addendum" : "generated",
        airliteWorkbookGeneratedAt: now,
        airliteWorkbookGeneratedBy: access.user.id,
        orderStatus: [
          "intake",
          "quantities_ready",
          "estimate_ready",
          "customer_approved",
        ].includes(workflow.orderStatus)
          ? "po_ready"
          : workflow.orderStatus,
        updatedBy: access.user.id,
        updatedAt: now,
      })
      .where(eq(nuTechOrderWorkflows.id, workflow.id))
    revalidateNuTechOrder(projectId)
    return { success: true, id: workflow.id, workbookUrl }
  } catch (error) {
    return actionError(error, "Failed to generate the Airlite workbook.")
  }
}
