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

import { roundSignatureStatusAfter, type RoundSignatureEvent } from "./status-machine"
import { SELECTION_OVERAGE_TREATMENTS, SELECTION_ROUND_SIGNATURE_STATUSES, type SelectionRoundSignatureStatus } from "./statuses"

const SIGNATURE_LISTS = { status: SELECTION_ROUND_SIGNATURE_STATUSES, treatment: SELECTION_OVERAGE_TREATMENTS }

type SignatureInsert = typeof projectSelectionRoundSignatures.$inferInsert
type SignatureItemInsert = typeof projectSelectionRoundSignatureItems.$inferInsert
/** Every column but status; status changes through roundSignatureTransitionStatement. */
type SignaturePatch = Omit<SQLiteUpdateSetSource<typeof projectSelectionRoundSignatures>, "status">

function withoutStatus(patch: SignaturePatch): SignaturePatch {
  if ("status" in patch) throw new Error("project_selection_round_signatures.status changes only through roundSignatureTransitionStatement.")
  return patch
}

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

export async function updateRoundSignature(db: Db, id: string, fromStatus: SelectionRoundSignatureStatus | null, patch: SignaturePatch): Promise<D1Result> {
  assertListFields("project_selection_round_signatures", patch, SIGNATURE_LISTS)
  return db.update(projectSelectionRoundSignatures).set(withoutStatus(patch)).where(signatureWhere(id, fromStatus)).run()
}

// Return type left to Drizzle: run() and the batch both need the builder.
/**
 * Moves a signature read in `from` through `event` (status-machine.ts),
 * compare-and-set on `from`. Null when the machine doesn't allow it (a
 * signed, declined or cancelled signature never moves again).
 */
export function roundSignatureTransitionStatement(
  db: Db,
  id: string,
  from: SelectionRoundSignatureStatus,
  event: RoundSignatureEvent,
  patch: SignaturePatch,
) {
  const to = roundSignatureStatusAfter(event, from)
  if (to === null) return null
  const values = { ...withoutStatus(patch), status: to }
  assertListFields("project_selection_round_signatures", values, SIGNATURE_LISTS)
  return db.update(projectSelectionRoundSignatures).set(values).where(signatureWhere(id, from))
}

/** Applies roundSignatureTransitionStatement. True when it landed. */
export async function transitionRoundSignature(
  db: Db,
  id: string,
  from: SelectionRoundSignatureStatus,
  event: RoundSignatureEvent,
  patch: SignaturePatch,
): Promise<boolean> {
  const statement = roundSignatureTransitionStatement(db, id, from, event, patch)
  if (statement === null) return false
  const result = await statement.run()
  return result.meta.changes > 0
}
