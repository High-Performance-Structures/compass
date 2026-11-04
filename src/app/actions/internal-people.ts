"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod/v4"

import { actionFailure, type ActionResult } from "@/lib/action-result"
import { recordActivityEvent } from "@/lib/activity-log"
import { saveInternalPerson, setInternalPersonArchived } from "@/lib/domain/contacts/internal-people"
import { can } from "@/lib/permissions"
import { orgContext } from "@/lib/server/action-context"

const personInput = z.object({
  personId: z.string().trim().min(1).max(200),
  name: z.string().trim().min(1).max(200),
  jobTitle: z.string().trim().max(200),
  email: z.union([z.literal(""), z.email().max(254)]),
  phone: z.string().trim().max(60),
  cellPhone: z.string().trim().max(60),
})

/**
 * Staff edit of an internal directory person (Contacts → Internal, active or
 * archived). Allowed until the person accepts a Compass invitation; a
 * Sage-linked employee's email and phones go through Propose Sage edit.
 * Nobody is invited, emailed or notified.
 */
export async function updateInternalDirectoryPerson(
  raw: z.input<typeof personInput>,
): Promise<ActionResult<{ readonly warning: string | null }>> {
  try {
    const parsed = personInput.safeParse({ ...raw, email: raw.email?.trim().toLowerCase() ?? "" })
    if (!parsed.success) return actionFailure("Enter a name and a valid email, or leave the email blank.")
    const input = parsed.data
    const context = await orgContext({ feature: "internal-directory", action: "update", mutation: true })
    if (!context.success) return context
    const { db, user, organizationId } = context.data
    const result = await saveInternalPerson(db, {
      organizationId,
      personId: input.personId,
      person: input,
      now: new Date().toISOString(),
    })
    if (!result.success) return result
    if (result.changed.length > 0) {
      await recordActivityEvent({
        db, organizationId, actor: user,
        category: "account",
        action: "internal_contact.updated",
        entityType: "internal_contact",
        entityId: input.personId,
        summary: `Updated ${result.name}'s contact information in the internal directory.`,
        metadata: { changed: [...result.changed] },
      })
      revalidatePath("/dashboard/contacts")
      revalidatePath("/dashboard/projects", "layout")
    }
    return { success: true, data: { warning: result.warning } }
  } catch (error) {
    console.error("Failed to update internal person", error)
    return actionFailure("Could not save this person.")
  }
}

/** Archive or restore an internal directory person; needs the directory's delete permission. */
export async function setInternalDirectoryPersonArchived(
  personId: string,
  archived: boolean,
): Promise<ActionResult<{ readonly name: string }>> {
  try {
    const id = z.string().trim().min(1).max(200).safeParse(personId)
    if (!id.success) return actionFailure("Choose a person.")
    const context = await orgContext({ feature: "internal-directory", action: "delete", mutation: true })
    if (!context.success) return context
    const { db, user, organizationId } = context.data
    if (!can(user, "user", "delete")) return actionFailure("You do not have permission to archive internal contacts.")
    const result = await setInternalPersonArchived(db, { organizationId, personId: id.data, archived, now: new Date().toISOString() })
    if (!result.success) return result
    await recordActivityEvent({
      db, organizationId, actor: user,
      category: "account",
      action: archived ? "internal_contact.archived" : "internal_contact.restored",
      entityType: "internal_contact",
      entityId: id.data,
      summary: `${archived ? "Archived" : "Restored"} ${result.name} in the internal directory.`,
    })
    revalidatePath("/dashboard/contacts")
    revalidatePath("/dashboard/projects", "layout")
    return { success: true, data: { name: result.name } }
  } catch (error) {
    console.error("Failed to archive internal person", error)
    return actionFailure("Could not update this person.")
  }
}
