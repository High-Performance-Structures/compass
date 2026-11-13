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

import { insertCopyStatement } from "./copy-rows"
import {
  type SelectionAuthorAudience,
  type SelectionChoiceStatus,
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

// ---- locks (locks.ts), checked inside each write so a stale read can't slip past
//
// The outer table is named in full so each subquery reads the choice being written.

/** The choice's selection is ordered or installed. */
const selectionLocked = sql`EXISTS (SELECT 1 FROM project_finish_selections AS locked WHERE locked.id = project_selection_choices.selection_id AND locked.status IN ('ordered', 'installed'))`
/** The choice's selection was replaced: all its choices are read-only. */
const selectionReplaced = sql`EXISTS (SELECT 1 FROM project_finish_selections AS replacement WHERE replacement.replaces_selection_id = project_selection_choices.selection_id)`
/** A signed Selection Phase covered this choice (as the pick). */
const choiceSigned = sql`EXISTS (SELECT 1 FROM project_selection_round_signature_items AS signed_item INNER JOIN project_selection_round_signatures AS signed_round ON signed_round.id = signed_item.signature_id WHERE signed_item.choice_id = project_selection_choices.id AND signed_round.status = 'signed')`
/** A replacement change order (draft, out or executed) prices the choice's selection. */
const replacementOrderOpen = sql`EXISTS (SELECT 1 FROM project_change_orders AS replacement_change WHERE replacement_change.source_type = 'selection_replacement' AND replacement_change.source_record_id = project_selection_choices.selection_id AND replacement_change.status NOT IN ('void', 'declined'))`
/**
 * The choice may be edited or deleted. Not the pick when its selection is
 * ordered or installed, a signature covers it, or a replacement change
 * order prices it (change the pick instead); nothing on a replaced selection.
 */
const choiceWritable = sql`NOT ((project_selection_choices.chosen = 1 AND (${selectionLocked} OR ${choiceSigned} OR ${replacementOrderOpen})) OR ${selectionReplaced})`
/**
 * A replacement's change order is out for signature or executed: the pick
 * it prices is fixed (a draft change order can still follow a new pick).
 */
const replacementOrderLive = sql`EXISTS (SELECT 1 FROM project_change_orders AS replacement_change WHERE replacement_change.source_type = 'selection_replacement' AND replacement_change.source_record_id = project_selection_choices.selection_id AND replacement_change.status NOT IN ('draft', 'void', 'declined'))`
/** The selection's pick may change: it is not ordered, installed or replaced, and no live replacement change order prices it. */
const pickChangeable = sql`NOT (${selectionLocked} OR ${selectionReplaced} OR ${replacementOrderLive})`

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

/**
 * Saves a choice's fields. A choice's status is staff's to set (no
 * automation moves it); a status change is compare-and-set on the status
 * the person saw, so two editors never silently overwrite each other.
 * False when that status changed meanwhile (nothing is written).
 */
export async function updateSelectionChoice(
  db: Db,
  projectId: string,
  choiceId: string,
  patch: Omit<ChoicePatch, "status">,
  /** `expected` null: an older form that didn't send what it saw; written as before. */
  status?: { readonly expected: string | null; readonly to: SelectionChoiceStatus },
): Promise<boolean> {
  const values = status ? { ...patch, status: status.to } : patch
  assertListFields("project_selection_choices", values, CHOICE_LISTS)
  const result = await db
    .update(projectSelectionChoices)
    .set(values)
    .where(
      and(
        eq(projectSelectionChoices.id, choiceId),
        eq(projectSelectionChoices.projectId, projectId),
        status && status.expected !== null ? sql`${projectSelectionChoices.status} = ${status.expected}` : undefined,
        choiceWritable,
      ),
    )
    .run()
  return result.meta.changes > 0
}

/**
 * Deletes a choice; its links, photo links and dependent rows go with it
 * (cascade). False when it is locked (see choiceWritable) or gone.
 */
export async function deleteSelectionChoice(db: Db, projectId: string, choiceId: string): Promise<boolean> {
  const result = await db
    .delete(projectSelectionChoices)
    .where(and(eq(projectSelectionChoices.id, choiceId), eq(projectSelectionChoices.projectId, projectId), choiceWritable))
    .run()
  return result.meta.changes > 0
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
 * false clears just this one. Nothing changes on an ordered, installed or
 * replaced selection; false then.
 */
export async function setSelectionChoiceChosen(
  db: Db,
  selectionId: string,
  choiceId: string,
  chosen: boolean,
  now: string,
  pickedBy: { readonly userId: string; readonly audience: SelectionAuthorAudience; readonly note: string | null },
): Promise<boolean> {
  const cleared = { chosen: false, chosenByUserId: null, chosenByAudience: null, chosenAt: null, chosenNote: null, updatedAt: now }
  const clearOthers = db
    .update(projectSelectionChoices)
    .set(cleared)
    .where(and(eq(projectSelectionChoices.selectionId, selectionId), ne(projectSelectionChoices.id, choiceId), eq(projectSelectionChoices.chosen, true), pickChangeable))
  const setThis = db
    .update(projectSelectionChoices)
    .set(
      chosen
        ? { chosen: true, chosenByUserId: pickedBy.userId, chosenByAudience: pickedBy.audience, chosenAt: now, chosenNote: pickedBy.note, updatedAt: now }
        : cleared,
    )
    .where(and(eq(projectSelectionChoices.id, choiceId), eq(projectSelectionChoices.selectionId, selectionId), pickChangeable))
  if (!chosen) return (await setThis.run()).meta.changes > 0
  const [, set] = await db.batch([clearOthers, setThis])
  return set.meta.changes > 0
}

/**
 * Supplier prices returned on an RFQ, in one batch. The RFQ's vendor becomes
 * the choice's supplier only where the choice has none. The pick of an
 * ordered or installed selection is left as it was bought, and a replaced
 * selection's choices are left alone.
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
      choiceWritable,
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

// A replaced selection's links and photo links don't change. An insert is
// undone in the same batch (one transaction) when the selection was replaced
// by then; a delete skips them.
const linkOnReplaced = sql`EXISTS (SELECT 1 FROM project_finish_selections AS replacement WHERE replacement.replaces_selection_id = project_selection_links.selection_id)`
const photoOnReplaced = sql`EXISTS (SELECT 1 FROM project_finish_selections AS replacement WHERE replacement.replaces_selection_id = project_selection_photos.selection_id)`

/** Saves a link; false when its selection was replaced (nothing is kept). */
export async function insertSelectionLink(db: Db, row: LinkInsert): Promise<boolean> {
  assertListFields("project_selection_links", row, LINK_LISTS)
  const [, undone] = await db.batch([
    db.insert(projectSelectionLinks).values(row),
    db.delete(projectSelectionLinks).where(and(eq(projectSelectionLinks.id, row.id), linkOnReplaced)),
  ])
  return undone.meta.changes === 0
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
    .where(and(eq(projectSelectionLinks.id, linkId), eq(projectSelectionLinks.projectId, projectId), sql`NOT ${linkOnReplaced}`))
    .run()
}

// ---- photo links

/** Links photos; false when their selection was replaced (nothing is kept). */
export async function insertSelectionPhotos(db: Db, rows: readonly PhotoInsert[]): Promise<boolean> {
  if (rows.length === 0) return true
  const [, undone] = await db.batch([
    db.insert(projectSelectionPhotos).values([...rows]).onConflictDoNothing(),
    db.delete(projectSelectionPhotos).where(and(inArray(projectSelectionPhotos.id, rows.map((row) => row.id)), photoOnReplaced)),
  ])
  return undone.meta.changes === 0
}

export async function deleteSelectionPhotoLinks(db: Db, projectId: string, linkIds: readonly string[]): Promise<void> {
  if (linkIds.length === 0) return
  await db
    .delete(projectSelectionPhotos)
    .where(and(inArray(projectSelectionPhotos.id, [...linkIds]), eq(projectSelectionPhotos.projectId, projectId), sql`NOT ${photoOnReplaced}`))
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

// ---- replacement copies

/**
 * Copies a replaced selection's choices, supplier links, photo links and
 * follow-up links onto the selection that replaces it, for the same batch
 * that inserts it. Each
 * statement copies one row from its source and lands only if the new
 * selection exists, so nothing is copied when that insert didn't land. The
 * originals stay with the replaced selection. `pick` is the one copied
 * choice to mark chosen (picked by staff, with the reason as the note).
 */
export function copyChoicesToReplacementStatements(
  db: Db,
  input: {
    readonly projectId: string
    readonly fromSelectionId: string
    readonly toSelectionId: string
    readonly choices: readonly { readonly fromId: string; readonly newId: string }[]
    readonly links: readonly { readonly fromId: string; readonly newId: string; readonly newChoiceId: string | null }[]
    readonly photos: readonly { readonly fromId: string; readonly newId: string; readonly newChoiceId: string | null }[]
    readonly pick: { readonly newChoiceId: string; readonly userId: string; readonly note: string } | null
    readonly now: string
  },
): BatchItem<"sqlite">[] {
  const landed = sql`EXISTS (SELECT 1 FROM project_finish_selections WHERE id = ${input.toSelectionId} AND project_id = ${input.projectId})`
  const choices = input.choices.map((choice) => {
    const pick = input.pick?.newChoiceId === choice.newId ? input.pick : null
    return insertCopyStatement(
      db,
      projectSelectionChoices,
      {
        id: choice.newId,
        selectionId: input.toSelectionId,
        chosen: pick !== null,
        chosenByUserId: pick?.userId ?? null,
        chosenByAudience: pick ? "staff" : null,
        chosenAt: pick ? input.now : null,
        chosenNote: pick?.note ?? null,
        // A Buildertrend choice id is imported once; the copy is Compass's own.
        sourceSystem: "compass",
        btChoiceId: null,
        createdBy: input.pick?.userId ?? null,
        createdAt: input.now,
        updatedAt: input.now,
      },
      and(eq(projectSelectionChoices.id, choice.fromId), eq(projectSelectionChoices.projectId, input.projectId), landed),
    )
  })
  const links = input.links.map((link) =>
    insertCopyStatement(
      db,
      projectSelectionLinks,
      { id: link.newId, selectionId: input.toSelectionId, choiceId: link.newChoiceId, createdAt: input.now },
      and(eq(projectSelectionLinks.id, link.fromId), eq(projectSelectionLinks.projectId, input.projectId), landed),
    ),
  )
  const photos = input.photos.map((photo) =>
    insertCopyStatement(
      db,
      projectSelectionPhotos,
      { id: photo.newId, selectionId: input.toSelectionId, choiceId: photo.newChoiceId, createdAt: input.now },
      and(eq(projectSelectionPhotos.id, photo.fromId), eq(projectSelectionPhotos.projectId, input.projectId), landed),
    ),
  )
  // Follow-ups: what each copied choice opens, and the other choices that opened the replaced selection.
  const opens = input.choices.map((choice) =>
    insertCopyStatement(
      db,
      projectSelectionChoiceDependents,
      { choiceId: choice.newId, createdAt: input.now },
      and(eq(projectSelectionChoiceDependents.choiceId, choice.fromId), landed),
    ),
  )
  const openedBy = insertCopyStatement(
    db,
    projectSelectionChoiceDependents,
    { selectionId: input.toSelectionId, createdAt: input.now },
    and(eq(projectSelectionChoiceDependents.selectionId, input.fromSelectionId), landed),
  )
  return [...choices, ...links, ...photos, ...opens, openedBy]
}
