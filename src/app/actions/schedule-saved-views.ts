"use server"

import { and, asc, eq, or } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { z } from "zod/v4"

import { getDb } from "@/db"
import { scheduleSavedViews } from "@/db/schema"
import { requireAuth } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import { requireOrg } from "@/lib/org-scope"
import {
  scheduleViewDefinitionSchema,
  type SavedScheduleViewData,
  type ScheduleViewDefinition,
} from "@/lib/schedule/saved-views"
import { isInternalStaffRole } from "@/lib/user-roles"

const saveViewSchema = z.object({
  name: z.string().trim().min(1).max(80),
  visibility: z.enum(["personal", "shared"]),
  definition: scheduleViewDefinitionSchema,
})

type SaveScheduleViewInput = {
  readonly name: string
  readonly visibility: "personal" | "shared"
  readonly definition: ScheduleViewDefinition
}

export async function getScheduleSavedViews(): Promise<
  readonly SavedScheduleViewData[]
> {
  try {
    const user = await requireAuth()
    if (!isInternalStaffRole(user.role)) return []
    const organizationId = requireOrg(user)
    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)
    const rows = await db
      .select()
      .from(scheduleSavedViews)
      .where(
        and(
          eq(scheduleSavedViews.organizationId, organizationId),
          or(
            eq(scheduleSavedViews.ownerUserId, user.id),
            eq(scheduleSavedViews.visibility, "shared")
          )
        )
      )
      .orderBy(asc(scheduleSavedViews.name))

    return rows.flatMap((row) => {
      let rawDefinition: unknown
      try {
        rawDefinition = JSON.parse(row.definition)
      } catch {
        return []
      }
      const parsedDefinition =
        scheduleViewDefinitionSchema.safeParse(rawDefinition)
      if (
        !parsedDefinition.success ||
        (row.visibility !== "personal" && row.visibility !== "shared")
      ) {
        return []
      }
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
    const user = await requireAuth()
    if (!isInternalStaffRole(user.role)) {
      return { success: false, error: "Only internal staff can save views." }
    }
    const organizationId = requireOrg(user)
    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)
    const now = new Date().toISOString()
    const existing = await db
      .select({ id: scheduleSavedViews.id })
      .from(scheduleSavedViews)
      .where(
        and(
          eq(scheduleSavedViews.ownerUserId, user.id),
          eq(scheduleSavedViews.name, parsed.data.name)
        )
      )
      .get()
    const id = existing?.id ?? crypto.randomUUID()

    if (existing) {
      await db
        .update(scheduleSavedViews)
        .set({
          visibility: parsed.data.visibility,
          definition: JSON.stringify(parsed.data.definition),
          updatedAt: now,
        })
        .where(eq(scheduleSavedViews.id, id))
        .run()
    } else {
      await db
        .insert(scheduleSavedViews)
        .values({
          id,
          organizationId,
          ownerUserId: user.id,
          name: parsed.data.name,
          visibility: parsed.data.visibility,
          definition: JSON.stringify(parsed.data.definition),
          createdAt: now,
          updatedAt: now,
        })
        .run()
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
    const user = await requireAuth()
    const organizationId = requireOrg(user)
    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)
    await db
      .delete(scheduleSavedViews)
      .where(
        and(
          eq(scheduleSavedViews.id, id),
          eq(scheduleSavedViews.organizationId, organizationId),
          eq(scheduleSavedViews.ownerUserId, user.id)
        )
      )
      .run()
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
