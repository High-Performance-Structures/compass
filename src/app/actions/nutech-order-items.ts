"use server"

import { and, asc, eq, exists, gt, isNull, lte, ne, or, sql } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import { getDb } from "@/db"
import { organizations, projectOperations, projects } from "@/db/schema"
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
import { GoogleDriveCopyOutcomeUnknownError } from "@/lib/google/client/drive-client"
import { getOrganizationDriveContext } from "@/lib/google/organization-drive"
import type { DriveFile } from "@/lib/google/client/types"
import { buildNuTechAirliteWorkbookPlan } from "@/lib/nutech/airlite-workbook"
import {
  nuTechCustomerPriceCents,
  validateNuTechOrderQuantity,
} from "@/lib/nutech/catalog-pricing"
import { requireOrg } from "@/lib/org-scope"
import { requireFeaturePermission } from "@/lib/permission-enforcement"
import { projectDepartment } from "@/lib/project-branding"
import { isInternalStaffRole } from "@/lib/user-roles"

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

const AIRLITE_WORKBOOK_CLAIM_LEASE_MS = 5 * 60 * 1000
const AIRLITE_WORKBOOK_RETRY_WINDOW_MS = 23 * 60 * 60 * 1000
const AIRLITE_WORKBOOK_MAX_ATTEMPTS = 3
const AIRLITE_WORKBOOK_GENERATING_ERROR =
  "The Airlite workbook is already being generated. Try again shortly."
const AIRLITE_WORKBOOK_CLAIM_LOST_ERROR =
  "The Airlite workbook generation claim expired or was replaced."
const AIRLITE_WORKBOOK_PROVIDER_UNRESOLVED_ERROR =
  "The Airlite workbook provider attempt is unresolved. Try again after Drive sync finishes."

const airliteProviderEffects = new Map<string, Promise<DriveFile>>()

function activeAirliteWorkbookClaim(
  workflow: Pick<
    typeof nuTechOrderWorkflows.$inferSelect,
    "airliteWorkbookStatus" | "airliteWorkbookClaimToken" | "airliteWorkbookClaimReclaimAfter"
  >,
  now: string
): boolean {
  return (
    workflow.airliteWorkbookStatus === "generating" &&
    workflow.airliteWorkbookClaimToken !== null &&
    workflow.airliteWorkbookClaimReclaimAfter !== null &&
    workflow.airliteWorkbookClaimReclaimAfter > now
  )
}

function airliteProviderEffectRequiresFence(
  workflow: Pick<
    typeof nuTechOrderWorkflows.$inferSelect,
    "airliteWorkbookStatus" | "airliteWorkbookProviderStatus" | "airliteWorkbookId"
  >
): boolean {
  return (
    workflow.airliteWorkbookStatus === "generating" &&
    (workflow.airliteWorkbookProviderStatus === "in_flight" ||
      (workflow.airliteWorkbookProviderStatus === "succeeded" &&
        workflow.airliteWorkbookId !== null))
  )
}

async function copyAirliteWorkbookOnce(input: {
  readonly client: {
    readonly copyFile: (
      userEmail: string,
      fileId: string,
      options: {
        readonly name: string
        readonly parentId: string
        readonly appProperties?: Readonly<Record<string, string>>
        readonly idempotencyKey?: string
      }
    ) => Promise<DriveFile>
  }
  readonly userEmail: string
  readonly templateId: string
  readonly name: string
  readonly parentId: string
  readonly fingerprint: string
}): Promise<DriveFile> {
  const key = `${input.userEmail}:${input.templateId}:${input.fingerprint}`
  const pending = airliteProviderEffects.get(key)
  if (pending) return pending
  const effect = Promise.resolve().then(() =>
    input.client.copyFile(input.userEmail, input.templateId, {
      name: input.name,
      parentId: input.parentId,
      appProperties: {
        compassAirliteGenerationFingerprint: input.fingerprint,
      },
      idempotencyKey: input.fingerprint,
    })
  )
  airliteProviderEffects.set(key, effect)
  try {
    return await effect
  } finally {
    if (airliteProviderEffects.get(key) === effect) {
      airliteProviderEffects.delete(key)
    }
  }
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value)
  )
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("")
}

async function renewAirliteWorkbookClaim(input: {
  readonly db: CompassDb
  readonly workflowId: string
  readonly claimToken: string
  readonly claimRevision: number
  readonly purchaseOrderOperationId: string
}): Promise<void> {
  const now = new Date().toISOString()
  const renewed = await input.db
    .update(nuTechOrderWorkflows)
    .set({
      airliteWorkbookClaimReclaimAfter: new Date(
        Date.now() + AIRLITE_WORKBOOK_CLAIM_LEASE_MS
      ).toISOString(),
      updatedAt: now,
    })
    .where(
      and(
        eq(nuTechOrderWorkflows.id, input.workflowId),
        eq(nuTechOrderWorkflows.airliteWorkbookClaimToken, input.claimToken),
        eq(
          nuTechOrderWorkflows.airliteWorkbookClaimRevision,
          input.claimRevision
        ),
        eq(nuTechOrderWorkflows.airliteWorkbookStatus, "generating"),
        eq(
          nuTechOrderWorkflows.airlitePurchaseOrderOperationId,
          input.purchaseOrderOperationId
        ),
        isNull(nuTechOrderWorkflows.purchaseOrderReleasedAt),
        gt(
          nuTechOrderWorkflows.airliteWorkbookClaimReclaimAfter,
          now
        )
      )
    )
    .run()
  if (renewed.meta.changes !== 1) throw new Error(AIRLITE_WORKBOOK_CLAIM_LOST_ERROR)
}

async function runWithAirliteProviderWriteFence<T>(input: {
  readonly db: CompassDb
  readonly workflowId: string
  readonly claimToken: string
  readonly claimRevision: number
  readonly purchaseOrderOperationId: string
  readonly effect: () => Promise<T>
}): Promise<T> {
  const now = new Date().toISOString()
  const fenced = await input.db
    .update(nuTechOrderWorkflows)
    .set({
      airliteWorkbookClaimReclaimAfter: new Date(
        Date.now() + AIRLITE_WORKBOOK_RETRY_WINDOW_MS
      ).toISOString(),
      updatedAt: now,
    })
    .where(
      and(
        eq(nuTechOrderWorkflows.id, input.workflowId),
        eq(nuTechOrderWorkflows.airliteWorkbookClaimToken, input.claimToken),
        eq(
          nuTechOrderWorkflows.airliteWorkbookClaimRevision,
          input.claimRevision
        ),
        eq(nuTechOrderWorkflows.airliteWorkbookStatus, "generating"),
        eq(
          nuTechOrderWorkflows.airlitePurchaseOrderOperationId,
          input.purchaseOrderOperationId
        ),
        isNull(nuTechOrderWorkflows.purchaseOrderReleasedAt),
        gt(nuTechOrderWorkflows.airliteWorkbookClaimReclaimAfter, now)
      )
    )
    .run()
  if (fenced.meta.changes !== 1) throw new Error(AIRLITE_WORKBOOK_CLAIM_LOST_ERROR)
  const result = await input.effect()
  await renewAirliteWorkbookClaim(input)
  return result
}

async function nuTechItemAccess(projectId: string): Promise<NuTechItemAccess> {
  const user = await requireAuth()
  if (!user.isActive || !isInternalStaffRole(user.role)) {
    throw new Error("Purchase orders are limited to active internal staff.")
  }
  if (isDemoUser(user.id)) throw new Error("DEMO_READ_ONLY")
  await requireFeaturePermission(user, "nutech-orders", "update")
  const organizationId = requireOrg(user)
  const { env } = await getCloudflareContext()
  const db = getDb(env.DB)
  const organization = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(
      and(
        eq(organizations.id, organizationId),
        eq(organizations.type, "internal"),
        eq(organizations.isActive, true)
      )
    )
    .limit(1)
    .get()
  if (!organization) {
    throw new Error("Purchase orders require an active internal organization.")
  }
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
    const now = new Date().toISOString()
    if (workflow.airliteWorkbookProviderStatus === "in_flight") {
      throw new Error(AIRLITE_WORKBOOK_PROVIDER_UNRESOLVED_ERROR)
    }
    if (activeAirliteWorkbookClaim(workflow, now)) {
      throw new Error(AIRLITE_WORKBOOK_GENERATING_ERROR)
    }
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
          eq(nuTechProducts.active, true)
        )
      )
      .limit(1)
      .get()
    if (!product) throw new Error("Choose a product from this order's catalog.")
    if (airliteProviderEffectRequiresFence(workflow)) {
      throw new Error(AIRLITE_WORKBOOK_PROVIDER_UNRESOLVED_ERROR)
    }
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
    const workbookClaimInvalidated =
      workflow.airliteWorkbookStatus === "generating" ||
      workflow.airliteWorkbookStatus.startsWith("generated")
    const unitPriceCents = nuTechCustomerPriceCents(
      product,
      storedCustomerType(workflow.customerType),
      storedPricingMode(workflow.pricingMode)
    )
    const unchangedWorkflow = and(
      eq(nuTechOrderWorkflows.id, workflow.id),
      eq(nuTechOrderWorkflows.updatedAt, workflow.updatedAt),
      eq(nuTechOrderWorkflows.airliteWorkbookStatus, workflow.airliteWorkbookStatus),
      workflow.airliteWorkbookClaimToken === null
        ? isNull(nuTechOrderWorkflows.airliteWorkbookClaimToken)
        : eq(
            nuTechOrderWorkflows.airliteWorkbookClaimToken,
            workflow.airliteWorkbookClaimToken
          ),
      workflow.airliteWorkbookClaimRevision === null
        ? isNull(nuTechOrderWorkflows.airliteWorkbookClaimRevision)
        : eq(
            nuTechOrderWorkflows.airliteWorkbookClaimRevision,
            workflow.airliteWorkbookClaimRevision
          ),
      isNull(nuTechOrderWorkflows.purchaseOrderReleasedAt)
    )
    const itemMutation = existing
      ? access.db
          .update(nuTechOrderItems)
          .set({
            quantity: input.quantity,
            unitCostCents: product.airliteCostCents,
            unitPriceCents,
            updatedAt: now,
          })
          .where(
            and(
              eq(nuTechOrderItems.id, existing.id),
              eq(nuTechOrderItems.workflowId, workflow.id),
              eq(nuTechOrderItems.productId, product.id),
              exists(
                access.db
                  .select({ id: nuTechOrderWorkflows.id })
                  .from(nuTechOrderWorkflows)
                  .where(unchangedWorkflow)
              )
            )
          )
      : access.db
          .insert(nuTechOrderItems)
          .select(
            access.db
              .select({
                id: sql<string>`${id}`.as("id"),
                workflowId: nuTechOrderWorkflows.id,
                productId: sql<string>`${product.id}`.as("productId"),
                catalogVersionId: sql<string>`${workflow.catalogVersionId}`.as(
                  "catalogVersionId"
                ),
                quantity: sql<number>`${input.quantity}`.as("quantity"),
                manufacturerSkuSnapshot: sql<string>`${product.manufacturerSku}`.as(
                  "manufacturerSkuSnapshot"
                ),
                productNameSnapshot: sql<string>`${product.name}`.as(
                  "productNameSnapshot"
                ),
                priceUnitSnapshot: sql<string>`${product.priceUnit}`.as(
                  "priceUnitSnapshot"
                ),
                unitCostCents: sql<number>`${product.airliteCostCents}`.as(
                  "unitCostCents"
                ),
                unitPriceCents: sql<number>`${unitPriceCents}`.as("unitPriceCents"),
                sortOrder: sql<number>`${existingItems.length}`.as("sortOrder"),
                createdAt: sql<string>`${now}`.as("createdAt"),
                updatedAt: sql<string>`${now}`.as("updatedAt"),
              })
              .from(nuTechOrderWorkflows)
              .where(unchangedWorkflow)
          )
          .onConflictDoUpdate({
            target: [nuTechOrderItems.workflowId, nuTechOrderItems.productId],
            set: {
              quantity: input.quantity,
              unitCostCents: product.airliteCostCents,
              unitPriceCents,
              updatedAt: now,
            },
            setWhere: exists(
              access.db
                .select({ id: nuTechOrderWorkflows.id })
                .from(nuTechOrderWorkflows)
                .where(unchangedWorkflow)
            ),
          })
    const saveResults = await access.db.batch([
      itemMutation,
      access.db
        .update(nuTechOrderWorkflows)
        .set({
          orderStatus:
            workflow.orderStatus === "intake"
              ? "quantities_ready"
              : workflow.orderStatus,
          airliteWorkbookStatus: workbookClaimInvalidated
            ? "stale"
            : workflow.airliteWorkbookStatus,
          airliteWorkbookClaimToken: workbookClaimInvalidated
            ? null
            : workflow.airliteWorkbookClaimToken,
          airliteWorkbookClaimReclaimAfter: workbookClaimInvalidated
            ? null
            : workflow.airliteWorkbookClaimReclaimAfter,
          airliteWorkbookClaimRetryUntil: workbookClaimInvalidated
            ? null
            : workflow.airliteWorkbookClaimRetryUntil,
          airliteWorkbookClaimAttempt: workbookClaimInvalidated
            ? null
            : workflow.airliteWorkbookClaimAttempt,
          airliteWorkbookClaimFingerprint: workbookClaimInvalidated
            ? null
            : workflow.airliteWorkbookClaimFingerprint,
          airliteWorkbookClaimError: workbookClaimInvalidated
            ? null
            : workflow.airliteWorkbookClaimError,
          airliteWorkbookProviderStatus: workbookClaimInvalidated
            ? "not_started"
            : workflow.airliteWorkbookProviderStatus,
          airliteWorkbookProviderAttemptedAt: workbookClaimInvalidated
            ? null
            : workflow.airliteWorkbookProviderAttemptedAt,
          updatedBy: access.user.id,
          updatedAt: now,
        })
        .where(unchangedWorkflow),
    ])
    if (
      (saveResults[0]?.meta.changes ?? 0) !== 1 ||
      (saveResults[1]?.meta.changes ?? 0) !== 1
    ) {
      throw new Error(
        "The Nu-Tech order changed while the item was being saved. Refresh and try again."
      )
    }
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
        airliteWorkbookClaimToken: nuTechOrderWorkflows.airliteWorkbookClaimToken,
        airliteWorkbookClaimRevision: nuTechOrderWorkflows.airliteWorkbookClaimRevision,
        airliteWorkbookClaimReclaimAfter:
          nuTechOrderWorkflows.airliteWorkbookClaimReclaimAfter,
        airliteWorkbookClaimRetryUntil: nuTechOrderWorkflows.airliteWorkbookClaimRetryUntil,
        airliteWorkbookClaimAttempt: nuTechOrderWorkflows.airliteWorkbookClaimAttempt,
        airliteWorkbookClaimFingerprint:
          nuTechOrderWorkflows.airliteWorkbookClaimFingerprint,
        airliteWorkbookClaimError: nuTechOrderWorkflows.airliteWorkbookClaimError,
        airliteWorkbookId: nuTechOrderWorkflows.airliteWorkbookId,
        airliteWorkbookProviderStatus: nuTechOrderWorkflows.airliteWorkbookProviderStatus,
        airliteWorkbookProviderAttemptedAt:
          nuTechOrderWorkflows.airliteWorkbookProviderAttemptedAt,
        purchaseOrderReleasedAt: nuTechOrderWorkflows.purchaseOrderReleasedAt,
        updatedAt: nuTechOrderWorkflows.updatedAt,
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
    const now = new Date().toISOString()
    if (item.airliteWorkbookProviderStatus === "in_flight") {
      throw new Error(AIRLITE_WORKBOOK_PROVIDER_UNRESOLVED_ERROR)
    }
    if (activeAirliteWorkbookClaim(item, now)) {
      throw new Error(AIRLITE_WORKBOOK_GENERATING_ERROR)
    }
    if (item.purchaseOrderReleasedAt !== null) {
      throw new Error("Released Airlite PO quantities are locked.")
    }
    if (
      item.airliteWorkbookStatus === "generating" &&
      (item.airliteWorkbookProviderStatus === "in_flight" ||
        (item.airliteWorkbookProviderStatus === "succeeded" &&
          item.airliteWorkbookId !== null))
    ) {
      throw new Error(AIRLITE_WORKBOOK_PROVIDER_UNRESOLVED_ERROR)
    }
    const workbookClaimInvalidated =
      item.airliteWorkbookStatus === "generating" ||
      item.airliteWorkbookStatus.startsWith("generated")
    const unchangedWorkflow = and(
      eq(nuTechOrderWorkflows.id, item.workflowId),
      eq(nuTechOrderWorkflows.updatedAt, item.updatedAt),
      eq(nuTechOrderWorkflows.airliteWorkbookStatus, item.airliteWorkbookStatus),
      item.airliteWorkbookClaimToken === null
        ? isNull(nuTechOrderWorkflows.airliteWorkbookClaimToken)
        : eq(
            nuTechOrderWorkflows.airliteWorkbookClaimToken,
            item.airliteWorkbookClaimToken
          ),
      item.airliteWorkbookClaimRevision === null
        ? isNull(nuTechOrderWorkflows.airliteWorkbookClaimRevision)
        : eq(
            nuTechOrderWorkflows.airliteWorkbookClaimRevision,
            item.airliteWorkbookClaimRevision
          ),
      isNull(nuTechOrderWorkflows.purchaseOrderReleasedAt)
    )
    const deleteResults = await access.db.batch([
      access.db
        .delete(nuTechOrderItems)
        .where(
          and(
            eq(nuTechOrderItems.id, item.id),
            eq(nuTechOrderItems.workflowId, item.workflowId),
            exists(
              access.db
                .select({ id: nuTechOrderWorkflows.id })
                .from(nuTechOrderWorkflows)
                .where(unchangedWorkflow)
            )
          )
        ),
      access.db
        .update(nuTechOrderWorkflows)
        .set({
          airliteWorkbookStatus: workbookClaimInvalidated
            ? "stale"
            : item.airliteWorkbookStatus,
          airliteWorkbookClaimToken: workbookClaimInvalidated
            ? null
            : item.airliteWorkbookClaimToken,
          airliteWorkbookClaimReclaimAfter: workbookClaimInvalidated
            ? null
            : item.airliteWorkbookClaimReclaimAfter,
          airliteWorkbookClaimRetryUntil: workbookClaimInvalidated
            ? null
            : item.airliteWorkbookClaimRetryUntil,
          airliteWorkbookClaimAttempt: workbookClaimInvalidated
            ? null
            : item.airliteWorkbookClaimAttempt,
          airliteWorkbookClaimFingerprint: workbookClaimInvalidated
            ? null
            : item.airliteWorkbookClaimFingerprint,
          airliteWorkbookClaimError: workbookClaimInvalidated
            ? null
            : item.airliteWorkbookClaimError,
          airliteWorkbookProviderStatus: workbookClaimInvalidated
            ? "not_started"
            : item.airliteWorkbookProviderStatus,
          airliteWorkbookProviderAttemptedAt: workbookClaimInvalidated
            ? null
            : item.airliteWorkbookProviderAttemptedAt,
          updatedBy: access.user.id,
          updatedAt: now,
        })
        .where(unchangedWorkflow),
    ])
    if (
      (deleteResults[0]?.meta.changes ?? 0) !== 1 ||
      (deleteResults[1]?.meta.changes ?? 0) !== 1
    ) {
      throw new Error(
        "The Nu-Tech order changed while the item was being deleted. Refresh and try again."
      )
    }
    revalidateNuTechOrder(projectId)
    return { success: true, id: item.id }
  } catch (error) {
    return actionError(error, "Failed to delete the Nu-Tech order item.")
  }
}

export async function generateNuTechAirliteWorkbook(
  projectId: string
): Promise<NuTechOrderItemActionResult> {
  let claimedWorkflowId: string | null = null
  let claimedDb: CompassDb | null = null
  let claimToken: string | null = null
  let claimRevision: number | null = null
  let claimedPurchaseOrderOperationId: string | null = null
  let inheritedProviderAttemptUnresolved = false
  let providerEffectSucceeded = false
  try {
    const access = await nuTechItemAccess(projectId)
    if (!access.project.googleDriveFolderId) {
      throw new Error("Provision the project Google Drive folder before generating the Airlite workbook.")
    }
    const destinationFolderId = access.project.googleDriveFolderId
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
    const purchaseOrderOperationId = workflow.airlitePurchaseOrderOperationId
    const now = new Date().toISOString()
    const workbookDate =
      workflow.airliteWorkbookProviderAttemptedAt?.slice(0, 10) ?? now.slice(0, 10)
    const reclaimExpired =
      workflow.airliteWorkbookClaimReclaimAfter === null ||
      workflow.airliteWorkbookClaimReclaimAfter <= now
    if (
      workflow.airliteWorkbookStatus === "generating" &&
      !reclaimExpired
    ) {
      throw new Error(AIRLITE_WORKBOOK_GENERATING_ERROR)
    }
    const retryWindowExpired =
      workflow.airliteWorkbookClaimRetryUntil !== null &&
      workflow.airliteWorkbookClaimRetryUntil <= now
    const previousAttempt = workflow.airliteWorkbookClaimAttempt ?? 0
    const nextAttempt =
      retryWindowExpired ||
      workflow.airliteWorkbookStatus === "generated" ||
      workflow.airliteWorkbookStatus === "not_generated"
        ? 1
        : previousAttempt + 1
    if (nextAttempt > AIRLITE_WORKBOOK_MAX_ATTEMPTS) {
      throw new Error(
        "The Airlite workbook generation retry limit has been reached. Try again later."
      )
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
        .select({ number: projectOperations.sourceRecordNumber })
        .from(projectOperations)
        .where(
          and(
            eq(projectOperations.id, purchaseOrderOperationId),
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
          category: nuTechProducts.category,
          quantity: nuTechOrderItems.quantity,
          minimumOrderIncrement: nuTechProducts.minimumOrderIncrement,
          packageLabel: nuTechProducts.packageLabel,
          priceUnit: nuTechOrderItems.priceUnitSnapshot,
          airliteTemplateRow: nuTechProducts.airliteTemplateRow,
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
    const plan = buildNuTechAirliteWorkbookPlan({
      purchaseOrderNumber: purchaseOrder.number,
      purchaseOrderDate: workbookDate,
      requestedDeliveryDate: workflow.requestedDeliveryDate,
      projectName: access.project.name,
      jobsiteAddress: access.project.address,
      orderContactName: access.user.displayName ?? access.user.email,
      orderContactPhone: access.user.phone ?? null,
      orderContactEmail: access.user.email,
      deliveryContact: access.project.clientName,
      lines: lineRows,
    })
    const { env } = await getCloudflareContext()
    const { client, sheetsClient, userEmail } = await getOrganizationDriveContext({
      db: access.db,
      environment: env,
      organizationId: access.organizationId,
      user: access.user,
    })
    const workbookName = `${access.project.projectNumber ?? access.project.name} Airlite Order ${workbookDate}`
    const claimFingerprint = await sha256Hex(
      JSON.stringify({
        providerAccount: userEmail,
        templateId: catalogVersion.airliteTemplateId,
        destinationFolderId,
        workbookName,
        workflowId: workflow.id,
        purchaseOrderOperationId,
        purchaseOrderNumber: purchaseOrder.number,
        requestedDeliveryDate: workflow.requestedDeliveryDate,
        plan,
      })
    )
    if (
      workflow.airliteWorkbookProviderStatus === "in_flight" &&
      workflow.airliteWorkbookClaimFingerprint !== claimFingerprint
    ) {
      throw new Error(AIRLITE_WORKBOOK_PROVIDER_UNRESOLVED_ERROR)
    }
    const providerEffectInFlight =
      workflow.airliteWorkbookClaimFingerprint === claimFingerprint &&
      workflow.airliteWorkbookProviderStatus === "in_flight"
    const providerEffectAlreadySucceeded =
      workflow.airliteWorkbookClaimFingerprint === claimFingerprint &&
      workflow.airliteWorkbookProviderStatus === "succeeded" &&
      workflow.airliteWorkbookId !== null
    const nextClaimToken = crypto.randomUUID()
    const nextClaimRevision = (workflow.airliteWorkbookClaimRevision ?? 0) + 1
    const retryUntil =
      workflow.airliteWorkbookClaimRetryUntil !== null &&
      !retryWindowExpired
        ? workflow.airliteWorkbookClaimRetryUntil
        : new Date(Date.now() + AIRLITE_WORKBOOK_RETRY_WINDOW_MS).toISOString()
    const generationClaim = await access.db
      .update(nuTechOrderWorkflows)
      .set({
        airliteWorkbookStatus: "generating",
        airliteWorkbookClaimToken: nextClaimToken,
        airliteWorkbookClaimRevision: nextClaimRevision,
        airliteWorkbookClaimAttempt: nextAttempt,
        airliteWorkbookClaimReclaimAfter: new Date(
          Date.now() + AIRLITE_WORKBOOK_CLAIM_LEASE_MS
        ).toISOString(),
        airliteWorkbookClaimRetryUntil: retryUntil,
        airliteWorkbookClaimFingerprint: claimFingerprint,
        airliteWorkbookClaimError: null,
        airliteWorkbookProviderStatus: providerEffectInFlight
          ? "in_flight"
          : providerEffectAlreadySucceeded
            ? "succeeded"
            : "not_started",
        airliteWorkbookProviderAttemptedAt:
          providerEffectInFlight || providerEffectAlreadySucceeded
          ? workflow.airliteWorkbookProviderAttemptedAt
          : null,
        updatedBy: access.user.id,
        updatedAt: now,
      })
      .where(
        and(
          eq(nuTechOrderWorkflows.id, workflow.id),
          eq(nuTechOrderWorkflows.updatedAt, workflow.updatedAt),
          eq(
            nuTechOrderWorkflows.airlitePurchaseOrderOperationId,
            purchaseOrderOperationId
          ),
          isNull(nuTechOrderWorkflows.purchaseOrderReleasedAt),
          or(
            ne(nuTechOrderWorkflows.airliteWorkbookStatus, "generating"),
            and(
              eq(nuTechOrderWorkflows.airliteWorkbookStatus, "generating"),
              or(
                isNull(nuTechOrderWorkflows.airliteWorkbookClaimReclaimAfter),
                lte(
                  nuTechOrderWorkflows.airliteWorkbookClaimReclaimAfter,
                  now
                )
              )
            )
          )
        )
      )
      .run()
    if (generationClaim.meta.changes !== 1) {
      throw new Error(AIRLITE_WORKBOOK_GENERATING_ERROR)
    }
    claimedWorkflowId = workflow.id
    claimedDb = access.db
    claimToken = nextClaimToken
    claimRevision = nextClaimRevision
    claimedPurchaseOrderOperationId = purchaseOrderOperationId
    inheritedProviderAttemptUnresolved = providerEffectInFlight
    providerEffectSucceeded = providerEffectAlreadySucceeded

    const claim = {
      db: access.db,
      workflowId: workflow.id,
      claimToken: nextClaimToken,
      claimRevision: nextClaimRevision,
      purchaseOrderOperationId,
    }
    await renewAirliteWorkbookClaim(claim)
    await renewAirliteWorkbookClaim(claim)
    const matchingFiles = await client.listFiles(userEmail, {
      folderId: destinationFolderId,
      query: `appProperties has { key='compassAirliteGenerationFingerprint' and value='${claimFingerprint}' }`,
      pageSize: 10,
    })
    const existingWorkbook = matchingFiles.files.find(
      (file) =>
        typeof file.id === "string" &&
        file.id.trim().length > 0 &&
        file.trashed !== true &&
        file.appProperties?.compassAirliteGenerationFingerprint === claimFingerprint
    )
    const durableWorkbook =
      providerEffectAlreadySucceeded && workflow.airliteWorkbookId !== null
        ? {
            id: workflow.airliteWorkbookId,
            name: workbookName,
            mimeType: "application/vnd.google-apps.spreadsheet",
            parents: [destinationFolderId],
            appProperties: {
              compassAirliteGenerationFingerprint: claimFingerprint,
            },
            webViewLink: workflow.airliteWorkbookUrl ?? undefined,
          }
        : undefined
    let workbook = durableWorkbook ?? existingWorkbook
    const providerEffectKey = `${userEmail}:${catalogVersion.airliteTemplateId}:${claimFingerprint}`
    if (workbook) {
      const adopted = await access.db
        .update(nuTechOrderWorkflows)
        .set({
          airliteWorkbookId: workbook.id,
          airliteWorkbookUrl:
            workbook.webViewLink ??
            `https://docs.google.com/spreadsheets/d/${workbook.id}/edit`,
          airliteWorkbookProviderStatus: "succeeded",
          airliteWorkbookProviderAttemptedAt:
            workflow.airliteWorkbookProviderAttemptedAt ?? now,
          updatedAt: new Date().toISOString(),
        })
        .where(
          and(
            eq(nuTechOrderWorkflows.id, workflow.id),
            eq(nuTechOrderWorkflows.airliteWorkbookClaimToken, nextClaimToken),
            eq(
              nuTechOrderWorkflows.airliteWorkbookClaimRevision,
              nextClaimRevision
            ),
            eq(nuTechOrderWorkflows.airliteWorkbookStatus, "generating"),
            eq(
              nuTechOrderWorkflows.airlitePurchaseOrderOperationId,
              purchaseOrderOperationId
            ),
            isNull(nuTechOrderWorkflows.purchaseOrderReleasedAt)
          )
        )
        .run()
      if (adopted.meta.changes !== 1) {
        throw new Error(AIRLITE_WORKBOOK_CLAIM_LOST_ERROR)
      }
      inheritedProviderAttemptUnresolved = false
      providerEffectSucceeded = true
    } else {
      if (providerEffectInFlight && !airliteProviderEffects.has(providerEffectKey)) {
        throw new Error(AIRLITE_WORKBOOK_PROVIDER_UNRESOLVED_ERROR)
      }
      await renewAirliteWorkbookClaim(claim)
      const reserved = await access.db
        .update(nuTechOrderWorkflows)
        .set({
          airliteWorkbookProviderStatus: "in_flight",
          airliteWorkbookProviderAttemptedAt:
            workflow.airliteWorkbookProviderAttemptedAt ?? now,
          updatedAt: new Date().toISOString(),
        })
        .where(
          and(
            eq(nuTechOrderWorkflows.id, workflow.id),
            eq(nuTechOrderWorkflows.airliteWorkbookClaimToken, nextClaimToken),
            eq(
              nuTechOrderWorkflows.airliteWorkbookClaimRevision,
              nextClaimRevision
            ),
            eq(nuTechOrderWorkflows.airliteWorkbookStatus, "generating"),
            eq(
              nuTechOrderWorkflows.airlitePurchaseOrderOperationId,
              purchaseOrderOperationId
            ),
            isNull(nuTechOrderWorkflows.purchaseOrderReleasedAt)
          )
        )
        .run()
      if (reserved.meta.changes !== 1) {
        throw new Error(AIRLITE_WORKBOOK_CLAIM_LOST_ERROR)
      }
      workbook = await copyAirliteWorkbookOnce({
        client,
        userEmail,
        templateId: catalogVersion.airliteTemplateId,
        name: workbookName,
        parentId: destinationFolderId,
        fingerprint: claimFingerprint,
      })
      const recorded = await access.db
        .update(nuTechOrderWorkflows)
        .set({
          airliteWorkbookId: workbook.id,
          airliteWorkbookUrl:
            workbook.webViewLink ??
            `https://docs.google.com/spreadsheets/d/${workbook.id}/edit`,
          airliteWorkbookProviderStatus: "succeeded",
          updatedAt: new Date().toISOString(),
        })
        .where(
          and(
            eq(nuTechOrderWorkflows.id, workflow.id),
            eq(nuTechOrderWorkflows.airliteWorkbookClaimToken, nextClaimToken),
            eq(
              nuTechOrderWorkflows.airliteWorkbookClaimRevision,
              nextClaimRevision
            ),
            eq(nuTechOrderWorkflows.airliteWorkbookStatus, "generating"),
            eq(
              nuTechOrderWorkflows.airlitePurchaseOrderOperationId,
              purchaseOrderOperationId
            ),
            isNull(nuTechOrderWorkflows.purchaseOrderReleasedAt)
          )
        )
        .run()
      if (recorded.meta.changes !== 1) {
        throw new Error(AIRLITE_WORKBOOK_CLAIM_LOST_ERROR)
      }
      inheritedProviderAttemptUnresolved = false
      providerEffectSucceeded = true
    }
    if (!workbook) throw new Error(AIRLITE_WORKBOOK_PROVIDER_UNRESOLVED_ERROR)
    await runWithAirliteProviderWriteFence({
      ...claim,
      effect: () =>
        sheetsClient.batchUpdateValues(userEmail, {
          spreadsheetId: workbook.id,
          updates: plan.updates,
        }),
    })
    if (plan.addendumValues.length > 0) {
      await runWithAirliteProviderWriteFence({
        ...claim,
        effect: async () => {
          const hasAddendum = async (): Promise<boolean> => {
            const metadata = await sheetsClient.getSpreadsheetMetadata(
              userEmail,
              workbook.id
            )
            return metadata.sheets.some((sheet) => sheet.title === "Compass Addendum")
          }
          if (await hasAddendum()) return
          try {
            await sheetsClient.addSheet(userEmail, {
              spreadsheetId: workbook.id,
              title: "Compass Addendum",
              rowCount: Math.max(100, plan.addendumValues.length + 10),
              columnCount: 8,
            })
          } catch (error) {
            // A timed-out add can still have committed at Google. Reconcile by title
            // before surfacing the failure so a retry never creates a second sheet.
            if (!(await hasAddendum())) throw error
          }
        },
      })
      await runWithAirliteProviderWriteFence({
        ...claim,
        effect: () =>
          sheetsClient.batchUpdateValues(userEmail, {
            spreadsheetId: workbook.id,
            updates: [
              {
                range: `'Compass Addendum'!A1:H${plan.addendumValues.length}`,
                values: plan.addendumValues,
              },
            ],
          }),
      })
    }
    const workbookUrl =
      workbook.webViewLink ??
      `https://docs.google.com/spreadsheets/d/${workbook.id}/edit`
    const completed = await access.db
      .update(nuTechOrderWorkflows)
      .set({
        airliteWorkbookId: workbook.id,
        airliteWorkbookUrl: workbookUrl,
        airliteWorkbookStatus:
          plan.addendumItemCount > 0 ? "generated_with_addendum" : "generated",
        airliteWorkbookClaimToken: null,
        airliteWorkbookClaimReclaimAfter: null,
        airliteWorkbookClaimRetryUntil: null,
        airliteWorkbookClaimError: null,
        airliteWorkbookProviderStatus: "succeeded",
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
      .where(
        and(
          eq(nuTechOrderWorkflows.id, workflow.id),
          eq(nuTechOrderWorkflows.airliteWorkbookClaimToken, nextClaimToken),
          eq(
            nuTechOrderWorkflows.airliteWorkbookClaimRevision,
            nextClaimRevision
          ),
          eq(nuTechOrderWorkflows.airliteWorkbookStatus, "generating"),
          eq(
            nuTechOrderWorkflows.airlitePurchaseOrderOperationId,
            purchaseOrderOperationId
          ),
          isNull(nuTechOrderWorkflows.purchaseOrderReleasedAt)
        )
      )
      .run()
    if (completed.meta.changes !== 1) throw new Error(AIRLITE_WORKBOOK_CLAIM_LOST_ERROR)
    revalidateNuTechOrder(projectId)
    return { success: true, id: workflow.id, workbookUrl }
  } catch (error) {
    const providerAttemptUnresolved =
      inheritedProviderAttemptUnresolved ||
      error instanceof GoogleDriveCopyOutcomeUnknownError ||
      (error instanceof Error &&
        error.message === AIRLITE_WORKBOOK_PROVIDER_UNRESOLVED_ERROR)
    if (
      providerAttemptUnresolved &&
      claimedDb !== null &&
      claimedWorkflowId !== null &&
      claimToken !== null &&
      claimRevision !== null
    ) {
      try {
        await claimedDb
          .update(nuTechOrderWorkflows)
          .set({
            airliteWorkbookClaimError: AIRLITE_WORKBOOK_PROVIDER_UNRESOLVED_ERROR,
            updatedAt: new Date().toISOString(),
          })
          .where(
            and(
              eq(nuTechOrderWorkflows.id, claimedWorkflowId),
              eq(nuTechOrderWorkflows.airliteWorkbookClaimToken, claimToken),
              eq(nuTechOrderWorkflows.airliteWorkbookClaimRevision, claimRevision),
              eq(nuTechOrderWorkflows.airliteWorkbookStatus, "generating"),
              eq(nuTechOrderWorkflows.airliteWorkbookProviderStatus, "in_flight"),
              claimedPurchaseOrderOperationId === null
                ? isNull(nuTechOrderWorkflows.airlitePurchaseOrderOperationId)
                : eq(
                    nuTechOrderWorkflows.airlitePurchaseOrderOperationId,
                    claimedPurchaseOrderOperationId
                  ),
              isNull(nuTechOrderWorkflows.purchaseOrderReleasedAt)
            )
          )
          .run()
      } catch {
        // Keep the provider outcome unresolved even if recording its message fails.
      }
    }
    if (
      providerEffectSucceeded &&
      claimedDb !== null &&
      claimedWorkflowId !== null &&
      claimToken !== null &&
      claimRevision !== null
    ) {
      try {
        await claimedDb
          .update(nuTechOrderWorkflows)
          .set({
            airliteWorkbookClaimError:
              error instanceof Error ? error.message : "Workbook population failed.",
            updatedAt: new Date().toISOString(),
          })
          .where(
            and(
              eq(nuTechOrderWorkflows.id, claimedWorkflowId),
              eq(nuTechOrderWorkflows.airliteWorkbookClaimToken, claimToken),
              eq(nuTechOrderWorkflows.airliteWorkbookClaimRevision, claimRevision),
              eq(nuTechOrderWorkflows.airliteWorkbookStatus, "generating"),
              eq(nuTechOrderWorkflows.airliteWorkbookProviderStatus, "succeeded"),
              claimedPurchaseOrderOperationId === null
                ? isNull(nuTechOrderWorkflows.airlitePurchaseOrderOperationId)
                : eq(
                    nuTechOrderWorkflows.airlitePurchaseOrderOperationId,
                    claimedPurchaseOrderOperationId
                  ),
              isNull(nuTechOrderWorkflows.purchaseOrderReleasedAt)
            )
          )
          .run()
      } catch {
        // Preserve the durable successful provider effect if error recording fails.
      }
    }
    if (
      !providerAttemptUnresolved &&
      !providerEffectSucceeded &&
      claimedDb !== null &&
      claimedWorkflowId !== null &&
      claimToken !== null &&
      claimRevision !== null
    ) {
      try {
        await claimedDb
          .update(nuTechOrderWorkflows)
          .set({
            airliteWorkbookStatus: "stale",
            airliteWorkbookClaimToken: null,
            airliteWorkbookClaimReclaimAfter: null,
            airliteWorkbookProviderStatus: "failed",
            airliteWorkbookClaimError:
              error instanceof Error ? error.message : "Workbook generation failed.",
            updatedAt: new Date().toISOString(),
          })
          .where(
            and(
              eq(nuTechOrderWorkflows.id, claimedWorkflowId),
              eq(nuTechOrderWorkflows.airliteWorkbookClaimToken, claimToken),
              eq(nuTechOrderWorkflows.airliteWorkbookClaimRevision, claimRevision),
              eq(nuTechOrderWorkflows.airliteWorkbookStatus, "generating"),
              claimedPurchaseOrderOperationId === null
                ? isNull(nuTechOrderWorkflows.airlitePurchaseOrderOperationId)
                : eq(
                    nuTechOrderWorkflows.airlitePurchaseOrderOperationId,
                    claimedPurchaseOrderOperationId
                  ),
              isNull(nuTechOrderWorkflows.purchaseOrderReleasedAt)
            )
          )
          .run()
      } catch {
        // Preserve the provider error; a later save can recover the status.
      }
    }
    if (providerAttemptUnresolved) {
      return actionError(
        new Error(AIRLITE_WORKBOOK_PROVIDER_UNRESOLVED_ERROR),
        "Failed to generate the Airlite workbook."
      )
    }
    return actionError(error, "Failed to generate the Airlite workbook.")
  }
}
