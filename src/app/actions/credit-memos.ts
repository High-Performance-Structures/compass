"use server"

import { eq, and } from "drizzle-orm"
import { creditMemos, type CreditMemo, type NewCreditMemo } from "@/db/schema-netsuite"
import { projects } from "@/db/schema"
import { revalidatePath } from "next/cache"
import type { ActionDone, ActionFailure } from "@/lib/action-result"
import { omitOwnerArSourceFields } from "@/lib/financials/owner-ar"
import {
  financeContext,
  financeReadContext,
  isOrganizationProject,
  PROJECT_NOT_FOUND,
} from "@/lib/domain/financials/access"
import { deriveCreditMemoTotals } from "@/lib/domain/financials/rules"
import { deleteCreditMemoRow, insertCreditMemo, updateCreditMemoRow } from "@/lib/domain/financials/store"

const NOT_FOUND = "Credit memo not found or access denied"

export async function getCreditMemos(): Promise<CreditMemo[]> {
  const { db, organizationId } = await financeReadContext()

  // join through projects to filter by org
  return db
    .select({
      id: creditMemos.id,
      netsuiteId: creditMemos.netsuiteId,
      organizationId: creditMemos.organizationId,
      customerId: creditMemos.customerId,
      projectId: creditMemos.projectId,
      sourceSystem: creditMemos.sourceSystem,
      sourceExternalId: creditMemos.sourceExternalId,
      cashReceipt: creditMemos.cashReceipt,
      memoNumber: creditMemos.memoNumber,
      status: creditMemos.status,
      issueDate: creditMemos.issueDate,
      total: creditMemos.total,
      amountApplied: creditMemos.amountApplied,
      amountRemaining: creditMemos.amountRemaining,
      memo: creditMemos.memo,
      lineItems: creditMemos.lineItems,
      createdAt: creditMemos.createdAt,
      updatedAt: creditMemos.updatedAt,
    })
    .from(creditMemos)
    .innerJoin(projects, eq(creditMemos.projectId, projects.id))
    .where(eq(projects.organizationId, organizationId))
}

export async function createCreditMemo(
  data: Omit<NewCreditMemo, "id" | "createdAt" | "updatedAt">
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
    // Totals come from the lines on the server, never from the client.
    const totals = deriveCreditMemoTotals(safeData, null)
    if (!totals.ok) return { success: false, error: totals.error }

    await insertCreditMemo(db, {
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
      error:
        err instanceof Error
          ? err.message
          : "Failed to create credit memo",
    }
  }
}

export async function updateCreditMemo(
  id: string,
  data: Partial<NewCreditMemo>
): Promise<ActionDone> {
  try {
    const context = await financeContext("update")
    if (!context.success) return context
    const { db, organizationId } = context.data

    // verify credit memo belongs to org via project
    const [existing] = await db
      .select({
        projectId: creditMemos.projectId,
        lineItems: creditMemos.lineItems,
        total: creditMemos.total,
        amountApplied: creditMemos.amountApplied,
      })
      .from(creditMemos)
      .innerJoin(projects, eq(creditMemos.projectId, projects.id))
      .where(and(eq(creditMemos.id, id), eq(projects.organizationId, organizationId)))
      .limit(1)

    if (!existing) {
      return { success: false, error: NOT_FOUND }
    }

    const safeData = omitOwnerArSourceFields(data)
    if (
      safeData.projectId !== undefined &&
      safeData.projectId !== null &&
      safeData.projectId !== existing.projectId &&
      !(await isOrganizationProject(db, organizationId, safeData.projectId))
    ) {
      return { success: false, error: PROJECT_NOT_FOUND }
    }
    const totals = deriveCreditMemoTotals(safeData, existing)
    if (!totals.ok) return { success: false, error: totals.error }
    await updateCreditMemoRow(db, id, { ...safeData, ...totals.values, updatedAt: new Date().toISOString() })

    revalidatePath("/dashboard/financials")
    return { success: true }
  } catch (err) {
    return {
      success: false,
      error:
        err instanceof Error
          ? err.message
          : "Failed to update credit memo",
    }
  }
}

export async function deleteCreditMemo(id: string): Promise<ActionDone> {
  try {
    const context = await financeContext("delete")
    if (!context.success) return context
    const { db, organizationId } = context.data

    // verify credit memo belongs to org via project
    const [existing] = await db
      .select({ projectId: creditMemos.projectId })
      .from(creditMemos)
      .innerJoin(projects, eq(creditMemos.projectId, projects.id))
      .where(and(eq(creditMemos.id, id), eq(projects.organizationId, organizationId)))
      .limit(1)

    if (!existing) {
      return { success: false, error: NOT_FOUND }
    }

    await deleteCreditMemoRow(db, id)

    revalidatePath("/dashboard/financials")
    return { success: true }
  } catch (err) {
    return {
      success: false,
      error:
        err instanceof Error
          ? err.message
          : "Failed to delete credit memo",
    }
  }
}
