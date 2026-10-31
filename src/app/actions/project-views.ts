"use server"

import { and, asc, eq, or } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { z } from "zod/v4"
import { getDb } from "@/db"
import { projectJobStatuses, projectSavedViews, userViewPreferences, users } from "@/db/schema"
import { getCurrentUser, requireAuth } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import { isDemoOrg, isDemoUser } from "@/lib/demo"
import {
  deleteOwnedProjectSavedView,
  deleteUserViewPreference,
  insertProjectSavedView,
  saveUserViewPreference,
  updateOwnedProjectSavedView,
} from "@/lib/domain/settings/store"
import { requireOrg } from "@/lib/org-scope"
import { isInternalStaffRole } from "@/lib/user-roles"
import { PROJECT_JOB_STATUS_DEFINITIONS } from "@/lib/project-profile"
import {
  DEFAULT_PROJECT_VIEW,
  parseProjectViewDefinition,
  projectDefaultViewKey,
  projectViewDefinitionSchema,
  type ProjectViewDefinition,
  type ProjectViewPreferences,
  type SavedProjectView,
} from "@/lib/project-views"

type MutationResult = { readonly success: true } | { readonly success: false; readonly error: string }
type SaveViewInput = {
  readonly id: string | null
  readonly name: string
  readonly visibility: "personal" | "shared"
  readonly definition: ProjectViewDefinition | null
}
const saveSchema = z.object({
  id: z.string().min(1).max(200).nullable(),
  name: z.string().trim().min(1, "Enter a view name.").max(80),
  visibility: z.enum(["personal", "shared"]),
  // Null on an edit preserves the stored filters, even if a status was removed.
  definition: projectViewDefinitionSchema.nullable(),
})

async function viewContext(): Promise<{ readonly db: ReturnType<typeof getDb>; readonly userId: string; readonly organizationId: string }> {
  const user = await requireAuth()
  const organizationId = requireOrg(user)
  if (!isInternalStaffRole(user.role)) throw new Error("Only internal staff can save project views.")
  if (isDemoUser(user.id) || isDemoOrg(organizationId)) throw new Error("Demo accounts are read-only.")
  const { env } = await getCloudflareContext()
  return { db: getDb(env.DB), userId: user.id, organizationId }
}

async function statusExists(db: ReturnType<typeof getDb>, organizationId: string, definition: ProjectViewDefinition): Promise<boolean> {
  if (definition.status.kind !== "job") return true
  const statusId = definition.status.jobStatusId
  if (PROJECT_JOB_STATUS_DEFINITIONS.some((item) => item.id === statusId)) return true
  const row = await db.select({ id: projectJobStatuses.id }).from(projectJobStatuses)
    .where(and(eq(projectJobStatuses.organizationId, organizationId), eq(projectJobStatuses.id, statusId), eq(projectJobStatuses.active, true))).get()
  return row !== undefined
}

function refreshViews(): void {
  // The layout owns the sidebar's server-loaded default as well as the page.
  revalidatePath("/dashboard", "layout")
}

export async function getProjectViewPreferences(): Promise<ProjectViewPreferences> {
  try {
    const user = await getCurrentUser()
    if (!user?.organizationId || !isInternalStaffRole(user.role) || isDemoUser(user.id) || isDemoOrg(user.organizationId)) {
      return { defaultDefinition: null, canSave: false, error: null }
    }
    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)
    const row = await db.select({ value: userViewPreferences.value }).from(userViewPreferences)
      .where(and(eq(userViewPreferences.userId, user.id), eq(userViewPreferences.viewKey, projectDefaultViewKey(user.organizationId)))).get()
    const parsed = row ? parseProjectViewDefinition(row.value) : null
    const definition = parsed && await statusExists(db, user.organizationId, parsed) ? parsed : row ? DEFAULT_PROJECT_VIEW : null
    return { defaultDefinition: definition, canSave: true, error: null }
  } catch (error) {
    console.warn("Unable to load project view preferences", error)
    return { defaultDefinition: null, canSave: false, error: "Saved project preferences are temporarily unavailable." }
  }
}

export async function setDefaultProjectView(definition: ProjectViewDefinition | null): Promise<MutationResult> {
  const parsed = projectViewDefinitionSchema.nullable().safeParse(definition)
  if (!parsed.success) return { success: false, error: "Choose valid project filters." }
  try {
    const { db, userId, organizationId } = await viewContext()
    const viewKey = projectDefaultViewKey(organizationId)
    if (parsed.data === null) {
      await deleteUserViewPreference(db, userId, viewKey)
    } else {
      if (!await statusExists(db, organizationId, parsed.data)) return { success: false, error: "That job status is no longer available. Choose another status." }
      const value = JSON.stringify(parsed.data)
      const updatedAt = new Date().toISOString()
      await saveUserViewPreference(db, { userId, viewKey, value, updatedAt })
    }
    refreshViews()
    return { success: true }
  } catch (error) {
    console.warn("Unable to save default project view", error)
    return { success: false, error: "Unable to save your default project view." }
  }
}

export async function getProjectSavedViews(): Promise<{ readonly views: readonly SavedProjectView[]; readonly error: string | null }> {
  try {
    const user = await getCurrentUser()
    if (!user?.organizationId || !isInternalStaffRole(user.role) || isDemoUser(user.id) || isDemoOrg(user.organizationId)) return { views: [], error: null }
    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)
    const [rows, customStatuses] = await Promise.all([
      db.select({ view: projectSavedViews, ownerName: users.displayName }).from(projectSavedViews)
        .innerJoin(users, eq(users.id, projectSavedViews.ownerUserId)).where(and(
        eq(projectSavedViews.organizationId, user.organizationId),
        or(eq(projectSavedViews.ownerUserId, user.id), eq(projectSavedViews.visibility, "shared")),
      )).orderBy(asc(projectSavedViews.name)),
      db.select({ id: projectJobStatuses.id }).from(projectJobStatuses)
        .where(and(eq(projectJobStatuses.organizationId, user.organizationId), eq(projectJobStatuses.active, true))),
    ])
    const availableStatusIds = new Set([
      ...PROJECT_JOB_STATUS_DEFINITIONS.map((status) => status.id),
      ...customStatuses.map((status) => status.id),
    ])
    return { views: rows.flatMap(({ view: row, ownerName }) => {
      const parsed = parseProjectViewDefinition(row.definition)
      // Deleted custom statuses fall back just like personal default snapshots.
      const definition = parsed?.status.kind === "job" && !availableStatusIds.has(parsed.status.jobStatusId)
        ? DEFAULT_PROJECT_VIEW : parsed
      return definition ? [{ id: row.id, name: row.name, ownerName: ownerName ?? "Staff member", visibility: row.visibility, isOwner: row.ownerUserId === user.id, definition }] : []
    }), error: null }
  } catch (error) {
    console.warn("Unable to load saved project views", error)
    return { views: [], error: "Named project views are temporarily unavailable." }
  }
}

export async function saveProjectView(input: SaveViewInput): Promise<{ readonly success: true; readonly view: SavedProjectView } | { readonly success: false; readonly error: string }> {
  const parsed = saveSchema.safeParse(input)
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Review your view." }
  try {
    const { db, userId, organizationId } = await viewContext()
    const { id, name, visibility, definition } = parsed.data
    if (definition !== null && !await statusExists(db, organizationId, definition)) return { success: false, error: "That job status is no longer available." }
    if (id === null && definition === null) return { success: false, error: "Choose filters for the new view." }
    const now = new Date().toISOString()
    const viewId = id ?? crypto.randomUUID()
    if (id !== null) {
      const updated = await updateOwnedProjectSavedView(db, { id, organizationId, ownerUserId: userId, name, visibility,
        definition: definition === null ? undefined : JSON.stringify(definition), updatedAt: now })
      if (!updated) return { success: false, error: "Only the owner can edit this view." }
      const stored = parseProjectViewDefinition(updated.definition)
      const displayDefinition = stored && await statusExists(db, organizationId, stored) ? stored : DEFAULT_PROJECT_VIEW
      refreshViews()
      return { success: true, view: { id: viewId, name, ownerName: "You", visibility, isOwner: true, definition: displayDefinition } }
    } else {
      await insertProjectSavedView(db, { id: viewId, name, visibility, definition: JSON.stringify(definition), organizationId, ownerUserId: userId, createdAt: now, updatedAt: now })
    }
    refreshViews()
    return { success: true, view: { id: viewId, name, ownerName: "You", visibility, isOwner: true, definition: definition ?? DEFAULT_PROJECT_VIEW } }
  } catch (error) {
    console.warn("Unable to save project view", error)
    return { success: false, error: "Unable to save this view. Choose a unique name for your views." }
  }
}

export async function deleteProjectView(id: string): Promise<MutationResult> {
  if (typeof id !== "string" || id.length === 0 || id.length > 200) return { success: false, error: "Choose a saved view." }
  try {
    const { db, userId, organizationId } = await viewContext()
    const deleted = await deleteOwnedProjectSavedView(db, { id, organizationId, ownerUserId: userId })
    if (!deleted) return { success: false, error: "Only the owner can delete this view." }
    // Defaults are snapshots in user preferences; deleting a shared view cannot change them.
    refreshViews()
    return { success: true }
  } catch (error) {
    console.warn("Unable to delete project view", error)
    return { success: false, error: "Unable to delete this view." }
  }
}
