"use server"

import { revalidatePath } from "next/cache"

import { recordActivityEvent, type ActivityActor } from "@/lib/activity-log"
import { actionFailure, errorMessage, type ActionResult } from "@/lib/action-result"
import { canEditFeatureSettings } from "@/lib/feature-settings/registry"
import { listSheetDefinition } from "@/lib/domain/settings/list-sheet-registry"
import {
  checkCompanyListSheet,
  checkPersonalListSheet,
  companyListSheetInputSchema,
  personalListSheetInputSchema,
} from "@/lib/domain/settings/list-sheet-rules"
import { readListSheetPreferences } from "@/lib/domain/settings/list-sheets"
import {
  deleteOrganizationListSheetSetting,
  deleteUserListSheetColumnPreference,
  saveOrganizationListSheetSetting,
  saveUserListSheetColumnPreference,
} from "@/lib/domain/settings/store"
import { orgContext, type OrgContext } from "@/lib/server/action-context"
import { isInternalStaffRole } from "@/lib/user-roles"

type Result = ActionResult<null>

const FAILED = "Could not save the list settings. Please try again."

/** Settings events keep their stored actor name: display name, else email. */
function settingsActor(user: OrgContext["user"]): ActivityActor {
  return { id: user.id, email: user.email, displayName: user.displayName, firstName: null, lastName: null, role: user.role }
}

/** Settings > Lists uses the same admin permission as the other company Settings tabs. */
async function companyContext(): Promise<{ readonly ok: true; readonly ctx: OrgContext } | { readonly ok: false; readonly error: string }> {
  const context = await orgContext({ mutation: true })
  if (!context.success) return { ok: false, error: context.error }
  const { user } = context.data
  if (!user.isActive || !isInternalStaffRole(user.role) || !canEditFeatureSettings(user.role)) {
    return { ok: false, error: "Only admins can change company settings." }
  }
  return { ok: true, ctx: context.data }
}

function refresh(): void {
  // The dashboard layout loads every sheet's layout once per request.
  revalidatePath("/dashboard", "layout")
}

/** Saves a company's columns, order, default sort and opening filter for one sheet. */
export async function saveCompanyListSheet(raw: unknown): Promise<Result> {
  try {
    const parsed = companyListSheetInputSchema.safeParse(raw)
    if (!parsed.success) return actionFailure("Check the list settings and try again.")
    const definition = listSheetDefinition(parsed.data.sheetId)
    if (!definition) return actionFailure("This list is not available.")
    const checked = checkCompanyListSheet(definition, parsed.data)
    if (!checked.ok) return actionFailure(checked.error)
    const access = await companyContext()
    if (!access.ok) return actionFailure(access.error)
    const { db, organizationId, user } = access.ctx
    const before = (await readListSheetPreferences(db, { organizationId, userId: user.id })).company[definition.id] ?? null
    const now = new Date().toISOString()
    const { columns, sort, startFilter } = checked.value
    await saveOrganizationListSheetSetting(db, {
      organizationId,
      sheetKey: definition.id,
      columns: JSON.stringify(columns),
      sortColumn: sort?.columnId ?? null,
      sortDirection: sort ? (sort.desc ? "desc" : "asc") : null,
      startFilter,
      updatedBy: user.id,
      now,
    })
    await recordActivityEvent({
      db,
      organizationId,
      actor: settingsActor(user),
      category: "settings",
      action: "updated",
      entityType: "list_sheet",
      entityId: definition.id,
      summary: `Updated the ${definition.label} list columns.`,
      metadata: {
        before: before ? { columns: before.columns.map((column) => ({ ...column })), sort: before.sort ? { ...before.sort } : null, startFilter: before.startFilter } : null,
        after: { columns: columns.map((column) => ({ ...column })), sort: sort ? { ...sort } : null, startFilter },
      },
      createdAt: now,
    })
    refresh()
    return { success: true, data: null }
  } catch (error) {
    return actionFailure(errorMessage(error, FAILED))
  }
}

/** Removes a company's layout for one sheet, back to the built-in columns. */
export async function resetCompanyListSheet(sheetId: string): Promise<Result> {
  try {
    const definition = listSheetDefinition(sheetId)
    if (!definition) return actionFailure("This list is not available.")
    const access = await companyContext()
    if (!access.ok) return actionFailure(access.error)
    const { db, organizationId, user } = access.ctx
    await deleteOrganizationListSheetSetting(db, organizationId, definition.id)
    await recordActivityEvent({
      db,
      organizationId,
      actor: settingsActor(user),
      category: "settings",
      action: "reset",
      entityType: "list_sheet",
      entityId: definition.id,
      summary: `Reset the ${definition.label} list to the built-in columns.`,
    })
    refresh()
    return { success: true, data: null }
  } catch (error) {
    return actionFailure(errorMessage(error, FAILED))
  }
}

/** Saves the signed-in person's own hidden and shown columns on one sheet. */
export async function savePersonalListSheetColumns(raw: unknown): Promise<Result> {
  try {
    const parsed = personalListSheetInputSchema.safeParse(raw)
    if (!parsed.success) return actionFailure("Check the columns and try again.")
    const definition = listSheetDefinition(parsed.data.sheetId)
    if (!definition) return actionFailure("This list is not available.")
    const context = await orgContext({ mutation: true })
    if (!context.success) return actionFailure(context.error)
    const { db, organizationId, user } = context.data
    const preference = checkPersonalListSheet(definition, parsed.data)
    const key = { userId: user.id, organizationId, sheetKey: definition.id }
    if (preference.hiddenColumnIds.length === 0 && preference.shownColumnIds.length === 0) {
      await deleteUserListSheetColumnPreference(db, key)
    } else {
      await saveUserListSheetColumnPreference(db, {
        ...key,
        hiddenColumnIds: JSON.stringify(preference.hiddenColumnIds),
        shownColumnIds: JSON.stringify(preference.shownColumnIds),
        now: new Date().toISOString(),
      })
    }
    return { success: true, data: null }
  } catch (error) {
    return actionFailure(errorMessage(error, FAILED))
  }
}
