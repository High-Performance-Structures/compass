/**
 * Reads for list sheet layouts. The layout and pages share one read per
 * request (React `cache`): every sheet's company layout and the person's own
 * columns, in one D1 batch scoped to the organization and user in SQL.
 */
import { cache } from "react"
import { and, eq } from "drizzle-orm"

import { organizationListSheetSettings, userListSheetColumnPreferences } from "@/db/schema"
import { isDemoOrg, isDemoUser } from "@/lib/demo"
import { canEditFeatureSettings } from "@/lib/feature-settings/registry"
import { listSheetDefinition } from "@/lib/domain/settings/list-sheet-registry"
import {
  EMPTY_LIST_SHEET_PREFERENCES,
  listSheetColumnIdsSchema,
  listSheetColumnsSchema,
  parseStoredJson,
  resolveListSheetLayout,
  type CompanyListSheetSetting,
  type ListSheetPreferences,
  type PersonalListSheetPreference,
} from "@/lib/domain/settings/list-sheet-rules"
import { orgContext, type Db } from "@/lib/server/action-context"
import { isInternalStaffRole } from "@/lib/user-roles"

type Reader = { readonly organizationId: string; readonly userId: string }

/** Company layouts and the reader's own columns for every registered sheet. */
export async function readListSheetPreferences(
  db: Db,
  reader: Reader,
): Promise<Pick<ListSheetPreferences, "company" | "personal">> {
  const [companyRows, personalRows] = await db.batch([
    db
      .select({
        sheetKey: organizationListSheetSettings.sheetKey,
        columns: organizationListSheetSettings.columns,
        sortColumn: organizationListSheetSettings.sortColumn,
        sortDirection: organizationListSheetSettings.sortDirection,
        startFilter: organizationListSheetSettings.startFilter,
      })
      .from(organizationListSheetSettings)
      .where(eq(organizationListSheetSettings.organizationId, reader.organizationId)),
    db
      .select({
        sheetKey: userListSheetColumnPreferences.sheetKey,
        hiddenColumnIds: userListSheetColumnPreferences.hiddenColumnIds,
        shownColumnIds: userListSheetColumnPreferences.shownColumnIds,
      })
      .from(userListSheetColumnPreferences)
      .where(and(
        eq(userListSheetColumnPreferences.userId, reader.userId),
        eq(userListSheetColumnPreferences.organizationId, reader.organizationId),
      )),
  ])
  const company: Record<string, CompanyListSheetSetting> = {}
  for (const row of companyRows) {
    if (!listSheetDefinition(row.sheetKey)) continue
    company[row.sheetKey] = {
      columns: parseStoredJson(row.columns, listSheetColumnsSchema) ?? [],
      sort: row.sortColumn ? { columnId: row.sortColumn, desc: row.sortDirection === "desc" } : null,
      startFilter: row.startFilter,
    }
  }
  const personal: Record<string, PersonalListSheetPreference> = {}
  for (const row of personalRows) {
    if (!listSheetDefinition(row.sheetKey)) continue
    personal[row.sheetKey] = {
      hiddenColumnIds: parseStoredJson(row.hiddenColumnIds, listSheetColumnIdsSchema) ?? [],
      shownColumnIds: parseStoredJson(row.shownColumnIds, listSheetColumnIdsSchema) ?? [],
    }
  }
  return { company, personal }
}

/**
 * The signed-in person's list sheet preferences for this request. Never
 * throws: before the tables exist, or without an organization, sheets use
 * their code defaults.
 */
export const loadListSheetPreferences = cache(async (): Promise<ListSheetPreferences> => {
  try {
    const context = await orgContext()
    if (!context.success) return EMPTY_LIST_SHEET_PREFERENCES
    const { user, organizationId, db } = context.data
    const demo = isDemoUser(user.id) || isDemoOrg(organizationId)
    const stored = await readListSheetPreferences(db, { organizationId, userId: user.id })
    return {
      ...stored,
      canSavePersonal: !demo,
      canEditCompany: !demo && user.isActive && isInternalStaffRole(user.role) && canEditFeatureSettings(user.role),
    }
  } catch (error) {
    console.warn("List sheet preferences unavailable; sheets use their defaults", error)
    return EMPTY_LIST_SHEET_PREFERENCES
  }
})

/** The status filter a sheet opens on when the URL names none. */
export async function listSheetStartFilter(sheetId: string): Promise<string | null> {
  const definition = listSheetDefinition(sheetId)
  if (!definition?.startFilter) return null
  const preferences = await loadListSheetPreferences()
  return resolveListSheetLayout(definition, preferences.company[sheetId] ?? null, null).startFilter
}
