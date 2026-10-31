"use server"

import { and, eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import { projectOperations, projects } from "@/db/schema"
import { activityActorName, recordActivityEvent } from "@/lib/activity-log"
import { errorMessage } from "@/lib/action-result"
import { currentDepartmentProfiles } from "@/lib/department-profiles-server"
import { operationsContext } from "@/lib/domain/operations/access"
import {
  countProjectOperations,
  loadProjectOperation,
  loadProjectSageNumbers,
  loadPurchaseOrderFormOptions,
  loadPurchaseOrderLineRows,
  loadPurchaseOrders,
} from "@/lib/domain/operations/queries"
import { toPurchaseOrderItem } from "@/lib/domain/operations/records"
import {
  buildSagePurchaseOrderPayload,
  cleanDate,
  normalizePurchaseOrderLines,
  parseEmailList,
  purchaseOrderHeaderCodes,
  purchaseOrderRequestNumberFor,
  purchaseOrderTotal,
  requireText,
} from "@/lib/domain/operations/rules"
import {
  deleteOperations,
  deletePurchaseOrderLines,
  operationInsertQuery,
  operationUpdateQuery,
  purchaseOrderLineInsertQuery,
  purchaseOrderLinesDeleteQuery,
  updateOperationById,
} from "@/lib/domain/operations/store"
import type {
  CreatePurchaseOrderRequestInput,
  NormalizedPurchaseOrderLine,
  ProjectOperationActionResult,
  ProjectOperationEmailActionResult,
  ProjectPurchaseOrderFormOptions,
  ProjectPurchaseOrderItem,
  SendPurchaseOrderEmailInput,
  UpdatePurchaseOrderRequestInput,
} from "@/lib/domain/operations/types"
import { sendTrackedEmail } from "@/lib/email/tracked-send"
import { releaseNuTechAirlitePoNumber } from "@/lib/nutech/airlite-po-number"
import { nuTechOrderFormAttachments } from "@/lib/nutech/order-form-attachment"
import { markPaperTrailDue, markPaperTrailRemoved } from "@/lib/paper-trail/enqueue"
import { purchaseOrderStatusAfterEmail } from "@/lib/project-operations/status"
import { projectBrandFor } from "@/lib/project-branding"
import { canEditPurchaseOrderDraft } from "@/lib/purchase-orders/draft-edit"
import {
  purchaseOrderCoverEmailHtml,
  purchaseOrderCoverEmailText,
  purchaseOrderEmailHtml,
  purchaseOrderEmailText,
} from "@/lib/purchase-orders/email"
import { withPortalPurchaseOrderRecipients } from "@/lib/purchase-orders/portal-response"
import { resolvedPurchaseOrderShipTo } from "@/lib/purchase-orders/ship-to"
import { orgContext, type Db } from "@/lib/server/action-context"
import { cleanText } from "@/lib/shared/guards"

/*
 * Purchase orders: staff of the project's organization with the
 * "purchase-orders" permission (operations access, "organization" scope).
 * The stored line amounts and header total are computed here from the
 * quantities and unit costs; the browser only previews them.
 */

function revalidatePurchaseOrderPaths(projectId: string): void {
  revalidatePath(`/dashboard/projects/${projectId}`)
  revalidatePath(`/dashboard/projects/${projectId}/purchase-orders`)
  revalidatePath("/dashboard/purchase-orders")
  revalidatePath("/dashboard/financials")
  revalidatePath("/dashboard/schedule")
}

/** Each line is its own statement: D1 allows at most 100 bound values per statement. */
function lineInserts(
  db: Db,
  projectId: string,
  operationId: string,
  lines: readonly NormalizedPurchaseOrderLine[],
  now: string,
): ReturnType<typeof purchaseOrderLineInsertQuery>[] {
  return lines.map((line) =>
    purchaseOrderLineInsertQuery(db, {
      id: crypto.randomUUID(),
      operationId,
      projectId,
      sourceSystem: "compass",
      sourceRecordId: null,
      lineNumber: line.lineNumber,
      costCode: line.costCode,
      phaseCode: line.phaseCode,
      description: line.description,
      quantity: line.quantity,
      unitCost: line.unitCost,
      unit: line.unit,
      amount: line.amount,
      taxGroup: line.taxGroup,
      sagePayloadJson: JSON.stringify(line),
      syncStatus: "pending_sage",
      createdAt: now,
      updatedAt: now,
    }),
  )
}

export async function getProjectPurchaseOrders(projectId: string): Promise<readonly ProjectPurchaseOrderItem[]> {
  const { db, organizationId } = await operationsContext(projectId, "purchase-orders", false)
  return loadPurchaseOrders(db, projectId, organizationId)
}

export async function getProjectPurchaseOrderFormOptions(projectId: string): Promise<ProjectPurchaseOrderFormOptions> {
  const { db } = await operationsContext(projectId, "purchase-orders", false)
  return loadPurchaseOrderFormOptions(db, projectId)
}

export async function createPurchaseOrderRequest(
  projectId: string,
  input: CreatePurchaseOrderRequestInput,
): Promise<ProjectOperationActionResult> {
  try {
    const { db } = await operationsContext(projectId, "purchase-orders", true)
    const [project, purchaseOrderCount] = await Promise.all([
      loadProjectSageNumbers(db, projectId),
      countProjectOperations(db, projectId, ["purchase_order"]),
    ])

    const now = new Date().toISOString()
    const id = crypto.randomUUID()
    const sourceRecordNumber = purchaseOrderRequestNumberFor(project?.projectNumber ?? null, purchaseOrderCount, id)
    const title = requireText(input.title, "Title")
    const description = cleanText(input.description)
    const companyName = cleanText(input.companyName)
    const shipTo = cleanText(input.shipTo)
    const orderDate = cleanText(input.orderDate) ?? now.slice(0, 10)
    const awardedRfqId = cleanText(input.awardedRfqId ?? null)
    if (awardedRfqId !== null && !(await loadProjectOperation(db, projectId, awardedRfqId, "rfq"))) {
      throw new Error("That accepted quote is no longer on this job.")
    }
    const dueDate = cleanText(input.dueDate)
    const sageVendorId = cleanText(input.sageVendorId)
    const lines = normalizePurchaseOrderLines(input.lines, description ?? title)
    const header = purchaseOrderHeaderCodes(lines)
    const sagePayloadJson = JSON.stringify(
      buildSagePurchaseOrderPayload({
        project: project ?? { sageJobId: null, sageJobNumber: null },
        sourceRecordNumber,
        title,
        companyName,
        sageVendorId,
        shipTo,
        orderDate,
        dueDate,
        lines,
      }),
    )

    // The header and its lines are one atomic batch.
    await db.batch([
      operationInsertQuery(db, {
        id,
        projectId,
        sourceSystem: "compass",
        sourceRecordType: "purchase_order",
        sourceRecordNumber,
        title,
        description,
        status: "draft",
        priority: input.priority,
        assigneeType: "vendor",
        assigneeName: cleanText(input.assigneeName),
        siteContactPhone: cleanText(input.siteContactPhone),
        companyName,
        costCode: header.costCode,
        dueDate,
        amount: purchaseOrderTotal(lines),
        sageJobId: project?.sageJobId ?? null,
        sageJobNumber: project?.sageJobNumber ?? null,
        sageVendorId,
        sageVendorName: companyName,
        sagePhaseCode: header.phaseCode,
        sageCostCode: header.costCode,
        sageTaxGroup: header.taxGroup,
        sageShipTo: shipTo,
        sageOrderDate: orderDate,
        sageRequiredDate: dueDate,
        sageWriteStatus: "draft_ready",
        sagePayloadJson,
        syncDirection: "write",
        syncStatus: "pending_sage",
        awardedRfqId,
        createdAt: now,
        updatedAt: now,
      }),
      ...lineInserts(db, projectId, id, lines, now),
    ])
    await markPaperTrailDue(db, { projectId, recordType: "purchase_order", recordId: id })
    revalidatePurchaseOrderPaths(projectId)
    return { success: true, id }
  } catch (error) {
    return { success: false, error: errorMessage(error, "Failed to create purchase order request") }
  }
}

export async function updatePurchaseOrderRequest(
  projectId: string,
  purchaseOrderId: string,
  input: UpdatePurchaseOrderRequestInput,
): Promise<ProjectOperationActionResult> {
  try {
    const { db } = await operationsContext(projectId, "purchase-orders", true)
    const existing = await loadProjectOperation(db, projectId, purchaseOrderId, "purchase_order")
    if (!existing) throw new Error("Purchase order not found")
    if (!canEditPurchaseOrderDraft(existing)) {
      throw new Error("This purchase order can no longer be edited because it was sent or queued for Sage.")
    }
    if (existing.updatedAt !== input.expectedUpdatedAt) {
      throw new Error("This purchase order changed after you opened it. Refresh and try again.")
    }
    if (!existing.sourceRecordNumber) throw new Error("Purchase order number is missing")

    const now = new Date().toISOString()
    const title = requireText(input.title, "Title")
    const description = cleanText(input.description)
    const companyName = cleanText(input.companyName)
    const sageVendorId = cleanText(input.sageVendorId)
    const shipTo = cleanText(input.shipTo)
    const orderDate = cleanDate(input.orderDate, "P.O. date")
    const dueDate = cleanDate(input.dueDate, "Required date")
    const lines = normalizePurchaseOrderLines(input.lines, description ?? title)
    const header = purchaseOrderHeaderCodes(lines)
    const sagePayloadJson = JSON.stringify(
      buildSagePurchaseOrderPayload({
        project: { sageJobId: existing.sageJobId, sageJobNumber: existing.sageJobNumber },
        sourceRecordNumber: existing.sourceRecordNumber,
        title,
        companyName,
        sageVendorId,
        shipTo,
        orderDate,
        dueDate,
        lines,
      }),
    )

    await db.batch([
      operationUpdateQuery(
        db,
        and(
          eq(projectOperations.id, purchaseOrderId),
          eq(projectOperations.projectId, projectId),
          eq(projectOperations.updatedAt, input.expectedUpdatedAt),
        ),
        {
          title,
          description,
          priority: input.priority,
          assigneeName: cleanText(input.assigneeName),
          siteContactPhone: cleanText(input.siteContactPhone),
          companyName,
          costCode: header.costCode,
          dueDate,
          amount: purchaseOrderTotal(lines),
          sageVendorId,
          sageVendorName: companyName,
          sagePhaseCode: header.phaseCode,
          sageCostCode: header.costCode,
          sageTaxGroup: header.taxGroup,
          sageShipTo: shipTo,
          sageOrderDate: orderDate,
          sageRequiredDate: dueDate,
          sagePayloadJson,
          updatedAt: now,
        },
      ),
      purchaseOrderLinesDeleteQuery(db, projectId, purchaseOrderId),
      ...lineInserts(db, projectId, purchaseOrderId, lines, now),
    ])

    await markPaperTrailDue(db, { projectId, recordType: "purchase_order", recordId: purchaseOrderId })
    revalidatePurchaseOrderPaths(projectId)
    return { success: true, id: purchaseOrderId }
  } catch (error) {
    return { success: false, error: errorMessage(error, "Failed to update purchase order request") }
  }
}

export async function deletePurchaseOrderRequest(
  projectId: string,
  purchaseOrderId: string,
): Promise<ProjectOperationActionResult> {
  try {
    const { db } = await operationsContext(projectId, "purchase-orders", true)
    const existing = await loadProjectOperation(db, projectId, purchaseOrderId, "purchase_order")
    if (!existing) return { success: false, error: "Purchase order not found." }

    // A draft never reached the vendor, so its manufacturer PO number can be reused.
    if (existing.status === "draft") await releaseNuTechAirlitePoNumber(db, purchaseOrderId)
    await deletePurchaseOrderLines(db, projectId, purchaseOrderId)
    await deleteOperations(
      db,
      and(
        eq(projectOperations.id, purchaseOrderId),
        eq(projectOperations.projectId, projectId),
        eq(projectOperations.sourceRecordType, "purchase_order"),
      ),
    )

    // The last Drive copy stays as the paper trail of the deleted order.
    await markPaperTrailRemoved(db, { recordType: "purchase_order", recordId: purchaseOrderId })
    revalidatePath(`/dashboard/projects/${projectId}`)
    revalidatePath(`/dashboard/projects/${projectId}/purchase-orders`)
    revalidatePath(`/dashboard/projects/${projectId}/financials`)
    revalidatePath("/dashboard")
    revalidatePath("/dashboard/purchase-orders")
    revalidatePath("/dashboard/financials")
    revalidatePath("/dashboard/schedule")
    return { success: true, id: purchaseOrderId }
  } catch (error) {
    return { success: false, error: errorMessage(error, "Failed to delete purchase order") }
  }
}

export async function sendPurchaseOrderEmail(
  projectId: string,
  purchaseOrderId: string,
  input: SendPurchaseOrderEmailInput,
): Promise<ProjectOperationEmailActionResult> {
  try {
    // No demo refusal here before, so this is not a "mutation" context, and
    // the project check keeps its own "Project not found." message.
    const context = await orgContext({ feature: "purchase-orders", action: "update" })
    if (!context.success) throw new Error(context.error)
    const { db, env, user, organizationId: orgId } = context.data
    const to = parseEmailList(input.to)
    const cc = parseEmailList(input.cc)
    const subject = requireText(input.subject, "Subject")
    const message = requireText(input.message, "Message")
    if (to.length === 0) {
      return { success: false, error: "Enter at least one supplier email." }
    }

    const [project] = await db
      .select({ id: projects.id, name: projects.name, projectNumber: projects.projectNumber, address: projects.address })
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.organizationId, orgId)))
      .limit(1)
    if (!project) return { success: false, error: "Project not found." }

    const operation = await loadProjectOperation(db, projectId, purchaseOrderId, "purchase_order")
    if (!operation) return { success: false, error: "Purchase order not found." }

    const lineRows = await loadPurchaseOrderLineRows(db, [purchaseOrderId])
    const order = toPurchaseOrderItem(operation, lineRows, { address: null, email: null })
    const senderName = user.displayName ?? user.email
    const profiles = await currentDepartmentProfiles()
    const brand = projectBrandFor({ profiles, projectId: project.id, projectNumber: project.projectNumber })
    const emailInput = {
      brand,
      projectName: project.name,
      projectNumber: project.projectNumber,
      senderName,
      message,
      deliveryLocation: resolvedPurchaseOrderShipTo({ storedShipTo: order.sageShipTo, jobsiteAddress: project.address }),
      order,
    }
    // The manufacturer's PO goes out on its own filled order form, with a
    // cover note in place of the Compass PO layout.
    const orderForm = await nuTechOrderFormAttachments({
      db,
      environment: env,
      organizationId: orgId,
      user,
      purchaseOrderId,
      purchaseOrderNumber: operation.sourceRecordNumber,
    })
    // Sent through the company's Google Workspace like every other Compass
    // email, from the department's shared mailbox when one is set.
    const departmentProfile = profiles[brand.department]
    // Supplier replies come back onto this PO. The department mailbox (or the
    // sender, when there is none) still gets them directly too.
    const delivery = await sendTrackedEmail({
      env,
      db,
      organizationId: orgId,
      projectId,
      kind: "purchase_order",
      recordId: purchaseOrderId,
      recordLabel: operation.sourceRecordNumber,
      createdBy: user.id,
      to,
      cc,
      subject,
      text: orderForm ? purchaseOrderCoverEmailText(emailInput) : purchaseOrderEmailText(emailInput),
      html: orderForm ? purchaseOrderCoverEmailHtml(emailInput) : purchaseOrderEmailHtml(emailInput),
      replyName: `${departmentProfile.senderName || departmentProfile.companyName || senderName} - ${operation.sourceRecordNumber ?? "Purchase order"}`,
      alsoReplyTo: [departmentProfile.senderAddress || user.email],
      attachments: orderForm ?? [],
      sender: departmentProfile.senderAddress
        ? { address: departmentProfile.senderAddress, name: departmentProfile.senderName || departmentProfile.companyName }
        : undefined,
    })

    // Only a delivered email moves the PO to "sent".
    if (delivery.status !== "sent") {
      return {
        success: false,
        error: `The purchase order email was not sent: ${delivery.error ?? delivery.status}`,
      }
    }

    await updateOperationById(db, purchaseOrderId, {
      status: purchaseOrderStatusAfterEmail(operation.status),
      sagePayloadJson: withPortalPurchaseOrderRecipients(operation.sagePayloadJson, [...to, ...cc]),
      updatedAt: new Date().toISOString(),
    })
    // Freeze a dated copy of exactly what the vendor received.
    await markPaperTrailDue(db, { projectId, recordType: "purchase_order", recordId: purchaseOrderId, milestone: "sent" })
    await recordActivityEvent({
      db,
      organizationId: orgId,
      projectId,
      actor: user,
      category: "email",
      action: "purchase_order_emailed",
      entityType: "project_operation",
      entityId: purchaseOrderId,
      summary: `Emailed ${operation.sourceRecordNumber ?? "purchase order"} ${operation.title} to ${[...to, ...cc].join(", ")}.`,
      metadata: { recipients: to.length + cc.length, orderForm: orderForm !== null, sentBy: activityActorName(user) },
    })

    revalidatePath(`/dashboard/projects/${projectId}`)
    revalidatePath(`/dashboard/projects/${projectId}/purchase-orders`)
    revalidatePath("/dashboard/purchase-orders")
    return { success: true, status: delivery.status, providerMessageId: delivery.providerMessageId }
  } catch (error) {
    return { success: false, error: errorMessage(error, "Unable to send purchase order email.") }
  }
}
