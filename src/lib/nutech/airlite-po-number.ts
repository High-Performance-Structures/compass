import { and, eq, isNull, max } from "drizzle-orm"

import type { getDb } from "@/db"
import { projectOperations, projects } from "@/db/schema"
import { nuTechOrderWorkflows } from "@/db/schema-nutech"
import { readFeatureSettings } from "@/lib/feature-settings/server"
import { nextAirlitePoSequence } from "@/lib/nutech/airlite-workbook"

type Db = ReturnType<typeof getDb>

/** "N-0-0-1860": the project number and the order's place in the manufacturer PO sequence. */
export function airlitePurchaseOrderNumber(projectNumber: string | null, sequence: number): string {
  return [projectNumber?.trim(), String(sequence)].filter(Boolean).join("-")
}

/**
 * Gives a Nu-Tech order its manufacturer PO number (once; later calls reuse
 * it) and renames its linked Compass purchase order to match, so the PO in
 * Compass, its email and the order form all carry "N-0-0-1860". A released
 * PO keeps the number it went out with. Null when no sequence is configured.
 */
export async function assignNuTechAirlitePoNumber(
  db: Db,
  input: {
    readonly organizationId: string
    readonly workflowId: string
    readonly projectId: string
    readonly projectNumber: string | null
    readonly assigned: number | null
    readonly purchaseOrderId: string | null
    readonly purchaseOrderReleased: boolean
  }
): Promise<number | null> {
  let sequence = input.assigned
  if (sequence === null) {
    const [settings, last] = await Promise.all([
      readFeatureSettings(db, input.organizationId, "nutech-emails"),
      db
        .select({ sequence: max(nuTechOrderWorkflows.airlitePoSequence) })
        .from(nuTechOrderWorkflows)
        .innerJoin(projects, eq(projects.id, nuTechOrderWorkflows.projectId))
        .where(eq(projects.organizationId, input.organizationId))
        .get(),
    ])
    sequence = nextAirlitePoSequence({
      assigned: null,
      lastAssigned: last?.sequence ?? null,
      nextSetting: settings.nextPurchaseOrderNumber,
    })
    if (sequence === null) return null
    await db
      .update(nuTechOrderWorkflows)
      .set({ airlitePoSequence: sequence })
      .where(eq(nuTechOrderWorkflows.id, input.workflowId))
  }
  if (input.purchaseOrderId && !input.purchaseOrderReleased) {
    await db
      .update(projectOperations)
      .set({ sourceRecordNumber: airlitePurchaseOrderNumber(input.projectNumber, sequence) })
      .where(
        and(
          eq(projectOperations.id, input.purchaseOrderId),
          eq(projectOperations.projectId, input.projectId),
          eq(projectOperations.sourceRecordType, "purchase_order")
        )
      )
  }
  return sequence
}

/**
 * Before an unreleased manufacturer PO is deleted: frees its Nu-Tech order's
 * PO number (the latest number is handed out again) and clears the order
 * form, so the next PO starts fresh. A released order keeps its number.
 */
export async function releaseNuTechAirlitePoNumber(db: Db, purchaseOrderId: string): Promise<void> {
  await db
    .update(nuTechOrderWorkflows)
    .set({
      airlitePoSequence: null,
      airliteWorkbookId: null,
      airliteWorkbookUrl: null,
      airliteWorkbookStatus: "not_generated",
      airliteWorkbookGeneratedAt: null,
      airliteWorkbookGeneratedBy: null,
      updatedAt: new Date().toISOString(),
    })
    .where(
      and(
        eq(nuTechOrderWorkflows.airlitePurchaseOrderOperationId, purchaseOrderId),
        isNull(nuTechOrderWorkflows.purchaseOrderReleasedAt)
      )
    )
}
