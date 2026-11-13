"use server"

/*
 * Owner-suggested choices (owner decision 2026-11-13; rules in
 * src/lib/domain/selections/owner-suggestion-rules.ts). On a selection
 * published to them, an owner adds their own choice: a name, an optional
 * product link and a note. The link's page fills in the image and the
 * supplier price (staff-only), never the owner price: the choice is
 * "Suggested by owner" and "Pending staff pricing" until staff set the owner
 * price the normal way. The job's project manager gets a to-do to price it.
 * The owner may edit or delete only their own suggestion, and only until
 * staff price it. The company setting "Owners can suggest their own
 * choices" (Settings › Selections) turns it off. Every lock is checked
 * again inside the write (choices-store).
 */
import { revalidatePath } from "next/cache"

import { actionFailure, errorMessage, type ActionResult } from "@/lib/action-result"
import { recordActivityEvent } from "@/lib/activity-log"
import { selectionAccess } from "@/lib/domain/selections/access"
import { choiceInProject, nextChoiceSortOrder, ownerChoiceLinkUrl, pendingOwnerSuggestionCount, selectionApprovedByOwner, selectionInProject, selectionPublishedToOwner } from "@/lib/domain/selections/choices-read"
import { deleteOwnerSuggestedChoice as deleteSuggestionRow, insertOwnerSuggestedChoice, updateOwnerSuggestedChoice as updateSuggestionRow } from "@/lib/domain/selections/choices-store"
import { pickChangeBlocker } from "@/lib/domain/selections/lock-read"
import {
  OWNER_PENDING_SUGGESTIONS_MAX,
  OWNER_SUGGESTION_CAP_MESSAGE,
  parseOwnerSuggestion,
  type OwnerSuggestionInput,
} from "@/lib/domain/selections/owner-suggestion-rules"
import { ensureOwnerSuggestionTodo } from "@/lib/domain/selections/owner-suggestions"
import { readProjectSelectionSettings } from "@/lib/domain/selections/project-settings"
import { archiveOwnerSuggestionTodo } from "@/lib/domain/selections/selection-todos"
import { fetchLinkPreview, type LinkPreview } from "@/lib/selections/link-preview"

type Done = ActionResult<{ readonly id: string }>

const SETTING_OFF = "Your builder doesn't take suggested choices on this project. Ask a question on the selection instead."
const CONFIRMED = "You've already confirmed your choice for this selection. Ask your builder to reopen it."
const NOT_YOURS = "Only the owner who suggested this choice can change it, and only until your builder prices it."

function refresh(projectId: string): void {
  revalidatePath(`/dashboard/projects/${projectId}/selections`)
  revalidatePath(`/preview/projects/${projectId}/owner/selections`)
}

type Access = Awaited<ReturnType<typeof selectionAccess>>

/**
 * The owner's access to a selection published to them, with the company
 * setting on. Why not as `error`.
 */
async function ownerSuggestionAccess(
  projectId: string,
  selectionId: string,
): Promise<{ readonly ok: true; readonly access: Access; readonly organizationId: string | null; readonly selectionName: string } | { readonly ok: false; readonly error: string }> {
  const access = await selectionAccess(projectId, "owner", true)
  const selection = await selectionInProject(access.db, projectId, selectionId)
  if (!selection || !(await selectionPublishedToOwner(access.db, projectId, selectionId))) return { ok: false, error: "Selection not found" }
  const { organizationId, settings } = await readProjectSelectionSettings(access.db, projectId)
  if (!settings.ownerSuggestedChoices) return { ok: false, error: SETTING_OFF }
  return { ok: true, access, organizationId, selectionName: selection.name }
}

/** Why the owner can't add or change a suggestion on the selection now, or null (the write checks again). */
async function suggestionBlocker(access: Access, projectId: string, selectionId: string): Promise<string | null> {
  if (await selectionApprovedByOwner(access.db, projectId, selectionId)) return CONFIRMED
  return pickChangeBlocker(access.db, projectId, selectionId)
}

async function previewOf(url: string | null): Promise<LinkPreview | null> {
  return url ? fetchLinkPreview(url) : null
}

function linkRow(input: {
  readonly id: string
  readonly projectId: string
  readonly selectionId: string
  readonly choiceId: string
  readonly url: string
  readonly preview: LinkPreview
  readonly userId: string
  readonly now: string
}) {
  return {
    id: input.id,
    projectId: input.projectId,
    selectionId: input.selectionId,
    choiceId: input.choiceId,
    url: input.url,
    title: input.preview.title,
    imageUrl: input.preview.imageUrl,
    priceCents: input.preview.priceCents,
    siteName: input.preview.siteName,
    fetchedAt: input.now,
    addedByUserId: input.userId,
    addedByAudience: "owner" as const,
    createdAt: input.now,
  }
}

/** "Add my own choice": the owner's suggestion on a published selection, and the to-do to price it. */
export async function addOwnerSuggestedChoice(projectId: string, selectionId: string, input: OwnerSuggestionInput): Promise<Done> {
  try {
    const parsed = parseOwnerSuggestion(input)
    if (!parsed.ok) return { success: false, error: parsed.error }
    const allowed = await ownerSuggestionAccess(projectId, selectionId)
    if (!allowed.ok) return { success: false, error: allowed.error }
    const { access } = allowed
    const blocked = await suggestionBlocker(access, projectId, selectionId)
    if (blocked) return { success: false, error: blocked }
    // The write checks the cap again.
    if ((await pendingOwnerSuggestionCount(access.db, selectionId, access.user.id)) >= OWNER_PENDING_SUGGESTIONS_MAX) {
      return { success: false, error: OWNER_SUGGESTION_CAP_MESSAGE }
    }

    const preview = await previewOf(parsed.value.url)
    const id = crypto.randomUUID()
    const now = new Date().toISOString()
    const kept = await insertOwnerSuggestedChoice(
      access.db,
      {
        id,
        projectId,
        selectionId,
        title: parsed.value.title,
        description: parsed.value.description,
        // The product page's price is the supplier price (staff-only). The
        // owner price stays empty until staff set it: never the website price.
        priceCents: preview?.priceCents ?? null,
        ownerPriceCents: null,
        status: "proposed",
        sortOrder: await nextChoiceSortOrder(access.db, selectionId),
        suggestedByUserId: access.user.id,
        suggestedAt: now,
        ownerPricingPending: true,
        createdBy: access.user.id,
        createdAt: now,
        updatedAt: now,
      },
      parsed.value.url && preview
        ? linkRow({ id: crypto.randomUUID(), projectId, selectionId, choiceId: id, url: parsed.value.url, preview, userId: access.user.id, now })
        : null,
    )
    if (!kept) {
      const why = await suggestionBlocker(access, projectId, selectionId)
      if (why) return { success: false, error: why }
      if ((await pendingOwnerSuggestionCount(access.db, selectionId, access.user.id)) >= OWNER_PENDING_SUGGESTIONS_MAX) {
        return { success: false, error: OWNER_SUGGESTION_CAP_MESSAGE }
      }
      return { success: false, error: "This selection can't take a new choice now. Refresh and try again." }
    }
    // The choice is saved: a failed to-do is logged, not reported to the
    // owner (a retry would add the choice twice). Staff still see it pending.
    try {
      await ensureOwnerSuggestionTodo(access.db, {
        projectId,
        organizationId: allowed.organizationId,
        selectionId,
        selectionName: allowed.selectionName,
        choiceId: id,
        choiceTitle: parsed.value.title,
        actorId: access.user.id,
        now,
      })
    } catch (error) {
      console.error("Unable to create the pricing to-do for an owner's suggested choice", { projectId, selectionId, choiceId: id, error })
    }
    if (allowed.organizationId) {
      await recordActivityEvent({
        db: access.db,
        organizationId: allowed.organizationId,
        projectId,
        actor: access.user,
        category: "field",
        action: "selection_owner_choice_suggested",
        entityType: "project_finish_selection",
        entityId: selectionId,
        summary: `${access.actorName} suggested their own choice for ${allowed.selectionName}: ${parsed.value.title}. Pending staff pricing.`,
        metadata: { choiceId: id, url: parsed.value.url },
        createdAt: now,
      })
    }
    refresh(projectId)
    return { success: true, data: { id } }
  } catch (error) {
    return actionFailure(errorMessage(error, "Unable to add your choice."))
  }
}

/**
 * The owner edits their own suggestion until staff price it. A new product
 * link replaces the one they added (its page sets the supplier price again);
 * a blank link removes it.
 */
export async function updateOwnerSuggestedChoice(projectId: string, choiceId: string, input: OwnerSuggestionInput): Promise<Done> {
  try {
    const parsed = parseOwnerSuggestion(input)
    if (!parsed.ok) return { success: false, error: parsed.error }
    const access = await selectionAccess(projectId, "owner", true)
    const choice = await choiceInProject(access.db, projectId, choiceId)
    if (!choice) return { success: false, error: "Choice not found" }
    const allowed = await ownerSuggestionAccess(projectId, choice.selectionId)
    if (!allowed.ok) return { success: false, error: allowed.error }
    if (choice.suggestedByUserId !== access.user.id || !choice.ownerPricingPending) return { success: false, error: NOT_YOURS }
    const blocked = await suggestionBlocker(access, projectId, choice.selectionId)
    if (blocked) return { success: false, error: blocked }

    const now = new Date().toISOString()
    const currentUrl = await ownerChoiceLinkUrl(access.db, projectId, choiceId, access.user.id)
    // The link changes only when the owner typed a different one.
    const linkChanged = (parsed.value.url ?? null) !== currentUrl
    const preview = linkChanged ? await previewOf(parsed.value.url) : null
    const saved = await updateSuggestionRow(access.db, {
      projectId,
      choiceId,
      userId: access.user.id,
      patch: {
        title: parsed.value.title,
        description: parsed.value.description,
        ...(linkChanged ? { priceCents: preview?.priceCents ?? null } : {}),
        updatedAt: now,
      },
      ...(linkChanged
        ? {
            link:
              parsed.value.url && preview
                ? linkRow({ id: crypto.randomUUID(), projectId, selectionId: choice.selectionId, choiceId, url: parsed.value.url, preview, userId: access.user.id, now })
                : null,
          }
        : {}),
    })
    if (!saved) {
      const why = await suggestionBlocker(access, projectId, choice.selectionId)
      return { success: false, error: why ?? NOT_YOURS }
    }
    refresh(projectId)
    return { success: true, data: { id: choiceId } }
  } catch (error) {
    return actionFailure(errorMessage(error, "Unable to save your choice."))
  }
}

/** The owner deletes their own suggestion until staff price it; its pricing to-do is archived. */
export async function deleteOwnerSuggestedChoice(projectId: string, choiceId: string): Promise<Done> {
  try {
    const access = await selectionAccess(projectId, "owner", true)
    const choice = await choiceInProject(access.db, projectId, choiceId)
    if (!choice) return { success: false, error: "Choice not found" }
    const allowed = await ownerSuggestionAccess(projectId, choice.selectionId)
    if (!allowed.ok) return { success: false, error: allowed.error }
    if (choice.suggestedByUserId !== access.user.id || !choice.ownerPricingPending) return { success: false, error: NOT_YOURS }
    const blocked = await suggestionBlocker(access, projectId, choice.selectionId)
    if (blocked) return { success: false, error: blocked }
    if (!(await deleteSuggestionRow(access.db, projectId, choiceId, access.user.id))) {
      const why = await suggestionBlocker(access, projectId, choice.selectionId)
      return { success: false, error: why ?? NOT_YOURS }
    }
    const now = new Date().toISOString()
    await archiveOwnerSuggestionTodo(access.db, projectId, choice.selectionId, choiceId, now)
    if (allowed.organizationId) {
      await recordActivityEvent({
        db: access.db,
        organizationId: allowed.organizationId,
        projectId,
        actor: access.user,
        category: "field",
        action: "selection_owner_choice_suggestion_deleted",
        entityType: "project_finish_selection",
        entityId: choice.selectionId,
        summary: `${access.actorName} deleted their suggested choice for ${allowed.selectionName}: ${choice.title}.`,
        metadata: { choiceId },
        createdAt: now,
      })
    }
    refresh(projectId)
    return { success: true, data: { id: choiceId } }
  } catch (error) {
    return actionFailure(errorMessage(error, "Unable to delete your choice."))
  }
}
