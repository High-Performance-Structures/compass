/**
 * The owner's choosing view: every selection published to the owner, by
 * room, with its choices as cards (owner price, over/under the published
 * allowance, supplier links, owner-visible photos), the owner's pick, and
 * the follow-ups a pick opens. Never includes supplier names or supplier
 * prices. Callers resolve owner access first.
 */
import { and, asc, eq } from "drizzle-orm"

import { projectFinishSelections } from "@/db/schema"
import { projectSelectionDecisions } from "@/db/schema-selection-decisions"
import { chunkD1Values } from "@/lib/d1-query"
import type { Db } from "@/lib/server/action-context"

import { loadChoicePanels, type SelectionChoicesPanel } from "./choices-read"
import { signedChoices } from "./round-signing"

export type OwnerBoardSelection = {
  readonly id: string
  readonly roomName: string
  readonly name: string
  readonly allowanceCents: number | null
  readonly dueDate: string | null
  /** Approved selections can no longer be changed by the owner. */
  readonly approved: boolean
  /** The owner signed for the current pick (it is locked until the builder changes it). */
  readonly signed: boolean
  readonly panel: SelectionChoicesPanel
  /** Names of the selections each choice opens, by choice id. */
  readonly followUpNames: Readonly<Record<string, readonly string[]>>
}

export async function loadOwnerChoiceBoard(db: Db, projectId: string, viewerUserId: string): Promise<readonly OwnerBoardSelection[]> {
  const published = await db
    .select({
      id: projectFinishSelections.id,
      roomName: projectFinishSelections.roomName,
      name: projectFinishSelections.name,
      allowanceCents: projectSelectionDecisions.allowanceCents,
      dueDate: projectSelectionDecisions.decisionDueDate,
      approvedAt: projectSelectionDecisions.approvedAt,
    })
    .from(projectFinishSelections)
    .innerJoin(projectSelectionDecisions, eq(projectSelectionDecisions.selectionId, projectFinishSelections.id))
    .where(and(eq(projectFinishSelections.projectId, projectId), eq(projectSelectionDecisions.published, true)))
    .orderBy(asc(projectFinishSelections.roomName), asc(projectFinishSelections.sortOrder), asc(projectFinishSelections.name))
  if (published.length === 0) return []
  const chunks = await Promise.all(
    chunkD1Values(published.map((row) => row.id)).map((ids) => loadChoicePanels(db, projectId, ids, "owner", viewerUserId)),
  )
  const panels = new Map(chunks.flat().map((panel) => [panel.selectionId, panel]))
  const signed = await signedChoices(db, published.map((row) => row.id))
  const names = new Map(published.map((row) => [row.id, row.name]))
  return published.map((row) => {
    const panel = panels.get(row.id) ?? { selectionId: row.id, choices: [], selectionLinks: [], selectionPhotos: [], comments: [] }
    return {
      id: row.id,
      roomName: row.roomName,
      name: row.name,
      allowanceCents: row.allowanceCents,
      dueDate: row.dueDate,
      approved: Boolean(row.approvedAt),
      signed: panel.choices.some((choice) => choice.chosen && signed.get(row.id) === choice.id),
      panel,
      // Only follow-ups already published to the owner are named.
      followUpNames: Object.fromEntries(
        panel.choices.map((choice) => [
          choice.id,
          choice.dependentSelectionIds.flatMap((id) => {
            const name = names.get(id)
            return name ? [name] : []
          }),
        ]),
      ),
    }
  })
}
