/**
 * The only code that writes sage_cost_codes, Compass's copy of Sage's cost
 * code list (architecture standard, section 1). The cost code results route
 * plans the change with cost-code-sync-rules.ts and writes it here: new
 * rows as multi-row inserts, changed rows one UPDATE each by id, and rows
 * Sage no longer has marked inactive (never deleted, since Nu-Tech products
 * and older records may point at them). Statements come back unexecuted so
 * the caller batches them; each batch stays small (see SAGE_COST_CODE_BATCH).
 */
import { eq, inArray } from "drizzle-orm"

import { sageCostCodes } from "@/db/schema"
import { chunkD1InsertRows, chunkD1Values } from "@/lib/d1-query"
import {
  SAGE_COST_CODE_NOT_IN_SAGE,
  SAGE_COST_CODE_SOURCE,
  SAGE_COST_CODE_SYNCED,
  type SageCostCodeSyncPlan,
} from "@/lib/domain/sage-bridge/cost-code-sync-rules"
import type { Db } from "@/lib/server/action-context"

/** Statements per D1 batch, so one sync never sends a giant request. */
const SAGE_COST_CODE_BATCH = 50

type Statement = ReturnType<typeof insertStatement> | ReturnType<typeof updateStatement> | ReturnType<typeof inactivateStatement>

function insertStatement(db: Db, rows: (typeof sageCostCodes.$inferInsert)[]) {
  return db.insert(sageCostCodes).values(rows)
}
function updateStatement(db: Db, id: string, values: Partial<typeof sageCostCodes.$inferInsert>) {
  return db.update(sageCostCodes).set(values).where(eq(sageCostCodes.id, id))
}
function inactivateStatement(db: Db, ids: string[], now: string) {
  return db
    .update(sageCostCodes)
    .set({ active: false, syncStatus: SAGE_COST_CODE_NOT_IN_SAGE, updatedAt: now })
    .where(inArray(sageCostCodes.id, ids))
}

/** Every write the plan needs, grouped into batches of at most SAGE_COST_CODE_BATCH statements. */
export function sageCostCodeSyncBatches(db: Db, plan: SageCostCodeSyncPlan, now: string): Statement[][] {
  const statements: Statement[] = []
  const inserts = plan.inserts.map((row) => ({
    id: row.id,
    sourceSystem: SAGE_COST_CODE_SOURCE,
    sourceRecordId: row.sourceRecordId,
    sourceRecordNumber: row.sourceRecordId,
    code: row.code,
    description: row.description,
    displayLabel: row.displayLabel,
    divisionCode: row.divisionCode,
    divisionDescription: row.divisionDescription,
    divisionDisplayLabel: row.divisionDisplayLabel,
    active: true,
    syncStatus: SAGE_COST_CODE_SYNCED,
    lastSyncedAt: now,
    createdAt: now,
    updatedAt: now,
  }))
  for (const chunk of chunkD1InsertRows(sageCostCodes, inserts)) statements.push(insertStatement(db, chunk))
  for (const row of plan.updates) {
    statements.push(
      updateStatement(db, row.id, {
        sourceSystem: SAGE_COST_CODE_SOURCE,
        sourceRecordId: row.sourceRecordId,
        sourceRecordNumber: row.sourceRecordId,
        code: row.code,
        description: row.description,
        displayLabel: row.displayLabel,
        divisionCode: row.divisionCode,
        divisionDescription: row.divisionDescription,
        divisionDisplayLabel: row.divisionDisplayLabel,
        active: true,
        syncStatus: SAGE_COST_CODE_SYNCED,
        lastSyncedAt: now,
        updatedAt: now,
      })
    )
  }
  for (const ids of chunkD1Values(plan.inactivations.map((row) => row.id))) statements.push(inactivateStatement(db, ids, now))
  const batches: Statement[][] = []
  for (let index = 0; index < statements.length; index += SAGE_COST_CODE_BATCH) {
    batches.push(statements.slice(index, index + SAGE_COST_CODE_BATCH))
  }
  return batches
}
