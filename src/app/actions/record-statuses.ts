"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod/v4"

import { actionFailure, errorMessage, type ActionDone, type ActionResult } from "@/lib/action-result"
import { recordActivityEvent, type ActivityActor } from "@/lib/activity-log"
import { RECORD_STATUS_REGISTRY } from "@/lib/domain/record-statuses/registry"
import { RECORD_STATUS_LABEL_MAX, RECORD_STATUS_MAX_PER_TYPE, type RecordStatusList } from "@/lib/domain/record-statuses/rules"
import {
  RECORD_STATUS_COLORS,
  RECORD_STATUS_GROUPS,
  RECORD_STATUS_TYPES,
  type RecordStatusType,
} from "@/lib/domain/record-statuses/statuses"
import {
  deleteRecordStatus,
  loadAllRecordStatusLists,
  loadRecordStatusList,
  saveRecordStatusList,
  type RecordStatusWrite,
} from "@/lib/domain/record-statuses/store"
import { canEditFeatureSettings } from "@/lib/feature-settings/registry"
import { orgContext, type OrgContext } from "@/lib/server/action-context"
import { isInternalStaffRole } from "@/lib/user-roles"

/*
 * Settings › Statuses: each company's statuses per record type. Office staff
 * read them; the admins who edit other company Settings change them. Every
 * change is logged to Activity.
 */

export type RecordStatusSettingsView = {
  readonly lists: readonly (RecordStatusList & { readonly label: string })[]
  readonly canEdit: boolean
}

const typeSchema = z.enum(RECORD_STATUS_TYPES)

const editsSchema = z
  .array(
    z.object({
      key: z.string().trim().min(1).max(80).nullable(),
      label: z.string().trim().min(1, "Every status needs a name.").max(RECORD_STATUS_LABEL_MAX),
      color: z.enum(RECORD_STATUS_COLORS),
      group: z.enum(RECORD_STATUS_GROUPS),
      showAsButton: z.boolean(),
      hidden: z.boolean(),
    }),
  )
  .max(RECORD_STATUS_MAX_PER_TYPE)

function canEdit(context: OrgContext): boolean {
  return context.user.isActive && canEditFeatureSettings(context.user.role)
}

function settingsActor(user: OrgContext["user"]): ActivityActor {
  return { id: user.id, email: user.email, displayName: user.displayName ?? null, firstName: null, lastName: null, role: user.role }
}

function invalidate(): void {
  revalidatePath("/dashboard/settings")
  revalidatePath("/dashboard/purchase-orders")
  revalidatePath("/dashboard/projects", "layout")
}

function snapshot(list: RecordStatusList): readonly Record<string, string | boolean>[] {
  return list.statuses.map((status) => ({ ...status }))
}

async function logChange(
  context: OrgContext,
  type: RecordStatusType,
  action: "updated" | "deleted",
  summary: string,
  write: Extract<RecordStatusWrite, { ok: true }>,
): Promise<void> {
  await recordActivityEvent({
    db: context.db,
    organizationId: context.organizationId,
    actor: settingsActor(context.user),
    category: "settings",
    action,
    entityType: "record_statuses",
    entityId: type,
    summary,
    metadata: { recordType: type, before: snapshot(write.before), after: snapshot(write.after) },
  })
}

/** Every record type's statuses for Settings › Statuses, and whether this person may change them. */
export async function getRecordStatusSettings(): Promise<ActionResult<RecordStatusSettingsView>> {
  try {
    const context = await orgContext()
    if (!context.success) return context
    if (!isInternalStaffRole(context.data.user.role)) return actionFailure("Company settings are available to office staff.")
    const lists = await loadAllRecordStatusLists(context.data.db, context.data.organizationId)
    return {
      success: true,
      data: {
        lists: lists.map((list) => ({ ...list, label: RECORD_STATUS_REGISTRY[list.type].label })),
        canEdit: canEdit(context.data),
      },
    }
  } catch (error) {
    return actionFailure(errorMessage(error, "Unable to load statuses."))
  }
}

/**
 * A record type's statuses for the company, for a list page's filter
 * buttons, badges, sorting and status selects. The code defaults when the
 * company has not changed them.
 */
export async function getCompanyRecordStatuses(type: RecordStatusType): Promise<RecordStatusList> {
  const context = await orgContext()
  if (!context.success) throw new Error(context.error)
  return loadRecordStatusList(context.data.db, context.data.organizationId, typeSchema.parse(type))
}

/** Saves one record type's whole status list (admins only). */
export async function saveRecordStatuses(rawType: unknown, rawEdits: unknown): Promise<ActionDone> {
  try {
    const context = await orgContext({ mutation: true })
    if (!context.success) return context
    if (!canEdit(context.data)) return actionFailure("Only admins can change company statuses.")
    const type = typeSchema.safeParse(rawType)
    if (!type.success) return actionFailure("Unknown record type.")
    const edits = editsSchema.safeParse(rawEdits)
    if (!edits.success) return actionFailure(edits.error.issues[0]?.message ?? "Check the statuses and try again.")
    const write = await saveRecordStatusList(context.data.db, context.data.organizationId, type.data, edits.data, new Date().toISOString())
    if (!write.ok) return actionFailure(write.error)
    const label = RECORD_STATUS_REGISTRY[type.data].label
    await logChange(context.data, type.data, "updated", `Updated ${label} statuses.`, write)
    invalidate()
    return { success: true }
  } catch (error) {
    return actionFailure(errorMessage(error, "Unable to save statuses."))
  }
}

/** Deletes a company-added status no record uses (admins only). Built-in or in-use statuses are hidden instead. */
export async function deleteCompanyRecordStatus(rawType: unknown, rawKey: unknown): Promise<ActionDone> {
  try {
    const context = await orgContext({ mutation: true })
    if (!context.success) return context
    if (!canEdit(context.data)) return actionFailure("Only admins can change company statuses.")
    const type = typeSchema.safeParse(rawType)
    if (!type.success) return actionFailure("Unknown record type.")
    if (typeof rawKey !== "string" || rawKey.trim() === "") return actionFailure("Choose a status to delete.")
    const write = await deleteRecordStatus(context.data.db, context.data.organizationId, type.data, rawKey)
    if (!write.ok) return actionFailure(write.error)
    const removed = write.before.statuses.find((status) => status.key === rawKey)?.label ?? rawKey
    await logChange(context.data, type.data, "deleted", `Deleted the ${removed} status from ${RECORD_STATUS_REGISTRY[type.data].label}.`, write)
    invalidate()
    return { success: true }
  } catch (error) {
    return actionFailure(errorMessage(error, "Unable to delete the status."))
  }
}
