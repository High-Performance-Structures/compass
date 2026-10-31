/**
 * Reads for saved views and their defaults, shared by the project and
 * schedule screens. Each read is scoped to one organization and screen in
 * SQL. While project_saved_views and schedule_saved_views are still
 * dual-written, rules.ts decides per reader whether saved_views is complete.
 */
import { and, asc, eq, or } from "drizzle-orm"

import {
  projectSavedViews,
  savedViewDefaults,
  savedViews,
  scheduleSavedViews,
  userViewPreferences,
  users,
  type SavedViewScope,
} from "@/db/schema"
import { savedViewDefaultValue, savedViewReadSource } from "@/lib/domain/settings/rules"
import type { Db } from "@/lib/server/action-context"

export type VisibleSavedView = {
  readonly id: string
  readonly name: string
  readonly visibility: "personal" | "shared"
  readonly ownerUserId: string
  /** Null only for legacy schedule rows, which never joined the owner. */
  readonly ownerName: string | null
  readonly definition: string
}

type Reader = { readonly organizationId: string; readonly userId: string }

async function consolidatedViews(db: Db, scope: SavedViewScope, reader: Reader): Promise<readonly VisibleSavedView[] | null> {
  try {
    return await db
      .select({
        id: savedViews.id,
        name: savedViews.name,
        visibility: savedViews.visibility,
        ownerUserId: savedViews.ownerUserId,
        ownerName: users.displayName,
        definition: savedViews.definition,
      })
      .from(savedViews)
      .innerJoin(users, eq(users.id, savedViews.ownerUserId))
      .where(and(
        eq(savedViews.organizationId, reader.organizationId),
        eq(savedViews.scope, scope),
        or(eq(savedViews.ownerUserId, reader.userId), eq(savedViews.visibility, "shared")),
      ))
      .orderBy(asc(savedViews.name))
  } catch (error) {
    console.warn("saved_views unavailable; reading the per-screen table", error)
    return null
  }
}

async function legacyProjectViews(db: Db, reader: Reader): Promise<readonly VisibleSavedView[]> {
  return db
    .select({
      id: projectSavedViews.id,
      name: projectSavedViews.name,
      visibility: projectSavedViews.visibility,
      ownerUserId: projectSavedViews.ownerUserId,
      ownerName: users.displayName,
      definition: projectSavedViews.definition,
    })
    .from(projectSavedViews)
    .innerJoin(users, eq(users.id, projectSavedViews.ownerUserId))
    .where(and(
      eq(projectSavedViews.organizationId, reader.organizationId),
      or(eq(projectSavedViews.ownerUserId, reader.userId), eq(projectSavedViews.visibility, "shared")),
    ))
    .orderBy(asc(projectSavedViews.name))
}

async function legacyScheduleViews(db: Db, reader: Reader): Promise<readonly VisibleSavedView[]> {
  const rows = await db
    .select()
    .from(scheduleSavedViews)
    .where(and(
      eq(scheduleSavedViews.organizationId, reader.organizationId),
      or(eq(scheduleSavedViews.ownerUserId, reader.userId), eq(scheduleSavedViews.visibility, "shared")),
    ))
    .orderBy(asc(scheduleSavedViews.name))
  // Free-text visibility: anything else was never shown and is never copied.
  return rows.flatMap((row) => row.visibility === "personal" || row.visibility === "shared"
    ? [{ id: row.id, name: row.name, visibility: row.visibility, ownerUserId: row.ownerUserId, ownerName: null, definition: row.definition }]
    : [])
}

/** The reader's own views plus everyone's shared views for one screen, by name. */
export async function listVisibleSavedViews(
  db: Db,
  input: Reader & { readonly scope: SavedViewScope },
): Promise<readonly VisibleSavedView[]> {
  const [legacy, consolidated] = await Promise.all([
    input.scope === "projects" ? legacyProjectViews(db, input) : legacyScheduleViews(db, input),
    consolidatedViews(db, input.scope, input),
  ])
  const source = savedViewReadSource(legacy.map((row) => row.id), consolidated?.map((row) => row.id) ?? null)
  return source === "consolidated" && consolidated ? consolidated : legacy
}

/** The id of the person's schedule view with this name, if any (the save action upserts by name). */
export async function findOwnScheduleSavedViewId(db: Db, ownerUserId: string, name: string): Promise<string | undefined> {
  // Kept on the legacy table while it is dual-written: its (owner, name)
  // unique key is what the save action has always matched on.
  const row = await db
    .select({ id: scheduleSavedViews.id })
    .from(scheduleSavedViews)
    .where(and(eq(scheduleSavedViews.ownerUserId, ownerUserId), eq(scheduleSavedViews.name, name)))
    .get()
  return row?.id
}

/** The stored default filters (JSON) for one person, organization and screen, or null. */
export async function readSavedViewDefault(
  db: Db,
  input: Reader & { readonly scope: SavedViewScope; readonly legacyViewKey: string },
): Promise<string | null> {
  const consolidated = db
    .select({ inlineDefinition: savedViewDefaults.inlineDefinition, viewDefinition: savedViews.definition })
    .from(savedViewDefaults)
    .leftJoin(savedViews, eq(savedViews.id, savedViewDefaults.viewId))
    .where(and(
      eq(savedViewDefaults.userId, input.userId),
      eq(savedViewDefaults.organizationId, input.organizationId),
      eq(savedViewDefaults.scope, input.scope),
    ))
    .get()
    .catch((error: unknown) => {
      console.warn("saved_view_defaults unavailable; reading the view preference", error)
      return null
    })
  const legacy = db
    .select({ value: userViewPreferences.value })
    .from(userViewPreferences)
    .where(and(eq(userViewPreferences.userId, input.userId), eq(userViewPreferences.viewKey, input.legacyViewKey)))
    .get()
  const [row, legacyRow] = await Promise.all([consolidated, legacy])
  return savedViewDefaultValue(row, legacyRow?.value ?? null)
}
