"use server"

import { and, asc, desc, eq, inArray, like, sql } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import { getDb } from "@/db"
import { projectOperations, projects } from "@/db/schema"
import { projectEstimates } from "@/db/schema-estimates"
import {
  nuTechCatalogPrices,
  nuTechCatalogVersions,
  nuTechOrderItems,
  nuTechOrderWorkflows,
  nuTechProducts,
  type NewNuTechOrderWorkflow,
} from "@/db/schema-nutech"
import { requireAuth, type AuthUser } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import { isDemoUser } from "@/lib/demo"
import {
  NUTECH_CUSTOMER_TYPE_OPTIONS,
  NUTECH_DELIVERY_METHOD_OPTIONS,
  NUTECH_ORDER_STATUS_OPTIONS,
  NUTECH_PRICING_MODE_OPTIONS,
  NUTECH_QUANTITY_SOURCE_OPTIONS,
  NUTECH_SCOPE_TYPE_OPTIONS,
  NUTECH_TAKEOFF_STATUS_OPTIONS,
  NUTECH_VENDOR_INVOICE_STATUS_OPTIONS,
  normalizedNuTechTakeoffStatus,
  nuTechPurchaseOrderReleaseReadiness,
  nuTechReleaseAuditIssues,
  type NuTechCustomerType,
  type NuTechDeliveryMethod,
  type NuTechOrderStatus,
  type NuTechPricingMode,
  type NuTechQuantitySource,
  type NuTechScopeType,
  type NuTechTakeoffAcknowledgementStatus,
  type NuTechVendorInvoiceStatus,
} from "@/lib/nutech/workflow"
import { requireOrg } from "@/lib/org-scope"
import {
  canFeature,
  requireFeaturePermission,
} from "@/lib/permission-enforcement"
import { requireInternalNuTechStaff } from "@/lib/nutech/access"
import { projectDepartment } from "@/lib/project-branding"

type CompassDb = ReturnType<typeof getDb>

export type NuTechPurchaseOrderOption = {
  readonly id: string
  readonly number: string | null
  readonly title: string
  readonly companyName: string | null
  readonly status: string
  readonly amount: number | null
}

export type NuTechEstimateSummary = {
  readonly id: string
  readonly number: string
  readonly status: string
  readonly totalCents: number
  readonly updatedAt: string
}

export type NuTechOrderRecord = {
  readonly id: string
  readonly catalogVersionId: string | null
  readonly customerType: NuTechCustomerType
  readonly pricingMode: NuTechPricingMode
  readonly quantitySource: NuTechQuantitySource
  readonly takeoffAcknowledgementStatus: NuTechTakeoffAcknowledgementStatus
  readonly scopeType: NuTechScopeType
  readonly blockQuantityNotes: string | null
  readonly bracingIncluded: boolean
  readonly bracingRentalStartDate: string | null
  readonly bracingRentalEndDate: string | null
  readonly bracingNotes: string | null
  readonly deliveryMethod: NuTechDeliveryMethod
  readonly requestedDeliveryDate: string | null
  readonly airlitePurchaseOrderOperationId: string | null
  readonly orderStatus: NuTechOrderStatus
  readonly vendorConfirmationNumber: string | null
  readonly airliteWorkbookUrl: string | null
  readonly airliteWorkbookStatus: string
  readonly airliteWorkbookGeneratedAt: string | null
  readonly purchaseOrderReleasedAt: string | null
  readonly vendorInvoiceNumber: string | null
  readonly vendorInvoiceStatus: NuTechVendorInvoiceStatus
  readonly vendorInvoiceReceivedAt: string | null
  readonly vendorInvoiceReleasedAt: string | null
  readonly notes: string | null
  readonly updatedAt: string
}

export type NuTechCatalogProductOption = {
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
}

export type NuTechOrderItemRecord = {
  readonly id: string
  readonly productId: string
  readonly manufacturerSku: string
  readonly name: string
  readonly quantity: number
  readonly priceUnit: string
  readonly unitCostCents: number
  readonly unitPriceCents: number
  readonly sortOrder: number
}

export type ProjectNuTechOrderWorkspace = {
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
  readonly airlitePurchaseOrderOperationId: string | null
  readonly orderStatus: string
  readonly vendorConfirmationNumber: string | null
  readonly vendorInvoiceNumber: string | null
  readonly vendorInvoiceStatus: string
  readonly vendorInvoiceReceivedAt: string | null
  readonly notes: string | null
}

export type NuTechOrderActionResult =
  | { readonly success: true; readonly id: string }
  | { readonly success: false; readonly error: string }

type NuTechAccess = {
  readonly db: CompassDb
  readonly user: AuthUser
  readonly organizationId: string
  readonly project: {
    readonly id: string
    readonly projectNumber: string | null
    readonly name: string
    readonly clientName: string | null
    readonly address: string | null
  }
}

function cleanText(value: string | null): string | null {
  const cleaned = value?.trim() ?? ""
  return cleaned.length > 0 ? cleaned : null
}

function cleanDate(value: string | null, label: string): string | null {
  const cleaned = cleanText(value)
  if (cleaned === null) return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cleaned)) {
    throw new Error(`${label} must be a valid date.`)
  }
  const parsed = new Date(`${cleaned}T12:00:00Z`)
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== cleaned
  ) {
    throw new Error(`${label} must be a valid date.`)
  }
  return cleaned
}

function customerType(value: string): NuTechCustomerType {
  const match = NUTECH_CUSTOMER_TYPE_OPTIONS.find((option) => option.value === value)
  if (!match) throw new Error("Choose new or returning customer pricing.")
  return match.value
}

function storedCustomerType(value: string): NuTechCustomerType {
  return value === "returning" ? "returning" : "new"
}

function pricingMode(value: string): NuTechPricingMode {
  const match = NUTECH_PRICING_MODE_OPTIONS.find((option) => option.value === value)
  if (!match) throw new Error("Choose standard or cash-discount pricing.")
  return match.value
}

function storedPricingMode(value: string): NuTechPricingMode {
  return value === "cash_discount" ? "cash_discount" : "standard"
}

function quantitySource(value: string): NuTechQuantitySource {
  const match = NUTECH_QUANTITY_SOURCE_OPTIONS.find((option) => option.value === value)
  if (!match) throw new Error("Record who supplied the order quantities.")
  return match.value
}

function storedQuantitySource(value: string): NuTechQuantitySource {
  return value === "staff_takeoff" ? "staff_takeoff" : "customer_provided"
}

function takeoffStatus(value: string): NuTechTakeoffAcknowledgementStatus {
  const match = NUTECH_TAKEOFF_STATUS_OPTIONS.find((option) => option.value === value)
  return match?.value ?? "pending"
}

function scopeType(value: string): NuTechScopeType {
  const match = NUTECH_SCOPE_TYPE_OPTIONS.find((option) => option.value === value)
  if (!match) throw new Error("Choose the Nu-Tech order scope.")
  return match.value
}

function storedScopeType(value: string): NuTechScopeType {
  if (value === "block_and_bracing" || value === "bracing_only") return value
  return "block_sale"
}

function deliveryMethod(value: string): NuTechDeliveryMethod {
  const match = NUTECH_DELIVERY_METHOD_OPTIONS.find((option) => option.value === value)
  if (!match) throw new Error("Choose delivery, pickup, or will call.")
  return match.value
}

function storedDeliveryMethod(value: string): NuTechDeliveryMethod {
  if (value === "customer_pickup" || value === "will_call") return value
  return "delivery"
}

function orderStatus(value: string): NuTechOrderStatus {
  const match = NUTECH_ORDER_STATUS_OPTIONS.find((option) => option.value === value)
  return match?.value ?? "intake"
}

function vendorInvoiceStatus(value: string): NuTechVendorInvoiceStatus {
  const match = NUTECH_VENDOR_INVOICE_STATUS_OPTIONS.find(
    (option) => option.value === value
  )
  return match?.value ?? "not_received"
}

function toOrderRecord(
  row: typeof nuTechOrderWorkflows.$inferSelect
): NuTechOrderRecord {
  return {
    id: row.id,
    catalogVersionId: row.catalogVersionId,
    customerType: storedCustomerType(row.customerType),
    pricingMode: storedPricingMode(row.pricingMode),
    quantitySource: storedQuantitySource(row.quantitySource),
    takeoffAcknowledgementStatus: takeoffStatus(
      row.takeoffAcknowledgementStatus
    ),
    scopeType: storedScopeType(row.scopeType),
    blockQuantityNotes: row.blockQuantityNotes,
    bracingIncluded: row.bracingIncluded,
    bracingRentalStartDate: row.bracingRentalStartDate,
    bracingRentalEndDate: row.bracingRentalEndDate,
    bracingNotes: row.bracingNotes,
    deliveryMethod: storedDeliveryMethod(row.deliveryMethod),
    requestedDeliveryDate: row.requestedDeliveryDate,
    airlitePurchaseOrderOperationId: row.airlitePurchaseOrderOperationId,
    orderStatus: orderStatus(row.orderStatus),
    vendorConfirmationNumber: row.vendorConfirmationNumber,
    airliteWorkbookUrl: row.airliteWorkbookUrl,
    airliteWorkbookStatus: row.airliteWorkbookStatus,
    airliteWorkbookGeneratedAt: row.airliteWorkbookGeneratedAt,
    purchaseOrderReleasedAt: row.purchaseOrderReleasedAt,
    vendorInvoiceNumber: row.vendorInvoiceNumber,
    vendorInvoiceStatus: vendorInvoiceStatus(row.vendorInvoiceStatus),
    vendorInvoiceReceivedAt: row.vendorInvoiceReceivedAt,
    vendorInvoiceReleasedAt: row.vendorInvoiceReleasedAt,
    notes: row.notes,
    updatedAt: row.updatedAt,
  }
}

async function nuTechProjectAccess(
  projectId: string,
  action: "read" | "update" | "delete"
): Promise<NuTechAccess> {
  const user = await requireAuth()
  requireInternalNuTechStaff(user)
  if (action !== "read" && isDemoUser(user.id)) {
    throw new Error("DEMO_READ_ONLY")
  }
  await requireFeaturePermission(user, "nutech-orders", action)
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

function revalidateNuTechPaths(projectId: string): void {
  revalidatePath("/dashboard/nutech")
  revalidatePath(`/dashboard/projects/${projectId}`)
  revalidatePath(`/dashboard/projects/${projectId}/nutech`)
  revalidatePath(`/dashboard/projects/${projectId}/purchase-orders`)
}

export async function getProjectNuTechOrderWorkspace(
  projectId: string
): Promise<ProjectNuTechOrderWorkspace> {
  const access = await nuTechProjectAccess(projectId, "read")
  const [orderRow, estimateRow, purchaseOrderRows, canEdit, canDelete] =
    await Promise.all([
      access.db
        .select()
        .from(nuTechOrderWorkflows)
        .where(eq(nuTechOrderWorkflows.projectId, projectId))
        .limit(1)
        .get(),
      access.db
        .select({
          id: projectEstimates.id,
          number: projectEstimates.estimateNumber,
          status: projectEstimates.status,
          totalCents: projectEstimates.estimateTotalCents,
          updatedAt: projectEstimates.updatedAt,
        })
        .from(projectEstimates)
        .where(eq(projectEstimates.projectId, projectId))
        .orderBy(desc(projectEstimates.updatedAt))
        .limit(1)
        .get(),
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
  return {
    canEdit: canEdit && !isDemoUser(access.user.id),
    canDelete: canDelete && !isDemoUser(access.user.id),
    projectId,
    projectNumber: access.project.projectNumber,
    projectName: access.project.name,
    clientName: access.project.clientName,
    address: access.project.address,
    order: orderRow ? toOrderRecord(orderRow) : null,
    catalogVersionName: catalogVersion?.name ?? null,
    catalogProducts,
    orderItems,
    estimate: estimateRow ?? null,
    purchaseOrders: purchaseOrderRows,
  }
}

export async function getNuTechOrderDashboard(): Promise<
  readonly NuTechOrderDashboardItem[]
> {
  const user = await requireAuth()
  requireInternalNuTechStaff(user)
  await requireFeaturePermission(user, "nutech-orders", "read")
  const organizationId = requireOrg(user)
  const { env } = await getCloudflareContext()
  const db = getDb(env.DB)
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
  const [workflowRows, estimateRows, purchaseOrderRows] = await Promise.all([
    db
      .select()
      .from(nuTechOrderWorkflows)
      .where(inArray(nuTechOrderWorkflows.projectId, projectIds)),
    db
      .select({
        projectId: projectEstimates.projectId,
        status: projectEstimates.status,
        updatedAt: projectEstimates.updatedAt,
      })
      .from(projectEstimates)
      .where(inArray(projectEstimates.projectId, projectIds))
      .orderBy(desc(projectEstimates.updatedAt)),
    db
      .select({
        projectId: projectOperations.projectId,
        status: projectOperations.status,
      })
      .from(projectOperations)
      .where(
        and(
          inArray(projectOperations.projectId, projectIds),
          eq(projectOperations.sourceRecordType, "purchase_order")
        )
      ),
  ])
  return projectRows.map((project) => {
    const workflow = workflowRows.find((row) => row.projectId === project.id)
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
        ? storedQuantitySource(workflow.quantitySource)
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
    const parsedCustomerType = customerType(input.customerType)
    const parsedPricingMode = pricingMode(input.pricingMode)
    const parsedQuantitySource = quantitySource(input.quantitySource)
    const parsedTakeoffStatus = normalizedNuTechTakeoffStatus({
      quantitySource: parsedQuantitySource,
      requestedStatus: takeoffStatus(input.takeoffAcknowledgementStatus),
    })
    const parsedScopeType = scopeType(input.scopeType)
    const bracingIncluded =
      input.bracingIncluded ||
      parsedScopeType === "block_and_bracing" ||
      parsedScopeType === "bracing_only"
    const bracingRentalStartDate = bracingIncluded
      ? cleanDate(input.bracingRentalStartDate, "Bracing rental start")
      : null
    const bracingRentalEndDate = bracingIncluded
      ? cleanDate(input.bracingRentalEndDate, "Bracing rental end")
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
    const vendorInvoiceReceivedAt = cleanDate(
      input.vendorInvoiceReceivedAt,
      "Vendor invoice received date"
    )
    const requestedDeliveryDate = cleanDate(
      input.requestedDeliveryDate,
      "Requested delivery date"
    )
    const parsedOrderStatus = orderStatus(input.orderStatus)
    const parsedVendorInvoiceStatus = vendorInvoiceStatus(
      input.vendorInvoiceStatus
    )
    const existing = await access.db
      .select()
      .from(nuTechOrderWorkflows)
      .where(eq(nuTechOrderWorkflows.projectId, projectId))
      .limit(1)
      .get()
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
      (parsedCustomerType !== storedCustomerType(existing.customerType) ||
        parsedPricingMode !== storedPricingMode(existing.pricingMode) ||
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
      deliveryMethod: deliveryMethod(input.deliveryMethod),
      requestedDeliveryDate,
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
    const saveWorkflowQuery = access.db
      .insert(nuTechOrderWorkflows)
      .values(values)
      .onConflictDoUpdate({
        target: nuTechOrderWorkflows.projectId,
        set: {
          catalogVersionId: values.catalogVersionId,
          customerType: values.customerType,
          pricingMode: values.pricingMode,
          quantitySource: values.quantitySource,
          takeoffAcknowledgementStatus: values.takeoffAcknowledgementStatus,
          scopeType: values.scopeType,
          blockQuantityNotes: values.blockQuantityNotes,
          bracingIncluded: values.bracingIncluded,
          bracingRentalStartDate: values.bracingRentalStartDate,
          bracingRentalEndDate: values.bracingRentalEndDate,
          bracingNotes: values.bracingNotes,
          deliveryMethod: values.deliveryMethod,
          requestedDeliveryDate: values.requestedDeliveryDate,
          airlitePurchaseOrderOperationId: values.airlitePurchaseOrderOperationId,
          orderStatus: values.orderStatus,
          vendorConfirmationNumber: values.vendorConfirmationNumber,
          vendorInvoiceNumber: values.vendorInvoiceNumber,
          vendorInvoiceStatus: values.vendorInvoiceStatus,
          vendorInvoiceReceivedAt: values.vendorInvoiceReceivedAt,
          airliteWorkbookStatus: nextWorkbookStatus,
          notes: values.notes,
          updatedBy: access.user.id,
          updatedAt: now,
        },
      })
    if (values.catalogVersionId !== null) {
      const selectedPriceColumn =
        parsedCustomerType === "new"
          ? parsedPricingMode === "cash_discount"
            ? nuTechCatalogPrices.newCashPriceCents
            : nuTechCatalogPrices.newStandardPriceCents
          : parsedPricingMode === "cash_discount"
            ? nuTechCatalogPrices.returningCashPriceCents
            : nuTechCatalogPrices.returningStandardPriceCents
      const repriceOrderItemsQuery = access.db
        .update(nuTechOrderItems)
        .set({
          unitPriceCents: sql`(
            SELECT ${selectedPriceColumn}
            FROM ${nuTechCatalogPrices}
            WHERE ${nuTechCatalogPrices.catalogVersionId} = ${values.catalogVersionId}
              AND ${nuTechCatalogPrices.productId} = ${nuTechOrderItems.productId}
            LIMIT 1
          )`,
          updatedAt: now,
        })
        .where(eq(nuTechOrderItems.workflowId, id))
      await access.db.batch([saveWorkflowQuery, repriceOrderItemsQuery])
    } else {
      await saveWorkflowQuery
    }
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
  projectId: string
): Promise<NuTechOrderActionResult> {
  try {
    const access = await nuTechProjectAccess(projectId, "update")
    const order = await access.db
      .select()
      .from(nuTechOrderWorkflows)
      .where(eq(nuTechOrderWorkflows.projectId, projectId))
      .limit(1)
      .get()
    if (!order) throw new Error("Start and save the Nu-Tech order first.")
    if (order.purchaseOrderReleasedAt !== null) {
      return { success: true, id: order.id }
    }
    const orderItemRows = await access.db
      .select({ id: nuTechOrderItems.id })
      .from(nuTechOrderItems)
      .where(eq(nuTechOrderItems.workflowId, order.id))
    const readiness = nuTechPurchaseOrderReleaseReadiness({
      customerType: storedCustomerType(order.customerType),
      pricingMode: storedPricingMode(order.pricingMode),
      quantitySource: storedQuantitySource(order.quantitySource),
      takeoffAcknowledgementStatus: takeoffStatus(
        order.takeoffAcknowledgementStatus
      ),
      airlitePurchaseOrderOperationId: order.airlitePurchaseOrderOperationId,
      orderItemCount: orderItemRows.length,
      airliteWorkbookStatus: order.airliteWorkbookStatus,
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
      access.db
        .update(nuTechOrderWorkflows)
        .set({
          orderStatus: "po_released",
          purchaseOrderReleasedAt: now,
          purchaseOrderReleasedBy: access.user.id,
          updatedBy: access.user.id,
          updatedAt: now,
        })
        .where(eq(nuTechOrderWorkflows.id, order.id)),
      access.db
        .update(projectOperations)
        .set({ status: purchaseOrderStatus, updatedAt: now })
        .where(eq(projectOperations.id, purchaseOrderId)),
    ])
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
  projectId: string
): Promise<NuTechOrderActionResult> {
  try {
    const access = await nuTechProjectAccess(projectId, "update")
    const order = await access.db
      .select()
      .from(nuTechOrderWorkflows)
      .where(eq(nuTechOrderWorkflows.projectId, projectId))
      .limit(1)
      .get()
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
    await access.db
      .update(nuTechOrderWorkflows)
      .set({
        orderStatus: "invoice_released",
        vendorInvoiceStatus: "released",
        vendorInvoiceReceivedAt: order.vendorInvoiceReceivedAt ?? now.slice(0, 10),
        vendorInvoiceReleasedAt: now,
        vendorInvoiceReleasedBy: access.user.id,
        updatedBy: access.user.id,
        updatedAt: now,
      })
      .where(eq(nuTechOrderWorkflows.id, order.id))
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
  projectId: string
): Promise<NuTechOrderActionResult> {
  try {
    const access = await nuTechProjectAccess(projectId, "delete")
    const existing = await access.db
      .select({
        id: nuTechOrderWorkflows.id,
        purchaseOrderReleasedAt: nuTechOrderWorkflows.purchaseOrderReleasedAt,
        vendorInvoiceReleasedAt: nuTechOrderWorkflows.vendorInvoiceReleasedAt,
      })
      .from(nuTechOrderWorkflows)
      .where(eq(nuTechOrderWorkflows.projectId, projectId))
      .limit(1)
      .get()
    if (!existing) throw new Error("Nu-Tech order workflow not found.")
    if (
      existing.purchaseOrderReleasedAt !== null ||
      existing.vendorInvoiceReleasedAt !== null
    ) {
      throw new Error(
        "Released Nu-Tech workflows are retained for audit and cannot be deleted."
      )
    }
    await access.db
      .delete(nuTechOrderWorkflows)
      .where(eq(nuTechOrderWorkflows.id, existing.id))
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
