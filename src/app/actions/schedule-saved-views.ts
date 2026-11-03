"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod/v4"

import { SAVED_VIEW_VISIBILITIES, type SavedViewVisibility } from "@/lib/domain/settings/statuses"

import { findOwnScheduleSavedViewId, listVisibleSavedViews } from "@/lib/domain/settings/saved-views"
import { deleteOwnScheduleSavedView, insertScheduleSavedView, updateScheduleSavedView } from "@/lib/domain/settings/store"
import { orgContext } from "@/lib/server/action-context"
import {
  scheduleViewDefinitionSchema,
  type SavedScheduleViewData,
  type ScheduleViewDefinition,
} from "@/lib/schedule/saved-views"
import { isInternalStaffRole } from "@/lib/user-roles"

const saveViewSchema = z.object({
  name: z.string().trim().min(1).max(80),
  visibility: z.enum(SAVED_VIEW_VISIBILITIES),
  definition: scheduleViewDefinitionSchema,
})

type SaveScheduleViewInput = {
  readonly name: string
  readonly visibility: SavedViewVisibility
  readonly definition: ScheduleViewDefinition
}

export async function getScheduleSavedViews(): Promise<
  readonly SavedScheduleViewData[]
> {
  try {
    const context = await orgContext()
    if (!context.success) throw new Error(context.error)
    const { db, organizationId, user } = context.data
    if (!isInternalStaffRole(user.role)) return []
    const rows = await listVisibleSavedViews(db, { organizationId, userId: user.id, scope: "schedule" })

    return rows.flatMap((row) => {
      let rawDefinition: unknown
      try {
        rawDefinition = JSON.parse(row.definition)
      } catch {
        return []
      }
      const parsedDefinition =
        scheduleViewDefinitionSchema.safeParse(rawDefinition)
      if (!parsedDefinition.success) return []
      return [
        {
          id: row.id,
          name: row.name,
          visibility: row.visibility,
          ownerUserId: row.ownerUserId,
          isOwner: row.ownerUserId === user.id,
          definition: parsedDefinition.data,
        },
      ]
    })
  } catch (error) {
    console.warn("Unable to load schedule saved views", error)
    return []
  }
}

export async function saveScheduleView(
  input: SaveScheduleViewInput
): Promise<
  | { readonly success: true; readonly view: SavedScheduleViewData }
  | { readonly success: false; readonly error: string }
> {
  const parsed = saveViewSchema.safeParse(input)
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "Review the saved view.",
    }
  }

  try {
    const context = await orgContext()
    if (!context.success) return context
    const { db, organizationId, user } = context.data
    if (!isInternalStaffRole(user.role)) {
      return { success: false, error: "Only internal staff can save views." }
    }
    const now = new Date().toISOString()
    const existingId = await findOwnScheduleSavedViewId(db, user.id, parsed.data.name)
    const id = existingId ?? crypto.randomUUID()

    if (existingId !== undefined) {
      await updateScheduleSavedView(db, id, {
        visibility: parsed.data.visibility,
        definition: JSON.stringify(parsed.data.definition),
        updatedAt: now,
      })
    } else {
      await insertScheduleSavedView(db, {
        id,
        organizationId,
        ownerUserId: user.id,
        name: parsed.data.name,
        visibility: parsed.data.visibility,
        definition: JSON.stringify(parsed.data.definition),
        createdAt: now,
        updatedAt: now,
      })
    }

    revalidatePath("/dashboard/schedule")
    return {
      success: true,
      view: {
        id,
        name: parsed.data.name,
        visibility: parsed.data.visibility,
        ownerUserId: user.id,
        isOwner: true,
        definition: parsed.data.definition,
      },
    }
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error ? error.message : "Unable to save this view.",
    }
  }
}

export async function deleteScheduleView(
  id: string
): Promise<
  { readonly success: true } | { readonly success: false; readonly error: string }
> {
  try {
    const context = await orgContext()
    if (!context.success) return context
    const { db, organizationId, user } = context.data
    await deleteOwnScheduleSavedView(db, { id, organizationId, ownerUserId: user.id })
    revalidatePath("/dashboard/schedule")
    return { success: true }
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error ? error.message : "Unable to delete this view.",
    }
  }
}
