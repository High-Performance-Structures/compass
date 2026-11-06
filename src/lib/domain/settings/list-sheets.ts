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
  LIST_SHEET_OWN_ORDER,
  listSheetColumnIdsSchema,
  listSheetColumnsSchema,
  parseStoredJson,
  resolveListSheetLayout,
  type CompanyListSheetSetting,
  type CompanyListSheetSort,
  type ListSheetPreferences,
  type PersonalListSheetPreference,
} from "@/lib/domain/settings/list-sheet-rules"
import { DEFAULT_RECORD_PAGE_QUERY, type RecordPageQuery } from "@/lib/record-page"
import { orgContext, type Db } from "@/lib/server/action-context"
import { isInternalStaffRole } from "@/lib/user-roles"

type Reader = { readonly organizationId: string; readonly userId: string }

/** sort_column NULL follows the code default; LIST_SHEET_OWN_ORDER is the list's own order. */
function storedSort(column: string | null, direction: string | null): CompanyListSheetSort {
  if (column === null) return { kind: "default" }
  if (column === LIST_SHEET_OWN_ORDER) return { kind: "none" }
  return { kind: "column", columnId: column, desc: direction === "desc" }
}

/** The tables are missing until migration 0295 is applied; say so once per isolate, not per request. */
let warnedUnavailable = false

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
      sort: storedSort(row.sortColumn, row.sortDirection),
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
    if (!warnedUnavailable) {
      warnedUnavailable = true
      console.warn("List sheet preferences unavailable; sheets use their defaults", error)
    }
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

/**
 * The query for a server-paged sheet's first page: page one in the sheet's
 * opening sort (personal, company, code default), so the browser shows it
 * without reading it again.
 */
export async function listSheetFirstPageQuery(sheetId: string): Promise<RecordPageQuery> {
  const definition = listSheetDefinition(sheetId)
  if (!definition) return DEFAULT_RECORD_PAGE_QUERY
  const preferences = await loadListSheetPreferences()
  const { sort } = resolveListSheetLayout(definition, preferences.company[sheetId] ?? null, preferences.personal[sheetId] ?? null)
  return sort ? { ...DEFAULT_RECORD_PAGE_QUERY, sortId: sort.columnId, sortDesc: sort.desc } : DEFAULT_RECORD_PAGE_QUERY
}
