"use server"

import { eq, and } from "drizzle-orm"
import { vendorBills, type NewVendorBill, type VendorBill } from "@/db/schema-netsuite"
import { projects } from "@/db/schema"
import { revalidatePath } from "next/cache"
import type { ActionDone, ActionFailure } from "@/lib/action-result"
import {
  financeContext,
  financeReadContext,
  isOrganizationProject,
  PROJECT_NOT_FOUND,
} from "@/lib/domain/financials/access"
import { deriveBillTotals } from "@/lib/domain/financials/rules"
import { deleteVendorBillRow, insertVendorBill, updateVendorBillRow } from "@/lib/domain/financials/store"

const NOT_FOUND = "Bill not found or access denied"

export async function getVendorBills(projectId?: string): Promise<VendorBill[]> {
  const { db, organizationId } = await financeReadContext()

  if (projectId) {
    if (!(await isOrganizationProject(db, organizationId, projectId))) {
      throw new Error(PROJECT_NOT_FOUND)
    }
    return db.select().from(vendorBills).where(eq(vendorBills.projectId, projectId))
  }

  // join through projects to filter by org
  return db
    .select({
      id: vendorBills.id,
      netsuiteId: vendorBills.netsuiteId,
      vendorId: vendorBills.vendorId,
      projectId: vendorBills.projectId,
      billNumber: vendorBills.billNumber,
      status: vendorBills.status,
      billDate: vendorBills.billDate,
      dueDate: vendorBills.dueDate,
      subtotal: vendorBills.subtotal,
      tax: vendorBills.tax,
      total: vendorBills.total,
      amountPaid: vendorBills.amountPaid,
      amountDue: vendorBills.amountDue,
      memo: vendorBills.memo,
      lineItems: vendorBills.lineItems,
      createdAt: vendorBills.createdAt,
      updatedAt: vendorBills.updatedAt,
    })
    .from(vendorBills)
    .innerJoin(projects, eq(vendorBills.projectId, projects.id))
    .where(eq(projects.organizationId, organizationId))
}

export async function createVendorBill(
  data: Omit<NewVendorBill, "id" | "createdAt" | "updatedAt">
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
    // Totals come from the lines on the server, never from the client.
    const totals = deriveBillTotals(data, null)
    if (!totals.ok) return { success: false, error: totals.error }

    await insertVendorBill(db, {
      id,
      ...data,
      ...totals.values,
      createdAt: now,
      updatedAt: now,
    })

    revalidatePath("/dashboard/financials")
    return { success: true, id }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to create bill",
    }
  }
}

export async function updateVendorBill(
  id: string,
  data: Partial<NewVendorBill>
): Promise<ActionDone> {
  try {
    const context = await financeContext("update")
    if (!context.success) return context
    const { db, organizationId } = context.data

    // verify bill belongs to org via project
    const [existing] = await db
      .select({
        projectId: vendorBills.projectId,
        lineItems: vendorBills.lineItems,
        subtotal: vendorBills.subtotal,
        tax: vendorBills.tax,
        amountPaid: vendorBills.amountPaid,
      })
      .from(vendorBills)
      .innerJoin(projects, eq(vendorBills.projectId, projects.id))
      .where(and(eq(vendorBills.id, id), eq(projects.organizationId, organizationId)))
      .limit(1)

    if (!existing) {
      return { success: false, error: NOT_FOUND }
    }

    const totals = deriveBillTotals(data, existing)
    if (!totals.ok) return { success: false, error: totals.error }
    await updateVendorBillRow(db, id, { ...data, ...totals.values, updatedAt: new Date().toISOString() })

    revalidatePath("/dashboard/financials")
    return { success: true }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to update bill",
    }
  }
}

export async function deleteVendorBill(id: string): Promise<ActionDone> {
  try {
    const context = await financeContext("delete")
    if (!context.success) return context
    const { db, organizationId } = context.data

    // verify bill belongs to org via project
    const [existing] = await db
      .select({ projectId: vendorBills.projectId })
      .from(vendorBills)
      .innerJoin(projects, eq(vendorBills.projectId, projects.id))
      .where(and(eq(vendorBills.id, id), eq(projects.organizationId, organizationId)))
      .limit(1)

    if (!existing) {
      return { success: false, error: NOT_FOUND }
    }

    await deleteVendorBillRow(db, id)

    revalidatePath("/dashboard/financials")
    return { success: true }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to delete bill",
    }
  }
}
