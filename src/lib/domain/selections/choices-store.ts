/**
 * The only code that inserts, updates or deletes selection choices, supplier
 * links, photo links, comments and choice dependents (architecture standard,
 * section 1). No access rules here: callers resolve access first and pass
 * rows already scoped to the project.
 */
import { and, eq, inArray, isNull, ne, sql } from "drizzle-orm"
import type { BatchItem } from "drizzle-orm/batch"

import {
  projectSelectionChoiceDependents,
  projectSelectionChoices,
  projectSelectionComments,
  projectSelectionLinks,
  projectSelectionPhotos,
} from "@/db/schema-selection-choices"
import { chunkD1InsertRows } from "@/lib/d1-query"
import { companyMoveGuard, type CompanyReferenceMove } from "@/lib/domain/contacts/company-merge-references"
import { ownerPriceFromMarkup } from "@/lib/feature-settings/selection-settings"
import type { Db } from "@/lib/server/action-context"
import { assertListFields } from "@/lib/shared/statuses"

import {
  type SelectionAuthorAudience,
  SELECTION_AUTHOR_AUDIENCES,
  SELECTION_CHOICE_STATUSES,
  SELECTION_COMMENT_VISIBILITIES,
} from "./statuses"

const CHOICE_LISTS = { status: SELECTION_CHOICE_STATUSES, chosenByAudience: SELECTION_AUTHOR_AUDIENCES }
const LINK_LISTS = { addedByAudience: SELECTION_AUTHOR_AUDIENCES }
const COMMENT_LISTS = { visibility: SELECTION_COMMENT_VISIBILITIES, authorAudience: SELECTION_AUTHOR_AUDIENCES }

type ChoiceInsert = typeof projectSelectionChoices.$inferInsert
type ChoicePatch = Partial<Omit<ChoiceInsert, "id" | "projectId" | "selectionId" | "chosen" | "createdAt" | "createdBy">>
type LinkInsert = typeof projectSelectionLinks.$inferInsert
type PhotoInsert = typeof projectSelectionPhotos.$inferInsert
type CommentInsert = typeof projectSelectionComments.$inferInsert

// ---- choices

export async function insertSelectionChoice(db: Db, row: ChoiceInsert): Promise<void> {
  assertListFields("project_selection_choices", row, CHOICE_LISTS)
  await db.insert(projectSelectionChoices).values(row).run()
}

/** Several choices in one batch (a template applied), chunked under D1's parameter limit. */
export async function insertSelectionChoices(db: Db, rows: readonly ChoiceInsert[]): Promise<void> {
  assertListFields("project_selection_choices", rows, CHOICE_LISTS)
  const statements = chunkD1InsertRows(projectSelectionChoices, rows).map((chunk) => db.insert(projectSelectionChoices).values(chunk))
  const [first, ...rest] = statements
  if (!first) return
  await db.batch([first, ...rest])
}

export async function updateSelectionChoice(db: Db, projectId: string, choiceId: string, patch: ChoicePatch): Promise<void> {
  assertListFields("project_selection_choices", patch, CHOICE_LISTS)
  await db
    .update(projectSelectionChoices)
    .set(patch)
    .where(and(eq(projectSelectionChoices.id, choiceId), eq(projectSelectionChoices.projectId, projectId)))
    .run()
}

/** Deletes a choice; its links, photo links and dependent rows go with it (cascade). */
export async function deleteSelectionChoice(db: Db, projectId: string, choiceId: string): Promise<void> {
  await db
    .delete(projectSelectionChoices)
    .where(and(eq(projectSelectionChoices.id, choiceId), eq(projectSelectionChoices.projectId, projectId)))
    .run()
}

/** Saves a new order: each id gets its index as sort_order, in one batch. */
export async function reorderSelectionChoices(
  db: Db,
  selectionId: string,
  orderedIds: readonly string[],
  now: string,
): Promise<void> {
  const statements = orderedIds.map((id, index) =>
    db
      .update(projectSelectionChoices)
      .set({ sortOrder: index, updatedAt: now })
      .where(and(eq(projectSelectionChoices.id, id), eq(projectSelectionChoices.selectionId, selectionId))),
  )
  const [first, ...rest] = statements
  if (!first) return
  await db.batch([first, ...rest])
}

/**
 * Marks one choice chosen and clears the others on the same selection, in one
 * batch (the unique index allows one chosen choice per selection). `chosen`
 * false clears just this one.
 */
export async function setSelectionChoiceChosen(
  db: Db,
  selectionId: string,
  choiceId: string,
  chosen: boolean,
  now: string,
  pickedBy: { readonly userId: string; readonly audience: SelectionAuthorAudience; readonly note: string | null },
): Promise<void> {
  const cleared = { chosen: false, chosenByUserId: null, chosenByAudience: null, chosenAt: null, chosenNote: null, updatedAt: now }
  const clearOthers = db
    .update(projectSelectionChoices)
    .set(cleared)
    .where(and(eq(projectSelectionChoices.selectionId, selectionId), ne(projectSelectionChoices.id, choiceId), eq(projectSelectionChoices.chosen, true)))
  const setThis = db
    .update(projectSelectionChoices)
    .set(
      chosen
        ? { chosen: true, chosenByUserId: pickedBy.userId, chosenByAudience: pickedBy.audience, chosenAt: now, chosenNote: pickedBy.note, updatedAt: now }
        : cleared,
    )
    .where(and(eq(projectSelectionChoices.id, choiceId), eq(projectSelectionChoices.selectionId, selectionId)))
  await (chosen ? db.batch([clearOthers, setThis]) : setThis.run())
}

/**
 * Supplier prices returned on an RFQ, in one batch. The RFQ's vendor becomes
 * the choice's supplier only where the choice has none.
 */
export async function setChoicePricesFromRfq(
  db: Db,
  projectId: string,
  prices: readonly { readonly choiceId: string; readonly selectionId: string; readonly priceCents: number }[],
  vendorId: string | null,
  now: string,
  ownerMarkupPercent: number | null = null,
): Promise<void> {
  const statements: BatchItem<"sqlite">[] = prices.flatMap((price) => {
    const where = and(
      eq(projectSelectionChoices.id, price.choiceId),
      eq(projectSelectionChoices.selectionId, price.selectionId),
      eq(projectSelectionChoices.projectId, projectId),
    )
    const ownerPrice = ownerPriceFromMarkup(price.priceCents, ownerMarkupPercent)
    // A blank owner price is filled from the markup; one staff set stays.
    const setPrice = db
      .update(projectSelectionChoices)
      .set({
        priceCents: price.priceCents,
        ownerPriceCents: sql`COALESCE(${projectSelectionChoices.ownerPriceCents}, ${ownerPrice})`,
        updatedAt: now,
      })
      .where(where)
    if (!vendorId) return [setPrice]
    return [
      setPrice,
      db
        .update(projectSelectionChoices)
        .set({ vendorId, supplierName: null })
        .where(and(where, isNull(projectSelectionChoices.vendorId), isNull(projectSelectionChoices.supplierName))),
    ]
  })
  const [first, ...rest] = statements
  if (!first) return
  await db.batch([first, ...rest])
}

/** Moves a merged vendor's selection choices to the kept vendor. */
export function companyMergeSelectionChoiceStatements(database: D1Database, move: CompanyReferenceMove): D1PreparedStatement[] {
  if (move.side !== "vendor") return []
  const guard = companyMoveGuard(move)
  return [
    database
      .prepare(
        `UPDATE project_selection_choices SET vendor_id = ?, updated_at = ?
          WHERE vendor_id = ?
            AND project_id IN (SELECT id FROM projects WHERE organization_id = ?)
            AND ${guard.sql}`,
      )
      .bind(move.destinationId, move.now, move.sourceId, move.organizationId, ...guard.binds),
  ]
}

// ---- dependents

/** Replaces the follow-up selections a choice opens. */
export async function replaceChoiceDependents(
  db: Db,
  choiceId: string,
  selectionIds: readonly string[],
  now: string,
): Promise<void> {
  const statements: BatchItem<"sqlite">[] = [
    db.delete(projectSelectionChoiceDependents).where(eq(projectSelectionChoiceDependents.choiceId, choiceId)),
  ]
  if (selectionIds.length > 0) {
    statements.push(
      db
        .insert(projectSelectionChoiceDependents)
        .values(selectionIds.map((selectionId) => ({ choiceId, selectionId, createdAt: now })))
        .onConflictDoNothing(),
    )
  }
  const [first, ...rest] = statements
  if (!first) return
  await db.batch([first, ...rest])
}

// ---- supplier links

export async function insertSelectionLink(db: Db, row: LinkInsert): Promise<void> {
  assertListFields("project_selection_links", row, LINK_LISTS)
  await db.insert(projectSelectionLinks).values(row).run()
}

/** Plain links saved together (a template's product links), chunked under D1's parameter limit. */
export async function insertSelectionLinks(db: Db, rows: readonly LinkInsert[]): Promise<void> {
  assertListFields("project_selection_links", rows, LINK_LISTS)
  const statements = chunkD1InsertRows(projectSelectionLinks, rows).map((chunk) => db.insert(projectSelectionLinks).values(chunk))
  const [first, ...rest] = statements
  if (!first) return
  await db.batch([first, ...rest])
}

export async function deleteSelectionLink(db: Db, projectId: string, linkId: string): Promise<void> {
  await db
    .delete(projectSelectionLinks)
    .where(and(eq(projectSelectionLinks.id, linkId), eq(projectSelectionLinks.projectId, projectId)))
    .run()
}

// ---- photo links

export async function insertSelectionPhotos(db: Db, rows: readonly PhotoInsert[]): Promise<void> {
  if (rows.length === 0) return
  await db.insert(projectSelectionPhotos).values([...rows]).onConflictDoNothing().run()
}

export async function deleteSelectionPhotoLinks(db: Db, projectId: string, linkIds: readonly string[]): Promise<void> {
  if (linkIds.length === 0) return
  await db
    .delete(projectSelectionPhotos)
    .where(and(inArray(projectSelectionPhotos.id, [...linkIds]), eq(projectSelectionPhotos.projectId, projectId)))
    .run()
}

// ---- comments

export async function insertSelectionComment(db: Db, row: CommentInsert): Promise<void> {
  assertListFields("project_selection_comments", row, COMMENT_LISTS)
  await db.insert(projectSelectionComments).values(row).run()
}

export async function deleteSelectionComment(db: Db, projectId: string, commentId: string): Promise<void> {
  await db
    .delete(projectSelectionComments)
    .where(and(eq(projectSelectionComments.id, commentId), eq(projectSelectionComments.projectId, projectId)))
    .run()
}
