/**
 * Reads for the rows under a finish selection: choices, supplier links,
 * photos, comments and follow-up selections, shaped for staff or the owner.
 * Callers resolve access first; every query is scoped to the project.
 *
 * Owners see the selection's choices with the owner price staff set (supplier
 * price plus builder fee), never the supplier or the supplier price, only
 * owner-visible photos, and only owner-visible comments.
 */
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm"
import { alias } from "drizzle-orm/sqlite-core"

import { dailyLogPhotos, projectFinishSelections, users, vendors } from "@/db/schema"
import {
  projectSelectionChoiceDependents,
  projectSelectionChoices,
  projectSelectionComments,
  projectSelectionLinks,
  projectSelectionPhotos,
} from "@/db/schema-selection-choices"
import { projectSelectionDecisions } from "@/db/schema-selection-decisions"
import type { Db } from "@/lib/server/action-context"

// The person who made a choice's current pick.
const chooser = alias(users, "chooser")

import { commentVisibleTo } from "./choice-rules"
import type { SelectionAuthorAudience, SelectionChoiceStatus, SelectionCommentVisibility } from "./statuses"

export type SelectionLinkView = {
  readonly id: string
  readonly choiceId: string | null
  readonly url: string
  readonly title: string | null
  readonly imageUrl: string | null
  readonly priceCents: number | null
  readonly siteName: string | null
  readonly addedByAudience: SelectionAuthorAudience
}

export type SelectionPhotoView = {
  readonly linkId: string
  readonly photoId: string
  readonly choiceId: string | null
  readonly fileName: string
  readonly thumbnailUrl: string | null
  readonly driveUrl: string | null
}

export type SelectionChoiceView = {
  readonly id: string
  readonly title: string
  readonly description: string | null
  /** Null for owners (supplier price stays staff-only) and when unpriced. */
  readonly priceCents: number | null
  /** What the owner sees; null until staff price it for the owner. */
  readonly ownerPriceCents: number | null
  readonly leadTimeDays: number | null
  readonly vendorId: string | null
  readonly vendorName: string | null
  readonly supplierName: string | null
  readonly sortOrder: number
  readonly chosen: boolean
  /** Who made the current pick (staff picking for the owner, or the owner), when, and the staff note. */
  readonly chosenByName: string | null
  readonly chosenByAudience: SelectionAuthorAudience | null
  readonly chosenAt: string | null
  readonly chosenNote: string | null
  readonly status: SelectionChoiceStatus
  readonly sourceSystem: string
  readonly links: readonly SelectionLinkView[]
  readonly photos: readonly SelectionPhotoView[]
  readonly dependentSelectionIds: readonly string[]
}

export type SelectionCommentView = {
  readonly id: string
  readonly body: string
  readonly visibility: SelectionCommentVisibility
  readonly authorAudience: SelectionAuthorAudience
  readonly authorName: string
  readonly sourceSystem: string
  readonly createdAt: string
  /** Staff may delete any comment; an owner only their own. */
  readonly canDelete: boolean
}

export type SelectionChoicesPanel = {
  readonly selectionId: string
  readonly choices: readonly SelectionChoiceView[]
  /** Links and photos on the selection itself, not on one choice. */
  readonly selectionLinks: readonly SelectionLinkView[]
  readonly selectionPhotos: readonly SelectionPhotoView[]
  readonly comments: readonly SelectionCommentView[]
}

/** The selection's id when it belongs to the project, else null. */
export async function selectionInProject(
  db: Db,
  projectId: string,
  selectionId: string,
): Promise<{ readonly id: string; readonly name: string; readonly category: string } | null> {
  const row = await db
    .select({ id: projectFinishSelections.id, name: projectFinishSelections.name, category: projectFinishSelections.category })
    .from(projectFinishSelections)
    .where(and(eq(projectFinishSelections.id, selectionId), eq(projectFinishSelections.projectId, projectId)))
    .get()
  return row ?? null
}

/** The choice with its selection, when it belongs to the project. */
export async function choiceInProject(
  db: Db,
  projectId: string,
  choiceId: string,
): Promise<{ readonly id: string; readonly selectionId: string } | null> {
  const row = await db
    .select({ id: projectSelectionChoices.id, selectionId: projectSelectionChoices.selectionId })
    .from(projectSelectionChoices)
    .where(and(eq(projectSelectionChoices.id, choiceId), eq(projectSelectionChoices.projectId, projectId)))
    .get()
  return row ?? null
}

export async function selectionChoiceIds(db: Db, selectionId: string): Promise<readonly string[]> {
  const rows = await db
    .select({ id: projectSelectionChoices.id })
    .from(projectSelectionChoices)
    .where(eq(projectSelectionChoices.selectionId, selectionId))
    .orderBy(asc(projectSelectionChoices.sortOrder))
  return rows.map((row) => row.id)
}

/** The next sort_order at the end of a selection's choices. */
export async function nextChoiceSortOrder(db: Db, selectionId: string): Promise<number> {
  const ids = await selectionChoiceIds(db, selectionId)
  return ids.length
}

export async function loadSelectionChoicesPanel(
  db: Db,
  projectId: string,
  selectionId: string,
  audience: "staff" | "owner",
  viewerUserId: string,
): Promise<SelectionChoicesPanel> {
  const panels = await loadChoicePanels(db, projectId, [selectionId], audience, viewerUserId)
  return panels[0] ?? { selectionId, choices: [], selectionLinks: [], selectionPhotos: [], comments: [] }
}

/** Panels for several selections of one project, in the order given, with one query per kind of row. */
export async function loadChoicePanels(
  db: Db,
  projectId: string,
  selectionIds: readonly string[],
  audience: "staff" | "owner",
  viewerUserId: string,
): Promise<readonly SelectionChoicesPanel[]> {
  if (selectionIds.length === 0) return []
  const ids = [...selectionIds]
  const staff = audience === "staff"
  const [choices, links, photos, comments, dependents] = await Promise.all([
    db
      .select({
        id: projectSelectionChoices.id,
        selectionId: projectSelectionChoices.selectionId,
        title: projectSelectionChoices.title,
        description: projectSelectionChoices.description,
        priceCents: projectSelectionChoices.priceCents,
        ownerPriceCents: projectSelectionChoices.ownerPriceCents,
        leadTimeDays: projectSelectionChoices.leadTimeDays,
        vendorId: projectSelectionChoices.vendorId,
        vendorName: vendors.name,
        supplierName: projectSelectionChoices.supplierName,
        sortOrder: projectSelectionChoices.sortOrder,
        chosen: projectSelectionChoices.chosen,
        chosenByName: chooser.displayName,
        chosenByEmail: chooser.email,
        chosenByAudience: projectSelectionChoices.chosenByAudience,
        chosenAt: projectSelectionChoices.chosenAt,
        chosenNote: projectSelectionChoices.chosenNote,
        status: projectSelectionChoices.status,
        sourceSystem: projectSelectionChoices.sourceSystem,
      })
      .from(projectSelectionChoices)
      .leftJoin(vendors, eq(vendors.id, projectSelectionChoices.vendorId))
      .leftJoin(chooser, eq(chooser.id, projectSelectionChoices.chosenByUserId))
      .where(and(eq(projectSelectionChoices.projectId, projectId), inArray(projectSelectionChoices.selectionId, ids)))
      .orderBy(asc(projectSelectionChoices.sortOrder), asc(projectSelectionChoices.createdAt)),
    db
      .select()
      .from(projectSelectionLinks)
      .where(and(eq(projectSelectionLinks.projectId, projectId), inArray(projectSelectionLinks.selectionId, ids)))
      .orderBy(asc(projectSelectionLinks.createdAt)),
    db
      .select({
        linkId: projectSelectionPhotos.id,
        selectionId: projectSelectionPhotos.selectionId,
        photoId: projectSelectionPhotos.photoId,
        choiceId: projectSelectionPhotos.choiceId,
        fileName: dailyLogPhotos.fileName,
        thumbnailUrl: dailyLogPhotos.thumbnailUrl,
        driveUrl: dailyLogPhotos.driveUrl,
        ownerVisible: dailyLogPhotos.ownerVisible,
      })
      .from(projectSelectionPhotos)
      .innerJoin(dailyLogPhotos, eq(dailyLogPhotos.id, projectSelectionPhotos.photoId))
      .where(and(eq(projectSelectionPhotos.projectId, projectId), inArray(projectSelectionPhotos.selectionId, ids)))
      .orderBy(asc(projectSelectionPhotos.sortOrder), asc(projectSelectionPhotos.createdAt)),
    db
      .select({
        id: projectSelectionComments.id,
        selectionId: projectSelectionComments.selectionId,
        body: projectSelectionComments.body,
        visibility: projectSelectionComments.visibility,
        authorAudience: projectSelectionComments.authorAudience,
        authorUserId: projectSelectionComments.authorUserId,
        authorDisplayName: users.displayName,
        authorEmail: users.email,
        authorNameSnapshot: projectSelectionComments.authorNameSnapshot,
        sourceSystem: projectSelectionComments.sourceSystem,
        createdAt: projectSelectionComments.createdAt,
      })
      .from(projectSelectionComments)
      .leftJoin(users, eq(users.id, projectSelectionComments.authorUserId))
      .where(and(eq(projectSelectionComments.projectId, projectId), inArray(projectSelectionComments.selectionId, ids)))
      .orderBy(asc(projectSelectionComments.createdAt)),
    db
      .select({ choiceId: projectSelectionChoiceDependents.choiceId, selectionId: projectSelectionChoiceDependents.selectionId })
      .from(projectSelectionChoiceDependents)
      .innerJoin(projectSelectionChoices, eq(projectSelectionChoices.id, projectSelectionChoiceDependents.choiceId))
      .where(and(eq(projectSelectionChoices.projectId, projectId), inArray(projectSelectionChoices.selectionId, ids))),
  ])

  const linkViews = links.map((link): SelectionLinkView & { readonly selectionId: string } => ({
    selectionId: link.selectionId,
    id: link.id,
    choiceId: link.choiceId,
    url: link.url,
    title: link.title,
    imageUrl: link.imageUrl,
    priceCents: link.priceCents,
    siteName: link.siteName,
    addedByAudience: link.addedByAudience,
  }))
  const photoViews = photos
    .filter((photo) => staff || photo.ownerVisible)
    .map((photo): SelectionPhotoView & { readonly selectionId: string } => ({
      selectionId: photo.selectionId,
      linkId: photo.linkId,
      photoId: photo.photoId,
      choiceId: photo.choiceId,
      fileName: photo.fileName,
      thumbnailUrl: photo.thumbnailUrl,
      driveUrl: photo.driveUrl,
    }))

  return ids.map((selectionId) => ({
    selectionId,
    choices: choices.filter((choice) => choice.selectionId === selectionId).map(({ chosenByEmail, ...choice }): SelectionChoiceView => ({
      ...choice,
      chosenByName: choice.chosenByName ?? chosenByEmail,
      // Owners see that they picked it, not staff notes.
      chosenNote: staff ? choice.chosenNote : null,
      priceCents: staff ? choice.priceCents : null,
      vendorId: staff ? choice.vendorId : null,
      vendorName: staff ? choice.vendorName : null,
      supplierName: staff ? choice.supplierName : null,
      links: linkViews.filter((link) => link.choiceId === choice.id),
      photos: photoViews.filter((photo) => photo.choiceId === choice.id),
      dependentSelectionIds: dependents.filter((row) => row.choiceId === choice.id).map((row) => row.selectionId),
    })),
    selectionLinks: linkViews.filter((link) => link.choiceId === null && link.selectionId === selectionId),
    selectionPhotos: photoViews.filter((photo) => photo.choiceId === null && photo.selectionId === selectionId),
    comments: comments
      .filter((comment) => comment.selectionId === selectionId && commentVisibleTo(audience, comment.visibility))
      .map((comment): SelectionCommentView => ({
        id: comment.id,
        body: comment.body,
        visibility: comment.visibility,
        authorAudience: comment.authorAudience,
        authorName: comment.authorDisplayName ?? comment.authorNameSnapshot ?? comment.authorEmail ?? "Unknown",
        sourceSystem: comment.sourceSystem,
        createdAt: comment.createdAt,
        canDelete: staff || (comment.authorUserId === viewerUserId && comment.sourceSystem === "compass"),
      })),
  }))
}

/** Project photos a staff member can attach (newest first, capped). */
export async function loadAttachablePhotos(
  db: Db,
  projectId: string,
  limit = 200,
): Promise<readonly { readonly id: string; readonly fileName: string; readonly thumbnailUrl: string | null }[]> {
  return db
    .select({ id: dailyLogPhotos.id, fileName: dailyLogPhotos.fileName, thumbnailUrl: dailyLogPhotos.thumbnailUrl })
    .from(dailyLogPhotos)
    .where(eq(dailyLogPhotos.projectId, projectId))
    .orderBy(desc(dailyLogPhotos.createdAt))
    .limit(limit)
}

/** Which of these photo ids belong to the project. */
export async function projectPhotoIds(db: Db, projectId: string, photoIds: readonly string[]): Promise<ReadonlySet<string>> {
  if (photoIds.length === 0) return new Set()
  const rows = await db
    .select({ id: dailyLogPhotos.id })
    .from(dailyLogPhotos)
    .where(and(eq(dailyLogPhotos.projectId, projectId), inArray(dailyLogPhotos.id, [...photoIds])))
  return new Set(rows.map((row) => row.id))
}

/** Which of these selection ids belong to the project. */
export async function projectSelectionIds(db: Db, projectId: string, selectionIds: readonly string[]): Promise<ReadonlySet<string>> {
  if (selectionIds.length === 0) return new Set()
  const rows = await db
    .select({ id: projectFinishSelections.id })
    .from(projectFinishSelections)
    .where(and(eq(projectFinishSelections.projectId, projectId), inArray(projectFinishSelections.id, [...selectionIds])))
  return new Set(rows.map((row) => row.id))
}

/** A vendor of the organization that has not been merged away, or null. */
export async function activeVendorInOrganization(db: Db, organizationId: string, vendorId: string): Promise<string | null> {
  const row = await db
    .select({ id: vendors.id })
    .from(vendors)
    .where(and(eq(vendors.id, vendorId), eq(vendors.organizationId, organizationId), isNull(vendors.mergedIntoVendorId)))
    .get()
  return row?.id ?? null
}

/** The comment's author and origin, scoped to the project. */
export async function commentInProject(
  db: Db,
  projectId: string,
  commentId: string,
): Promise<{ readonly authorUserId: string | null; readonly sourceSystem: string } | null> {
  const row = await db
    .select({ authorUserId: projectSelectionComments.authorUserId, sourceSystem: projectSelectionComments.sourceSystem })
    .from(projectSelectionComments)
    .where(and(eq(projectSelectionComments.id, commentId), eq(projectSelectionComments.projectId, projectId)))
    .get()
  return row ?? null
}

/** The link's author audience and user, scoped to the project. */
export async function linkInProject(
  db: Db,
  projectId: string,
  linkId: string,
): Promise<{ readonly addedByUserId: string | null } | null> {
  const row = await db
    .select({ addedByUserId: projectSelectionLinks.addedByUserId })
    .from(projectSelectionLinks)
    .where(and(eq(projectSelectionLinks.id, linkId), eq(projectSelectionLinks.projectId, projectId)))
    .get()
  return row ?? null
}

/** Owners only reach a selection's rows once staff have published it to them. */
export async function selectionPublishedToOwner(db: Db, projectId: string, selectionId: string): Promise<boolean> {
  const row = await db
    .select({ published: projectSelectionDecisions.published })
    .from(projectSelectionDecisions)
    .where(and(eq(projectSelectionDecisions.selectionId, selectionId), eq(projectSelectionDecisions.projectId, projectId)))
    .get()
  return row?.published === true
}

/** Whether the owner has approved the selection's published decision. */
export async function selectionApprovedByOwner(db: Db, projectId: string, selectionId: string): Promise<boolean> {
  const row = await db
    .select({ approvedAt: projectSelectionDecisions.approvedAt })
    .from(projectSelectionDecisions)
    .where(and(eq(projectSelectionDecisions.selectionId, selectionId), eq(projectSelectionDecisions.projectId, projectId)))
    .get()
  return Boolean(row?.approvedAt)
}
