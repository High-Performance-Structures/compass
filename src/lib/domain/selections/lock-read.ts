/**
 * Reads for locked and replaced selections (rules in locks.ts).
 */
import { and, eq } from "drizzle-orm"

import { projectFinishSelections } from "@/db/schema"
import type { Db } from "@/lib/server/action-context"

import { selectionLock, type SelectionLock } from "./locks"
import type { SelectionReplacementReason } from "./statuses"

/** Whether another selection replaces this one. */
export async function selectionIsReplaced(db: Db, selectionId: string): Promise<boolean> {
  const row = await db
    .select({ id: projectFinishSelections.id })
    .from(projectFinishSelections)
    .where(eq(projectFinishSelections.replacesSelectionId, selectionId))
    .get()
  return row !== undefined
}

/** The selection's stored status and its lock (null: it can change), or null when it isn't on the project. */
export async function loadSelectionLock(
  db: Db,
  projectId: string,
  selectionId: string,
): Promise<{ readonly status: string; readonly lock: SelectionLock | null } | null> {
  const row = await db
    .select({ status: projectFinishSelections.status })
    .from(projectFinishSelections)
    .where(and(eq(projectFinishSelections.id, selectionId), eq(projectFinishSelections.projectId, projectId)))
    .get()
  if (!row) return null
  return { status: row.status, lock: selectionLock(row.status, await selectionIsReplaced(db, selectionId)) }
}

export type SelectionReplacementLink = {
  readonly id: string
  readonly name: string
  readonly reason: SelectionReplacementReason | null
}

/** What replaces this selection, and what it replaces (each null when none). */
export async function loadSelectionReplacement(
  db: Db,
  projectId: string,
  selectionId: string,
): Promise<{ readonly replacedBy: SelectionReplacementLink | null; readonly replaces: SelectionReplacementLink | null }> {
  const [self, replacement] = await Promise.all([
    db
      .select({ replacesSelectionId: projectFinishSelections.replacesSelectionId, reason: projectFinishSelections.replacementReason })
      .from(projectFinishSelections)
      .where(and(eq(projectFinishSelections.id, selectionId), eq(projectFinishSelections.projectId, projectId)))
      .get(),
    db
      .select({ id: projectFinishSelections.id, name: projectFinishSelections.name, reason: projectFinishSelections.replacementReason })
      .from(projectFinishSelections)
      .where(and(eq(projectFinishSelections.replacesSelectionId, selectionId), eq(projectFinishSelections.projectId, projectId)))
      .get(),
  ])
  const replacedId = self?.replacesSelectionId ?? null
  const replaced = replacedId
    ? await db
        .select({ id: projectFinishSelections.id, name: projectFinishSelections.name })
        .from(projectFinishSelections)
        .where(and(eq(projectFinishSelections.id, replacedId), eq(projectFinishSelections.projectId, projectId)))
        .get()
    : undefined
  return {
    replacedBy: replacement ?? null,
    replaces: replaced ? { ...replaced, reason: self?.reason ?? null } : null,
  }
}
