"use server"

import { and, asc, desc, eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import { getDb } from "@/db"
import {
  projectChangeOrderDocuments,
  projectChangeOrderHistory,
  projectChangeOrders,
  projectMembers,
} from "@/db/schema"
import { requireAuth, type AuthUser } from "@/lib/auth"
import {
  allowedChangeOrderTransitions,
  canEditChangeOrderContent,
  canTransitionChangeOrder,
  isChangeOrderStatus,
  isExternallyPublishedChangeOrderStatus,
  type ChangeOrderStatus,
} from "@/lib/change-orders/status"
import {
  canViewChangeOrder,
  changeOrderRequesterType,
  type ChangeOrderRequesterType,
} from "@/lib/change-orders/access"
import { getCloudflareContext } from "@/lib/db"
import {
  canFeature,
  requireFeaturePermission,
} from "@/lib/permission-enforcement"
import { assertProjectAccess } from "@/lib/project-access"
import type { ProjectAudience } from "@/lib/project-audience-access"
import { isInternalStaffRole } from "@/lib/user-roles"

export type ChangeOrderAudience = "internal" | "owner" | "sub_vendor"
export type ChangeOrderDocumentInput = {
  readonly label: string
  readonly url: string
  readonly notes: string | null
}

export type ProjectChangeOrderItem = {
  readonly id: string
  readonly projectId: string
  readonly changeOrderNumber: string
  readonly title: string
  readonly scope: string
  readonly reason: string | null
  readonly amountCents: number | null
  readonly status: ChangeOrderStatus
  readonly audience: ChangeOrderAudience
  readonly requesterType: ChangeOrderRequesterType
  readonly requesterUserId: string | null
  readonly requesterName: string
  readonly requesterCompany: string | null
  readonly sourceType: string
  readonly sourceRecordId: string | null
  readonly sourceHref: string | null
  readonly internalNotes: string | null
  readonly foxitStatus: string
  readonly sageStatus: string
  readonly submittedAt: string | null
  readonly createdAt: string
  readonly updatedAt: string
  readonly canEdit: boolean
  readonly canApprove: boolean
  readonly allowedTransitions: readonly ChangeOrderStatus[]
  readonly documents: readonly {
    readonly id: string
    readonly label: string
    readonly url: string
    readonly notes: string | null
  }[]
  readonly history: readonly {
    readonly id: string
    readonly eventType: string
    readonly fromStatus: string | null
    readonly toStatus: string | null
    readonly actorName: string
    readonly actorRole: string
    readonly note: string | null
    readonly createdAt: string
  }[]
}

export type CreateProjectChangeOrderInput = {
  readonly title: string
  readonly scope: string
  readonly reason: string | null
  readonly amountCents: number | null
  readonly audience: ChangeOrderAudience
  readonly requesterCompany: string | null
  readonly sourceRecordId: string | null
  readonly sourceHref: string | null
  readonly initialStatus: "draft" | "submitted"
  readonly documents: readonly ChangeOrderDocumentInput[]
}

export type UpdateProjectChangeOrderInput = {
  readonly title: string
  readonly scope: string
  readonly reason: string | null
  readonly amountCents: number | null
  readonly audience: ChangeOrderAudience
  readonly internalNotes: string | null
  readonly status: ChangeOrderStatus
  readonly transitionNote: string | null
  readonly documents: readonly ChangeOrderDocumentInput[]
}

type ChangeOrderContext = {
  readonly db: ReturnType<typeof getDb>
  readonly user: AuthUser
  readonly projectNumber: string | null
  readonly projectRole: string | null
  readonly internal: boolean
  readonly canUpdate: boolean
  readonly canApprove: boolean
  readonly requesterType: ChangeOrderRequesterType | null
}

type ChangeOrderActionResult =
  | { readonly success: true; readonly id: string }
  | { readonly success: false; readonly error: string }

function cleanText(value: string | null): string | null {
  const trimmed = value?.trim() ?? ""
  return trimmed.length > 0 ? trimmed : null
}

function requireText(value: string, label: string, maxLength = 10_000): string {
  const cleaned = cleanText(value)
  if (!cleaned) throw new Error(`${label} is required`)
  if (cleaned.length > maxLength) {
    throw new Error(`${label} must be ${maxLength} characters or fewer`)
  }
  return cleaned
}

function cleanLimitedText(
  value: string | null,
  label: string,
  maxLength: number
): string | null {
  const cleaned = cleanText(value)
  if (!cleaned) return null
  if (cleaned.length > maxLength) {
    throw new Error(`${label} must be ${maxLength} characters or fewer`)
  }
  return cleaned
}

function validAudience(value: string): value is ChangeOrderAudience {
  return ["internal", "owner", "sub_vendor"].includes(value)
}

function cleanAmountCents(value: number | null): number | null {
  if (value === null) return null
  if (!Number.isFinite(value)) throw new Error("Requested amount is invalid")
  const cents = Math.round(value)
  if (!Number.isSafeInteger(cents) || Math.abs(cents) > 1_000_000_000_000) {
    throw new Error("Requested amount is outside the supported range")
  }
  return cents
}

function safeDocumentUrl(value: string): string {
  const cleaned = requireText(value, "Document URL", 2_048)
  const parsed = new URL(cleaned)
  if (!["https:", "http:"].includes(parsed.protocol)) {
    throw new Error("Document links must use HTTP or HTTPS")
  }
  return parsed.toString()
}

function cleanDocuments(
  documents: readonly ChangeOrderDocumentInput[]
): readonly ChangeOrderDocumentInput[] {
  if (documents.length > 20) {
    throw new Error("A change order can have at most 20 document links")
  }
  return documents
    .filter((document) => cleanText(document.url) !== null)
    .map((document) => ({
      label: document.label.trim()
        ? requireText(document.label, "Document label", 200)
        : "Supporting document",
      url: safeDocumentUrl(document.url),
      notes: cleanLimitedText(document.notes, "Document notes", 1_000),
    }))
}

async function changeOrderContext(
  projectId: string,
  action: "create" | "read" | "update"
): Promise<ChangeOrderContext> {
  const user = await requireAuth()
  await requireFeaturePermission(user, "change-orders", action)
  const { env } = await getCloudflareContext()
  const db = getDb(env.DB)
  const project = await assertProjectAccess(db, user, projectId)
  const membership = await db
    .select({ role: projectMembers.role })
    .from(projectMembers)
    .where(
      and(
        eq(projectMembers.projectId, projectId),
        eq(projectMembers.userId, user.id)
      )
    )
    .get()
  const internal = isInternalStaffRole(user.role)
  const projectRole = membership?.role ?? null
  const canApprove =
    internal && (await canFeature(user, "change-orders", "approve"))
  const canUpdate =
    internal && (await canFeature(user, "change-orders", "update"))

  return {
    db,
    user,
    projectNumber: project.projectNumber,
    projectRole,
    internal,
    canUpdate,
    canApprove,
    requesterType: changeOrderRequesterType({ internal, projectRole }),
  }
}

function canExternalViewerSee(
  row: typeof projectChangeOrders.$inferSelect,
  context: ChangeOrderContext
): boolean {
  if (!isChangeOrderStatus(row.status)) return false
  return canViewChangeOrder({
    internal: context.internal,
    viewerId: context.user.id,
    viewerRequesterType: context.requesterType,
    requesterUserId: row.requesterUserId,
    audience: row.audience,
    status: row.status,
  })
}

function audiencePreviewContext(
  context: ChangeOrderContext,
  audience: ProjectAudience | undefined
): ChangeOrderContext {
  if (!context.internal || !audience) return context
  return {
    ...context,
    internal: false,
    canUpdate: false,
    canApprove: false,
    requesterType: audience === "owner" ? "owner" : "subcontractor",
  }
}

function revalidateChangeOrderPaths(projectId: string): void {
  revalidatePath(`/dashboard/projects/${projectId}`)
  revalidatePath(`/dashboard/projects/${projectId}/change-orders`)
  revalidatePath(`/preview/projects/${projectId}/owner/change-orders`)
  revalidatePath(`/preview/projects/${projectId}/sub-vendor/change-orders`)
}

function changeOrderNumber(
  projectNumber: string | null,
  count: number
): string {
  const prefix = cleanText(projectNumber) ?? "PROJECT"
  return `${prefix}-CO-${String(count + 1).padStart(3, "0")}`
}

function actorName(user: AuthUser): string {
  return user.displayName ?? user.email
}

function viewModel(
  row: typeof projectChangeOrders.$inferSelect,
  context: ChangeOrderContext,
  documents: ProjectChangeOrderItem["documents"],
  history: ProjectChangeOrderItem["history"]
): ProjectChangeOrderItem | null {
  if (
    !isChangeOrderStatus(row.status) ||
    !validAudience(row.audience) ||
    !["internal", "owner", "subcontractor"].includes(row.requesterType)
  ) {
    return null
  }
  const requesterType =
    row.requesterType === "owner"
      ? "owner"
      : row.requesterType === "subcontractor"
        ? "subcontractor"
        : "internal"
  const status = row.status
  const isRequester = row.requesterUserId === context.user.id
  const canApprove = context.canApprove
  const canEdit =
    (!context.internal || context.canUpdate) &&
    canEditChangeOrderContent({
      status,
      internal: context.internal,
      isRequester,
    })
  const transitions =
    context.internal && !context.canUpdate
      ? []
      : allowedChangeOrderTransitions(status).filter((to) =>
          canTransitionChangeOrder({
            from: status,
            to,
            internal: context.internal,
            canApprove,
          })
        )

  return {
    id: row.id,
    projectId: row.projectId,
    changeOrderNumber: row.changeOrderNumber,
    title: row.title,
    scope: row.scope,
    reason: row.reason,
    amountCents: row.amountCents,
    status,
    audience: row.audience,
    requesterType,
    requesterUserId: row.requesterUserId,
    requesterName: row.requesterName,
    requesterCompany: row.requesterCompany,
    sourceType: row.sourceType,
    sourceRecordId: context.internal ? row.sourceRecordId : null,
    sourceHref: context.internal ? row.sourceHref : null,
    internalNotes: context.internal ? row.internalNotes : null,
    foxitStatus: row.foxitStatus,
    sageStatus: row.sageStatus,
    submittedAt: row.submittedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    canEdit,
    canApprove,
    allowedTransitions: transitions.filter((status) => status !== "synced"),
    documents,
    history,
  }
}

export async function getProjectChangeOrders(
  projectId: string,
  viewAsAudience?: ProjectAudience
): Promise<readonly ProjectChangeOrderItem[]> {
  const authorizedContext = await changeOrderContext(projectId, "read")
  const context = audiencePreviewContext(authorizedContext, viewAsAudience)
  const rows = await authorizedContext.db
    .select()
    .from(projectChangeOrders)
    .where(eq(projectChangeOrders.projectId, projectId))
    .orderBy(desc(projectChangeOrders.updatedAt))

  return rows
    .filter((row) => canExternalViewerSee(row, context))
    .map((row) => viewModel(row, context, [], []))
    .filter((row): row is ProjectChangeOrderItem => row !== null)
}

export async function getProjectChangeOrderCapabilities(
  projectId: string
): Promise<{
  readonly canCreate: boolean
  readonly requesterType: ChangeOrderRequesterType | null
}> {
  const context = await changeOrderContext(projectId, "read")
  const createAllowed = await canFeature(
    context.user,
    "change-orders",
    "create"
  )
  return {
    canCreate: createAllowed && context.requesterType !== null,
    requesterType: context.requesterType,
  }
}

export async function getProjectChangeOrder(
  projectId: string,
  changeOrderId: string,
  viewAsAudience?: ProjectAudience
): Promise<ProjectChangeOrderItem | null> {
  const authorizedContext = await changeOrderContext(projectId, "read")
  const context = audiencePreviewContext(authorizedContext, viewAsAudience)
  const row = await authorizedContext.db
    .select()
    .from(projectChangeOrders)
    .where(
      and(
        eq(projectChangeOrders.id, changeOrderId),
        eq(projectChangeOrders.projectId, projectId)
      )
    )
    .get()
  if (!row || !canExternalViewerSee(row, context)) return null

  const [documentRows, historyRows] = await Promise.all([
    authorizedContext.db
      .select({
        id: projectChangeOrderDocuments.id,
        label: projectChangeOrderDocuments.label,
        url: projectChangeOrderDocuments.url,
        notes: projectChangeOrderDocuments.notes,
      })
      .from(projectChangeOrderDocuments)
      .where(eq(projectChangeOrderDocuments.changeOrderId, changeOrderId))
      .orderBy(asc(projectChangeOrderDocuments.createdAt)),
    authorizedContext.db
      .select({
        id: projectChangeOrderHistory.id,
        eventType: projectChangeOrderHistory.eventType,
        fromStatus: projectChangeOrderHistory.fromStatus,
        toStatus: projectChangeOrderHistory.toStatus,
        actorName: projectChangeOrderHistory.actorName,
        actorRole: projectChangeOrderHistory.actorRole,
        actorUserId: projectChangeOrderHistory.actorUserId,
        note: projectChangeOrderHistory.note,
        createdAt: projectChangeOrderHistory.createdAt,
      })
      .from(projectChangeOrderHistory)
      .where(eq(projectChangeOrderHistory.changeOrderId, changeOrderId))
      .orderBy(desc(projectChangeOrderHistory.createdAt)),
  ])

  const visibleHistory = context.internal
    ? historyRows
    : historyRows
        .filter((event) => {
          if (row.requesterUserId === context.user.id) return true
          return (
            event.toStatus !== null &&
            isChangeOrderStatus(event.toStatus) &&
            isExternallyPublishedChangeOrderStatus(event.toStatus)
          )
        })
        .map((event) => ({
          ...event,
          // Transition notes are internal by default. External requesters see
          // their own notes plus explicit requests for more information.
          note:
            event.actorUserId === context.user.id ||
            event.toStatus === "needs_information"
              ? event.note
              : null,
        }))

  return viewModel(row, context, documentRows, visibleHistory)
}

export async function createProjectChangeOrder(
  projectId: string,
  input: CreateProjectChangeOrderInput
): Promise<ChangeOrderActionResult> {
  try {
    const context = await changeOrderContext(projectId, "create")
    if (!context.requesterType) {
      return {
        success: false,
        error: "Only internal staff, owners, and subcontractors can request changes.",
      }
    }
    const existing = await context.db
      .select({ id: projectChangeOrders.id })
      .from(projectChangeOrders)
      .where(eq(projectChangeOrders.projectId, projectId))
    const now = new Date().toISOString()
    const id = crypto.randomUUID()
    const internal = context.internal
    const requestedInitialStatus =
      input.initialStatus === "submitted" ? "submitted" : "draft"
    const status: ChangeOrderStatus = internal
      ? requestedInitialStatus
      : "submitted"
    const audience: ChangeOrderAudience = internal
      ? input.audience
      : context.requesterType === "owner"
        ? "owner"
        : "sub_vendor"
    if (!validAudience(audience)) {
      return { success: false, error: "Choose a valid audience." }
    }
    const documents = cleanDocuments(input.documents)
    const sourceType =
      context.requesterType === "owner"
        ? "owner_request"
        : context.requesterType === "subcontractor"
          ? "subcontractor_request"
          : "internal_request"
    const row: typeof projectChangeOrders.$inferInsert = {
      id,
      projectId,
      changeOrderNumber: changeOrderNumber(
        context.projectNumber,
        existing.length
      ),
      title: requireText(input.title, "Title", 200),
      scope: requireText(input.scope, "Scope", 10_000),
      reason: cleanLimitedText(input.reason, "Reason", 4_000),
      amountCents: cleanAmountCents(input.amountCents),
      status,
      audience,
      requesterType: context.requesterType,
      requesterUserId: context.user.id,
      requesterName: actorName(context.user),
      requesterCompany: input.requesterCompany
        ? requireText(input.requesterCompany, "Company", 200)
        : null,
      sourceType,
      sourceRecordId: cleanText(input.sourceRecordId),
      sourceHref: input.sourceHref ? safeDocumentUrl(input.sourceHref) : null,
      internalNotes: null,
      foxitStatus: "not_started",
      sageStatus: "not_ready",
      createdBy: context.user.id,
      submittedAt: status === "submitted" ? now : null,
      createdAt: now,
      updatedAt: now,
    }
    const documentRows = documents.map((document) => ({
      id: crypto.randomUUID(),
      projectId,
      changeOrderId: id,
      label: document.label,
      url: document.url,
      notes: document.notes,
      createdBy: context.user.id,
      createdAt: now,
    }))
    const historyRow = {
      id: crypto.randomUUID(),
      projectId,
      changeOrderId: id,
      eventType: "created",
      fromStatus: null,
      toStatus: status,
      actorUserId: context.user.id,
      actorName: actorName(context.user),
      actorRole: context.user.role,
      note: null,
      metadataJson: JSON.stringify({ audience, sourceType }),
      createdAt: now,
    }

    if (documentRows.length > 0) {
      await context.db.batch([
        context.db.insert(projectChangeOrders).values(row),
        context.db.insert(projectChangeOrderDocuments).values(documentRows),
        context.db.insert(projectChangeOrderHistory).values(historyRow),
      ])
    } else {
      await context.db.batch([
        context.db.insert(projectChangeOrders).values(row),
        context.db.insert(projectChangeOrderHistory).values(historyRow),
      ])
    }
    revalidateChangeOrderPaths(projectId)
    return { success: true, id }
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to create change order request",
    }
  }
}

export async function updateProjectChangeOrder(
  projectId: string,
  changeOrderId: string,
  input: UpdateProjectChangeOrderInput
): Promise<ChangeOrderActionResult> {
  try {
    const context = await changeOrderContext(projectId, "read")
    if (context.internal) {
      await requireFeaturePermission(context.user, "change-orders", "update")
    }
    const existing = await context.db
      .select()
      .from(projectChangeOrders)
      .where(
        and(
          eq(projectChangeOrders.id, changeOrderId),
          eq(projectChangeOrders.projectId, projectId)
        )
      )
      .get()
    if (
      !existing ||
      !canExternalViewerSee(existing, context) ||
      !isChangeOrderStatus(existing.status)
    ) {
      return { success: false, error: "Change order request not found." }
    }
    const isRequester = existing.requesterUserId === context.user.id
    const contentAllowed = canEditChangeOrderContent({
      status: existing.status,
      internal: context.internal,
      isRequester,
    })
    if (!isChangeOrderStatus(input.status)) {
      return { success: false, error: "Choose a valid status." }
    }
    const statusChanged = input.status !== existing.status
    const canApprove = context.canApprove
    if (
      statusChanged &&
      !canTransitionChangeOrder({
        from: existing.status,
        to: input.status,
        internal: context.internal,
        canApprove,
      })
    ) {
      return { success: false, error: "That status transition is not allowed." }
    }
    if (input.status === "synced") {
      return {
        success: false,
        error: "Sage sync must be completed by the future approved connector.",
      }
    }
    const audience = context.internal ? input.audience : existing.audience
    if (!validAudience(audience)) {
      return { success: false, error: "Choose a valid audience." }
    }
    const now = new Date().toISOString()
    const documents = contentAllowed ? cleanDocuments(input.documents) : null
    const title = contentAllowed
      ? requireText(input.title, "Title", 200)
      : existing.title
    const scope = contentAllowed
      ? requireText(input.scope, "Scope", 10_000)
      : existing.scope
    const reason = contentAllowed
      ? cleanLimitedText(input.reason, "Reason", 4_000)
      : existing.reason
    const amountCents = contentAllowed
      ? cleanAmountCents(input.amountCents)
      : existing.amountCents
    const updateStatement = context.db
      .update(projectChangeOrders)
      .set({
        title,
        scope,
        reason,
        amountCents,
        audience: contentAllowed ? audience : existing.audience,
        internalNotes: context.internal
          ? cleanLimitedText(input.internalNotes, "Internal notes", 4_000)
          : existing.internalNotes,
        status: input.status,
        submittedAt:
          input.status === "submitted"
            ? existing.submittedAt ?? now
            : existing.submittedAt,
        foxitStatus:
          input.status === "signature_pending"
            ? "handoff_ready"
            : existing.foxitStatus,
        executedAt:
          input.status === "executed" ? existing.executedAt ?? now : existing.executedAt,
        sageStatus:
          input.status === "sage_pending"
            ? "pending_manual_sync"
            : existing.sageStatus,
        updatedAt: now,
      })
      .where(
        and(
          eq(projectChangeOrders.id, changeOrderId),
          eq(projectChangeOrders.projectId, projectId)
        )
      )
    const historyStatement = context.db
      .insert(projectChangeOrderHistory)
      .values({
        id: crypto.randomUUID(),
        projectId,
        changeOrderId,
        eventType: statusChanged ? "status_transition" : "updated",
        fromStatus: existing.status,
        toStatus: input.status,
        actorUserId: context.user.id,
        actorName: actorName(context.user),
        actorRole: context.user.role,
        note: cleanLimitedText(
          input.transitionNote,
          "Transition note",
          2_000
        ),
        metadataJson: JSON.stringify({
          audience: contentAllowed ? audience : existing.audience,
          documentCount: documents?.length ?? null,
        }),
        createdAt: now,
      })
    if (documents === null) {
      await context.db.batch([updateStatement, historyStatement])
    } else {
      const deleteDocumentsStatement = context.db
        .delete(projectChangeOrderDocuments)
        .where(
          and(
            eq(projectChangeOrderDocuments.changeOrderId, changeOrderId),
            eq(projectChangeOrderDocuments.projectId, projectId)
          )
        )
      if (documents.length === 0) {
        await context.db.batch([
          updateStatement,
          deleteDocumentsStatement,
          historyStatement,
        ])
      } else {
        const insertDocumentsStatement = context.db
          .insert(projectChangeOrderDocuments)
          .values(
            documents.map((document) => ({
            id: crypto.randomUUID(),
            projectId,
            changeOrderId,
            label: document.label,
            url: document.url,
            notes: document.notes,
            createdBy: context.user.id,
            createdAt: now,
          }))
          )
        await context.db.batch([
          updateStatement,
          deleteDocumentsStatement,
          insertDocumentsStatement,
          historyStatement,
        ])
      }
    }
    revalidateChangeOrderPaths(projectId)
    return { success: true, id: changeOrderId }
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to update change order request",
    }
  }
}
