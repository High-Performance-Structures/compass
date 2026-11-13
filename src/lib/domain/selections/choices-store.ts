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
import { OWNER_PENDING_SUGGESTIONS_MAX } from "./owner-suggestion-rules"
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
/** The choice's selection has the owner's approval recorded: its pick's price is what was approved (settled). */
const selectionApproved = sql`EXISTS (SELECT 1 FROM project_finish_selections AS approved WHERE approved.id = project_selection_choices.selection_id AND approved.owner_approved = 1)`
/** A signed Selection Phase covered this choice (as the pick). */
const choiceSigned = sql`EXISTS (SELECT 1 FROM project_selection_round_signature_items AS signed_item INNER JOIN project_selection_round_signatures AS signed_round ON signed_round.id = signed_item.signature_id WHERE signed_item.choice_id = project_selection_choices.id AND signed_round.status = 'signed')`
/** The selection is in a Selection Phase signature being prepared or sent. */
const outForSignature = sql`EXISTS (SELECT 1 FROM project_selection_round_signature_items AS out_item INNER JOIN project_selection_round_signatures AS out_round ON out_round.id = out_item.signature_id
  WHERE out_round.status IN ('preparing', 'sent') AND out_item.selection_id = project_selection_choices.selection_id)`
/** The selection's current pick is covered by a signed Selection Phase. */
const currentPickSigned = sql`EXISTS (SELECT 1 FROM project_selection_round_signature_items AS signed_item INNER JOIN project_selection_round_signatures AS signed_round ON signed_round.id = signed_item.signature_id
  WHERE signed_round.status = 'signed' AND signed_item.selection_id = project_selection_choices.selection_id
    AND signed_item.choice_id = (SELECT current_pick.id FROM project_selection_choices AS current_pick WHERE current_pick.selection_id = project_selection_choices.selection_id AND current_pick.chosen = 1))`
/**
 * A choice's prices may change: not the pick of an ordered, installed or
 * approved selection or a signed pick, and nothing on a replaced selection.
 * Allowed while the selection is out for signature (the job's managers are
 * told; price-change-notice.ts).
 */
const choicePriceWritable = sql`NOT ((project_selection_choices.chosen = 1 AND (${selectionLocked} OR ${choiceSigned} OR ${selectionApproved})) OR ${selectionReplaced})`
/** The choice may be edited (beyond its prices) or deleted: as above, and not while the selection is out for signature. */
const choiceWritable = sql`(${choicePriceWritable} AND NOT ${outForSignature})`
/**
 * The selection's pick may change (staff or owner; owner decision
 * 2026-11-12): not ordered, installed or replaced (Replace instead), not
 * approved and its pick not signed (a change order instead; includes
 * imported approvals), and not out for signature.
 */
const pickChangeable = sql`NOT (${selectionLocked} OR ${selectionReplaced} OR ${selectionApproved} OR ${currentPickSigned} OR ${outForSignature})`

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
  /** Only prices change (allowed while the selection is out for signature). */
  pricesOnly = false,
): Promise<boolean> {
  // Staff setting the owner price prices an owner's suggestion (no longer pending).
  const priced = typeof patch.ownerPriceCents === "number" ? ownerPricedValues(patch.updatedAt ?? new Date().toISOString()) : {}
  const values = status ? { ...patch, ...priced, status: status.to } : { ...patch, ...priced }
  assertListFields("project_selection_choices", values, CHOICE_LISTS)
  const result = await db
    .update(projectSelectionChoices)
    .set(values)
    .where(
      and(
        eq(projectSelectionChoices.id, choiceId),
        eq(projectSelectionChoices.projectId, projectId),
        status && status.expected !== null ? sql`${projectSelectionChoices.status} = ${status.expected}` : undefined,
        pricesOnly ? choicePriceWritable : choiceWritable,
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
 * The statements that mark one choice chosen and clear the others on the
 * same selection (the unique index allows one chosen choice per selection);
 * `chosen` false clears just this one. Nothing changes where the pick is
 * fixed (pickChangeable). The last statement is the pick itself: none of
 * its rows changed means the pick didn't land.
 */
function selectionPickStatements(
  db: Db,
  selectionId: string,
  choiceId: string,
  chosen: boolean,
  now: string,
  pickedBy: { readonly userId: string; readonly audience: SelectionAuthorAudience; readonly note: string | null },
): readonly [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]] {
  const allowed = pickChangeable
  const cleared = { chosen: false, chosenByUserId: null, chosenByAudience: null, chosenAt: null, chosenNote: null, updatedAt: now }
  const setThis = db
    .update(projectSelectionChoices)
    .set(
      chosen
        ? { chosen: true, chosenByUserId: pickedBy.userId, chosenByAudience: pickedBy.audience, chosenAt: now, chosenNote: pickedBy.note, updatedAt: now }
        : cleared,
    )
    .where(and(eq(projectSelectionChoices.id, choiceId), eq(projectSelectionChoices.selectionId, selectionId), allowed))
  if (!chosen) return [setThis]
  const clearOthers = db
    .update(projectSelectionChoices)
    .set(cleared)
    .where(and(eq(projectSelectionChoices.selectionId, selectionId), ne(projectSelectionChoices.id, choiceId), eq(projectSelectionChoices.chosen, true), allowed))
  return [clearOthers, setThis]
}

/** Runs selectionPickStatements; false when the pick didn't land. */
export async function setSelectionChoiceChosen(
  db: Db,
  selectionId: string,
  choiceId: string,
  chosen: boolean,
  now: string,
  pickedBy: { readonly userId: string; readonly audience: SelectionAuthorAudience; readonly note: string | null },
): Promise<boolean> {
  const results = await db.batch(selectionPickStatements(db, selectionId, choiceId, chosen, now, pickedBy))
  return (results.at(-1)?.meta.changes ?? 0) > 0
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
      choicePriceWritable,
    )
    const ownerPrice = ownerPriceFromMarkup(price.priceCents, ownerMarkupPercent)
    // A blank owner price is filled from the markup; one staff set stays.
    // An owner's suggestion is priced once it has an owner price.
    const ownerPriced = sql`COALESCE(${projectSelectionChoices.ownerPriceCents}, ${ownerPrice}) IS NOT NULL`
    const setPrice = db
      .update(projectSelectionChoices)
      .set({
        priceCents: price.priceCents,
        ownerPriceCents: sql`COALESCE(${projectSelectionChoices.ownerPriceCents}, ${ownerPrice})`,
        ownerPricingPending: sql`CASE WHEN ${ownerPriced} THEN 0 ELSE ${projectSelectionChoices.ownerPricingPending} END`,
        ownerPricedAt: sql`CASE WHEN ${ownerPriced} AND ${projectSelectionChoices.ownerPricingPending} = 1 THEN ${now} ELSE ${projectSelectionChoices.ownerPricedAt} END`,
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

// ---- owner-suggested choices (owner decision 2026-11-13)
//
// An owner adds their own choice to a published selection. It is marked as
// theirs and pending until staff set the owner price (updateSelectionChoice
// and setChoicePricesFromRfq clear it); the product page's price is only the
// supplier price. The owner adds, edits and deletes it under the same locks
// as the pick (pickChangeable), on a selection still published to them and
// whose choice they haven't confirmed; edits and deletes only while it is
// still theirs and pending. Every rule is checked inside the write.

/** The values that mark an owner's suggestion priced by staff (when it was pending). */
function ownerPricedValues(now: string) {
  return {
    ownerPricingPending: false,
    ownerPricedAt: sql`CASE WHEN ${projectSelectionChoices.ownerPricingPending} = 1 THEN ${now} ELSE ${projectSelectionChoices.ownerPricedAt} END`,
  }
}

/** The owner may add to, or change their suggestion on, the choice's selection now. */
const ownerSuggestionAllowed = sql`(${pickChangeable} AND EXISTS (SELECT 1 FROM project_selection_decisions AS owner_decision
  WHERE owner_decision.selection_id = project_selection_choices.selection_id AND owner_decision.published = 1 AND owner_decision.approved_at IS NULL))`

/**
 * Adds the owner's suggested choice and its owner-added product link in one
 * batch (one transaction). The choice is taken back in the same batch when
 * the selection doesn't allow it (ownerSuggestionAllowed); its link goes with
 * it (cascade). False when nothing was kept.
 */
export async function insertOwnerSuggestedChoice(db: Db, choice: ChoiceInsert, link: LinkInsert | null): Promise<boolean> {
  assertListFields("project_selection_choices", choice, CHOICE_LISTS)
  if (link) assertListFields("project_selection_links", link, LINK_LISTS)
  const insert = db.insert(projectSelectionChoices).values(choice)
  // At most OWNER_PENDING_SUGGESTIONS_MAX pending suggestions per owner per selection (this one counted).
  const overCap = sql`(SELECT count(*) FROM project_selection_choices AS mine WHERE mine.selection_id = ${choice.selectionId}
    AND mine.suggested_by_user_id = ${choice.suggestedByUserId ?? null} AND mine.owner_pricing_pending = 1) > ${OWNER_PENDING_SUGGESTIONS_MAX}`
  const undo = db
    .delete(projectSelectionChoices)
    .where(and(eq(projectSelectionChoices.id, choice.id), sql`(NOT ${ownerSuggestionAllowed} OR ${overCap})`))
  const results = await db.batch(link ? [insert, db.insert(projectSelectionLinks).values(link), undo] : [insert, undo])
  return (results.at(-1)?.meta.changes ?? 0) === 0
}

/** Only the suggester's own suggestion, while pending and allowed. */
function ownSuggestion(projectId: string, choiceId: string, userId: string) {
  return and(
    eq(projectSelectionChoices.id, choiceId),
    eq(projectSelectionChoices.projectId, projectId),
    eq(projectSelectionChoices.suggestedByUserId, userId),
    eq(projectSelectionChoices.ownerPricingPending, true),
    ownerSuggestionAllowed,
  )
}

/**
 * Saves the owner's edit of their own suggestion (compare-and-set: only
 * while it is theirs, pending and allowed). `link` replaces the product link
 * the owner added (null removes it; undefined leaves it); the link changes
 * only when the choice's edit landed in the same batch. False when nothing
 * was written.
 */
export async function updateOwnerSuggestedChoice(
  db: Db,
  input: {
    readonly projectId: string
    readonly choiceId: string
    readonly userId: string
    readonly patch: { readonly title: string; readonly description: string | null; readonly priceCents?: number | null; readonly updatedAt: string }
    readonly link?: LinkInsert | null
  },
): Promise<boolean> {
  if (input.link) assertListFields("project_selection_links", input.link, LINK_LISTS)
  const edit = db.update(projectSelectionChoices).set(input.patch).where(ownSuggestion(input.projectId, input.choiceId, input.userId))
  if (input.link === undefined) {
    const result = await edit.run()
    return result.meta.changes > 0
  }
  // The edit landed: the choice is still the owner's pending suggestion, stamped with this edit.
  const landed = sql`EXISTS (SELECT 1 FROM project_selection_choices AS edited WHERE edited.id = ${input.choiceId}
    AND edited.suggested_by_user_id = ${input.userId} AND edited.owner_pricing_pending = 1 AND edited.updated_at = ${input.patch.updatedAt})`
  const ownLinks = and(
    eq(projectSelectionLinks.choiceId, input.choiceId),
    eq(projectSelectionLinks.addedByUserId, input.userId),
    eq(projectSelectionLinks.addedByAudience, "owner"),
  )
  const link = input.link
  const removeOld = db.delete(projectSelectionLinks).where(and(ownLinks, landed, link ? ne(projectSelectionLinks.id, link.id) : undefined))
  const [result] = await db.batch(
    link
      ? [
          edit,
          removeOld,
          db.insert(projectSelectionLinks).values(link),
          db.delete(projectSelectionLinks).where(and(eq(projectSelectionLinks.id, link.id), sql`NOT ${landed}`)),
        ]
      : [edit, removeOld],
  )
  return result.meta.changes > 0
}

/** Deletes the owner's own pending suggestion (its links go with it). False when nothing was deleted. */
export async function deleteOwnerSuggestedChoice(db: Db, projectId: string, choiceId: string, userId: string): Promise<boolean> {
  const result = await db.delete(projectSelectionChoices).where(ownSuggestion(projectId, choiceId, userId)).run()
  return result.meta.changes > 0
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

/**
 * After copying several selections together (Duplicate room), keeps the
 * copies' follow-up links among themselves. Copying each selection with
 * copyChoicesToReplacementStatements already links a copied choice to the
 * copied follow-up (whichever of the two was copied first); it also leaves
 * a copied choice opening the original follow-up and an original choice
 * opening the copied follow-up. These deletes remove those two. `pairs` maps
 * each original selection to its copy; `fromChoiceIds` and `newChoiceIds`
 * are the copied choices.
 */
export function relinkDuplicatedDependentsStatements(
  db: Db,
  input: {
    readonly pairs: readonly { readonly fromId: string; readonly newId: string }[]
    readonly fromChoiceIds: readonly string[]
    readonly newChoiceIds: readonly string[]
  },
): BatchItem<"sqlite">[] {
  // D1 allows 100 bound values per statement, so long choice lists go in chunks.
  const chunks = (ids: readonly string[]): string[][] =>
    Array.from({ length: Math.ceil(ids.length / 90) }, (_, index) => ids.slice(index * 90, index * 90 + 90))
  return input.pairs.flatMap((pair) => [
    ...chunks(input.newChoiceIds).map((ids) =>
      db
        .delete(projectSelectionChoiceDependents)
        .where(and(eq(projectSelectionChoiceDependents.selectionId, pair.fromId), inArray(projectSelectionChoiceDependents.choiceId, ids))),
    ),
    ...chunks(input.fromChoiceIds).map((ids) =>
      db
        .delete(projectSelectionChoiceDependents)
        .where(and(eq(projectSelectionChoiceDependents.selectionId, pair.newId), inArray(projectSelectionChoiceDependents.choiceId, ids))),
    ),
  ])
}

/** Copied choices open no follow-ups (Duplicate selection: the copy is a sibling, not a second parent). */
export function dropChoiceFollowUpsStatements(db: Db, choiceIds: readonly string[]): BatchItem<"sqlite">[] {
  return Array.from({ length: Math.ceil(choiceIds.length / 90) }, (_, index) => choiceIds.slice(index * 90, index * 90 + 90)).map((ids) =>
    db.delete(projectSelectionChoiceDependents).where(inArray(projectSelectionChoiceDependents.choiceId, ids)),
  )
}
