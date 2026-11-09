/**
 * The only code that writes selections round signatures and their items
 * (project_selection_round_signatures, project_selection_round_signature_items).
 * No access rules here: callers resolve access first.
 */
import { and, eq, type SQL } from "drizzle-orm"
import type { BatchItem } from "drizzle-orm/batch"
import type { SQLiteUpdateSetSource } from "drizzle-orm/sqlite-core"

import { projectSelectionRoundSignatureItems, projectSelectionRoundSignatures } from "@/db/schema-selection-choices"
import type { Db } from "@/lib/server/action-context"
import { assertListFields } from "@/lib/shared/statuses"

import { SELECTION_OVERAGE_TREATMENTS, SELECTION_ROUND_SIGNATURE_STATUSES, type SelectionRoundSignatureStatus } from "./statuses"

const SIGNATURE_LISTS = { status: SELECTION_ROUND_SIGNATURE_STATUSES, treatment: SELECTION_OVERAGE_TREATMENTS }

type SignatureInsert = typeof projectSelectionRoundSignatures.$inferInsert
type SignatureItemInsert = typeof projectSelectionRoundSignatureItems.$inferInsert
type SignaturePatch = SQLiteUpdateSetSource<typeof projectSelectionRoundSignatures>

/** The signature and the items it covers, as statements for one batch. */
export function insertRoundSignatureStatements(db: Db, signature: SignatureInsert, items: readonly SignatureItemInsert[]): BatchItem<"sqlite">[] {
  assertListFields("project_selection_round_signatures", signature, SIGNATURE_LISTS)
  const statements: BatchItem<"sqlite">[] = [db.insert(projectSelectionRoundSignatures).values(signature)]
  // Seven columns per item; ten items per statement stays under D1's parameter limit.
  for (let index = 0; index < items.length; index += 10) {
    statements.push(db.insert(projectSelectionRoundSignatureItems).values(items.slice(index, index + 10)))
  }
  return statements
}

function signatureWhere(id: string, fromStatus: SelectionRoundSignatureStatus | null): SQL | undefined {
  return fromStatus === null
    ? eq(projectSelectionRoundSignatures.id, id)
    : and(eq(projectSelectionRoundSignatures.id, id), eq(projectSelectionRoundSignatures.status, fromStatus))
}

/** An update guarded on the status the caller read, so webhook retries apply once. */
export function updateRoundSignatureStatement(db: Db, id: string, fromStatus: SelectionRoundSignatureStatus | null, patch: SignaturePatch): BatchItem<"sqlite"> {
  assertListFields("project_selection_round_signatures", patch, SIGNATURE_LISTS)
  return db.update(projectSelectionRoundSignatures).set(patch).where(signatureWhere(id, fromStatus))
}

export async function updateRoundSignature(db: Db, id: string, fromStatus: SelectionRoundSignatureStatus | null, patch: SignaturePatch): Promise<D1Result> {
  assertListFields("project_selection_round_signatures", patch, SIGNATURE_LISTS)
  return db.update(projectSelectionRoundSignatures).set(patch).where(signatureWhere(id, fromStatus)).run()
}
