"use server"

import { and, asc, desc, eq, inArray, like, sql } from "drizzle-orm"
import { findNuTechOrder, nextNuTechOrderNumber } from "@/lib/nutech/order-select"
import { revalidatePath } from "next/cache"

import { projectOperations, projects } from "@/db/schema"
import { projectEstimates, sageTaxEntities } from "@/db/schema-estimates"
import { readFeatureSettings } from "@/lib/feature-settings/server"
import { operationUpdateQuery } from "@/lib/domain/operations/store"
import { isNuTechFreight } from "@/lib/nutech/freight"
import {
  nuTechCatalogPrices,
  nuTechCatalogVersions,
  nuTechOrderItems,
  nuTechOrderWorkflows,
  nuTechProducts,
  type NewNuTechOrderWorkflow,
} from "@/db/schema-nutech"
import type { AuthUser } from "@/lib/auth"
import { chunkD1Values } from "@/lib/d1-query"
import { isDemoUser } from "@/lib/demo"
import { updateProjects, updateProjectsStatement } from "@/lib/domain/project/store"
import { recordProjectAudit } from "@/lib/domain/project-audit/store"
import { isNuTechJob, nuTechOrgContext, readNuTechProject, type NuTechProject } from "@/lib/domain/nutech/access"
import {
  nuTechEffectiveTaxEntityId,
  nuTechItemTaxable,
  parseNuTechCustomerType,
  parseNuTechDate,
  parseNuTechDeliveryMethod,
  parseNuTechPricingMode,
  parseNuTechQuantitySource,
  parseNuTechScopeType,
  storedNuTechCustomerType,
  storedNuTechDeliveryMethod,
  storedNuTechOrderStatus,
  storedNuTechPricingMode,
  storedNuTechQuantitySource,
  storedNuTechTakeoffStatus,
  storedNuTechVendorInvoiceStatus,
  toNuTechOrderRecord,
  type NuTechOrderRecord,
} from "@/lib/domain/nutech/rules"
import {
  deleteNuTechOrder,
  insertNuTechOrder,
  releaseNuTechOrderPurchaseOrderStatement,
  releaseNuTechOrderVendorInvoice,
  saveNuTechOrder,
} from "@/lib/domain/nutech/store"
import type { Db } from "@/lib/server/action-context"
import { cleanText } from "@/lib/shared/guards"
import {
  isNuTechPaymentMethod,
  jobStatusForNuTechOrderStatus,
  normalizedNuTechTakeoffStatus,
  nuTechCustomerReadinessIssues,
  nuTechPurchaseOrderReleaseReadiness,
  projectDeliveryMethodForNuTech,
  nuTechReleaseAuditIssues,
  type NuTechQuantitySource,
} from "@/lib/nutech/workflow"
import {
  canFeature,
  requireFeaturePermission,
} from "@/lib/permission-enforcement"
import { contractEstimateConditions } from "@/lib/estimates/estimate-family"

type NuTechPurchaseOrderOption = {
  readonly id: string
  readonly number: string | null
  readonly title: string
  readonly companyName: string | null
  readonly status: string
  readonly amount: number | null
}

type NuTechEstimateSummary = {
  readonly id: string
  readonly number: string
  readonly status: string
  readonly totalCents: number
  readonly updatedAt: string
}

export type NuTechTaxDistrict = {
  readonly id: string
  readonly code: string
  readonly name: string
  readonly rateBasisPoints: number
}

type NuTechCatalogProductOption = {
  readonly id: string
  readonly manufacturerSku: string
  readonly name: string
  readonly category: string
  readonly origin: string
  readonly priceUnit: string
  readonly packageLabel: string
  readonly minimumOrderIncrement: number
  readonly airliteMappingStatus: string
  readonly newStandardPriceCents: number
  readonly newCashPriceCents: number
  readonly returningStandardPriceCents: number
  readonly returningCashPriceCents: number
  readonly taxable: boolean
}

type NuTechOrderItemRecord = {
  readonly id: string
  readonly productId: string
  readonly manufacturerSku: string
  readonly name: string
  readonly quantity: number
  readonly priceUnit: string
  readonly unitCostCents: number
  readonly unitPriceCents: number
  readonly sortOrder: number
  /** Whether the line is sales-taxed (its price-list setting; see `nuTechItemTaxable`). */
  readonly taxable: boolean
}

/** One of a job's orders, for the order switcher. */
export type NuTechOrderSummary = {
  readonly id: string
  readonly orderNumber: number
  readonly title: string | null
  readonly orderStatus: string
  readonly estimateId: string | null
}

export type ProjectNuTechOrderWorkspace = {
  /** Every order on the job, oldest first; `order` is the one open. */
  readonly orders: readonly NuTechOrderSummary[]
  readonly canEdit: boolean
  readonly canDelete: boolean
  readonly projectId: string
  readonly projectNumber: string | null
  readonly projectName: string
  readonly clientName: string | null
  readonly address: string | null
  readonly order: NuTechOrderRecord | null
  readonly catalogVersionName: string | null
  readonly catalogProducts: readonly NuTechCatalogProductOption[]
  readonly orderItems: readonly NuTechOrderItemRecord[]
  readonly estimate: NuTechEstimateSummary | null
  readonly purchaseOrders: readonly NuTechPurchaseOrderOption[]
  /** Active sales tax districts (synced from the accounting system). */
  readonly taxDistricts: readonly NuTechTaxDistrict[]
  /** District for customer pickups at the warehouse (Settings → Nu-Tech emails). */
  readonly warehouseTaxEntityId: string | null
  /** Whether the shipping charge is taxed (the price list's Freight item; non-taxable unless changed). */
  readonly shippingTaxable: boolean
}

export type NuTechOrderDashboardItem = {
  readonly projectId: string
  readonly projectNumber: string | null
  readonly projectName: string
  readonly clientName: string | null
  readonly orderStatus: string
  readonly quantitySource: NuTechQuantitySource | null
  readonly requestedDeliveryDate: string | null
  readonly estimateStatus: string | null
  readonly openPurchaseOrderCount: number
}

export type SaveNuTechOrderInput = {
  /** The order being saved; left out, the job's newest order (or its first). */
  readonly orderId?: string | null
  readonly title?: string | null
  readonly customerType: string
  readonly pricingMode: string
  readonly quantitySource: string
  readonly takeoffAcknowledgementStatus: string
  readonly scopeType: string
  readonly blockQuantityNotes: string | null
  readonly bracingIncluded: boolean
  readonly bracingRentalStartDate: string | null
  readonly bracingRentalEndDate: string | null
  readonly bracingNotes: string | null
  readonly deliveryMethod: string
  readonly requestedDeliveryDate: string | null
  readonly customerPaidAt: string | null
  readonly customerPaymentMethod: string | null
  readonly trailerDimensions: string | null
  readonly trailerPhotoReceivedAt: string | null
  readonly airlitePurchaseOrderOperationId: string | null
  readonly orderStatus: string
  readonly vendorConfirmationNumber: string | null
  readonly vendorInvoiceNumber: string | null
  readonly vendorInvoiceStatus: string
  readonly vendorInvoiceReceivedAt: string | null
  readonly shippingCents: number | null
  readonly shippingNote: string | null
  readonly taxEntityId: string | null
  readonly notes: string | null
}

export type NuTechOrderActionResult =
  | { readonly success: true; readonly id: string }
  | { readonly success: false; readonly error: string }

type NuTechAccess = {
  readonly db: Db
  readonly user: AuthUser
  readonly organizationId: string
  readonly project: NuTechProject
}

async function nuTechProjectAccess(
  projectId: string,
  action: "read" | "update" | "delete"
): Promise<NuTechAccess> {
  const { db, user, organizationId } = await nuTechOrgContext()
  if (action !== "read" && isDemoUser(user.id)) {
    throw new Error("DEMO_READ_ONLY")
  }
  await requireFeaturePermission(user, "nutech-orders", action)
  const project = await readNuTechProject(db, organizationId, projectId)
  if (!project) throw new Error("Project not found.")
  if (!isNuTechJob(project)) {
    throw new Error("The Nu-Tech order workflow is available only for N projects.")
  }
  return { db, user, organizationId, project }
}

/**
 * Keep the job in step with its order: the job status (and so the Nu-Tech
 * Sales pipeline stage) and delivery or pickup. Status changes are audited
 * like any other job status change.
 */
async function syncProjectWithOrder(
  access: NuTechAccess,
  next: {
    readonly jobStatusId: string | null
    readonly deliveryMethod: "delivery" | "pickup" | null
    readonly now: string
  },
): Promise<void> {
  const current = await access.db
    .select({ jobStatusId: projects.jobStatusId, deliveryMethod: projects.deliveryMethod })
    .from(projects)
    .where(eq(projects.id, access.project.id))
    .limit(1)
    .get()
  if (!current) return
  const statusChanged = next.jobStatusId !== null && next.jobStatusId !== current.jobStatusId
  const deliveryChanged = next.deliveryMethod !== null && next.deliveryMethod !== current.deliveryMethod
  if (!statusChanged && !deliveryChanged) return
  const patch = {
    ...(statusChanged && next.jobStatusId !== null ? { jobStatusId: next.jobStatusId } : {}),
    ...(deliveryChanged && next.deliveryMethod !== null ? { deliveryMethod: next.deliveryMethod } : {}),
    updatedAt: next.now,
  }
  const where = eq(projects.id, access.project.id)
  if (!statusChanged) {
    await updateProjects(access.db, where, patch)
    return
  }
  await access.db.batch([
    updateProjectsStatement(access.db, where, patch),
    recordProjectAudit(access.db, {
      organizationId: access.organizationId,
      projectId: access.project.id,
      actorUserId: access.user.id,
      eventType: "project_job_status_updated",
      entityType: "project",
      entityId: access.project.id,
      beforeJson: JSON.stringify({ jobStatusId: current.jobStatusId }),
      afterJson: JSON.stringify({ jobStatusId: next.jobStatusId, source: "nutech_order" }),
      createdAt: next.now,
    }),
  ])
}

function revalidateNuTechPaths(projectId: string): void {
  revalidatePath("/dashboard/nutech")
  revalidatePath(`/dashboard/projects/${projectId}`)
  revalidatePath(`/dashboard/projects/${projectId}/nutech`)
  revalidatePath(`/dashboard/projects/${projectId}/purchase-orders`)
}

export async function getProjectNuTechOrderWorkspace(
  projectId: string,
  orderId?: string | null
): Promise<ProjectNuTechOrderWorkspace> {
  const access = await nuTechProjectAccess(projectId, "read")
  const [orderRow, orderRows, purchaseOrderRows, canEdit, canDelete] =
    await Promise.all([
      findNuTechOrder(access.db, projectId, orderId),
      access.db
        .select({
          id: nuTechOrderWorkflows.id,
          orderNumber: nuTechOrderWorkflows.orderNumber,
          title: nuTechOrderWorkflows.title,
          orderStatus: nuTechOrderWorkflows.orderStatus,
          estimateId: nuTechOrderWorkflows.estimateId,
        })
        .from(nuTechOrderWorkflows)
        .where(eq(nuTechOrderWorkflows.projectId, projectId))
        .orderBy(asc(nuTechOrderWorkflows.orderNumber)),
      access.db
        .select({
          id: projectOperations.id,
          number: projectOperations.sourceRecordNumber,
          title: projectOperations.title,
          companyName: projectOperations.companyName,
          status: projectOperations.status,
          amount: projectOperations.amount,
        })
        .from(projectOperations)
        .where(
          and(
            eq(projectOperations.projectId, projectId),
            eq(projectOperations.sourceRecordType, "purchase_order")
          )
        )
        .orderBy(desc(projectOperations.updatedAt)),
      canFeature(access.user, "nutech-orders", "update"),
      canFeature(access.user, "nutech-orders", "delete"),
    ])
  // The order's own estimate; a job with no orders yet shows its newest estimate.
  const estimateRow = await access.db
    .select({
      id: projectEstimates.id,
      number: projectEstimates.estimateNumber,
      status: projectEstimates.status,
      totalCents: projectEstimates.estimateTotalCents,
      updatedAt: projectEstimates.updatedAt,
    })
    .from(projectEstimates)
    .where(
      orderRow
        ? orderRow.estimateId
          ? eq(projectEstimates.id, orderRow.estimateId)
          : sql`0`
        : and(eq(projectEstimates.projectId, projectId), ...contractEstimateConditions()),
    )
    .orderBy(desc(projectEstimates.updatedAt))
    .limit(1)
    .get()
  const catalogVersion = orderRow?.catalogVersionId
    ? await access.db
        .select({ id: nuTechCatalogVersions.id, name: nuTechCatalogVersions.name })
        .from(nuTechCatalogVersions)
        .where(
          and(
            eq(nuTechCatalogVersions.id, orderRow.catalogVersionId),
            eq(nuTechCatalogVersions.organizationId, access.organizationId)
          )
        )
        .limit(1)
        .get()
    : await access.db
        .select({ id: nuTechCatalogVersions.id, name: nuTechCatalogVersions.name })
        .from(nuTechCatalogVersions)
        .where(
          and(
            eq(nuTechCatalogVersions.organizationId, access.organizationId),
            eq(nuTechCatalogVersions.status, "active")
          )
        )
        .orderBy(desc(nuTechCatalogVersions.effectiveDate))
        .limit(1)
        .get()
  const [taxDistricts, nuTechSettings] = await Promise.all([
    access.db
      .select({ id: sageTaxEntities.id, code: sageTaxEntities.code, name: sageTaxEntities.name, rateBasisPoints: sageTaxEntities.rateBasisPoints })
      .from(sageTaxEntities)
      .where(eq(sageTaxEntities.active, true))
      .orderBy(asc(sageTaxEntities.name)),
    readFeatureSettings(access.db, access.organizationId, "nutech-emails"),
  ])
  const [catalogProducts, orderItems] = await Promise.all([
    catalogVersion
      ? access.db
          .select({
            id: nuTechProducts.id,
            manufacturerSku: nuTechProducts.manufacturerSku,
            name: nuTechProducts.name,
            category: nuTechProducts.category,
            origin: nuTechProducts.origin,
            priceUnit: nuTechProducts.priceUnit,
            packageLabel: nuTechProducts.packageLabel,
            minimumOrderIncrement: nuTechProducts.minimumOrderIncrement,
            airliteMappingStatus: nuTechProducts.airliteMappingStatus,
            newStandardPriceCents: nuTechCatalogPrices.newStandardPriceCents,
            newCashPriceCents: nuTechCatalogPrices.newCashPriceCents,
            returningStandardPriceCents:
              nuTechCatalogPrices.returningStandardPriceCents,
            returningCashPriceCents: nuTechCatalogPrices.returningCashPriceCents,
            taxable: nuTechProducts.taxable,
          })
          .from(nuTechCatalogPrices)
          .innerJoin(
            nuTechProducts,
            eq(nuTechProducts.id, nuTechCatalogPrices.productId)
          )
          .where(
            and(
              eq(nuTechCatalogPrices.catalogVersionId, catalogVersion.id),
              eq(nuTechProducts.organizationId, access.organizationId),
              eq(nuTechProducts.active, true)
            )
          )
          .orderBy(asc(nuTechProducts.category), asc(nuTechProducts.manufacturerSku))
      : Promise.resolve([]),
    orderRow
      ? access.db
          .select({
            id: nuTechOrderItems.id,
            productId: nuTechOrderItems.productId,
            manufacturerSku: nuTechOrderItems.manufacturerSkuSnapshot,
            name: nuTechOrderItems.productNameSnapshot,
            quantity: nuTechOrderItems.quantity,
            priceUnit: nuTechOrderItems.priceUnitSnapshot,
            unitCostCents: nuTechOrderItems.unitCostCents,
            unitPriceCents: nuTechOrderItems.unitPriceCents,
            sortOrder: nuTechOrderItems.sortOrder,
          })
          .from(nuTechOrderItems)
          .where(eq(nuTechOrderItems.workflowId, orderRow.id))
          .orderBy(asc(nuTechOrderItems.sortOrder))
      : Promise.resolve([]),
  ])
  const productOptions = catalogProducts.filter((product) => !isNuTechFreight(product))
  return {
    orders: orderRows,
    canEdit: canEdit && !isDemoUser(access.user.id),
    canDelete: canDelete && !isDemoUser(access.user.id),
    projectId,
    projectNumber: access.project.projectNumber,
    projectName: access.project.name,
    clientName: access.project.clientName,
    address: access.project.address,
    order: orderRow ? toNuTechOrderRecord(orderRow) : null,
    catalogVersionName: catalogVersion?.name ?? null,
    catalogProducts: productOptions,
    orderItems: orderItems.map((item) => ({
      ...item,
      taxable: nuTechItemTaxable(productOptions.find((product) => product.id === item.productId)?.taxable),
    })),
    estimate: estimateRow ?? null,
    purchaseOrders: purchaseOrderRows,
    taxDistricts,
    warehouseTaxEntityId: nuTechSettings.warehouseTaxEntityId || null,
    shippingTaxable: catalogProducts.find(isNuTechFreight)?.taxable ?? false,
  }
}

export async function getNuTechOrderDashboard(): Promise<
  readonly NuTechOrderDashboardItem[]
> {
  const { db, user, organizationId } = await nuTechOrgContext()
  await requireFeaturePermission(user, "nutech-orders", "read")
  const projectRows = await db
    .select({
      id: projects.id,
      projectNumber: projects.projectNumber,
      name: projects.name,
      clientName: projects.clientName,
    })
    .from(projects)
    .where(
      and(
        eq(projects.organizationId, organizationId),
        like(projects.projectNumber, "N-%")
      )
    )
    .orderBy(desc(projects.updatedAt), desc(projects.createdAt))
  const projectIds = projectRows.map((project) => project.id)
  if (projectIds.length === 0) return []
  // Chunked by job so each IN list stays under D1's parameter limit; a job's
  // rows all land in one chunk, so their order is kept.
  const chunks = await Promise.all(
    chunkD1Values(projectIds).map((ids) =>
      Promise.all([
        db.select().from(nuTechOrderWorkflows).where(inArray(nuTechOrderWorkflows.projectId, ids)),
        db
          .select({ projectId: projectEstimates.projectId, status: projectEstimates.status, updatedAt: projectEstimates.updatedAt })
          .from(projectEstimates)
          .where(inArray(projectEstimates.projectId, ids))
          .orderBy(desc(projectEstimates.updatedAt)),
        db
          .select({ projectId: projectOperations.projectId, status: projectOperations.status })
          .from(projectOperations)
          .where(and(inArray(projectOperations.projectId, ids), eq(projectOperations.sourceRecordType, "purchase_order"))),
      ]),
    ),
  )
  const workflowRows = chunks.flatMap((chunk) => chunk[0])
  const estimateRows = chunks.flatMap((chunk) => chunk[1])
  const purchaseOrderRows = chunks.flatMap((chunk) => chunk[2])
  return projectRows.map((project) => {
    // A job can have several orders; the dashboard follows the newest.
    const workflow = workflowRows
      .filter((row) => row.projectId === project.id)
      .sort((a, b) => b.orderNumber - a.orderNumber)[0]
    const estimate = estimateRows.find((row) => row.projectId === project.id)
    const openPurchaseOrderCount = purchaseOrderRows.filter(
      (row) =>
        row.projectId === project.id &&
        !["complete", "closed", "void"].includes(row.status)
    ).length
    return {
      projectId: project.id,
      projectNumber: project.projectNumber,
      projectName: project.name,
      clientName: project.clientName,
      orderStatus: workflow?.orderStatus ?? "not_started",
      quantitySource: workflow
        ? storedNuTechQuantitySource(workflow.quantitySource)
        : null,
      requestedDeliveryDate: workflow?.requestedDeliveryDate ?? null,
      estimateStatus: estimate?.status ?? null,
      openPurchaseOrderCount,
    }
  })
}

export async function saveProjectNuTechOrder(
  projectId: string,
  input: SaveNuTechOrderInput
): Promise<NuTechOrderActionResult> {
  try {
    const access = await nuTechProjectAccess(projectId, "update")
    const parsedCustomerType = parseNuTechCustomerType(input.customerType)
    const parsedPricingMode = parseNuTechPricingMode(input.pricingMode)
    const parsedQuantitySource = parseNuTechQuantitySource(input.quantitySource)
    const parsedTakeoffStatus = normalizedNuTechTakeoffStatus({
      quantitySource: parsedQuantitySource,
      requestedStatus: storedNuTechTakeoffStatus(input.takeoffAcknowledgementStatus),
    })
    const parsedScopeType = parseNuTechScopeType(input.scopeType)
    const bracingIncluded =
      input.bracingIncluded ||
      parsedScopeType === "block_and_bracing" ||
      parsedScopeType === "bracing_only"
    const bracingRentalStartDate = bracingIncluded
      ? parseNuTechDate(input.bracingRentalStartDate, "Bracing rental start")
      : null
    const bracingRentalEndDate = bracingIncluded
      ? parseNuTechDate(input.bracingRentalEndDate, "Bracing rental end")
      : null
    if (
      bracingRentalStartDate !== null &&
      bracingRentalEndDate !== null &&
      bracingRentalEndDate < bracingRentalStartDate
    ) {
      throw new Error("Bracing rental end cannot be before its start date.")
    }
    const purchaseOrderId = cleanText(input.airlitePurchaseOrderOperationId)
    if (purchaseOrderId !== null) {
      const linkedPurchaseOrder = await access.db
        .select({ id: projectOperations.id })
        .from(projectOperations)
        .where(
          and(
            eq(projectOperations.id, purchaseOrderId),
            eq(projectOperations.projectId, projectId),
            eq(projectOperations.sourceRecordType, "purchase_order")
          )
        )
        .limit(1)
        .get()
      if (!linkedPurchaseOrder) {
        throw new Error("Choose a purchase order from this Nu-Tech project.")
      }
    }
    const vendorInvoiceReceivedAt = parseNuTechDate(
      input.vendorInvoiceReceivedAt,
      "Vendor invoice received date"
    )
    const requestedDeliveryDate = parseNuTechDate(
      input.requestedDeliveryDate,
      "Requested delivery date"
    )
    const customerPaidAt = parseNuTechDate(input.customerPaidAt, "Customer paid date")
    const paymentMethod = cleanText(input.customerPaymentMethod)
    if (paymentMethod !== null && !isNuTechPaymentMethod(paymentMethod)) {
      throw new Error("Choose check, cash, ACH, or card.")
    }
    const trailerPhotoReceivedAt = parseNuTechDate(input.trailerPhotoReceivedAt, "Trailer photo received date")
    const parsedDeliveryMethod = parseNuTechDeliveryMethod(input.deliveryMethod)
    if (input.shippingCents !== null && (!Number.isInteger(input.shippingCents) || input.shippingCents < 0 || input.shippingCents > 100_000_000)) {
      throw new Error("Enter the shipping charge in dollars and cents.")
    }
    // Shipping applies to deliveries only; pickups default to the warehouse's tax district.
    const shippingCents = parsedDeliveryMethod === "delivery" ? input.shippingCents : null
    const chosenTaxEntityId = cleanText(input.taxEntityId)
    const taxEntityId = nuTechEffectiveTaxEntityId({
      chosenTaxEntityId,
      deliveryMethod: parsedDeliveryMethod,
      warehouseTaxEntityId:
        chosenTaxEntityId === null && parsedDeliveryMethod !== "delivery"
          ? (await readFeatureSettings(access.db, access.organizationId, "nutech-emails")).warehouseTaxEntityId
          : null,
    })
    if (taxEntityId !== null) {
      const district = await access.db
        .select({ id: sageTaxEntities.id })
        .from(sageTaxEntities)
        .where(and(eq(sageTaxEntities.id, taxEntityId), eq(sageTaxEntities.active, true)))
        .get()
      if (!district) throw new Error("Choose an active sales tax district.")
    }
    const parsedOrderStatus = storedNuTechOrderStatus(input.orderStatus)
    const parsedVendorInvoiceStatus = storedNuTechVendorInvoiceStatus(input.vendorInvoiceStatus
    )
    const existing = await findNuTechOrder(access.db, projectId, input.orderId)
    if (input.orderId && !existing) throw new Error("That order is no longer on this job.")
    const releaseAuditIssues = nuTechReleaseAuditIssues({
      orderStatus: parsedOrderStatus,
      vendorInvoiceStatus: parsedVendorInvoiceStatus,
      purchaseOrderReleasedAt: existing?.purchaseOrderReleasedAt ?? null,
      vendorInvoiceReleasedAt: existing?.vendorInvoiceReleasedAt ?? null,
    })
    if (releaseAuditIssues.length > 0) {
      throw new Error(releaseAuditIssues.join(" "))
    }
    if (
      existing?.purchaseOrderReleasedAt !== null &&
      existing?.purchaseOrderReleasedAt !== undefined &&
      (parsedCustomerType !== storedNuTechCustomerType(existing.customerType) ||
        parsedPricingMode !== storedNuTechPricingMode(existing.pricingMode) ||
        purchaseOrderId !== existing.airlitePurchaseOrderOperationId ||
        requestedDeliveryDate !== existing.requestedDeliveryDate)
    ) {
      throw new Error(
        "Released Airlite PO pricing, delivery date, and linked purchase order are locked."
      )
    }
    const activeCatalog = existing?.catalogVersionId
      ? null
      : await access.db
          .select({ id: nuTechCatalogVersions.id })
          .from(nuTechCatalogVersions)
          .where(
            and(
              eq(nuTechCatalogVersions.organizationId, access.organizationId),
              eq(nuTechCatalogVersions.status, "active")
            )
          )
          .orderBy(desc(nuTechCatalogVersions.effectiveDate))
          .limit(1)
          .get()
    const now = new Date().toISOString()
    const id = existing?.id ?? crypto.randomUUID()
    const values: NewNuTechOrderWorkflow = {
      id,
      projectId,
      orderNumber: existing?.orderNumber ?? 1,
      title: input.title === undefined ? (existing?.title ?? null) : cleanText(input.title),
      estimateId: existing?.estimateId ?? null,
      catalogVersionId: existing?.catalogVersionId ?? activeCatalog?.id ?? null,
      customerType: parsedCustomerType,
      pricingMode: parsedPricingMode,
      quantitySource: parsedQuantitySource,
      takeoffAcknowledgementStatus: parsedTakeoffStatus,
      scopeType: parsedScopeType,
      blockQuantityNotes: cleanText(input.blockQuantityNotes),
      bracingIncluded,
      bracingRentalStartDate,
      bracingRentalEndDate,
      bracingNotes: bracingIncluded ? cleanText(input.bracingNotes) : null,
      deliveryMethod: parsedDeliveryMethod,
      requestedDeliveryDate,
      customerPaidAt,
      customerPaymentMethod: paymentMethod,
      trailerDimensions: cleanText(input.trailerDimensions),
      trailerPhotoReceivedAt,
      airlitePurchaseOrderOperationId: purchaseOrderId,
      orderStatus: parsedOrderStatus,
      vendorConfirmationNumber: cleanText(input.vendorConfirmationNumber),
      purchaseOrderReleasedAt: existing?.purchaseOrderReleasedAt ?? null,
      purchaseOrderReleasedBy: existing?.purchaseOrderReleasedBy ?? null,
      vendorInvoiceNumber: cleanText(input.vendorInvoiceNumber),
      vendorInvoiceStatus: parsedVendorInvoiceStatus,
      vendorInvoiceReceivedAt,
      vendorInvoiceReleasedAt: existing?.vendorInvoiceReleasedAt ?? null,
      vendorInvoiceReleasedBy: existing?.vendorInvoiceReleasedBy ?? null,
      shippingCents,
      shippingNote: shippingCents === null ? null : cleanText(input.shippingNote),
      taxEntityId,
      notes: cleanText(input.notes),
      createdBy: existing?.createdBy ?? access.user.id,
      updatedBy: access.user.id,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    }
    const workbookInputsChanged =
      existing !== undefined &&
      (purchaseOrderId !== existing.airlitePurchaseOrderOperationId ||
        requestedDeliveryDate !== existing.requestedDeliveryDate)
    const nextWorkbookStatus =
      existing?.airliteWorkbookStatus.startsWith("generated") &&
      workbookInputsChanged
        ? "stale"
        : existing?.airliteWorkbookStatus ?? "not_generated"
    await saveNuTechOrder(access.db, {
      values,
      workbookStatus: nextWorkbookStatus,
      userId: access.user.id,
      now,
      reprice:
        typeof values.catalogVersionId !== "string"
          ? null
          : {
              catalogVersionId: values.catalogVersionId,
              priceColumn:
                parsedCustomerType === "new"
                  ? parsedPricingMode === "cash_discount" ? "newCash" : "newStandard"
                  : parsedPricingMode === "cash_discount" ? "returningCash" : "returningStandard",
            },
    })
    await syncProjectWithOrder(access, {
      jobStatusId: jobStatusForNuTechOrderStatus(parsedOrderStatus),
      deliveryMethod: projectDeliveryMethodForNuTech(parseNuTechDeliveryMethod(input.deliveryMethod)),
      now,
    })
    revalidateNuTechPaths(projectId)
    return { success: true, id }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to save Nu-Tech order.",
    }
  }
}

export async function releaseNuTechAirlitePurchaseOrder(
  projectId: string,
  orderId?: string | null
): Promise<NuTechOrderActionResult> {
  try {
    const access = await nuTechProjectAccess(projectId, "update")
    const order = await findNuTechOrder(access.db, projectId, orderId)
    if (!order) throw new Error("Start and save the Nu-Tech order first.")
    if (order.purchaseOrderReleasedAt !== null) {
      return { success: true, id: order.id }
    }
    const orderItemRows = await access.db
      .select({ id: nuTechOrderItems.id })
      .from(nuTechOrderItems)
      .where(eq(nuTechOrderItems.workflowId, order.id))
    const readiness = nuTechPurchaseOrderReleaseReadiness({
      customerType: storedNuTechCustomerType(order.customerType),
      pricingMode: storedNuTechPricingMode(order.pricingMode),
      quantitySource: storedNuTechQuantitySource(order.quantitySource),
      takeoffAcknowledgementStatus: storedNuTechTakeoffStatus(
        order.takeoffAcknowledgementStatus
      ),
      airlitePurchaseOrderOperationId: order.airlitePurchaseOrderOperationId,
      orderItemCount: orderItemRows.length,
      airliteWorkbookStatus: order.airliteWorkbookStatus,
      customerReadinessIssues: nuTechCustomerReadinessIssues({
        deliveryMethod: storedNuTechDeliveryMethod(order.deliveryMethod),
        customerPaidAt: order.customerPaidAt,
        requestedDeliveryDate: order.requestedDeliveryDate,
        trailerDimensions: order.trailerDimensions,
        trailerPhotoReceivedAt: order.trailerPhotoReceivedAt,
      }),
    })
    if (!readiness.ready) throw new Error(readiness.issues.join(" "))
    const purchaseOrderId = order.airlitePurchaseOrderOperationId
    if (purchaseOrderId === null) throw new Error("Link the Airlite purchase order.")
    const purchaseOrder = await access.db
      .select({ id: projectOperations.id, status: projectOperations.status })
      .from(projectOperations)
      .where(
        and(
          eq(projectOperations.id, purchaseOrderId),
          eq(projectOperations.projectId, projectId),
          eq(projectOperations.sourceRecordType, "purchase_order")
        )
      )
      .limit(1)
      .get()
    if (!purchaseOrder) throw new Error("The linked Airlite purchase order was not found.")
    const now = new Date().toISOString()
    const purchaseOrderStatus =
      purchaseOrder.status === "draft" || purchaseOrder.status === "approved"
        ? "sent"
        : purchaseOrder.status
    await access.db.batch([
      releaseNuTechOrderPurchaseOrderStatement(access.db, { orderId: order.id, userId: access.user.id, now }),
      operationUpdateQuery(access.db, eq(projectOperations.id, purchaseOrderId), { status: purchaseOrderStatus, updatedAt: now }),
    ])
    await syncProjectWithOrder(access, { jobStatusId: jobStatusForNuTechOrderStatus("po_released"), deliveryMethod: null, now })
    revalidateNuTechPaths(projectId)
    return { success: true, id: order.id }
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error ? error.message : "Failed to release the Airlite PO.",
    }
  }
}

export async function releaseNuTechVendorInvoice(
  projectId: string,
  orderId?: string | null
): Promise<NuTechOrderActionResult> {
  try {
    const access = await nuTechProjectAccess(projectId, "update")
    const order = await findNuTechOrder(access.db, projectId, orderId)
    if (!order) throw new Error("Start and save the Nu-Tech order first.")
    if (order.vendorInvoiceReleasedAt !== null) {
      return { success: true, id: order.id }
    }
    if (cleanText(order.vendorInvoiceNumber) === null) {
      throw new Error("Enter and save the Airlite vendor invoice number first.")
    }
    if (order.purchaseOrderReleasedAt === null) {
      throw new Error("Record the Airlite PO release before releasing its invoice.")
    }
    const now = new Date().toISOString()
    await releaseNuTechOrderVendorInvoice(access.db, {
      orderId: order.id,
      receivedAt: order.vendorInvoiceReceivedAt ?? now.slice(0, 10),
      userId: access.user.id,
      now,
    })
    revalidateNuTechPaths(projectId)
    revalidatePath("/dashboard/financials")
    return { success: true, id: order.id }
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to release the Airlite vendor invoice.",
    }
  }
}

export async function deleteProjectNuTechOrder(
  projectId: string,
  orderId?: string | null
): Promise<NuTechOrderActionResult> {
  try {
    const access = await nuTechProjectAccess(projectId, "delete")
    const existing = await findNuTechOrder(access.db, projectId, orderId)
    if (!existing) throw new Error("Nu-Tech order workflow not found.")
    if (
      existing.purchaseOrderReleasedAt !== null ||
      existing.vendorInvoiceReleasedAt !== null
    ) {
      throw new Error(
        "Released Nu-Tech workflows are retained for audit and cannot be deleted."
      )
    }
    await deleteNuTechOrder(access.db, existing.id)
    revalidateNuTechPaths(projectId)
    return { success: true, id: existing.id }
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error ? error.message : "Failed to delete Nu-Tech order.",
    }
  }
}

/**
 * Starts another order on a job (a second block order, a phase, …). It takes
 * the customer, pricing, delivery and tax district of the order it copies,
 * or the job's newest order, and starts with no products.
 */
export async function createNuTechOrder(
  projectId: string,
  input: { readonly title: string | null; readonly copyFromOrderId?: string | null; readonly estimateId?: string | null }
): Promise<NuTechOrderActionResult> {
  try {
    const access = await nuTechProjectAccess(projectId, "update")
    const source = await findNuTechOrder(access.db, projectId, input.copyFromOrderId)
    if (input.estimateId) {
      const estimate = await access.db
        .select({ id: projectEstimates.id })
        .from(projectEstimates)
        .where(and(eq(projectEstimates.id, input.estimateId), eq(projectEstimates.projectId, projectId)))
        .get()
      if (!estimate) throw new Error("That estimate is not on this job.")
    }
    const activeCatalog = await access.db
      .select({ id: nuTechCatalogVersions.id })
      .from(nuTechCatalogVersions)
      .where(and(eq(nuTechCatalogVersions.organizationId, access.organizationId), eq(nuTechCatalogVersions.status, "active")))
      .orderBy(desc(nuTechCatalogVersions.effectiveDate))
      .limit(1)
      .get()
    const now = new Date().toISOString()
    const id = crypto.randomUUID()
    // Two people adding an order at once can pick the same number; retry with the next.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await insertNuTechOrder(access.db, {
          id,
          projectId,
          orderNumber: await nextNuTechOrderNumber(access.db, projectId),
          title: cleanText(input.title),
          estimateId: input.estimateId ?? null,
          catalogVersionId: activeCatalog?.id ?? source?.catalogVersionId ?? null,
          customerType: source?.customerType ?? "new",
          pricingMode: source?.pricingMode ?? "standard",
          quantitySource: source?.quantitySource ?? "customer_provided",
          deliveryMethod: source?.deliveryMethod ?? "delivery",
          taxEntityId: source?.taxEntityId ?? null,
          trailerDimensions: source?.trailerDimensions ?? null,
          orderStatus: "intake",
          createdBy: access.user.id,
          updatedBy: access.user.id,
          createdAt: now,
          updatedAt: now,
        })
        revalidateNuTechPaths(projectId)
        return { success: true, id }
      } catch (error) {
        if (!(error instanceof Error) || !/UNIQUE/i.test(error.message) || attempt === 2) throw error
      }
    }
    throw new Error("Couldn't number the new order. Try again.")
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Failed to start the order." }
  }
}

export type NuTechOrderForEstimate = {
  readonly orderId: string
  readonly orderNumber: number
  readonly title: string | null
  readonly orderStatus: string
  /** The estimate number the order fills (it follows new versions). */
  readonly estimateNumber: string
}

/**
 * A job's orders by the estimate they fill, for the Estimate page's next
 * step. Empty for jobs outside Nu-Tech or people without order access.
 */
export async function getNuTechOrdersForEstimates(projectId: string): Promise<readonly NuTechOrderForEstimate[]> {
  try {
    const access = await nuTechProjectAccess(projectId, "read")
    return await access.db
      .select({
        orderId: nuTechOrderWorkflows.id,
        orderNumber: nuTechOrderWorkflows.orderNumber,
        title: nuTechOrderWorkflows.title,
        orderStatus: nuTechOrderWorkflows.orderStatus,
        estimateNumber: projectEstimates.estimateNumber,
      })
      .from(nuTechOrderWorkflows)
      .innerJoin(projectEstimates, eq(projectEstimates.id, nuTechOrderWorkflows.estimateId))
      .where(eq(nuTechOrderWorkflows.projectId, projectId))
      .orderBy(asc(nuTechOrderWorkflows.orderNumber))
  } catch {
    return []
  }
}

/** Active sales tax districts, for choosing the warehouse's district in Settings. */
export async function getNuTechTaxDistricts(): Promise<readonly NuTechTaxDistrict[]> {
  try {
    const { db, user } = await nuTechOrgContext()
    await requireFeaturePermission(user, "nutech-orders", "read")
    return await db
      .select({ id: sageTaxEntities.id, code: sageTaxEntities.code, name: sageTaxEntities.name, rateBasisPoints: sageTaxEntities.rateBasisPoints })
      .from(sageTaxEntities)
      .where(eq(sageTaxEntities.active, true))
      .orderBy(asc(sageTaxEntities.name))
  } catch {
    return []
  }
}
