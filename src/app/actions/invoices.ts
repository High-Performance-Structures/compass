"use server"

import { eq, and } from "drizzle-orm"
import { invoices, type Invoice, type NewInvoice } from "@/db/schema-netsuite"
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
import { deriveBillTotals } from "@/lib/domain/financials/rules"
import { deleteInvoiceRow, insertInvoice, updateInvoiceRow } from "@/lib/domain/financials/store"

const BILLING_SCOPE_ERROR = "Choose construction or preconstruction billing."
const NOT_FOUND = "Invoice not found or access denied"

export async function getInvoices(projectId?: string): Promise<Invoice[]> {
  const { db, organizationId } = await financeReadContext()

  if (projectId) {
    if (!(await isOrganizationProject(db, organizationId, projectId))) {
      throw new Error(PROJECT_NOT_FOUND)
    }
    return db.select().from(invoices).where(eq(invoices.projectId, projectId))
  }

  // join through projects to filter by org
  return db
    .select({
      id: invoices.id,
      netsuiteId: invoices.netsuiteId,
      organizationId: invoices.organizationId,
      customerId: invoices.customerId,
      projectId: invoices.projectId,
      sourceSystem: invoices.sourceSystem,
      sourceExternalId: invoices.sourceExternalId,
      invoiceNumber: invoices.invoiceNumber,
      status: invoices.status,
      issueDate: invoices.issueDate,
      dueDate: invoices.dueDate,
      subtotal: invoices.subtotal,
      tax: invoices.tax,
      total: invoices.total,
      amountPaid: invoices.amountPaid,
      amountDue: invoices.amountDue,
      memo: invoices.memo,
      lineItems: invoices.lineItems,
      billingScope: invoices.billingScope,
      createdAt: invoices.createdAt,
      updatedAt: invoices.updatedAt,
    })
    .from(invoices)
    .innerJoin(projects, eq(invoices.projectId, projects.id))
    .where(eq(projects.organizationId, organizationId))
}

export async function createInvoice(
  data: Omit<NewInvoice, "id" | "createdAt" | "updatedAt">
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
    // Totals come from the lines on the server, never from the client.
    const totals = deriveBillTotals(safeData, null)
    if (!totals.ok) return { success: false, error: totals.error }

    await insertInvoice(db, {
      id,
      ...safeData,
      ...totals.values,
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
      error: err instanceof Error ? err.message : "Failed to create invoice",
    }
  }
}

export async function updateInvoice(
  id: string,
  data: Partial<NewInvoice>
): Promise<ActionDone> {
  try {
    const context = await financeContext("update")
    if (!context.success) return context
    const { db, organizationId } = context.data

    // verify invoice belongs to org via project
    const [existing] = await db
      .select({
        projectId: invoices.projectId,
        lineItems: invoices.lineItems,
        subtotal: invoices.subtotal,
        tax: invoices.tax,
        amountPaid: invoices.amountPaid,
      })
      .from(invoices)
      .innerJoin(projects, eq(invoices.projectId, projects.id))
      .where(and(eq(invoices.id, id), eq(projects.organizationId, organizationId)))
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
    const totals = deriveBillTotals(safeData, existing)
    if (!totals.ok) return { success: false, error: totals.error }
    await updateInvoiceRow(db, id, { ...safeData, ...totals.values, updatedAt: new Date().toISOString() })

    revalidatePath("/dashboard/financials")
    return { success: true }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to update invoice",
    }
  }
}

export async function deleteInvoice(id: string): Promise<ActionDone> {
  try {
    const context = await financeContext("delete")
    if (!context.success) return context
    const { db, organizationId } = context.data

    // verify invoice belongs to org via project
    const [existing] = await db
      .select({ projectId: invoices.projectId })
      .from(invoices)
      .innerJoin(projects, eq(invoices.projectId, projects.id))
      .where(and(eq(invoices.id, id), eq(projects.organizationId, organizationId)))
      .limit(1)

    if (!existing) {
      return { success: false, error: NOT_FOUND }
    }

    await deleteInvoiceRow(db, id)

    revalidatePath("/dashboard/financials")
    return { success: true }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to delete invoice",
    }
  }
}
