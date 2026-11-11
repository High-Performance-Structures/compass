"use server"

import { and, eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import { projectFinishSelections } from "@/db/schema"
import { projectSelectionChoices } from "@/db/schema-selection-choices"

import { actionFailure, errorMessage, type ActionFailure, type ActionResult } from "@/lib/action-result"
import { selectionAccess, staffSelectionContext } from "@/lib/domain/selections/access"
import {
  cleanDependentSelectionIds,
  commentVisibilityFor,
  parseCommentBody,
  parseSelectionChoiceInput,
  validChoiceOrder,
  withSelectionDefaults,
  type SelectionChoiceInput,
} from "@/lib/domain/selections/choice-rules"
import { categoryLeadTimeDays } from "@/lib/feature-settings/selection-settings"
import { readFeatureSettings } from "@/lib/feature-settings/server"
import {
  activeVendorInOrganization,
  choiceInProject,
  commentInProject,
  linkInProject,
  loadAttachablePhotos,
  loadSelectionChoicesPanel,
  nextChoiceSortOrder,
  projectPhotoIds,
  projectSelectionIds,
  selectionChoiceIds,
  selectionInProject,
  selectionApprovedByOwner,
  selectionPublishedToOwner,
  type SelectionChoicesPanel,
} from "@/lib/domain/selections/choices-read"
import { loadLeadTimeContext, loadSelectionLeadTimeWarnings } from "@/lib/domain/selections/lead-time-read"
import type { SelectionLeadTimeWarning } from "@/lib/domain/selections/lead-time-rules"
import { loadOwnerChoiceBoard, type OwnerBoardSelection } from "@/lib/domain/selections/owner-board-read"
import { selectionPickIsSigned } from "@/lib/domain/selections/round-signing"
import { checkRoundsReady, loadRoundCards, type RoundCard } from "@/lib/domain/selections/rounds-server"
import { updateFinishSelections } from "@/lib/domain/selections/store"
import {
  loadDraftRfqOptions,
  loadSelectionRfqs,
  loadSelectionSheet,
  loadSupplierOptions,
  type DraftRfqOption,
  type SelectionRfqView,
  type SupplierOption,
} from "@/lib/domain/selections/selection-sheet-read"
import { ensureSelectionTodo, loadSelectionTodos, type SelectionTodoView } from "@/lib/domain/selections/selection-todos"
import {
  deleteSelectionChoice as deleteChoiceRow,
  deleteSelectionComment as deleteCommentRow,
  deleteSelectionLink as deleteLinkRow,
  deleteSelectionPhotoLinks,
  insertSelectionChoice,
  insertSelectionComment,
  insertSelectionLink,
  insertSelectionPhotos,
  reorderSelectionChoices as reorderChoiceRows,
  replaceChoiceDependents,
  setSelectionChoiceChosen as setChosenRow,
  updateSelectionChoice,
} from "@/lib/domain/selections/choices-store"
import { fetchLinkPreview, normalizeSupplierUrl } from "@/lib/selections/link-preview"
import type { SelectionSheetRow } from "@/lib/selections/sheet"
import { readSelectionStatusLabels } from "@/lib/domain/selections/status-labels-server"
import type { SelectionStatusLabels } from "@/lib/domain/selections/status-labels"

/*
 * Choices, supplier links, photo links, comments and follow-up selections
 * under one finish selection. Staff manage everything through the staff
 * selections rule; owners (on a selection published to them) can read the
 * owner view and add supplier links and owner-visible comments. Reads and
 * rules live in src/lib/domain/selections; writes go through choices-store.
 */

type Audience = "staff" | "owner"
type Done = ActionResult<{ readonly id: string }>

function refresh(projectId: string): void {
  revalidatePath(`/dashboard/projects/${projectId}/selections`)
  revalidatePath(`/preview/projects/${projectId}/owner/selections`)
}

function failure(error: unknown, fallback: string): ActionFailure {
  return actionFailure(errorMessage(error, fallback))
}

/** Resolves the reader or writer for either audience; owners need a published selection. */
async function audienceAccess(
  projectId: string,
  selectionId: string,
  audience: Audience,
  write: boolean,
): Promise<{ readonly db: Awaited<ReturnType<typeof selectionAccess>>["db"]; readonly userId: string }> {
  if (audience === "staff") {
    const context = await staffSelectionContext(projectId, write ? "update" : "read")
    if (!(await selectionInProject(context.db, projectId, selectionId))) throw new Error("Selection not found")
    return { db: context.db, userId: context.user.id }
  }
  const access = await selectionAccess(projectId, "owner", write)
  if (!(await selectionPublishedToOwner(access.db, projectId, selectionId))) throw new Error("Selection not found")
  return { db: access.db, userId: access.user.id }
}

async function staffChoice(projectId: string, choiceId: string) {
  const context = await staffSelectionContext(projectId, "update")
  const choice = await choiceInProject(context.db, projectId, choiceId)
  if (!choice) throw new Error("Choice not found")
  return { ...context, choice }
}

/** The selection's current pick, or null. */
async function currentPickId(db: Awaited<ReturnType<typeof staffSelectionContext>>["db"], selectionId: string): Promise<string | null> {
  const row = await db
    .select({ id: projectSelectionChoices.id })
    .from(projectSelectionChoices)
    .where(and(eq(projectSelectionChoices.selectionId, selectionId), eq(projectSelectionChoices.chosen, true)))
    .get()
  return row?.id ?? null
}

// ---- reads

export async function getSelectionChoicesPanel(
  projectId: string,
  selectionId: string,
  audience: Audience = "staff",
): Promise<ActionResult<SelectionChoicesPanel>> {
  try {
    const { db, userId } = await audienceAccess(projectId, selectionId, audience, false)
    return { success: true, data: await loadSelectionChoicesPanel(db, projectId, selectionId, audience, userId) }
  } catch (error) {
    return failure(error, "Unable to load choices.")
  }
}

export type SelectionDetail = {
  readonly panel: SelectionChoicesPanel
  readonly todos: readonly SelectionTodoView[]
  readonly rfqs: readonly SelectionRfqView[]
  readonly draftRfqs: readonly DraftRfqOption[]
}

/** Everything the staff detail panel shows for one selection. */
export async function getSelectionDetail(projectId: string, selectionId: string): Promise<ActionResult<SelectionDetail>> {
  try {
    const { db, userId } = await audienceAccess(projectId, selectionId, "staff", false)
    const [panel, todos, rfqs, draftRfqs] = await Promise.all([
      loadSelectionChoicesPanel(db, projectId, selectionId, "staff", userId),
      loadSelectionTodos(db, projectId, selectionId),
      loadSelectionRfqs(db, projectId, selectionId),
      loadDraftRfqOptions(db, projectId),
    ])
    return { success: true, data: { panel, todos, rfqs, draftRfqs } }
  } catch (error) {
    return failure(error, "Unable to load the selection.")
  }
}

/** Recent project photos staff can attach to a selection or choice. */
export async function getAttachableSelectionPhotos(
  projectId: string,
): Promise<ActionResult<readonly { readonly id: string; readonly fileName: string; readonly thumbnailUrl: string | null }[]>> {
  try {
    const { db } = await staffSelectionContext(projectId, "read")
    return { success: true, data: await loadAttachablePhotos(db, projectId) }
  } catch (error) {
    return failure(error, "Unable to load photos.")
  }
}

// ---- choices (staff)

export async function saveSelectionChoice(
  projectId: string,
  selectionId: string,
  choiceId: string | null,
  input: SelectionChoiceInput,
): Promise<Done> {
  try {
    const parsed = parseSelectionChoiceInput(input)
    if (!parsed.ok) return { success: false, error: parsed.error }
    const context = await staffSelectionContext(projectId, "update")
    const { db } = context
    const selection = await selectionInProject(db, projectId, selectionId)
    if (!selection) return { success: false, error: "Selection not found" }
    const settings = await readFeatureSettings(db, context.organizationId, "selections")
    const value = withSelectionDefaults(parsed.value, {
      ownerMarkupPercent: settings.ownerMarkupPercent,
      categoryLeadTimeDays: categoryLeadTimeDays(settings, selection.category),
      isNew: choiceId === null,
    })
    if (value.vendorId && !(await activeVendorInOrganization(db, context.organizationId, value.vendorId))) {
      return { success: false, error: "Supplier not found." }
    }
    const now = new Date().toISOString()
    if (choiceId) {
      const existing = await choiceInProject(db, projectId, choiceId)
      if (!existing || existing.selectionId !== selectionId) return { success: false, error: "Choice not found" }
      await updateSelectionChoice(db, projectId, choiceId, { ...value, updatedAt: now })
      refresh(projectId)
      return { success: true, data: { id: choiceId } }
    }
    const id = crypto.randomUUID()
    await insertSelectionChoice(db, {
      id,
      projectId,
      selectionId,
      ...value,
      sortOrder: await nextChoiceSortOrder(db, selectionId),
      createdBy: context.user.id,
      createdAt: now,
      updatedAt: now,
    })
    // An unpriced choice needs pricing: one open "Price choices" to-do per selection.
    if (value.priceCents === null) {
      await ensureSelectionTodo(db, { projectId, selectionId, selectionName: selection.name, step: "price_choices", actorId: context.user.id, now })
    }
    refresh(projectId)
    return { success: true, data: { id } }
  } catch (error) {
    return failure(error, "Unable to save the choice.")
  }
}

export async function deleteSelectionChoice(projectId: string, choiceId: string): Promise<Done> {
  try {
    const { db, user } = await staffChoice(projectId, choiceId)
    await deleteChoiceRow(db, projectId, choiceId)
    await checkRoundsReady(db, projectId, user.id)
    refresh(projectId)
    return { success: true, data: { id: choiceId } }
  } catch (error) {
    return failure(error, "Unable to delete the choice.")
  }
}

/** Saves the order after a drag inside one selection; the list must name every choice once. */
export async function reorderSelectionChoices(projectId: string, selectionId: string, orderedIds: readonly string[]): Promise<Done> {
  try {
    const { db } = await staffSelectionContext(projectId, "update")
    if (!(await selectionInProject(db, projectId, selectionId))) return { success: false, error: "Selection not found" }
    if (!validChoiceOrder(await selectionChoiceIds(db, selectionId), orderedIds)) {
      return { success: false, error: "The choices changed; refresh and try again." }
    }
    await reorderChoiceRows(db, selectionId, orderedIds, new Date().toISOString())
    refresh(projectId)
    return { success: true, data: { id: selectionId } }
  } catch (error) {
    return failure(error, "Unable to reorder choices.")
  }
}

/**
 * Marks the choice the owner went with (clearing any other), or clears it.
 * Staff can set it at any time; the owner can change their pick on a
 * selection published to them until it is approved.
 */
export async function setSelectionChoiceChosen(
  projectId: string,
  choiceId: string,
  chosen: boolean,
  audience: Audience = "staff",
  /** Staff picking for the owner can say why (e.g. "per phone call"). */
  note: string | null = null,
): Promise<Done> {
  try {
    if (audience === "owner") {
      const access = await selectionAccess(projectId, "owner", true)
      const choice = await choiceInProject(access.db, projectId, choiceId)
      if (!choice || !(await selectionPublishedToOwner(access.db, projectId, choice.selectionId))) return { success: false, error: "Choice not found" }
      if (await selectionApprovedByOwner(access.db, projectId, choice.selectionId)) {
        return { success: false, error: "This selection is already approved. Ask your builder to reopen it." }
      }
      if (await selectionPickIsSigned(access.db, choice.selectionId, await currentPickId(access.db, choice.selectionId))) {
        return { success: false, error: "You've signed for this selection. Ask your builder to change it." }
      }
      await setChosenRow(access.db, choice.selectionId, choiceId, chosen, new Date().toISOString(), { userId: access.user.id, audience: "owner", note: null })
      await checkRoundsReady(access.db, projectId, access.user.id)
      refresh(projectId)
      return { success: true, data: { id: choiceId } }
    }
    const { db, choice, user } = await staffChoice(projectId, choiceId)
    const before = await currentPickId(db, choice.selectionId)
    const wasSigned = await selectionPickIsSigned(db, choice.selectionId, before)
    const now = new Date().toISOString()
    await setChosenRow(db, choice.selectionId, choiceId, chosen, now, {
      userId: user.id,
      audience: "staff",
      note: note?.trim().slice(0, 500) || null,
    })
    // Changing a signed pick reopens just this selection; the next round signature covers it.
    if (wasSigned && (!chosen || before !== choiceId)) {
      await updateFinishSelections(
        db,
        and(eq(projectFinishSelections.id, choice.selectionId), eq(projectFinishSelections.projectId, projectId)),
        { status: "owner_review", ownerApproved: false, approvedBy: null, approvedAt: null, updatedAt: now },
      )
    }
    await checkRoundsReady(db, projectId, user.id)
    refresh(projectId)
    return { success: true, data: { id: choiceId } }
  } catch (error) {
    return failure(error, "Unable to update the choice.")
  }
}

/** Replaces the follow-up selections this choice opens (same project only). */
export async function setChoiceDependentSelections(projectId: string, choiceId: string, selectionIds: readonly string[]): Promise<Done> {
  try {
    const { db, choice } = await staffChoice(projectId, choiceId)
    const ids = cleanDependentSelectionIds(choice.selectionId, selectionIds)
    const valid = await projectSelectionIds(db, projectId, ids)
    if (valid.size !== ids.length) return { success: false, error: "A follow-up selection was not found on this project." }
    await replaceChoiceDependents(db, choiceId, ids, new Date().toISOString())
    refresh(projectId)
    return { success: true, data: { id: choiceId } }
  } catch (error) {
    return failure(error, "Unable to save follow-up selections.")
  }
}

// ---- supplier links (staff or owner)

/**
 * Saves a supplier product link on the selection or one of its choices. The
 * preview card is read from the page server-side with a timeout; when the
 * page cannot be read the link is saved plain.
 */
export async function addSelectionLink(
  projectId: string,
  selectionId: string,
  choiceId: string | null,
  rawUrl: string,
  audience: Audience = "staff",
): Promise<Done> {
  try {
    const url = normalizeSupplierUrl(rawUrl)
    if (!url) return { success: false, error: "Enter a web address that starts with http:// or https://." }
    const { db, userId } = await audienceAccess(projectId, selectionId, audience, true)
    if (choiceId) {
      const choice = await choiceInProject(db, projectId, choiceId)
      if (!choice || choice.selectionId !== selectionId) return { success: false, error: "Choice not found" }
    }
    const preview = await fetchLinkPreview(url)
    const id = crypto.randomUUID()
    const now = new Date().toISOString()
    await insertSelectionLink(db, {
      id,
      projectId,
      selectionId,
      choiceId,
      url,
      title: preview.title,
      imageUrl: preview.imageUrl,
      priceCents: preview.priceCents,
      siteName: preview.siteName,
      fetchedAt: now,
      addedByUserId: userId,
      addedByAudience: audience,
      createdAt: now,
    })
    refresh(projectId)
    return { success: true, data: { id } }
  } catch (error) {
    return failure(error, "Unable to save the link.")
  }
}

/** Staff remove any link; an owner removes only a link they added. */
export async function deleteSelectionLink(projectId: string, selectionId: string, linkId: string, audience: Audience = "staff"): Promise<Done> {
  try {
    const { db, userId } = await audienceAccess(projectId, selectionId, audience, true)
    const link = await linkInProject(db, projectId, linkId)
    if (!link) return { success: false, error: "Link not found" }
    if (audience === "owner" && link.addedByUserId !== userId) return { success: false, error: "Only the person who added this link can remove it." }
    await deleteLinkRow(db, projectId, linkId)
    refresh(projectId)
    return { success: true, data: { id: linkId } }
  } catch (error) {
    return failure(error, "Unable to remove the link.")
  }
}

/**
 * "Save to Compass" from a supplier's product page: adds a new choice and
 * attaches the page as its supplier link, the same two steps as adding a
 * choice and then a link by hand. When the link cannot be saved the new
 * choice is removed again, so a failed save leaves nothing behind.
 */
export async function saveChoiceFromLink(
  projectId: string,
  selectionId: string,
  input: SelectionChoiceInput,
  rawUrl: string,
): Promise<Done> {
  if (!normalizeSupplierUrl(rawUrl)) return { success: false, error: "Enter a web address that starts with http:// or https://." }
  const choice = await saveSelectionChoice(projectId, selectionId, null, input)
  if (!choice.success) return choice
  const link = await addSelectionLink(projectId, selectionId, choice.data.id, rawUrl, "staff")
  if (link.success) return choice
  await deleteSelectionChoice(projectId, choice.data.id)
  return link
}

// ---- photos (staff)

/** Links existing project photos to the selection, or to one of its choices. */
export async function attachSelectionPhotos(
  projectId: string,
  selectionId: string,
  choiceId: string | null,
  photoIds: readonly string[],
): Promise<Done> {
  try {
    const context = await staffSelectionContext(projectId, "update")
    const { db } = context
    if (!(await selectionInProject(db, projectId, selectionId))) return { success: false, error: "Selection not found" }
    if (choiceId) {
      const choice = await choiceInProject(db, projectId, choiceId)
      if (!choice || choice.selectionId !== selectionId) return { success: false, error: "Choice not found" }
    }
    const ids = [...new Set(photoIds)]
    const valid = await projectPhotoIds(db, projectId, ids)
    if (valid.size !== ids.length) return { success: false, error: "A photo was not found on this project." }
    const now = new Date().toISOString()
    await insertSelectionPhotos(
      db,
      ids.map((photoId, index) => ({
        id: crypto.randomUUID(),
        projectId,
        selectionId,
        choiceId,
        photoId,
        sortOrder: index,
        addedBy: context.user.id,
        createdAt: now,
      })),
    )
    refresh(projectId)
    return { success: true, data: { id: selectionId } }
  } catch (error) {
    return failure(error, "Unable to attach photos.")
  }
}

/** Removes the photo from the selection; the photo itself stays on the project. */
export async function detachSelectionPhoto(projectId: string, photoLinkId: string): Promise<Done> {
  try {
    const { db } = await staffSelectionContext(projectId, "update")
    await deleteSelectionPhotoLinks(db, projectId, [photoLinkId])
    refresh(projectId)
    return { success: true, data: { id: photoLinkId } }
  } catch (error) {
    return failure(error, "Unable to remove the photo.")
  }
}

// ---- comments (staff or owner)

/** Staff choose owner-visible or staff-only; an owner's comment is always owner-visible. */
export async function addSelectionComment(
  projectId: string,
  selectionId: string,
  body: string,
  visibility: string,
  audience: Audience = "staff",
): Promise<Done> {
  try {
    const parsed = parseCommentBody(body)
    if (!parsed.ok) return { success: false, error: parsed.error }
    const allowed = commentVisibilityFor(audience, visibility)
    if (!allowed) return { success: false, error: "Choose who can see this comment." }
    const { db, userId } = await audienceAccess(projectId, selectionId, audience, true)
    const id = crypto.randomUUID()
    const now = new Date().toISOString()
    // Staff are told through a to-do; it carries the selection link.
    if (audience === "owner") {
      const selection = await selectionInProject(db, projectId, selectionId)
      if (selection) {
        await ensureSelectionTodo(db, { projectId, selectionId, selectionName: selection.name, step: "owner_question", actorId: userId, now })
      }
    }
    await insertSelectionComment(db, {
      id,
      projectId,
      selectionId,
      body: parsed.value,
      visibility: allowed,
      authorUserId: userId,
      authorAudience: audience,
      createdAt: now,
      updatedAt: now,
    })
    refresh(projectId)
    return { success: true, data: { id } }
  } catch (error) {
    return failure(error, "Unable to save the comment.")
  }
}

/** Staff delete any comment; an owner deletes only their own Compass comment. */
export async function deleteSelectionComment(projectId: string, selectionId: string, commentId: string, audience: Audience = "staff"): Promise<Done> {
  try {
    const { db, userId } = await audienceAccess(projectId, selectionId, audience, true)
    const comment = await commentInProject(db, projectId, commentId)
    if (!comment) return { success: false, error: "Comment not found" }
    if (audience === "owner" && (comment.authorUserId !== userId || comment.sourceSystem !== "compass")) {
      return { success: false, error: "Only the person who wrote this comment can delete it." }
    }
    await deleteCommentRow(db, projectId, commentId)
    refresh(projectId)
    return { success: true, data: { id: commentId } }
  } catch (error) {
    return failure(error, "Unable to delete the comment.")
  }
}

// ---- page reads

export type SelectionSheetData = {
  readonly rows: readonly SelectionSheetRow[]
  readonly suppliers: readonly SupplierOption[]
  /** The company's rounds as cards for this job (Settings > Selections). */
  readonly rounds: readonly RoundCard[]
  /** The company's selection status names, with defaults filled in. */
  readonly statusLabels: SelectionStatusLabels
  /** Selections at risk of arriving late because of a choice's lead time (Settings > Selections window). */
  readonly leadTimeWarnings: readonly SelectionLeadTimeWarning[]
}

/** The staff Selections sheet: every selection on the job plus the supplier list. Throws the access errors. */
export async function getSelectionSheet(projectId: string): Promise<SelectionSheetData> {
  const { db, organizationId } = await staffSelectionContext(projectId, "read")
  const [rows, suppliers, statusLabels] = await Promise.all([
    loadSelectionSheet(db, projectId),
    loadSupplierOptions(db, organizationId),
    readSelectionStatusLabels(db, organizationId),
  ])
  const rounds = await loadRoundCards(db, projectId, organizationId, rows)
  const leadTimeContext = await loadLeadTimeContext(db, {
    projectId,
    organizationId,
    phaseDueDates: new Map(rounds.map((round) => [round.key, round.dueDate])),
  })
  return { rows, suppliers, rounds, statusLabels, leadTimeWarnings: await loadSelectionLeadTimeWarnings(db, projectId, leadTimeContext) }
}

/** The owner's choosing view (staff may preview it). Throws the access errors. */
export async function getOwnerChoiceBoard(projectId: string): Promise<readonly OwnerBoardSelection[]> {
  const { db, user } = await selectionAccess(projectId, "owner")
  return loadOwnerChoiceBoard(db, projectId, user.id)
}
