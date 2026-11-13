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
import {
  INVOICE_PAID_BY_PAYMENTS_ERROR,
  INVOICE_PAYMENT_HISTORY_ERROR,
  INVOICE_TOTAL_BELOW_PAID_ERROR,
  deriveBillTotals,
  legacyInvoiceEdit,
} from "@/lib/domain/financials/rules"
import { readInvoiceIdsSetByPayments } from "@/lib/domain/financials/receivables"
import { deleteLegacyInvoiceRow, updateLegacyInvoiceRow } from "@/lib/domain/financials/invoice-guards"
import { insertInvoice } from "@/lib/domain/financials/store"

const BILLING_SCOPE_ERROR = "Choose construction or preconstruction billing."
const NOT_FOUND = "Invoice not found or access denied"
const UPDATE_REFUSED = {
  not_found: NOT_FOUND,
  paid_by_payments: INVOICE_PAID_BY_PAYMENTS_ERROR,
  total_below_paid: INVOICE_TOTAL_BELOW_PAID_ERROR,
  has_payment_history: INVOICE_PAYMENT_HISTORY_ERROR,
} as const
const SIMPLE_INVOICE_PAGE = "Open this invoice from the project's Financials page to change, void or delete it."

export async function getInvoices(projectId?: string): Promise<Invoice[]> {
  const { db, organizationId } = await financeReadContext()

  if (projectId) {
    if (!(await isOrganizationProject(db, organizationId, projectId))) {
      throw new Error(PROJECT_NOT_FOUND)
    }
    return db.select().from(invoices).where(eq(invoices.projectId, projectId))
  }

  // join through projects to filter by org
  const rows = await db
    .select({ invoice: invoices })
    .from(invoices)
    .innerJoin(projects, eq(invoices.projectId, projects.id))
    .where(eq(projects.organizationId, organizationId))
  return rows.map((row) => row.invoice)
}

/** Older invoices (Financials editor) whose amount paid and status come from recorded payments. */
export async function getInvoiceIdsSetByPayments(): Promise<string[]> {
  const { db, organizationId } = await financeReadContext()
  return readInvoiceIdsSetByPayments(db, organizationId)
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
        invoiceKind: invoices.invoiceKind,
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
    if (existing.invoiceKind) return { success: false, error: SIMPLE_INVOICE_PAGE }

    // Only the editor's own fields; never ids, kind, sync, email or Square state from the browser.
    const safeData = legacyInvoiceEdit(data)
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
    // Amount paid, status, total and job are fenced inside the write once recorded payments apply.
    const written = await updateLegacyInvoiceRow(db, { id, organizationId }, { ...safeData, ...totals.values, updatedAt: new Date().toISOString() })
    if (written !== "updated") return { success: false, error: UPDATE_REFUSED[written] }

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
      .select({ projectId: invoices.projectId, invoiceKind: invoices.invoiceKind })
      .from(invoices)
      .innerJoin(projects, eq(invoices.projectId, projects.id))
      .where(and(eq(invoices.id, id), eq(projects.organizationId, organizationId)))
      .limit(1)

    if (!existing) {
      return { success: false, error: NOT_FOUND }
    }
    if (existing.invoiceKind) return { success: false, error: SIMPLE_INVOICE_PAGE }

    const deleted = await deleteLegacyInvoiceRow(db, { id, organizationId })
    if (deleted === "not_found") return { success: false, error: NOT_FOUND }
    if (deleted === "has_payment_history") return { success: false, error: INVOICE_PAYMENT_HISTORY_ERROR }

    revalidatePath("/dashboard/financials")
    return { success: true }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to delete invoice",
    }
  }
}
