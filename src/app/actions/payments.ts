"use server"

import { eq, and } from "drizzle-orm"
import { payments, type NewPayment, type Payment } from "@/db/schema-netsuite"
import { projects } from "@/db/schema"
import { revalidatePath } from "next/cache"
import type { ActionDone, ActionFailure } from "@/lib/action-result"
import { omitOwnerArSourceFields } from "@/lib/financials/owner-ar"
import { isBillingScope } from "@/lib/financials/billing-scope"
import {
  financeContext,
  financeReadContext,
  isOrganizationProject,
  PROJECT_NOT_FOUND,
} from "@/lib/domain/financials/access"
import { deletePaymentRow, insertPayment, updatePaymentRow } from "@/lib/domain/financials/store"

const BILLING_SCOPE_ERROR = "Choose construction or preconstruction billing."
const NOT_FOUND = "Payment not found or access denied"

export async function getPayments(): Promise<Payment[]> {
  const { db, organizationId } = await financeReadContext()

  // join through projects to filter by org
  return db
    .select({
      id: payments.id,
      netsuiteId: payments.netsuiteId,
      organizationId: payments.organizationId,
      customerId: payments.customerId,
      vendorId: payments.vendorId,
      projectId: payments.projectId,
      sourceSystem: payments.sourceSystem,
      sourceExternalId: payments.sourceExternalId,
      paymentType: payments.paymentType,
      amount: payments.amount,
      grossAmountCents: payments.grossAmountCents,
      processingFeeCents: payments.processingFeeCents,
      netAmountCents: payments.netAmountCents,
      cashReceipt: payments.cashReceipt,
      paymentDate: payments.paymentDate,
      paymentMethod: payments.paymentMethod,
      referenceNumber: payments.referenceNumber,
      memo: payments.memo,
      billingScope: payments.billingScope,
      createdAt: payments.createdAt,
      updatedAt: payments.updatedAt,
    })
    .from(payments)
    .innerJoin(projects, eq(payments.projectId, projects.id))
    .where(eq(projects.organizationId, organizationId))
}

export async function createPayment(
  data: Omit<NewPayment, "id" | "createdAt" | "updatedAt">
): Promise<{ readonly success: true; readonly id: string } | ActionFailure> {
  try {
    const context = await financeContext("create")
    if (!context.success) return context
    const { db, organizationId } = context.data

    // verify project belongs to org if provided
    if (data.projectId && !(await isOrganizationProject(db, organizationId, data.projectId))) {
      return { success: false, error: PROJECT_NOT_FOUND }
    }

    const now = new Date().toISOString()
    const id = crypto.randomUUID()
    const safeData = omitOwnerArSourceFields(data)
    if (safeData.billingScope !== undefined && !isBillingScope(safeData.billingScope)) {
      return { success: false, error: BILLING_SCOPE_ERROR }
    }

    await insertPayment(db, {
      id,
      ...safeData,
      organizationId,
      sourceSystem: "compass",
      createdAt: now,
      updatedAt: now,
    })

    revalidatePath("/dashboard/financials")
    return { success: true, id }
  } catch (err) {
    return {
      success: false,
      error:
        err instanceof Error ? err.message : "Failed to create payment",
    }
  }
}

export async function updatePayment(
  id: string,
  data: Partial<NewPayment>
): Promise<ActionDone> {
  try {
    const context = await financeContext("update")
    if (!context.success) return context
    const { db, organizationId } = context.data

    // verify payment belongs to org via project
    const [existing] = await db
      .select({ projectId: payments.projectId })
      .from(payments)
      .innerJoin(projects, eq(payments.projectId, projects.id))
      .where(and(eq(payments.id, id), eq(projects.organizationId, organizationId)))
      .limit(1)

    if (!existing) {
      return { success: false, error: NOT_FOUND }
    }

    const safeData = omitOwnerArSourceFields(data)
    if (safeData.billingScope !== undefined && !isBillingScope(safeData.billingScope)) {
      return { success: false, error: BILLING_SCOPE_ERROR }
    }
    if (
      safeData.projectId !== undefined &&
      safeData.projectId !== null &&
      safeData.projectId !== existing.projectId &&
      !(await isOrganizationProject(db, organizationId, safeData.projectId))
    ) {
      return { success: false, error: PROJECT_NOT_FOUND }
    }
    await updatePaymentRow(db, id, { ...safeData, updatedAt: new Date().toISOString() })

    revalidatePath("/dashboard/financials")
    return { success: true }
  } catch (err) {
    return {
      success: false,
      error:
        err instanceof Error ? err.message : "Failed to update payment",
    }
  }
}

export async function deletePayment(id: string): Promise<ActionDone> {
  try {
    const context = await financeContext("delete")
    if (!context.success) return context
    const { db, organizationId } = context.data

    // verify payment belongs to org via project
    const [existing] = await db
      .select({ projectId: payments.projectId })
      .from(payments)
      .innerJoin(projects, eq(payments.projectId, projects.id))
      .where(and(eq(payments.id, id), eq(projects.organizationId, organizationId)))
      .limit(1)

    if (!existing) {
      return { success: false, error: NOT_FOUND }
    }

    await deletePaymentRow(db, id)

    revalidatePath("/dashboard/financials")
    return { success: true }
  } catch (err) {
    return {
      success: false,
      error:
        err instanceof Error ? err.message : "Failed to delete payment",
    }
  }
}
